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

// f32 → IEEE 754 binary16 encoding. Returns a Uint16 of the bit pattern.
// Used to pre-pack the initial velocity field into the format the GPU
// expects for an rgba16float texture upload.
const _f32buf = new Float32Array(1);
const _u32buf = new Uint32Array(_f32buf.buffer);
function f32ToF16(val) {
    _f32buf[0] = val;
    const x = _u32buf[0];
    const sign = (x >> 16) & 0x8000;
    const expBits = (x >> 23) & 0xff;
    const mantissa = x & 0x7fffff;
    if (expBits === 0xff) return mantissa ? (sign | 0x7fff) : (sign | 0x7c00);
    let exp = expBits - 127 + 15;
    if (exp >= 31) return sign | 0x7c00;
    if (exp <= 0) {
        if (exp < -10) return sign;
        const m = mantissa | 0x800000;
        const shift = 14 - exp;
        return sign | (m >>> shift);
    }
    return sign | (exp << 10) | (mantissa >> 13);
}

export async function createFluidSim(device) {
    const url = new URL('../shaders/fluid-sim.wgsl', import.meta.url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fluid-sim.wgsl fetch ${res.status}`);
    const code = await res.text();
    const module = device.createShaderModule({ label: 'fluid-sim', code });

    // rgba16float is filterable AND a permitted storage texture format, so
    // both the compute back-trace and the mesh shader can use linear
    // bilinear interpolation on the velocity field without any per-sample
    // bit-twiddling. Only .xy is read — .zw stays zero (reserved for a
    // future divergence/pressure channel).
    const computeBGL = device.createBindGroupLayout({
        label: 'fluid-sim compute BGL',
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 3, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        ],
    });

    const pipeline = device.createComputePipeline({
        label: 'fluid-sim compute',
        layout: device.createPipelineLayout({ bindGroupLayouts: [computeBGL] }),
        compute: { module, entryPoint: 'cs_main' },
    });

    // Both samplers are filtering linear — the compute side traces the
    // velocity field backwards continuously, the mesh side reads it with
    // smooth bilinear edges. Same sampler can serve both roles.
    const computeSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
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
    const texA = device.createTexture({ label: `fluid-A`, size: [GRID_W, GRID_H], format: 'rgba16float', usage });
    const texB = device.createTexture({ label: `fluid-B`, size: [GRID_W, GRID_H], format: 'rgba16float', usage });
    const viewA = texA.createView();
    const viewB = texB.createView();

    // Seed: banded zonal jets in .xy + a marbled lon-varying dye field in
    // .z. The dye gives the surface shader something to visualise that
    // makes flow obvious — when sim is on, the dye drifts east/west with
    // the jet streams; when sim is off, the dye stays put.
    const init16 = new Uint16Array(GRID_W * GRID_H * 4);
    for (let y = 0; y < GRID_H; y++) {
        const lat = (y + 0.5) / GRID_H * 2.0 - 1.0;
        const band = Math.sin(lat * 22.0) * 0.6;
        for (let x = 0; x < GRID_W; x++) {
            const h = Math.sin((x * 12.9898 + y * 78.233 + seedOffset * 3.7) * 43758.5453);
            const noise_x = (h - Math.floor(h)) - 0.5;
            const h2 = Math.sin((x * 39.346 + y * 11.135 + seedOffset * 5.1) * 16807.0);
            const noise_y = (h2 - Math.floor(h2)) - 0.5;
            // Dye: cellular marbling. Multiple sine harmonics across lon
            // produce a 2D-noise-like pattern; per-planet seed shifts the
            // phase so different gas giants get distinct dye textures.
            const lon = x / GRID_W * Math.PI * 2;
            const dye =
                0.5 +
                0.30 * Math.sin(lon * 4 + lat * 6 + seedOffset * 1.7) +
                0.20 * Math.sin(lon * 11 - lat * 3 + seedOffset * 2.1) +
                0.15 * Math.sin(lon * 19 + lat * 9 + seedOffset * 0.7);
            const i = (y * GRID_W + x) * 4;
            init16[i + 0] = f32ToF16(band + noise_x * 0.08);
            init16[i + 1] = f32ToF16(noise_y * 0.04);
            init16[i + 2] = f32ToF16(Math.max(0, Math.min(1, dye)));
            init16[i + 3] = 0;
        }
    }
    device.queue.writeTexture(
        { texture: texA },
        init16,
        { bytesPerRow: GRID_W * 4 * 2, rowsPerImage: GRID_H },
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
