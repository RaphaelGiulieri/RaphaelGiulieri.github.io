// Inner-orbit rocky planet — cratered surface, no atmosphere, accent-tinted.
// Used for the closest planet to each sun by orbit-radius rank.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
};

fn surface(s: Surface) -> vec4<f32> {
    let p = s.world_pos * 5.5;
    // Voronoi cells form craters; small-scale fbm adds noise / terrain bumps.
    let cra = voronoi(p);
    let craterEdge = smoothstep(0.0, 0.15, cra);
    let bumps = fbm3(p * 2.6, 4);
    let smallBumps = fbm3(p * 9.0, 3) * 0.25;
    // Base rock tone, modulated by craters + bumps.
    let rockA = vec3<f32>(0.42, 0.36, 0.32);
    let rockB = vec3<f32>(0.62, 0.55, 0.48);
    let baseRock = mix(rockA, rockB, smoothstep(0.3, 0.8, bumps));
    // Subtle accent tint pulls each rocky planet into its system's palette
    // without overwhelming the natural stone colour.
    let tinted = mix(baseRock, baseRock * s.accent * 1.8, 0.22);
    // Craters darken; small bumps brighten micro-relief.
    let surf = tinted * (0.5 + craterEdge * 0.55) + tinted * smallBumps;
    // Faint rim — no real atmosphere, just edge sheen from the sun.
    let rim = fresnel(s.view_dir, s.world_normal, 4.5);
    return vec4<f32>(surf + s.accent * rim * 0.15 + s.accent * s.hover_t * 0.7, 1.0);
}
