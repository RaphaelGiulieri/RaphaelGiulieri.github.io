# rg-portfolio-chat — Cloudflare Worker

Thin SSE proxy in front of the Anthropic Messages API. Holds the API key, enforces per-IP + global daily quotas via Cloudflare KV, injects the cached system block built from `data/{projects,research,experiences}.json`. ~150 lines total.

## One-time setup

```bash
# 1. Install wrangler + sign in
npm i -g wrangler
wrangler login

# 2. Create the KV namespace for rate-limiting
wrangler kv:namespace create RATE_KV
# → paste the printed id into wrangler.toml ([[kv_namespaces]].id)

# 3. Store the Anthropic API key as an encrypted secret
wrangler secret put ANTHROPIC_API_KEY
# → paste the key from https://console.anthropic.com

# 4. On the Anthropic console: set a monthly spend cap (recommend $65)
#    Settings → Billing → Set spend limit.
```

## Build + deploy

Every time `data/projects.json`, `data/research.json`, or `data/experiences.json` changes:

```bash
# From repo root
node scripts/build-corpus.mjs       # regenerates worker/src/corpus.js + data/corpus.json
cd worker
wrangler deploy
```

`wrangler deploy` prints the live URL — paste it into `js/chat.js` (`CHAT_CONFIG.workerUrl`) if it ever changes.

## Local dev

```bash
cd worker
wrangler dev --local --port 8787
```

The site (`js/chat.js`) automatically points at `http://localhost:8787/` when served from `localhost`/`127.0.0.1`. Test with:

```bash
curl -X POST http://localhost:8787/ \
  -H 'content-type: application/json' \
  -H 'origin: http://localhost:8000' \
  -d '{"messages":[{"role":"user","content":"what shader work has he done?"}]}'
```

You should see Anthropic SSE events stream in.

## Quotas & cost ceiling

| Knob | Value | Where set |
|---|---|---|
| Per-IP per day | 20 messages | `wrangler.toml` → `DAILY_PER_IP` |
| Global per day | 800 messages | `wrangler.toml` → `DAILY_GLOBAL` |
| Max output tokens | 400 | `wrangler.toml` → `MAX_OUTPUT_TOKENS` |
| Anthropic monthly | $65 | Anthropic console |

KV keys expire after 36 h so yesterday's counters auto-clean. To reset a single IP during testing: `wrangler kv:key delete --binding=RATE_KV "rate:<ip>:<YYYY-MM-DD>"`.

## What lives where

- `src/index.js` — request handler (CORS, quota, proxy).
- `src/corpus.js` — **generated** by `scripts/build-corpus.mjs`. Exports `SYSTEM_BLOCK`. Do not edit by hand.
- `wrangler.toml` — config + env vars. The KV namespace id is filled in once during setup.

## Failure modes the client handles

| Worker response | Client behaviour |
|---|---|
| `429 quota_ip` | Shows polite "daily limit reached" + fallback recommender |
| `429 quota_global` | Same fallback |
| `5xx upstream` | Falls back to client-side keyword recommender |
| Network unreachable | Same fallback, sticky for the session |

The site never breaks if this Worker is down — the chat just degrades to keyword search.
