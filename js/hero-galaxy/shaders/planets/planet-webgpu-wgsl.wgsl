// WebGPU + WGSL planet — cracked-glass / circuit motif.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
    local_pos    : vec3<f32>,
};

fn surface(s: Surface) -> vec4<f32> {
    let p = s.local_pos * 5.0;
    let n = fbm3(p + vec3<f32>(0.0, s.time * 0.04, 0.0), 4);
    let crack = smoothstep(0.55, 0.62, n);
    let base = mix(s.accent * 0.25, s.accent * 1.6, crack);
    let rim = fresnel(s.view_dir, s.world_normal, 3.0);
    return vec4<f32>(base + s.accent * rim * (0.4 + s.hover_t * 1.5), 1.0);
}
