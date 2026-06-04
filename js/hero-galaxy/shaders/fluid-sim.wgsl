// 2D fluid sim — backwards-traced semi-Lagrangian advection on a periodic
// (lon) × clamped (lat) grid. One compute pass per active gas giant per
// frame writes the next velocity field into a ping-pong target.
//
// The grid is laid out in equirectangular (lon, lat) so:
//   • x wraps at the seam (handled here via fract on the sample uv)
//   • y is clamped at the poles (no flow through the polar caps)
//
// Pressure projection is intentionally skipped in v1 — the band-restoring
// torque + damping below keep the field stable on a multi-minute timescale.
// If we ever need genuine incompressibility we add a divergence pass + a
// Jacobi pressure pass + a gradient-subtract pass, all separately scheduled.

struct SimParams {
    dt          : f32,
    time        : f32,
    grid_w      : f32,
    grid_h      : f32,
    damping     : f32,
    band_force  : f32,
    advect_mul  : f32,
    _pad        : f32,
};

@group(0) @binding(0) var src_vel  : texture_2d<f32>;
@group(0) @binding(1) var dst_vel  : texture_storage_2d<rg32float, write>;
@group(0) @binding(2) var<uniform> params : SimParams;
@group(0) @binding(3) var smp      : sampler;

fn wrap_uv(uv: vec2<f32>) -> vec2<f32> {
    // Periodic in x (longitude), clamped in y (latitude).
    return vec2<f32>(fract(uv.x + 1.0), clamp(uv.y, 0.0001, 0.9999));
}

fn sample_v(uv: vec2<f32>) -> vec2<f32> {
    return textureSampleLevel(src_vel, smp, wrap_uv(uv), 0.0).xy;
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let gw = u32(params.grid_w);
    let gh = u32(params.grid_h);
    if (gid.x >= gw || gid.y >= gh) { return; }

    // Cell-center UV
    let uv = (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5)
           / vec2<f32>(params.grid_w, params.grid_h);

    // Read current velocity at this cell.
    let v_here = sample_v(uv);

    // Backwards-trace semi-Lagrangian advection — sample velocity at the
    // upstream cell so the field gets carried by itself. Scale by advect_mul
    // so the user can dial sim speed independent of frame dt.
    let step = v_here * params.dt * params.advect_mul;
    let prev_uv = uv - step;
    let v_advected = sample_v(prev_uv);

    // Banded zonal jets — restore toward an alternating east/west wind
    // pattern at evenly-spaced latitudes. This is the "Coriolis + thermal
    // gradient" forcing that drives Jupiter's bands in real life, expressed
    // here as a simple per-latitude target field.
    let lat = uv.y * 2.0 - 1.0;                       // -1 (south pole) … 1 (north pole)
    let band_idx = sin(lat * 22.0);                   // alternating jet directions
    let target = vec2<f32>(band_idx * 0.6, 0.0);
    let v_with_band = mix(v_advected, target, params.band_force * params.dt);

    // Light damping — bleeds off the turbulent component over time without
    // destroying the steady banded pattern.
    let v_out = v_with_band * (1.0 - params.damping * params.dt);

    textureStore(dst_vel, vec2<i32>(gid.xy), vec4<f32>(v_out, 0.0, 1.0));
}
