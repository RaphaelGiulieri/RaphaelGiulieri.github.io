// spawn-pipeline.js — system-wide spawn compute pipeline. The spawn shader
// is the same WGSL for all emitters (no per-emitter codegen), so we build it
// once and rebind per-emitter via the descriptor uniform + particles_out
// storage binding.

export class SpawnPipelineCache {
  constructor(device) {
    this.device = device;
    this._pipeline = null;
    this._layout = null;
  }

  // Returns { pipeline, bindGroupLayout }. Idempotent.
  async getOrBuild() {
    if (this._pipeline) return { pipeline: this._pipeline, bindGroupLayout: this._layout };

    const wgsl = await Promise.all([
      fetch('/particles/webgpu/shaders/spawn_rng.wgsl').then(r => r.text()),
      fetch('/particles/webgpu/shaders/sample_shape.wgsl').then(r => r.text()),
      fetch('/particles/webgpu/shaders/direction_override.wgsl').then(r => r.text()),
      fetch('/particles/webgpu/shaders/spawn_descriptor.wgsl').then(r => r.text()),
      fetch('/particles/webgpu/shaders/cs_spawn.wgsl').then(r => r.text()),
    ]).then(parts => parts.join('\n'));

    const module = this.device.createShaderModule({ label: 'cs_spawn', code: wgsl });

    // Surface compilation errors (Phase 2A foundation lesson).
    const info = await module.getCompilationInfo();
    for (const m of info.messages) {
      const sev = m.type === 'error' ? 'error' : (m.type === 'warning' ? 'warn' : 'info');
      console[sev](`[cs_spawn:${m.lineNum}:${m.linePos}] ${m.type}: ${m.message}`);
    }
    if (info.messages.some(m => m.type === 'error')) {
      throw new Error('cs_spawn shader has compilation errors; see console');
    }

    this._layout = this.device.createBindGroupLayout({
      label: 'cs_spawn bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this._layout],
    });
    this._pipeline = this.device.createComputePipeline({
      label: 'cs_spawn pipeline',
      layout: pipelineLayout,
      compute: { module, entryPoint: 'cs_spawn' },
    });

    return { pipeline: this._pipeline, bindGroupLayout: this._layout };
  }
}
