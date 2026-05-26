// grid.js — uniform spatial grid for particle-particle interaction.
// Built every frame between spawn and cs_main. See spec
// 2026-05-09-particles-interaction-grid-boids-sph-design.md.
//
// This is the SKELETON — buffers + uniforms only. The four build passes
// (clear / cellId / scan / scatter) and their tests land in T7–T11.

export class Grid {
  constructor(device, maxParticles, halfExtent, cellSize) {
    this.device       = device;
    this.maxParticles = maxParticles;
    this.halfExtent   = halfExtent;
    this.cellSize     = cellSize;
    this.cellsPerAxis = Math.max(1, Math.ceil(2 * halfExtent / cellSize));
    this.numCells     = this.cellsPerAxis ** 3;

    // ── buffers ──────────────────────────────────────────────────────
    // cellIdx[i] = cell ID of particle i (UINT32_MAX = out-of-bounds / dead).
    this.cellIdxBuffer = device.createBuffer({
      label: 'grid.cellIdx',
      size:  maxParticles * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    // partIdx[k] = original particle index for sorted slot k (after scatter).
    this.partIdxBuffer = device.createBuffer({
      label: 'grid.partIdx',
      size:  maxParticles * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    // cellStart[c] = first sorted slot for cell c. Set by scan pass (T9).
    this.cellStartBuffer = device.createBuffer({
      label: 'grid.cellStart',
      size:  this.numCells * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    // cellCount[c] = number of particles in cell c. Atomic-incremented in
    // grid_cell_id (T8), read by solvers.
    this.cellCountBuffer = device.createBuffer({
      label: 'grid.cellCount',
      size:  this.numCells * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    // writeOffset[c] = atomic counter used by scatter (T10) to track the
    // next free slot inside cell c's range. Discarded after scatter.
    this.writeOffsetBuffer = device.createBuffer({
      label: 'grid.writeOffset',
      size:  this.numCells * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // ── uniforms ─────────────────────────────────────────────────────
    // 32 bytes (8 × u32/f32) — origin (vec3 + cell_size packed), then
    // cells_per_axis, num_cells, alive_count, _pad.
    this.uniformBuffer = device.createBuffer({
      label: 'grid.uniforms',
      size:  32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  // Push current grid params + alive count to the GPU. Called every frame
  // by Grid.build() (added in T11). If cellsPerAxis would change, the
  // caller must recreate the Grid instance instead.
  writeUniforms(aliveCount) {
    const buf = new ArrayBuffer(32);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    // origin = -halfExtent on all axes (matches floor((p - origin)/cellSize))
    f32[0] = -this.halfExtent; f32[1] = -this.halfExtent; f32[2] = -this.halfExtent;
    f32[3] = this.cellSize;     // packs into vec3<f32>'s trailing 4 bytes
    u32[4] = this.cellsPerAxis;
    u32[5] = this.numCells;
    u32[6] = aliveCount;
    u32[7] = 0;                 // pad
    this.device.queue.writeBuffer(this.uniformBuffer, 0, buf);
  }

  static async create(device, maxParticles, halfExtent, cellSize) {
    const g = new Grid(device, maxParticles, halfExtent, cellSize);
    await g._loadPipelines();
    return g;
  }

  async _loadPipelines() {
    // ── grid_clear ──
    const clearWgsl = await fetch('/particles/webgpu/shaders/grid_clear.wgsl').then(r => r.text());
    const clearLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this._clearLayout = clearLayout;
    this._clearPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [clearLayout] }),
      compute: { module: this.device.createShaderModule({ code: clearWgsl }), entryPoint: 'cs_clear' },
    });
    this._clearBindGroup = this.device.createBindGroup({
      layout: clearLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.cellCountBuffer } },
        { binding: 2, resource: { buffer: this.cellStartBuffer } },
        { binding: 3, resource: { buffer: this.writeOffsetBuffer } },
      ],
    });

    // ── grid_cell_id ──
    const cellIdWgsl = await fetch('/particles/webgpu/shaders/grid_cell_id.wgsl').then(r => r.text());
    const cellIdLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this._cellIdLayout   = cellIdLayout;
    this._cellIdPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [cellIdLayout] }),
      compute: { module: this.device.createShaderModule({ code: cellIdWgsl }), entryPoint: 'cs_cell_id' },
    });

    // ── grid_scan ──
    const scanWgsl = await fetch('/particles/webgpu/shaders/grid_scan.wgsl').then(r => r.text());
    const scanLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this._scanLayout = scanLayout;
    this._scanPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [scanLayout] }),
      compute: { module: this.device.createShaderModule({ code: scanWgsl }), entryPoint: 'cs_scan' },
    });
    this._scanBindGroup = this.device.createBindGroup({
      layout: scanLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.cellCountBuffer } },
        { binding: 2, resource: { buffer: this.cellStartBuffer } },
      ],
    });

    // ── grid_scatter ──
    const scatterWgsl = await fetch('/particles/webgpu/shaders/grid_scatter.wgsl').then(r => r.text());
    const scatterLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this._scatterLayout   = scatterLayout;
    this._scatterPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [scatterLayout] }),
      compute: { module: this.device.createShaderModule({ code: scatterWgsl }), entryPoint: 'cs_scatter' },
    });
    this._scatterBindGroup = this.device.createBindGroup({
      layout: scatterLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.cellIdxBuffer } },
        { binding: 2, resource: { buffer: this.cellStartBuffer } },
        { binding: 3, resource: { buffer: this.writeOffsetBuffer } },
        { binding: 4, resource: { buffer: this.partIdxBuffer } },
      ],
    });

    // ── read-only layout for solvers (boids / SPH) ──
    // Solvers read the grid but never write it; they need a separate layout
    // with read-only-storage so their pipeline layout matches the shader's
    // var<storage, read> declarations in interact_common.wgsl.
    const gridReadLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // cellIdx
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // partIdx
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // cellStart
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // cellCount
      ],
    });
    this.readLayout = gridReadLayout;
    this.readBindGroup = this.device.createBindGroup({
      layout: gridReadLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.cellIdxBuffer } },
        { binding: 2, resource: { buffer: this.partIdxBuffer } },
        { binding: 3, resource: { buffer: this.cellStartBuffer } },
        { binding: 4, resource: { buffer: this.cellCountBuffer } },
      ],
    });
  }

  clear(encoder) {
    const pass = encoder.beginComputePass({ label: 'grid.clear' });
    pass.setPipeline(this._clearPipeline);
    pass.setBindGroup(0, this._clearBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.numCells / 256));
    pass.end();
  }

  // Compute cell IDs and per-cell counts for all alive particles.
  // The bind group depends on the live particleBuffer, so it is built per-call;
  // the layout and pipeline are reused from _loadPipelines().
  cellId(encoder, aliveCount, particleBuffer) {
    const bg = this.device.createBindGroup({
      layout: this._cellIdLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: particleBuffer } },
        { binding: 2, resource: { buffer: this.cellIdxBuffer } },
        { binding: 3, resource: { buffer: this.partIdxBuffer } },
        { binding: 4, resource: { buffer: this.cellCountBuffer } },
      ],
    });
    const pass = encoder.beginComputePass({ label: 'grid.cellId' });
    pass.setPipeline(this._cellIdPipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(aliveCount / 256));
    pass.end();
  }

  scan(encoder) {
    const pass = encoder.beginComputePass({ label: 'grid.scan' });
    pass.setPipeline(this._scanPipeline);
    pass.setBindGroup(0, this._scanBindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
  }

  scatter(encoder, aliveCount) {
    const pass = encoder.beginComputePass({ label: 'grid.scatter' });
    pass.setPipeline(this._scatterPipeline);
    pass.setBindGroup(0, this._scatterBindGroup);
    pass.dispatchWorkgroups(Math.ceil(aliveCount / 256));
    pass.end();
  }

  // One-call wrapper that runs the full grid build. Caller should wrap in a
  // single command encoder for the lowest dispatch overhead.
  build(encoder, aliveCount, particleBuffer) {
    this.writeUniforms(aliveCount);
    this.clear(encoder);
    this.cellId(encoder, aliveCount, particleBuffer);
    this.scan(encoder);
    this.scatter(encoder, aliveCount);
  }

  destroy() {
    this.cellIdxBuffer.destroy();
    this.partIdxBuffer.destroy();
    this.cellStartBuffer.destroy();
    this.cellCountBuffer.destroy();
    this.writeOffsetBuffer.destroy();
    this.uniformBuffer.destroy();
  }
}
