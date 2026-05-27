// Hero masthead particle swarm.
// Bootstraps a WebGPU canvas that overlays the H1, attracts particles to a
// baked SDF of the name. Honours prefers-reduced-motion, gracefully falls
// back to the static H1 when WebGPU isn't available or the SDF asset fails.

(() => {
    'use strict';

    const HERO_PARTICLES_DEBUG = false;          // toggle for console logs
    const HERO_DEV_PANEL       = false;          // dev tuning panel — flip true to tune; off in production
    const SDF_META = 'assets/hero/name-sdf.json';
    const SDF_TIMEOUT_MS = 1500;                 // load N PNGs in parallel — give the slower ones a beat
    const FRAME_CYCLE_MS = 6000;                 // total dwell per phrase (scatter pulse + reform + held display)
    const MOBILE_BREAKPOINT = 720;
    const PARTICLE_COUNT_DESKTOP = 80_000;
    const PARTICLE_COUNT_MOBILE  = 15_000;

    function log(...a) { if (HERO_PARTICLES_DEBUG) console.log('[hero-particles]', ...a); }

    async function boot() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot, { once: true });
            return;
        }
        const stage = document.querySelector('.hero-name-stage');
        if (!stage) { log('no stage'); return; }
        // Helper: any early-return inside boot routes through this, which
        // promotes the stage to the visible-H1 fallback state. Doing this
        // here (and not unconditionally in HTML) means a NoScript visitor
        // still gets the H1 visible via the <noscript> override in CSS, and
        // a successful engine boot stays purely on particles.
        const showFallback = () => stage.classList.add('is-fallback');

        // 1. WebGPU available?
        if (!('gpu' in navigator)) { log('no navigator.gpu'); showFallback(); return; }

        // 2. Reduced motion?
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            log('reduced-motion preferred'); showFallback(); return;
        }

        // 3. Mobile budget (chosen via media query, not UA sniffing).
        const isMobile = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
        const particleCount = isMobile ? PARTICLE_COUNT_MOBILE : PARTICLE_COUNT_DESKTOP;

        // 4. SDF asset load + timeout. The meta JSON is now an array of frames,
        //    one PNG per frame. The runtime cycles through them every
        //    FRAME_CYCLE_MS so the masthead announces multiple positioning
        //    words (name, discipline, domain pairs) instead of staying fixed
        //    on a single phrase.
        let sdfMeta, sdfImages;
        try {
            const metaJson = await withTimeout(
                fetch(SDF_META).then(r => r.ok ? r.json() : Promise.reject('meta 404')),
                SDF_TIMEOUT_MS);
            if (!metaJson.frames || !metaJson.frames.length) throw new Error('no frames in meta');
            sdfMeta = metaJson;
            const imgBlobs = await Promise.all(sdfMeta.frames.map(f => withTimeout(
                fetch('assets/hero/' + f.png).then(r => r.ok ? r.blob() : Promise.reject('png 404 ' + f.png)),
                SDF_TIMEOUT_MS)));
            sdfImages = await Promise.all(imgBlobs.map(b => createImageBitmap(b)));
        } catch (e) { log('sdf load failed', e); showFallback(); return; }

        // 5. Engine mount.
        const canvas = stage.querySelector('canvas.hero-particles');
        // Wait a frame so flex layout has settled and stage.clientWidth/Height
        // reflect the final box — otherwise we get e.g. 830×442 when the stage
        // actually ends up 1384×471. Use setTimeout fallback when the tab is
        // hidden (rAF doesn't fire in hidden tabs and would hang boot forever).
        await new Promise((r) => {
            if (document.hidden) setTimeout(r, 16);
            else requestAnimationFrame(r);
        });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width  = Math.floor(stage.clientWidth  * dpr);
        canvas.height = Math.floor(stage.clientHeight * dpr);

        const { createParticleSystem, Emitter, shapes, modules } = await import('./particles/index.js');
        let ps;
        try {
            ps = await createParticleSystem({
                canvas,
                backend: 'webgpu',
                maxParticles: particleCount,
                blend: 'additive',
            });
        } catch (e) { log('createParticleSystem failed', e); showFallback(); return; }

        // Use the engine's own GPUDevice to create the SDF textures so they
        // land on the same device that the bind group references. (Path 1.)
        // One texture per frame — we hot-swap which one is bound via
        // ps.updateSdfTexture() at each frame transition below.
        const device = ps.device;
        const sdfTextures = sdfImages.map(img => {
            const tex = device.createTexture({
                size: [img.width, img.height, 1],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING
                     | GPUTextureUsage.COPY_DST
                     | GPUTextureUsage.RENDER_ATTACHMENT,
            });
            device.queue.copyExternalImageToTexture(
                { source: img }, { texture: tex },
                { width: img.width, height: img.height });
            return tex;
        });

        // All frames share the same SDF dimensions (sdfMeta.width × height),
        // so the scale/offset/radius can be computed once and reused on every
        // frame transition. Stretches SDF to ~92% of canvas width preserving
        // the native aspect.
        const NATIVE_SDF_W = sdfMeta.width;
        const NATIVE_SDF_H = sdfMeta.height;
        const SDF_W = canvas.width * 0.92;
        const SDF_SCALE = SDF_W / NATIVE_SDF_W;
        const SDF_H = NATIVE_SDF_H * SDF_SCALE;
        const SDF_OFFSET_X = (canvas.width  - SDF_W) / 2;
        const SDF_OFFSET_Y = (canvas.height - SDF_H) / 2;
        const SDF_RADIUS_SCALED = sdfMeta.distance_radius_px * SDF_SCALE;

        // Push the initial SDF texture + uniforms into the engine's bind
        // group. Frame 0 = the name; subsequent frames cycle in via the
        // FRAME_CYCLE_MS timer at the bottom of boot.
        ps.updateSdfTexture(sdfTextures[0]);
        ps.updateSdfUniforms(
            SDF_W, SDF_H, SDF_RADIUS_SCALED,
            SDF_OFFSET_X, SDF_OFFSET_Y);

        // Mutable interaction strengths — referenced inside the emitter loop
        // (for cursor module's initial strength) AND by the click handler
        // below. The dev panel tweaks these live.
        const interaction = {
            hoverStrength: -12_000,
            clickStrength: -500_000,
        };

        // Two emitters, each attracts to ITS OWN word via a different SDF channel.
        // Spawn position = anywhere on the canvas — particles drift toward their
        // word via the long-distance center pull, then settle into the SDF
        // gradient once they're in range. Initial setup uses frame 0; the
        // frame-cycle timer below mutates per-emitter centerX/Y/bounds live as
        // we swap the bound SDF texture so the swarm morphs to each new phrase.
        const tunedModules = [];   // [{ sdf, drag, cursor }] for the dev panel + interactions
        for (const line of sdfMeta.frames[0].lines) {
            const colorRgba = hexToRgba(line.color, 1.0);
            // Word center in CANVAS-pixel space (after the SDF→canvas scale + offset).
            const wordCenterX = SDF_OFFSET_X + line.center.x * SDF_SCALE;
            const wordCenterY = SDF_OFFSET_Y + line.center.y * SDF_SCALE;
            // Word bounding box in CANVAS-pixel space — per-particle target XY spans
            // this rect so particles spread across the whole word rather than
            // clumping at the nearest stroke. Inflate vertically a touch so target
            // points cover ascenders/descenders + a thin halo above/below.
            const boundsX = SDF_OFFSET_X + line.bounds.x * SDF_SCALE;
            const boundsY = SDF_OFFSET_Y + line.bounds.y * SDF_SCALE;
            const boundsW = line.bounds.w * SDF_SCALE;
            const boundsH = line.bounds.h * SDF_SCALE;
            const sdfMod = modules.sdfAttract({
                strength: 364,
                insideRepel: 120,
                wander: 8.6,
                channel: line.channel,        // 0 = Raphael, 1 = Giulieri
                centerX: wordCenterX,
                centerY: wordCenterY,
                farPull: 500,
                boundsX, boundsY, boundsW, boundsH,
                spread: 90,
                expCoef: 0.0159,
                expCap: 8,
                flow: 400,
                speedJitter: 1.0,
            });
            const dragMod = modules.drag(6.6);
            // Cursor-repulsion attractor (negative strength = repulsion). Position
            // parked off-screen until the user hovers the stage. Mutated live by
            // the mousemove handler below.
            const cursorMod = modules.attractor({
                position: [-1e6, -1e6, 0],
                strength: interaction.hoverStrength,
                falloff: 'inv-square',
            });
            const em = new Emitter({
                position: [canvas.width / 2, canvas.height / 2, 0],
                shape: shapes.box({ size: [canvas.width, canvas.height, 0] }),
                rate: 0,
                bursts: [{ time: 0, count: Math.floor(particleCount / 2) }],
                initial: {
                    lifetime: { min: 10_000, max: 10_000 },
                    // Coalesce entrance — high outward burst that drag + sdfAttract
                    // brake into the silhouette over ~1.2s. Speed 0 here would
                    // make particles teleport-to-letter, which kills the moment.
                    speed:    { min: 800, max: 1400 },
                    size:     { min: 2.1, max: 3.3 },     // size 3.0 with ±20% spread
                    color:    colorRgba,
                },
                modules: [sdfMod, cursorMod, dragMod],
            });
            tunedModules.push({ sdf: sdfMod, drag: dragMod, cursor: cursorMod, emitter: em });
            await ps.addEmitter(em);
        }

        // ── Pointer interactions ───────────────────────────────────────────
        // Hover pushes particles away from the cursor; mouse-leave parks the
        // attractor off-screen so the swarm relaxes. Click triggers a brief
        // ~80ms super-repulsion impulse — the SDF attract then wins back over
        // a beat and the letters reform. `interaction` is declared above the
        // emitter loop so the cursor module can read its initial strength.
        const canvasRect = () => canvas.getBoundingClientRect();
        stage.addEventListener('mousemove', (e) => {
            const r = canvasRect();
            const x = ((e.clientX - r.left) / r.width)  * canvas.width;
            const y = ((e.clientY - r.top)  / r.height) * canvas.height;
            for (const t of tunedModules) {
                t.cursor.params.x = x;
                t.cursor.params.y = y;
            }
        });
        stage.addEventListener('mouseleave', () => {
            for (const t of tunedModules) {
                t.cursor.params.x = -1e6;
                t.cursor.params.y = -1e6;
            }
        });
        stage.addEventListener('click', (e) => {
            const r = canvasRect();
            const x = ((e.clientX - r.left) / r.width)  * canvas.width;
            const y = ((e.clientY - r.top)  / r.height) * canvas.height;
            for (const t of tunedModules) {
                t.cursor.params.x = x;
                t.cursor.params.y = y;
                t.cursor.params.strength = interaction.clickStrength;
            }
            setTimeout(() => {
                for (const t of tunedModules) t.cursor.params.strength = interaction.hoverStrength;
            }, 80);
        });
        // Note: setupDevPanel is called AFTER the FPS object is created down
        // in the render-loop block, so we wire it after the IO setup below.

        // Animation loop (idle steady state; Phase 5 adds the coalesce intro).
        // Projection maps canvas-pixel coordinates (0..w, 0..h with y-down) to
        // WebGPU NDC (-1..1 with y-up). Without this, identity matrices leave
        // pixel-space particles miles outside the clip volume — the few that
        // survive render as massive blobs.
        const view = mat4Identity();
        const proj = mat4OrthoPixels(canvas.width, canvas.height);
        let last = performance.now();
        let running = false;
        // FPS tracker — rolling window over the last second. Read live by the
        // dev panel; cheap enough that always-on doesn't matter.
        const fps = { value: 0, _frames: 0, _accum: 0 };
        // Render-pass background colour — clearcolor for the scene texture.
        // Mutated live by the dev panel via the colour picker. Alpha 1 so the
        // canvas reads opaque (alpha 0 would leave the previous frame on
        // screen and cause additive-blend trails to accumulate forever).
        const bgColor = [2 / 255, 2 / 255, 2 / 255, 1.0];     // near-black, #020202
        // Post-FX state — mutated live by the dev panel. The engine reads
        // these fields off the object each render call.
        const postfx = {
            enableBloom: true,
            bloomThreshold: 0.85,
            bloomSoftKnee: 0.7,
            bloomIntensity: 0.7,
            blurPasses: 3,
            exposure: 1.0,
            vignette: 0.30,
        };
        function loop(now) {
            if (!running) return;     // IntersectionObserver paused us — self-exit
            const dt = Math.min(0.05, (now - last) / 1000); last = now;
            fps._frames++; fps._accum += dt;
            if (fps._accum >= 0.5) {
                fps.value = fps._frames / fps._accum;
                fps._frames = 0; fps._accum = 0;
            }
            ps.update(dt);
            // Opaque dark clear matching the page background colour so the canvas
            // is indistinguishable from the section behind it. Alpha=0 here would
            // leave the previous frame on screen and additively accumulate trails.
            ps.render({ view, proj, bgColor, postfx });
            requestAnimationFrame(loop);
        }
        // Engine ready — flip to live so the canvas fades in. The H1 stays
        // invisible (default CSS state); no more cross-fade with the static
        // typography, since the swarm itself coalesces visibly during its
        // first ~1.2s of drag + sdfAttract braking.
        stage.classList.remove('is-static');
        stage.classList.add('is-live');

        // Frame-cycle: every FRAME_CYCLE_MS, update the SDF + per-emitter
        // params for the next word, then call ps.reset() which clears the
        // alive buffer and re-fires the initial bursts. Each emitter's burst
        // shape is a canvas-sized box with 800–1400 px/s outward speed, so
        // every transition is effectively a fresh coalesce: particles
        // re-appear across the whole canvas and fly into the new silhouette.
        // Scatter-then-reform was too subtle; full respawn reads as a clear
        // beat and gives the new word its own settling cinematic.
        let frameIdx = 0;
        function advanceFrame() {
            frameIdx = (frameIdx + 1) % sdfMeta.frames.length;
            ps.updateSdfTexture(sdfTextures[frameIdx]);
            const lines = sdfMeta.frames[frameIdx].lines;
            for (let i = 0; i < tunedModules.length && i < lines.length; i++) {
                const line = lines[i];
                const p = tunedModules[i].sdf.params;
                p.centerX = SDF_OFFSET_X + line.center.x * SDF_SCALE;
                p.centerY = SDF_OFFSET_Y + line.center.y * SDF_SCALE;
                p.boundsX = SDF_OFFSET_X + line.bounds.x * SDF_SCALE;
                p.boundsY = SDF_OFFSET_Y + line.bounds.y * SDF_SCALE;
                p.boundsW = line.bounds.w * SDF_SCALE;
                p.boundsH = line.bounds.h * SDF_SCALE;
            }
            ps.reset();
        }
        const cycleTimer = setInterval(advanceFrame, FRAME_CYCLE_MS);

        // Pause the rAF loop when the hero scrolls out of view. Saves ~80k
        // particle updates per frame when the visitor is reading further down.
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) {
                const visible = e.intersectionRatio >= 0.1;
                if (visible && !running) {
                    running = true;
                    last = performance.now();
                    requestAnimationFrame(loop);
                } else if (!visible && running) {
                    running = false;
                }
            }
        }, { threshold: [0, 0.1] });
        io.observe(stage);

        if (HERO_DEV_PANEL) setupDevPanel({ tunedModules, ps, interaction, fps, postfx, bgColor, maxParticles: particleCount });

        log('engine mounted', { particles: particleCount, sdf: [SDF_W, SDF_H], offset: [SDF_OFFSET_X, SDF_OFFSET_Y] });
    }

    function hexToRgba(hex, alpha) {
        const m = hex.replace('#', '');
        return [
            parseInt(m.substr(0, 2), 16) / 255,
            parseInt(m.substr(2, 2), 16) / 255,
            parseInt(m.substr(4, 2), 16) / 255,
            alpha,
        ];
    }
    function mat4Identity() {
        return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    }
    // Orthographic projection that maps pixel coordinates (0..w left-to-right,
    // 0..h top-to-bottom) to WebGPU NDC (-1..1 left-to-right, -1..1 bottom-to-top).
    // Z range -1..1 maps to NDC z 0..1 (WebGPU convention; clip depth 0 = near).
    // Column-major Float32Array as WebGPU consumes it.
    function mat4OrthoPixels(w, h) {
        return new Float32Array([
            2 / w,   0,       0,    0,
            0,      -2 / h,   0,    0,
            0,       0,       0.5,  0,
           -1,       1,       0.5,  1,
        ]);
    }

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
        ]);
    }

    // ─── dev tuning panel ──────────────────────────────────────────────
    // Pinned to the right of the canvas. Mutates the live `params` objects
    // on the running sdfAttract / drag modules. Both emitters share params
    // so each slider updates both at once. To remove for ship: flip
    // HERO_DEV_PANEL to false (or delete this function + its call site).
    function setupDevPanel({ tunedModules, ps, interaction, fps, postfx, bgColor, maxParticles }) {
        const PARAMS = [
            // [field,         label,         min,    max,    step,    desc]
            ['strength',       'attract',       0,   1500,    2,
                'SDF gradient force pulling particles toward the silhouette outline. Higher = letters look tighter / sharper edges.'],
            ['insideRepel',    'inside repel',  0,    120,    0.5,
                'Hard anti-collapse floor — pushes particles back out if they go deeper than this many px inside a stroke. Prevents medial-axis stacking.'],
            ['wander',         'wander',        0,     25,    0.1,
                'Small per-frame random jitter on velocity. Adds organic breathing to the swarm.'],
            ['farPull',        'far pull',      0,    500,    1,
                'Base force on particles outside the SDF gradient zone, pulling them toward their word centre. Scaled by exp coef / cap below.'],
            ['spread',         'spread',        0,    600,    1,
                'Lateral spring strength toward each particle\'s assigned XY target on the silhouette. Higher = particles cling to their unique spot.'],
            ['expCoef',        'exp coef',      0,   0.03,    0.0001,
                'Exponential growth rate of far-pull vs distance to word centre. Higher = distant particles accelerate dramatically harder.'],
            ['expCap',         'exp cap',       1,    100,    0.5,
                'Upper bound on the exp-multiplier so far-corner particles don\'t fly through the canvas.'],
            ['flow',           'flow',          0,    400,    1,
                'Tangential drift force along the silhouette outline. Keeps settled particles sliding along the strokes instead of freezing.'],
            ['speedJitter',    'speed jitter',  0,      1,    0.01,
                'Per-particle speed multiplier amplitude. 0 = every particle moves identically, 1 = factors span 0.5x..1.5x.'],
        ];
        const styleId = 'hero-dev-panel-style';
        if (!document.getElementById(styleId)) {
            const css = `
                .hero-dev-panel {
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
                .hero-dev-panel::-webkit-scrollbar { width: 6px; }
                .hero-dev-panel::-webkit-scrollbar-track { background: transparent; }
                .hero-dev-panel::-webkit-scrollbar-thumb {
                    background: rgba(255, 75, 31, 0.5); border-radius: 0;
                }
                .hero-dev-panel header {
                    position: sticky; top: 0; z-index: 1;
                    display: flex; justify-content: space-between; align-items: baseline;
                    text-transform: uppercase; letter-spacing: 0.14em;
                    color: var(--accent, #ff4b1f);
                    background: rgba(12, 10, 7, 0.96);
                    border-bottom: 1px solid rgba(255, 75, 31, 0.4);
                    padding: 10px 12px 6px; margin: 0;
                    backdrop-filter: blur(6px);
                }
                .hero-dev-panel header .header-acts {
                    display: inline-flex; gap: 4px;
                }
                .hero-dev-panel header button {
                    background: none; border: 1px solid var(--accent, #ff4b1f);
                    color: var(--accent, #ff4b1f); font: inherit; cursor: pointer;
                    padding: 0 6px; letter-spacing: 0;
                }
                .hero-dev-panel header button:hover {
                    background: var(--accent, #ff4b1f); color: var(--bg, #0c0a07);
                }
                .hero-dev-panel.is-collapsed [data-act="restart"] { display: none; }
                .hero-dev-panel .row { margin: 5px 0; padding: 0 12px; }
                .hero-dev-panel .row:first-of-type { margin-top: 10px; }
                .hero-dev-panel .row:last-of-type { margin-bottom: 12px; }
                .hero-dev-panel .row label {
                    display: flex; justify-content: space-between;
                    text-transform: uppercase; letter-spacing: 0.06em;
                    opacity: 0.75; margin-bottom: 2px;
                }
                .hero-dev-panel .row label .val { color: var(--accent, #ff4b1f); opacity: 1; }
                .hero-dev-panel input[type="range"] { width: 100%; margin: 0; accent-color: var(--accent, #ff4b1f); }
                .hero-dev-panel .dev-select {
                    width: 100%; font: inherit; font-size: 10px;
                    background: rgba(12, 10, 7, 0.9); color: var(--text, #f0ebe0);
                    border: 1px solid rgba(255, 75, 31, 0.4);
                    padding: 3px 6px; letter-spacing: 0.06em;
                }
                .hero-dev-panel .dev-select:focus { outline: 1px solid var(--accent, #ff4b1f); }
                .hero-dev-panel .dev-color {
                    width: 100%; height: 24px; padding: 0; border: 1px solid rgba(255, 75, 31, 0.4);
                    background: rgba(12, 10, 7, 0.9); cursor: pointer;
                }
                .hero-dev-panel .dev-color::-webkit-color-swatch-wrapper { padding: 2px; }
                .hero-dev-panel .dev-color::-webkit-color-swatch { border: none; }
                .hero-dev-panel.is-collapsed .row { display: none; }
            `;
            const styleEl = document.createElement('style');
            styleEl.id = styleId;
            styleEl.textContent = css;
            document.head.appendChild(styleEl);
        }

        const panel = document.createElement('aside');
        panel.className = 'hero-dev-panel';
        panel.innerHTML = `
            <header>
                <span>dev · hero tuning</span>
                <span class="header-acts">
                    <button type="button" data-act="restart" title="Clear all live particles and re-fire the initial burst. Useful when changing a param that only takes effect on spawn.">↻ restart</button>
                    <button type="button" data-act="toggle" title="Collapse the panel">−</button>
                </span>
            </header>
        `;
        const sdf0 = tunedModules[0].sdf;
        const drag0 = tunedModules[0].drag;
        function makeRow(label, value, min, max, step, desc, onChange) {
            const decimals = step < 0.001 ? 4 : step < 0.1 ? 3 : step < 1 ? 1 : 0;
            const row = document.createElement('div');
            row.className = 'row';
            row.title = desc;     // native hover tooltip
            row.innerHTML = `
                <label><span>${label}</span><span class="val">${(+value).toFixed(decimals)}</span></label>
                <input type="range" min="${min}" max="${max}" step="${step}" value="${value}">
            `;
            const input = row.querySelector('input');
            const val   = row.querySelector('.val');
            input.addEventListener('input', () => {
                const v = +input.value;
                val.textContent = v.toFixed(decimals);
                onChange(v);
            });
            return row;
        }
        for (const [field, label, min, max, step, desc] of PARAMS) {
            panel.appendChild(makeRow(label, sdf0.params[field], min, max, step, desc,
                (v) => { for (const t of tunedModules) t.sdf.params[field] = v; }));
        }
        // Drag (separate module — its own coefficient slider).
        panel.appendChild(makeRow('drag', drag0.params.coefficient, 0, 30, 0.1,
            'Velocity damping coefficient. Higher = particles decelerate faster, settle sooner. Lower = more momentum / oscillation.',
            (v) => { for (const t of tunedModules) t.drag.params.coefficient = v; }));

        // Hover-dispersion strength (negative = repulsion). Updates BOTH the
        // saved interaction value (used by the click-restore) AND the live
        // cursor module strength on every emitter.
        panel.appendChild(makeRow('hover disp', Math.abs(interaction.hoverStrength), 0, 12000, 50,
            'Magnitude of the cursor-driven repulsion as the visitor hovers the name. Higher = particles fly further away from the cursor.',
            (v) => {
                interaction.hoverStrength = -v;
                for (const t of tunedModules) t.cursor.params.strength = -v;
            }));
        // Click-explosion strength — only applied for ~80ms on click, so it
        // doesn't bind to a live module param; the click handler reads this.
        panel.appendChild(makeRow('click explode', Math.abs(interaction.clickStrength), 0, 500000, 1000,
            'Magnitude of the one-shot repulsion impulse fired on click. After 80ms the cursor returns to the hover strength above.',
            (v) => { interaction.clickStrength = -v; }));

        // Particle count — mutates each emitter's burst count. Applied at the
        // next restart (click ↻). Caps at 2× the engine's allocated buffer
        // (maxParticles); requesting more is silently dropped by the engine.
        const totalParticles = tunedModules.reduce((sum, t) => sum + (t.emitter.config.bursts[0]?.count || 0), 0);
        panel.appendChild(makeRow('particle count', totalParticles, 1000, maxParticles * 2, 1000,
            'Total particles across both emitters. Mutating this value takes effect on the next ↻ restart — the live swarm keeps its current population until then.',
            (v) => {
                const perEmitter = Math.floor(v / tunedModules.length);
                for (const t of tunedModules) t.emitter.config.bursts[0].count = perEmitter;
            }));
        // Particle size — single slider, applied as a small spread (±20%) so
        // the swarm still has visual texture rather than monodisperse pixels.
        // Takes effect on the next ↻ restart.
        // Recover the centre size from min/max (spawned uniformly in [size×0.7, size×1.1]).
        // The midpoint of [0.7, 1.1] is 0.9, so size ≈ min / 0.7 ≈ max / 1.1.
        const sizeMid0 = tunedModules[0].emitter.config.initial.size.min / 0.7;
        panel.appendChild(makeRow('particle size', sizeMid0, 0.2, 8, 0.05,
            'Centre value for the per-particle radius (px). Engine spawns particles uniformly in [size×0.7, size×1.1]. Applied at the next ↻ restart.',
            (v) => {
                for (const t of tunedModules) {
                    t.emitter.config.initial.size.min = v * 0.7;
                    t.emitter.config.initial.size.max = v * 1.1;
                }
            }));

        // Post-FX chain — bright-pass → N blur passes → additive composite.
        // Lowering threshold toward 0 makes the WHOLE frame contribute to the
        // blur (not just bright pixels), turning the bloom into an ambient
        // atmospheric haze that paints the background with light where the
        // swarm lives. Combine with higher blurPasses + intensity for a
        // strong glow underneath.
        panel.appendChild(makeRow('bloom intensity', postfx.bloomIntensity, 0, 5, 0.01,
            'Multiplier on the bright-pass composite. 0 = no glow; >1 = blown-out trails. Goes through `blur passes` regardless.',
            (v) => { postfx.bloomIntensity = v; }));
        panel.appendChild(makeRow('bloom threshold', postfx.bloomThreshold, 0, 1.5, 0.01,
            'Brightness cutoff for the bright-pass. 0 = entire frame blurs into the bloom (ambient-glow mode); 0.85 = default, only highlights contribute. Drop this for the "lit background" effect.',
            (v) => { postfx.bloomThreshold = v; }));
        panel.appendChild(makeRow('soft knee', postfx.bloomSoftKnee, 0, 1, 0.01,
            'Softness of the threshold rolloff. 0 = hard cutoff (banding); 1 = very smooth transition into the bloom.',
            (v) => { postfx.bloomSoftKnee = v; }));
        panel.appendChild(makeRow('blur passes', postfx.blurPasses, 1, 10, 1,
            'Number of separable blur passes on the bloom texture. More passes = wider, softer glow at a small frame-time cost.',
            (v) => { postfx.blurPasses = v | 0; }));
        panel.appendChild(makeRow('exposure', postfx.exposure, 0.1, 4, 0.01,
            'Final composite exposure multiplier. Photographic stop adjustment; pairs nicely with low bloom threshold + high intensity for an HDR look.',
            (v) => { postfx.exposure = v; }));
        panel.appendChild(makeRow('vignette', postfx.vignette, 0, 1, 0.01,
            'Darkening at the frame edges. 0 = off, 1 = strong corner falloff. Adds focus to the centre when the bloom is wide.',
            (v) => { postfx.vignette = v; }));

        // Background colour — flat clearcolor for the scene texture. Picker
        // is in sRGB hex; values are converted to linear-ish [0..1] for the
        // GPU clear (matches the existing inline default of [0.047, 0.039,
        // 0.027, 1.0] ≈ #0c0a07).
        const bgRow = document.createElement('div');
        bgRow.className = 'row';
        bgRow.title = 'Flat background colour for the canvas. Alpha is forced to 1 so additive-blend trails do not accumulate across frames.';
        const toHex = (rgb) => '#' + rgb.slice(0, 3).map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
        bgRow.innerHTML = `
            <label><span>background</span><span class="val">${toHex(bgColor)}</span></label>
            <input type="color" class="dev-color" value="${toHex(bgColor)}">
        `;
        const bgInput = bgRow.querySelector('.dev-color');
        const bgVal   = bgRow.querySelector('.val');
        bgInput.addEventListener('input', () => {
            const hex = bgInput.value;
            bgColor[0] = parseInt(hex.slice(1, 3), 16) / 255;
            bgColor[1] = parseInt(hex.slice(3, 5), 16) / 255;
            bgColor[2] = parseInt(hex.slice(5, 7), 16) / 255;
            bgVal.textContent = hex;
        });
        panel.appendChild(bgRow);

        // Blend mode selector — particle pipeline picks the appropriate
        // GPU pipeline at draw time based on `ps.blend`, so hot-swap is free.
        // (`additive` glows brightly on the warm background, `alpha` reads
        // softer/photographic, `opaque` flattens to silhouettes.)
        const blendRow = document.createElement('div');
        blendRow.className = 'row';
        blendRow.title = 'Particle blend mode. Hot-swappable — engine has all three pipelines prebuilt and picks per-frame.';
        blendRow.innerHTML = `
            <label><span>blend</span><span class="val">${ps.blend}</span></label>
            <select class="dev-select">
                <option value="additive">additive</option>
                <option value="alpha">alpha</option>
                <option value="opaque">opaque</option>
            </select>
        `;
        const blendSelect = blendRow.querySelector('select');
        blendSelect.value = ps.blend;
        const blendVal = blendRow.querySelector('.val');
        blendSelect.addEventListener('change', () => {
            ps.blend = blendSelect.value;
            blendVal.textContent = blendSelect.value;
        });
        panel.appendChild(blendRow);

        // Read-only FPS readout — no slider, just a live number updated on a
        // setInterval. Polled at 4 Hz; the fps object itself is updated in the
        // render loop with a 500ms rolling window.
        const fpsRow = document.createElement('div');
        fpsRow.className = 'row';
        fpsRow.title = 'Frames per second over a 500 ms rolling window. Read-only.';
        fpsRow.innerHTML = `<label><span>fps</span><span class="val" data-fps>—</span></label>`;
        panel.appendChild(fpsRow);
        const fpsLabel = fpsRow.querySelector('[data-fps]');
        setInterval(() => { fpsLabel.textContent = fps.value > 0 ? fps.value.toFixed(0) : '—'; }, 250);
        panel.querySelector('[data-act="toggle"]').addEventListener('click', () => {
            const isCollapsed = panel.classList.toggle('is-collapsed');
            panel.querySelector('[data-act="toggle"]').textContent = isCollapsed ? '+' : '−';
        });
        panel.querySelector('[data-act="restart"]').addEventListener('click', () => {
            ps.reset();
        });
        document.body.appendChild(panel);
    }

    boot();
})();
