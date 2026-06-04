// Outer-orbit gas giant — banded fluid surface driven by a live 2D
// Navier-Stokes-ish sim (see fluid-sim.wgsl + render/fluid-sim.js). The
// per-planet velocity texture is sampled here in equirectangular UVs;
// continuity at the longitude seam is preserved by computing UV per
// fragment from local_pos.xz and using a linear-filtering sampler with
// wrap-at-x (handled by sampling fract(uv.x) explicitly).
//
// Visualisation strategy:
//   • Velocity magnitude drives band intensity (faster wind = brighter).
//   • Velocity direction drives a hue shift (E vs W winds tint differently).
//   • A high-frequency fbm in object space adds turbulence that the velocity
//     field then "drags" via a sample-back offset.
//
// When the sim is paused, the texture freezes at its last state — the
// shader doesn't care whether new frames are being computed; it just
// samples whatever is in the velocity texture.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
    local_pos    : vec3<f32>,
};

// Per-body velocity field — extra bindings on the gas-tier body BGL.
@group(1) @binding(1) var vel_field : texture_2d<f32>;
@group(1) @binding(2) var vel_smp   : sampler;

fn sample_vel(uv: vec2<f32>) -> vec2<f32> {
    let wrap_uv = vec2<f32>(fract(uv.x + 1.0), clamp(uv.y, 0.0, 1.0));
    return textureSampleLevel(vel_field, vel_smp, wrap_uv, 0.0).xy;
}

fn surface(s: Surface) -> vec4<f32> {
    let p = s.local_pos;
    let lat_y = p.y;

    // Equirectangular UV derived from the unit sphere position. Continuous
    // and matches what the sim grid is indexed by.
    let r_xz = max(0.001, sqrt(p.x * p.x + p.z * p.z));
    let lon_angle = atan2(p.z, p.x);
    let uv_lon = lon_angle * 0.15915494 + 0.5;     // [0, 1] with 1-px seam
    let uv_lat = lat_y * 0.5 + 0.5;                // [0, 1] pole to pole
    let uv = vec2<f32>(uv_lon, uv_lat);

    // Sample the velocity field at this fragment + a slightly drift-shifted
    // upstream position. The difference forms a flow-line texture: bright
    // where the flow is consistent, broken where it shears.
    let v_here   = sample_vel(uv);
    let speed    = length(v_here);
    let dir      = v_here / max(speed, 0.0001);

    // Drag a fine fbm by the velocity field — gives "rolling cloud" detail
    // that follows the flow rather than sitting static on the surface.
    let drift_uv = uv - v_here * 0.05;
    let drift_p  = vec3<f32>(
        cos(drift_uv.x * 6.2831) * sqrt(1.0 - (drift_uv.y * 2.0 - 1.0) * (drift_uv.y * 2.0 - 1.0)),
        drift_uv.y * 2.0 - 1.0,
        sin(drift_uv.x * 6.2831) * sqrt(1.0 - (drift_uv.y * 2.0 - 1.0) * (drift_uv.y * 2.0 - 1.0)));
    let detail   = fbm3(drift_p * 5.0 + vec3<f32>(s.time * 0.04, 0.0, 0.0), 4);

    // Band intensity: where the wind is fast we brighten; where slow, dark.
    // Mix accent dark→light along a smoothstep of speed so wind speed
    // correlates with visible "brightness of the band".
    let band_t = smoothstep(0.0, 0.7, speed);
    let dark_band  = s.accent * 0.30;
    let light_band = s.accent * 1.55;
    let band = mix(dark_band, light_band, band_t);

    // Direction-tint: eastward (vx > 0) leans warmer, westward leans cooler.
    // For colour-tinted suns this reads as natural shading; for white suns
    // it provides subtle directional cue.
    let warm = s.accent * vec3<f32>(1.15, 0.95, 0.78);
    let cool = s.accent * vec3<f32>(0.78, 0.92, 1.15);
    let dir_tint = mix(cool, warm, dir.x * 0.5 + 0.5);
    let base = mix(band, dir_tint, 0.25);

    // Storm spot — kept as a 3D-space gaussian around a drifting axis so it
    // composites consistently regardless of the sim state.
    let storm_phase = s.time * 0.03 + 1.2;
    let storm_dir   = vec3<f32>(cos(storm_phase), 0.0, sin(storm_phase));
    let storm_axial = dot(p, storm_dir);
    let storm_lat   = lat_y + 0.3;
    let spot        = exp(-(1.0 - storm_axial) * 28.0 - storm_lat * storm_lat * 20.0);
    let spot_swirl  = sin(storm_axial * 38.0 + storm_lat * 32.0 + s.time * 0.55) * 0.5 + 0.5;
    let storm_hot   = mix(vec3<f32>(0.0), s.accent * 1.9, spot * (0.6 + spot_swirl * 0.4));

    let base_with_detail = base + s.accent * (detail - 0.5) * 0.18;

    let rim = fresnel(s.view_dir, s.world_normal, 2.4);
    return vec4<f32>(
        base_with_detail + storm_hot * 0.35 + s.accent * rim * (0.45 + s.hover_t * 1.1),
        1.0);
}
