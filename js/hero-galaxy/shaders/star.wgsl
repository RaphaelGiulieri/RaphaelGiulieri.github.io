// Per-system tinted sun. Accent comes from sunTint in JSON (written into the
// body's accent uniform by the scene). Bright corona via fresnel + a slow
// internal noise churn for "alive star" feel.

struct Surface {
    world_pos    : vec3<f32>,
    world_normal : vec3<f32>,
    uv_sphere    : vec2<f32>,
    view_dir     : vec3<f32>,
    time         : f32,
    accent       : vec3<f32>,
    hover_t      : f32,
    local_pos    : vec3<f32>,    // unit-sphere object-space — use for procedural noise
};

fn surface(s: Surface) -> vec4<f32> {
    let churn = fbm3(s.local_pos * 2.5 + vec3<f32>(0.0, s.time * 0.07, 0.0), 4);
    let hot   = s.accent * (1.2 + churn * 0.8);
    let corona = pow(1.0 - max(0.0, dot(s.view_dir, s.world_normal)), 2.0);
    return vec4<f32>(hot + s.accent * corona * 1.5, 1.0);
}
