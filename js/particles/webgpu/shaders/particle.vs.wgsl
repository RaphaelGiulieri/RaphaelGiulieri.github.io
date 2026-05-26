// particle.vs.wgsl — Instanced billboard. WGSL port of particle.vert.glsl.
// Vertex stage zero-areas (returns vec4(0,0,0,0)) for dead particles —
// cheaper than fragment-stage discard at high particle counts.

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
    _pad: vec2<f32>,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(1) @binding(0) var<storage, read> particles: array<Particle>;

struct VSOut {
    @builtin(position) clip_pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
}

const QUAD = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0,  1.0),
);

@vertex
fn vs_main(
    @builtin(vertex_index) vid: u32,
    @builtin(instance_index) iid: u32,
) -> VSOut {
    let p = particles[iid];
    var out: VSOut;

    // Dead slot → zero-area triangle (clipped before raster).
    if (p.life == 0.0 || p.age >= p.life) {
        out.clip_pos = vec4<f32>(0.0, 0.0, 0.0, 0.0);
        out.uv = vec2<f32>(0.0);
        out.color = vec4<f32>(0.0);
        return out;
    }

    let corner = QUAD[vid];
    let center_view = u.view * vec4<f32>(p.pos, 1.0);
    let cs = cos(p.rot);
    let sn = sin(p.rot);
    let rotated = vec2<f32>(
        corner.x * cs - corner.y * sn,
        corner.x * sn + corner.y * cs,
    );
    let offset = rotated * p.size * u.pixel_scale;
    let corner_view = center_view + vec4<f32>(offset, 0.0, 0.0);
    out.clip_pos = u.proj * corner_view;
    out.uv = corner;
    out.color = p.color;
    return out;
}
