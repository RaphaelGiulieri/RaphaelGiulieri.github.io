// Diffusion / image generation — cloudy fluid with high-freq grain overlay.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
};

fn surface(s: Surface) -> vec4<f32> {
    let p = s.world_pos * 2.2;
    let cloud = fbm3(p + vec3<f32>(s.time * 0.04, s.time * 0.03, 0.0), 5);
    let grain = fbm3(p * 12.0 + vec3<f32>(s.time * 0.3, 0.0, 0.0), 3) * 0.22;
    let base = mix(s.accent * 0.18, s.accent * 1.4, cloud);
    let rim = fresnel(s.view_dir, s.world_normal, 2.0);
    return vec4<f32>(base + s.accent * grain + s.accent * rim * (0.45 + s.hover_t), 1.0);
}
