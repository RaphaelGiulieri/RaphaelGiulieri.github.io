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
    local_pos    : vec3<f32>,
};

fn surface(s: Surface) -> vec4<f32> {
    // Albedo only — Lambert is applied by the wrap in fs_main from the
    // parent star's world_pos. Rim is view-relative and stays here.
    let rim  = fresnel(s.view_dir, s.world_normal, 3.0);
    let base = s.accent;
    return vec4<f32>(base + s.accent * rim * (0.4 + s.hover_t * 1.5), 1.0);
}
