// Star bloom billboard. A camera-facing quad anchored at the sun's worldPos,
// sized in NDC by the sun's world radius × a bloom radius multiplier, with a
// 2D gaussian-style falloff. Drawn additively over the mesh pass — gives a
// proper radial "spilling light" look the halo sphere can't, because the
// halo's brightness distribution is forced by the sphere geometry (peaks at
// silhouette, dims at centre). The billboard peaks at centre and tapers
// smoothly outward.
//
// Reuses the body UBO layout so the JS side doesn't need a different writer.
// Active fields are: model (sun's worldPos via translation column), accent
// (sun tint), and params (radius_world, radius_mul, intensity, falloff).

struct CameraUniforms {
    view : mat4x4<f32>,
    proj : mat4x4<f32>,
    eye  : vec4<f32>,
};

struct BodyUniforms {
    model       : mat4x4<f32>,
    accent      : vec4<f32>,
    params      : vec4<f32>,   // x: time (unused), y: radius_world, z: radius_mul, w: intensity
    light_pos   : vec4<f32>,   // x: gaussian falloff exponent; rest unused
    light_color : vec4<f32>,   // unused
};

@group(0) @binding(0) var<uniform> camera : CameraUniforms;
@group(1) @binding(0) var<uniform> body   : BodyUniforms;

struct VertexOut {
    @builtin(position) clip_pos : vec4<f32>,
    @location(0)       uv       : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid : u32) -> VertexOut {
    // 4-vertex unit quad as a triangle-strip:
    //   v0 (-1,-1)  v1 (1,-1)  v2 (-1, 1)  v3 (1, 1)
    var corners = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0));
    let corner = corners[vid];

    // Sun's worldPos lives in the model matrix's translation column.
    let sun_world = body.model[3].xyz;
    let sun_clip  = camera.proj * camera.view * vec4<f32>(sun_world, 1.0);

    var out : VertexOut;
    // If the sun is behind the camera (or on the near plane), perspective
    // divide on a negative-w vertex produces a smeared blob that splatters
    // across the screen — the exact "mystery bloom with no label" symptom,
    // since the label projection also drops on w<=0. Emit a degenerate
    // off-screen vertex so the triangle-strip gets clipped before rasterisation.
    if (sun_clip.w <= 0.001) {
        out.clip_pos = vec4<f32>(2.0, 2.0, -1.0, 1.0);
        out.uv       = vec2<f32>(0.0, 0.0);
        return out;
    }

    // Billboard size in world units, then converted to NDC offsets via the
    // projection's per-axis scale factors. proj[1][1] = cot(fov_y/2);
    // dividing by eye→sun distance gives NDC per world unit at this depth.
    let radius_world = body.params.y * body.params.z;
    let dist = max(0.001, length(camera.eye.xyz - sun_world));
    let raw_ndc_y = radius_world * camera.proj[1][1] / dist;
    let raw_ndc_x = radius_world * camera.proj[0][0] / dist;
    // Clamp the on-screen bloom to a max NDC half-height so getting close to
    // a sun (camera distance shrinks) doesn't blow the bloom up past the
    // viewport edges — keeps the "spilled light" look without swallowing the
    // whole frame and obscuring foreground bodies.
    let max_ndc = 0.55;
    let scale = min(1.0, max_ndc / max(raw_ndc_y, 0.0001));
    let ndc_y = raw_ndc_y * scale;
    let ndc_x = raw_ndc_x * scale;

    // Multiply NDC offset by sun_clip.w so it survives the perspective divide
    // intact — i.e., the quad maintains its requested NDC size on screen
    // regardless of how far the sun sits behind the near plane.
    let offset = vec4<f32>(corner.x * ndc_x * sun_clip.w,
                           corner.y * ndc_y * sun_clip.w,
                           0.0, 0.0);

    out.clip_pos = sun_clip + offset;
    out.uv       = corner;            // -1..1 across the quad
    return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    let r2 = dot(in.uv, in.uv);
    if (r2 > 1.0) { discard; }                  // clip to unit disc
    let falloff_exp = body.light_pos.x;          // gaussian sharpness
    let alpha = exp(-r2 * falloff_exp);          // 1 at centre, ~0 at edge
    let intensity = body.params.w;
    let glow = body.accent.rgb * intensity;
    return vec4<f32>(glow * alpha, alpha);
}
