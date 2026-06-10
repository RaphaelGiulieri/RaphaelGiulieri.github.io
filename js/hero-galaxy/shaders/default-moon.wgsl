// Moon surface — proper cratered terrain instead of flat gray.
// • Maria / highland regions (low-freq fbm picks dark plain vs cratered light areas)
// • Two voronoi scales for craters, with bright rims + dark floors
// • Fine fbm roughness for surface detail
// • Subtle system-accent tint so each moon visually belongs to its discipline
// • Lambert applied by fs_main; rim + hover glow stay here

struct Surface {
    world_pos    : vec3<f32>,
    world_normal : vec3<f32>,
    uv_sphere    : vec2<f32>,
    view_dir     : vec3<f32>,
    time         : f32,
    accent       : vec3<f32>,
    hover_t      : f32,
    local_pos    : vec3<f32>,
};

fn surface(s: Surface) -> vec4<f32> {
    let p = s.local_pos;

    // ── Maria (dark basalt plains) vs Highlands (cratered light surface) ──
    // Albedo spread tuned to real lunar values: highland/maria ratio
    // is ~0.6, not the 0.35 we had before. The earlier version made
    // the moon look both sun-lit and deep-shadowed at once — physically
    // impossible under a single light source. The softer smoothstep
    // range avoids the binary "two-tone" look; real maria feather out.
    let regional   = fbm3(p * 2.2, 4);
    let maria_mask = smoothstep(0.44, 0.60, regional);

    let highland_col = vec3<f32>(0.58, 0.53, 0.47);
    let maria_col    = vec3<f32>(0.38, 0.35, 0.32);
    var base = mix(highland_col, maria_col, maria_mask);

    // ── Cratering, two scales ──
    // Large craters (3.5×): rare, prominent — provide the major impact
    // basins like Tycho, Copernicus. Medium craters (8×): numerous, fill
    // the highlands. Each voronoi cell becomes one crater: the cell-edge
    // band is the bright rim, the cell-centre region is the dark floor.
    // Contrast kept gentle — at portfolio viewing scale the moon disc
    // is small, so strong crater shading reads as noise, not detail.
    let v_large = voronoi(p * 3.5);
    let v_med   = voronoi(p * 8.0);

    let rim_large   = smoothstep(0.0, 0.05, v_large)
                    * (1.0 - smoothstep(0.05, 0.18, v_large));
    let floor_large = 1.0 - smoothstep(0.0, 0.04, v_large);

    let rim_med     = smoothstep(0.0, 0.03, v_med)
                    * (1.0 - smoothstep(0.03, 0.09, v_med));
    let floor_med   = 1.0 - smoothstep(0.0, 0.02, v_med);

    // A crater on the lit side is only a few percent darker than the
    // surrounding plain; the deep blacks in lunar photos come from rim
    // shadows we can't fake without a height field. So: gentle.
    base = base * (1.0 - floor_large * 0.18) + rim_large * 0.07;
    base = base * (1.0 - floor_med   * 0.10) + rim_med   * 0.04;

    // ── Fine surface roughness ──
    // High-freq fbm adds the dust-grain micro-relief that catches the
    // sun-lit hemisphere differently from the shaded side.
    let detail = fbm3(p * 12.0, 3);
    base = base + (detail - 0.5) * 0.08;

    // ── Subtle discipline tint ──
    // Each moon picks up ~18% of its parent system's accent colour so the
    // visitor reads "this moon belongs to that discipline" without the
    // surface looking painted. Multiplied not added — preserves the
    // rocky tonal range and just shifts hue.
    base = mix(base, base * s.accent * 1.35, 0.18);

    // ── Hover + rim accent ──
    // Universal hover highlight (the white-rim from fs_main) covers most
    // of the hover feedback; the small accent contribution here adds a
    // coloured halo on top so the moon's discipline colour is the cue.
    let hover_glow = s.accent * s.hover_t * 0.7;
    let rim        = fresnel(s.view_dir, s.world_normal, 3.5);

    return vec4<f32>(
        base + hover_glow + s.accent * rim * (0.08 + s.hover_t * 0.5),
        1.0);
}
