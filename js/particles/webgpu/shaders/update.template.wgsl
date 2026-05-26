// update.template.wgsl — per-emitter compute shader template.
//
// Module-codegen substitutes module wgslSnippet outputs at the four
// `// === [marker] ===` insertion points. The eval_bound.wgsl source
// is concatenated above this file at codegen time (string substitution),
// so Particle/Bound/eval_bound are in scope. Module params are bound
// at @group(2) @binding(0) via a per-emitter ModuleParams struct
// emitted by bound-codegen.js.

struct Particle {
    pos: vec3<f32>,
    _pad0: f32,
    vel: vec3<f32>,
    density: f32,             // was _pad1; SPH pass A writes here, zero for non-SPH
    color: vec4<f32>,
    size: f32,
    rot: f32,
    avel: f32,
    age: f32,
    life: f32,
    spawn_idx: f32,
    stable_rand: f32,
    emitter_id: u32,
}

struct Uniforms {
    view: mat4x4<f32>,
    proj: mat4x4<f32>,
    dt: f32,
    time: f32,
    pixel_scale: f32,
    max_particles: u32,
    this_emitter_id: u32,
    frame_idx: u32,
    _pad: vec2<f32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
// Single in-place binding — each per-emitter cs_main dispatch reads,
// modifies, and writes its own emitter's slots only. Foreign / dead
// slots return early without writing, so prior emitters' aging in this
// frame is preserved (matches the cs_spawn / cs_compact_scatter pattern
// elsewhere in this module).
@group(1) @binding(0) var<storage, read_write> particles: array<Particle>;

// === [eval_bound.wgsl included above by codegen] ===
// (Codegen prepends eval_bound.wgsl content + the per-emitter ModuleParams
// struct + module_params binding before this template body.)

// Workgroup size 256 (was 64): at 8M maxParticles, 64 → 125000 WGs which
// exceeds maxComputeWorkgroupsPerDimension (65535) on most adapters.
// 256 → 31250 WGs comfortably fits. No shared memory used here so larger
// WG is free — same per-thread work, fewer dispatches.
@compute @workgroup_size(256)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= u.max_particles) { return; }
    var p = particles[i];

    // Dead slot — leave in place, this dispatch doesn't touch it.
    if (p.life == 0.0 || p.age >= p.life) {
        return;
    }
    // Foreign emitter — same. The other emitter's dispatch (or a prior
    // pass in this frame) is the one that owns updates for this slot.
    if (p.emitter_id != u.this_emitter_id) {
        return;
    }

    var accel = vec3<f32>(0.0);

    // === [forces-add] ===

    // Integrate accel into velocity
    p.vel = p.vel + accel * u.dt;

    // === [forces-mul] ===

    // Advance position + rotation
    p.pos = p.pos + p.vel * u.dt;
    p.rot = p.rot + p.avel * u.dt;

    // set/mul/add modules (sizeOverLifetime, colorOverLifetime, etc.) MUST run
    // BEFORE the age increment so they sample at age=N*dt, matching WebGL2's
    // _applyModules → integrate ordering. Sampling AFTER the increment would
    // shift the lookup by one frame and break parity with the JS reference.
    // === [set/mul/add] ===

    p.age = p.age + u.dt;

    // === [constraints] ===

    // === [death] ===

    particles[i] = p;
}
