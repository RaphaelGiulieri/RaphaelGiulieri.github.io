// Quantitative ML — vertical price-bar noise + sharp grid lines.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
};

fn surface(s: Surface) -> vec4<f32> {
    let xCol = floor(s.uv_sphere.x * 56.0 + s.time * 0.6);
    let bar  = hash13(vec3<f32>(xCol, 0.0, 0.0));
    let candle = step(0.5 - bar * 0.45, s.uv_sphere.y) * step(s.uv_sphere.y, 0.5 + bar * 0.45);
    let gridY = step(0.95, fract(s.uv_sphere.y * 12.0));
    let base = mix(s.accent * 0.2, s.accent * 1.4, candle);
    let line = s.accent * gridY * 0.4;
    let rim = fresnel(s.view_dir, s.world_normal, 3.2);
    return vec4<f32>(base + line + s.accent * rim * (0.3 + s.hover_t), 1.0);
}
