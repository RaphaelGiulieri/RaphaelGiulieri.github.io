// postfx_blur.wgsl — separable 9-tap Gaussian blur.
// Direction (1,0) horizontal pass, (0,1) vertical pass — same shader,
// different uniform. Pre-computed weights match the WebGL2 reference
// (sigma ≈ 3.0).

struct Uniforms {
  texel: vec2<f32>,    // 1.0 / textureDimensions(src)
  dir:   vec2<f32>,    // (1,0) or (0,1)
}
@group(0) @binding(0) var src_tex:  texture_2d<f32>;
@group(0) @binding(1) var src_samp: sampler;
@group(0) @binding(2) var dst:      texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> u: Uniforms;

@compute @workgroup_size(8, 8)
fn cs_blur(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dims = textureDimensions(dst);
  if (gid.x >= dims.x || gid.y >= dims.y) { return; }
  let uv = (vec2<f32>(gid.xy) + vec2<f32>(0.5)) / vec2<f32>(dims);
  let w0 = 0.227027;
  let w1 = 0.194595;
  let w2 = 0.121622;
  let w3 = 0.054054;
  let w4 = 0.016216;
  var sum = textureSampleLevel(src_tex, src_samp, uv, 0.0).rgb * w0;
  let o1 = u.dir * u.texel * 1.0;
  let o2 = u.dir * u.texel * 2.0;
  let o3 = u.dir * u.texel * 3.0;
  let o4 = u.dir * u.texel * 4.0;
  sum = sum + textureSampleLevel(src_tex, src_samp, uv + o1, 0.0).rgb * w1;
  sum = sum + textureSampleLevel(src_tex, src_samp, uv - o1, 0.0).rgb * w1;
  sum = sum + textureSampleLevel(src_tex, src_samp, uv + o2, 0.0).rgb * w2;
  sum = sum + textureSampleLevel(src_tex, src_samp, uv - o2, 0.0).rgb * w2;
  sum = sum + textureSampleLevel(src_tex, src_samp, uv + o3, 0.0).rgb * w3;
  sum = sum + textureSampleLevel(src_tex, src_samp, uv - o3, 0.0).rgb * w3;
  sum = sum + textureSampleLevel(src_tex, src_samp, uv + o4, 0.0).rgb * w4;
  sum = sum + textureSampleLevel(src_tex, src_samp, uv - o4, 0.0).rgb * w4;
  textureStore(dst, vec2<i32>(gid.xy), vec4<f32>(sum, 1.0));
}
