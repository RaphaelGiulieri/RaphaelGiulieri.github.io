// spawn_rng.wgsl — RNG primitives for the GPU spawn pipeline.
// Per-thread state is a u32 seeded from hash(emitter_id, spawn_idx).
// Determinism: same (emitter_id, spawn_idx) → same particle state, run-to-run,
// within one backend. Backend-cross determinism is NOT a goal — WebGL2 uses
// JS rng.js, WebGPU uses this xxhash+LCG. Tests compare distributions.

fn rng_seed(emitter_id: u32, spawn_idx: u32) -> u32 {
  // xxhash32-style mix
  var h = emitter_id ^ 0x9E3779B9u;
  h = h * 0x85EBCA6Bu;
  h = (h << 13u) | (h >> 19u);
  h = h ^ spawn_idx;
  h = h * 0xC2B2AE35u;
  h = (h << 16u) | (h >> 16u);
  return h;
}

fn rng_next(state: ptr<function, u32>) -> u32 {
  // Numerical Recipes LCG: x = x * 1664525 + 1013904223
  let x = (*state) * 1664525u + 1013904223u;
  *state = x;
  return x;
}

fn rng_next_unit(state: ptr<function, u32>) -> f32 {
  // 24-bit mantissa unit float in [0, 1)
  return f32(rng_next(state) >> 8u) * (1.0 / 16777216.0);
}

fn rng_unit_vec(state: ptr<function, u32>) -> vec3<f32> {
  // Marsaglia uniform sphere surface
  let z = rng_next_unit(state) * 2.0 - 1.0;
  let phi = rng_next_unit(state) * 6.283185307179586;
  let r = sqrt(max(0.0, 1.0 - z * z));
  return vec3<f32>(r * cos(phi), r * sin(phi), z);
}

fn rng_inside_disc(state: ptr<function, u32>) -> vec2<f32> {
  let r = sqrt(rng_next_unit(state));
  let a = rng_next_unit(state) * 6.283185307179586;
  return vec2<f32>(r * cos(a), r * sin(a));
}
