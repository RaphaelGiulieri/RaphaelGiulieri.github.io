// bound.js — evaluates Bound values used throughout the particle system.
//
// A "Bound" is one of:
//   - constant scalar         5
//   - constant array          [0, -9.8, 0]    (vec3)
//   - rgba constant array     [1, 0.5, 0.1, 1]
//   - range                   { min: 1.0, max: 2.5 }
//   - Curve instance          new Curve([...])     (shorthand for source:'life')
//   - Gradient instance       new Gradient([...])  (shorthand for source:'life')
//   - source-driven binding   { source, scale?, offset?, curve?, gradient?,
//                               smoothing?, reduce?, normalise?, mode? }
//
// Phase A1 sources are per-particle + system only. Audio sources land in Phase C.
// `audio.*` source IDs return 0 cleanly so configs survive a phase boundary.

import { Curve, Gradient } from './curves.js';

// ----------------------------------------------------------------- sources

// Each source: { sample(particleIdx, system, ctx), defaultRange: [min,max] }.
// `defaultRange` is used for normalisation when binding.normalise !== false.
const SOURCES = {
  // Per-particle
  life:    { defaultRange: [0, 1],   sample: (i, s) => s.life[i] > 0 ? s.age[i] / s.life[i] : 0 },
  age:     { defaultRange: [0, 5],   sample: (i, s) => s.age[i] },
  speed:   { defaultRange: [0, 30],  sample: (i, s) => Math.hypot(s.vel[i*3], s.vel[i*3+1], s.vel[i*3+2]) },
  posY:    { defaultRange: [-10, 10],sample: (i, s) => s.pos[i*3+1] },
  radial:  { defaultRange: [0, 20],  sample: (i, s) => Math.hypot(s.pos[i*3], s.pos[i*3+1], s.pos[i*3+2]) },
  random:  { defaultRange: [0, 1],   sample: (i, s) => s.stableRand[i] },
  // System
  time:    { defaultRange: [0, 1],   sample: (_, s) => s.time },
  frame:   { defaultRange: [0, 1],   sample: (_, s) => s.frame },
};

// Audio sources — registered last so they override nothing. Each forwards
// to system.audioFeed.sample(...) with the 'audio.' prefix stripped, then
// runs the result through a fast-attack / slow-release envelope follower
// so visual bindings see a HOLD-AND-DECAY signal instead of the raw
// per-frame impulses (which a 60 Hz spawn loop mostly samples between
// hits, producing flat-looking visuals). The envelope is per-source and
// shared across all bindings to that source — the hit holds for ~250 ms
// so e.g. constant-rate emitters land several fast particles per hit.
//
// Per-source state is closure-captured. We gate updates on system.frame
// so the envelope advances exactly once per system tick regardless of how
// many call sites read it.
//
// Pass `releaseTau` (seconds) to override the default decay time, or
// `bypass: true` to return raw values (useful for already-impulse-shaped
// signals like beat.flash / onsets.*.flash that have their own decay).
function feedSrc(channel, range, opts = {}) {
  const releaseTau = opts.releaseTau ?? 0.25;
  const bypass     = !!opts.bypass;
  // Per-frame decay assuming a 60 Hz simulation tick. Tied to s.frame, not
  // audio currentTime, so the envelope still decays toward zero when the
  // user pauses playback (otherwise raw==0 + audio_dt==0 → decay==1 → env
  // freezes at the last live value, and bindings keep firing as if the
  // music were still playing).
  const PER_FRAME_DECAY = Math.exp(-(1 / 60) / releaseTau);
  let env = 0;
  let lastFrame = -1;
  return {
    defaultRange: range,
    sample: (_, s) => {
      if (!s.audioFeed) return 0;
      if (bypass) return s.audioFeed.sample(channel) || 0;
      if (s.frame !== lastFrame) {
        const raw = s.audioFeed.sample(channel) || 0;
        env = Math.max(raw, env * PER_FRAME_DECAY);
        lastFrame = s.frame;
      }
      return env;
    },
  };
}
const STEMS = ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'];
const DRUM_COMPONENTS = ['kick', 'snare', 'hat', 'cymbal'];
const NOTES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const _audioSources = {
  // --- mix-level globals ---
  'audio.rms':       feedSrc('rms',        [0, 0.3]),
  'audio.flux':      feedSrc('flux',       [0, 8]),
  'audio.centroid':  feedSrc('centroid',   [0, 10000]),
  'audio.rolloff':   feedSrc('rolloff',    [0, 22050]),
  'audio.flatness':  feedSrc('flatness',   [0, 1]),
  'audio.zcr':       feedSrc('zcr',        [0, 0.5]),
  // --- 7-band split (raw STFT magnitudes — they are NOT 0..1). Ranges
  // below are TYPICAL-LOUD (P75-ish) per band, not absolute max — so a
  // normal hit on the snare or a chorus crest maps to ~1.0 with visible
  // visual response, instead of a rare absolute peak mapping to 1.0 and
  // every typical hit looking flat at 0.05–0.15. ---
  'audio.bands.sub':         feedSrc('bands.sub',         [0, 60]),
  'audio.bands.bass':        feedSrc('bands.bass',        [0, 50]),
  'audio.bands.low_mid':     feedSrc('bands.low_mid',     [0, 20]),
  'audio.bands.mid':         feedSrc('bands.mid',         [0, 8]),
  'audio.bands.high_mid':    feedSrc('bands.high_mid',    [0, 4]),
  'audio.bands.presence':    feedSrc('bands.presence',    [0, 2]),
  'audio.bands.brilliance':  feedSrc('bands.brilliance',  [0, 0.6]),
  // --- beat — flash/phase/bpm already shaped, skip the envelope follower ---
  'audio.beat.flash':        feedSrc('beat.flash',        [0, 1], { bypass: true }),
  'audio.beat.phase':        feedSrc('beat.phase',        [0, 1], { bypass: true }),
  'audio.bpm':               feedSrc('bpm',               [40, 200], { bypass: true }),
};
// --- v2: drum-component bandpass envelopes. Ranges set to typical-hit
// amplitude (P75-ish), not absolute max — a normal kick/snare on the
// beat maps to ~1.0 so the binding produces a visible visual response
// instead of a faint flicker because we calibrated against a once-per-
// chorus peak.
_audioSources['audio.drum_band.kick']   = feedSrc('drum_band.kick',   [0, 0.4]);
_audioSources['audio.drum_band.snare']  = feedSrc('drum_band.snare',  [0, 3]);
_audioSources['audio.drum_band.hat']    = feedSrc('drum_band.hat',    [0, 2]);
_audioSources['audio.drum_band.cymbal'] = feedSrc('drum_band.cymbal', [0, 2]);
// --- per-stem features (v2: 6 stems × {rms, flux, centroid}) ---
for (const s of STEMS) {
  _audioSources['audio.stems.' + s + '.rms']      = feedSrc('stems.' + s + '.rms',      [0, 0.5]);
  _audioSources['audio.stems.' + s + '.flux']     = feedSrc('stems.' + s + '.flux',     [0, 8]);
  _audioSources['audio.stems.' + s + '.centroid'] = feedSrc('stems.' + s + '.centroid', [0, 10000]);
}
// --- onset flashes: 6 stems + 3 drum components — already impulse-shaped
// (exp decay since last onset), so bypass the envelope follower.
for (const s of [...STEMS, 'mix']) {
  _audioSources['audio.onsets.' + s + '.flash'] = feedSrc('onsets.' + s + '.flash', [0, 1], { bypass: true });
}
for (const c of ['kick', 'snare', 'hat']) {
  _audioSources['audio.onsets.' + c + '.flash'] = feedSrc('onsets.' + c + '.flash', [0, 1], { bypass: true });
}
// --- chroma: full mix (v1), harmonic (v2 default), stems (v2) ---
for (const note of NOTES) {
  _audioSources['audio.chroma.'         + note] = feedSrc('chroma.'          + note, [0, 1]);
  _audioSources['audio.chroma_harmonic.'+ note] = feedSrc('chroma_harmonic.' + note, [0, 1]);
  _audioSources['audio.chroma_stems.'   + note] = feedSrc('chroma_stems.'    + note, [0, 1]);
}
Object.assign(SOURCES, _audioSources);

export function getSource(id) { return SOURCES[id] || null; }
export function listSources() { return Object.keys(SOURCES); }

// ----------------------------------------------------------------- helpers

function isRange(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && 'min' in v && 'max' in v;
}
function isSourceBinding(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && 'source' in v;
}

// Apply scale/offset/curve/normalisation to a raw sample.
//
// When `normalise` is on (the default), the raw value is mapped from
// `src.defaultRange` to [0,1] AND clamped — so a once-per-chorus peak
// that exceeds the typical-loud range doesn't produce a 5× visual
// blow-out. Set `clamp: false` on the bound to opt out (e.g., for
// modules that genuinely want HDR > 1.0 amplification on rare peaks).
function shape(rawValue, bound, src) {
  let v = rawValue;
  if (bound.normalise !== false && src && src.defaultRange) {
    const [lo, hi] = src.defaultRange;
    const span = (hi - lo) || 1;
    v = (v - lo) / span;
    if (bound.clamp !== false) v = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  if (bound.curve) v = bound.curve.sample(v);
  if (bound.scale !== undefined) v *= bound.scale;
  if (bound.offset !== undefined) v += bound.offset;
  return v;
}

// ----------------------------------------------------------------- scalar eval

// Evaluate a scalar Bound at this particle's current state.
// `state` is an optional per-binding object holding {lastValue} for smoothing.
export function evalBoundScalar(bound, particleIdx, system, state) {
  // Constant
  if (typeof bound === 'number') return bound;
  // Curve shorthand → source 'life' + curve
  if (bound instanceof Curve) {
    const s = SOURCES.life;
    return bound.sample(s.sample(particleIdx, system));
  }
  // Range — at live time, return the midpoint. Ranges are typically used in
  // initial.* (spawn-time); calling on a range live is a config smell.
  if (isRange(bound)) return (bound.min + bound.max) / 2;
  // Source binding
  if (isSourceBinding(bound)) {
    const src = SOURCES[bound.source];
    if (!src) {
      // Audio sources etc. that aren't registered yet → graceful 0
      // (so phase A1 configs that reference 'audio.bass' don't crash).
      return bound.offset || 0;
    }
    const raw = src.sample(particleIdx, system);
    let v = shape(raw, bound, src);
    if (bound.smoothing && state) {
      v = state.lastValue + (1 - bound.smoothing) * (v - state.lastValue);
      state.lastValue = v;
    }
    return v;
  }
  return 0;
}

// ----------------------------------------------------------------- spawn-mode

// Evaluate a Bound at particle-birth time; result gets stored on the particle
// (or used as the spawn value for color/size/etc.). Used by the Emitter for
// initial.* values.
export function evalBoundForSpawn(bound, particleIdx, system) {
  if (typeof bound === 'number') return bound;
  if (Array.isArray(bound)) return bound;        // vec3/rgba constant
  if (isRange(bound)) return system.rng.float(bound.min, bound.max);
  if (bound instanceof Curve) return bound.sample(0);
  // Source-driven also valid at spawn time (snapshot-once semantics)
  return evalBoundScalar(bound, particleIdx, system, null);
}

// ----------------------------------------------------------------- color eval

// Evaluate an RGBA Bound and write 4 components into out.
// Accepts: constant rgba array, Gradient (life shorthand), or
//          { source, gradient, scale?, offset?, normalise? }.
export function evalBoundColor(bound, particleIdx, system, out) {
  // Constant rgba
  if (Array.isArray(bound)) {
    out[0] = bound[0]; out[1] = bound[1]; out[2] = bound[2]; out[3] = bound[3] ?? 1;
    return;
  }
  // Gradient shorthand
  if (bound instanceof Gradient) {
    const t = SOURCES.life.sample(particleIdx, system);
    bound.sample(t, out);
    return;
  }
  // Source + gradient
  if (isSourceBinding(bound) && bound.gradient instanceof Gradient) {
    const src = SOURCES[bound.source];
    if (src) {
      const raw = src.sample(particleIdx, system);
      const t = shape(raw, bound, src);
      bound.gradient.sample(Math.max(0, Math.min(1, t)), out);
      return;
    }
  }
  // Default: white
  out[0] = 1; out[1] = 1; out[2] = 1; out[3] = 1;
}

// Type predicates exported for module schemas / editor.
export { isRange, isSourceBinding };
