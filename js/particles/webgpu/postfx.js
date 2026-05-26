// postfx.js — WebGPU port of webgl2/postfx.js. Same effects, same defaults,
// same stage.* settings. Pipeline:
//
//   particle render pass → scene_tex (rgba16float, full-res)
//   cs_bright            → bright_tex (rgba16float, half-res)
//   cs_blur × N (H,V)    → blur_tex_ping/pong (rgba16float, half-res)
//   fs_composite         → swapchain (LDR)

const QUAD_VERT_COUNT = 3;

async function loadShader(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`failed to load ${path}: ${r.status}`);
  return r.text();
}

export class PostFXPipeline {
  constructor(device, swapchainFormat) {
    this.device = device;
    this.swapchainFormat = swapchainFormat;
    this._size = [0, 0];
    this._halfSize = [0, 0];
    this._sceneTex = null;
    this._brightTex = null;
    this._blurA = null;
    this._blurB = null;
    this._sampler = null;
    this._brightPipe = null;
    this._blurPipe = null;
    this._compositePipe = null;
    this._computeLayout = null;
    this._compLayout = null;
    this._uniforms = null;
    this._ready = false;
  }

  async build() {
    if (this._ready) return;
    const dev = this.device;
    const [brightWgsl, blurWgsl, compositeWgsl] = await Promise.all([
      loadShader('/particles/webgpu/shaders/postfx_bright.wgsl'),
      loadShader('/particles/webgpu/shaders/postfx_blur.wgsl'),
      loadShader('/particles/webgpu/shaders/postfx_composite.wgsl'),
    ]);

    this._sampler = dev.createSampler({
      label: 'postfx sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // H and V blur passes need SEPARATE uniform buffers. Both passes are
    // queued into the same encoder, so writing direction (1,0) then (0,1) to
    // a single buffer leaves only the second value visible at submit time —
    // both passes would then blur in the same direction.
    this._uniforms = {
      bright:    dev.createBuffer({ label: 'postfx bright u',    size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      blurH:     dev.createBuffer({ label: 'postfx blur H u',    size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      blurV:     dev.createBuffer({ label: 'postfx blur V u',    size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      composite: dev.createBuffer({ label: 'postfx composite u', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    };

    this._computeLayout = dev.createBindGroupLayout({
      label: 'postfx compute bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    const computePL = dev.createPipelineLayout({ bindGroupLayouts: [this._computeLayout] });

    this._brightPipe = dev.createComputePipeline({
      label: 'postfx bright',
      layout: computePL,
      compute: { module: dev.createShaderModule({ label: 'postfx_bright', code: brightWgsl }), entryPoint: 'cs_bright' },
    });
    this._blurPipe = dev.createComputePipeline({
      label: 'postfx blur',
      layout: computePL,
      compute: { module: dev.createShaderModule({ label: 'postfx_blur', code: blurWgsl }), entryPoint: 'cs_blur' },
    });

    this._compLayout = dev.createBindGroupLayout({
      label: 'postfx composite bgl',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    const compPL = dev.createPipelineLayout({ bindGroupLayouts: [this._compLayout] });
    const compModule = dev.createShaderModule({ label: 'postfx_composite', code: compositeWgsl });
    this._compositePipe = dev.createRenderPipeline({
      label: 'postfx composite',
      layout: compPL,
      vertex:   { module: compModule, entryPoint: 'vs_main' },
      fragment: { module: compModule, entryPoint: 'fs_main', targets: [{ format: this.swapchainFormat }] },
      primitive: { topology: 'triangle-list' },
    });

    this._ready = true;
  }

  setSize(w, h) {
    if (w === this._size[0] && h === this._size[1]) return;
    this._size = [w, h];
    const dev = this.device;
    for (const tex of [this._sceneTex, this._brightTex, this._blurA, this._blurB]) {
      if (tex) tex.destroy();
    }
    this._sceneTex = dev.createTexture({
      label: 'postfx scene',
      size: [w, h],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const bw = Math.max(1, w >> 1);
    const bh = Math.max(1, h >> 1);
    this._halfSize = [bw, bh];
    const halfDesc = {
      size: [bw, bh],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    };
    this._brightTex = dev.createTexture({ label: 'postfx bright', ...halfDesc });
    this._blurA     = dev.createTexture({ label: 'postfx blur a', ...halfDesc });
    this._blurB     = dev.createTexture({ label: 'postfx blur b', ...halfDesc });
    // Texel size + direction. Constant per resize; written once instead of
    // every frame so each blur pass dispatch reads the right direction.
    dev.queue.writeBuffer(this._uniforms.blurH, 0,
      new Float32Array([1 / bw, 1 / bh, 1, 0]));
    dev.queue.writeBuffer(this._uniforms.blurV, 0,
      new Float32Array([1 / bw, 1 / bh, 0, 1]));
  }

  // The view that the particle render pass should bind as its color attachment.
  sceneAttachmentView() { return this._sceneTex.createView(); }

  // Run bright + blur (when enabled) and composite onto swapchain.
  apply(encoder, swapchainView, opts) {
    if (!this._ready) return;
    const {
      enableBloom    = true,
      bloomThreshold = 0.85,
      bloomSoftKnee  = 0.7,
      bloomIntensity = 0.7,
      blurPasses     = 3,
      exposure       = 1.0,
      vignette       = 0.30,
    } = opts || {};

    const dev = this.device;
    const [bw, bh] = this._halfSize;
    let bloomSrcView = this._sceneTex.createView();   // fallback when bloom off

    if (enableBloom) {
      // Bright pass: scene → bright_tex
      dev.queue.writeBuffer(this._uniforms.bright, 0,
        new Float32Array([bloomThreshold, bloomSoftKnee, 0, 0]));
      const brightBG = dev.createBindGroup({
        layout: this._computeLayout,
        entries: [
          { binding: 0, resource: this._sceneTex.createView() },
          { binding: 1, resource: this._sampler },
          { binding: 2, resource: this._brightTex.createView() },
          { binding: 3, resource: { buffer: this._uniforms.bright } },
        ],
      });
      const passB = encoder.beginComputePass({ label: 'postfx bright' });
      passB.setPipeline(this._brightPipe);
      passB.setBindGroup(0, brightBG);
      passB.dispatchWorkgroups(Math.ceil(bw / 8), Math.ceil(bh / 8));
      passB.end();

      // Blur ping-pong. Two scratch textures — pingTex catches every H pass,
      // pongTex catches every V pass. srcTex feeds the next H from the prior
      // V's output. brightTex feeds iteration 0's H, then we never touch it
      // again. The trick is the H/V targets stay PINGTEX/PONGTEX every iter
      // (which is fine since the previous V already finished writing to
      // PONGTEX before we read from it as next iter's H source — implicit
      // barrier between compute passes within the same encoder).
      let srcTex = this._brightTex;
      const pingTex = this._blurA;
      const pongTex = this._blurB;
      for (let i = 0; i < blurPasses; i++) {
        // Horizontal: src → ping (uses the H direction uniform set in setSize)
        const bgH = dev.createBindGroup({
          layout: this._computeLayout,
          entries: [
            { binding: 0, resource: srcTex.createView() },
            { binding: 1, resource: this._sampler },
            { binding: 2, resource: pingTex.createView() },
            { binding: 3, resource: { buffer: this._uniforms.blurH } },
          ],
        });
        const passH = encoder.beginComputePass({ label: `postfx blur H ${i}` });
        passH.setPipeline(this._blurPipe);
        passH.setBindGroup(0, bgH);
        passH.dispatchWorkgroups(Math.ceil(bw / 8), Math.ceil(bh / 8));
        passH.end();

        // Vertical: ping → pong (uses the V direction uniform set in setSize)
        const bgV = dev.createBindGroup({
          layout: this._computeLayout,
          entries: [
            { binding: 0, resource: pingTex.createView() },
            { binding: 1, resource: this._sampler },
            { binding: 2, resource: pongTex.createView() },
            { binding: 3, resource: { buffer: this._uniforms.blurV } },
          ],
        });
        const passV = encoder.beginComputePass({ label: `postfx blur V ${i}` });
        passV.setPipeline(this._blurPipe);
        passV.setBindGroup(0, bgV);
        passV.dispatchWorkgroups(Math.ceil(bw / 8), Math.ceil(bh / 8));
        passV.end();

        // Next iteration's H reads from pongTex (latest result).
        srcTex = pongTex;
      }
      bloomSrcView = pongTex.createView();
    }

    // Composite: scene + bloom_src → swapchain.
    dev.queue.writeBuffer(this._uniforms.composite, 0,
      new Float32Array([
        enableBloom ? bloomIntensity : 0,
        exposure,
        vignette,
        0,
      ]));
    const compBG = dev.createBindGroup({
      layout: this._compLayout,
      entries: [
        { binding: 0, resource: this._sceneTex.createView() },
        { binding: 1, resource: bloomSrcView },
        { binding: 2, resource: this._sampler },
        { binding: 3, resource: { buffer: this._uniforms.composite } },
      ],
    });
    const passC = encoder.beginRenderPass({
      label: 'postfx composite',
      colorAttachments: [{
        view: swapchainView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    passC.setPipeline(this._compositePipe);
    passC.setBindGroup(0, compBG);
    passC.draw(QUAD_VERT_COUNT, 1, 0, 0);
    passC.end();
  }

  destroy() {
    for (const tex of [this._sceneTex, this._brightTex, this._blurA, this._blurB]) {
      if (tex) tex.destroy();
    }
  }
}
