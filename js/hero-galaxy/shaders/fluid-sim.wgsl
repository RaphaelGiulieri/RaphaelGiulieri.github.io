// 2D Navier-Stokes-ish fluid sim — semi-Lagrangian advection on a periodic
// (lon) × clamped (lat) grid. One compute pass per active gas giant per
// frame writes the next field into a ping-pong target.
//
// SEAM HANDLING: longitude periodicity handled at integer-texel level via
// modular arithmetic — `sample_full` does its own 4-tap bilinear and never
// touches the sampler. Border cells truly see the opposite border as a
// neighbour, no clamp-to-edge artifacts.
//
// FIELD CONTENT: .xy = velocity (zonal, meridional). .z = passive tracer
// dye carried by the flow. .w reserved.
//
// FORCING: a single continuous gaussian-weighted band centered on the
// equator. forcing_rate × forcing_strength integrates into velocity every
// frame; forcing_rate × tracer_source integrates into dye. Per-cell random
// direction (stable, time-independent) so the result is turbulent rather
// than uniform flow.

struct SimParams {
    dt                : f32,
    time              : f32,
    grid_w            : f32,
    grid_h            : f32,
    viscosity         : f32,    // velocity damping per second (≈ kinematic viscosity for our scale)
    jet_force         : f32,    // zonal-jet restoring torque strength
    advect_mul        : f32,    // backwards-advect step multiplier
    forcing_rate      : f32,    // global rate multiplier on the forcing band
    forcing_strength  : f32,    // velocity perturbation magnitude in the band
    tracer_source     : f32,    // dye source rate in the band
    tracer_decay      : f32,    // dye decay rate per second
    forcing_width     : f32,    // gaussian sigma (uv-space) of the equatorial band
    seed_phase        : f32,    // per-planet phase offset (rotates the random direction field)
    _pad0             : f32,
    _pad1             : f32,
    _pad2             : f32,
};

@group(0) @binding(0) var src_vel  : texture_2d<f32>;
@group(0) @binding(1) var dst_vel  : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params : SimParams;
@group(0) @binding(3) var smp      : sampler;   // unused — kept for BGL compat

// ── Seam-aware 4-tap bilinear ──
// Border cells wrap to the opposite border via integer modulo. Sampler is
// bypassed; everything is `textureLoad` + manual blend.
fn sample_full(uv: vec2<f32>) -> vec4<f32> {
    let gw_i = i32(params.grid_w);
    let gh_i = i32(params.grid_h);
    let tex = uv * vec2<f32>(params.grid_w, params.grid_h) - vec2<f32>(0.5);
    let ix0 = i32(floor(tex.x));
    let iy0 = i32(floor(tex.y));
    let fx  = tex.x - f32(ix0);
    let fy  = tex.y - f32(iy0);
    let x0 = ((ix0 % gw_i) + gw_i) % gw_i;
    let x1 = (((ix0 + 1) % gw_i) + gw_i) % gw_i;
    let y0 = clamp(iy0,     0, gh_i - 1);
    let y1 = clamp(iy0 + 1, 0, gh_i - 1);
    let s00 = textureLoad(src_vel, vec2<i32>(x0, y0), 0);
    let s10 = textureLoad(src_vel, vec2<i32>(x1, y0), 0);
    let s01 = textureLoad(src_vel, vec2<i32>(x0, y1), 0);
    let s11 = textureLoad(src_vel, vec2<i32>(x1, y1), 0);
    let s0  = mix(s00, s10, fx);
    let s1  = mix(s01, s11, fx);
    return mix(s0, s1, fy);
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let gw = u32(params.grid_w);
    let gh = u32(params.grid_h);
    if (gid.x >= gw || gid.y >= gh) { return; }

    // Cell-center uv
    let uv = (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5)
           / vec2<f32>(params.grid_w, params.grid_h);

    // Read full texel (vel + tracer).
    let here   = sample_full(uv);
    let v_here = here.xy;

    // Backwards-trace semi-Lagrangian advection — the upstream uv can land
    // anywhere; sample_full resolves seam wrap + pole clamp.
    let step       = v_here * params.dt * params.advect_mul;
    let prev_uv    = uv - step;
    let upstream   = sample_full(prev_uv);
    let v_advected = upstream.xy;
    let dye_advected = upstream.z;

    // Zonal jets — restore toward an alternating east/west pattern at
    // evenly-spaced latitudes.
    let lat = uv.y * 2.0 - 1.0;
    let jet_target = vec2<f32>(sin(lat * 5.0) * 0.35, 0.0);
    let v_with_jet = mix(v_advected, jet_target, params.jet_force * params.dt);

    // Viscosity (velocity damping).
    let v_damped = v_with_jet * (1.0 - clamp(params.viscosity * params.dt, 0.0, 1.0));

    // Tracer decay.
    let dye_decayed = dye_advected * (1.0 - clamp(params.tracer_decay * params.dt, 0.0, 1.0));

    // ── Continuous equatorial forcing ──
    // One big, constant injection centered on the equator. Per-cell random
    // direction (stable across frames, NOT time-dependent) so the forcing
    // pattern is turbulent rather than uniform flow — but the magnitude is
    // continuous each frame instead of a stochastic per-cell switch (which
    // produced the "swarm of speckles" look). Gaussian latitude weight
    // confines forcing to a band of width forcing_width.
    let lat_norm   = (uv.y - 0.5) * 2.0;                              // -1 (S) … +1 (N)
    let sigma      = max(0.02, params.forcing_width);
    let band       = exp(-(lat_norm * lat_norm) / (2.0 * sigma * sigma));
    let cell_seed  = fract(sin(f32(gid.x) * 12.345
                              + f32(gid.y) * 78.901
                              + params.seed_phase) * 43758.5453);
    let angle      = cell_seed * 6.2831;
    let dir        = vec2<f32>(cos(angle), sin(angle));
    let flux       = params.forcing_rate * params.dt * band;

    let v_out   = v_damped    + dir * params.forcing_strength * flux;
    let dye_out = dye_decayed + params.tracer_source * flux;

    textureStore(dst_vel,
                 vec2<i32>(gid.xy),
                 vec4<f32>(v_out, clamp(dye_out, 0.0, 2.0), 0.0));
}
