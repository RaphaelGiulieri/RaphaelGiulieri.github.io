// NPC AI — voronoi cells with breathing pulse (agents on the surface).

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
    local_pos    : vec3<f32>,
};

fn surface(s: Surface) -> vec4<f32> {
    let cells = voronoi(s.local_pos * 4.5 + vec3<f32>(0.0, s.time * 0.05, 0.0));
    let core = 1.0 - smoothstep(0.0, 0.18, cells);
    let pulse = 0.65 + 0.35 * sin(s.time * 1.4 + hash13(floor(s.local_pos * 4.5)) * 6.28);
    let base = mix(s.accent * 0.22, s.accent * 1.35, core * pulse);
    let rim = fresnel(s.view_dir, s.world_normal, 2.5);
    return vec4<f32>(base + s.accent * rim * (0.35 + s.hover_t * 1.2), 1.0);
}
