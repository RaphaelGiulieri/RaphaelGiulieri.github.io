// Habitable-zone planet — ported subset of the Unity raytraced EarthShader
// (D:/Work/Modern Projects/EarthShader/Assets/Shaders/EarthShader.shader).
// The original raymarches the atmosphere + sea-level shell from a unit
// sphere; here we already sit on the icosphere surface in fs_main, so we
// short-circuit the ray-stepping and evaluate terrain/water/clouds in one
// pass, then composite an atmosphere rim via fresnel.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
};

fn terrain_n(p: vec3<f32>) -> f32 {
    // fbm Perlin → smoothstep → [-1, 1], matching the original
    // TerrainNoise(): smoothstep(0.1, 1.0, n) * 2 - 1.
    let n = fbm3(p, 6);
    return smoothstep(0.1, 1.0, n) * 2.0 - 1.0;
}

fn humidity_n(p: vec3<f32>) -> f32 {
    // Random offset on the terrain noise field, used to bias grass vs rock.
    return fbm3(p + vec3<f32>(102.5, -9.8, 254.8), 3);
}

fn cloud_n(p: vec3<f32>, t: f32) -> f32 {
    let advected = p + vec3<f32>(t * 0.04, 0.0, 0.0);
    let perlin = smoothstep(0.35, 1.0, fbm3(advected, 5));
    return clamp(perlin * 1.6, 0.0, 1.0);
}

fn surface(s: Surface) -> vec4<f32> {
    let p = s.world_pos * 1.6;
    let nT = terrain_n(p);                 // [-1, 1]
    let nH = humidity_n(p * 1.4);          // ~[0, 1]
    let height = nT * 0.5 + 0.5;           // [0, 1]

    // Land mask: above height 0.5 is land. Soft transition near the coast.
    let coast = smoothstep(0.48, 0.52, height);

    // Biome palette
    let snow_col  = vec3<f32>(0.95, 0.97, 0.98);
    let rock_col  = vec3<f32>(0.46, 0.40, 0.35);
    let sand_col  = vec3<f32>(0.86, 0.80, 0.62);
    let grass_col = vec3<f32>(0.32, 0.50, 0.30);

    // Temperature falls off toward poles — used for the snow mask.
    let temp = 1.0 - abs(s.uv_sphere.y * 2.0 - 1.0);
    let coldness = 1.0 - temp;
    let snow_mask  = smoothstep(0.62, 0.88, coldness);
    let alt_snow   = smoothstep(0.82, 0.95, height);   // mountain snow line
    let sand_mask  = smoothstep(0.50, 0.55, height) * (1.0 - smoothstep(0.58, 0.65, height));
    let grass_mask = smoothstep(0.56, 0.70, height) * clamp(nH + 0.2, 0.0, 1.0);

    var land = rock_col;
    land = mix(land, sand_col,  sand_mask);
    land = mix(land, grass_col, grass_mask);
    land = mix(land, snow_col,  max(snow_mask, alt_snow));

    // Water: shallower = lighter / more tinted by accent (lagoon feel).
    let shallow_water = vec3<f32>(0.20, 0.55, 0.65);
    let deep_water    = vec3<f32>(0.02, 0.10, 0.28);
    let water_depth = clamp(1.0 - height * 2.0, 0.0, 1.0);
    let water = mix(shallow_water, deep_water, water_depth);

    var base = mix(water, land, coast);

    // Cloud layer — animated, washes the visible disc; sits between land
    // and atmosphere. Uses cloud_n's perlin+worley-ish noise field.
    let clouds = cloud_n(p * 0.8, s.time);
    let cloud_col = vec3<f32>(0.96, 0.97, 0.99);
    base = mix(base, cloud_col, clouds * 0.55);

    // Atmosphere rim — sky-blue blended with the system's accent so each
    // habitable planet still reads as belonging to its discipline.
    let rim = fresnel(s.view_dir, s.world_normal, 3.2);
    let atmo_col = mix(vec3<f32>(0.30, 0.55, 0.90), s.accent, 0.35);

    return vec4<f32>(base + atmo_col * rim * 0.65 + s.accent * s.hover_t * 0.8, 1.0);
}
