// module-codegen.js — assemble the final WGSL compute shader source for an
// emitter's module list. Walks modules in canonical execution order, calls
// each module's wgslSnippet(paramRefs) → string, splices results into
// update.template.wgsl's four insertion-point markers.

import { emitModuleParamsStruct } from './bound-codegen.js';

// Canonical buckets aligning with update.template.wgsl's insertion markers.
const BUCKETS = [
  'forces-add',
  'forces-mul',
  'set/mul/add',
  'constraints',
  'death',
];

// Marker strings exactly as they appear in update.template.wgsl.
const MARKERS = {
  'forces-add':   '// === [forces-add] ===',
  'forces-mul':   '// === [forces-mul] ===',
  'set/mul/add':  '// === [set/mul/add] ===',
  'constraints':  '// === [constraints] ===',
  'death':        '// === [death] ===',
};

function bucketForModule(mod) {
  // Force modules: forceMode 'add' (default) or 'mul'
  if (mod.kind === 'force' || mod.kind === 'force-field') {
    return mod.forceMode === 'mul' ? 'forces-mul' : 'forces-add';
  }
  if (mod.kind === 'overlife') return 'set/mul/add';
  // Phase 2B will fill these (constraint and death modules):
  if (mod.kind === 'constraint') return 'constraints';
  if (mod.kind === 'death') return 'death';
  // Phase 2A modules without a kind set → assume set/mul/add (safe default).
  return 'set/mul/add';
}

// Returns the assembled WGSL source for this emitter.
// Throws if a module has no wgslSnippet (i.e. not yet ported to WebGPU).
export function buildShaderSource(emitter, templateWgsl, evalBoundWgsl, lutCtx) {
  const { wgsl: structWgsl, layout } = emitModuleParamsStruct(emitter);

  // Group modules by bucket.
  const bucketSnippets = {
    'forces-add':  [],
    'forces-mul':  [],
    'set/mul/add': [],
    'constraints': [],
    'death':       [],
  };
  for (let mi = 0; mi < emitter.config.modules.length; mi++) {
    const mod = emitter.config.modules[mi];
    if (mod.kind === 'shape') continue;   // not a per-particle module
    if (typeof mod.wgslSnippet !== 'function') {
      throw new Error(
        `module-codegen: module "${mod.moduleName ?? mod.name}" has no wgslSnippet ` +
        `(not yet ported to WebGPU). Phase 2A supports: gravity, drag, attractor, ` +
        `velocityOverLifetime, sizeOverLifetime, colorOverLifetime.`
      );
    }
    // Build paramRefs: { paramName: structField } for this module's bound params,
    // plus codegen-time enum values for non-Bound fields like attractor.falloff.
    const paramRefs = {};
    for (const entry of layout) {
      if (entry.moduleIndex === mi) {
        paramRefs[entry.paramName] = entry.structField;
      }
    }
    // Pass-through codegen-time values from mod.params for modules that branch
    // at codegen (e.g. attractor's falloff: 'inv-square' | 'inverse').
    // Also handles numeric non-bound params (e.g. constraint.restitution) —
    // emitted as WGSL float literals so snippets can reference them directly.
    if (mod.params) {
      for (const [k, v] of Object.entries(mod.params)) {
        if (k in paramRefs) continue;   // already a Bound paramRef
        if (typeof v === 'string') {
          paramRefs[k] = v;   // codegen-time enum
        } else if (typeof v === 'number') {
          // Numeric non-bound param — emit as WGSL float literal.
          // Keeps the snippet template simple while letting non-bindable
          // scalars (e.g. restitution) participate in codegen.
          paramRefs[k] = v.toFixed(6);
        }
      }
    }
    const snippet = mod.wgslSnippet(paramRefs);
    if (snippet) {
      // Wrap in runtime disable gate. Bit `mi` of module_params.module_enabled
      // is set iff modules[mi].disabled is falsy. Branch is on a uniform read
      // so all threads in a wave take the same path — no divergence.
      const wordChan = ['x', 'y', 'z', 'w'][mi >> 5];
      const bitIdx = mi & 31;
      const gated = `  if ((module_params.module_enabled.${wordChan} & (1u << ${bitIdx}u)) != 0u) {\n${snippet}\n  }`;
      bucketSnippets[bucketForModule(mod)].push(gated);
    }
  }

  // Substitute each marker with its concatenated snippets.
  let src = templateWgsl;
  for (const bucket of BUCKETS) {
    const concat = bucketSnippets[bucket].join('\n');
    src = src.replace(MARKERS[bucket], concat);
  }

  // Prepend eval_bound.wgsl + ModuleParams struct + curve/gradient bindings.
  // Final layout:
  //   group(2): 0 = module_params (uniform), 1 = curves, 2 = sampler, 3 = gradients.
  return `${evalBoundWgsl}\n${structWgsl}\n${src}`;
}
