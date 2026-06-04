// Dev tuning panel for the hero galaxy. Self-contained: injects its own CSS
// and DOM, and mutates the shared state objects live each frame. To remove
// for ship: flip HERO_GALAXY_DEV_PANEL to false (or delete this file + the
// import + the setupDevPanel call site in scene.js).
//
// "Save as default" persists the current values to localStorage. On the next
// load, scene.js merges those into the live state objects BEFORE the panel is
// built, so the panel opens already at the saved values.
// "Reset to default" copies the factory snapshot back into the live state
// objects and clears localStorage.
//
// When the design is final, dump `localStorage['hero-galaxy-dev-defaults']`
// and bake those numbers into scene.js's `factoryDefaults` block, then flip
// HERO_GALAXY_DEV_PANEL off.

const LS_KEY = 'hero-galaxy-dev-defaults';

export function setupDevPanel({ postfx, ambient, world, factoryDefaults }) {
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
            .hg-dev-panel .hg-actions {
                position: sticky; bottom: 0; z-index: 1;
                display: flex; gap: 6px;
                padding: 10px 12px;
                border-top: 1px solid rgba(255, 75, 31, 0.4);
                background: rgba(12, 10, 7, 0.96);
                backdrop-filter: blur(6px);
            }
            .hg-dev-panel .hg-actions button {
                flex: 1;
                background: none; border: 1px solid var(--accent, #ff4b1f);
                color: var(--accent, #ff4b1f); font: inherit;
                font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase;
                padding: 6px 8px; cursor: pointer;
            }
            .hg-dev-panel .hg-actions button:hover {
                background: var(--accent, #ff4b1f); color: var(--bg, #0c0a07);
            }
            .hg-dev-panel .hg-toast {
                position: absolute; bottom: 56px; left: 12px; right: 12px;
                background: var(--accent, #ff4b1f); color: var(--bg, #0c0a07);
                font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase;
                text-align: center; padding: 6px;
                opacity: 0; transition: opacity 200ms;
                pointer-events: none;
            }
            .hg-dev-panel .hg-toast.is-on { opacity: 1; }
            .hg-dev-panel.is-collapsed .hg-section,
            .hg-dev-panel.is-collapsed .hg-actions { display: none; }
        `;
        document.head.appendChild(styleEl);
    }

    const panel = document.createElement('aside');
    panel.className = 'hg-dev-panel';
    panel.innerHTML = `<header><span>dev · hero galaxy</span><button type="button" data-act="toggle">−</button></header>`;

    // Track every row so reset can iterate them. Each row holds a closure that
    // copies the corresponding `factoryDefaults` value back into the live state
    // and refreshes the slider thumb + displayed text.
    const rowResets = [];

    function row(parent, label, ref, key, min, max, step, desc, opts = {}) {
        const toUI   = opts.toUI   || ((v) => v);
        const fromUI = opts.fromUI || ((v) => v);
        const factoryValue = opts.factory;
        const decimals = step < 0.001 ? 4 : step < 0.1 ? 3 : step < 1 ? 1 : 0;

        const el = document.createElement('div');
        el.className = 'hg-row';
        el.title = desc;
        el.innerHTML = `
            <label><span>${label}</span><span class="val"></span></label>
            <input type="range" min="${min}" max="${max}" step="${step}">
        `;
        const input = el.querySelector('input');
        const val = el.querySelector('.val');
        function apply(uiValue) {
            input.value = uiValue;
            val.textContent = (+uiValue).toFixed(decimals);
        }
        apply(toUI(ref[key]));
        input.addEventListener('input', () => {
            const v = +input.value;
            val.textContent = v.toFixed(decimals);
            ref[key] = fromUI(v);
        });
        parent.appendChild(el);

        if (factoryValue !== undefined) {
            rowResets.push(() => {
                ref[key] = factoryValue;
                apply(toUI(factoryValue));
            });
        }
    }

    function section(title) {
        const s = document.createElement('div');
        s.className = 'hg-section';
        s.innerHTML = `<h3>${title}</h3>`;
        panel.appendChild(s);
        return s;
    }

    const fp = factoryDefaults?.postfx  || {};
    const fa = factoryDefaults?.ambient || {};
    const fw = factoryDefaults?.world   || {};

    // ── Starfield bloom ───────────────────────────────────────────────────
    const sBloom = section('Star bloom');
    row(sBloom, 'enable', postfx, 'enableBloom', 0, 1, 1,
        'Master switch for the starfield bloom pass.',
        { toUI: (v) => v ? 1 : 0, fromUI: (v) => v >= 0.5, factory: fp.enableBloom });
    row(sBloom, 'threshold', postfx, 'bloomThreshold', 0, 1.5, 0.01,
        'Brightness cutoff for the bright-pass.',
        { factory: fp.bloomThreshold });
    row(sBloom, 'soft knee', postfx, 'bloomSoftKnee', 0, 1, 0.01,
        'Softness of the threshold rolloff.',
        { factory: fp.bloomSoftKnee });
    row(sBloom, 'intensity', postfx, 'bloomIntensity', 0, 3, 0.01,
        'Multiplier on the bright-pass composite.',
        { factory: fp.bloomIntensity });
    row(sBloom, 'blur passes', postfx, 'blurPasses', 1, 6, 1,
        'Number of separable blur passes.',
        { fromUI: (v) => v | 0, factory: fp.blurPasses });
    row(sBloom, 'exposure', postfx, 'exposure', 0.2, 3, 0.01,
        'Final composite exposure multiplier.',
        { factory: fp.exposure });
    row(sBloom, 'vignette', postfx, 'vignette', 0, 1, 0.01,
        'Darkening at the frame edges.',
        { factory: fp.vignette });

    // ── Ambient motion ────────────────────────────────────────────────────
    const sAmbient = section('Ambient');
    row(sAmbient, 'planet spin', ambient, 'planetSpinRate', 0, 2, 0.01,
        'Per-planet self-rotation rate (rad/sec).',
        { factory: fa.planetSpinRate });

    if (world) {
        // ── Body spread ──────────────────────────────────────────────────
        const sSpread = section('Spread');
        row(sSpread, 'galaxy spread', world, 'galaxySpread', 0.3, 4, 0.01,
            'Multiplier on every star\'s distance from origin.',
            { factory: fw.galaxySpread });
        row(sSpread, 'planet orbits', world, 'planetOrbitSpread', 0.3, 4, 0.01,
            'Multiplier on every planet\'s orbital radius.',
            { factory: fw.planetOrbitSpread });
        row(sSpread, 'moon orbits', world, 'moonOrbitSpread', 0.3, 4, 0.01,
            'Multiplier on every moon\'s orbital radius.',
            { factory: fw.moonOrbitSpread });
        row(sSpread, 'star size', world, 'starSize', 0.3, 4, 0.01,
            'Multiplier on every star\'s radius.',
            { factory: fw.starSize });
        row(sSpread, 'planet size', world, 'planetSize', 0.3, 4, 0.01,
            'Multiplier on every planet\'s radius.',
            { factory: fw.planetSize });
        row(sSpread, 'moon size', world, 'moonSize', 0.3, 4, 0.01,
            'Multiplier on every moon\'s radius.',
            { factory: fw.moonSize });
        row(sSpread, 'halo scale', world, 'haloScale', 1.0, 6, 0.05,
            'Size of the alpha-blended halo sphere relative to its star.',
            { factory: fw.haloScale });

        // ── Labels ───────────────────────────────────────────────────────
        const sLabels = section('Labels');
        row(sLabels, 'gap (px)', world, 'labelGapPx', 0, 80, 1,
            'Pixels between the body silhouette and the bottom of the label text.',
            { factory: fw.labelGapPx });
        row(sLabels, 'star silhouette', world, 'labelMultStar', 0.2, 4, 0.05,
            'Body-radius multiplier when projecting the silhouette for star labels.',
            { factory: fw.labelMultStar });
        row(sLabels, 'planet silhouette', world, 'labelMultPlanet', 0.2, 4, 0.05,
            'Body-radius multiplier for planet labels.',
            { factory: fw.labelMultPlanet });
        row(sLabels, 'moon silhouette', world, 'labelMultMoon', 0.2, 4, 0.05,
            'Body-radius multiplier for moon labels.',
            { factory: fw.labelMultMoon });

        // ── Camera distances ─────────────────────────────────────────────
        const sCam = section('Camera distances');
        row(sCam, 'galaxy dist', world, 'camDistGalaxy', 40, 400, 1,
            'Camera distance at galaxy zoom level. Click \'Galaxy\' in the breadcrumb to re-apply.',
            { factory: fw.camDistGalaxy });
        row(sCam, 'system dist', world, 'camDistSystem', 8, 120, 0.5,
            'Camera distance at system zoom level. Re-enter a system to re-apply.',
            { factory: fw.camDistSystem });
        row(sCam, 'planet dist', world, 'camDistPlanet', 1.5, 30, 0.1,
            'Camera distance at planet zoom level. Re-enter a planet to re-apply.',
            { factory: fw.camDistPlanet });
    }

    // ── Footer actions: Reset to default + Save as default ────────────────
    const actions = document.createElement('div');
    actions.className = 'hg-actions';
    actions.innerHTML = `
        <button type="button" data-act="reset" title="Restore every slider to the code-side factory default + clear the localStorage snapshot.">reset</button>
        <button type="button" data-act="save"  title="Persist the current slider values to localStorage. On next load they replace the factory defaults until cleared.">save as default</button>
    `;
    const toast = document.createElement('div');
    toast.className = 'hg-toast';
    panel.appendChild(actions);
    panel.appendChild(toast);

    function flash(msg) {
        toast.textContent = msg;
        toast.classList.add('is-on');
        setTimeout(() => toast.classList.remove('is-on'), 1400);
    }

    actions.querySelector('[data-act="reset"]').addEventListener('click', () => {
        for (const fn of rowResets) fn();
        try { localStorage.removeItem(LS_KEY); } catch {}
        flash('reset to factory defaults');
    });
    actions.querySelector('[data-act="save"]').addEventListener('click', () => {
        const snapshot = {
            postfx:  { ...postfx },
            ambient: { ...ambient },
            world:   world ? { ...world } : undefined,
        };
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
            flash('saved · reload to confirm');
        } catch (e) {
            flash('save failed: ' + e.message);
        }
    });

    panel.querySelector('[data-act="toggle"]').addEventListener('click', () => {
        const collapsed = panel.classList.toggle('is-collapsed');
        panel.querySelector('[data-act="toggle"]').textContent = collapsed ? '+' : '−';
    });

    document.body.appendChild(panel);
}

// Helper for scene.js — read the saved snapshot (if any) and merge into the
// passed-in objects. Called BEFORE setupDevPanel so the panel shows the
// user's saved values from the moment it opens.
export function applySavedDefaults({ postfx, ambient, world }) {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (saved.postfx)  Object.assign(postfx,  saved.postfx);
        if (saved.ambient) Object.assign(ambient, saved.ambient);
        if (world && saved.world) Object.assign(world, saved.world);
    } catch (e) {
        console.warn('[hero-galaxy] saved defaults parse failed:', e);
    }
}
