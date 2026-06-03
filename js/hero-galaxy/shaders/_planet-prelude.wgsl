// Helper library prepended to every per-planet surface shader.
// Provides noise, palette, fresnel utilities so authors don't copy-paste.

fn hash13(p3: vec3<f32>) -> f32 {
    var p = fract(p3 * 0.1031);
    p = p + dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

fn noise3(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let n000 = hash13(i + vec3<f32>(0.0, 0.0, 0.0));
    let n100 = hash13(i + vec3<f32>(1.0, 0.0, 0.0));
    let n010 = hash13(i + vec3<f32>(0.0, 1.0, 0.0));
    let n110 = hash13(i + vec3<f32>(1.0, 1.0, 0.0));
    let n001 = hash13(i + vec3<f32>(0.0, 0.0, 1.0));
    let n101 = hash13(i + vec3<f32>(1.0, 0.0, 1.0));
    let n011 = hash13(i + vec3<f32>(0.0, 1.0, 1.0));
    let n111 = hash13(i + vec3<f32>(1.0, 1.0, 1.0));
    let nx00 = mix(n000, n100, u.x);
    let nx10 = mix(n010, n110, u.x);
    let nx01 = mix(n001, n101, u.x);
    let nx11 = mix(n011, n111, u.x);
    return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z);
}

fn fbm3(p: vec3<f32>, octaves: i32) -> f32 {
    var s = 0.0;
    var a = 0.5;
    var f = 1.0;
    for (var i = 0; i < octaves; i++) {
        s = s + a * noise3(p * f);
        f = f * 2.02;
        a = a * 0.5;
    }
    return s;
}

fn voronoi(p: vec3<f32>) -> f32 {
    let ip = floor(p);
    let fp = fract(p);
    var d = 1e9;
    for (var z = -1; z <= 1; z++) {
        for (var y = -1; y <= 1; y++) {
            for (var x = -1; x <= 1; x++) {
                let g = vec3<f32>(f32(x), f32(y), f32(z));
                let o = vec3<f32>(
                    hash13(ip + g + vec3<f32>(0.1, 0.0, 0.0)),
                    hash13(ip + g + vec3<f32>(0.0, 0.1, 0.0)),
                    hash13(ip + g + vec3<f32>(0.0, 0.0, 0.1)));
                let r = g + o - fp;
                d = min(d, dot(r, r));
            }
        }
    }
    return sqrt(d);
}

fn palette(t: f32, base: vec3<f32>, ramp: vec3<f32>) -> vec3<f32> {
    return base + ramp * cos(6.2831853 * (t + vec3<f32>(0.0, 0.33, 0.67)));
}

fn fresnel(view_dir: vec3<f32>, normal: vec3<f32>, power: f32) -> f32 {
    return pow(1.0 - max(0.0, dot(view_dir, normal)), power);
}
