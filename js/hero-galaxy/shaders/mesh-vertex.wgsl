// Shared vertex shader for all sphere bodies. Engine prepends this and the
// planet-specific surface() function into one module.

struct BodyUniforms {
    model     : mat4x4<f32>,
    accent    : vec4<f32>,
    params    : vec4<f32>,    // x = time, y = radius_world, z = body_id, w = hover_t
    light_pos : vec4<f32>,    // xyz = parent star world pos, w = ambient floor
};

struct CameraUniforms {
    view      : mat4x4<f32>,
    proj      : mat4x4<f32>,
    eye       : vec4<f32>,    // xyz = world-space eye, w = unused
};

@group(0) @binding(0) var<uniform> camera : CameraUniforms;
@group(1) @binding(0) var<uniform> body   : BodyUniforms;

struct VertexIn {
    @location(0) position : vec3<f32>,
    @location(1) normal   : vec3<f32>,
};

struct VertexOut {
    @builtin(position) clip_pos     : vec4<f32>,
    @location(0)       world_pos    : vec3<f32>,
    @location(1)       world_normal : vec3<f32>,
    @location(2)       uv_sphere    : vec2<f32>,
    @location(3)       view_dir     : vec3<f32>,
};

@vertex
fn vs_main(in: VertexIn) -> VertexOut {
    var out : VertexOut;
    let world4 = body.model * vec4<f32>(in.position, 1.0);
    out.world_pos    = world4.xyz;
    let nrm4 = body.model * vec4<f32>(in.normal, 0.0);
    out.world_normal = normalize(nrm4.xyz);
    out.uv_sphere    = vec2<f32>(
        atan2(in.position.z, in.position.x) * 0.15915494 + 0.5,
        in.position.y * 0.5 + 0.5);
    out.view_dir     = normalize(camera.eye.xyz - out.world_pos);
    out.clip_pos     = camera.proj * camera.view * world4;
    return out;
}
