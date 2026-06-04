// 2D fluid sim — backwards-traced semi-Lagrangian advection on a periodic
// (lon) × clamped (lat) grid. One compute pass per active gas giant per
// frame writes the next velocity field into a ping-pong target.
//
// SEAM HANDLING: the longitude axis is periodic. We explicitly detect
// border cells via integer modular arithmetic on the texel indices, so a
// cell at x=0 truly sees x=W-1 as its left neighbour (and an advection
// step that traces upstream past either edge wraps to the opposite
// border). All sampling goes through `sample_full` which does 4-tap
// bilinear with that wrap baked in; the sampler is bypassed entirely.
//
// FIELD CONTENT: .xy holds velocity, .z holds a passive dye. Dye is
// advected by the velocity AND injected wherever a vortex impulse fires,
// so the field builds up dynamically from a black initial condition. No
// fbm seed, no banded prefill — the visible pattern emerges from the sim.
//
// Pressure projection is intentionally skipped — band-restoring torque +
// damping + per-frame vortex births keep the field bounded.

struct SimParams {
    dt              : f32,
    time            : f32,
    grid_w          : f32,
    grid_h          : f32,
    damping         : f32,
    band_force      : f32,
    advect_mul      : f32,
    vortex_rate     : f32,    // expected fraction of cells injected per second
    vortex_strength : f32,    // magnitude of injected velocity impulse
    dye_injection   : f32,    // amount of dye added at each vortex site
    seed_phase      : f32,    // per-planet phase offset (rotates RNG sequence)
    _pad            : f32,
};

@group(0) @binding(0) var src_vel  : texture_2d<f32>;
@group(0) @binding(1) var dst_vel  : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params : SimParams;
@group(0) @binding(3) var smp      : sampler;   // unused — kept for BGL compat

// ── Seam-aware 4-tap bilinear sampler ──
// All neighbour reads in the navier step go through this. It detects when
// the requested uv is on or near the longitude border and wraps to the
// inverse border at integer-texel precision. Latitude clamps at the pole.
//
// `textureLoad` reads the raw stored rgba16 value with no filtering — we
// do the 4-corner bilinear blend by hand so the wrap math is unambiguous
// (sampler addressing modes don't participate in this code path).
fn sample_full(uv: vec2<f32>) -> vec4<f32> {
    let gw_i = i32(params.grid_w);
    let gh_i = i32(params.grid_h);

    // Continuous texel-space coord. 0.5 offset so texel centres align at
    // uv = (n+0.5)/grid.
    let tex = uv * vec2<f32>(params.grid_w, params.grid_h) - vec2<f32>(0.5);
    let ix0 = i32(floor(tex.x));
    let iy0 = i32(floor(tex.y));
    let fx  = tex.x - f32(ix0);
    let fy  = tex.y - f32(iy0);

    // Integer wrap in x. WGSL's % can return negative for negative input;
    // `((a % m) + m) % m` is the standard always-positive modulo.
    let x0 = ((ix0 % gw_i) + gw_i) % gw_i;
    let x1 = (((ix0 + 1) % gw_i) + gw_i) % gw_i;
    // Pole-clamp in y — the polar caps are a hard boundary, no wrap.
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

    // Cell-center UV
    let uv = (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5)
           / vec2<f32>(params.grid_w, params.grid_h);

    // Read full texel (vel + dye) at this cell.
    let here   = sample_full(uv);
    let v_here = here.xy;

    // Backwards-trace semi-Lagrangian advection. The upstream UV can land
    // anywhere — past x=0, past x=1, past the poles — and `sample_full`
    // resolves it via seam-wrap + pole-clamp.
    let step = v_here * params.dt * params.advect_mul;
    let prev_uv = uv - step;
    let upstream = sample_full(prev_uv);
    let v_advected   = upstream.xy;
    let dye_advected = upstream.z;

    // Banded zonal jets — restore toward an alternating east/west pattern
    // at evenly-spaced latitudes (`target` is a reserved WGSL keyword so
    // we call it `band_target`).
    let lat = uv.y * 2.0 - 1.0;
    let band_idx = sin(lat * 5.0);
    let band_target = vec2<f32>(band_idx * 0.35, 0.0);
    let v_with_band = mix(v_advected, band_target, params.band_force * params.dt);

    // Damping — bleeds off turbulence over time so vortices have a
    // finite lifetime.
    let v_out = v_with_band * (1.0 - params.damping * params.dt);

    // Dye decays slightly each step too — without ANY decay it would
    // saturate from continuous vortex injection. A small bleed keeps the
    // dynamic range usable.
    let dye_decayed = dye_advected * (1.0 - 0.02 * params.dt);

    // ── Vortex injection ──
    // Each frame, a random fraction of cells gets BOTH a rotational
    // velocity impulse AND a dye spike. Damping bleeds off the velocity
    // over a few seconds so the impulse forms a transient eddy, while
    // the dye left behind shows the trail. Together this means the
    // texture can start black and the visible pattern emerges from
    // accumulated injection + advection alone.
    let frame_seed = fract(sin(params.time * 12.9898 + params.seed_phase) * 43758.5453);
    let cell_seed  = fract(sin(f32(gid.x) * 12.345
                             + f32(gid.y) * 78.901
                             + frame_seed * 37.719) * 43758.5453);
    var v_out_final   = v_out;
    var dye_out_final = dye_decayed;
    if (cell_seed < params.vortex_rate * params.dt) {
        let angle = cell_seed * 6.2831;
        v_out_final = v_out_final
            + vec2<f32>(cos(angle), sin(angle)) * params.vortex_strength;
        dye_out_final = dye_out_final + params.dye_injection;
    }

    textureStore(dst_vel,
                 vec2<i32>(gid.xy),
                 vec4<f32>(v_out_final, clamp(dye_out_final, 0.0, 2.0), 0.0));
}
