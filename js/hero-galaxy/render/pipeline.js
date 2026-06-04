// Mesh pipeline builder + shader cache. Each surface shader gets one cached
// pipeline keyed by its file path. Compile failures fall back to the default
// surface shader and log the diagnostic.

const SHADER_DIR = new URL('../shaders/', import.meta.url);

const _wgslCache     = new Map();   // path → source string
const _pipelineCache = new Map();   // surfacePath → { pipeline, cameraBGL, bodyBGL }

let _prelude        = null;
let _postlude       = null;
let _vertex         = null;
let _defaultSurface = null;
let _bloomPipeline  = null;

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
    if (_prelude && _postlude && _vertex && _defaultSurface) return;
    [_prelude, _postlude, _vertex, _defaultSurface] = await Promise.all([
        fetchWgsl('_planet-prelude.wgsl'),
        fetchWgsl('_planet-postlude.wgsl'),
        fetchWgsl('mesh-vertex.wgsl'),
        fetchWgsl('default-planet.wgsl'),
    ]);
}

export async function getMeshPipeline(device, format, surfacePath, opts = {}) {
    await ensureCore();
    // Distinct cache key per blend / fluid-binding variant so callers don't collide.
    const variants = [];
    if (opts.alphaBlend)        variants.push('alpha');
    if (opts.withVelocityField) variants.push('vfield');
    const cacheKey = variants.length ? `${surfacePath}::${variants.join(':')}` : surfacePath;
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
    // Fragment module = prelude (noise helpers) + the planet-specific surface
    // shader (defines Surface struct + surface() function) + the postlude
    // (VertexOut, BodyUniforms, fs_main contract). The postlude lives in its
    // own .wgsl file rather than a JS template literal so wgsl-analyzer /
    // IntelliSense can lint it, and so it follows the project's "no inline
    // shader strings" rule.
    const fragmentCode = `${_prelude}\n\n${surface}\n\n${_postlude}`;

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
    // body BGL — uniform buffer always at binding 0. Pipelines that want
    // access to a per-body fluid velocity texture add bindings 1+2 here.
    const bodyEntries = [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ];
    if (opts.withVelocityField) {
        // Velocity field (binding 1) + tracer field (binding 2) + sampler
        // (binding 3). Both fields are rgba16float — surface shader reads
        // velocity.xy and tracer.x.
        bodyEntries.push(
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
            { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        );
    }
    const bodyBGL = device.createBindGroupLayout({ label: 'body BGL', entries: bodyEntries });

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

// Star bloom billboard pipeline. Separate from getMeshPipeline because the
// bloom shader has its own vs_main (builds a camera-facing quad from
// vertex_index — no vertex buffer needed) and renders with additive blend +
// no depth write. Cached singleton.
export async function getBloomPipeline(device, format) {
    if (_bloomPipeline) return _bloomPipeline;
    const source = await fetchWgsl('star-bloom.wgsl');
    const mod = device.createShaderModule({ label: 'star-bloom', code: source });

    const cameraBGL = device.createBindGroupLayout({
        label: 'bloom camera BGL',
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    const bodyBGL = device.createBindGroupLayout({
        label: 'bloom body BGL',
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });

    const pipeline = device.createRenderPipeline({
        label: 'star bloom billboard',
        layout: device.createPipelineLayout({ bindGroupLayouts: [cameraBGL, bodyBGL] }),
        vertex:   { module: mod, entryPoint: 'vs_main' },
        fragment: {
            module: mod, entryPoint: 'fs_main',
            targets: [{
                format,
                blend: {
                    color: { srcFactor: 'src-alpha', dstFactor: 'one',         operation: 'add' },
                    alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' },
                },
            }],
        },
        // 4-vertex triangle-strip → one quad.
        primitive: { topology: 'triangle-strip', cullMode: 'none' },
        // Depth-test against the scene so foreground planets occlude the
        // bloom (correct physical behaviour for "sun behind planet"), but
        // don't write to depth — additive over whatever's behind.
        depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
    });

    _bloomPipeline = { pipeline, cameraBGL, bodyBGL };
    return _bloomPipeline;
}
