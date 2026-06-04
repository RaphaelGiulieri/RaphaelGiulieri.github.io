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

// Deterministic 3D value-noise + fbm, used to seed the dye field with an
// organic non-banded pattern. The same noise call returns the same value
// for the same (x,y,z) input — important so re-seeding a planet's sim
// produces a reproducible texture, and so reloads of the page don't
// suddenly shift everyone's gas giants to a new pattern.
function hash3(x, y, z) {
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return h - Math.floor(h);
}

function noise1(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi,        yf = y - yi,        zf = z - zi;
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    const sz = zf * zf * (3 - 2 * zf);
    // Trilinear-blend the 8 lattice corner hashes.
    function lerp(a, b, t) { return a + (b - a) * t; }
    const c000 = hash3(xi,     yi,     zi    );
    const c100 = hash3(xi + 1, yi,     zi    );
    const c010 = hash3(xi,     yi + 1, zi    );
    const c110 = hash3(xi + 1, yi + 1, zi    );
    const c001 = hash3(xi,     yi,     zi + 1);
    const c101 = hash3(xi + 1, yi,     zi + 1);
    const c011 = hash3(xi,     yi + 1, zi + 1);
    const c111 = hash3(xi + 1, yi + 1, zi + 1);
    const x00 = lerp(c000, c100, sx);
    const x10 = lerp(c010, c110, sx);
    const x01 = lerp(c001, c101, sx);
    const x11 = lerp(c011, c111, sx);
    const y0  = lerp(x00,  x10,  sy);
    const y1  = lerp(x01,  x11,  sy);
    return lerp(y0, y1, sz);
}

function fbm3d(x, y, z, octaves) {
    let v = 0, amp = 0.5, f = 1;
    for (let i = 0; i < octaves; i++) {
        v += amp * noise1(x * f, y * f, z * f);
        f *= 2.03;
        amp *= 0.55;
    }
    return v;
}

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

    // Seed: gentle banded velocity in .xy + a 3D-fbm dye field sampled on
    // the unit sphere in .z. The dye has organic turbulent structure (not
    // sine harmonics) so the gas giant reads as a cloudy fluid surface
    // even when the sim is paused. Per-planet seedOffset rotates the
    // sample point so each gas giant gets a distinct pattern.
    const init16 = new Uint16Array(GRID_W * GRID_H * 4);
    const phase = seedOffset * 17.31;
    for (let y = 0; y < GRID_H; y++) {
        const lat = (y + 0.5) / GRID_H * Math.PI - Math.PI / 2;       // -π/2 … π/2
        const cosLat = Math.cos(lat);
        const sinLat = Math.sin(lat);
        // Soft banded zonal target — 5 major jets across the planet, not 22.
        // Amplitude reduced so the bands aren't visually overwhelming.
        const band = Math.sin(lat * 5.0) * 0.35;
        for (let x = 0; x < GRID_W; x++) {
            const lon = (x + 0.5) / GRID_W * Math.PI * 2;
            // Unit-sphere position for noise sampling. fbm in 3D space is
            // seamless across the longitude seam — no stitching artifacts.
            const sx = Math.cos(lon) * cosLat;
            const sy = sinLat;
            const sz = Math.sin(lon) * cosLat;
            const dye = fbm3d(sx * 2.4 + phase, sy * 2.4, sz * 2.4 - phase, 5);
            // Light turbulent perturbation on the velocity too — gives the
            // sim something non-uniform to advect from the first frame.
            const nx = (noise1(sx * 4.0 + phase + 100, sy * 4.0, sz * 4.0) - 0.5) * 0.18;
            const ny = (noise1(sx * 4.0, sy * 4.0 + phase + 200, sz * 4.0) - 0.5) * 0.10;
            const i = (y * GRID_W + x) * 4;
            init16[i + 0] = f32ToF16(band + nx);
            init16[i + 1] = f32ToF16(ny);
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
