// 2D Navier-Stokes fluid sim on a 256×128 equirectangular grid (lon × lat).
// Architecture lifted from C:/Users/Legion/Desktop/Remain/src/shaders/
// cloud-fluid.wgsl (multi-kernel pressure-projected solver) + the
// vorticity-confinement passes from demos/fluid-sim.html (the Qatar /
// volumetric-fluid reference). This is what produces real eddies instead
// of laminar bands: pressure projection enforces incompressibility,
// vorticity confinement amplifies existing curl into persistent vortices.
//
// PER-FRAME PASS ORDER (driven by JS):
//   1. advectVelocity     — semi-Lagrangian backtrace + viscosity
//   2. addForces          — gaussian-equatorial forcing band + jet target
//   3. computeCurl        — ω = ∂v_y/∂x - ∂v_x/∂y
//   4. vorticityForce     — push fluid toward existing curl regions
//   5. computeDivergence  — ∇·v
//   6. jacobiPressure × N — solve ∇²p = ∇·v iteratively
//   7. pressureProject    — v ← v - ∇p, restoring incompressibility
//   8. advectTracer       — backwards-advect dye using the FINAL velocity
//
// BOUNDARIES: longitude periodic (wraps x), latitude clamped (no flow
// through the pole). Every kernel uses `texel_wrap` for neighbour
// fetches so the seam is invisible everywhere.

struct FluidParams {
    dt                  : f32,
    time                : f32,
    grid_w              : f32,
    grid_h              : f32,
    viscosity           : f32,    // velocity damping per second
    jet_force           : f32,    // mild zonal-jet restoring (kept low; bands now emerge from β)
    advect_mul          : f32,    // backwards-advect step multiplier
    forcing_rate        : f32,    // global rate multiplier
    forcing_strength    : f32,    // splat velocity force magnitude
    forcing_width       : f32,    // splat gaussian radius (exp denominator)
    tracer_source       : f32,    // dye amount per splat
    tracer_decay        : f32,    // dye decay per second
    vorticity_strength  : f32,    // vorticity-confinement strength (portfolio = 18)
    seed_phase          : f32,    // per-planet phase
    coriolis_f0         : f32,    // baseline rotation rate
    coriolis_beta       : f32,    // β = df/dy — sets jet count via Rhines scale
    splat_count         : f32,    // number of convective splats distributed in lat/lon
    splat_lifetime      : f32,    // seconds each splat persists before randomizing
    equator_force       : f32,    // prograde-equator forcing (Jupiter super-rotation fake)
    _pad0               : f32,
};

@group(0) @binding(0) var<uniform> params : FluidParams;
@group(0) @binding(1) var src_a   : texture_2d<f32>;
@group(0) @binding(2) var src_b   : texture_2d<f32>;
@group(0) @binding(3) var dst     : texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var lin_smp : sampler;

// ── Boundary helpers ──
// x wraps, y clamps. Used by every kernel's neighbour fetches.
fn wrap_x(x: i32, gw: i32) -> i32 {
    return ((x % gw) + gw) % gw;
}
fn clamp_y(y: i32, gh: i32) -> i32 {
    return clamp(y, 0, gh - 1);
}

fn load_a_clamped(coord: vec2<i32>) -> vec4<f32> {
    let gw = i32(params.grid_w);
    let gh = i32(params.grid_h);
    return textureLoad(src_a, vec2<i32>(wrap_x(coord.x, gw), clamp_y(coord.y, gh)), 0);
}
fn load_b_clamped(coord: vec2<i32>) -> vec4<f32> {
    let gw = i32(params.grid_w);
    let gh = i32(params.grid_h);
    return textureLoad(src_b, vec2<i32>(wrap_x(coord.x, gw), clamp_y(coord.y, gh)), 0);
}

// Manual bilinear sample of src_a with seam wrap. Used by advection where
// the upstream point can land at fractional cell coordinates anywhere on
// the grid (including past the borders).
fn bilinear_a(uv: vec2<f32>) -> vec4<f32> {
    let gw = i32(params.grid_w);
    let gh = i32(params.grid_h);
    let tex = uv * vec2<f32>(params.grid_w, params.grid_h) - vec2<f32>(0.5);
    let ix0 = i32(floor(tex.x));
    let iy0 = i32(floor(tex.y));
    let fx  = tex.x - f32(ix0);
    let fy  = tex.y - f32(iy0);
    let x0 = wrap_x(ix0,     gw);
    let x1 = wrap_x(ix0 + 1, gw);
    let y0 = clamp_y(iy0,     gh);
    let y1 = clamp_y(iy0 + 1, gh);
    let s00 = textureLoad(src_a, vec2<i32>(x0, y0), 0);
    let s10 = textureLoad(src_a, vec2<i32>(x1, y0), 0);
    let s01 = textureLoad(src_a, vec2<i32>(x0, y1), 0);
    let s11 = textureLoad(src_a, vec2<i32>(x1, y1), 0);
    let s0  = mix(s00, s10, fx);
    let s1  = mix(s01, s11, fx);
    return mix(s0, s1, fy);
}

fn in_bounds(id: vec2<u32>) -> bool {
    return id.x < u32(params.grid_w) && id.y < u32(params.grid_h);
}

fn cell_uv(id: vec2<u32>) -> vec2<f32> {
    return (vec2<f32>(f32(id.x), f32(id.y)) + 0.5)
         / vec2<f32>(params.grid_w, params.grid_h);
}

// ════════════════════════════════════════════════════════════════════════
// KERNEL 1: ADVECT VELOCITY
//   src_a = velocity (rg16f via rgba16f, .xy only)
//   dst   = advected velocity
@compute @workgroup_size(8, 8)
fn cs_advect_vel(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (!in_bounds(gid.xy)) { return; }
    let uv     = cell_uv(gid.xy);
    let v_here = load_a_clamped(vec2<i32>(gid.xy)).xy;
    let prev_uv = uv - v_here * params.dt * params.advect_mul;
    let v_advected = bilinear_a(prev_uv).xy;
    let v_damped   = v_advected * (1.0 - clamp(params.viscosity * params.dt, 0.0, 1.0));
    textureStore(dst, vec2<i32>(gid.xy), vec4<f32>(v_damped, 0.0, 0.0));
}

// ════════════════════════════════════════════════════════════════════════
// KERNEL 2: ADD FORCES
//   Adds (in order): β-plane Coriolis rotation · prograde equator forcing
//   · N distributed convective splats with finite lifetime · soft jet
//   restoring torque.
//
//   This is the post-research physics-correct version — band structure
//   emerges from the β-effect organizing distributed convection into
//   zonal jets via Rossby-wave breaking (Tan & Showman 2019, Yoden &
//   Yamada 1993, Heimpel & Aurnou 2007 Icarus). NOT from explicit jet
//   targets, NOT from equator-only forcing.
//
//   src_a = velocity   dst = forced velocity

const MAX_SPLATS : u32 = 32u;

fn wrapped_delta(a: f32, b: f32) -> f32 {
    var d = a - b;
    d = d - round(d);
    return d;
}

fn rand1(seed: f32) -> f32 {
    return fract(sin(seed * 12.9898) * 43758.5453);
}

@compute @workgroup_size(8, 8)
fn cs_add_forces(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (!in_bounds(gid.xy)) { return; }
    let uv  = cell_uv(gid.xy);
    var vel = load_a_clamped(vec2<i32>(gid.xy)).xy;

    // ── β-plane Coriolis ──
    // f(y) = f0 + β · sin(latitude). Latitude maps uv.y ∈ [0,1] to
    // [−π/2, +π/2] (south pole to north pole). f is positive in the
    // northern hemisphere, negative in the southern. The Coriolis term
    // dv/dt = −f ẑ × v rotates velocity clockwise (in N) / counter-
    // clockwise (in S) per timestep — this is what breaks the latitudinal
    // symmetry and channels the inverse cascade into zonal jets.
    let lat   = (uv.y - 0.5) * 3.14159;
    let f_cor = params.coriolis_f0 + params.coriolis_beta * sin(lat);
    let ang   = f_cor * params.dt;
    let c     = cos(ang);
    let s     = sin(ang);
    vel = vec2<f32>(vel.x * c + vel.y * s, -vel.x * s + vel.y * c);

    // ── Prograde-equator force (Jupiter super-rotation fake) ──
    // Warneford & Dellar 2014 / Scott & Polvani 2008: pure Rayleigh
    // friction in shallow-water gives the WRONG (retrograde) equator
    // direction; you need Newtonian thickness relaxation to get
    // super-rotation. We're 2D-incompressible so we fake it: a gaussian
    // eastward push centered on the equator.
    let eq_band = exp(-(lat * lat) / 0.10);   // σ ≈ 0.22 rad ≈ ±13°
    vel.x = vel.x + params.equator_force * eq_band * params.dt;

    // ── Distributed convective splats ──
    // N splats at random (lat, lon), each persisting for splat_lifetime
    // seconds before its position is re-randomized. Distributed AT ALL
    // LATITUDES (not equator-only) — this is what real gas-giant
    // convection looks like, and the β-effect organizes it into bands.
    // Each splat adds curl (rotational push), alternating spin per index.
    let n        = u32(clamp(params.splat_count, 1.0, f32(MAX_SPLATS)));
    let lifetime = max(0.5, params.splat_lifetime);
    let epoch    = floor(params.time / lifetime);
    let radius   = max(1e-5, params.forcing_width);

    for (var i = 0u; i < MAX_SPLATS; i = i + 1u) {
        if (i >= n) { break; }
        let fi = f32(i);
        // Pseudo-random (lat, lon) drawn from (i, epoch, seed_phase).
        // Stays fixed across the entire lifetime, then jumps.
        let h1 = rand1(fi * 1.31 + epoch * 7.71  + params.seed_phase);
        let h2 = rand1(fi * 4.77 + epoch * 13.31 + params.seed_phase * 1.7);
        let splat_x = h1;
        // Bias lat toward mid-latitudes (avoid polar caps), using
        // (1 - (2x-1)²)^p shaping so splats cluster around lat 0.5.
        let raw_y   = h2;
        let centered = (raw_y - 0.5) * 1.8;
        let splat_y = 0.5 + centered;

        let dx = wrapped_delta(uv.x, splat_x);
        let dy = uv.y - splat_y;
        let d2 = dx * dx + dy * dy;
        if (d2 > radius * 8.0) { continue; }
        let w = exp(-d2 / radius);

        // Tangent (curl) direction with alternating spin.
        let inv_r   = 1.0 / max(0.001, sqrt(d2));
        let tangent = vec2<f32>(-dy * inv_r, dx * inv_r);
        let spin    = select(-1.0, 1.0, (i % 2u) == 0u);

        // Lifetime envelope: fade in 15%, plateau, fade out 15% — so
        // splats appear and dissolve smoothly instead of popping.
        let t_in = fract(params.time / lifetime);
        let env  = smoothstep(0.0, 0.15, t_in) * (1.0 - smoothstep(0.85, 1.0, t_in));

        vel = vel + tangent * spin * params.forcing_strength * params.forcing_rate
              * w * env * params.dt;
    }

    // ── Soft jet restoring (optional) ──
    let lat_norm   = (uv.y - 0.5) * 2.0;
    let jet_target = vec2<f32>(sin(lat_norm * 5.0) * 0.05, 0.0);
    vel = mix(vel, jet_target, params.jet_force * params.dt);

    textureStore(dst, vec2<i32>(gid.xy), vec4<f32>(vel, 0.0, 0.0));
}

// ════════════════════════════════════════════════════════════════════════
// KERNEL 3: COMPUTE CURL — ω = ∂v_y/∂x - ∂v_x/∂y
//   src_a = velocity
//   dst   = curl scalar (.x)
@compute @workgroup_size(8, 8)
fn cs_curl(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (!in_bounds(gid.xy)) { return; }
    let p = vec2<i32>(gid.xy);
    let R = load_a_clamped(p + vec2<i32>( 1,  0)).y;
    let L = load_a_clamped(p + vec2<i32>(-1,  0)).y;
    let T = load_a_clamped(p + vec2<i32>( 0,  1)).x;
    let B = load_a_clamped(p + vec2<i32>( 0, -1)).x;
    let omega = (R - L) - (T - B);
    textureStore(dst, p, vec4<f32>(omega * 0.5, 0.0, 0.0, 0.0));
}

// ════════════════════════════════════════════════════════════════════════
// KERNEL 4: VORTICITY FORCE — push velocity toward existing curl
//   src_a = velocity
//   src_b = curl scalar (.x)
//   dst   = velocity + vort force
//
// Classic technique (Fedkiw / Steinhoff): compute the gradient of |curl|,
// normalise it, point it toward higher curl, then push the fluid that way
// scaled by the local curl magnitude. Net effect: existing eddies get
// stronger; new perturbations grow into vortices instead of being
// viscosity-damped.
@compute @workgroup_size(8, 8)
fn cs_vorticity_force(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (!in_bounds(gid.xy)) { return; }
    let p = vec2<i32>(gid.xy);
    let R = load_b_clamped(p + vec2<i32>( 1,  0)).x;
    let L = load_b_clamped(p + vec2<i32>(-1,  0)).x;
    let T = load_b_clamped(p + vec2<i32>( 0,  1)).x;
    let B = load_b_clamped(p + vec2<i32>( 0, -1)).x;
    let C = load_b_clamped(p).x;

    // gradient of |ω|, points away from the eddy centre
    var grad = vec2<f32>(abs(R) - abs(L), abs(T) - abs(B));
    let g_len = length(grad);
    if (g_len > 0.0001) {
        grad = grad / g_len;
        // confinement force: ω × normalised gradient, rotated 90° so the
        // push is *along* iso-curl contours and scaled by C × strength.
        let force = vec2<f32>(grad.y * C, -grad.x * C) * params.vorticity_strength * params.dt;
        var vel = load_a_clamped(p).xy + force;
        textureStore(dst, p, vec4<f32>(vel, 0.0, 0.0));
    } else {
        textureStore(dst, p, vec4<f32>(load_a_clamped(p).xy, 0.0, 0.0));
    }
}

// ════════════════════════════════════════════════════════════════════════
// KERNEL 5: COMPUTE DIVERGENCE — ∇·v
//   src_a = velocity
//   dst   = divergence scalar (.x)
@compute @workgroup_size(8, 8)
fn cs_divergence(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (!in_bounds(gid.xy)) { return; }
    let p = vec2<i32>(gid.xy);
    let R = load_a_clamped(p + vec2<i32>( 1,  0)).x;
    let L = load_a_clamped(p + vec2<i32>(-1,  0)).x;
    let T = load_a_clamped(p + vec2<i32>( 0,  1)).y;
    let B = load_a_clamped(p + vec2<i32>( 0, -1)).y;
    let div = (R - L + T - B) * 0.5;
    // Sign convention matches the Remain code: negative divergence is the
    // RHS of the Poisson equation `∇²p = -∇·v`.
    textureStore(dst, p, vec4<f32>(-div, 0.0, 0.0, 0.0));
}

// ════════════════════════════════════════════════════════════════════════
// KERNEL 6: JACOBI PRESSURE ITERATION
//   src_a = pressure from previous iteration (ping-pong)
//   src_b = divergence (computed once per frame, read N times)
//   dst   = pressure (next iteration)
//
// Solves ∇²p = -∇·v via point-iterative Jacobi:
//   p_new[i,j] = (p[i-1,j] + p[i+1,j] + p[i,j-1] + p[i,j+1] + div[i,j]) / 4
// Dispatched N times per frame (toggled ping-pong).
@compute @workgroup_size(8, 8)
fn cs_jacobi(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (!in_bounds(gid.xy)) { return; }
    let p = vec2<i32>(gid.xy);
    let pL = load_a_clamped(p + vec2<i32>(-1,  0)).x;
    let pR = load_a_clamped(p + vec2<i32>( 1,  0)).x;
    let pT = load_a_clamped(p + vec2<i32>( 0,  1)).x;
    let pB = load_a_clamped(p + vec2<i32>( 0, -1)).x;
    let div = load_b_clamped(p).x;
    let pressure = (pL + pR + pT + pB + div) * 0.25;
    textureStore(dst, p, vec4<f32>(pressure, 0.0, 0.0, 0.0));
}

// ════════════════════════════════════════════════════════════════════════
// KERNEL 7: PRESSURE PROJECT — v ← v - ∇p
//   src_a = velocity (pre-projection)
//   src_b = pressure (final after Jacobi)
//   dst   = velocity (incompressible)
@compute @workgroup_size(8, 8)
fn cs_pressure_project(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (!in_bounds(gid.xy)) { return; }
    let p = vec2<i32>(gid.xy);
    let pL = load_b_clamped(p + vec2<i32>(-1,  0)).x;
    let pR = load_b_clamped(p + vec2<i32>( 1,  0)).x;
    let pT = load_b_clamped(p + vec2<i32>( 0,  1)).x;
    let pB = load_b_clamped(p + vec2<i32>( 0, -1)).x;
    let grad_p = vec2<f32>(pR - pL, pT - pB) * 0.5;
    let vel = load_a_clamped(p).xy - grad_p;
    textureStore(dst, p, vec4<f32>(vel, 0.0, 0.0));
}

// ════════════════════════════════════════════════════════════════════════
// KERNEL 8: ADVECT TRACER — backwards-advect dye using FINAL velocity,
//                          then add dye splats at the same N equator
//                          positions as the velocity forcing.
//   src_a = tracer (previous)
//   src_b = velocity (post pressure projection)
//   dst   = tracer (new)
@compute @workgroup_size(8, 8)
fn cs_advect_tracer(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (!in_bounds(gid.xy)) { return; }
    let uv = cell_uv(gid.xy);
    let v_here = load_b_clamped(vec2<i32>(gid.xy)).xy;
    let prev_uv = uv - v_here * params.dt * params.advect_mul;

    let advected = bilinear_a(prev_uv).x;
    var tracer = advected * (1.0 - clamp(params.tracer_decay * params.dt, 0.0, 1.0));

    // ── Dye splats — mirror cs_add_forces exactly (same RNG seeds, same
    //    epoch, same lifetime envelope) so velocity injection and dye
    //    injection happen at the SAME positions. The dye then advects
    //    with the divergence-free velocity, so eddies in the flow
    //    show up as eddies in the visible pattern.
    let n        = u32(clamp(params.splat_count, 1.0, f32(MAX_SPLATS)));
    let lifetime = max(0.5, params.splat_lifetime);
    let epoch    = floor(params.time / lifetime);
    let radius   = max(1e-5, params.forcing_width);

    for (var i = 0u; i < MAX_SPLATS; i = i + 1u) {
        if (i >= n) { break; }
        let fi = f32(i);
        let h1 = rand1(fi * 1.31 + epoch * 7.71  + params.seed_phase);
        let h2 = rand1(fi * 4.77 + epoch * 13.31 + params.seed_phase * 1.7);
        let splat_x = h1;
        let centered = (h2 - 0.5) * 1.8;
        let splat_y = 0.5 + centered;

        let dx = wrapped_delta(uv.x, splat_x);
        let dy = uv.y - splat_y;
        let d2 = dx * dx + dy * dy;
        if (d2 > radius * 8.0) { continue; }
        let w = exp(-d2 / radius);

        let t_in = fract(params.time / lifetime);
        let env  = smoothstep(0.0, 0.15, t_in) * (1.0 - smoothstep(0.85, 1.0, t_in));

        tracer = tracer + params.tracer_source * params.forcing_rate * w * env * params.dt;
    }

    textureStore(dst, vec2<i32>(gid.xy), vec4<f32>(clamp(tracer, 0.0, 4.0), 0.0, 0.0, 0.0));
}
