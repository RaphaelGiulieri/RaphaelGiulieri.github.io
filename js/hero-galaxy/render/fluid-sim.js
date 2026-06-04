// Per-gas-giant 2D Navier-Stokes fluid sim. Multi-kernel pipeline with
// pressure projection + vorticity confinement — architecture lifted from
// the Remain WebGPU cloud-fluid solver + the Qatar/volumetric-fluid
// vorticity-confinement passes.
//
// PER FRAME PER ACTIVE GAS PLANET:
//   1. cs_advect_vel        velocity ← advect(velocity) · viscosity
//   2. cs_add_forces        velocity += jet + equatorial forcing band
//   3. cs_curl              curl     = curl(velocity)
//   4. cs_vorticity_force   velocity += vorticity confinement
//   5. cs_divergence        div      = -∇·velocity
//   6. cs_jacobi × N        pressure ← Jacobi(pressure, div) (ping-pong)
//   7. cs_pressure_project  velocity ← velocity - ∇pressure
//   8. cs_advect_tracer     tracer   ← advect(tracer) · decay + source
//
// TEXTURES PER PLANET:
//   velocity ping-pong   rgba16float (only .xy used) — 256·128·8·2 = 512 KB
//   tracer   ping-pong   rgba16float (only .x  used) — 256·128·8·2 = 512 KB
//   pressure ping-pong   rgba16float (only .x  used) — 256·128·8·2 = 512 KB
//   curl                 rgba16float (only .x  used) — 256·128·8   = 256 KB
//   divergence           rgba16float (only .x  used) — 256·128·8   = 256 KB
//   Total per planet ≈ 2 MB.
//
// Using rgba16float everywhere (instead of r16float / rg16float) keeps
// every storage texture compatible with a single storageTexture binding
// type — simplifies the BGL layout at the cost of some wasted channels.
// At 5 gas planets total this is ~10 MB. Fine.

const GRID_W   = 256;
const GRID_H   = 128;
const WORKGROUP = 8;
const PRESSURE_ITERS_DEFAULT = 20;

export const FLUID_GRID = { W: GRID_W, H: GRID_H };

// f32 → IEEE-754 binary16 encoding for texture seeding.
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
        return sign | (m >>> (14 - exp));
    }
    return sign | (exp << 10) | (mantissa >> 13);
}

// ─────────────────────────────────────────────────────────────────────────
// Build pipelines once. Each kernel gets its own GPUComputePipeline + BGL.
// All 8 kernels share the same BGL layout — bindings:
//   0: params uniform buffer
//   1: src_a  (textureLoad-sampled texture_2d<f32>)
//   2: src_b  (textureLoad-sampled texture_2d<f32>)
//   3: dst    (rgba16float storage texture write-only)
//   4: lin_smp  (sampler — unused, kept for layout compat)
// Different kernels feed different combinations of textures into the
// src_a/src_b/dst slots via bind groups created per-planet per-pass.
export async function createFluidSim(device) {
    const url = new URL('../shaders/fluid-sim.wgsl', import.meta.url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fluid-sim.wgsl fetch ${res.status}`);
    const code = await res.text();
    const module = device.createShaderModule({ label: 'fluid-sim', code });

    const bgl = device.createBindGroupLayout({
        label: 'fluid-sim BGL',
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
            { binding: 3, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
            { binding: 4, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        ],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });

    function pipe(entryPoint, label) {
        return device.createComputePipeline({
            label, layout, compute: { module, entryPoint },
        });
    }

    const pipelines = {
        advectVel:       pipe('cs_advect_vel',         'fluid · advect velocity'),
        addForces:       pipe('cs_add_forces',         'fluid · add forces'),
        curl:            pipe('cs_curl',               'fluid · curl'),
        vorticityForce:  pipe('cs_vorticity_force',    'fluid · vorticity force'),
        divergence:      pipe('cs_divergence',         'fluid · divergence'),
        jacobi:          pipe('cs_jacobi',             'fluid · jacobi pressure'),
        pressureProject: pipe('cs_pressure_project',   'fluid · pressure project'),
        advectTracer:    pipe('cs_advect_tracer',      'fluid · advect tracer'),
    };

    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    return { bgl, pipelines, sampler };
}

// ─────────────────────────────────────────────────────────────────────────
// Per-planet sim state: 5 textures, all rgba16float for binding-type
// uniformity. Ping-pong pairs: velocity, tracer, pressure. Single
// textures: curl, divergence. Plus a param uniform buffer.
export function createPlanetSim(device, sim, seedOffset = 0) {
    const usage = GPUTextureUsage.STORAGE_BINDING
                | GPUTextureUsage.TEXTURE_BINDING
                | GPUTextureUsage.COPY_DST;
    function tex(label) {
        const t = device.createTexture({
            label, size: [GRID_W, GRID_H], format: 'rgba16float', usage,
        });
        return { tex: t, view: t.createView() };
    }
    const velA  = tex('velA');
    const velB  = tex('velB');
    const trcA  = tex('trcA');
    const trcB  = tex('trcB');
    const presA = tex('presA');
    const presB = tex('presB');
    const curl  = tex('curl');
    const div   = tex('div');

    // Seed everything to zero. Tracer + velocity + pressure all start
    // empty; the field develops from the equatorial forcing alone.
    const zero = new Uint16Array(GRID_W * GRID_H * 4);
    for (const t of [velA, velB, trcA, trcB, presA, presB, curl, div]) {
        device.queue.writeTexture(
            { texture: t.tex }, zero,
            { bytesPerRow: GRID_W * 4 * 2, rowsPerImage: GRID_H },
            [GRID_W, GRID_H, 1],
        );
    }

    const paramBuf = device.createBuffer({
        label: 'fluid params',
        size: 64,   // 16 f32 fields = 64 bytes; matches WGSL FluidParams
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Per-pass bind groups. Recomputed on flip so the ping-pong roles
    // swap. We pre-build BOTH parities so flipping is just a flag toggle.
    function bg(srcA, srcB, dstView) {
        return device.createBindGroup({
            layout: sim.bgl,
            entries: [
                { binding: 0, resource: { buffer: paramBuf } },
                { binding: 1, resource: srcA },
                { binding: 2, resource: srcB },
                { binding: 3, resource: dstView },
                { binding: 4, resource: sim.sampler },
            ],
        });
    }

    return {
        velA, velB, trcA, trcB, presA, presB, curl, div, paramBuf, bg,
        // Per-frame: which texture currently holds the "current" state for
        // each ping-pong field. Toggled inside `tickPlanetSim`.
        velCur: velA,  velNext: velB,
        trcCur: trcA,  trcNext: trcB,
        seedPhase: seedOffset * 17.31,
    };
}

const _params = new Float32Array(16);

// Writes the FluidParams UBO. Layout MUST match WGSL FluidParams exactly.
export function writeSimParams(device, state, dt, time, opts = {}) {
    const viscosity          = opts.viscosity          ?? 0.4;
    const jet_force          = opts.jet_force          ?? 0.5;
    const advect_mul         = opts.advect_mul         ?? 1.0;
    const forcing_rate       = opts.forcing_rate       ?? 0.6;
    const forcing_strength   = opts.forcing_strength   ?? 0.5;
    const forcing_width      = opts.forcing_width      ?? 0.30;
    const tracer_source      = opts.tracer_source      ?? 0.5;
    const tracer_decay       = opts.tracer_decay       ?? 1.0;
    const vorticity_strength = opts.vorticity_strength ?? 18.0;
    _params[0]  = Math.min(0.05, dt);
    _params[1]  = time;
    _params[2]  = GRID_W;
    _params[3]  = GRID_H;
    _params[4]  = viscosity;
    _params[5]  = jet_force;
    _params[6]  = advect_mul;
    _params[7]  = forcing_rate;
    _params[8]  = forcing_strength;
    _params[9]  = forcing_width;
    _params[10] = tracer_source;
    _params[11] = tracer_decay;
    _params[12] = vorticity_strength;
    _params[13] = state.seedPhase;
    _params[14] = 0;
    _params[15] = 0;
    device.queue.writeBuffer(state.paramBuf, 0, _params);
}

// Dispatches one full sim step on `state`. `cpass` must be an active
// GPUComputePassEncoder. After this returns, state.velCur / trcCur point
// at the textures holding the new state — those are what the surface
// shader should sample.
export function tickPlanetSim(cpass, sim, state, pressureIters = PRESSURE_ITERS_DEFAULT) {
    const groups = Math.ceil(GRID_W / WORKGROUP);
    const groupsY = Math.ceil(GRID_H / WORKGROUP);
    const dispatch = () => cpass.dispatchWorkgroups(groups, groupsY);

    // Pick the next ping-pong target for each field. After the pass
    // completes, swap so the just-written texture becomes "cur".
    const vCur = state.velCur;
    const vNxt = state.velCur === state.velA ? state.velB : state.velA;

    // 1. Advect velocity:  velNxt ← advect(vCur, vCur)
    cpass.setPipeline(sim.pipelines.advectVel);
    cpass.setBindGroup(0, state.bg(vCur.view, vCur.view, vNxt.view));
    dispatch();

    // 2. Add forces:       vCur   ← forces(vNxt)
    cpass.setPipeline(sim.pipelines.addForces);
    cpass.setBindGroup(0, state.bg(vNxt.view, vNxt.view, vCur.view));
    dispatch();
    // After step 2, vCur holds the forced velocity.

    // 3. Curl:             curl   ← curl(vCur)
    cpass.setPipeline(sim.pipelines.curl);
    cpass.setBindGroup(0, state.bg(vCur.view, vCur.view, state.curl.view));
    dispatch();

    // 4. Vorticity force:  vNxt   ← vCur + vortForce(curl)
    cpass.setPipeline(sim.pipelines.vorticityForce);
    cpass.setBindGroup(0, state.bg(vCur.view, state.curl.view, vNxt.view));
    dispatch();
    // After step 4, vNxt has vorticity-confined velocity.

    // 5. Divergence:       div    ← -∇·vNxt
    cpass.setPipeline(sim.pipelines.divergence);
    cpass.setBindGroup(0, state.bg(vNxt.view, vNxt.view, state.div.view));
    dispatch();

    // 6. Jacobi pressure ×N — ping-pong between presA / presB.
    //    Initial pressure is whatever was in presA from last frame (warm
    //    start gives faster convergence). Each iteration: presNext ← jac(presPrev, div).
    let pSrc = state.presA, pDst = state.presB;
    for (let i = 0; i < pressureIters; i++) {
        cpass.setPipeline(sim.pipelines.jacobi);
        cpass.setBindGroup(0, state.bg(pSrc.view, state.div.view, pDst.view));
        dispatch();
        const tmp = pSrc; pSrc = pDst; pDst = tmp;
    }
    // pSrc now holds the final pressure.
    // Remember which texture holds the final pressure so next frame we warm-start from it.
    state.presA = pSrc;
    state.presB = pDst;

    // 7. Pressure project: vCur ← vNxt - ∇pressure
    cpass.setPipeline(sim.pipelines.pressureProject);
    cpass.setBindGroup(0, state.bg(vNxt.view, pSrc.view, vCur.view));
    dispatch();
    // vCur now holds the divergence-free velocity.

    // 8. Advect tracer:    trcNxt ← advect(trcCur, vCur) + source
    const tCur = state.trcCur;
    const tNxt = state.trcCur === state.trcA ? state.trcB : state.trcA;
    cpass.setPipeline(sim.pipelines.advectTracer);
    cpass.setBindGroup(0, state.bg(tCur.view, vCur.view, tNxt.view));
    dispatch();

    // Commit new "current" pointers for the surface shader to sample next frame.
    state.velCur = vCur; state.velNext = vNxt;
    state.trcCur = tNxt; state.trcNext = tCur;
}
