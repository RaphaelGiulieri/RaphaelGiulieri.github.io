// particle.fs.wgsl — Soft-circle radial falloff. WGSL port of particle.frag.glsl.
// Output is premultiplied-alpha so the pipeline blend state composites correctly.

@fragment
fn fs_main(
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
) -> @location(0) vec4<f32> {
    let r2 = dot(uv, uv);
    if (r2 > 1.0) { discard; }
    let core = 1.0 - smoothstep(0.0, 0.30, r2);
    let halo = 1.0 - smoothstep(0.20, 1.0, r2);
    let shape = core * 1.0 + halo * 0.45;
    return vec4<f32>(color.rgb * shape, color.a * shape);
}
