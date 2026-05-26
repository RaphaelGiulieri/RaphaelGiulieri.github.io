// interact.js — solver pipelines + dispatch. Owned by system.js, called
// each frame between grid build and per-emitter cs_main.

import { evalBoundScalar } from '../core/bound.js';

export class Interact {
  constructor(device, uniformLayout, storageRWLayout, gridLayout) {
    this.device           = device;
    this._uniformLayout   = uniformLayout;
    this._storageRWLayout = storageRWLayout;
    this._gridLayout      = gridLayout;

    this.boidsParamsBuffer = device.createBuffer({
      label: 'interact.boids.params',
      size:  32,                 // 6 floats + 2 pad = 8 × 4 = 32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sphParamsBuffer = device.createBuffer({
      label: 'interact.sph.params',
      size:  32,                 // 5 floats + 3 pad = 8 × 4 = 32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  static async create(device, uniformLayout, storageRWLayout, gridLayout) {
    const it = new Interact(device, uniformLayout, storageRWLayout, gridLayout);
    await it._loadBoids();
    await it._loadSph();
    return it;
  }

  async _loadBoids() {
    const [common, body] = await Promise.all([
      fetch('/particles/webgpu/shaders/interact_common.wgsl').then(r => r.text()),
      fetch('/particles/webgpu/shaders/interact_boids.wgsl').then(r => r.text()),
    ]);
    const wgsl = common + '\n' + body;
    const paramsLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this._boidsParamsLayout = paramsLayout;
    this._boidsPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this._uniformLayout, this._storageRWLayout, this._gridLayout, paramsLayout],
      }),
      compute: { module: this.device.createShaderModule({ code: wgsl }), entryPoint: 'cs_boids' },
    });
    this._boidsParamsBindGroup = this.device.createBindGroup({
      layout: paramsLayout,
      entries: [{ binding: 0, resource: { buffer: this.boidsParamsBuffer } }],
    });
  }

  writeBoidsParams(b, system, frameIdx) {
    const r = (v, fallback) => {
      if (v == null) return fallback;
      if (typeof v === 'number') return v;
      if (typeof v === 'object' && 'source' in v) {
        return evalBoundScalar(v, 0, system, null);
      }
      return fallback;
    };
    const buf = new Float32Array(8);
    buf[0] = r(b.sepRadius,   0.5);
    buf[1] = r(b.sepWeight,   1.5);
    buf[2] = r(b.alignWeight, 1.0);
    buf[3] = r(b.cohWeight,   0.8);
    buf[4] = r(b.maxAccel,    20);
    buf[5] = r(b.maxSpeed,    8);
    this.device.queue.writeBuffer(this.boidsParamsBuffer, 0, buf);
  }

  // Caller already wrote uniform & particle bind groups; we set @group(2) and @group(3).
  dispatchBoids(encoder, uniformBG, storageRWBG, gridBG, maxParticles) {
    const pass = encoder.beginComputePass({ label: 'interact.boids' });
    pass.setPipeline(this._boidsPipeline);
    pass.setBindGroup(0, uniformBG);
    pass.setBindGroup(1, storageRWBG);
    pass.setBindGroup(2, gridBG);
    pass.setBindGroup(3, this._boidsParamsBindGroup);
    pass.dispatchWorkgroups(Math.ceil(maxParticles / 256));
    pass.end();
  }

  async _loadSph() {
    const [common, dens, force] = await Promise.all([
      fetch('/particles/webgpu/shaders/interact_common.wgsl').then(r => r.text()),
      fetch('/particles/webgpu/shaders/interact_sph_density.wgsl').then(r => r.text()),
      fetch('/particles/webgpu/shaders/interact_sph_force.wgsl').then(r => r.text()),
    ]);
    const paramsLayout = this.device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }],
    });
    this._sphParamsLayout = paramsLayout;
    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [this._uniformLayout, this._storageRWLayout, this._gridLayout, paramsLayout],
    });
    this._sphDensityPipeline = this.device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: this.device.createShaderModule({ code: common + '\n' + dens }), entryPoint: 'cs_sph_density' },
    });
    this._sphForcePipeline = this.device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: this.device.createShaderModule({ code: common + '\n' + force }), entryPoint: 'cs_sph_force' },
    });
    this._sphParamsBindGroup = this.device.createBindGroup({
      layout: paramsLayout,
      entries: [{ binding: 0, resource: { buffer: this.sphParamsBuffer } }],
    });
  }

  writeSphParams(s, system, frameIdx) {
    const r = (v, fallback) => {
      if (v == null) return fallback;
      if (typeof v === 'number') return v;
      if (typeof v === 'object' && 'source' in v) {
        return evalBoundScalar(v, 0, system, null);
      }
      return fallback;
    };
    const buf = new Float32Array(8);
    buf[0] = r(s.smoothingRadius, 1.0);
    buf[1] = r(s.restDensity,     1000);
    buf[2] = r(s.stiffness,       400);
    buf[3] = r(s.viscosity,       50);
    buf[4] = r(s.mass,            1.0);
    this.device.queue.writeBuffer(this.sphParamsBuffer, 0, buf);
  }

  dispatchSphDensity(encoder, uniformBG, storageRWBG, gridBG, maxParticles) {
    const pass = encoder.beginComputePass({ label: 'interact.sph.density' });
    pass.setPipeline(this._sphDensityPipeline);
    pass.setBindGroup(0, uniformBG);
    pass.setBindGroup(1, storageRWBG);
    pass.setBindGroup(2, gridBG);
    pass.setBindGroup(3, this._sphParamsBindGroup);
    pass.dispatchWorkgroups(Math.ceil(maxParticles / 256));
    pass.end();
  }

  dispatchSphForce(encoder, uniformBG, storageRWBG, gridBG, maxParticles) {
    const pass = encoder.beginComputePass({ label: 'interact.sph.force' });
    pass.setPipeline(this._sphForcePipeline);
    pass.setBindGroup(0, uniformBG);
    pass.setBindGroup(1, storageRWBG);
    pass.setBindGroup(2, gridBG);
    pass.setBindGroup(3, this._sphParamsBindGroup);
    pass.dispatchWorkgroups(Math.ceil(maxParticles / 256));
    pass.end();
  }
}
