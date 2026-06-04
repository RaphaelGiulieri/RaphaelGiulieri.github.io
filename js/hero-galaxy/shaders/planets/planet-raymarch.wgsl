// Raymarching / SDF — voronoi-tile surface.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
    local_pos    : vec3<f32>,
};

fn surface(s: Surface) -> vec4<f32> {
    // Albedo only — Lambert applied by fs_main against the parent star.
    let v = voronoi(s.local_pos * 6.0 + vec3<f32>(0.0, 0.0, s.time * 0.03));
    let edge = smoothstep(0.0, 0.05, v);
    let base = mix(s.accent * 0.15, s.accent * 0.9, edge);
    return vec4<f32>(base + s.accent * s.hover_t * 0.6, 1.0);
}
