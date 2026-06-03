// Small moon — lambertian shading with a slight emissive tint.

struct Surface {
    world_pos    : vec3<f32>,
    world_normal : vec3<f32>,
    uv_sphere    : vec2<f32>,
    view_dir     : vec3<f32>,
    time         : f32,
    accent       : vec3<f32>,
    hover_t      : f32,
};

fn surface(s: Surface) -> vec4<f32> {
    let ndl = clamp(dot(s.world_normal, normalize(vec3<f32>(0.3, 0.7, 0.4))), 0.0, 1.0);
    let base = vec3<f32>(0.35, 0.32, 0.30) * (0.3 + 0.7 * ndl);
    let glow = s.accent * 0.15 + s.accent * s.hover_t * 0.6;
    return vec4<f32>(base + glow, 1.0);
}
