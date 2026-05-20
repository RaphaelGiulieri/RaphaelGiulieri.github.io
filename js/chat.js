// Portfolio chat assistant — bottom-right floating panel.
// Suggest-only: the model writes markdown links like [Title](#project:id)
// and this module intercepts the click to call window.openModal().
//
// Architecture: vanilla IIFE, SSE consumer via fetch + ReadableStream,
// sessionStorage persistence, sticky fallback to a tiny keyword recommender
// when the Worker is down or quota is exhausted.
//
// Public surface required from main.js (set on window at end of its IIFE):
//   window.openModal(projectId, triggerEl)
//   window.renderMarkdown(markdownString) → htmlString
//   window.RG_PROJECTS                    → array (state.projects)

(() => {
    'use strict';

    // ──────────────────────────────────────────────────────────────────────
    // Config — THE ONE PLACE to edit when the Worker URL changes.
    // ──────────────────────────────────────────────────────────────────────
    // The deployed Worker accepts requests from localhost:8000 (CORS allow-list),
    // so we always point at production. If you ever want to test against
    // `wrangler dev` locally, set window.__RG_CHAT_DEV__ = true before this loads.
    const CHAT_CONFIG = {
        workerUrl: window.__RG_CHAT_DEV__
            ? 'http://localhost:8787/'
            : 'https://rg-portfolio-chat.contact-raphael-giulieri.workers.dev/',
        maxUserTurns: 10,
        storageKey: 'rg-chat-v1',
        // Cloudflare Turnstile site key (public). Leave empty to disable the
        // widget client-side; the Worker also disables enforcement when
        // TURNSTILE_SECRET is unset. Both halves must be configured for
        // Turnstile to actually protect requests.
        turnstileSiteKey: '0x4AAAAAADSjFykwv0K86Zm9',
    };

    // ──────────────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────────────
    const state = {
        messages: [],      // [{role:'user'|'assistant', content:'...'}]
        turnsUsed: 0,
        expanded: false,
        busy: false,
        fallback: false,   // sticky once a 5xx / network error / 429 trips it
        abortController: null,   // in-flight SSE; aborted when panel collapses
    };

    let saveTimer = null;
    function save() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try {
                // Persist conversation + turn count, but NOT state.fallback —
                // we want each fresh tab/load to give the Worker another chance
                // instead of carrying yesterday's outage forward.
                sessionStorage.setItem(
                    CHAT_CONFIG.storageKey,
                    JSON.stringify({
                        messages: state.messages,
                        turnsUsed: state.turnsUsed,
                    })
                );
            } catch {}
        }, 200);
    }
    function restore() {
        try {
            const raw = sessionStorage.getItem(CHAT_CONFIG.storageKey);
            if (!raw) return;
            const obj = JSON.parse(raw);
            if (Array.isArray(obj.messages)) {
                // Shape-check each entry — sessionStorage is user-writable and
                // older schemas could otherwise crash renderHistory().
                const ok = obj.messages.every((m) =>
                    m && typeof m === 'object'
                    && (m.role === 'user' || m.role === 'assistant')
                    && typeof m.content === 'string'
                );
                if (ok) state.messages = obj.messages;
            }
            if (typeof obj.turnsUsed === 'number' && obj.turnsUsed >= 0) {
                state.turnsUsed = obj.turnsUsed;
            }
            // Intentionally NOT restoring state.fallback — see save() comment.
        } catch {}
    }

    // ──────────────────────────────────────────────────────────────────────
    // DOM
    // ──────────────────────────────────────────────────────────────────────
    let root, collapsedBtn, panel, history, textarea, sendBtn, statusEl, headSubEl;
    let lastFocus = null;
    let turnstileWidgetId = null;
    let turnstileToken = '';

    // ──────────────────────────────────────────────────────────────────────
    // Turnstile — invisible bot challenge. Loaded lazily on first chat open
    // so the script doesn't run for visitors who never touch the chat.
    // ──────────────────────────────────────────────────────────────────────
    function ensureTurnstileScript() {
        if (!CHAT_CONFIG.turnstileSiteKey) return Promise.resolve(false);
        if (window.turnstile) return Promise.resolve(true);
        return new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__rgChatTurnstileLoaded';
            s.async = true;
            s.defer = true;
            window.__rgChatTurnstileLoaded = () => resolve(true);
            s.onerror = () => resolve(false);
            document.head.appendChild(s);
        });
    }
    async function mountTurnstile() {
        if (!CHAT_CONFIG.turnstileSiteKey) return;
        const ok = await ensureTurnstileScript();
        if (!ok || !window.turnstile) return;
        const slot = panel.querySelector('.chat-turnstile-slot');
        if (!slot || turnstileWidgetId !== null) return;
        turnstileWidgetId = window.turnstile.render(slot, {
            sitekey: CHAT_CONFIG.turnstileSiteKey,
            size: 'flexible',
            theme: 'auto',
            callback: (token) => {
                turnstileToken = token;
                // Verified — collapse the widget so it stops eating panel real estate.
                // The token persists in JS state; the iframe inside the slot stays
                // mounted so reset() works on next send.
                slot.classList.add('is-verified');
            },
            'error-callback': () => { turnstileToken = ''; slot.classList.remove('is-verified'); },
            'expired-callback': () => { turnstileToken = ''; slot.classList.remove('is-verified'); },
        });
    }
    function refreshTurnstile() {
        turnstileToken = '';
        const slot = panel && panel.querySelector('.chat-turnstile-slot');
        if (slot) slot.classList.remove('is-verified');   // show again until re-verified
        if (turnstileWidgetId !== null && window.turnstile) {
            try { window.turnstile.reset(turnstileWidgetId); } catch {}
        }
    }

    function buildDom() {
        root = document.createElement('aside');
        root.className = 'chat';
        root.setAttribute('aria-label', 'Portfolio assistant');
        root.innerHTML = `
            <button type="button" class="chat-collapsed" aria-expanded="false" aria-controls="chat-panel">
                <span class="chat-section-mark">§ 01</span>
                <span class="chat-collapsed-label">Ask the portfolio</span>
            </button>
            <div class="chat-panel" id="chat-panel" role="dialog" aria-label="Portfolio assistant" aria-modal="false" hidden>
                <header class="chat-head">
                    <span class="chat-head-mark">§ 01</span>
                    <span class="chat-head-title"><i>Ask the portfolio</i></span>
                    <span class="chat-sub" data-chat-sub>Powered by Claude · ${CHAT_CONFIG.maxUserTurns}-turn session</span>
                    <button type="button" class="chat-close" aria-label="Close assistant">×</button>
                </header>
                <div class="chat-history" aria-live="polite"></div>
                <div class="chat-input-wrap">
                    <label class="chat-input-label" for="chat-input">
                        <span>Your question</span>
                        <span class="chat-status" data-chat-status></span>
                    </label>
                    <textarea id="chat-input" class="chat-input" rows="2"
                        placeholder="e.g. what shader work has he done?"
                        maxlength="2000"></textarea>
                    <div class="chat-turnstile-slot" aria-hidden="true"></div>
                    <div class="chat-actions">
                        <button type="button" class="chat-send">Send <kbd>⏎</kbd></button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(root);

        collapsedBtn = root.querySelector('.chat-collapsed');
        panel = root.querySelector('.chat-panel');
        history = root.querySelector('.chat-history');
        textarea = root.querySelector('.chat-input');
        sendBtn = root.querySelector('.chat-send');
        statusEl = root.querySelector('[data-chat-status]');
        headSubEl = root.querySelector('[data-chat-sub]');

        collapsedBtn.addEventListener('click', expand);
        root.querySelector('.chat-close').addEventListener('click', collapse);
        sendBtn.addEventListener('click', onSend);
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
            }
        });

        // Link interception — one delegated listener for the lifetime of the widget
        history.addEventListener('click', onHistoryClick);

        // Escape closes panel
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && state.expanded && !document.querySelector('.dossier[aria-hidden="false"]')) {
                e.preventDefault();
                collapse();
            }
            if (e.key === 'Tab' && state.expanded) trapFocus(e);
        });
    }

    function expand() {
        if (state.expanded) return;
        lastFocus = document.activeElement;
        state.expanded = true;
        panel.hidden = false;
        root.classList.add('is-expanded');
        collapsedBtn.setAttribute('aria-expanded', 'true');
        renderHistory();
        mountTurnstile();   // no-op if no site key configured
        // Defer focus so the panel is laid out before we move focus into it
        setTimeout(() => textarea.focus(), 0);
    }

    function collapse() {
        if (!state.expanded) return;
        state.expanded = false;
        panel.hidden = true;
        root.classList.remove('is-expanded');
        collapsedBtn.setAttribute('aria-expanded', 'false');
        // Cancel any in-flight stream — user closed the panel and has moved on.
        // Saves Anthropic output tokens on abandoned conversations.
        if (state.abortController) {
            try { state.abortController.abort(); } catch {}
            state.abortController = null;
        }
        if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
        else collapsedBtn.focus();
    }

    function trapFocus(e) {
        const focusables = panel.querySelectorAll(
            'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) {
            e.preventDefault();
            panel.focus();
            return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Render
    // ──────────────────────────────────────────────────────────────────────
    function renderHistory() {
        history.innerHTML = '';
        if (state.messages.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'chat-empty';
            empty.innerHTML = `
                <p>Ask about projects, skills, or research threads. The assistant points at the right dossier.</p>
                <ul class="chat-empty-suggestions">
                    <li><button type="button" data-suggest="What shader work has he done?">What shader work has he done?</button></li>
                    <li><button type="button" data-suggest="Show me an ML / AI project.">Show me an ML / AI project.</button></li>
                    <li><button type="button" data-suggest="What did he build for a client?">What did he build for a client?</button></li>
                </ul>
            `;
            history.appendChild(empty);
            empty.querySelectorAll('button[data-suggest]').forEach((b) =>
                b.addEventListener('click', () => {
                    textarea.value = b.getAttribute('data-suggest');
                    onSend();
                })
            );
            return;
        }
        state.messages.forEach((m, i) => {
            const wrap = document.createElement('div');
            wrap.className = 'chat-msg ' + (m.role === 'user' ? 'is-user' : 'is-assistant');
            wrap.setAttribute('data-msg', String(i));
            wrap.innerHTML = `
                <div class="chat-msg-label">${m.role === 'user' ? '— You' : 'Assistant'}</div>
                <div class="chat-msg-body"></div>
            `;
            history.appendChild(wrap);
            paintMessage(i);
        });
        renderStatus();
        history.scrollTop = history.scrollHeight;
    }

    function paintMessage(idx) {
        const wrap = history.querySelector(`[data-msg="${idx}"]`);
        if (!wrap) return;
        const body = wrap.querySelector('.chat-msg-body');
        const text = state.messages[idx].content || '';
        if (window.renderMarkdown) body.innerHTML = window.renderMarkdown(text);
        else body.textContent = text;
        body.querySelectorAll('a[href^="#project:"], a[href^="#section:"]')
            .forEach((a) => a.classList.add('chat-chip'));
    }

    function renderStatus() {
        const remaining = Math.max(0, CHAT_CONFIG.maxUserTurns - state.turnsUsed);
        if (state.turnsUsed >= CHAT_CONFIG.maxUserTurns) {
            statusEl.textContent = 'Session limit reached';
            textarea.disabled = true;
            sendBtn.disabled = true;
            sendBtn.textContent = 'Reset conversation';
            sendBtn.onclick = resetConversation;
        } else {
            statusEl.textContent = `${remaining} turn${remaining === 1 ? '' : 's'} left`;
            textarea.disabled = state.busy;
            sendBtn.disabled = state.busy;
            sendBtn.textContent = state.busy ? 'Sending…' : 'Send';
            sendBtn.onclick = onSend;
        }
        if (state.fallback) {
            headSubEl.textContent = 'Offline mode · keyword fallback';
        }
    }

    function resetConversation() {
        state.messages = [];
        state.turnsUsed = 0;
        state.busy = false;
        state.fallback = false;
        try { sessionStorage.removeItem(CHAT_CONFIG.storageKey); } catch {}
        textarea.value = '';
        textarea.disabled = false;
        sendBtn.disabled = false;
        sendBtn.onclick = onSend;
        sendBtn.textContent = 'Send';
        headSubEl.textContent = `Powered by Claude · ${CHAT_CONFIG.maxUserTurns}-turn session`;
        renderHistory();
        textarea.focus();
    }

    // ──────────────────────────────────────────────────────────────────────
    // Link interception
    // ──────────────────────────────────────────────────────────────────────
    function onHistoryClick(e) {
        const a = e.target.closest('a[href^="#project:"], a[href^="#section:"]');
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute('href');
        if (href.startsWith('#project:')) {
            const id = href.slice('#project:'.length);
            if (typeof window.openModal === 'function') window.openModal(id, a);
        } else {
            const id = href.slice('#section:'.length);
            const el = document.getElementById(id);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            collapse();
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Send + SSE consumption
    // ──────────────────────────────────────────────────────────────────────
    async function onSend() {
        if (state.busy) return;
        if (state.turnsUsed >= CHAT_CONFIG.maxUserTurns) return;
        const text = (textarea.value || '').trim();
        if (!text) return;

        textarea.value = '';
        state.busy = true;
        state.turnsUsed += 1;
        state.messages.push({ role: 'user', content: text });
        const assistantIdx = state.messages.push({ role: 'assistant', content: '' }) - 1;
        save();
        renderHistory();

        if (state.fallback) {
            state.messages[assistantIdx].content = fallbackAnswer(text);
            state.busy = false;
            save();
            renderHistory();
            return;
        }

        let res;
        state.abortController = new AbortController();
        try {
            res = await fetch(CHAT_CONFIG.workerUrl, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    messages: state.messages.slice(0, -1)
                        .map((m) => ({ role: m.role, content: m.content })),
                    turnstileToken: turnstileToken || undefined,
                }),
                signal: state.abortController.signal,
            });
        } catch (e) {
            if (e.name === 'AbortError') {
                // User collapsed before headers arrived — keep partial state,
                // do NOT trip the sticky fallback (this isn't an outage).
                state.abortController = null;
                state.busy = false;
                save();
                return;
            }
            return failOver(assistantIdx, text, 'network');
        }

        // 4xx soft errors — these are caused by the visitor, not infra.
        // Show a polite inline message, do NOT trip the sticky offline fallback.
        if (res.status === 429 || res.status === 403 || res.status === 400) {
            let body = {};
            try { body = await res.json(); } catch {}
            return softError(assistantIdx, body, text);
        }
        if (!res.ok || !res.body) {
            let errBody = '';
            try { errBody = await res.text(); } catch {}
            console.error(`[chat] Worker returned ${res.status}:`, errBody);
            return failOver(assistantIdx, text, 'upstream');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                let nl;
                while ((nl = buf.indexOf('\n\n')) !== -1) {
                    const evt = buf.slice(0, nl);
                    buf = buf.slice(nl + 2);
                    handleSseEvent(evt, assistantIdx);
                }
            }
        } catch (e) {
            // Stream broke mid-flight — keep whatever we got, mark not-busy
        }
        state.busy = false;
        state.abortController = null;
        refreshTurnstile();   // single-use tokens — get a fresh one for next send
        save();
        renderStatus();
        history.scrollTop = history.scrollHeight;
    }

    function handleSseEvent(evt, assistantIdx) {
        const lines = evt.split('\n');
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6);
            if (payload === '[DONE]') continue;
            try {
                const j = JSON.parse(payload);
                if (j.type === 'content_block_delta' && j.delta && typeof j.delta.text === 'string') {
                    state.messages[assistantIdx].content += j.delta.text;
                    paintMessage(assistantIdx);
                    history.scrollTop = history.scrollHeight;
                }
            } catch {}
        }
    }

    function failOver(assistantIdx, userText, reason) {
        state.fallback = true;
        state.messages[assistantIdx].content = fallbackAnswer(userText);
        state.busy = false;
        save();
        renderHistory();
    }

    // Soft errors — server-side validation issues that the visitor can recover
    // from. NEVER trip state.fallback for these (they're not infra outages).
    // Drop the empty assistant placeholder and surface the reason inline.
    function softError(assistantIdx, body, userText) {
        const msg = (() => {
            switch (body.error) {
                case 'quota_ip':
                    return "You've hit today's per-visitor message quota (resets midnight UTC). Here's a keyword match in the meantime:\n\n" + fallbackAnswer(userText);
                case 'quota_global':
                    state.fallback = true;
                    return "The assistant has hit its site-wide daily budget (resets midnight UTC). Falling back to keyword matching:\n\n" + fallbackAnswer(userText);
                case 'too_fast':
                    return 'A touch too fast — give it half a second and try again.';
                case 'duplicate':
                    return 'You just asked that one. Rephrase or try a different question.';
                case 'turnstile':
                    return "Couldn't verify the browser challenge — refresh the page and try again.";
                case 'bad_request':
                    return 'That message was too short or otherwise rejected — try a fuller question.';
                default:
                    return 'The request was rejected. Try rephrasing.';
            }
        })();
        state.messages[assistantIdx].content = msg;
        state.busy = false;
        // The user used a turn for this; refund it so soft errors don't eat budget
        if (body.error === 'too_fast' || body.error === 'duplicate' || body.error === 'turnstile' || body.error === 'bad_request') {
            state.turnsUsed = Math.max(0, state.turnsUsed - 1);
        }
        refreshTurnstile();
        save();
        renderHistory();
    }

    // ──────────────────────────────────────────────────────────────────────
    // Fallback recommender — tiny keyword scorer over RG_PROJECTS
    // ──────────────────────────────────────────────────────────────────────
    function fallbackAnswer(query) {
        const projects = window.RG_PROJECTS || [];
        const q = (query || '').toLowerCase();
        const tokens = q.split(/[^a-z0-9+]+/).filter((t) => t.length >= 2);
        if (tokens.length === 0 || projects.length === 0) {
            return "The assistant is offline right now. Try [Work](#section:work) or [Contact](#section:contact).";
        }
        const scored = projects.map((p) => {
            let s = 0;
            const cats = (p.categories || []).map((c) => String(c).toLowerCase());
            const skills = (p.skills_short || []).map((c) => String(c).toLowerCase());
            const tag = (p.tagline || '').toLowerCase();
            const title = (p.title || '').toLowerCase();
            for (const t of tokens) {
                if (cats.some((c) => c.includes(t))) s += 3;
                if (skills.some((c) => c.includes(t))) s += 2;
                if (tag.includes(t)) s += 1;
                if (title.includes(t)) s += 2;
            }
            return { p, s };
        }).filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 3);

        if (scored.length === 0) {
            return "Nothing matched directly. Browse [Work](#section:work) or jump to [Research](#section:research).";
        }
        const lines = scored.map(({ p }) => `- [${p.title}](#project:${p.id}) — ${p.tagline}`);
        return `Closest matches from the portfolio:\n\n${lines.join('\n')}`;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Init
    // ──────────────────────────────────────────────────────────────────────
    function init() {
        // Wait until main.js has set up window.RG_PROJECTS + openModal
        // (it does so at the end of its IIFE, which also runs on DOMContentLoaded).
        // Short retry loop covers the race.
        let tries = 0;
        const ready = () => typeof window.openModal === 'function' && Array.isArray(window.RG_PROJECTS);
        const start = () => {
            if (ready() || tries > 20) {
                buildDom();
                restore();
                renderHistory();
            } else {
                tries += 1;
                setTimeout(start, 100);
            }
        };
        start();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
