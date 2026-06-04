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
    viscosity           : f32,    // velocity damping per second (dissipation factor)
    jet_force           : f32,    // zonal-jet restoring torque
    advect_mul          : f32,    // backwards-advect step multiplier
    forcing_rate        : f32,    // global rate multiplier on the equatorial band
    forcing_strength    : f32,    // velocity perturbation magnitude in the band
    forcing_width       : f32,    // gaussian σ (uv) of the band
    tracer_source       : f32,    // dye flux into the band
    tracer_decay        : f32,    // dye decay per second
    vorticity_strength  : f32,    // how aggressively curl is amplified
    seed_phase          : f32,    // per-planet phase offset
    _pad0               : f32,
    _pad1               : f32,
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
// KERNEL 2: ADD FORCES — equatorial gaussian band + zonal-jet target
//   src_a = velocity
//   dst   = forced velocity
@compute @workgroup_size(8, 8)
fn cs_add_forces(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (!in_bounds(gid.xy)) { return; }
    let uv      = cell_uv(gid.xy);
    var vel     = load_a_clamped(vec2<i32>(gid.xy)).xy;

    // Zonal-jet restoring torque
    let lat        = uv.y * 2.0 - 1.0;
    let jet_target = vec2<f32>(sin(lat * 5.0) * 0.35, 0.0);
    vel = mix(vel, jet_target, params.jet_force * params.dt);

    // Continuous equatorial forcing band — gaussian-weighted, per-cell
    // stable random direction.
    let sigma   = max(0.02, params.forcing_width);
    let band    = exp(-(lat * lat) / (2.0 * sigma * sigma));
    let seed    = fract(sin(f32(gid.x) * 12.345
                          + f32(gid.y) * 78.901
                          + params.seed_phase) * 43758.5453);
    let angle   = seed * 6.2831;
    let dir     = vec2<f32>(cos(angle), sin(angle));
    let flux    = params.forcing_rate * params.dt * band;
    vel = vel + dir * params.forcing_strength * flux;

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
// KERNEL 8: ADVECT TRACER — backwards-advect dye using FINAL velocity
//   src_a = tracer (previous)
//   src_b = velocity (post pressure projection)
//   dst   = tracer (new)
@compute @workgroup_size(8, 8)
fn cs_advect_tracer(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (!in_bounds(gid.xy)) { return; }
    let uv = cell_uv(gid.xy);
    let v_here = load_b_clamped(vec2<i32>(gid.xy)).xy;
    let prev_uv = uv - v_here * params.dt * params.advect_mul;

    // Manual bilinear of tracer (src_a, .x) with wrap. Can't reuse bilinear_a
    // since it operates on src_a — but src_a here IS the tracer, so it works.
    let v = bilinear_a(prev_uv).x;
    var tracer = v * (1.0 - clamp(params.tracer_decay * params.dt, 0.0, 1.0));

    // Source term in the equatorial band — same shape as velocity forcing
    // so the dye accumulates where the velocity is most actively perturbed.
    let lat   = uv.y * 2.0 - 1.0;
    let sigma = max(0.02, params.forcing_width);
    let band  = exp(-(lat * lat) / (2.0 * sigma * sigma));
    tracer = tracer + params.tracer_source * params.forcing_rate * params.dt * band;

    textureStore(dst, vec2<i32>(gid.xy), vec4<f32>(clamp(tracer, 0.0, 4.0), 0.0, 0.0, 0.0));
}
