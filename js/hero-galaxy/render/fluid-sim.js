// Per-gas-giant 2D Navier-Stokes-ish fluid sim. Each gas planet allocates
// a pair of ping-pong rg32float textures (128×64, lon × lat) and one
// uniform buffer for sim params. The compute pass advects the velocity
// field by itself with a band-restoring torque to keep Jovian jet streams
// stable. The result is sampled by planets/planet-gas.wgsl.
//
// Lifecycle:
//   const sim       = await createFluidSim(device);
//   const state     = createPlanetSim(device, sim);   // per gas planet
//   tickPlanetSim(pass, sim, state, dt, time, world); // each frame, while focused
//   state.currentTextureView                          // sample THIS in the surface shader
//   state.bindGroupForGasPipeline                     // pre-built bind group for the gas mesh pipeline

const GRID_W = 128;
const GRID_H = 64;
const WORKGROUP = 8;

export async function createFluidSim(device) {
    const url = new URL('../shaders/fluid-sim.wgsl', import.meta.url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fluid-sim.wgsl fetch ${res.status}`);
    const code = await res.text();
    const module = device.createShaderModule({ label: 'fluid-sim', code });

    const computeBGL = device.createBindGroupLayout({
        label: 'fluid-sim compute BGL',
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rg32float' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 3, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'non-filtering' } },
        ],
    });

    const pipeline = device.createComputePipeline({
        label: 'fluid-sim compute',
        layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
        compute: { module, entryPoint: 'cs_main' },
    });

    // The compute sampler must be non-filtering on rg32float. The mesh
    // shader's sampler is created separately (linear, for nice band edges).
    const computeSampler = device.createSampler({});
    const meshSampler    = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    return { pipeline, computeBGL, computeSampler, meshSampler };
}

// One sim instance per gas-giant body. Allocates the ping-pong textures
// plus the param buffer; seeds the initial velocity with banded zonal jets
// plus a low-amplitude noise field so the sim has something to advect from.
export function createPlanetSim(device, sim, seedOffset = 0) {
    const usage = GPUTextureUsage.STORAGE_BINDING
                | GPUTextureUsage.TEXTURE_BINDING
                | GPUTextureUsage.COPY_DST;
    const texA = device.createTexture({ label: `fluid-A`, size: [GRID_W, GRID_H], format: 'rg32float', usage });
    const texB = device.createTexture({ label: `fluid-B`, size: [GRID_W, GRID_H], format: 'rg32float', usage });
    const viewA = texA.createView();
    const viewB = texB.createView();

    // Seed: banded zonal jets + light noise. Determinism comes from a
    // simple per-planet seedOffset so each gas giant gets its own pattern.
    const init = new Float32Array(GRID_W * GRID_H * 2);
    for (let y = 0; y < GRID_H; y++) {
        const lat = (y + 0.5) / GRID_H * 2.0 - 1.0;
        const band = Math.sin(lat * 22.0) * 0.6;
        for (let x = 0; x < GRID_W; x++) {
            const u = (x + 0.5) / GRID_W;
            // Cheap deterministic hash for per-cell noise.
            const h = Math.sin((x * 12.9898 + y * 78.233 + seedOffset * 3.7) * 43758.5453);
            const noise_x = (h - Math.floor(h)) - 0.5;
            const h2 = Math.sin((x * 39.346 + y * 11.135 + seedOffset * 5.1) * 16807.0);
            const noise_y = (h2 - Math.floor(h2)) - 0.5;
            const i = (y * GRID_W + x) * 2;
            init[i + 0] = band + noise_x * 0.08;
            init[i + 1] = noise_y * 0.04;
        }
    }
    device.queue.writeTexture(
        { texture: texA },
        init,
        { bytesPerRow: GRID_W * 2 * 4, rowsPerImage: GRID_H },
        [GRID_W, GRID_H, 1],
    );

    const paramBuf = device.createBuffer({
        label: 'fluid-sim params',
        size: 32,   // 8 f32 fields
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Two compute bind groups: A → B and B → A.
    const computeBG_AB = device.createBindGroup({
        layout: sim.computeBGL,
        entries: [
            { binding: 0, resource: viewA },
            { binding: 1, resource: viewB },
            { binding: 2, resource: { buffer: paramBuf } },
            { binding: 3, resource: sim.computeSampler },
        ],
    });
    const computeBG_BA = device.createBindGroup({
        layout: sim.computeBGL,
        entries: [
            { binding: 0, resource: viewB },
            { binding: 1, resource: viewA },
            { binding: 2, resource: { buffer: paramBuf } },
            { binding: 3, resource: sim.computeSampler },
        ],
    });

    return {
        texA, texB, viewA, viewB,
        paramBuf,
        computeBG_AB, computeBG_BA,
        // currentSampledView: which texture holds the latest valid state. After
        // the compute pass it flips. Initially texA holds the seed.
        currentSampledView: viewA,
        currentSampledTex:  texA,
        // tick parity — false → next compute reads A writes B (output is B)
        flipsToB: false,
    };
}

const _params = new Float32Array(8);

export function tickPlanetSim(pass, sim, state, dt, time, opts = {}) {
    const damping    = opts.damping    ?? 0.08;
    const band_force = opts.band_force ?? 0.6;
    const advect_mul = opts.advect_mul ?? 1.0;

    _params[0] = Math.min(0.05, dt);   // clamp dt so a frame hitch doesn't blow up advection
    _params[1] = time;
    _params[2] = GRID_W;
    _params[3] = GRID_H;
    _params[4] = damping;
    _params[5] = band_force;
    _params[6] = advect_mul;
    _params[7] = 0;
    pass.encoder?.copyBufferToBuffer;   // (no-op; we use writeBuffer below)
    // Note: writeBuffer is called by the caller before the pass is opened —
    // here we just dispatch. See scene.js for the actual write.

    pass.setPipeline(sim.pipeline);
    if (state.flipsToB) {
        pass.setBindGroup(0, state.computeBG_AB);
        state.currentSampledView = state.viewB;
        state.currentSampledTex  = state.texB;
    } else {
        pass.setBindGroup(0, state.computeBG_BA);
        state.currentSampledView = state.viewA;
        state.currentSampledTex  = state.texA;
    }
    pass.dispatchWorkgroups(Math.ceil(GRID_W / WORKGROUP), Math.ceil(GRID_H / WORKGROUP));
    state.flipsToB = !state.flipsToB;
}

// Helper for the caller — write the sim params into the buffer prior to
// opening the compute pass.
export function writeSimParams(device, state, dt, time, opts = {}) {
    const damping    = opts.damping    ?? 0.08;
    const band_force = opts.band_force ?? 0.6;
    const advect_mul = opts.advect_mul ?? 1.0;
    _params[0] = Math.min(0.05, dt);
    _params[1] = time;
    _params[2] = GRID_W;
    _params[3] = GRID_H;
    _params[4] = damping;
    _params[5] = band_force;
    _params[6] = advect_mul;
    _params[7] = 0;
    device.queue.writeBuffer(state.paramBuf, 0, _params);
}

export const FLUID_GRID = { W: GRID_W, H: GRID_H };
