// Hero masthead particle swarm.
// Bootstraps a WebGPU canvas that overlays the H1, attracts particles to a
// baked SDF of the name. Honours prefers-reduced-motion, gracefully falls
// back to the static H1 when WebGPU isn't available or the SDF asset fails.

(() => {
    'use strict';

    const HERO_PARTICLES_DEBUG = false;          // toggle for console logs
    const SDF_PATH = 'assets/hero/name-sdf.png';
    const SDF_META = 'assets/hero/name-sdf.json';
    const SDF_TIMEOUT_MS = 800;
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

        // 1. WebGPU available?
        if (!('gpu' in navigator)) { log('no navigator.gpu'); return; }

        // 2. Reduced motion?
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            log('reduced-motion preferred'); return;
        }

        // 3. Mobile budget (chosen via media query, not UA sniffing).
        const isMobile = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
        const particleCount = isMobile ? PARTICLE_COUNT_MOBILE : PARTICLE_COUNT_DESKTOP;

        // 4. SDF asset load + timeout.
        //    (Adapter/device creation removed — the engine creates its own in
        //     createParticleSystem. We use ps.device after mount to create the
        //     SDF texture on the same GPUDevice. Path 1 from Task 4.4 spec.)
        let sdfImage, sdfMeta;
        try {
            const [imgBlob, metaJson] = await Promise.all([
                withTimeout(fetch(SDF_PATH).then(r => r.ok ? r.blob() : Promise.reject('sdf 404')), SDF_TIMEOUT_MS),
                withTimeout(fetch(SDF_META).then(r => r.ok ? r.json() : Promise.reject('meta 404')), SDF_TIMEOUT_MS),
            ]);
            sdfImage = await createImageBitmap(imgBlob);
            sdfMeta  = metaJson;
        } catch (e) { log('sdf load failed', e); return; }

        // 5. Engine mount.
        const canvas = stage.querySelector('canvas.hero-particles');
        canvas.width  = stage.clientWidth  * (window.devicePixelRatio || 1);
        canvas.height = stage.clientHeight * (window.devicePixelRatio || 1);

        const { createParticleSystem, Emitter, shapes, modules } = await import('./particles/index.js');
        let ps;
        try {
            ps = await createParticleSystem({
                canvas,
                backend: 'webgpu',
                maxParticles: particleCount,
                blend: 'additive',
            });
        } catch (e) { log('createParticleSystem failed', e); return; }

        // Use the engine's own GPUDevice to create the SDF texture so it lands
        // on the same device that the bind group references. (Path 1.)
        const device = ps.device;

        const sdfTexture = device.createTexture({
            size: [sdfImage.width, sdfImage.height, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING
                 | GPUTextureUsage.COPY_DST
                 | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        device.queue.copyExternalImageToTexture(
            { source: sdfImage },
            { texture: sdfTexture },
            { width: sdfImage.width, height: sdfImage.height });

        // Position the SDF text centered horizontally in the canvas, slightly
        // above vertical centre (so it sits where the H1 was, not floating low).
        const SDF_W = sdfImage.width;
        const SDF_H = sdfImage.height;
        const SDF_OFFSET_X = (canvas.width  - SDF_W) / 2;
        const SDF_OFFSET_Y = (canvas.height - SDF_H) / 2;

        // Push the SDF texture + uniforms into the engine's bind group.
        ps.updateSdfTexture(sdfTexture);
        ps.updateSdfUniforms(
            SDF_W, SDF_H, sdfMeta.distance_radius_px,
            SDF_OFFSET_X, SDF_OFFSET_Y);

        // One emitter per name-line, coloured per the type split.
        // Each emitter's spawn region is the FULL CANVAS (not just the half-band)
        // so particles fly in from across the hero, then attract to their SDF region.
        for (const line of sdfMeta.lines) {
            const colorRgba = hexToRgba(line.color, 1.0);
            await ps.addEmitter(new Emitter({
                position: [canvas.width / 2, canvas.height / 2, 0],
                shape: shapes.box({
                    // Spawn across the full canvas, biased toward the line's vertical half.
                    size: [canvas.width, canvas.height / 2, 0],
                }),
                rate: 0,
                bursts: [{ time: 0, count: Math.floor(particleCount / 2) }],
                initial: {
                    lifetime: { min: 10_000, max: 10_000 },
                    speed:    { min: 0, max: 0 },
                    size:     { min: 1.5, max: 2.5 },
                    color:    colorRgba,
                },
                modules: [
                    modules.sdfAttract({ strength: 250, insideRepel: 40, wander: 6 }),
                    modules.drag(0.5),
                ],
            }));
        }

        // Animation loop (idle steady state; Phase 5 adds the coalesce intro).
        const viewProj = mat4Identity();
        let last = performance.now();
        function loop(now) {
            const dt = Math.min(0.05, (now - last) / 1000); last = now;
            ps.update(dt);
            ps.render({ view: viewProj, proj: viewProj, bgColor: [0, 0, 0, 0] });
            requestAnimationFrame(loop);
        }
        stage.classList.remove('is-static');
        stage.classList.add('is-live');
        requestAnimationFrame(loop);

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

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
        ]);
    }

    boot();
})();
