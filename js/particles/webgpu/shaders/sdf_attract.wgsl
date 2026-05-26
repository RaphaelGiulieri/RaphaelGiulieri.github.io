// sdf_attract — per-particle force toward the SDF zero-isoline.
// Reads `sdf_tex` + `sdf_sampler` declared in eval_bound.wgsl at
// @group(2) bindings 4-6 (SDF binding strategy from Task 3.1/3.2).
// Module params (passed via paramRefs from JS):
//   strength       : f32  — peak acceleration magnitude (px/s²)
//   insideRepel    : f32  — small anti-collapse repulsion when SDF<0
//   wander         : f32  — random noise amplitude when settled
//
// Also inlined as a JS template literal in core/modules.js — keep both in sync.
// Variables available in the [forces-add] marker scope (from update.template.wgsl):
//   p        : Particle (var, read-write)
//   i        : u32 (particle index = gid.x)
//   accel    : vec3<f32> (var, accumulated acceleration)
//   u        : Uniforms (uniform — u.time, u.dt, etc.)
{
  let xy = vec2<f32>(p.pos.x, p.pos.y);
  let d  = sample_sdf(xy);
  // Numerical gradient — central differences, 1 px step.
  let dx = sample_sdf(xy + vec2<f32>(1.0, 0.0)) - sample_sdf(xy - vec2<f32>(1.0, 0.0));
  let dy = sample_sdf(xy + vec2<f32>(0.0, 1.0)) - sample_sdf(xy - vec2<f32>(0.0, 1.0));
  let grad = vec2<f32>(dx, dy) * 0.5;
  let grad_len = max(length(grad), 0.0001);
  let dir = -grad / grad_len;  // inward when outside, outward when inside

  let strength     = module_params.STRENGTH_REF_PLACEHOLDER;
  let inside_repel = module_params.INSIDE_REPEL_REF_PLACEHOLDER;
  let wander       = module_params.WANDER_REF_PLACEHOLDER;

  // Attraction force: scales with distance, saturates softly.
  let attract_mag = strength * tanh(abs(d) * 0.05);
  accel.x = accel.x + dir.x * attract_mag;
  accel.y = accel.y + dir.y * attract_mag;

  // Anti-collapse: small outward push when deep inside the text body.
  if (d < -2.0) {
    let push = inside_repel * (-d * 0.05);
    accel.x = accel.x + (-dir.x) * push;
    accel.y = accel.y + (-dir.y) * push;
  }

  // Wander noise — cheap hash on particle index + time.
  let h  = fract(sin(f32(i) * 12.9898 + u.time * 7.7)  * 43758.5453);
  let h2 = fract(sin(f32(i) * 78.233  + u.time * 11.3) * 43758.5453);
  accel.x = accel.x + (h  - 0.5) * wander;
  accel.y = accel.y + (h2 - 0.5) * wander;
}
