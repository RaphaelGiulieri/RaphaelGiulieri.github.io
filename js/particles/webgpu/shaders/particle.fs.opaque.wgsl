// particle.fs.opaque.wgsl — Solid-color fragment shader for opaque/perf-test mode.
// No discard, no shape mask, no premultiplied-alpha math: just emit the particle's
// color. Combined with depth-test + depth-write in the opaque render pipeline,
// this lets the GPU perform early-Z and reject most overlapping fragments before
// the shader runs.
//
// Visually different from particle.fs.wgsl (squares not soft circles), which is
// the deliberate trade-off when the user picks 'opaque' from the blend dropdown
// to assess actual GPU compute cost without overdraw dominating.

@fragment
fn fs_main(
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
) -> @location(0) vec4<f32> {
    return color;
}
