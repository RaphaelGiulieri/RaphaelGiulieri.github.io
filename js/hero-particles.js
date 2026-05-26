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
        // Wait a frame so flex layout has settled and stage.clientWidth/Height
        // reflect the final box — otherwise we get e.g. 830×442 when the stage
        // actually ends up 1384×471.
        await new Promise((r) => requestAnimationFrame(r));
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

        // Stretch the SDF to fill ~92% of the canvas width while preserving its
        // native 4:1 aspect (1024×256). The SDF radius is also scaled proportionally
        // so the attraction falloff stays consistent with the visual scale.
        const NATIVE_SDF_W = sdfImage.width;
        const NATIVE_SDF_H = sdfImage.height;
        const SDF_W = canvas.width * 0.92;
        const SDF_SCALE = SDF_W / NATIVE_SDF_W;
        const SDF_H = NATIVE_SDF_H * SDF_SCALE;
        const SDF_OFFSET_X = (canvas.width  - SDF_W) / 2;
        const SDF_OFFSET_Y = (canvas.height - SDF_H) / 2;
        const SDF_RADIUS_SCALED = sdfMeta.distance_radius_px * SDF_SCALE;

        // Push the SDF texture + uniforms into the engine's bind group.
        ps.updateSdfTexture(sdfTexture);
        ps.updateSdfUniforms(
            SDF_W, SDF_H, SDF_RADIUS_SCALED,
            SDF_OFFSET_X, SDF_OFFSET_Y);

        // One emitter per name-line. Spawn area is INSIDE the SDF region — going
        // outside makes particles sample the clamped-edge of the SDF texture
        // where the gradient is degenerate (causes vertical streaking artifacts).
        // Negative margin keeps the spawn strictly within the SDF box.
        const SPAWN_INSET = 30;   // px inset from the SDF boundary
        for (let lineIdx = 0; lineIdx < sdfMeta.lines.length; lineIdx++) {
            const line = sdfMeta.lines[lineIdx];
            const colorRgba = hexToRgba(line.color, 1.0);
            const lineYTop    = SDF_OFFSET_Y + (lineIdx === 0 ? 0 : SDF_H / 2);
            const lineYBottom = SDF_OFFSET_Y + (lineIdx === 0 ? SDF_H / 2 : SDF_H);
            const cx = canvas.width / 2;
            const cy = (lineYTop + lineYBottom) / 2;
            const spawnW = Math.max(50, SDF_W - 2 * SPAWN_INSET);
            const spawnH = Math.max(50, (lineYBottom - lineYTop) - 2 * SPAWN_INSET);
            await ps.addEmitter(new Emitter({
                position: [cx, cy, 0],
                shape: shapes.box({ size: [spawnW, spawnH, 0] }),
                rate: 0,
                bursts: [{ time: 0, count: Math.floor(particleCount / 2) }],
                initial: {
                    lifetime: { min: 10_000, max: 10_000 },
                    speed:    { min: 0, max: 0 },
                    size:     { min: 1.2, max: 2.0 },
                    color:    colorRgba,
                },
                modules: [
                    modules.sdfAttract({ strength: 100, insideRepel: 80, wander: 8 }),
                    modules.drag(4.0),
                ],
            }));
        }

        // Animation loop (idle steady state; Phase 5 adds the coalesce intro).
        // Projection maps canvas-pixel coordinates (0..w, 0..h with y-down) to
        // WebGPU NDC (-1..1 with y-up). Without this, identity matrices leave
        // pixel-space particles miles outside the clip volume — the few that
        // survive render as massive blobs.
        const view = mat4Identity();
        const proj = mat4OrthoPixels(canvas.width, canvas.height);
        let last = performance.now();
        function loop(now) {
            const dt = Math.min(0.05, (now - last) / 1000); last = now;
            ps.update(dt);
            // Opaque dark clear matching the page background colour so the canvas
            // is indistinguishable from the section behind it. Alpha=0 here would
            // leave the previous frame on screen and additively accumulate trails.
            ps.render({ view, proj, bgColor: [0.047, 0.039, 0.027, 1] });
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

    boot();
})();
