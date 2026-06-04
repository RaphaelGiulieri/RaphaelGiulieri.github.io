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

fn sample_dye(uv: vec2<f32>) -> f32 {
    let wrap_uv = vec2<f32>(fract(uv.x + 1.0), clamp(uv.y, 0.0, 1.0));
    return textureSampleLevel(vel_field, vel_smp, wrap_uv, 0.0).z;
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

    // Sample the velocity field + the passive dye field at this fragment.
    // The dye is what makes flow visible — initialised with a marbled
    // pattern in fluid-sim.js, advected by the velocity in fluid-sim.wgsl.
    let v_here   = sample_vel(uv);
    let dye      = sample_dye(uv);
    let speed    = length(v_here);
    let dir      = v_here / max(speed, 0.0001);

    // Band intensity from wind speed: faster wind → brighter band.
    let band_t = smoothstep(0.0, 0.7, speed);
    let dark_band  = s.accent * 0.30;
    let light_band = s.accent * 1.55;
    let band = mix(dark_band, light_band, band_t);

    // Dye-driven marbling — dye is a [0,1] field that LIVES on the texture
    // and advects with the flow. Mapping it through a smoothstep gives the
    // dark eddies / bright cells classic Jovian look, and because the dye
    // moves with the field, any motion the sim produces is visible here.
    let dye_marble = smoothstep(0.35, 0.75, dye);
    let dye_layer = mix(s.accent * 0.20, s.accent * 1.40, dye_marble);
    let base = mix(band, dye_layer, 0.55);   // dye dominates so motion is obvious

    // Direction-tint: eastward (vx > 0) leans warmer, westward leans cooler.
    let warm = s.accent * vec3<f32>(1.15, 0.95, 0.78);
    let cool = s.accent * vec3<f32>(0.78, 0.92, 1.15);
    let dir_tint = mix(cool, warm, dir.x * 0.5 + 0.5);
    let base_with_dir = mix(base, dir_tint, 0.18);

    // Object-space fbm detail — a high-frequency overlay that catches the
    // light differently than the dye. Time-shifted, not advected, so it
    // adds a "shimmering convection" feel on top of the dye flow.
    let detail = fbm3(p * 8.0 + vec3<f32>(s.time * 0.05, 0.0, 0.0), 3);

    // Storm spot — kept as a 3D-space gaussian around a drifting axis so it
    // composites consistently regardless of the sim state.
    let storm_phase = s.time * 0.03 + 1.2;
    let storm_dir   = vec3<f32>(cos(storm_phase), 0.0, sin(storm_phase));
    let storm_axial = dot(p, storm_dir);
    let storm_lat   = lat_y + 0.3;
    let spot        = exp(-(1.0 - storm_axial) * 28.0 - storm_lat * storm_lat * 20.0);
    let spot_swirl  = sin(storm_axial * 38.0 + storm_lat * 32.0 + s.time * 0.55) * 0.5 + 0.5;
    let storm_hot   = mix(vec3<f32>(0.0), s.accent * 1.9, spot * (0.6 + spot_swirl * 0.4));

    let base_with_detail = base_with_dir + s.accent * (detail - 0.5) * 0.18;

    let rim = fresnel(s.view_dir, s.world_normal, 2.4);
    return vec4<f32>(
        base_with_detail + storm_hot * 0.35 + s.accent * rim * (0.45 + s.hover_t * 1.1),
        1.0);
}
