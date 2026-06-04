// Star halo — rendered on a larger sphere around the star with alpha blending.
// We get soft outward falloff by reading the view-relative angle: dot(normal,
// view_dir) is close to 0 at the rim and 1 at the centre. The halo brightens
// at the rim and fades to zero at the centre so it doesn't dim the star itself.

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
    let ndotv = max(0.0, dot(s.world_normal, s.view_dir));
    // alpha is 1 at the silhouette (ndotv = 0), 0 at the centre (ndotv = 1).
    let edge = pow(1.0 - ndotv, 3.5);
    // Slow breath so the halo feels alive rather than static.
    let breath = 0.85 + 0.15 * sin(s.time * 0.7);
    let glow = s.accent * (1.5 + breath * 0.6);
    return vec4<f32>(glow * edge, edge);
}
