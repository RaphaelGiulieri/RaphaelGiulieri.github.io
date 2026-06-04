// Tools — crosshatch grid, calm utility-belt texture.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
    local_pos    : vec3<f32>,
};

fn surface(s: Surface) -> vec4<f32> {
    let gx = abs(fract(s.uv_sphere.x * 36.0) - 0.5);
    let gy = abs(fract(s.uv_sphere.y * 24.0) - 0.5);
    let cross = smoothstep(0.48, 0.42, min(gx, gy));
    let base = mix(s.accent * 0.4, s.accent * 1.1, cross);
    let breath = 0.92 + 0.08 * sin(s.time * 0.5);
    let rim = fresnel(s.view_dir, s.world_normal, 3.5);
    return vec4<f32>(base * breath + s.accent * rim * (0.25 + s.hover_t), 1.0);
}
