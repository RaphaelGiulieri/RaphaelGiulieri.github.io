// Procedural worlds — layered fbm reads as continent / terrain patches.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
};

fn surface(s: Surface) -> vec4<f32> {
    let p = s.world_pos * 3.5;
    let land = fbm3(p + vec3<f32>(s.time * 0.015, 0.0, 0.0), 5);
    let coast = smoothstep(0.42, 0.52, land);
    let base = mix(s.accent * 0.25, s.accent * 1.1, coast);
    let detail = fbm3(p * 4.0, 3) * 0.18;
    let rim = fresnel(s.view_dir, s.world_normal, 2.8);
    return vec4<f32>(base + s.accent * detail + s.accent * rim * (0.3 + s.hover_t * 1.2), 1.0);
}
