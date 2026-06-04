// DOM event wiring → camera state. Owns the per-state zoom clamps and
// inertia. Touch is handled symmetrically to mouse (one-finger drag = orbit,
// pinch = zoom).

import { applyOrbitDelta, applyZoomDelta } from './camera.js';

const ZOOM_CLAMPS = {
    galaxy:  { min: 45, max: 260 },
    system:  { min: 12, max: 70  },
    planet:  { min: 3,  max: 16  },
};

export function wireControls({ canvas, camera, getState, onInput }) {
    let dragging = false;
    let lastX = 0, lastY = 0;
    let velYaw = 0, velPitch = 0;

    function onPointerDown(e) {
        if (e.button !== undefined && e.button !== 0 && e.button !== 1) return;
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        velYaw = 0; velPitch = 0;
        canvas.setPointerCapture?.(e.pointerId ?? 1);
        onInput?.();
    }
    function onPointerMove(e) {
        if (!dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        const yaw = -dx * 0.005;
        const pit = -dy * 0.005;
        applyOrbitDelta(camera, yaw, pit);
        velYaw = yaw * 0.5; velPitch = pit * 0.5;
    }
    function onPointerUp(e) {
        dragging = false;
        canvas.releasePointerCapture?.(e.pointerId ?? 1);
    }
    function onWheel(e) {
        const stateLevel = getState();
        const c = ZOOM_CLAMPS[stateLevel] ?? { min: 1, max: 200 };
        // At galaxy view, when already pinned at the max zoom-out distance
        // and the wheel direction is "further out", do NOT intercept — let
        // the browser scroll the page so visitors can reach the sections
        // below the hero. Any other case (zooming in, or any non-galaxy
        // state) keeps the wheel for camera control.
        if (stateLevel === 'galaxy' && e.deltaY > 0 && camera.distance >= c.max - 0.01) {
            return;
        }
        e.preventDefault();
        const factor = Math.pow(1.0015, e.deltaY);
        applyZoomDelta(camera, factor, c.min, c.max);
        onInput?.();
    }

    // Touch pinch-zoom: track two-finger distance
    let pinchDist = 0;
    function onTouchStart(e) {
        if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            pinchDist = Math.hypot(dx, dy);
            dragging = false;
        }
    }
    function onTouchMove(e) {
        if (e.touches.length === 2 && pinchDist > 0) {
            e.preventDefault();
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const d = Math.hypot(dx, dy);
            const ratio = pinchDist / Math.max(d, 1);
            const c = ZOOM_CLAMPS[getState()] ?? { min: 1, max: 200 };
            applyZoomDelta(camera, ratio, c.min, c.max);
            pinchDist = d;
            onInput?.();
        }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup',   onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });

    function tickInertia(dt) {
        if (dragging) return;
        if (Math.abs(velYaw) < 1e-5 && Math.abs(velPitch) < 1e-5) return;
        applyOrbitDelta(camera, velYaw, velPitch);
        const decay = Math.exp(-3.0 * dt);
        velYaw *= decay; velPitch *= decay;
    }

    return { tickInertia };
}
