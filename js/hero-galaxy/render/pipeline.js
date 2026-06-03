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

export async function getMeshPipeline(device, format, surfacePath) {
    await ensureCore();
    if (_pipelineCache.has(surfacePath)) return _pipelineCache.get(surfacePath);

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
    model  : mat4x4<f32>,
    accent : vec4<f32>,
    params : vec4<f32>,
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
    return surface(s);
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
            targets: [{ format }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less',
        },
    });

    const result = { pipeline, cameraBGL, bodyBGL };
    _pipelineCache.set(surfacePath, result);
    return result;
}
