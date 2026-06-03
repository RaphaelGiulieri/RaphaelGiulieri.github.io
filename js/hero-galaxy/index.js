// Hero galaxy entry point — gates WebGPU / reduced-motion / data availability,
// then mounts the 3D scene. Falls back to the editorial H1 + tagline + disciplines
// block (via .is-fallback) on any failure or unsupported configuration.

(() => {
    'use strict';

    const HERO_GALAXY_DEBUG = false;
    const log = (...a) => { if (HERO_GALAXY_DEBUG) console.log('[hero-galaxy]', ...a); };

    async function boot() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot, { once: true });
            return;
        }

        const section = document.querySelector('.hero-galaxy');
        if (!section) { log('no .hero-galaxy section'); return; }

        const showFallback = () => section.classList.add('is-fallback');

        // Gate 1 — WebGPU available?
        if (!('gpu' in navigator)) { log('no navigator.gpu'); showFallback(); return; }

        // Gate 2 — Reduced motion?
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            log('reduced-motion preferred'); showFallback(); return;
        }

        // Gate 3 — Engine + scene modules import OK?
        let mountScene;
        try {
            ({ mountScene } = await import('./scene.js'));
        } catch (e) {
            log('module import failed', e); showFallback(); return;
        }

        // Gate 4 — Scene mount OK?
        try {
            await mountScene({ section });
        } catch (e) {
            log('scene mount failed', e); showFallback(); return;
        }

        log('galaxy mounted');
    }

    boot();
})();
