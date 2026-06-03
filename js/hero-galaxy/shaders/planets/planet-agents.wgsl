// Multi-agent orchestration — pulsing neural mesh.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
};

fn surface(s: Surface) -> vec4<f32> {
    let pulse = sin(s.time * 1.8 + s.world_pos.y * 5.0) * 0.5 + 0.5;
    let mesh  = fbm3(s.world_pos * 4.0 + vec3<f32>(s.time * 0.07, 0.0, 0.0), 3);
    let v = pulse * mesh;
    let base = mix(s.accent * 0.2, s.accent * 1.3, v);
    let rim = fresnel(s.view_dir, s.world_normal, 2.5);
    return vec4<f32>(base + s.accent * rim * (0.5 + s.hover_t), 1.0);
}
