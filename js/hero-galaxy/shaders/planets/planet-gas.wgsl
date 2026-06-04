// Outer-orbit gas giant — Jupiter-style banded fluid. Latitudinal jets
// move in alternating directions; an fbm turbulence layer breaks the bands;
// a single storm-spot vortex (the Great Red Spot motif) drifts slowly.
// Proper sphere tiling (UV.x wraps at the seam, UV.y maps pole-to-pole)
// keeps the bands continuous around the equator.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
    local_pos    : vec3<f32>,
};

fn surface(s: Surface) -> vec4<f32> {
    // All longitudinal effects are expressed as polynomials of the unit
    // sphere's xz components. sin/cos of the longitude angle θ are exactly
    // (z / r_xz) and (x / r_xz) — continuous everywhere, no atan2 wrap, no
    // fract() seam. Latitudinal effects use local_pos.y directly.
    let p = s.local_pos;
    let lat_y = p.y;
    let lat = lat_y * 0.5 + 0.5;
    let r_xz = max(0.001, sqrt(p.x * p.x + p.z * p.z));
    let cos_lon = p.x / r_xz;
    let sin_lon = p.z / r_xz;

    // A rotating longitudinal wave: dot of (cos_lon, sin_lon) with a
    // time-rotating reference vector. Continuous everywhere on the sphere.
    let drift_a = cos_lon * cos(s.time * 0.05) + sin_lon * sin(s.time * 0.05);
    let drift_b = cos_lon * cos(s.time * 0.04 + 0.7) - sin_lon * sin(s.time * 0.04 + 0.7);
    let jet_a = sin(lat_y * 22.0 + drift_a * 2.4);
    let jet_b = sin(lat_y * 13.5 + drift_b * 1.8);
    let jets = (jet_a * 0.6 + jet_b * 0.4) * 0.5 + 0.5;

    // 3D fbm turbulence in object space — tiles seamlessly on the sphere.
    let turb = fbm3(p * 3.5 + vec3<f32>(s.time * 0.04, 0.0, lat_y * 9.0), 4);

    // Storm spot — gaussian around a slowly rotating 3D direction. The
    // distance metric is `1 - dot(p, dir)` which is 0 at the centre, 2 at
    // the antipode. Combined with a latitudinal falloff this localises the
    // spot to one hemisphere on a fixed sub-tropical latitude.
    let storm_phase = s.time * 0.03 + 1.2;
    let storm_dir   = vec3<f32>(cos(storm_phase), 0.0, sin(storm_phase));
    let storm_axial = dot(p, storm_dir);
    let storm_lat   = lat_y + 0.3;
    let spot        = exp(-(1.0 - storm_axial) * 28.0 - storm_lat * storm_lat * 20.0);
    let spot_swirl  = sin(storm_axial * 38.0 + storm_lat * 32.0 + s.time * 0.55) * 0.5 + 0.5;

    let mixed = clamp(jets * 0.7 + (turb - 0.5) * 0.55 + spot * spot_swirl * 0.4, 0.0, 1.0);

    let dark_band  = s.accent * 0.28;
    let light_band = s.accent * 1.55;
    let base = mix(dark_band, light_band, smoothstep(0.0, 1.0, mixed));

    let storm_hot = mix(vec3<f32>(0.0), s.accent * 1.9, spot * (0.6 + spot_swirl * 0.4));

    let rim = fresnel(s.view_dir, s.world_normal, 2.4);
    return vec4<f32>(base + storm_hot * 0.35 + s.accent * rim * (0.45 + s.hover_t * 1.1), 1.0);
}
