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

    // Track every row so reset can iterate them. Each row stores enough state
    // to resolve a target value at reset time (from the saved snapshot in
    // localStorage if present, otherwise the code-side factory default) and
    // push it back into both the live state and the slider thumb.
    const rowRegistry = [];

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
            rowRegistry.push({ ref, key, factoryValue, toUI, apply });
        }
    }

    function refName(ref) {
        if (ref === postfx)  return 'postfx';
        if (ref === ambient) return 'ambient';
        if (ref === world)   return 'world';
        return null;
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
        row(sSpread, 'planet min dist', world, 'planetOrbitMin', 0.5, 60, 0.1,
            'Orbit radius of the innermost planet (across every system). Other planets distribute proportionally between min and max based on their original JSON ratios.',
            { factory: fw.planetOrbitMin });
        row(sSpread, 'planet max dist', world, 'planetOrbitMax', 0.5, 80, 0.1,
            'Orbit radius of the outermost planet (across every system).',
            { factory: fw.planetOrbitMax });
        row(sSpread, 'moon min dist', world, 'moonOrbitMin', 0.1, 15, 0.05,
            'Orbit radius of the innermost moon (across every planet). Other moons distribute proportionally.',
            { factory: fw.moonOrbitMin });
        row(sSpread, 'moon max dist', world, 'moonOrbitMax', 0.1, 20, 0.05,
            'Orbit radius of the outermost moon (across every planet).',
            { factory: fw.moonOrbitMax });
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
        row(sCam, 'moon dist', world, 'camDistMoon', 0.6, 8, 0.05,
            'Camera distance at moon zoom level. Click a moon to re-apply.',
            { factory: fw.camDistMoon });

        // ── Lighting ─────────────────────────────────────────────────────
        const sLight = section('Lighting');
        row(sLight, 'ambient floor', world, 'ambientFloor', 0, 1, 0.01,
            'Night-side luminance kept by planets / moons under the sun-lit Lambert wrap. 0 = pure black at the terminator (realistic). 1 = no shading effect (self-lit, like the suns).',
            { factory: fw.ambientFloor });
        row(sLight, 'sun tint', world, 'sunTintStrength', 0, 1, 0.01,
            'How strongly each planet / moon picks up the parent star\'s colour on its day-side. 0 = colour-neutral Lambert (luminance only). 1 = day-side fully multiplied by the sun\'s tint; night-side keeps the planet\'s own accent.',
            { factory: fw.sunTintStrength });

        // ── Sun bloom ────────────────────────────────────────────────────
        const sSunBloom = section('Sun bloom');
        row(sSunBloom, 'radius mul', world, 'sunBloomRadiusMul', 0, 30, 0.1,
            'Bloom billboard size as a multiple of the sun\'s world radius. Larger = glow extends further past the sun\'s silhouette. Independent of haloScale.',
            { factory: fw.sunBloomRadiusMul });
        row(sSunBloom, 'intensity', world, 'sunBloomIntensity', 0, 6, 0.05,
            'Peak brightness of the bloom at the centre of the billboard (before gaussian falloff). 0 disables the bloom entirely.',
            { factory: fw.sunBloomIntensity });
        row(sSunBloom, 'falloff', world, 'sunBloomFalloff', 0.5, 8, 0.05,
            'Gaussian sharpness exponent. Low = soft, wide glow (washes the screen). High = tight, point-like glow.',
            { factory: fw.sunBloomFalloff });

        // ── Gas giants (Navier-Stokes sim) ───────────────────────────────
        const sGas = section('Gas giants — Navier-Stokes');
        row(sGas, 'navier sim', world, 'gasGiantSim', 0, 1, 1,
            'Toggle the live sim. ON = each gas planet\'s velocity field is integrated once per frame (focused system only). OFF = field stays at its initial black state.',
            { toUI: (v) => v ? 1 : 0, fromUI: (v) => v >= 0.5, factory: fw.gasGiantSim });
        row(sGas, 'viscosity', world, 'gasGiantViscosity', 0, 4, 0.01,
            'Velocity damping per second (kinematic-viscosity proxy). Higher = field bleeds energy faster, calmer look. Lower = momentum persists longer, more turbulent.',
            { factory: fw.gasGiantViscosity });
        row(sGas, 'jet force', world, 'gasGiantJetForce', 0, 3, 0.01,
            'Strength of the zonal-jet restoring torque. The torque pulls each cell toward sin(lat·5)·0.35 — alternating east/west jets. 0 = no banded structure; high = bands dominate any forcing.',
            { factory: fw.gasGiantJetForce });
        row(sGas, 'advect mul', world, 'gasGiantAdvectMul', 0, 4, 0.01,
            'Multiplier on the backwards-advect step distance. Higher = wind carries the tracer faster.',
            { factory: fw.gasGiantAdvectMul });
        row(sGas, 'forcing rate', world, 'gasGiantForcingRate', 0, 4, 0.01,
            'Global rate multiplier on the equatorial forcing band. Multiplies both velocity perturbation and tracer source. 0 = no forcing (field decays to zero); high = strong continuous injection.',
            { factory: fw.gasGiantForcingRate });
        row(sGas, 'forcing strength', world, 'gasGiantForcingStrength', 0, 2, 0.01,
            'Velocity perturbation magnitude in the band. Combined with forcing rate as: v_kick = strength × rate × dt × band. Random per-cell direction (stable across frames) so the result is turbulent rather than uniform flow.',
            { factory: fw.gasGiantForcingStrength });
        row(sGas, 'forcing width', world, 'gasGiantForcingWidth', 0.02, 1.5, 0.005,
            'Gaussian σ of the equatorial forcing band in UV space. 0.05 = pinpoint equator; 0.30 = broad mid-latitude belt; 1.0 = almost the whole sphere.',
            { factory: fw.gasGiantForcingWidth });
        row(sGas, 'tracer source', world, 'gasGiantTracerSource', 0, 2, 0.01,
            'Dye flux into the equatorial band. Combined as: dye_kick = source × rate × dt × band. Higher = brighter visible pattern.',
            { factory: fw.gasGiantTracerSource });
        row(sGas, 'tracer decay', world, 'gasGiantTracerDecay', 0, 4, 0.01,
            'Dye decay per second. Steady-state ≈ tracer_source × forcing_rate / tracer_decay (per band cell). Tune so the steady-state lands in the visible smoothstep range (0.15…0.85).',
            { factory: fw.gasGiantTracerDecay });
        row(sGas, 'vorticity', world, 'gasGiantVorticityStrength', 0, 80, 0.5,
            'Vorticity confinement strength. Pushes fluid TOWARD existing curl regions so eddies grow instead of being viscosity-damped. The portfolio volumetric-fluid reference uses 18; higher = more aggressive vortex amplification.',
            { factory: fw.gasGiantVorticityStrength });
        row(sGas, 'pressure iters', world, 'gasGiantPressureIters', 0, 50, 1,
            'Number of Jacobi iterations per frame for the pressure Poisson solve. The reference uses 30. Higher = better incompressibility (eddies sustain longer) but more compute cost per frame.',
            { fromUI: (v) => v | 0, factory: fw.gasGiantPressureIters });

        // ── Particle rings ──────────────────────────────────────────────
        const sRing = section('Particle rings');
        row(sRing, 'distance', world, 'ringDistanceMul', 0.3, 3, 0.005,
            'Live multiplier on ring orbit radius. Slider drag re-radiuses the existing particles via the orbit module — no reload needed. 1.0 = JSON value.',
            { factory: fw.ringDistanceMul });
        row(sRing, 'width', world, 'ringWidthMul', 0.1, 4, 0.01,
            'Multiplier on ring thickness (outerRadius − innerRadius). Applied at spawn — RELOAD to take effect on existing rings.',
            { factory: fw.ringWidthMul });
        row(sRing, 'count', world, 'ringCountMul', 0.01, 1.5, 0.005,
            'Multiplier on particle count. Default 0.18 keeps the ring sparse enough that the starfield bloom postfx can\'t sum overlapping particles past its threshold. RELOAD to apply.',
            { factory: fw.ringCountMul });
        row(sRing, 'brightness', world, 'ringBrightnessMul', 0, 2, 0.005,
            'Multiplier on particle colour. Default 0.12 keeps each particle individually well below the bloom threshold (0.55), so no torus-of-light artefact. RELOAD to apply colour changes.',
            { factory: fw.ringBrightnessMul });
    }

    // ── Footer actions: Reset / Save / Factory ────────────────────────────
    const actions = document.createElement('div');
    actions.className = 'hg-actions';
    actions.innerHTML = `
        <button type="button" data-act="reset"   title="Revert every slider to the values you last saved with 'save as default'. If you've never saved, falls back to the code-side factory defaults.">reset</button>
        <button type="button" data-act="save"    title="Persist the current slider values to localStorage. On the next reload (and every 'reset' from now on) they become the baseline.">save as default</button>
        <button type="button" data-act="factory" title="Clear the saved snapshot in localStorage and snap every slider back to the code-side factory defaults. Use this if you want to nuke a bad save.">factory</button>
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

    function readSaved() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    }

    function restoreAll(savedSnap) {
        for (const r of rowRegistry) {
            const name = refName(r.ref);
            const target = (savedSnap && name && r.key in (savedSnap[name] || {}))
                ? savedSnap[name][r.key]
                : r.factoryValue;
            r.ref[r.key] = target;
            r.apply(r.toUI(target));
        }
    }

    actions.querySelector('[data-act="reset"]').addEventListener('click', () => {
        const saved = readSaved();
        restoreAll(saved);
        flash(saved ? 'reset to saved defaults' : 'no save — reset to factory');
    });
    actions.querySelector('[data-act="save"]').addEventListener('click', () => {
        const snapshot = {
            postfx:  { ...postfx },
            ambient: { ...ambient },
            world:   world ? { ...world } : undefined,
        };
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(snapshot));
            flash('saved · reset will now revert here');
        } catch (e) {
            flash('save failed: ' + e.message);
        }
    });
    actions.querySelector('[data-act="factory"]').addEventListener('click', () => {
        try { localStorage.removeItem(LS_KEY); } catch {}
        restoreAll(null);
        flash('save discarded · factory defaults restored');
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
