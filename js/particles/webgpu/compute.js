// compute.js — pipeline cache + compute pipeline assembly for the WebGPU
// particle backend. Each emitter's module list (×param Bound shapes) keys a
// unique GPUComputePipeline; the cache absorbs repeated compiles when emitters
// share the same module config.

import { boundShape } from './bound-codegen.js';
import { buildShaderSource } from './module-codegen.js';

// Cache key for an emitter. Same modules + same bound shapes + same
// codegen-time enums → same pipeline.
function pipelineCacheKey(emitter) {
  const m = [];
  for (const mod of emitter.config.modules) {
    if (mod.kind === 'shape') continue;
    const paramShapes = [];
    if (mod.params) {
      // Sort param names for stable key.
      for (const k of Object.keys(mod.params).sort()) {
        const v = mod.params[k];
        if (typeof v === 'string') {
          // Codegen-time enum
          paramShapes.push([k, 'enum', v]);
        } else {
          paramShapes.push([k, 'bound', boundShape(v)]);
        }
      }
    }
    m.push({
      name: mod.moduleName ?? mod.name,
      kind: mod.kind,
      forceMode: mod.forceMode ?? null,
      shapes: paramShapes,
    });
  }
  return JSON.stringify({ m });
}

export class PipelineCache {
  constructor(device, layouts) {
    this.device = device;
    this.layouts = layouts;
    this.map = new Map();
    this._templateWgsl = null;
    this._evalBoundWgsl = null;
  }

  async _loadShaderSources() {
    if (this._templateWgsl) return;
    const fetchText = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
      return r.text();
    };
    const base = new URL('./shaders/', import.meta.url).href;
    [this._templateWgsl, this._evalBoundWgsl] = await Promise.all([
      fetchText(base + 'update.template.wgsl'),
      fetchText(base + 'eval_bound.wgsl'),
    ]);
  }

  async getOrBuild(emitter, lutCtx) {
    await this._loadShaderSources();
    const key = pipelineCacheKey(emitter);
    let entry = this.map.get(key);
    if (entry) return entry;

    const wgsl = buildShaderSource(emitter, this._templateWgsl, this._evalBoundWgsl, lutCtx);
    const moduleLabel = `update emitter=${emitter.config?.name ?? 'unnamed'}`;
    const module = this.device.createShaderModule({
      label: moduleLabel,
      code: wgsl,
    });
    // Fire-and-forget compile-info logging. Surfaces WGSL parse errors
    // immediately instead of via per-frame validation cascades.
    module.getCompilationInfo().then(info => {
      for (const m of info.messages) {
        const log = m.type === 'error' ? console.error : console.warn;
        log(`[WGSL ${m.type}] ${moduleLabel}: ${m.message} (line ${m.lineNum}, col ${m.linePos})`);
      }
    }).catch(() => { /* best-effort, ignore */ });
    const pipeline = this.device.createComputePipeline({
      label: `update pipeline ${key.slice(0, 60)}…`,
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [
          this.layouts.uniformLayout,         // group(0)
          this.layouts.storageRWLayout,       // group(1)
          this.layouts.moduleParamsLayout,    // group(2): module_params + LUTs
        ],
      }),
      compute: { module, entryPoint: 'cs_main' },
    });
    entry = { pipeline, key, wgsl };
    this.map.set(key, entry);
    return entry;
  }

  get size() { return this.map.size; }
  clear() { this.map.clear(); }
}
