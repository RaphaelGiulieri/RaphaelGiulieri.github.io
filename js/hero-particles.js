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

        // 4. Adapter + device.
        let adapter, device;
        try {
            adapter = await navigator.gpu.requestAdapter();
            if (!adapter) { log('no adapter'); return; }
            device = await adapter.requestDevice();
            if (!device) { log('no device'); return; }
        } catch (e) { log('adapter/device fail', e); return; }

        // 5. SDF asset load + timeout.
        let sdfImage, sdfMeta;
        try {
            const [imgBlob, metaJson] = await Promise.all([
                withTimeout(fetch(SDF_PATH).then(r => r.ok ? r.blob() : Promise.reject('sdf 404')), SDF_TIMEOUT_MS),
                withTimeout(fetch(SDF_META).then(r => r.ok ? r.json() : Promise.reject('meta 404')), SDF_TIMEOUT_MS),
            ]);
            sdfImage = await createImageBitmap(imgBlob);
            sdfMeta  = metaJson;
        } catch (e) { log('sdf load failed', e); return; }

        // 6. Engine mount happens in Task 4.4. For now, just flip state class so we can
        //    confirm the detection path works visually.
        log('detection passed', { particleCount, sdfMeta });
        stage.classList.remove('is-static');
        stage.classList.add('is-live');   // (skips coalesce for now; Phase 5 adds it)
        // Phase 4.4 fills in the actual engine mount here.
    }

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
        ]);
    }

    boot();
})();
