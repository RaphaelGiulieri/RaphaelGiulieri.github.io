// Dev tuning panel for the hero galaxy. Self-contained: injects its own CSS
// and DOM, and mutates the shared state objects (postfx, ambient, …) live each
// frame. To remove for ship: flip HERO_GALAXY_DEV_PANEL to false in
// js/hero-galaxy/index.js (or delete this file + its call site).

export function setupDevPanel({ postfx, ambient }) {
    if (!document.getElementById('hero-galaxy-dev-style')) {
        const styleEl = document.createElement('style');
        styleEl.id = 'hero-galaxy-dev-style';
        styleEl.textContent = `
            .hg-dev-panel {
                position: fixed; top: 16px; right: 16px; width: 290px;
                max-height: calc(100vh - 32px);
                z-index: 200; font-family: var(--f-mono, monospace);
                font-size: 9.5px; line-height: 1.35;
                background: rgba(12, 10, 7, 0.92);
                border: 1px solid var(--accent, #ff4b1f);
                color: var(--text, #f0ebe0);
                user-select: none;
                backdrop-filter: blur(6px);
                overflow-y: auto;
                scrollbar-width: thin;
                scrollbar-color: var(--accent, #ff4b1f) transparent;
            }
            .hg-dev-panel::-webkit-scrollbar { width: 6px; }
            .hg-dev-panel::-webkit-scrollbar-track { background: transparent; }
            .hg-dev-panel::-webkit-scrollbar-thumb { background: rgba(255, 75, 31, 0.5); }
            .hg-dev-panel header {
                position: sticky; top: 0; z-index: 1;
                display: flex; justify-content: space-between; align-items: baseline;
                text-transform: uppercase; letter-spacing: 0.14em;
                color: var(--accent, #ff4b1f);
                background: rgba(12, 10, 7, 0.96);
                border-bottom: 1px solid rgba(255, 75, 31, 0.4);
                padding: 10px 12px 6px;
                backdrop-filter: blur(6px);
            }
            .hg-dev-panel header button {
                background: none; border: 1px solid var(--accent, #ff4b1f);
                color: var(--accent, #ff4b1f); font: inherit; cursor: pointer;
                padding: 0 6px; letter-spacing: 0;
            }
            .hg-dev-panel header button:hover {
                background: var(--accent, #ff4b1f); color: var(--bg, #0c0a07);
            }
            .hg-dev-panel .hg-section {
                padding: 4px 12px 6px;
                border-top: 1px solid rgba(255, 75, 31, 0.18);
            }
            .hg-dev-panel .hg-section:first-of-type { border-top: 0; padding-top: 10px; }
            .hg-dev-panel .hg-section h3 {
                margin: 4px 0 4px;
                font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase;
                color: rgba(240, 235, 224, 0.45); font-weight: 500;
            }
            .hg-dev-panel .hg-row { margin: 5px 0; }
            .hg-dev-panel .hg-row label {
                display: flex; justify-content: space-between;
                text-transform: uppercase; letter-spacing: 0.06em;
                opacity: 0.75; margin-bottom: 2px;
            }
            .hg-dev-panel .hg-row label .val { color: var(--accent, #ff4b1f); opacity: 1; }
            .hg-dev-panel input[type="range"] {
                width: 100%; margin: 0; accent-color: var(--accent, #ff4b1f);
            }
            .hg-dev-panel.is-collapsed .hg-section { display: none; }
        `;
        document.head.appendChild(styleEl);
    }

    const panel = document.createElement('aside');
    panel.className = 'hg-dev-panel';
    panel.innerHTML = `<header><span>dev · hero galaxy</span><button type="button" data-act="toggle">−</button></header>`;

    function row(parent, label, value, min, max, step, desc, onChange) {
        const decimals = step < 0.001 ? 4 : step < 0.1 ? 3 : step < 1 ? 1 : 0;
        const el = document.createElement('div');
        el.className = 'hg-row';
        el.title = desc;
        el.innerHTML = `
            <label><span>${label}</span><span class="val">${(+value).toFixed(decimals)}</span></label>
            <input type="range" min="${min}" max="${max}" step="${step}" value="${value}">
        `;
        const input = el.querySelector('input');
        const val = el.querySelector('.val');
        input.addEventListener('input', () => {
            const v = +input.value;
            val.textContent = v.toFixed(decimals);
            onChange(v);
        });
        parent.appendChild(el);
    }

    function section(title) {
        const s = document.createElement('div');
        s.className = 'hg-section';
        s.innerHTML = `<h3>${title}</h3>`;
        panel.appendChild(s);
        return s;
    }

    // ── Starfield bloom ───────────────────────────────────────────────────
    const sBloom = section('Star bloom');
    row(sBloom, 'enable',     postfx.enableBloom ? 1 : 0, 0, 1, 1,
        'Master switch for the starfield bloom pass.',
        (v) => { postfx.enableBloom = v >= 0.5; });
    row(sBloom, 'threshold',  postfx.bloomThreshold, 0, 1.5, 0.01,
        'Brightness cutoff for the bright-pass. Lower → more pixels bloom (broader glow); higher → only the brightest stars halo.',
        (v) => { postfx.bloomThreshold = v; });
    row(sBloom, 'soft knee',  postfx.bloomSoftKnee, 0, 1, 0.01,
        'Softness of the threshold rolloff. 0 = hard cutoff (bands), 1 = very smooth.',
        (v) => { postfx.bloomSoftKnee = v; });
    row(sBloom, 'intensity',  postfx.bloomIntensity, 0, 3, 0.01,
        'Multiplier on the bright-pass composite. 0 = bloom invisible; >1 = blown-out.',
        (v) => { postfx.bloomIntensity = v; });
    row(sBloom, 'blur passes', postfx.blurPasses, 1, 6, 1,
        'Number of separable blur passes. More passes = wider, softer halo at a small frame-time cost.',
        (v) => { postfx.blurPasses = v | 0; });
    row(sBloom, 'exposure',   postfx.exposure, 0.2, 3, 0.01,
        'Final composite exposure multiplier.',
        (v) => { postfx.exposure = v; });
    row(sBloom, 'vignette',   postfx.vignette, 0, 1, 0.01,
        'Darkening at the frame edges.',
        (v) => { postfx.vignette = v; });

    // ── Ambient motion ────────────────────────────────────────────────────
    const sAmbient = section('Ambient');
    row(sAmbient, 'galaxy spin', ambient.galaxySpinRate, 0, 2, 0.01,
        'Galaxy-view auto-orbit rate (deg/sec). 0.5 = ~12 minutes per revolution.',
        (v) => { ambient.galaxySpinRate = v; });
    row(sAmbient, 'planet spin',  ambient.planetSpinRate, 0, 2, 0.01,
        'Per-planet self-rotation rate (rad/sec) at t.',
        (v) => { ambient.planetSpinRate = v; });
    row(sAmbient, 'idle delay s', ambient.idleSeconds, 0, 30, 0.5,
        'How long the visitor must be idle before the galaxy resumes its auto-orbit.',
        (v) => { ambient.idleSeconds = v; });

    panel.querySelector('[data-act="toggle"]').addEventListener('click', () => {
        const collapsed = panel.classList.toggle('is-collapsed');
        panel.querySelector('[data-act="toggle"]').textContent = collapsed ? '+' : '−';
    });

    document.body.appendChild(panel);
}
