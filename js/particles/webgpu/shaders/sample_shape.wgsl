// sample_shape.wgsl — port of particles/core/shapes.js to WGSL.
// Called from cs_spawn. Writes spawn position + initial direction.
// Geometric data lives in shape_params (vec4); initial-direction overrides
// (for line/disc and explicit direction modes) live in spawn.direction_axis.

fn sample_shape(shape_id: u32, params: vec4<f32>,
                state: ptr<function, u32>,
                out_pos: ptr<function, vec3<f32>>,
                out_dir: ptr<function, vec3<f32>>) {
  switch (shape_id) {
    case 0u: {
      // point
      *out_pos = vec3<f32>(0.0);
      *out_dir = vec3<f32>(0.0, 1.0, 0.0);
    }
    case 1u: {
      // sphere: params.x = radius, params.y = surface (0/1)
      let z = rng_next_unit(state) * 2.0 - 1.0;
      let phi = rng_next_unit(state) * 6.283185307179586;
      let s = sqrt(max(0.0, 1.0 - z * z));
      let dir = vec3<f32>(s * cos(phi), s * sin(phi), z);
      let surface = params.y > 0.5;
      let u = rng_next_unit(state);
      let r_vol = pow(u, 1.0/3.0) * params.x;
      let r = select(r_vol, params.x, surface);
      *out_pos = dir * r;
      *out_dir = dir;
    }
    case 3u: {
      // box: params.xyz = (sx, sy, sz)
      *out_pos = vec3<f32>(
        (rng_next_unit(state) - 0.5) * params.x,
        (rng_next_unit(state) - 0.5) * params.y,
        (rng_next_unit(state) - 0.5) * params.z);
      *out_dir = vec3<f32>(0.0, 1.0, 0.0);
    }
    case 4u: {
      // ring: params = (radius, thickness, height, _)
      let a = rng_next_unit(state) * 6.283185307179586;
      let r_off = select(0.0, (rng_next_unit(state) - 0.5) * params.y, params.y > 0.0);
      let r = params.x + r_off;
      let x = cos(a) * r;
      let z = sin(a) * r;
      *out_pos = vec3<f32>(x, (rng_next_unit(state) - 0.5) * params.z, z);
      let len = max(1e-6, length(vec2<f32>(x, z)));
      *out_dir = vec3<f32>(x / len, 0.0, z / len);
    }
    case 5u: {
      // line: params.xyz = axis, params.w = length
      let t = (rng_next_unit(state) - 0.5) * params.w;
      *out_pos = params.xyz * t;
      *out_dir = vec3<f32>(0.0, 1.0, 0.0);
    }
    case 6u: {
      // disc: params.x = radius
      let p2 = rng_inside_disc(state) * params.x;
      *out_pos = vec3<f32>(p2.x, 0.0, p2.y);
      *out_dir = vec3<f32>(0.0, 1.0, 0.0);
    }
    case 2u: {
      // cone: params.x = radius, params.y = halfAngle
      let a_c = rng_next_unit(state) * 6.283185307179586;
      let r_c = sqrt(rng_next_unit(state)) * params.x;
      *out_pos = vec3<f32>(cos(a_c) * r_c, 0.0, sin(a_c) * r_c);
      let cosHA = cos(params.y);
      let cosT = 1.0 - rng_next_unit(state) * (1.0 - cosHA);
      let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
      let phi_c = rng_next_unit(state) * 6.283185307179586;
      *out_dir = vec3<f32>(sinT * cos(phi_c), cosT, sinT * sin(phi_c));
    }
    default: {
      *out_pos = vec3<f32>(0.0);
      *out_dir = vec3<f32>(0.0, 1.0, 0.0);
    }
  }
}
