// Retro post-processing — scanlines + dither, CRT-flavoured banding.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
};

fn surface(s: Surface) -> vec4<f32> {
    let scan = 0.5 + 0.5 * sin(s.uv_sphere.y * 220.0 + s.time * 0.6);
    let dither = hash13(floor(s.world_pos * 90.0));
    let line = step(0.55, scan);
    let base = mix(s.accent * 0.35, s.accent * 1.25, line);
    let speckle = base + s.accent * (dither - 0.5) * 0.18;
    let rim = fresnel(s.view_dir, s.world_normal, 4.0);
    return vec4<f32>(speckle + s.accent * rim * (0.4 + s.hover_t), 1.0);
}
