// Default planet surface — used when a planet's specific shader is missing
// or fails to compile. Soft warm sphere with rim highlight on hover.

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
    let ndl  = clamp(dot(s.world_normal, normalize(vec3<f32>(0.3, 0.7, 0.4))), 0.0, 1.0);
    let rim  = fresnel(s.view_dir, s.world_normal, 3.0);
    let base = s.accent * (0.25 + 0.75 * ndl);
    return vec4<f32>(base + s.accent * rim * (0.4 + s.hover_t * 1.5), 1.0);
}
