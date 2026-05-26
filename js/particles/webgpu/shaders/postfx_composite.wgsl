// postfx_composite.wgsl — vertex + fragment for final composite onto
// swapchain. Reads scene_tex + bloom_tex, mixes with bloom_intensity,
// applies exposure / Reinhard tonemap / vignette / gamma 2.2.

struct Uniforms {
  bloom_intensity: f32,
  exposure:        f32,
  vignette:        f32,
  _pad:            f32,
}
@group(0) @binding(0) var scene_tex:  texture_2d<f32>;
@group(0) @binding(1) var bloom_tex:  texture_2d<f32>;
@group(0) @binding(2) var samp:       sampler;
@group(0) @binding(3) var<uniform> u: Uniforms;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VOut {
  // Fullscreen triangle (3 vertices covering NDC [-1,3]).
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0));
  let p = positions[vi];
  var o: VOut;
  o.pos = vec4<f32>(p, 0.0, 1.0);
  // uv in [0,1]. Y is flipped because WebGPU clip-space Y is up while
  // texture-space Y is down.
  o.uv = vec2<f32>(p.x * 0.5 + 0.5, 1.0 - (p.y * 0.5 + 0.5));
  return o;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  var c = textureSample(scene_tex, samp, in.uv).rgb;
  c = c + textureSample(bloom_tex, samp, in.uv).rgb * u.bloom_intensity;
  c = c * u.exposure;
  c = c / (vec3<f32>(1.0) + c);                 // Reinhard
  let r = in.uv - vec2<f32>(0.5);
  c = c * (1.0 - u.vignette * dot(r, r) * 4.0);
  c = pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2));
  return vec4<f32>(c, 1.0);
}
