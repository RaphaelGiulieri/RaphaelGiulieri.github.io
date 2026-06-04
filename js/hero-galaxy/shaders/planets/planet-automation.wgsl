// Automation — marching dots / conveyor flow around the equator.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
    local_pos    : vec3<f32>,
};

fn surface(s: Surface) -> vec4<f32> {
    let lane = floor(s.uv_sphere.y * 6.0);
    let dir  = select(-1.0, 1.0, (lane % 2.0) < 0.5);
    let flow = fract(s.uv_sphere.x * 18.0 + s.time * 0.25 * dir);
    let dot  = smoothstep(0.5, 0.4, abs(flow - 0.5)) * smoothstep(0.5, 0.42, abs(fract(s.uv_sphere.y * 6.0) - 0.5));
    let base = mix(s.accent * 0.28, s.accent * 1.35, dot);
    let rim = fresnel(s.view_dir, s.world_normal, 2.8);
    return vec4<f32>(base + s.accent * rim * (0.3 + s.hover_t), 1.0);
}
