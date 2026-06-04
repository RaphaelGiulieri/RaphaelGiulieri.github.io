// Engine modding — voxel cellular surface, blocks rearranging slowly.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
};

fn surface(s: Surface) -> vec4<f32> {
    let p = floor(s.world_pos * 8.0 + vec3<f32>(s.time * 0.05, 0.0, s.time * 0.03));
    let cell = hash13(p);
    let edge = abs(fract(s.world_pos * 8.0) - 0.5);
    let cube = step(0.42, max(edge.x, max(edge.y, edge.z)));
    let block = mix(0.45, 1.25, cell);
    let base = s.accent * block * (0.55 + cube * 0.45);
    let rim = fresnel(s.view_dir, s.world_normal, 3.0);
    return vec4<f32>(base + s.accent * rim * (0.3 + s.hover_t * 1.3), 1.0);
}
