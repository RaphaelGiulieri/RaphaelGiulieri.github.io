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
    // Latitude is just the normalized y; longitude is computed per-fragment
    // from local_pos to keep the wrap discontinuity confined to 1 pixel.
    let lat = s.local_pos.y * 0.5 + 0.5;
    let lon = s.uv_sphere.x;

    // Jet streams — multiple sine harmonics with phase noise so each band
    // wavers instead of being a clean sine. Two layers at different
    // frequencies + opposite drift speeds give the convective layered look.
    let jet_a = sin(lat * 22.0 + sin(lon * 6.2831 + s.time * 0.05) * 2.4);
    let jet_b = sin(lat * 13.5 - s.time * 0.04 + sin(lat * 4.0 + lon * 6.2831) * 1.8);
    let jets = (jet_a * 0.6 + jet_b * 0.4) * 0.5 + 0.5;

    // 3D fbm turbulence — uses world_pos so the noise tiles seamlessly
    // around the sphere (no equatorial UV-seam artefact).
    let turb = fbm3(s.local_pos * 3.5 + vec3<f32>(s.time * 0.04, 0.0, lat * 9.0), 4);

    // Storm spot — gaussian falloff around a slowly drifting location in
    // UV space. Sub-vortex texture from sinusoidal warps the centre.
    let spot_uv = vec2<f32>(fract(lon - s.time * 0.005 + 0.35), lat - 0.62);
    let spot = exp(-(spot_uv.x * spot_uv.x * 60.0 + spot_uv.y * spot_uv.y * 90.0));
    let spot_swirl = sin(spot_uv.x * 38.0 + spot_uv.y * 32.0 + s.time * 0.55) * 0.5 + 0.5;

    let mixed = clamp(jets * 0.7 + (turb - 0.5) * 0.55 + spot * spot_swirl * 0.4, 0.0, 1.0);

    let dark_band  = s.accent * 0.28;
    let light_band = s.accent * 1.55;
    let base = mix(dark_band, light_band, smoothstep(0.0, 1.0, mixed));

    // The storm spot brightens its centre with a hotter highlight.
    let storm_hot = mix(vec3<f32>(0.0), s.accent * 1.9, spot * (0.6 + spot_swirl * 0.4));

    let rim = fresnel(s.view_dir, s.world_normal, 2.4);
    return vec4<f32>(base + storm_hot * 0.35 + s.accent * rim * (0.45 + s.hover_t * 1.1), 1.0);
}
