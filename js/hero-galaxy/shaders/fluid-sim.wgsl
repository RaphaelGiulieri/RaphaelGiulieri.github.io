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
    dt              : f32,
    time            : f32,
    grid_w          : f32,
    grid_h          : f32,
    damping         : f32,
    band_force      : f32,
    advect_mul      : f32,
    dye_restore     : f32,    // rate at which dye is pulled back toward seed pattern
    vortex_rate     : f32,    // per-frame probability of vortex injection at a cell
    vortex_strength : f32,    // magnitude of injected vortex velocity
    seed_phase      : f32,    // per-planet phase offset matching the JS seed
    _pad            : f32,
};

@group(0) @binding(0) var src_vel  : texture_2d<f32>;
@group(0) @binding(1) var dst_vel  : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params : SimParams;
@group(0) @binding(3) var smp      : sampler;

// ── Procedural seed dye, recomputed each frame so we can continuously
// reinject contrast into the dye field as it advects + blends. Mirrors the
// JS seed in fluid-sim.js exactly so the on-frame and pre-loaded fields
// match.
fn fs_hash3(p: vec3<f32>) -> f32 {
    let s = sin(p.x * 12.9898 + p.y * 78.233 + p.z * 37.719) * 43758.5453;
    return s - floor(s);
}
fn fs_noise(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let c000 = fs_hash3(i + vec3<f32>(0.0, 0.0, 0.0));
    let c100 = fs_hash3(i + vec3<f32>(1.0, 0.0, 0.0));
    let c010 = fs_hash3(i + vec3<f32>(0.0, 1.0, 0.0));
    let c110 = fs_hash3(i + vec3<f32>(1.0, 1.0, 0.0));
    let c001 = fs_hash3(i + vec3<f32>(0.0, 0.0, 1.0));
    let c101 = fs_hash3(i + vec3<f32>(1.0, 0.0, 1.0));
    let c011 = fs_hash3(i + vec3<f32>(0.0, 1.0, 1.0));
    let c111 = fs_hash3(i + vec3<f32>(1.0, 1.0, 1.0));
    let x00 = mix(c000, c100, u.x);
    let x10 = mix(c010, c110, u.x);
    let x01 = mix(c001, c101, u.x);
    let x11 = mix(c011, c111, u.x);
    return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
fn fs_fbm(p: vec3<f32>, octaves: i32) -> f32 {
    var v = 0.0;
    var a = 0.5;
    var f = 1.0;
    for (var i = 0; i < octaves; i = i + 1) {
        v = v + a * fs_noise(p * f);
        f = f * 2.03;
        a = a * 0.55;
    }
    return v;
}

fn wrap_uv(uv: vec2<f32>) -> vec2<f32> {
    // Periodic in x (longitude), clamped in y (latitude).
    return vec2<f32>(fract(uv.x + 1.0), clamp(uv.y, 0.0001, 0.9999));
}

fn sample_v(uv: vec2<f32>) -> vec2<f32> {
    return textureSampleLevel(src_vel, smp, wrap_uv(uv), 0.0).xy;
}

// .xy of the texture holds velocity. .z holds a passive dye field that's
// carried by the flow — initialised with a marbled noise pattern that has
// lon variation, so when the sim runs the dye drifts visibly east/west
// even when the velocity field is otherwise symmetric in lon. .w reserved.
fn sample_full(uv: vec2<f32>) -> vec4<f32> {
    return textureSampleLevel(src_vel, smp, wrap_uv(uv), 0.0);
}

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let gw = u32(params.grid_w);
    let gh = u32(params.grid_h);
    if (gid.x >= gw || gid.y >= gh) { return; }

    // Cell-center UV
    let uv = (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5)
           / vec2<f32>(params.grid_w, params.grid_h);

    // Read full texel (vel + dye).
    let here = sample_full(uv);
    let v_here = here.xy;

    // Backwards-trace semi-Lagrangian advection — sample velocity at the
    // upstream cell so the field gets carried by itself. Scale by advect_mul
    // so the user can dial sim speed independent of frame dt.
    let step = v_here * params.dt * params.advect_mul;
    let prev_uv = uv - step;
    let upstream = sample_full(prev_uv);
    let v_advected = upstream.xy;
    let dye_advected = upstream.z;

    // Banded zonal jets — restore toward an alternating east/west wind
    // pattern at evenly-spaced latitudes. (`target` is a reserved WGSL
    // keyword so we call it `band_target` here.)
    // Five major zonal jets across the planet (matches the visualisation
    // band-modulation frequency). Lower amplitude than the v1 22-band
    // version so the dye dominates the look.
    let lat = uv.y * 2.0 - 1.0;
    let band_idx = sin(lat * 5.0);
    let band_target = vec2<f32>(band_idx * 0.35, 0.0);
    let v_with_band = mix(v_advected, band_target, params.band_force * params.dt);

    // Light damping — bleeds off the turbulent component without destroying
    // the steady banded pattern.
    let v_out = v_with_band * (1.0 - params.damping * params.dt);

    // Dye restoration — continuously pull each cell back toward a fresh
    // procedural fbm seed at a tunable rate. Without this the dye mixes to
    // grey within ~30s (a property of pure semi-Lagrangian advection on a
    // periodic grid). Sampling the same noise function the JS seed used
    // means the equilibrium pattern matches the on-load look.
    let sphere_x = cos(uv.x * 6.2831) * sqrt(max(0.0, 1.0 - lat * lat));
    let sphere_y = lat;
    let sphere_z = sin(uv.x * 6.2831) * sqrt(max(0.0, 1.0 - lat * lat));
    let seed_dye = fs_fbm(vec3<f32>(sphere_x * 2.4 + params.seed_phase,
                                    sphere_y * 2.4,
                                    sphere_z * 2.4 - params.seed_phase), 5);
    let dye_out = mix(dye_advected, seed_dye, clamp(params.dye_restore * params.dt, 0.0, 1.0));

    // Vortex injection — random rotational impulses sprinkled across the
    // grid every frame so the velocity field never collapses to laminar
    // banded steady-state. Rate × dt × cell_count converts to "expected
    // vortex births per frame", scaled small enough that even maxed out it
    // stays visually plausible.
    let frame_seed = fract(sin(params.time * 12.9898 + params.seed_phase) * 43758.5453);
    let cell_seed = fract(sin(f32(gid.x) * 12.345 + f32(gid.y) * 78.901 + frame_seed * 37.719) * 43758.5453);
    var v_with_vortex = v_out;
    if (cell_seed < params.vortex_rate * params.dt) {
        let angle = cell_seed * 6.2831;
        v_with_vortex = v_with_vortex
            + vec2<f32>(cos(angle), sin(angle)) * params.vortex_strength;
    }

    textureStore(dst_vel, vec2<i32>(gid.xy), vec4<f32>(v_with_vortex, dye_out, 0.0));
}
