// index.js — public API facade for the particle system.
//
// Phase 7 (decommission WebGL2): WebGPU is the only backend now. The
// `webgl2/` directory + dual-backend selector logic is gone. Browsers
// without WebGPU support (Firefox without flag, older Safari) get a
// clear error rather than a silent fallback.

export async function createParticleSystem(opts = {}) {
  const backend = opts.backend ?? 'webgpu';
  // 'auto' kept as alias for backwards compat with existing callsites
  // (demo URL handler, headless.html). All paths resolve to WebGPU.
  if (backend !== 'auto' && backend !== 'webgpu') {
    if (backend === 'webgl2') {
      throw new Error(
        "createParticleSystem: backend 'webgl2' was removed in Phase 7. " +
        "Use 'webgpu' or 'auto' (which resolves to webgpu)."
      );
    }
    throw new Error(`createParticleSystem: unknown backend "${backend}". Use 'webgpu' or 'auto'.`);
  }
  if (!('gpu' in navigator)) {
    throw new Error(
      'WebGPU not available: navigator.gpu is missing. Need Chrome 113+, ' +
      'Edge, Safari 17.4+, or Firefox with dom.webgpu.enabled=true in about:config.'
    );
  }
  const m = await import('./webgpu/system.js');
  return await m.createWebGPUSystem(opts);
}

export { Emitter } from './core/emitter.js';

// ---- Core (backend-agnostic) ---------------------------------------------
export { RNG } from './core/rng.js';
export * as shapes from './core/shapes.js';
export { SHAPE_FACTORIES } from './core/shapes.js';
export * as modules from './core/modules.js';
export { set, mul, add, MODULE_DEFS } from './core/modules.js';
export { Curve, Gradient } from './core/curves.js';
export * from './core/bound.js';
export * as math from './core/math.js';
export { mat4LookAt, mat4Perspective } from './core/math.js';
export { PRESETS, buildPreset } from './core/presets.js';
// export { AudioFeed } from './core/audio.js'; // dropped: audio.js not vendored into portfolio
export { gradientPicker, curvePicker } from './core/pickers.js';
