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

    const load = f => fetch(new URL(`./shaders/${f}`, import.meta.url).href).then(r => r.text());
    const wgsl = await Promise.all([
      load('spawn_rng.wgsl'),
      load('sample_shape.wgsl'),
      load('direction_override.wgsl'),
      load('spawn_descriptor.wgsl'),
      load('cs_spawn.wgsl'),
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
