// GPGPU compute — banded swirling fluid.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
    local_pos    : vec3<f32>,
};

fn surface(s: Surface) -> vec4<f32> {
    let lat = s.uv_sphere.y;
    let lon = s.uv_sphere.x + s.time * 0.02;
    let swirl = sin(lon * 14.0 + sin(lat * 8.0 + s.time * 0.1) * 2.0) * 0.5 + 0.5;
    let band = sin(lat * 18.0) * 0.5 + 0.5;
    let v = mix(swirl, band, 0.4);
    let base = mix(s.accent * 0.4, s.accent * 1.4, v);
    let rim = fresnel(s.view_dir, s.world_normal, 2.0);
    return vec4<f32>(base + s.accent * rim * (0.3 + s.hover_t), 1.0);
}
