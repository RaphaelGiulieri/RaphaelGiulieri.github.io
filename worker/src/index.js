// Cloudflare Worker — Claude Haiku 4.5 chat proxy for raphaelgiulieri.github.io
//
// Responsibilities:
//   1. CORS preflight + origin allow-list
//   2. Optional Cloudflare Turnstile verification (enforced if TURNSTILE_SECRET set)
//   3. Per-IP and global daily quotas via Cloudflare KV
//   4. Anti-abuse quick wins: min-content-length, min-interval, dup-message reject
//   5. Inject the cached system block (preamble + corpus)
//   6. Stream SSE from Anthropic straight back to the browser
//
// No business logic lives here beyond rate limiting. The system block is the
// only place the model is told how to behave, and it's regenerated at build
// time by scripts/build-corpus.mjs.

import { SYSTEM_BLOCK } from './corpus.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const KV_TTL_SECONDS = 60 * 60 * 36;            // 36 h — auto-cleans yesterday's keys
const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Common low-effort prompt-injection patterns. Used to redact user messages
// BEFORE logging so an attacker can't poison wrangler tail with eye-grabbing
// strings, and to allow Claude's own injection-resistance rule to handle them.
const INJECTION_MARKERS = [
  /ignore (all |any |previous |above )?instructions?/i,
  /reveal (the |your )?(system )?prompt/i,
  /print (the |your )?(system )?prompt/i,
  /show (the |your )?(system )?prompt/i,
  /you are now/i,
  /act as (a |an )?/i,
  /\bdan mode\b/i,
  /\bjailbreak\b/i,
  /developer mode/i,
  /for educational purposes only/i,
];

function corsHeaders(origin, env) {
  const allow = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  const ok = allow.includes(origin);
  return {
    'access-control-allow-origin': ok ? origin : allow[0],
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-expose-headers': 'x-quota-remaining',
    vary: 'origin',
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  });
}

function isoDay() {
  return new Date().toISOString().slice(0, 10);
}

function validMessages(arr, minChars) {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > 22) return false;
  for (const m of arr) {
    if (!m || typeof m !== 'object') return false;
    if (m.role !== 'user' && m.role !== 'assistant') return false;
    if (typeof m.content !== 'string') return false;
    if (m.content.length > 4000) return false;          // per-message hard cap
  }
  // Last message must be user and meet the minimum length floor.
  const last = arr[arr.length - 1];
  if (last.role !== 'user') return false;
  if (last.content.trim().length < minChars) return false;
  return true;
}

// Simple non-cryptographic 32-bit hash (FNV-1a). Used as a fingerprint for
// duplicate-message detection — we don't need crypto strength, just a stable
// key that fits in KV without storing raw user content.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function redactForLog(s) {
  let out = (s || '').slice(0, 200);
  for (const re of INJECTION_MARKERS) out = out.replace(re, '[redacted-injection]');
  return out;
}

async function verifyTurnstile(token, ip, secret) {
  if (!secret) return { ok: true, skipped: true };
  if (!token || typeof token !== 'string') return { ok: false, reason: 'missing_token' };
  try {
    const r = await fetch(TURNSTILE_VERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    });
    const data = await r.json();
    return { ok: !!data.success, reason: data['error-codes']?.join(',') };
  } catch (e) {
    return { ok: false, reason: 'verify_threw:' + String(e).slice(0, 80) };
  }
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('origin') || '';
    const cors = corsHeaders(origin, env);

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    const ip = req.headers.get('cf-connecting-ip') || 'unknown';
    const day = isoDay();
    const ipKey = `rate:${ip}:${day}`;
    const globalKey = `global:${day}`;
    const lastTsKey = `lastts:${ip}`;

    // Body first — we need to inspect it for dup-detection + Turnstile token.
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: 'bad_request', detail: 'invalid json' }, 400, cors);
    }
    const minChars = +env.MIN_CONTENT_CHARS || 4;
    if (!validMessages(body.messages, minChars)) {
      return json({ error: 'bad_request', detail: 'invalid messages' }, 400, cors);
    }

    // 1) Turnstile (optional — only enforced if TURNSTILE_SECRET secret is set)
    const ts = await verifyTurnstile(body.turnstileToken, ip, env.TURNSTILE_SECRET);
    if (!ts.ok) {
      console.log('[turnstile-fail]', ip, ts.reason);
      return json({ error: 'turnstile', reason: ts.reason }, 403, cors);
    }

    // 2) Quotas
    const [ipRaw, globalRaw, lastTsRaw] = await Promise.all([
      env.RATE_KV.get(ipKey),
      env.RATE_KV.get(globalKey),
      env.RATE_KV.get(lastTsKey),
    ]);
    const ipCount = +ipRaw || 0;
    const globalCount = +globalRaw || 0;
    const dailyPerIp = +env.DAILY_PER_IP || 20;
    const dailyGlobal = +env.DAILY_GLOBAL || 100;

    if (ipCount >= dailyPerIp) {
      return json({ error: 'quota_ip', limit: dailyPerIp, retryAfter: 'tomorrow' }, 429, cors);
    }
    if (globalCount >= dailyGlobal) {
      return json({ error: 'quota_global', limit: dailyGlobal, retryAfter: 'tomorrow' }, 429, cors);
    }

    // 3) Min-interval throttle
    const minInterval = +env.MIN_MSG_INTERVAL_MS || 800;
    const now = Date.now();
    const lastTs = +lastTsRaw || 0;
    if (lastTs && now - lastTs < minInterval) {
      return json(
        { error: 'too_fast', waitMs: minInterval - (now - lastTs) },
        429,
        cors
      );
    }

    // 4) Duplicate-message reject (same IP, same last-message content, within TTL)
    const lastUser = body.messages[body.messages.length - 1].content;
    const dupKey = `dup:${ip}:${fnv1a(lastUser)}`;
    const dupTtl = +env.DUP_REJECT_TTL_S || 300;
    const dupHit = await env.RATE_KV.get(dupKey);
    if (dupHit) {
      return json({ error: 'duplicate', retryAfter: dupTtl }, 429, cors);
    }

    // Increment counters BEFORE the upstream call — prevents retry-spam abuse.
    await Promise.all([
      env.RATE_KV.put(ipKey, String(ipCount + 1), { expirationTtl: KV_TTL_SECONDS }),
      env.RATE_KV.put(globalKey, String(globalCount + 1), { expirationTtl: KV_TTL_SECONDS }),
      env.RATE_KV.put(lastTsKey, String(now), { expirationTtl: 60 }),
      env.RATE_KV.put(dupKey, '1', { expirationTtl: dupTtl }),
    ]);

    let upstream;
    try {
      upstream = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: env.MODEL,
          max_tokens: +env.MAX_OUTPUT_TOKENS || 400,
          stream: true,
          system: [
            {
              type: 'text',
              text: SYSTEM_BLOCK,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
    } catch (err) {
      return json({ error: 'upstream_unreachable', detail: String(err).slice(0, 200) }, 502, cors);
    }

    if (!upstream.ok || !upstream.body) {
      let text = '';
      try { text = await upstream.text(); } catch (e) { text = `(text() threw: ${e})`; }
      console.log(
        '[upstream-error]',
        upstream.status,
        upstream.headers.get('content-type'),
        text.slice(0, 600),
        'lastUser=', redactForLog(lastUser)
      );
      return json(
        {
          error: 'upstream',
          status: upstream.status,
          contentType: upstream.headers.get('content-type'),
          detail: text.slice(0, 600),
        },
        upstream.status >= 500 ? 502 : upstream.status,
        cors
      );
    }

    return new Response(upstream.body, {
      headers: {
        ...cors,
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'x-quota-remaining': String(dailyPerIp - ipCount - 1),
      },
    });
  },
};
