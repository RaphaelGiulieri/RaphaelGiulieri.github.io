// Fragment postlude — appended after the planet-specific surface() function
// to form the complete fragment module. Mirrors the vertex-side VertexOut +
// BodyUniforms decls intentionally: vertex and fragment compile as separate
// modules in WebGPU and can't share struct declarations, so the duplication
// here is structural (the alternative — inlining this as a JS template
// literal in pipeline.js — broke wgsl-analyzer / IntelliSense and violated
// the project's "shaders live in .wgsl files, never inline" rule).
//
// fs_main is the contract every planet surface shader plugs into: each
// shader file defines its own Surface struct + surface(s) function, both of
// which are pulled in via getMeshPipeline's string composition right before
// this postlude is appended.

struct VertexOut {
    @builtin(position) clip_pos     : vec4<f32>,
    @location(0)       world_pos    : vec3<f32>,
    @location(1)       world_normal : vec3<f32>,
    @location(2)       uv_sphere    : vec2<f32>,
    @location(3)       view_dir     : vec3<f32>,
    @location(4)       local_pos    : vec3<f32>,
};

struct BodyUniforms {
    model       : mat4x4<f32>,
    accent      : vec4<f32>,
    params      : vec4<f32>,
    light_pos   : vec4<f32>,    // xyz = parent star world pos, w = ambient floor (1.0 = self-lit)
    light_color : vec4<f32>,    // rgb = parent star tint,      w = tint strength (0 = colour-neutral)
};
@group(1) @binding(0) var<uniform> body : BodyUniforms;

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    var s : Surface;
    s.world_pos    = in.world_pos;
    s.world_normal = normalize(in.world_normal);
    // Normalize the interpolated local position back onto the unit sphere —
    // raw barycentric interpolation gives a point on the flat triangle face,
    // not the curved sphere, which produces visible triangle-edge ringing in
    // any 3D noise lookup. Normalizing yields true sphere-surface coords.
    s.local_pos    = normalize(in.local_pos);
    // Compute uv_sphere PER-FRAGMENT instead of using the per-vertex value:
    // atan2 wraps at ±π, and interpolating uv.x across a triangle that
    // straddles that boundary creates a wide stripe of "rewound" UV space
    // (the classic icosphere seam). Computing in the fragment confines the
    // wrap to a one-pixel discontinuity in derivatives.
    s.uv_sphere    = vec2<f32>(
        atan2(s.local_pos.z, s.local_pos.x) * 0.15915494 + 0.5,
        s.local_pos.y * 0.5 + 0.5);
    s.view_dir     = normalize(in.view_dir);
    s.time         = body.params.x;
    s.accent       = body.accent.rgb;
    s.hover_t      = body.params.w;
    let col = surface(s);
    // Per-pixel Lambert wrap. The parent star's position is fed in via
    // body.light_pos.xyz; body.light_pos.w is the night-side ambient floor.
    // Setting w = 1.0 collapses lit to 1 (self-emissive bodies — stars +
    // halos — render unchanged). For planets/moons w is the small floor
    // value the dev panel exposes so the dark side retains its character
    // instead of going pure black.
    let to_light = body.light_pos.xyz - s.world_pos;
    let L = normalize(to_light);
    let ndl = max(0.0, dot(s.world_normal, L));
    let ambient_floor = body.light_pos.w;
    let lit = ambient_floor + (1.0 - ambient_floor) * ndl;
    // Sun-colour tint — blend the day-side toward the parent star's tint by
    // (ndl * tint_strength). At tint_strength = 0 (default for self-lit
    // bodies) the multiplier is white → no colour shift. At tint_strength
    // = 1 the day-side fully picks up the sun's colour while the night-side
    // (ndl = 0) keeps the planet's own accent identity.
    let tint_strength = body.light_color.w;
    let sun_tint = mix(vec3<f32>(1.0, 1.0, 1.0), body.light_color.rgb, ndl * tint_strength);
    // Universal hover highlight — a bright additive rim that's visible
    // regardless of how saturated the underlying surface() output is. Each
    // shader can still bake its own subtle hover effect on top via s.hover_t;
    // this guarantees a baseline that reads on dark and bright planets alike.
    let hover = body.params.w;
    let view_facing = max(0.0, dot(s.world_normal, s.view_dir));
    let hover_rim = pow(1.0 - view_facing, 2.0) * hover;
    let highlight = vec3<f32>(1.0, 1.0, 1.0) * hover_rim * 0.9
                  + s.accent * hover * 0.35;
    return vec4<f32>(col.rgb * sun_tint * lit + highlight, col.a);
}
