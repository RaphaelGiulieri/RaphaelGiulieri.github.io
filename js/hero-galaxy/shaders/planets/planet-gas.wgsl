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

    // Sample velocity + the passive dye field at this fragment. The dye
    // carries the turbulent surface pattern — when sim is on, the dye
    // visibly drifts with the velocity. When sim is off it stays put.
    let v_here = sample_vel(uv);
    let dye    = sample_dye(uv);
    let speed  = length(v_here);

    // Dye is the dominant visual driver — it's a [0,1] organic-noise
    // field. Smooth tone mapping gives soft cloud-like patches rather than
    // hard cells. Multiplied gently by accent so each system's gas giants
    // keep their discipline colour.
    let dye_tone = smoothstep(0.15, 0.85, dye);
    let cloud_dark  = s.accent * 0.45;
    let cloud_light = s.accent * 1.25;
    let dye_layer = mix(cloud_dark, cloud_light, dye_tone);

    // Soft latitudinal banding — adds a subtle east/west belt structure
    // to the colour without painting crisp stripes. Five major zones
    // across the planet (matching the sim's band target), low amplitude
    // so they read as "subtle tonal shifts" not "painted bars".
    let band_modulation = sin(lat_y * 5.0) * 0.5 + 0.5;
    let band_tinted = mix(dye_layer * 0.92, dye_layer * 1.10, band_modulation);

    // Direction nudge — only kicks in where the wind is fast, and only
    // very faintly. East-flowing bands lean warm, west lean cool.
    let warm = vec3<f32>(1.05, 0.97, 0.88);
    let cool = vec3<f32>(0.88, 0.96, 1.06);
    let dir_x = v_here.x / max(speed, 0.0001);
    let speed_weight = smoothstep(0.0, 0.5, speed);
    let dir_tint = mix(vec3<f32>(1.0), mix(cool, warm, dir_x * 0.5 + 0.5), speed_weight * 0.25);
    let base_with_dir = band_tinted * dir_tint;

    // Object-space fbm shimmer — high-frequency overlay that catches the
    // light differently than the dye. Time-shifted (not advected) so it
    // adds a "convection cells" feel on top of the dye flow.
    let detail = fbm3(p * 7.0 + vec3<f32>(s.time * 0.04, 0.0, 0.0), 3);

    // Storm spot — soft gaussian around a drifting 3D axis. Reduced
    // amplitude so it doesn't overpower the dye-based cloud surface.
    let storm_phase = s.time * 0.03 + 1.2;
    let storm_dir   = vec3<f32>(cos(storm_phase), 0.0, sin(storm_phase));
    let storm_axial = dot(p, storm_dir);
    let storm_lat   = lat_y + 0.3;
    let spot        = exp(-(1.0 - storm_axial) * 26.0 - storm_lat * storm_lat * 18.0);
    let spot_swirl  = sin(storm_axial * 38.0 + storm_lat * 32.0 + s.time * 0.55) * 0.5 + 0.5;
    let storm_hot   = s.accent * spot * (0.5 + spot_swirl * 0.3) * 0.6;

    // Detail at low amplitude — a "convection shimmer" that breaks up the
    // dye field without re-introducing crisp pattern.
    let base_with_detail = base_with_dir + s.accent * (detail - 0.5) * 0.10;

    let rim = fresnel(s.view_dir, s.world_normal, 2.4);
    return vec4<f32>(
        base_with_detail + storm_hot + s.accent * rim * (0.35 + s.hover_t * 1.0),
        1.0);
}
