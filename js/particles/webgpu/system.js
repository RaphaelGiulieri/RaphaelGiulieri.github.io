// system.js — WebGPU ParticleSystem (Phase 1: stress preset only).
//
// Phase 1 scope: device + canvas init, ping-pong storage buffers, forward-Euler
// update compute pass, instanced-quad render pipeline, CPU-side spawn via
// writeBuffer. No modules, no audio, no postfx, no GPU-side shape sampling.
//
// See docs/superpowers/specs/2026-05-06-particles-phase1-webgpu-mvp-design.md
// for the full design and deliberate divergences from the master plan.

import { RNG } from '../core/rng.js';
import { packSpawnDescriptor, SPAWN_DESCRIPTOR_BYTES } from './spawn-descriptor.js';
import { Grid } from './grid.js';
import { Interact } from './interact.js';

const STORAGE_BUFFER_FLOOR = 134217728;   // 128 MB; required for 1M particles, ample for 250k.
const BYTES_PER_PARTICLE = 80;             // matches WGSL Particle struct layout.
// Cap on the legacy CPU staging buffer for _spawnOne. Production spawn goes
// through cs_spawn (GPU); _spawnOne is only used by the demo's click-burst
// and test-fixture direct injection. 100K × 80B = 8MB CPU memory regardless
// of maxParticles. Bursts beyond this in a single frame are dropped — use
// the GPU spawn path (Emitter bursts/rate) for anything larger.
const STAGING_CAP = 100000;

export class WebGPUParticleSystem {
  constructor({ canvas, device, adapter, format, maxParticles, blend, seed }) {
    this.canvas = canvas;
    this.device = device;
    this.adapter = adapter;
    this.format = format;
    this.context = canvas.getContext('webgpu');
    this.context.configure({
      device,
      format,
      alphaMode: 'premultiplied',
    });

    // Auto-cap maxParticles against adapter limit. Buffer must fit in a single
    // binding, so the cap is limit / BYTES_PER_PARTICLE per buffer (we have two,
    // but each is independently bound, so the cap is per-buffer not summed).
    const limit = adapter.limits.maxStorageBufferBindingSize;
    const cappedMax = Math.min(maxParticles, Math.floor(limit / BYTES_PER_PARTICLE));
    if (cappedMax < maxParticles) {
      console.log(`[particles] maxParticles requested=${maxParticles} applied=${cappedMax} (capped by adapter.maxStorageBufferBindingSize=${limit})`);
    } else {
      console.log(`[particles] maxParticles requested=${maxParticles} applied=${cappedMax}`);
    }
    this.maxParticles = cappedMax;
    this.blend = blend;
    // Particle-particle interaction (uniform spatial grid + boids/SPH solver).
    // mode='none' is the only path enabled until the grid/solver streams land.
    this.interaction = {
      mode: 'none',                 // 'none' | 'boids' | 'sph'
      cellSize: 1.0,
      worldHalfExtent: 25.0,        // grid spans [-25..+25]^3
      boids: {
        sepRadius: 0.5,
        sepWeight: 1.5,
        alignWeight: 1.0,
        cohWeight: 0.8,
        maxAccel: 20.0,
        maxSpeed: 8.0,
      },
      sph: {
        smoothingRadius: 1.0,
        restDensity: 1000.0,
        stiffness: 400.0,
        viscosity: 50.0,
        mass: 1.0,
      },
    };
    this.backend = 'webgpu';

    // CPU-tracked counters (Phase 1: deterministic alive estimate).
    this.alive = 0;
    this.frame = 0;
    this.time = 0;
    this.stats = { spawned: 0, killed: 0, dropped: 0 };
    this._totalSpawned = 0;
    this._spawnLog = [];   // [{ time, count, life }] — for deterministic alive estimate
    this._simMsLast = 0;
    this._renderMsLast = 0;
    this._frameIdx = 0;           // monotonic frame counter used by T21 bound resolver
    this._gridResizeWarned = false; // warn-once flag for live grid param changes

    // Phase 2.5 follow-up: measure REAL presented-frame rate via
    // device.queue.onSubmittedWorkDone(). The demo's rAF-callback-rate
    // counter overstates fps when the GPU is the bottleneck (rAF fires
    // at display refresh; submitted work piles up; frames drop silently).
    // This counts actual GPU-completed render submits.
    this._completedFrames = 0;
    this._inflightRenderFrames = 0;       // submits enqueued, not yet completed
    this._lastFrameCompleteAt = 0;
    this._frameCompleteSamples = [];      // ring of last ~30 completion timestamps

    // Per-frame RNG used by Emitter shape sampling (rng.unit, rng.next).
    // Matches WebGL2 system.js's `this.rng = new RNG(seed)` so the existing
    // Emitter code works unchanged on the WebGPU backend.
    this.rng = new RNG(seed);
    this._seed = seed;

    // Staging buffer fields — initialized here so update()'s _pendingCount check
    // works even before _ensureStagingBuffer() has been called by _spawnOne.
    this._stagingBuffer = null;
    this._stagingF32 = null;
    this._stagingU32 = null;
    this._pendingCount = 0;

    // Per-system curve/gradient LUTs. Lazily allocated when an emitter setup
    // first registers a Curve/Gradient. lutCtx tracks (instance → 1-based id)
    // so the same Curve referenced twice gets one layer. Version maps record
    // the last-uploaded `_version` per instance so _syncEmitterLUTs can detect
    // in-place mutations (e.g. picker edits via Curve.update / Gradient.update)
    // and re-upload only the changed LUTs.
    this._curveLUT = null;          // GPUTexture
    this._gradientLUT = null;       // GPUTexture
    this._lutSampler = null;        // GPUSampler (reused)
    this._curveLayers = 0;          // currently-allocated layer count
    this._gradientLayers = 0;
    this._lutCtx = {
      curveIds: new Map(),          // Curve instance → 1-based layer id
      curveVersions: new Map(),     // Curve instance → last-uploaded _version
      gradientIds: new Map(),       // Gradient instance → 1-based layer id
      gradientVersions: new Map(),  // Gradient instance → last-uploaded _version
    };

    this._smoothingBuffer = null;
    this._firstFrameBuffer = null;
    // Two separate fallbacks: WebGPU forbids the same writable storage buffer
    // being bound to two writable bindings in the same dispatch.
    this._fallbackSmoothing = null;
    this._fallbackFirstFrame = null;
    this._fallbackCurveTex = null;
    this._fallbackGradientTex = null;
    this._fallbackSamplerObj = null;
    this._boundCodegen = null;   // lazily imported
    this._spawnCache = null;     // SpawnPipelineCache, lazy-init on first emitter setup
    this._postfx = null;             // PostFXPipeline, lazy-built on first render
    this._postfxBuildInflight = null; // promise guard for double-init

    // Stream-compaction scratch (Phase 2.5 Stream 3): allocated lazily in
    // _ensureCompactionBuffers on first compaction dispatch.
    this._scanLocalOffsets = null;    // u32 × maxParticles
    this._scanPartialSums  = null;    // u32 × ceil(maxParticles/256)
    this._scanGlobalOffsets = null;   // u32 × ceil(maxParticles/256)
    this._drawIndirectArgs  = null;   // 4 u32: [vertexCount=4, instanceCount=alive, 0, 0]
    this._compactPipelines  = null;   // { local, global, scatter, uniformBuf }
    this._aliveReadbackInflight = false;

    // Per-emitter alive counter (Phase 2.5 follow-up). compaction Pass C
    // atomicAdds at p.emitter_id; CPU mirrors via async readback every 60
    // frames. Demo's countAlive(idx) reads from this CPU array — O(1)
    // instead of the O(N) SoA-Proxy walk that froze rAF at 1M particles.
    this._aliveByEmitterBuffer = null;        // GPU storage buffer, atomic<u32>×MAX_EMITTERS
    this._aliveByEmitterCpu = new Uint32Array(64);  // CPU mirror
    this._aliveByEmitterReadbackInflight = false;

    this.emitters = [];
    this.audioFeed = null;

    // Depth texture for opaque blend mode — lazily allocated.
    this._depthTexture = null;

    // Subscribe to device-lost.
    this._destroyed = false;
    device.lost.then((info) => {
      if (this._destroyed) return;   // ignore lost from explicit destroy()
      this._onDeviceLost(info);
    });

    // Phase 1 stubs — Tasks 9-13 will populate.
    this._pipelinesCompiled = false;

    // Pipeline cache. Imported lazily (compute.js depends on shader files
    // loaded at first use). _pipelinesCompiled is now per-emitter (in
    // emitter._wgpu.pipeline) — the system-wide flag becomes a "cache exists"
    // sentinel only.
    this._pipelineCache = null;   // PipelineCache instance, lazily created in _compilePipelines

    // ---- GPU buffers ----
    const particlesByteSize = BYTES_PER_PARTICLE * this.maxParticles;
    this.particlesA = device.createBuffer({
      label: 'particles A',
      size: particlesByteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.particlesB = device.createBuffer({
      label: 'particles B',
      size: particlesByteSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    if (this.particlesA.size !== particlesByteSize) {
      throw new Error(`storage buffer size mismatch: expected ${particlesByteSize}, got ${this.particlesA.size}`);
    }

    // Uniform buffer: view (mat4) + proj (mat4) + dt + time + pixelScale + max_particles + 2×pad = 16+16+1+1+1+1+2 = 38 floats = 152 bytes; round up to 256.
    this.uniformBuffer = device.createBuffer({
      label: 'particles uniforms',
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._audioUniformsBuffer = device.createBuffer({
      label: 'audio uniforms',
      size: 512,   // 128 × f32 = 32 vec4
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this._audioUniformsScratch = new Float32Array(128);
    this._audioSourceTable = null;   // lazy-loaded on first _writeAudioUniforms call

    // ---- Bind group layouts ----
    this.uniformLayout = device.createBindGroupLayout({
      label: 'particles uniforms layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' } },
        // NEW: audio source values, 128 floats × 4 bytes = 512 bytes
        { binding: 1, visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' } },
      ],
    });
    this.storageReadOnlyLayout = device.createBindGroupLayout({
      label: 'particles storage read-only layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.storageRWLayout = device.createBindGroupLayout({
      label: 'particles storage rw layout',
      entries: [
        // particles — single in-place binding. update.template.wgsl reads
        // and writes this in cs_main; foreign / dead slots return without
        // touching the buffer, so prior emitters' aging in the same frame
        // is preserved.
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        // smoothing_state (rw); zero-sized fallback buffer when unused
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        // firstFrame (rw); same fallback
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.moduleParamsLayout = device.createBindGroupLayout({
      label: 'particles module-params + LUTs layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d-array' } },
        // Gradient LUT (binding 3) is rgba8unorm and uses textureSampleLevel
        // for free GPU-side lerp between gradient stops — that requires a
        // filtering sampler. Curve LUT (binding 1) is r32float (unfilterable)
        // and uses textureLoad, which doesn't touch the sampler at all, so a
        // filtering sampler here is fine for both.
        { binding: 2, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      ],
    });

    // ---- Bind groups (rebuild on swap; we maintain two so we can flip) ----
    this.uniformBindGroup = device.createBindGroup({
      layout: this.uniformLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this._audioUniformsBuffer } },
      ],
    });
    // Allocate the fallback storage buffer now so _rebuildBindGroups can use it
    // for the new bindings 2 & 3 on storageRWLayout before any emitter is added.
    this._ensureFallbackBuffers();
    this._rebuildBindGroups();   // sets this.computeBG_AtoB, computeBG_BtoA, renderBG_A, renderBG_B
    this._readBuffer = this.particlesA;    // current "in" for render/compute read
    this._writeBuffer = this.particlesB;   // current "out" for compute write
    this._buffersAllocated = true;

    // Uniform spatial grid for particle-particle interaction (T6 skeleton).
    // Async initialisation (shader fetch + pipeline build) happens in
    // _compilePipelines via Grid.create(). Set to null here so any code
    // that checks this._grid before the first frame gets a safe sentinel.
    this._grid = null;
  }

  setAudioFeed(feed) { this.audioFeed = feed || null; }

  setSeed(seed) {
    this._seed = seed;
    this.rng.setSeed(seed);
  }

  reset() {
    this.alive = 0;
    this.frame = 0;
    this.time = 0;
    this._totalSpawned = 0;
    this._spawnLog.length = 0;
    this.stats.spawned = 0;
    this.stats.killed = 0;
    this.stats.dropped = 0;
    this._pendingCount = 0;
    this.rng.setSeed(this._seed);
    // Clear both ping-pong buffers so old particles don't keep drifting + rendering.
    if (this.particlesA && this.particlesB) {
      const enc = this.device.createCommandEncoder({ label: 'particles reset clear' });
      enc.clearBuffer(this.particlesA);
      enc.clearBuffer(this.particlesB);
      this.device.queue.submit([enc.finish()]);
    }
    for (const e of this.emitters) e._reset?.();
  }

  // Phase 2.5 follow-up: grow (or shrink) the particle pool at runtime.
  // Destructive — alive particles are lost. Used by the demo to honor a
  // burst.count > current maxParticles without forcing the user to reload.
  async setMaxParticles(n) {
    n = Math.max(1024, n | 0);
    // Apply adapter cap (per-buffer storage limit).
    const limit = this.adapter.limits.maxStorageBufferBindingSize;
    const cappedMax = Math.min(n, Math.floor(limit / BYTES_PER_PARTICLE));
    if (cappedMax === this.maxParticles) return;
    console.log(`[particles] setMaxParticles ${this.maxParticles} → ${cappedMax}`);
    this.maxParticles = cappedMax;

    // Tear down particle ping-pong + compaction scratch (all maxParticles-sized).
    if (this.particlesA) this.particlesA.destroy();
    if (this.particlesB) this.particlesB.destroy();
    if (this._scanLocalOffsets) this._scanLocalOffsets.destroy();
    if (this._scanPartialSums) this._scanPartialSums.destroy();
    if (this._scanGlobalOffsets) this._scanGlobalOffsets.destroy();
    if (this._drawIndirectArgs) this._drawIndirectArgs.destroy();
    if (this._aliveByEmitterBuffer) this._aliveByEmitterBuffer.destroy();
    this._scanLocalOffsets = null;
    this._scanPartialSums = null;
    this._scanGlobalOffsets = null;
    this._drawIndirectArgs = null;
    this._aliveByEmitterBuffer = null;

    // Reallocate particle buffers at the new size.
    const sz = BYTES_PER_PARTICLE * cappedMax;
    this.particlesA = this.device.createBuffer({
      label: 'particles A', size: sz,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this.particlesB = this.device.createBuffer({
      label: 'particles B', size: sz,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    this._readBuffer = this.particlesA;
    this._writeBuffer = this.particlesB;

    // Rebuild render + compute bind groups (they reference particlesA/B by identity).
    this._rebuildBindGroups();

    // Reallocate compaction scratch + per-emitter alive buffer at new size.
    this._ensureCompactionBuffers();

    // Reset state — alive particles are gone with the buffer destroy.
    this.alive = 0;
    this.frame = 0;
    this.time = 0;
    this._aliveByEmitterCpu.fill(0);
    for (const e of this.emitters) e._reset?.();
  }

  async addEmitter(emitter) {
    emitter._attach?.(this);
    emitter.id = this.emitters.length;
    this.emitters.push(emitter);
    if (this._pipelineCache) {
      await this._setupEmitterResources(emitter);
      // Compile this emitter's pipeline (cache hit if it already exists).
      emitter._wgpu.cacheEntry = await this._pipelineCache.getOrBuild(emitter, this._lutCtx);
    }
    return emitter;
  }

  emitterByName(name) {
    for (const e of this.emitters) if (e.config && e.config.name === name) return e;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Step 1: Staging buffer infrastructure + _spawnOne
  // ---------------------------------------------------------------------------

  // _spawnOne / staging buffer is the LEGACY test-fixture spawn path. Production
  // spawn flows through Emitter._updateCPU + cs_spawn (Phase 2.5). This path
  // is kept only because:
  //   1. The headless and test pages directly inject particles via _spawnOne
  //      + ps.vel[slot]= ... etc. for deterministic regression tests.
  //   2. The demo's click-to-burst fires em.burst(100) which still goes through
  //      this path on the WebGPU backend.
  //
  // The staging buffer is CPU memory; at maxParticles=8M it would be 640MB
  // wasted just sitting there. Cap it at STAGING_CAP particles (8MB) and
  // accept that bursts beyond that get dropped — the GPU spawn path is the
  // right tool for >100K spawns anyway.
  _ensureStagingBuffer() {
    if (!this._stagingBuffer) {
      const cap = Math.min(this.maxParticles, STAGING_CAP);
      this._stagingBuffer = new ArrayBuffer(BYTES_PER_PARTICLE * cap);
      this._stagingF32 = new Float32Array(this._stagingBuffer);
      this._stagingU32 = new Uint32Array(this._stagingBuffer);
      this._stagingCap = cap;
      this._pendingCount = 0;
    }
  }

  _spawnOne(emitterId, x, y, z) {
    if (this.alive + this._pendingCount >= this.maxParticles) {
      this.stats.dropped++;
      return -1;
    }
    this._ensureStagingBuffer();
    if (this._pendingCount >= this._stagingCap) {
      // Staging full this frame. Drop the spawn — caller should use Emitter
      // bursts (GPU path) for anything larger than STAGING_CAP per frame.
      this.stats.dropped++;
      return -1;
    }
    const slot = this._pendingCount++;
    const fOff = slot * (BYTES_PER_PARTICLE / 4);   // 20 floats per particle
    const uOff = fOff;                               // u32 view shares the same offset

    // Particle struct layout (matches WGSL exactly):
    // pos.xyz @ 0, _pad0 @ 3, vel.xyz @ 4, density @ 7,
    // color.rgba @ 8..11, size @ 12, rot @ 13, avel @ 14,
    // age @ 15, life @ 16, spawn_idx @ 17, stable_rand @ 18, emitter_id @ 19.
    const f = this._stagingF32, u = this._stagingU32;
    f[fOff + 0] = x;   f[fOff + 1] = y;   f[fOff + 2] = z;   f[fOff + 3] = 0;
    f[fOff + 4] = 0;   f[fOff + 5] = 0;   f[fOff + 6] = 0;   f[fOff + 7] = 0;
    f[fOff + 8] = 1;   f[fOff + 9] = 1;   f[fOff +10] = 1;   f[fOff +11] = 1;
    f[fOff +12] = 1;   // size
    f[fOff +13] = 0;   // rot
    f[fOff +14] = 0;   // avel
    f[fOff +15] = 0;   // age
    f[fOff +16] = 1;   // life — Emitter overwrites via setLifetime/etc. but default 1 is safe.
    f[fOff +17] = this._totalSpawned;  // spawn_idx
    f[fOff +18] = this.rng.next();      // stable_rand — seeded RNG for cross-run determinism (Phase 2B fix #4).
    u[uOff +19] = emitterId >>> 0;

    this._totalSpawned++;
    this.stats.spawned++;
    return slot;   // index into staging buffer; Emitter writes vel/color/etc. here via accessors
  }

  // ---------------------------------------------------------------------------
  // Step 2: SoA accessor proxies over the staging buffer
  // ---------------------------------------------------------------------------

  // SoA-ish views over the staging buffer, indexed by [slot * floatStride + offset].
  // Returns lazy getters that build proxy arrays. Phase 1 trick: we expose
  // typed-array proxies that overlay specific fields of the Particle struct.
  // These are intentionally janky to keep Emitter's existing code working
  // unchanged; Phase 2.5 will introduce a proper batched spawn-descriptor API.
  get pos()        { return this._fieldProxy(0, 3); }
  get vel()        { return this._fieldProxy(4, 3); }
  get color()      { return this._fieldProxy(8, 4); }
  get size()       { return this._fieldScalar(12); }
  get rot()        { return this._fieldScalar(13); }
  get avel()       { return this._fieldScalar(14); }
  get age()        { return this._fieldScalar(15); }
  get life()       { return this._fieldScalar(16); }
  get spawnIdx()   { return this._fieldScalar(17); }
  get stableRand() { return this._fieldScalar(18); }
  get emitterId()  {
    if (!this._emitterIdProxy) {
      this._ensureStagingBuffer();
      // Emitter.id is small int; it lives at u32 offset 19 within each 20-u32 slot.
      // Build a typed-array proxy that maps i → staging[i*20 + 19].
      this._emitterIdProxy = new Proxy({}, {
        get: (_, k) => {
          if (k === 'length') return this.maxParticles;
          const i = +k;
          if (Number.isFinite(i)) return this._stagingU32[i * 20 + 19];
          return undefined;
        },
        set: (_, k, v) => {
          this._stagingU32[+k * 20 + 19] = v >>> 0;
          return true;
        },
      });
    }
    return this._emitterIdProxy;
  }

  _fieldProxy(floatOffset, components) {
    const key = `_proxy_${floatOffset}_${components}`;
    if (this[key]) return this[key];
    this._ensureStagingBuffer();
    const stride = 20;   // floats per particle
    const buf = this._stagingF32;
    this[key] = new Proxy({}, {
      get: (_, k) => {
        if (k === 'length') return this.maxParticles * components;
        const i = +k;
        if (!Number.isFinite(i)) return undefined;
        // Decompose: i = particleIdx * components + componentIdx
        const pIdx = Math.floor(i / components);
        const cIdx = i % components;
        return buf[pIdx * stride + floatOffset + cIdx];
      },
      set: (_, k, v) => {
        const i = +k;
        const pIdx = Math.floor(i / components);
        const cIdx = i % components;
        buf[pIdx * stride + floatOffset + cIdx] = v;
        return true;
      },
    });
    return this[key];
  }

  _fieldScalar(floatOffset) {
    const key = `_scalar_${floatOffset}`;
    if (this[key]) return this[key];
    this._ensureStagingBuffer();
    const stride = 20;
    const buf = this._stagingF32;
    this[key] = new Proxy({}, {
      get: (_, k) => {
        if (k === 'length') return this.maxParticles;
        const i = +k;
        if (!Number.isFinite(i)) return undefined;
        return buf[i * stride + floatOffset];
      },
      set: (_, k, v) => {
        buf[+k * stride + floatOffset] = v;
        return true;
      },
    });
    return this[key];
  }

  _rebuildBindGroups() {
    // Bindings 2 & 3 use fallback buffers until Task 10 wires real
    // smoothing/firstFrame buffers into per-emitter dispatch bind groups.
    // Two distinct buffers: WebGPU forbids binding the same writable storage
    // buffer to two writable bindings in one dispatch.
    // computeBG_AtoB / computeBG_BtoA are vestigial after the in-place
    // update fix — the real update bind group is rebuilt every frame via
    // _buildStorageRWBindGroupForFrame(). Kept here only because some
    // older code paths reference these names; updated to match the new
    // single-binding-0 layout so validation doesn't complain.
    const fbSm = this._fallbackSmoothing;
    const fbFf = this._fallbackFirstFrame;
    this.computeBG_AtoB = this.device.createBindGroup({
      layout: this.storageRWLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particlesA } },
        { binding: 2, resource: { buffer: fbSm } },
        { binding: 3, resource: { buffer: fbFf } },
      ],
    });
    this.computeBG_BtoA = this.device.createBindGroup({
      layout: this.storageRWLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particlesB } },
        { binding: 2, resource: { buffer: fbSm } },
        { binding: 3, resource: { buffer: fbFf } },
      ],
    });
    this.renderBG_A = this.device.createBindGroup({
      layout: this.storageReadOnlyLayout,
      entries: [{ binding: 0, resource: { buffer: this.particlesA } }],
    });
    this.renderBG_B = this.device.createBindGroup({
      layout: this.storageReadOnlyLayout,
      entries: [{ binding: 0, resource: { buffer: this.particlesB } }],
    });
  }

  _ensureLutSampler() {
    if (this._lutSampler) return;
    this._lutSampler = this.device.createSampler({
      label: 'lut sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });
  }

  // Returns true if the LUT texture was reallocated (caller must re-upload
  // ALL existing layers, not just the newly-registered ones — destroying the
  // old texture loses every layer's data).
  _ensureCurveLUT(neededLayers) {
    this._ensureLutSampler();
    if (this._curveLUT && this._curveLayers >= neededLayers) return false;
    if (this._curveLUT) this._curveLUT.destroy();
    this._curveLayers = Math.max(neededLayers, 8);
    this._curveLUT = this.device.createTexture({
      label: 'curve lut',
      size: [256, 1, this._curveLayers],
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    return true;
  }

  _ensureGradientLUT(neededLayers) {
    this._ensureLutSampler();
    if (this._gradientLUT && this._gradientLayers >= neededLayers) return false;
    if (this._gradientLUT) this._gradientLUT.destroy();
    this._gradientLayers = Math.max(neededLayers, 8);
    this._gradientLUT = this.device.createTexture({
      label: 'gradient lut',
      size: [256, 1, this._gradientLayers],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    return true;
  }

  // Walks an emitter's module Bound params, registers any new Curve/Gradient
  // instances (assigning 1-based layer ids), detects in-place mutations via
  // the instance _version field, and uploads new + version-bumped LUTs.
  // Idempotent: already-synced instances at the same version cost only the
  // Map.has + version compare on each call.
  _syncEmitterLUTs(emitter) {
    const curvesToUpload = [];
    const gradientsToUpload = [];
    const checkCurve = (c) => {
      if (!this._lutCtx.curveIds.has(c)) {
        this._lutCtx.curveIds.set(c, this._lutCtx.curveIds.size + 1);
        this._lutCtx.curveVersions.set(c, c._version);
        curvesToUpload.push(c);
      } else if (this._lutCtx.curveVersions.get(c) !== c._version) {
        this._lutCtx.curveVersions.set(c, c._version);
        curvesToUpload.push(c);
      }
    };
    const checkGradient = (g) => {
      if (!this._lutCtx.gradientIds.has(g)) {
        this._lutCtx.gradientIds.set(g, this._lutCtx.gradientIds.size + 1);
        this._lutCtx.gradientVersions.set(g, g._version);
        gradientsToUpload.push(g);
      } else if (this._lutCtx.gradientVersions.get(g) !== g._version) {
        this._lutCtx.gradientVersions.set(g, g._version);
        gradientsToUpload.push(g);
      }
    };
    for (const mod of emitter.config.modules) {
      if (!mod.params) continue;
      for (const v of Object.values(mod.params)) {
        if (v && typeof v === 'object') {
          if (v.constructor && v.constructor.name === 'Curve') checkCurve(v);
          else if (v.constructor && v.constructor.name === 'Gradient') checkGradient(v);
          else if ('source' in v) {
            if (v.curve && v.curve.constructor.name === 'Curve') checkCurve(v.curve);
            if (v.gradient && v.gradient.constructor.name === 'Gradient') checkGradient(v.gradient);
          }
        }
      }
    }
    // Grow LUT textures if needed. If the texture was resized, the old texture
    // (and its data) is destroyed — we must re-upload every registered LUT.
    // Otherwise upload only the changed set (curvesToUpload / gradientsToUpload).
    if (this._lutCtx.curveIds.size > 0) {
      const resized = this._ensureCurveLUT(this._lutCtx.curveIds.size);
      const toUpload = resized ? Array.from(this._lutCtx.curveIds.keys()) : curvesToUpload;
      for (const curve of toUpload) {
        const layer = this._lutCtx.curveIds.get(curve) - 1;
        const tap = new Float32Array(256);
        for (let i = 0; i < 256; i++) tap[i] = curve.sample(i / 255);
        this.device.queue.writeTexture(
          { texture: this._curveLUT, origin: [0, 0, layer] },
          tap.buffer,
          { bytesPerRow: 256 * 4, rowsPerImage: 1 },
          { width: 256, height: 1, depthOrArrayLayers: 1 },
        );
        this._lutCtx.curveVersions.set(curve, curve._version);
      }
    }
    if (this._lutCtx.gradientIds.size > 0) {
      const resized = this._ensureGradientLUT(this._lutCtx.gradientIds.size);
      const toUpload = resized ? Array.from(this._lutCtx.gradientIds.keys()) : gradientsToUpload;
      const tmpRgba = new Float32Array(4);
      for (const gradient of toUpload) {
        const layer = this._lutCtx.gradientIds.get(gradient) - 1;
        const tap = new Uint8Array(256 * 4);
        for (let i = 0; i < 256; i++) {
          gradient.sample(i / 255, tmpRgba);
          tap[i*4 + 0] = Math.round(Math.max(0, Math.min(1, tmpRgba[0])) * 255);
          tap[i*4 + 1] = Math.round(Math.max(0, Math.min(1, tmpRgba[1])) * 255);
          tap[i*4 + 2] = Math.round(Math.max(0, Math.min(1, tmpRgba[2])) * 255);
          tap[i*4 + 3] = Math.round(Math.max(0, Math.min(1, tmpRgba[3])) * 255);
        }
        this.device.queue.writeTexture(
          { texture: this._gradientLUT, origin: [0, 0, layer] },
          tap.buffer,
          { bytesPerRow: 256 * 4, rowsPerImage: 1 },
          { width: 256, height: 1, depthOrArrayLayers: 1 },
        );
        this._lutCtx.gradientVersions.set(gradient, gradient._version);
      }
    }
  }

  // Allocates per-emitter GPU resources: module_params buffer (sized to
  // emitter's Bound count) + module-params bind group. Called by addEmitter.
  // Smoothing-state and firstFrame buffers are system-wide, lazily allocated
  // on first emitter that uses smoothing.
  async _setupEmitterResources(emitter) {
    if (!this._boundCodegen) {
      this._boundCodegen = await import('./bound-codegen.js');
    }
    // Each emitter gets its own smoothing slot cursor (slots 0..15 packed into
    // flags bits 1-4 of each Bound). Reset before _syncEmitterLUTs and
    // serializeBound walks; serializeBound increments it for each smoothed Bound.
    this._lutCtx.smoothingSlotCursor = { value: 0 };
    this._syncEmitterLUTs(emitter);
    const { layout } = this._boundCodegen.emitModuleParamsStruct(emitter);
    const numBounds = layout.length;
    // Layout: numBounds * 64B for the Bound array + 16B trailer for
    // module_enabled: vec4<u32>. The trailer is always present regardless of
    // numBounds so even modules-only-with-flags emitters work.
    const paramsByteSize = numBounds * 64 + 16;
    emitter._wgpu = emitter._wgpu || {};
    emitter._wgpu.paramsBuffer = this.device.createBuffer({
      label: `module_params emitter=${emitter.config?.name ?? emitter.id}`,
      size: paramsByteSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    emitter._wgpu.layout = layout;
    emitter._wgpu.numBounds = numBounds;

    // Per-emitter Uniforms buffer + bind group. Without this, the update
    // loop overwrites a single shared uniformBuffer 29× per frame via
    // queue.writeBuffer; the GPU sees only the LAST write at dispatch
    // time, so every cs_main dispatch ends up with the same `this_emitter_id`
    // and only one emitter actually runs its module pipeline. Per-emitter
    // buffers give each dispatch its own immutable uniform context.
    emitter._wgpu.uniformBuffer = this.device.createBuffer({
      label: `uniforms emitter=${emitter.config?.name ?? emitter.id}`,
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    emitter._wgpu.uniformBindGroup = this.device.createBindGroup({
      layout: this.uniformLayout,
      entries: [
        { binding: 0, resource: { buffer: emitter._wgpu.uniformBuffer } },
        { binding: 1, resource: { buffer: this._audioUniformsBuffer } },
      ],
    });
    // Lazy-allocate smoothing buffers if any Bound on this emitter is smoothed.
    if (this._lutCtx.smoothingSlotCursor.value > 0) {
      this._ensureSmoothingBuffer();
      this._ensureFirstFrameBuffer();
    }

    // Phase 2.5: per-emitter SpawnDescriptor uniform buffer + cs_spawn pipeline.
    // The bind group is rebuilt each frame because particles_out ping-pongs.
    if (!this._spawnCache) {
      const { SpawnPipelineCache } = await import('./spawn-pipeline.js');
      this._spawnCache = new SpawnPipelineCache(this.device);
      await this._spawnCache.getOrBuild();
    }
    emitter._wgpu.spawnUniformBuffer = this.device.createBuffer({
      label: `spawn_descriptor emitter=${emitter.config?.name ?? emitter.id}`,
      size: SPAWN_DESCRIPTOR_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    emitter._wgpu.spawnPipeline = this._spawnCache._pipeline;
    emitter._wgpu.spawnLayout = this._spawnCache._layout;
    emitter._spawnIdxBase = emitter._spawnIdxBase | 0;
    emitter._pendingSpawnCount = emitter._pendingSpawnCount | 0;

    // Stream-3: ensure compaction pipelines + buffers are built before the
    // first frame can dispatch them. Setup is async; update() must stay sync.
    this._ensureCompactionBuffers();
    await this._ensureCompactPipelines();
  }

  // Stream-compaction scratch buffers (Phase 2.5 Stream 3). Sized for
  // maxParticles + per-workgroup metadata. WG_size = 256.
  _ensureCompactionBuffers() {
    if (this._scanLocalOffsets) return;
    const COMPACT_WG = 256;
    const numWGs = Math.ceil(this.maxParticles / COMPACT_WG);
    this._scanLocalOffsets = this.device.createBuffer({
      label: 'compact: scan local offsets',
      size: this.maxParticles * 4,
      usage: GPUBufferUsage.STORAGE,
    });
    this._scanPartialSums = this.device.createBuffer({
      label: 'compact: partial sums',
      size: numWGs * 4,
      usage: GPUBufferUsage.STORAGE,
    });
    this._scanGlobalOffsets = this.device.createBuffer({
      label: 'compact: global offsets',
      size: numWGs * 4,
      usage: GPUBufferUsage.STORAGE,
    });
    this._drawIndirectArgs = this.device.createBuffer({
      label: 'draw indirect args',
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    // vertex_count=4 (instanced quad); instance_count=0 (set by compaction Pass B); rest=0
    this.device.queue.writeBuffer(this._drawIndirectArgs, 0, new Uint32Array([4, 0, 0, 0]));

    // Per-emitter alive counter buffer. 64 emitters × u32 = 256 bytes.
    // Cleared every compaction; Pass C atomicAdds; CPU readback every 60
    // frames into this._aliveByEmitterCpu.
    const MAX_EMITTERS = 64;
    this._aliveByEmitterBuffer = this.device.createBuffer({
      label: 'alive by emitter',
      size: MAX_EMITTERS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.device.queue.writeBuffer(this._aliveByEmitterBuffer, 0, new Uint32Array(MAX_EMITTERS));
  }

  // Build the 3 compaction pipelines (Pass A local scan, Pass B global scan,
  // Pass C scatter). Single-shot — no per-emitter codegen.
  async _ensureCompactPipelines() {
    if (this._compactPipelines) return this._compactPipelines;
    const [tplWgsl, localWgsl, globalWgsl, scatterWgsl] = await Promise.all([
      fetch('/particles/webgpu/shaders/update.template.wgsl').then(r => r.text()),
      fetch('/particles/webgpu/shaders/cs_compact_scan_local.wgsl').then(r => r.text()),
      fetch('/particles/webgpu/shaders/cs_compact_scan_global.wgsl').then(r => r.text()),
      fetch('/particles/webgpu/shaders/cs_compact_scatter.wgsl').then(r => r.text()),
    ]);
    // Extract just the Particle struct from the update template so the
    // compaction shaders can reference the same layout without us redefining it.
    const m = tplWgsl.match(/struct Particle \{[\s\S]*?\}/);
    const particleStruct = m ? m[0] : '';
    const dev = this.device;

    const buildPipe = (label, src, entryPoint, layoutEntries) => {
      const fullSrc = `${particleStruct}\n${src}`;
      const mod = dev.createShaderModule({ label, code: fullSrc });
      const bgl = dev.createBindGroupLayout({ label: `${label} bgl`, entries: layoutEntries });
      const pl = dev.createPipelineLayout({ bindGroupLayouts: [bgl] });
      const pipeline = dev.createComputePipeline({ label, layout: pl, compute: { module: mod, entryPoint } });
      return { pipeline, bgl };
    };

    const localPipe = buildPipe('cs_compact_scan_local', localWgsl, 'cs_compact_scan_local', [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ]);
    const globalPipe = buildPipe('cs_compact_scan_global', globalWgsl, 'cs_compact_scan_global', [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ]);
    const scatterPipe = buildPipe('cs_compact_scatter', scatterWgsl, 'cs_compact_scatter', [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ]);

    const uniformBuf = dev.createBuffer({
      label: 'compact uniforms',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._compactPipelines = { local: localPipe, global: globalPipe, scatter: scatterPipe, uniformBuf };
    return this._compactPipelines;
  }

  // 3-pass stream compaction. Reads from this._readBuffer (post-update),
  // writes tightly-packed alive particles to this._writeBuffer. After this
  // dispatch returns, the caller's existing ping-pong swap will make
  // _writeBuffer the next frame's read side.
  _dispatchCompaction(encoder) {
    if (!this._compactPipelines || !this._scanLocalOffsets) return;
    const COMPACT_WG = 256;
    const high_water = this.alive | 0;
    const num_workgroups = Math.ceil(this.maxParticles / COMPACT_WG);

    // Clear write buffer first: scatter only touches alive slots, so the rest
    // must be zeroed to ensure life=0 → dead-pass-through in next frame's
    // update pass. clearBuffer is cheap (~1ms at 1M particles, memory-bandwidth
    // bound). Without this, stale particle data from N-2 frames ago shows up
    // as ghosts in the unused slot range.
    encoder.clearBuffer(this._writeBuffer);
    // Reset per-emitter alive counters before scatter atomicAdds them up.
    if (this._aliveByEmitterBuffer) encoder.clearBuffer(this._aliveByEmitterBuffer);

    this.device.queue.writeBuffer(this._compactPipelines.uniformBuf, 0,
      new Uint32Array([this.maxParticles, high_water, num_workgroups, 0]));

    const aBG = this.device.createBindGroup({
      layout: this._compactPipelines.local.bgl,
      entries: [
        { binding: 0, resource: { buffer: this._readBuffer } },
        { binding: 1, resource: { buffer: this._scanLocalOffsets } },
        { binding: 2, resource: { buffer: this._scanPartialSums } },
        { binding: 3, resource: { buffer: this._compactPipelines.uniformBuf } },
      ],
    });
    let pass = encoder.beginComputePass({ label: 'compact: pass A' });
    pass.setPipeline(this._compactPipelines.local.pipeline);
    pass.setBindGroup(0, aBG);
    pass.dispatchWorkgroups(num_workgroups);
    pass.end();

    const bBG = this.device.createBindGroup({
      layout: this._compactPipelines.global.bgl,
      entries: [
        { binding: 0, resource: { buffer: this._scanPartialSums } },
        { binding: 1, resource: { buffer: this._scanGlobalOffsets } },
        { binding: 2, resource: { buffer: this._drawIndirectArgs } },
        { binding: 3, resource: { buffer: this._compactPipelines.uniformBuf } },
      ],
    });
    pass = encoder.beginComputePass({ label: 'compact: pass B' });
    pass.setPipeline(this._compactPipelines.global.pipeline);
    pass.setBindGroup(0, bBG);
    pass.dispatchWorkgroups(1);
    pass.end();

    const cBG = this.device.createBindGroup({
      layout: this._compactPipelines.scatter.bgl,
      entries: [
        { binding: 0, resource: { buffer: this._readBuffer } },
        { binding: 1, resource: { buffer: this._writeBuffer } },
        { binding: 2, resource: { buffer: this._scanLocalOffsets } },
        { binding: 3, resource: { buffer: this._scanGlobalOffsets } },
        { binding: 4, resource: { buffer: this._compactPipelines.uniformBuf } },
        { binding: 5, resource: { buffer: this._aliveByEmitterBuffer } },
      ],
    });
    pass = encoder.beginComputePass({ label: 'compact: pass C' });
    pass.setPipeline(this._compactPipelines.scatter.pipeline);
    pass.setBindGroup(0, cBG);
    pass.dispatchWorkgroups(num_workgroups);
    pass.end();
  }

  // Ensure a system-wide smoothing-state buffer exists. Sized
  // 8 × 4 bytes × maxParticles. Allocated lazily on first emitter
  // that registers a smoothed Bound. For Phase 2A's 6 modules, none
  // use smoothing — buffer stays at the small fallback size.
  _ensureSmoothingBuffer() {
    if (this._smoothingBuffer) return;
    const size = 16 * 4 * this.maxParticles;   // 16 slots × 4 bytes per particle (matches 4-bit slot field)
    this._smoothingBuffer = this.device.createBuffer({
      label: 'smoothing state',
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const enc = this.device.createCommandEncoder({ label: 'smoothing init' });
    enc.clearBuffer(this._smoothingBuffer);
    this.device.queue.submit([enc.finish()]);
  }

  _ensureFirstFrameBuffer() {
    if (this._firstFrameBuffer) return;
    const size = 4 * this.maxParticles;
    this._firstFrameBuffer = this.device.createBuffer({
      label: 'first frame flags',
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const enc = this.device.createCommandEncoder({ label: 'first frame init' });
    enc.clearBuffer(this._firstFrameBuffer);
    this.device.queue.submit([enc.finish()]);
  }

  // Fallback buffers used when an emitter doesn't need smoothing/firstFrame
  // but the bind group layout still has a binding for them. Two distinct
  // buffers because WebGPU forbids binding the same writable storage buffer
  // to two writable bindings in one dispatch.
  _ensureFallbackBuffers() {
    if (this._fallbackSmoothing && this._fallbackFirstFrame) return;
    if (!this._fallbackSmoothing) {
      this._fallbackSmoothing = this.device.createBuffer({
        label: 'fallback smoothing (16 bytes)',
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }
    if (!this._fallbackFirstFrame) {
      this._fallbackFirstFrame = this.device.createBuffer({
        label: 'fallback firstFrame (16 bytes)',
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
    }
  }

  async _compilePipelines() {
    // Render pipelines stay per-system (don't depend on emitter modules).
    const [vsWgsl, fsWgsl, fsOpaqueWgsl] = await Promise.all([
      loadWGSL('particle.vs.wgsl'),
      loadWGSL('particle.fs.wgsl'),
      loadWGSL('particle.fs.opaque.wgsl'),
    ]);
    const vsModule = this.device.createShaderModule({ label: 'particle.vs', code: vsWgsl });
    const fsModule = this.device.createShaderModule({ label: 'particle.fs', code: fsWgsl });
    const fsOpaqueModule = this.device.createShaderModule({ label: 'particle.fs.opaque', code: fsOpaqueWgsl });

    const renderLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this.uniformLayout, this.storageReadOnlyLayout],
    });
    const baseRenderDesc = {
      layout: renderLayout,
      vertex: { module: vsModule, entryPoint: 'vs_main' },
      primitive: { topology: 'triangle-strip' },
    };

    // Additive: src-alpha + one, no depth.
    this._pipelineAdditive = this.device.createRenderPipeline({
      ...baseRenderDesc,
      label: 'particle render — additive',
      fragment: {
        module: fsModule,
        entryPoint: 'fs_main',
        targets: [{
          // Phase 4: render targets are the postfx scene texture (rgba16float).
          // Composite pass converts to swapchain LDR format.
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      depthStencil: undefined,
    });

    // Alpha-over: premultiplied alpha blending, no depth.
    this._pipelineAlphaOver = this.device.createRenderPipeline({
      ...baseRenderDesc,
      label: 'particle render — alpha-over',
      fragment: {
        module: fsModule,
        entryPoint: 'fs_main',
        targets: [{
          // Phase 4: render targets are the postfx scene texture (rgba16float).
          // Composite pass converts to swapchain LDR format.
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      depthStencil: undefined,
    });

    // Opaque: no blending, depth test + write.
    // Uses fsOpaqueModule (solid square, no discard) so early-Z works.
    this._pipelineOpaque = this.device.createRenderPipeline({
      ...baseRenderDesc,
      label: 'particle render — opaque',
      fragment: {
        module: fsOpaqueModule,
        entryPoint: 'fs_main',
        targets: [{
          // Phase 4: render targets are the postfx scene texture (rgba16float).
          // Composite pass converts to swapchain LDR format.
          format: 'rgba16float',
          blend: undefined,
        }],
      },
      depthStencil: {
        format: 'depth24plus',
        depthCompare: 'less',
        depthWriteEnabled: true,
      },
    });

    // Keep a backwards-compat alias so any code referencing renderPipeline still works.
    this.renderPipeline = this._pipelineAdditive;

    // Compute pipelines now per-emitter via PipelineCache. Initialize the cache.
    const { PipelineCache } = await import('./compute.js');
    this._pipelineCache = new PipelineCache(this.device, {
      uniformLayout: this.uniformLayout,
      storageRWLayout: this.storageRWLayout,
      moduleParamsLayout: this.moduleParamsLayout,
    });

    // Uniform spatial grid — async because Grid.create() fetches + compiles
    // the grid_clear (and future) shader passes. Must complete before the
    // first frame so grid.clear(encoder) is callable in update().
    this._grid = await Grid.create(
      this.device,
      this.maxParticles,
      this.interaction.worldHalfExtent,
      this.interaction.cellSize,
    );
    // Test hook — allows probe scripts and browser console to inspect the grid.
    if (typeof window !== 'undefined') window.__grid = this._grid;

    // Interaction solver host — owns boids (and future SPH) pipelines.
    // Pipeline is created now but not dispatched until update() detects
    // interaction.mode !== 'none' (Task 15).
    this._interact = await Interact.create(
      this.device,
      this.uniformLayout,
      this.storageRWLayout,
      this._grid.readLayout,
    );
    if (typeof window !== 'undefined') window.__interact = this._interact;

    this._pipelinesCompiled = true;
  }

  _ensureDepthTexture() {
    const w = this.canvas.width, h = this.canvas.height;
    if (this._depthTexture && this._depthTexture.width === w && this._depthTexture.height === h) {
      return this._depthTexture;
    }
    if (this._depthTexture) this._depthTexture.destroy();
    this._depthTexture = this.device.createTexture({
      label: 'particles depth',
      size: [w, h, 1],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    return this._depthTexture;
  }

  _writeUniforms(dt, thisEmitterId = 0, targetBuffer = null) {
    // Layout matches WGSL Uniforms struct: view (16f) + proj (16f) + dt + time + pixel_scale + max_particles_u32 +
    // this_emitter_id u32 + frame_idx u32 + pad. Total fits in 256 bytes.
    // `targetBuffer` lets the update loop write to a per-emitter buffer
    // instead of the shared one — necessary because writeBuffer to the
    // same buffer multiple times in one submit collapses to the last write.
    const buf = new ArrayBuffer(256);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    if (this._currentView) f32.set(this._currentView, 0);
    if (this._currentProj) f32.set(this._currentProj, 16);
    f32[32] = dt;
    f32[33] = this.time;
    f32[34] = this._currentPixelScale ?? 1.0;
    u32[35] = this.maxParticles;
    u32[36] = thisEmitterId;
    u32[37] = this.frame;
    this.device.queue.writeBuffer(targetBuffer ?? this.uniformBuffer, 0, buf);
  }

  _writeAudioUniforms() {
    const buf = this._audioUniformsScratch;
    if (!this.audioFeed) {
      // Zero out — audio sources cleanly return 0 without a feed
      buf.fill(0);
    } else {
      // Lazy-load the audio source table on first call
      if (!this._audioSourceTable) {
        // Synchronous: bound-codegen is already imported lazily elsewhere
        // but here we need the table now — use the cached _boundCodegen if set,
        // otherwise it'll be set up before the first dispatch via _setupEmitterResources.
        if (this._boundCodegen && this._boundCodegen.getAudioSourceTable) {
          this._audioSourceTable = this._boundCodegen.getAudioSourceTable();
        } else {
          // No emitter yet — no module needs audio yet. Zero-fill and skip.
          buf.fill(0);
          this.device.queue.writeBuffer(this._audioUniformsBuffer, 0, buf.buffer);
          return;
        }
      }
      buf.fill(0);   // clear stale slots first
      for (const [name, id] of this._audioSourceTable) {
        const slot = id - 50;
        if (slot >= 0 && slot < 128) {
          const stripped = name.replace(/^audio\./, '');
          buf[slot] = this.audioFeed.sample(stripped) ?? 0;
        }
      }
    }
    this.device.queue.writeBuffer(this._audioUniformsBuffer, 0, buf.buffer);
  }

  // Per-emitter compute dispatch (Task 10). Loops over emitters, looks up each
  // pipeline via PipelineCache, writes module_params, dispatches with per-emitter
  // bind groups. Single buffer swap after all emitters.
  update(dt) {
    const t0 = performance.now();
    // GPU queue backpressure: if more than 2 frames are in-flight on the
    // GPU, skip this update entirely. Without this, rAF fires faster than
    // the GPU can complete frames, the queue grows unboundedly, and frames
    // drop silently — visual stutter while CPU stats lie about high FPS.
    // Skipping here means the next rAF will retry. CPU stays cheap; GPU
    // queue stays bounded; visual smoothness matches reported realFps.
    if (this._inflightRenderFrames > 2) {
      this._simMsLast = performance.now() - t0;
      return;
    }
    if (dt > (1 / 30)) dt = 1 / 30;
    this.time += dt;
    this.frame += 1;
    this._frameIdx++;

    // Warn-and-skip if grid params change at runtime (live resize is async
    // and update() is sync; tell the user to reload).
    if (this._grid && (this._grid.cellSize !== this.interaction.cellSize ||
                        this._grid.halfExtent !== this.interaction.worldHalfExtent)) {
      if (!this._gridResizeWarned) {
        console.warn('Grid cellSize/halfExtent changed at runtime — reload to apply');
        this._gridResizeWarned = true;
      }
    }

    // Phase 2.5: WebGPU emitters use _updateCPU (which bumps _pendingSpawnCount)
    // instead of _update (which CPU-spawns into the staging buffer).
    for (const e of this.emitters) e._updateCPU?.(dt, this.time);

    // Flush staging buffer to GPU before compute dispatch.
    if (this._pendingCount > 0) {
      const byteLen = this._pendingCount * BYTES_PER_PARTICLE;
      const slotOffset = this.alive;
      this.device.queue.writeBuffer(this.particlesA, slotOffset * BYTES_PER_PARTICLE, this._stagingBuffer, 0, byteLen);
      this.device.queue.writeBuffer(this.particlesB, slotOffset * BYTES_PER_PARTICLE, this._stagingBuffer, 0, byteLen);
      this.alive += this._pendingCount;
      const sampleLife = this._stagingF32[16];
      this._spawnLog.push({ time: this.time, count: this._pendingCount, life: sampleLife });
      this._pendingCount = 0;
    }

    if (!this._pipelinesCompiled) {
      this._simMsLast = performance.now() - t0;
      return;
    }
    this._ensureFallbackBuffers();
    this._writeAudioUniforms();

    const encoder = this.device.createCommandEncoder({ label: 'particles update (multi-emitter)' });

    // Phase 2.5 spawn pass — runs BEFORE update so the same frame's gravity /
    // forces apply to newly-spawned particles. Writes into _readBuffer (which
    // update is about to read from); update then propagates the new particles
    // through to _writeBuffer in the same encoder.
    if (this._spawnCache) {
      for (const emitter of this.emitters) {
        if (!emitter._wgpu || !emitter._wgpu.spawnPipeline) continue;
        if (emitter.config.disabled) continue;
        const count = emitter._pendingSpawnCount | 0;
        if (count === 0) continue;
        // Clamp to remaining buffer capacity (spawn what we can, drop the
        // rest). The previous behavior dropped the ENTIRE pending batch the
        // moment it exceeded — typing burst.count = maxParticles+1 spawned
        // 0 particles instead of maxParticles.
        let effectiveCount = count;
        const remaining = this.maxParticles - this.alive;
        if (effectiveCount > remaining) {
          this.stats.dropped += effectiveCount - remaining;
          effectiveCount = Math.max(0, remaining);
          emitter._pendingSpawnCount = effectiveCount;
        }
        if (effectiveCount === 0) { emitter._pendingSpawnCount = 0; continue; }
        const descBuf = new ArrayBuffer(SPAWN_DESCRIPTOR_BYTES);
        emitter._buildSpawnDescriptor?.(descBuf, 0, this.alive, this._readBuffer);
        const stagedCount = new Uint32Array(descBuf, 0, 1)[0];
        if (stagedCount === 0) { emitter._pendingSpawnCount = 0; continue; }
        this.device.queue.writeBuffer(emitter._wgpu.spawnUniformBuffer, 0, descBuf);
        const bg = this.device.createBindGroup({
          label: 'cs_spawn frame bg',
          layout: emitter._wgpu.spawnLayout,
          entries: [
            { binding: 0, resource: { buffer: this._readBuffer } },
            { binding: 1, resource: { buffer: emitter._wgpu.spawnUniformBuffer } },
          ],
        });
        const spawnPass = encoder.beginComputePass({ label: `cs_spawn em=${emitter.id}` });
        spawnPass.setPipeline(emitter._wgpu.spawnPipeline);
        spawnPass.setBindGroup(0, bg);
        spawnPass.dispatchWorkgroups(Math.ceil(stagedCount / 256));
        spawnPass.end();
        this.alive += stagedCount;
        emitter._spawnIdxBase += stagedCount;
        emitter._pendingSpawnCount = 0;
      }
    }

    // ── particle-particle interaction (uniform grid + solver) ─────────────
    // Gated on mode !== 'none' so beats / fountain at default pay zero cost.
    // Frame order convention: grid + solvers run AFTER spawn (so newcomers
    // participate this frame) and BEFORE cs_main (so cs_main integrates the
    // velocity the solver wrote).
    if (this._grid && this._interact && this.interaction.mode !== 'none' && this.alive > 0) {
      // Build the spatial grid for all alive particles.
      this._grid.build(encoder, this.alive, this._readBuffer);
      // Build the @group(1) particle bind group once — solvers reuse it.
      const storageRWBG = this._buildStorageRWBindGroupForFrame();
      // We don't have a per-emitter uniform context here; reuse the first
      // emitter's uniform bind group for SimUniforms.dt/time. The solver
      // shader doesn't read this_emitter_id.
      let uniformBG = null, uniformBuf = null, uniformOwnerId = 0;
      for (const em of this.emitters) {
        if (em._wgpu && em._wgpu.uniformBindGroup) {
          uniformBG = em._wgpu.uniformBindGroup;
          uniformBuf = em._wgpu.uniformBuffer;
          uniformOwnerId = em.id;
          break;
        }
      }
      if (uniformBG) {
        // CRITICAL: write fresh SimUniforms BEFORE dispatch. Without this,
        // u.dt is stale from the LAST frame's per-emitter cs_main loop —
        // solver integrates velocity with the wrong dt. cs_main re-writes
        // its own emitter's uniforms later, so this transient write is safe.
        this._writeUniforms(dt, uniformOwnerId, uniformBuf);
        if (this.interaction.mode === 'boids') {
          this._interact.writeBoidsParams(this.interaction.boids, this, this._frameIdx);
          this._interact.dispatchBoids(encoder, uniformBG, storageRWBG, this._grid.readBindGroup, this.maxParticles);
        } else if (this.interaction.mode === 'sph') {
          // T19: density pass. T20: force pass (pressure + viscosity).
          this._interact.writeSphParams(this.interaction.sph, this, this._frameIdx);
          this._interact.dispatchSphDensity(encoder, uniformBG, storageRWBG, this._grid.readBindGroup, this.maxParticles);
          this._interact.dispatchSphForce  (encoder, uniformBG, storageRWBG, this._grid.readBindGroup, this.maxParticles);
        }
      }
      // else: no enabled emitter → no SimUniforms source → skip solver this
      // frame. Documented: interaction modes require at least one emitter.
    }

    // KNOWN BUG: cs_main is dispatched per emitter, each pass reads
    // _readBuffer (binding 0, read-only-storage) and writes _writeBuffer
    // (binding 1, storage). The foreign-emitter pass-through copies
    // _readBuffer[i] → _writeBuffer[i] unchanged. Without buffer chaining
    // between dispatches, each subsequent emitter's pass-through
    // overwrites the previous emitter's aging.
    // Mid-loop A↔B swaps (tried, didn't take — possibly a GPU read-cache
    // issue across dispatches with the same buffer alternating roles).
    // Net effect: only the LAST emitter in this.emitters has its
    // particles aged + moved. All other emitters' particles are stuck
    // at age=0, position=spawn-disc.
    // Workaround: order emitters so the visually-important channel is
    // last. Real fix: single all-emitter cs_main with per-particle
    // module dispatch (codegen-merged), or single read_write binding.
    for (const emitter of this.emitters) {
      if (!emitter._wgpu || !emitter._wgpu.paramsBuffer || !emitter._wgpu.cacheEntry) continue;
      // Note: a disabled emitter still dispatches — its particles must keep
      // ageing and integrating (matching WebGL2). _packModuleParams forces
      // the module_enabled bitmask to 0 in that case so all module snippets
      // skip while the integrate / age / death pipeline still runs.
      // Pack module_params buffer for this emitter.
      this._packModuleParams(emitter);
      // Write per-emitter uniforms (this_emitter_id + dt + time + ...) to
      // the EMITTER'S OWN buffer. Writing to a single shared uniformBuffer
      // here would race: WebGPU's queue.writeBuffer collapses repeated
      // writes within one submit to the last value, so every dispatch
      // would see the same emitter_id (the last one in the loop).
      this._writeUniforms(dt, emitter.id, emitter._wgpu.uniformBuffer);
      // Per-emitter bind group for module_params + LUTs.
      const moduleParamsBG = this.device.createBindGroup({
        layout: this.moduleParamsLayout,
        entries: [
          { binding: 0, resource: { buffer: emitter._wgpu.paramsBuffer } },
          { binding: 1, resource: (this._curveLUT ?? this._fallbackCurveTexture()).createView({ dimension: '2d-array' }) },
          { binding: 2, resource: this._lutSampler ?? this._fallbackSampler() },
          { binding: 3, resource: (this._gradientLUT ?? this._fallbackGradientTexture()).createView({ dimension: '2d-array' }) },
        ],
      });
      const storageRWBG = this._buildStorageRWBindGroupForFrame();
      const pass = encoder.beginComputePass({ label: `update emitter=${emitter.id}` });
      pass.setPipeline(emitter._wgpu.cacheEntry.pipeline);
      pass.setBindGroup(0, emitter._wgpu.uniformBindGroup);
      pass.setBindGroup(1, storageRWBG);
      pass.setBindGroup(2, moduleParamsBG);
      pass.dispatchWorkgroups(Math.ceil(this.maxParticles / 256));
      pass.end();
    }
    // No post-update swap needed — cs_main now updates particles in place,
    // so _readBuffer already holds the post-update state. Compaction reads
    // it directly. The post-compaction swap below still does its job of
    // moving the compacted set into _readBuffer for the next frame.

    // Stream-3: stream compaction. Reads _readBuffer (post-update), scatters
    // alive particles into _writeBuffer (cleared first). Writes new
    // alive_count to draw_indirect[1].
    this._dispatchCompaction(encoder);

    this.device.queue.submit([encoder.finish()]);

    // Final swap so next frame reads the compacted set.
    const tmp = this._readBuffer;
    this._readBuffer = this._writeBuffer;
    this._writeBuffer = tmp;

    // Async readback alive_count from indirect args every 60 frames. Off the
    // critical path; we only need an approximate CPU mirror for spawn budgeting.
    if ((this.frame % 60) === 0 && !this._aliveReadbackInflight && this._drawIndirectArgs) {
      this._aliveReadbackInflight = true;
      const rb = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const e = this.device.createCommandEncoder({ label: 'alive readback' });
      e.copyBufferToBuffer(this._drawIndirectArgs, 0, rb, 0, 16);
      this.device.queue.submit([e.finish()]);
      rb.mapAsync(GPUMapMode.READ).then(() => {
        const u = new Uint32Array(rb.getMappedRange());
        this.alive = u[1] | 0;       // instance_count (post-compaction alive)
        rb.unmap();
        rb.destroy();
        this._aliveReadbackInflight = false;
      }).catch(err => {
        console.warn('[particles] alive readback failed:', err);
        this._aliveReadbackInflight = false;
      });
    }

    // Async per-emitter alive readback, also every 60 frames. CPU mirror
    // populates this._aliveByEmitterCpu so demo's countAlive(idx) is O(1).
    if ((this.frame % 60) === 0 && !this._aliveByEmitterReadbackInflight && this._aliveByEmitterBuffer) {
      this._aliveByEmitterReadbackInflight = true;
      const sz = this._aliveByEmitterBuffer.size;
      const rb2 = this.device.createBuffer({ size: sz, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const e2 = this.device.createCommandEncoder({ label: 'alive-by-emitter readback' });
      e2.copyBufferToBuffer(this._aliveByEmitterBuffer, 0, rb2, 0, sz);
      this.device.queue.submit([e2.finish()]);
      rb2.mapAsync(GPUMapMode.READ).then(() => {
        const u = new Uint32Array(rb2.getMappedRange());
        this._aliveByEmitterCpu.set(u);
        rb2.unmap();
        rb2.destroy();
        this._aliveByEmitterReadbackInflight = false;
      }).catch(err => {
        console.warn('[particles] alive-by-emitter readback failed:', err);
        this._aliveByEmitterReadbackInflight = false;
      });
    }

    this._simMsLast = performance.now() - t0;
  }

  // O(1) per-emitter alive count for demo HUD. Returns the GPU-synced CPU
  // mirror; up to 1 second stale (60-frame readback cadence).
  aliveByEmitter(idx) {
    return this._aliveByEmitterCpu[idx] | 0;
  }

  runFrames(n, dt) {
    for (let k = 0; k < n; k++) this.update(dt);
  }

  // Pack the current Bound values (constants from mod.params) into the
  // emitter's module_params uniform buffer. Called every frame because Bound
  // values can be live-edited via the UI; the bytes are 64 per Bound × N Bounds.
  _packModuleParams(emitter) {
    const { layout, paramsBuffer, numBounds } = emitter._wgpu;
    // Sync LUTs every frame: detects in-place picker edits (Curve.update /
    // Gradient.update bumps _version) and re-uploads only the changed atlases.
    // Steady-state cost is one Map.has + version compare per Bound param.
    this._syncEmitterLUTs(emitter);
    const totalBytes = numBounds * 64 + 16;   // +16 for module_enabled vec4<u32>
    const buf = new ArrayBuffer(totalBytes);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    const { serializeBound } = this._boundCodegen;
    // Reset the smoothing slot cursor before each pack — slots are reassigned
    // in layout order every frame so each smoothed Bound gets the same slot
    // index consistently. (The cursor was also reset in _setupEmitterResources
    // to count slots for lazy buffer allocation.)
    this._lutCtx.smoothingSlotCursor = { value: 0 };
    for (let i = 0; i < layout.length; i++) {
      const entry = layout[i];
      const mod = emitter.config.modules[entry.moduleIndex];
      const v = mod.params[entry.paramName];
      serializeBound(v, f, u, i * 16, this._lutCtx);
    }
    // module_enabled: bit mi = 1 iff modules[mi].disabled is falsy AND the
    // emitter itself is not disabled. A disabled emitter forces all bits to 0
    // so the integrate / age / death pipeline still runs but no module
    // snippet applies — matching WebGL2's _applyModules early-return.
    // Up to 128 modules supported (4 lanes × 32 bits). Lane index = mi >> 5.
    const enabledBaseU32 = numBounds * 16;   // start of vec4<u32> trailer
    let bits0 = 0, bits1 = 0, bits2 = 0, bits3 = 0;
    if (!emitter.config.disabled) {
      const mods = emitter.config.modules;
      for (let mi = 0; mi < mods.length; mi++) {
        if (mods[mi].disabled) continue;
        const word = mi >> 5, bit = mi & 31;
        if (word === 0) bits0 |= (1 << bit);
        else if (word === 1) bits1 |= (1 << bit);
        else if (word === 2) bits2 |= (1 << bit);
        else bits3 |= (1 << bit);
      }
    }
    u[enabledBaseU32 + 0] = bits0 >>> 0;
    u[enabledBaseU32 + 1] = bits1 >>> 0;
    u[enabledBaseU32 + 2] = bits2 >>> 0;
    u[enabledBaseU32 + 3] = bits3 >>> 0;
    this.device.queue.writeBuffer(paramsBuffer, 0, buf);
  }

  // Build the group(1) bind group for this frame: particles_in, particles_out,
  // smoothing (or fallback), firstFrame (or fallback). Rebuilt each frame
  // because particles ping-pongs.
  _buildStorageRWBindGroupForFrame() {
    return this.device.createBindGroup({
      layout: this.storageRWLayout,
      entries: [
        // In-place: cs_main reads + writes _readBuffer at its own slots.
        { binding: 0, resource: { buffer: this._readBuffer } },
        { binding: 2, resource: { buffer: this._smoothingBuffer ?? this._fallbackSmoothing } },
        { binding: 3, resource: { buffer: this._firstFrameBuffer ?? this._fallbackFirstFrame } },
      ],
    });
  }

  // Fallback texture views for emitters without curves/gradients.
  _fallbackCurveTexture() {
    if (!this._fallbackCurveTex) {
      this._fallbackCurveTex = this.device.createTexture({
        label: 'fallback curve (1×1×1 r32float)',
        size: [1, 1, 1],
        format: 'r32float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    }
    return this._fallbackCurveTex;
  }

  _fallbackGradientTexture() {
    if (!this._fallbackGradientTex) {
      this._fallbackGradientTex = this.device.createTexture({
        label: 'fallback gradient (1×1×1 rgba8unorm)',
        size: [1, 1, 1],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    }
    return this._fallbackGradientTex;
  }

  _fallbackSampler() {
    if (!this._fallbackSamplerObj) {
      // Filtering sampler matches moduleParamsLayout's binding 2 (filtering).
      // Used for emitters without curves/gradients — the actual texture binds
      // are 1×1×1 fallback textures so the sampler value is irrelevant; we
      // just need its filterability to satisfy validation.
      this._fallbackSamplerObj = this.device.createSampler({
        label: 'fallback',
        magFilter: 'linear',
        minFilter: 'linear',
      });
    }
    return this._fallbackSamplerObj;
  }

  render({ view, proj, pixelScale = 1.0, debugColors = false, bgColor = [0.047, 0.039, 0.027, 1.0], postfx } = {}) {
    const t0 = performance.now();
    // GPU backpressure: don't enqueue another render submit if we already
    // have >2 frames in flight on the GPU. Pairs with update()'s skip.
    // Without this, rAF callbacks at 60Hz keep submitting render passes
    // that the GPU can't deliver, the queue grows, and frames drop silently
    // — visual stutter while reported FPS lies high.
    if (this._inflightRenderFrames > 2) {
      this._renderMsLast = performance.now() - t0;
      return;
    }
    // Stash camera state for the next compute frame's uniform write.
    this._currentView = view;
    this._currentProj = proj;
    this._currentPixelScale = pixelScale;
    // Refresh uniforms with the latest camera matrices.
    this._writeUniforms(0);   // dt=0 for the render-only pass; compute already ran with the proper dt this frame.

    // Phase 4: postfx is mandatory — pipelines render to rgba16float scene
    // texture, then postfx composites to swapchain. Kick off lazy build on
    // first frame; skip render until build resolves (one-frame blip).
    this._ensurePostFX();
    if (!this._postfx || !this._postfx._ready) {
      this._renderMsLast = performance.now() - t0;
      return;
    }
    this._postfx.setSize(this.canvas.width, this.canvas.height);
    const usePostFX = true;

    const isOpaque = this.blend === 'opaque';
    const encoder = this.device.createCommandEncoder({ label: 'particles render' });
    const swapView = this.context.getCurrentTexture().createView();
    const sceneAttachment = usePostFX ? this._postfx.sceneAttachmentView() : swapView;
    const passDesc = {
      label: 'particle render pass',
      colorAttachments: [{
        view: sceneAttachment,
        clearValue: { r: bgColor[0], g: bgColor[1], b: bgColor[2], a: bgColor[3] ?? 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    };
    if (isOpaque) {
      passDesc.depthStencilAttachment = {
        view: this._ensureDepthTexture().createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      };
    }
    const pass = encoder.beginRenderPass(passDesc);
    if (this._pipelinesCompiled) {
      // Pick the pipeline based on current blend mode.
      let pipeline;
      if (this.blend === 'additive') pipeline = this._pipelineAdditive;
      else if (this.blend === 'opaque') pipeline = this._pipelineOpaque;
      else pipeline = this._pipelineAlphaOver;
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, this.uniformBindGroup);
      // Render reads from the buffer the compute pass JUST WROTE TO,
      // which after the swap is now in this._readBuffer.
      pass.setBindGroup(1, this._readBuffer === this.particlesA ? this.renderBG_A : this.renderBG_B);
      // Phase 2.5: drawIndirect with instance_count = post-compaction alive_count
      // (written to _drawIndirectArgs by cs_compact_scan_global Pass B). VS still
      // checks particle.life > 0 as a defensive cull, but the count is already
      // tight — render skips dead slots entirely. Falls back to draw() if
      // compaction hasn't allocated yet (first frame before _setupEmitterResources).
      if (this._drawIndirectArgs) {
        pass.drawIndirect(this._drawIndirectArgs, 0);
      } else {
        pass.draw(4, this.maxParticles);
      }
    }
    pass.end();
    // Phase 4: postfx chain runs in the same encoder, sourcing from the
    // scene HDR texture and compositing onto the swapchain.
    if (usePostFX) {
      this._postfx.apply(encoder, swapView, postfx);
    }
    this.device.queue.submit([encoder.finish()]);
    // Track REAL presented-frame rate. onSubmittedWorkDone resolves once the
    // GPU has finished this submit; that's the closest signal we have to
    // "frame actually delivered to the display". Demo HUD's rAF-based fps
    // would otherwise lie to us when the GPU is queue-bound.
    this._inflightRenderFrames++;
    this.device.queue.onSubmittedWorkDone().then(() => {
      this._inflightRenderFrames = Math.max(0, this._inflightRenderFrames - 1);
      this._completedFrames++;
      const t = performance.now();
      this._lastFrameCompleteAt = t;
      this._frameCompleteSamples.push(t);
      while (this._frameCompleteSamples.length > 60) this._frameCompleteSamples.shift();
    });
    this._renderMsLast = performance.now() - t0;
  }

  // Real presented-frame rate (ignoring rAF cadence). Returns 0 until at
  // least 2 frames have been presented.
  realFps() {
    const s = this._frameCompleteSamples;
    if (s.length < 2) return 0;
    const span = (s[s.length - 1] - s[0]) / 1000;
    return span > 0 ? (s.length - 1) / span : 0;
  }

  resize(_w, _h) {
    // Canvas size changes are handled by the configure() call automatically;
    // pixelScale lives in the uniform buffer and is updated per render() call.
    // Tear down the depth texture so _ensureDepthTexture() recreates it at the
    // new canvas dimensions on the next opaque-mode frame.
    if (this._depthTexture) {
      this._depthTexture.destroy();
      this._depthTexture = null;
    }
  }

  // Lazy-build the postfx pipeline. Returns a promise; resolves with the
  // PostFXPipeline instance. First-frame render before the build resolves
  // falls back to direct-to-swapchain.
  async _ensurePostFX() {
    if (this._postfx) return this._postfx;
    if (this._postfxBuildInflight) return this._postfxBuildInflight;
    const { PostFXPipeline } = await import('./postfx.js');
    const pfx = new PostFXPipeline(this.device, this.format);
    this._postfxBuildInflight = pfx.build().then(() => {
      this._postfx = pfx;
      this._postfxBuildInflight = null;
      return pfx;
    });
    return this._postfxBuildInflight;
  }

  setDebugColors(_on) { /* Phase 1: debug colors not wired through WebGPU yet. */ }

  getStats() {
    // Phase 2.5: alive comes from this.alive, which is bumped on spawn and
    // synced from the GPU draw_indirect args every 60 frames (post-compaction
    // alive_count). The previous _spawnLog estimate was specific to the
    // CPU-staging path and is always 0 with the GPU spawn pipeline.
    return {
      alive: this.alive,
      dropped: this.stats.dropped,
      simMs: this._simMsLast,
      renderMs: this._renderMsLast,
      gpuMemBytes: this._estimateGpuMem(),
      maxParticles: this.maxParticles,
      backend: 'webgpu',
      realFps: this.realFps(),
      inflight: this._inflightRenderFrames,
    };
  }

  _estimateGpuMem() {
    const ping = this.particlesA.size + this.particlesB.size;
    const uniform = this.uniformBuffer.size;
    const renderAttachments = 4 * this.canvas.width * this.canvas.height;
    return ping + uniform + renderAttachments;
  }

  setRafCancel(fn) {
    this._rafCancel = fn;
  }

  _onDeviceLost(info) {
    if (this._rafCancel) this._rafCancel();
    showDeviceLostOverlay(info, this.canvas);
  }

  // Copy `count` particles starting at slot `start` from the GPU's
  // current readBuffer to a CPU-mappable staging buffer, await mapping,
  // and return a Float32Array view. Used by tests for module parity
  // checks. The staging buffer is reused across calls (allocated lazily).
  // Test-only: write a synthetic particle population to _readBuffer slot 0..N
  // so tests can exercise grid + solver passes without going through the
  // spawn pipeline. life=1, age=0, density=0, all other slots zeroed.
  async injectParticles(positionsF32, count) {
    const buf = new ArrayBuffer(count * BYTES_PER_PARTICLE);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    for (let i = 0; i < count; i++) {
      const o = i * 20;                       // 80 bytes / 4 = 20 floats per particle
      f32[o + 0] = positionsF32[i*3 + 0];     // pos.x
      f32[o + 1] = positionsF32[i*3 + 1];     // pos.y
      f32[o + 2] = positionsF32[i*3 + 2];     // pos.z
      f32[o + 3] = 0;                         // _pad0
      f32[o + 4] = 0; f32[o + 5] = 0; f32[o + 6] = 0;   // vel
      f32[o + 7] = 0;                         // density
      f32[o + 8]  = 1; f32[o + 9]  = 1; f32[o +10] = 1; f32[o +11] = 1;  // color rgba
      f32[o +12] = 0.1;                       // size
      f32[o +13] = 0;                         // rot
      f32[o +14] = 0;                         // avel
      f32[o +15] = 0;                         // age
      f32[o +16] = 1;                         // life (alive)
      f32[o +17] = i;                         // spawn_idx
      f32[o +18] = 0;                         // stable_rand
      u32[o +19] = 0;                         // emitter_id
    }
    this.device.queue.writeBuffer(this._readBuffer, 0, buf);
    await this.device.queue.onSubmittedWorkDone();
    this.alive = count;
  }

  async readbackParticles(start, count, useWriteBuffer = false) {
    const byteLen = count * BYTES_PER_PARTICLE;   // 80 bytes/particle
    if (!this._readbackStaging || this._readbackStaging.size < byteLen) {
      if (this._readbackStaging) this._readbackStaging.destroy();
      this._readbackStaging = this.device.createBuffer({
        label: 'particles readback staging',
        size: Math.max(byteLen, 16384),
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }
    const src = useWriteBuffer ? this._writeBuffer : this._readBuffer;
    const encoder = this.device.createCommandEncoder({ label: 'readback' });
    encoder.copyBufferToBuffer(src, start * BYTES_PER_PARTICLE, this._readbackStaging, 0, byteLen);
    this.device.queue.submit([encoder.finish()]);
    await this._readbackStaging.mapAsync(GPUMapMode.READ, 0, byteLen);
    const data = new Float32Array(this._readbackStaging.getMappedRange(0, byteLen).slice(0));
    this._readbackStaging.unmap();
    return data;
  }

  async destroy() {
    this._destroyed = true;
    if (this.particlesA) this.particlesA.destroy();
    if (this.particlesB) this.particlesB.destroy();
    if (this.uniformBuffer) this.uniformBuffer.destroy();
    if (this._readbackStaging) this._readbackStaging.destroy();
    if (this._depthTexture) { this._depthTexture.destroy(); this._depthTexture = null; }
    if (this._curveLUT) this._curveLUT.destroy();
    if (this._gradientLUT) this._gradientLUT.destroy();
    if (this._smoothingBuffer) this._smoothingBuffer.destroy();
    if (this._firstFrameBuffer) this._firstFrameBuffer.destroy();
    if (this._fallbackSmoothing) this._fallbackSmoothing.destroy();
    if (this._fallbackFirstFrame) this._fallbackFirstFrame.destroy();
    if (this._fallbackCurveTex) this._fallbackCurveTex.destroy();
    if (this._fallbackGradientTex) this._fallbackGradientTex.destroy();
    if (this._audioUniformsBuffer) this._audioUniformsBuffer.destroy();
    this._audioUniformsBuffer = null;
    this._audioSourceTable = null;
    // Pipelines and bind groups don't have explicit destroy; they're GC'd with the device.
    if (this.device && typeof this.device.destroy === 'function') {
      this.device.destroy();
    }
    this.particlesA = null;
    this.particlesB = null;
    this.uniformBuffer = null;
    this._readbackStaging = null;
    this._curveLUT = null;
    this._gradientLUT = null;
    this._smoothingBuffer = null;
    this._firstFrameBuffer = null;
    this._fallbackSmoothing = null;
    this._fallbackFirstFrame = null;
    this._fallbackCurveTex = null;
    this._fallbackGradientTex = null;
    this._fallbackSamplerObj = null;
  }
}

function showDeviceLostOverlay(info, canvas) {
  // Only one overlay at a time.
  if (document.getElementById('webgpu-device-lost-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'webgpu-device-lost-overlay';
  overlay.style.cssText = [
    'position: fixed', 'inset: 0', 'background: rgba(0,0,0,0.85)',
    'color: #cfd2d6', 'font-family: ui-monospace, monospace',
    'display: flex', 'flex-direction: column', 'align-items: center', 'justify-content: center',
    'z-index: 99999', 'padding: 24px', 'gap: 16px',
  ].join(';');
  overlay.innerHTML = `
    <div style="font-size: 18px; color: #ff4b1f;">GPU device lost</div>
    <div style="font-size: 13px; max-width: 600px; text-align: center;">
      ${info && info.message ? escapeHtml(info.message) : 'The graphics device disconnected. Reload to continue.'}
    </div>
    <button id="webgpu-device-lost-reload"
            style="background:#9ee37d; color:#0c0a07; border:none; padding:8px 16px; cursor:pointer; font-family:inherit;">
      Reload
    </button>
  `;
  document.body.appendChild(overlay);
  document.getElementById('webgpu-device-lost-reload').addEventListener('click', () => location.reload());
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function loadWGSL(filename) {
  const url = new URL(`./shaders/${filename}`, import.meta.url).href;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
  return r.text();
}

// Async entry point — used by particles/index.js's backend selector.
export async function createWebGPUSystem({ canvas, maxParticles = 50000, blend = 'additive', seed = 1 }) {
  if (!('gpu' in navigator)) {
    throw new Error('WebGPU not available: navigator.gpu is missing.');
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU not available: requestAdapter() returned null.');
  }
  let device;
  try {
    // Opt into the adapter's actual ceilings rather than the spec defaults.
    // Phase 2.5 hit two of them at 8M particles: maxBufferSize default=256MB
    // (we need 640MB for an 8M particle buffer) and the storage binding
    // size. Pass the adapter's reported limit directly — these can be 2^31+
    // (e.g. maxBufferSize=2147483648 = 2GB) so DON'T use `| 0` (sign-flips
    // exact 2^31 to negative, which requestDevice silently rejects → demo
    // falls back to WebGL2).
    const al = adapter.limits;
    const reqLimits = {
      maxStorageBufferBindingSize: Math.max(STORAGE_BUFFER_FLOOR, al.maxStorageBufferBindingSize),
      maxBufferSize: al.maxBufferSize,
    };
    device = await adapter.requestDevice({ requiredLimits: reqLimits });
  } catch (err) {
    throw new Error(`WebGPU not available: requestDevice() threw: ${err.message}`);
  }
  if (!device) {
    throw new Error('WebGPU not available: requestDevice() returned null.');
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  // Phase 1: use the preferred canvas format directly (bgra8unorm or rgba8unorm).
  // The -srgb variants aren't valid canvas configure() formats per the WebGPU
  // spec — they're only valid as render-target VIEW formats. For Phase 1 we
  // skip sRGB gamma correction; visuals will be in linear space, slightly less
  // vibrant than WebGL2's gamma-corrected output but functional. Phase 4
  // reconfigures to rgba16float for HDR bloom and revisits gamma handling.
  const ps = new WebGPUParticleSystem({
    canvas, device, adapter, format, maxParticles, blend, seed,
  });
  await ps._compilePipelines();
  return ps;
}
