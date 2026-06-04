// Full-stack web — stacked horizontal layers, the "stack" motif.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
    local_pos    : vec3<f32>,
};

fn surface(s: Surface) -> vec4<f32> {
    let layer = floor(s.uv_sphere.y * 8.0);
    let strip = step(0.5, fract(s.uv_sphere.y * 8.0 + s.time * 0.05));
    let tier  = mix(0.4, 1.15, fract(layer * 0.3173));
    let base = s.accent * tier * (0.45 + strip * 0.55);
    let circuit = fbm3(s.local_pos * 7.0 + vec3<f32>(s.time * 0.04, 0.0, 0.0), 2) * 0.18;
    let rim = fresnel(s.view_dir, s.world_normal, 3.0);
    return vec4<f32>(base + s.accent * circuit + s.accent * rim * (0.35 + s.hover_t * 1.2), 1.0);
}
