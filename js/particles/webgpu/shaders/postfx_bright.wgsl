// postfx_bright.wgsl — soft-knee bright pass for bloom.
// Reads HDR scene, writes pixels above threshold (with knee falloff)
// into the half-res storage texture that blur reads from.

struct Uniforms {
  threshold: f32,
  soft_knee: f32,
  _pad0: f32,
  _pad1: f32,
}
@group(0) @binding(0) var scene_tex:  texture_2d<f32>;
@group(0) @binding(1) var scene_samp: sampler;
@group(0) @binding(2) var bright_out: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> u:  Uniforms;

@compute @workgroup_size(8, 8)
fn cs_bright(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(bright_out);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5)) / vec2<f32>(dims);
  let c = textureSampleLevel(scene_tex, scene_samp, uv, 0.0).rgb;
  let lum = max(c.r, max(c.g, c.b));
  let knee = u.threshold * u.soft_knee + 1e-5;
  let soft_raw = clamp(lum - u.threshold + knee, 0.0, 2.0 * knee);
  let soft = soft_raw * soft_raw / (4.0 * knee);
  let contrib = max(soft, lum - u.threshold) / max(lum, 1e-5);
  textureStore(bright_out, vec2<i32>(gid.xy), vec4<f32>(c * contrib, 1.0));
}
