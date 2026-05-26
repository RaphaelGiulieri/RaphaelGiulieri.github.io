// direction_override.wgsl — port of webgl2/emitter.js applyDirectionOverride.
// Mode 0 = no override (out_dir untouched). 1 = outward. 2 = inward.
// 3 = fixed-vector (axis is the unit direction). 4 = cone-axis (random within
// half_angle of axis). Concatenated above cs_spawn at codegen time.

fn apply_direction_override(mode: u32, axis: vec3<f32>, half_angle: f32,
                             state: ptr<function, u32>, pos: vec3<f32>,
                             out_dir: ptr<function, vec3<f32>>) {
  switch (mode) {
    case 1u: {
      let len = length(pos);
      if (len > 1e-6) { *out_dir = pos / len; }
    }
    case 2u: {
      let len = length(pos);
      if (len > 1e-6) { *out_dir = -pos / len; }
    }
    case 3u: {
      *out_dir = axis;
    }
    case 4u: {
      let cosHA = cos(half_angle);
      let cosT = 1.0 - rng_next_unit(state) * (1.0 - cosHA);
      let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
      let phi = rng_next_unit(state) * 6.283185307179586;
      // Perpendicular basis (r, s, axis) — JS branches on |axis.y| < 0.99.
      var r: vec3<f32>;
      if (abs(axis.y) < 0.99) {
        r = vec3<f32>(axis.z, 0.0, -axis.x);
      } else {
        r = vec3<f32>(-axis.y, axis.x, 0.0);
      }
      r = normalize(r);
      let s = cross(axis, r);
      let cp = cos(phi);
      let sp = sin(phi);
      *out_dir = sinT * (cp * r + sp * s) + cosT * axis;
    }
    default: {
      // mode 0 — no override; out_dir untouched
    }
  }
}
