// Mesh pipeline builder + shader cache. Each surface shader gets one cached
// pipeline keyed by its file path. Compile failures fall back to the default
// surface shader and log the diagnostic.

const SHADER_DIR = new URL('../shaders/', import.meta.url);

const _wgslCache     = new Map();   // path → source string
const _pipelineCache = new Map();   // surfacePath → { pipeline, cameraBGL, bodyBGL }

let _prelude        = null;
let _vertex         = null;
let _defaultSurface = null;

async function fetchWgsl(path) {
    if (_wgslCache.has(path)) return _wgslCache.get(path);
    const url = new URL(path, SHADER_DIR);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`wgsl ${res.status}: ${url}`);
    const txt = await res.text();
    _wgslCache.set(path, txt);
    return txt;
}

async function ensureCore() {
    if (_prelude && _vertex && _defaultSurface) return;
    [_prelude, _vertex, _defaultSurface] = await Promise.all([
        fetchWgsl('_planet-prelude.wgsl'),
        fetchWgsl('mesh-vertex.wgsl'),
        fetchWgsl('default-planet.wgsl'),
    ]);
}

export async function getMeshPipeline(device, format, surfacePath, opts = {}) {
    await ensureCore();
    // Distinct cache key for blend variants so callers don't collide.
    const cacheKey = opts.alphaBlend ? `${surfacePath}::alpha` : surfacePath;
    if (_pipelineCache.has(cacheKey)) return _pipelineCache.get(cacheKey);

    let surface = _defaultSurface;
    let usingFallback = surfacePath === 'default-planet.wgsl';
    if (!usingFallback) {
        try {
            surface = await fetchWgsl(surfacePath);
        } catch (e) {
            console.warn('[hero-galaxy] shader fetch failed, falling back:', surfacePath, e);
            surface = _defaultSurface;
            usingFallback = true;
        }
    }

    const vertexCode = `${_prelude}\n${_vertex}`;
    const fragmentCode = `
${_prelude}

${surface}

struct VertexOut {
    @builtin(position) clip_pos     : vec4<f32>,
    @location(0)       world_pos    : vec3<f32>,
    @location(1)       world_normal : vec3<f32>,
    @location(2)       uv_sphere    : vec2<f32>,
    @location(3)       view_dir     : vec3<f32>,
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
    s.uv_sphere    = in.uv_sphere;
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
    return vec4<f32>(col.rgb * sun_tint * lit, col.a);
}
`;

    const vertexModule   = device.createShaderModule({ label: `vert ${surfacePath}`, code: vertexCode });
    const fragmentModule = device.createShaderModule({ label: `frag ${surfacePath}`, code: fragmentCode });

    if (fragmentModule.getCompilationInfo) {
        const compInfo = await fragmentModule.getCompilationInfo();
        const hasError = compInfo.messages.some(m => m.type === 'error');
        if (hasError && !usingFallback) {
            console.warn('[hero-galaxy] shader compile error, falling back:', surfacePath, compInfo.messages);
            return getMeshPipeline(device, format, 'default-planet.wgsl');
        }
    }

    const cameraBGL = device.createBindGroupLayout({
        label: 'camera BGL',
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    const bodyBGL = device.createBindGroupLayout({
        label: 'body BGL',
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });

    const pipeline = device.createRenderPipeline({
        label: `mesh pipeline ${surfacePath}`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [cameraBGL, bodyBGL] }),
        vertex: {
            module: vertexModule,
            entryPoint: 'vs_main',
            buffers: [{
                arrayStride: 6 * 4,
                attributes: [
                    { shaderLocation: 0, offset: 0,     format: 'float32x3' },
                    { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
                ],
            }],
        },
        fragment: {
            module: fragmentModule,
            entryPoint: 'fs_main',
            targets: [{
                format,
                blend: opts.alphaBlend ? {
                    color: { srcFactor: 'src-alpha', dstFactor: 'one',         operation: 'add' },
                    alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' },
                } : undefined,
            }],
        },
        primitive: {
            topology: 'triangle-list',
            // Halo passes render BACK faces so the inside of the larger sphere
            // is visible (the outside-facing surface would point the wrong way).
            cullMode: opts.alphaBlend ? 'front' : 'back',
        },
        depthStencil: {
            format: 'depth24plus',
            // Halos don't write depth — they're additive over whatever's behind.
            depthWriteEnabled: !opts.alphaBlend,
            depthCompare: 'less',
        },
    });

    const result = { pipeline, cameraBGL, bodyBGL };
    _pipelineCache.set(cacheKey, result);
    return result;
}
