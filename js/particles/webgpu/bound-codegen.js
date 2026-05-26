// bound-codegen.js — JS Bound → GPU Bound struct serialization.
//
// Each Bound serializes to 16 floats / 64 bytes matching eval_bound.wgsl:
//   [0]  source_id (u32)   - via Float32Array view + Uint32Array overlay
//   [1]  constant_value
//   [2]  smooth
//   [3]  multiplier
//   [4]  range_min
//   [5]  range_max
//   [6]  curve_id (u32)
//   [7]  gradient_id (u32)
//   [8]  flags (u32)
//   [9-15] padding (zero)
//
// Source IDs MUST match eval_bound.wgsl's `BSRC_*` constants exactly.

import { Curve, Gradient } from '../core/curves.js';

export const BOUND_SIZE_BYTES = 64;
export const BOUND_SIZE_FLOATS = 16;

export const BOUND_SOURCE_ID = {
  // Constants
  __const__: 0,
  // Per-particle
  life:   1,
  age:    2,
  speed:  3,
  posY:   4,
  radial: 5,
  random: 6,
  // System
  time:   7,
  frame:  8,
};
let _audioIdCursor = 50;
function _registerAudioSourceIds() {
  if (BOUND_SOURCE_ID.__audio_registered__) return;
  BOUND_SOURCE_ID.__audio_registered__ = true;
  // Hardcode the audio source names from particles/core/bound.js. Keep this
  // list in sync if bound.js's audio sources change. (Only consumed shape-wise
  // in Phase 2A; Phase 3 fills in the actual audio reads in eval_bound.wgsl.)
  const STEMS = ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'];
  const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const audioNames = [
    'audio.rms','audio.flux','audio.centroid','audio.rolloff','audio.flatness','audio.zcr',
    'audio.bands.sub','audio.bands.bass','audio.bands.low_mid','audio.bands.mid',
    'audio.bands.high_mid','audio.bands.presence','audio.bands.brilliance',
    'audio.beat.flash','audio.beat.phase','audio.bpm',
  ];
  for (const c of ['kick','snare','hat','cymbal']) audioNames.push('audio.drum_band.' + c);
  for (const s of STEMS) {
    audioNames.push('audio.stems.' + s + '.rms');
    audioNames.push('audio.stems.' + s + '.flux');
    audioNames.push('audio.stems.' + s + '.centroid');
  }
  for (const s of [...STEMS, 'mix']) audioNames.push('audio.onsets.' + s + '.flash');
  for (const c of ['kick','snare','hat']) audioNames.push('audio.onsets.' + c + '.flash');
  for (const note of NOTES) {
    audioNames.push('audio.chroma.' + note);
    audioNames.push('audio.chroma_harmonic.' + note);
    audioNames.push('audio.chroma_stems.' + note);
  }
  for (const name of audioNames) {
    BOUND_SOURCE_ID[name] = _audioIdCursor++;
  }
}

// Returns a "shape descriptor" used for pipeline cache keying.
// Different shapes → different shader source → different pipeline.
export function boundShape(jsBound) {
  if (typeof jsBound === 'number') return { kind: 'const' };
  if (Array.isArray(jsBound)) return { kind: 'const-array' };   // vec3 / rgba constant
  if (jsBound instanceof Curve) return { kind: 'curve-shorthand' };
  if (jsBound instanceof Gradient) return { kind: 'gradient-shorthand' };
  if (jsBound && typeof jsBound === 'object' && 'min' in jsBound && 'max' in jsBound) {
    return { kind: 'range' };
  }
  if (jsBound && typeof jsBound === 'object' && 'source' in jsBound) {
    return {
      kind: 'source',
      source: jsBound.source,
      hasCurve: !!jsBound.curve,
      hasGradient: !!jsBound.gradient,
      hasSmoothing: typeof jsBound.smoothing === 'number' && jsBound.smoothing > 0,
      normalise: jsBound.normalise !== false,
    };
  }
  return { kind: 'unknown' };
}

// Write `jsBound` into `dstFloats` at `offsetFloats` (offset in float32 units).
// `lutCtx` is { curveIds, gradientIds }: maps Curve/Gradient instance → 1-based id.
export function serializeBound(jsBound, dstFloats, dstUints, offsetFloats, lutCtx) {
  _registerAudioSourceIds();
  // Zero the 16-float region first.
  for (let k = 0; k < BOUND_SIZE_FLOATS; k++) dstFloats[offsetFloats + k] = 0;

  if (typeof jsBound === 'number') {
    dstUints[offsetFloats + 0] = BOUND_SOURCE_ID.__const__;
    dstFloats[offsetFloats + 1] = jsBound;
    dstFloats[offsetFloats + 3] = 1.0;
    return;
  }

  if (Array.isArray(jsBound)) {
    // vec3 / rgba constant — pack components into adjacent fields.
    // For RGBA (length 4): pack into (constant_value=r, multiplier=g, range_min=b, range_max=a).
    // (eval_bound_color reads them back from these slots.)
    dstUints[offsetFloats + 0] = BOUND_SOURCE_ID.__const__;
    dstFloats[offsetFloats + 1] = jsBound[0] ?? 0;
    dstFloats[offsetFloats + 3] = jsBound[1] ?? 0;
    dstFloats[offsetFloats + 4] = jsBound[2] ?? 0;
    dstFloats[offsetFloats + 5] = jsBound[3] ?? 1;
    return;
  }

  if (jsBound instanceof Curve) {
    dstUints[offsetFloats + 0] = BOUND_SOURCE_ID.life;
    dstFloats[offsetFloats + 3] = 1.0;
    const cid = lutCtx.curveIds.get(jsBound);
    if (!cid) throw new Error('serializeBound: Curve not registered in lutCtx');
    dstUints[offsetFloats + 6] = cid;
    dstUints[offsetFloats + 8] = 1;        // flags bit 0 = normalise_auto
    dstFloats[offsetFloats + 4] = 0;
    dstFloats[offsetFloats + 5] = 1;
    return;
  }

  if (jsBound instanceof Gradient) {
    dstUints[offsetFloats + 0] = BOUND_SOURCE_ID.life;
    dstFloats[offsetFloats + 3] = 1.0;
    const gid = lutCtx.gradientIds.get(jsBound);
    if (!gid) throw new Error('serializeBound: Gradient not registered in lutCtx');
    dstUints[offsetFloats + 7] = gid;
    dstUints[offsetFloats + 8] = 1;
    dstFloats[offsetFloats + 4] = 0;
    dstFloats[offsetFloats + 5] = 1;
    return;
  }

  if (jsBound && typeof jsBound === 'object' && 'source' in jsBound) {
    const sid = BOUND_SOURCE_ID[jsBound.source];
    if (sid === undefined) {
      // Unknown source: fall back to constant 0.
      dstUints[offsetFloats + 0] = BOUND_SOURCE_ID.__const__;
      dstFloats[offsetFloats + 1] = 0;
      dstFloats[offsetFloats + 3] = 1.0;
      return;
    }
    dstUints[offsetFloats + 0] = sid;
    dstFloats[offsetFloats + 3] = (jsBound.scale !== undefined) ? jsBound.scale : 1.0;
    if (jsBound.curve) {
      const cid = lutCtx.curveIds.get(jsBound.curve);
      if (!cid) throw new Error('serializeBound: source-bound curve not registered');
      dstUints[offsetFloats + 6] = cid;
    }
    if (jsBound.gradient) {
      const gid = lutCtx.gradientIds.get(jsBound.gradient);
      if (!gid) throw new Error('serializeBound: source-bound gradient not registered');
      dstUints[offsetFloats + 7] = gid;
    }
    // range:[a,b] (Phase 2B fix #1) — defaults to [0,1] for identity normalise
    if (Array.isArray(jsBound.range)) {
      dstFloats[offsetFloats + 4] = jsBound.range[0] ?? 0;
      dstFloats[offsetFloats + 5] = jsBound.range[1] ?? 1;
    } else {
      dstFloats[offsetFloats + 4] = 0;
      dstFloats[offsetFloats + 5] = 1;
    }
    if (jsBound.normalise !== false) dstUints[offsetFloats + 8] |= 1;
    // Smoothing (Phase 2B): if smoothing > 0, pack smooth_factor + slot into
    // bits 1-4 of flags. Each emitter has its own 0..15 slot counter via
    // lutCtx.smoothingSlotCursor.
    if (typeof jsBound.smoothing === 'number' && jsBound.smoothing > 0) {
      const cursor = lutCtx.smoothingSlotCursor;
      if (cursor === undefined) {
        throw new Error('serializeBound: lutCtx.smoothingSlotCursor missing');
      }
      if (cursor.value > 15) {
        throw new Error('serializeBound: emitter exceeded 16 smoothing slots');
      }
      const slot = cursor.value++;
      dstFloats[offsetFloats + 2] = jsBound.smoothing;     // smooth_factor
      dstUints[offsetFloats + 8] |= (slot & 0xF) << 1;      // bits 1-4 = smoothing_slot
    }
    return;
  }

  // Fallback: treat as zero constant.
  dstUints[offsetFloats + 0] = BOUND_SOURCE_ID.__const__;
  dstFloats[offsetFloats + 3] = 1.0;
}

// Returns a frozen [[name, id], ...] array of all registered audio sources.
// Used by system.js to walk audioFeed.sample(name) for each audio source ID
// every frame and write the values into the audio uniform buffer.
export function getAudioSourceTable() {
    _registerAudioSourceIds();
    const table = [];
    for (const [name, id] of Object.entries(BOUND_SOURCE_ID)) {
        if (typeof id === 'number' && id >= 50 && name.startsWith('audio.')) {
            table.push([name, id]);
        }
    }
    return Object.freeze(table);
}

// Emit the per-emitter ModuleParams WGSL struct declaration.
// Returns { wgsl: string, layout: [{ moduleIndex, paramName, structField }, ...] }.
export function emitModuleParamsStruct(emitter) {
  const fields = [];
  const layout = [];
  for (let mi = 0; mi < emitter.config.modules.length; mi++) {
    const mod = emitter.config.modules[mi];
    const name = mod.moduleName ?? mod.name ?? 'mod';
    if (!mod.params) continue;
    for (const [paramName, paramValue] of Object.entries(mod.params)) {
      // Skip non-Bound params (codegen-time enums like attractor.falloff).
      if (typeof paramValue === 'string') continue;
      if (paramValue instanceof Curve || paramValue instanceof Gradient ||
          typeof paramValue === 'number' ||
          (typeof paramValue === 'object' && paramValue !== null)) {
        const field = `m${mi}_${name.replace(/[^A-Za-z0-9]/g, '_')}_${paramName}`;
        fields.push(`    ${field}: Bound,`);
        layout.push({ moduleIndex: mi, paramName, structField: field });
      }
    }
  }
  // module_enabled bitmask: lane i bit j = !modules[i*32+j].disabled.
  // 4 lanes × 32 bits = up to 128 modules per emitter. Wrapped around each
  // module's wgslSnippet by module-codegen.js so toggling m.disabled in the
  // UI takes effect on the very next frame without recompiling the pipeline.
  // Also satisfies WGSL's "structs must have at least one member" requirement
  // when an emitter has no Bound params (e.g. stress preset modules: []).
  fields.push('    module_enabled: vec4<u32>,');
  const wgsl = `struct ModuleParams {\n${fields.join('\n')}\n}\n@group(2) @binding(0) var<uniform> module_params: ModuleParams;\n`;
  return { wgsl, layout };
}
