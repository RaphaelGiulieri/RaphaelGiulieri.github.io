// presets.js — collection of starter configs that exercise different
// combinations of shapes, emission patterns, and modules. Each preset is a
// pure function returning a fresh config so live-editing never mutates the
// shared baseline.

import * as shapes from './shapes.js';
import * as modules from './modules.js';
import { Curve, Gradient } from './curves.js';

export const PRESETS = [
  'fountain', 'explosion', 'snow', 'rain', 'smoke', 'galaxy', 'beats', 'stress', 'boids', 'fluid', 'balls', 'empty', '_bench-spawn',
];

export function buildPreset(name) {
  switch (name) {
    case 'fountain':  return fountain();
    case 'explosion': return explosion();
    case 'snow':      return snow();
    case 'rain':      return rain();
    case 'smoke':     return smoke();
    case 'galaxy':    return galaxy();
    case 'beats':     return beats();
    case 'stress':    return stress();
    case 'boids':     return boids();
    case 'fluid':     return fluid();
    case 'balls':     return balls();
    case 'empty':     return empty();
    case '_bench-spawn': return benchSpawn();
    default: throw new Error('unknown preset: ' + name);
  }
}

// Phase 2.5 verification preset: sustained 250k particles/sec for 60s.
// Steady-state alive ≈ 250k × 4s life = 1M. maxParticles=1.5M for headroom.
function benchSpawn() {
  return {
    name: '_bench-spawn',
    cameraDist: 60,
    blend: 'additive',
    maxParticles: 1500000,
    emitters: [{
      position: [0, 0, 0],
      shape: shapes.box({ size: [40, 40, 40] }),
      rate: 250000,
      bursts: [],
      initial: { lifetime: 4, speed: 0, size: 0.08, color: [0.5, 0.8, 1, 0.3] },
    }],
  };
}

function fountain() {
  return {
    name: 'fountain',
    cameraDist: 18,
    blend: 'additive',
    emitters: [{
      position: [0, 0, 0],
      shape: shapes.cone({ radius: 0.3, halfAngle: Math.PI / 6 }),
      rate: 250,
      bursts: [],
      initial: {
        lifetime: { min: 1.5, max: 2.5 },
        speed:    { min: 6,   max: 9 },
        size:     { min: 0.25, max: 0.45 },
        color: [1, 0.5, 0.1, 1],
      },
      modules: [
        modules.gravity([0, -9.8, 0]),
        modules.drag(0.3),
        modules.sizeOverLifetime(new Curve([[0, 0.0], [0.1, 1.0], [1.0, 0.0]])),
        modules.colorOverLifetime(new Gradient([
          [0.0, [1, 1, 1, 1]],
          [0.5, [1, 0.55, 0.1, 1]],
          [1.0, [0.2, 0, 0, 0]],
        ])),
      ],
    }],
  };
}

function explosion() {
  return {
    name: 'explosion',
    cameraDist: 14,
    blend: 'additive',
    emitters: [{
      position: [0, 0, 0],
      shape: shapes.sphere({ radius: 0.05, surface: false }),
      rate: 0,
      bursts: [{ time: 0.0, count: 800, repeat: true, interval: 2.5 }],
      initial: {
        lifetime: { min: 1.0, max: 1.8 },
        speed:    { min: 5,   max: 14 },
        size:     0.30,
        color: [1, 1, 0.6, 1],
      },
      modules: [
        modules.gravity([0, -3, 0]),
        modules.drag(1.6),
        modules.sizeOverLifetime(new Curve([[0, 0.0], [0.1, 1.2], [1.0, 0.0]])),
        modules.colorOverLifetime(new Gradient([
          [0.0, [1.0, 1.0, 0.7, 1]],
          [0.5, [1.0, 0.4, 0.1, 1]],
          [1.0, [0.0, 0.0, 0.0, 0]],
        ])),
      ],
    }],
  };
}

function snow() {
  return {
    name: 'snow',
    cameraDist: 22,
    blend: 'alpha',
    emitters: [{
      position: [0, 8, 0],
      shape: shapes.box({ size: [16, 0.1, 16] }),
      rate: 200,
      bursts: [],
      initial: {
        lifetime: { min: 5, max: 9 },
        speed:    0,
        size:     { min: 0.15, max: 0.30 },
        rotation: { min: 0, max: Math.PI * 2 },
        angularVelocity: { min: -1, max: 1 },
        color: [1, 1, 1, 0.85],
      },
      modules: [
        modules.gravity([0, -0.6, 0]),
        modules.curlNoise({ frequency: 0.25, amplitude: 1.0, evolveSpeed: 0.2 }),
      ],
    }],
  };
}

function rain() {
  return {
    name: 'rain',
    cameraDist: 18,
    blend: 'alpha',
    emitters: [{
      position: [0, 9, 0],
      shape: shapes.box({ size: [14, 0.1, 14] }),
      rate: 600,
      bursts: [],
      initial: {
        lifetime: { min: 0.8, max: 1.0 },
        speed:    0,
        size:     { min: 0.06, max: 0.12 },
        color: [0.6, 0.75, 1.0, 0.7],
      },
      modules: [
        modules.gravity([0, -25, 0]),
      ],
    }],
  };
}

function smoke() {
  return {
    name: 'smoke',
    cameraDist: 14,
    blend: 'alpha',
    emitters: [{
      position: [0, 0, 0],
      shape: shapes.disc({ radius: 0.6 }),
      rate: 120,
      bursts: [],
      initial: {
        lifetime: { min: 3, max: 5 },
        speed:    { min: 0.6, max: 1.4 },
        size:     0.4,
        color: [0.85, 0.85, 0.85, 0.45],
      },
      modules: [
        modules.curlNoise({ frequency: 0.45, amplitude: 1.4, evolveSpeed: 0.15 }),
        modules.sizeOverLifetime(new Curve([[0, 0.2], [1, 1.6]])),
        modules.colorOverLifetime(new Gradient([
          [0.0, [0.95, 0.95, 0.95, 0.55]],
          [1.0, [0.30, 0.30, 0.30, 0.0]],
        ])),
      ],
    }],
  };
}

function galaxy() {
  return {
    name: 'galaxy',
    cameraDist: 18,
    blend: 'additive',
    emitters: [{
      position: [0, 0, 0],
      shape: shapes.sphere({ radius: 5, surface: false }),
      rate: 0,
      bursts: [{ time: 0, count: 5000 }],
      initial: {
        lifetime: 60,
        speed:    0,
        size:     { min: 0.06, max: 0.14 },
        color: [1, 0.7, 0.45, 1],
      },
      modules: [
        modules.attractor({ position: [0, 0, 0], strength: 6, falloff: 'inv-square' }),
        modules.velocityOverLifetime({ swirl: 6 }),
      ],
    }],
  };
}

function stress() {
  return {
    name: 'stress',
    cameraDist: 22,
    blend: 'additive',
    // Headroom up to 8M so the user can crank burst counts past 1M without
    // hitting the preset cap. Buffers are sized at this number (× 2 for
    // ping-pong) — at 80B/particle that's ~1.3GB GPU memory committed for
    // this preset. Adapter limit on the dev box is ~2GB so we have room.
    maxParticles: 8000000,
    emitters: [{
      position: [0, 0, 0],
      shape: shapes.sphere({ radius: 4, surface: false }),
      rate: 0,
      bursts: [{ time: 0, count: 1000000 }],
      initial: {
        lifetime: 10,
        speed:    { min: 1, max: 3 },
        size:     0.1,
        color: [1, 0.5, 0.2, 0.8],
      },
      modules: [],
    }],
  };
}

function boids() {
  return {
    name: 'boids',
    cameraDist: 22,
    cameraAngle: 0.6,
    cameraAngleY: 0.25,
    blend: 'additive',
    interaction: {
      mode: 'boids',
      // Larger cellSize so each particle sees ~5–10 neighbours.  With
      // strong cohesion+alignment this is what clusters into visible
      // bird/fish flocks rather than a uniform cloud.
      cellSize: 1.5,
      worldHalfExtent: 14,
      boids: {
        // Strong cohesion + alignment dominate over the curl-noise
        // wandering: clusters form (positive feedback — denser groups
        // attract more particles via cohesion), then travel together via
        // alignment.  Separation tight (low weight + small radius) so
        // groups can pack densely.
        sepRadius: 0.4, sepWeight: 0.8,
        alignWeight: 3.0, cohWeight: 3.0,
        maxAccel: 30, maxSpeed: 7,
      },
    },
    emitters: [{
      name: 'flock',
      shape: shapes.sphere({ radius: 6, surface: false }),
      rate: 100,
      bursts: [],
      initial: {
        lifetime: 60.0,
        speed:    { min: 1.0, max: 2.5 },
        size:     0.07,
        color:    [0.85, 0.95, 1.00, 1.0],
        direction: 'shape',
      },
      modules: [
        // Gentle pull toward origin (inverse falloff) prevents flocks
        // drifting to the boundary and bouncing into a shell.  Strength
        // small enough that boids forces dominate locally; the attractor
        // is only meaningful far from origin.
        modules.force.attractor({ position: [0, 0, 0], strength: 1.5, falloff: 'inverse' }),
        // CurlNoise — large eddies (low frequency) so whole flocks turn
        // together rather than per-particle jitter.  Amplitude small
        // enough that cohesion+alignment still dominate close-range.
        modules.force.curlNoise({ frequency: 0.07, amplitude: 1.5, evolveSpeed: 0.25, octaves: 2 }),
        modules.force.drag(0.03),
        // Outer safety net — sphere bounce just outside the visible
        // volume so wandering flocks turn around rather than escape.
        modules.constraint.sphere({ radius: 13, mode: 'bounce', restitution: 0.9 }),
      ],
    }],
  };
}

function fluid() {
  return {
    name: 'fluid',
    cameraDist: 26,
    cameraAngle: 0.6,
    cameraAngleY: 0.45,
    blend: 'additive',
    interaction: {
      mode: 'sph',
      cellSize: 0.8,
      worldHalfExtent: 12,
      sph: {
        // smoothingRadius = cellSize for grid coherence (each particle's
        // kernel fits in its 27-neighbour walk).
        smoothingRadius: 0.8,
        // restDensity tuned to the spawn lattice density at this h+mass —
        // smaller value lets accumulation pool into a visible mound at
        // the floor rather than maintaining uniform density.
        restDensity:     250,
        // Lower stiffness = softer fluid that compresses into a pile
        // under gravity, instead of bouncing back like a rigid spring.
        stiffness:       60,
        viscosity:       50,
        mass:            1.0,
      },
    },
    emitters: [{
      name: 'spout',
      shape: shapes.point(),
      position: [0, 9, 0],
      // Slower spawn so the pile grows at a rate the eye can follow.
      // At ~12k steady state (1500/s × 8s) the pool fills the box floor
      // without saturating the GPU.
      rate: 1500,
      bursts: [],
      initial: {
        lifetime: 8.0,
        speed:    { min: 0.5, max: 1.5 },
        size:     0.08,
        color:    [0.40, 0.78, 1.00, 1.0],
        direction: [0, -1, 0],
      },
      modules: [
        modules.force.gravity([0, -9.8, 0]),
        // Symmetric half-extent box around origin — see particles/core/modules.js:676
        // for the {sx,sy,sz,mode,restitution} API. Restitution 0.1 = nearly
        // inelastic floor; the fluid settles instead of bouncing back up.
        modules.constraint.box({ sx: 10, sy: 10, sz: 10, mode: 'bounce', restitution: 0.1 }),
      ],
    }],
  };
}

// Test preset for visual debugging: big solid spheres falling and piling up
// in a transparent box. Uses boids separation as a particle-particle
// collision-repulsion (sepWeight high, align/coh zero) so balls actually
// stack instead of flattening into a disc. Alpha-over + no bloom + size 0.5
// makes each ball a distinct visible sphere.
function balls() {
  return {
    name: 'balls',
    cameraDist: 26,
    cameraAngle: 0.6,
    cameraAngleY: 0.45,
    blend: 'alpha-over',           // opaque-looking balls, not additive bloom
    interaction: {
      mode: 'boids',
      // Fluid-flavoured per-particle interaction with realistic gravity:
      //   • Separation: gentle (sepWeight 60) so neighbours push apart
      //     softly instead of recoiling like rubber.
      //   • Alignment: positive (alignWeight 1.5) so neighbours share
      //     velocity — this is the damping that kills the bouncy feel.
      //     A moving ball entering a static pile gets pulled toward
      //     mean-neighbour-velocity (= 0), bleeding kinetic energy
      //     into the system as a whole.
      //   • Cohesion: zero (cohWeight 0) — we don't want flock-style
      //     clustering, just settle-and-flow.
      cellSize: 1.6,
      worldHalfExtent: 14,
      boids: {
        sepRadius: 1.3, sepWeight: 60.0,
        alignWeight: 1.5, cohWeight: 0.0,
        // maxAccel kept high (400) so contact still wins over gravity in
        // one frame, but not so violent that motion looks ejected.
        maxAccel: 400, maxSpeed: 16.0,
      },
    },
    emitters: [{
      name: 'spout',
      // Disc spawn gives lateral spread so balls don't all fall on the
      // same X=Z=0 line. Default disc outDir is +Y; we override to -Y.
      shape: shapes.disc({ radius: 2.5, direction: [0, -1, 0] }),
      position: [0, 6, 0],
      // Slow drip — each new ball arrives after the pile has settled,
      // so contact events are clean instead of stacked.
      rate: 20,
      bursts: [],
      initial: {
        lifetime: 12.0,
        speed:    { min: 0.0, max: 0.2 },
        size:     0.6,
        color:    [0.85, 0.9, 1.0, 1.0],
        direction: 'shape',
      },
      modules: [
        // Real Earth gravity.
        modules.force.gravity([0, -9.8, 0]),
        // Global drag — bleeds bulk kinetic energy so the pile settles
        // instead of jittering forever.  Coefficient 1.0 = halve velocity
        // every ~0.7s, which is fast enough to kill bouncing without
        // freezing the system.
        modules.force.drag(1.0),
        // Perfectly inelastic floor — balls stop dead on contact.
        // Separation pushes new arrivals sideways onto existing ones.
        modules.constraint.box({ sx: 5, sy: 8, sz: 5, mode: 'bounce', restitution: 0.0 }),
      ],
    }],
  };
}

function empty() {
  return {
    name: 'empty',
    cameraDist: 14,
    blend: 'additive',
    emitters: [],
  };
}

// HSL → linear RGBA. h ∈ [0,1] (0=red, 1/3=green, 2/3=blue), s/l ∈ [0,1].
// Used to colour the chroma row (12 hues around the wheel) and the bands
// row (red→blue across the spectrum).
function _hsla(h, s, l, a = 1) {
  const k = (n) => (n + h * 12) % 12;
  const f = (n) => l - s * Math.min(l, 1 - l)
                   * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4), a];
}

// Threshold-gate curve for a Bound rate. Returns a Curve that's 0 below
// `t` (channel below threshold → no spawning), then ramps linearly to 1.0
// at the source's typical-loud peak. Used to make every channel SILENT
// unless its data crosses a meaningful intensity floor — turns the
// constant-rate visualisation into an event-driven one.
function _gate(t) {
  return new Curve([[0, 0], [t, 0], [1, 1]]);
}

// Per-channel "ground geyser": a tiny disc at [x, 0, z] that emits at a
// CONSTANT rate. What changes with channel intensity is (a) the initial
// upward velocity — particles JUMP HIGH on hot moments, settle low when
// the channel is quiet — and (b) brightness via mul.intensity.
//
// Layout invariants (so the rows read uniformly across 29 channels):
//   - constant rate                 → every column is always alive
//   - speed bound to source         → height = signal intensity
//   - mul.intensity bound to source → brightness = signal intensity
//   - lifetime ~2 s                 → the jump arc has time to play out
//
// Numbers tuned for normalised sources (bound.js defaultRanges set so a
// hot passage maps to ~1.0): peak speed ~16 m/s with gravity 7 → apex ~18m;
// quiet floor speed 1 m/s → particles barely lift, just visible at ground.
// `mode` selects spawn behaviour:
//   'rate'    — continuous spawn rate proportional to source envelope
//               (best for sustained signals: stems, bands, chroma).
//   'onset'   — trigger fires a burst on each rising-edge of an onset
//               flash channel (best for drums: kick/snare/hat/cymbal).
function _channelGeyser(name, position, src, color, mode = 'rate', onsetSrc = null) {
  const base = {
    name,
    position,
    shape: shapes.disc({ radius: 0.30 }),
    initial: {
      lifetime: { min: 1.4, max: 2.0 },
      // FIXED high speed — every spawned particle visibly jumps. Density
      // is the intensity cue (more particles = louder channel), not speed.
      speed:    { min: 11, max: 14 },
      size:     0.30,
      color,
      direction: [0, 1, 0],
    },
    modules: [
      modules.force.gravity([0, -15, 0]),
      modules.force.drag(0.10),
      modules.set.size(new Curve([[0, 0.4], [0.2, 1.0], [1, 0.0]])),
    ],
  };
  if (mode === 'onset') {
    // Drum-style: BURST on each rising-edge of an onset.flash channel.
    // onsets.<X>.flash decays from 1.0 over ~150 ms after each detected
    // hit, so threshold 0.5 fires once per drum hit (clean rising edge).
    // Burst count is high (400) so the per-beat plume dominates the
    // visual against the rate-bound bands/chroma background.
    base.rate = 0;
    base.bursts = [];
    base.triggers = [{ source: onsetSrc, threshold: 0.5, count: 400 }];
    // Drum particles get a bigger size + more upward velocity so they
    // visually pop above the sustained plumes of other channels.
    base.initial.size = 0.45;
    base.initial.speed = { min: 14, max: 18 };
  } else {
    // Sustained-style: spawn rate proportional to envelope, GATED by a
    // 30%-of-typical-loud threshold. Below the threshold the curve clamps
    // to 0 — column is dark and quiet. Above it, rate ramps linearly up
    // to `scale` particles/sec at peak. So a column only fires when its
    // data is meaningfully active, not just at noise-floor levels.
    base.rate = { source: src, scale: 2000, curve: _gate(0.30) };
    base.bursts = [];
    base.triggers = [];
  }
  return base;
}

// Lay a list of {name, src, color, mode?, onsetSrc?} channels in a horizontal
// row centered at z. Each channel can override mode ('rate' | 'onset').
function _channelRow(channels, z, spacing = 1.6) {
  const N = channels.length;
  return channels.map((c, i) => _channelGeyser(
    c.name,
    [(i - (N - 1) / 2) * spacing, 0, z],
    c.src, c.color, c.mode || 'rate', c.onsetSrc,
  ));
}

// `beats` — debug-tier audio visualiser.
//
// One emitter per data channel, each rendered as a tiny ground-disc that
// shoots a vertical fountain whose count tracks the channel's intensity.
// Lays the channels out in four parallel rows on the Y=0 plane so every
// signal is visually individuated:
//
//   Drums   z=-3   kick  snare  hat  cymbal           (4 cols)
//   Stems   z=-1   vocals drums bass other guitar piano  (6 cols)
//   Bands   z=+1   sub bass low_mid mid high_mid presence brilliance  (7)
//   Chroma  z=+3   C C# D D# E F F# G G# A A# B          (12 cols)
//
// Source ranges are auto-normalised by bound.js (each registered with a
// representative defaultRange), so the per-channel speed/brightness
// bindings inside _channelGeyser produce comparable visual responses
// across all four rows.
function beats() {
  // Drum components — onset-trigger mode so each beat fires a discrete
  // BURST. drum_band.* envelopes are smooth, but we want crisp "BAM" on
  // each individual hit, not a smeared plume — so we trigger off the
  // onsets.<X>.flash impulse channels instead. (cymbal has no dedicated
  // onset stream, so it falls back to drum_band.cymbal envelope rate.)
  const drums = [
    { name: 'kick',   color: [1.00, 0.30, 0.10, 1], mode: 'onset', src: 'audio.drum_band.kick',   onsetSrc: 'audio.onsets.kick.flash'  },
    { name: 'snare',  color: [1.00, 0.55, 0.20, 1], mode: 'onset', src: 'audio.drum_band.snare',  onsetSrc: 'audio.onsets.snare.flash' },
    { name: 'hat',    color: [1.00, 0.85, 0.35, 1], mode: 'onset', src: 'audio.drum_band.hat',    onsetSrc: 'audio.onsets.hat.flash'   },
    { name: 'cymbal', color: [0.85, 0.95, 1.00, 1],                src: 'audio.drum_band.cymbal' },
  ];

  // Per-stem RMS (6-stem htdemucs_6s output).
  const stems = [
    { name: 'st_vocals', src: 'audio.stems.vocals.rms', color: [0.40, 0.75, 1.00, 1] },
    { name: 'st_drums',  src: 'audio.stems.drums.rms',  color: [0.30, 0.95, 0.85, 1] },
    { name: 'st_bass',   src: 'audio.stems.bass.rms',   color: [0.30, 0.95, 0.45, 1] },
    { name: 'st_other',  src: 'audio.stems.other.rms',  color: [0.55, 0.55, 0.95, 1] },
    { name: 'st_guitar', src: 'audio.stems.guitar.rms', color: [0.95, 0.55, 0.95, 1] },
    { name: 'st_piano',  src: 'audio.stems.piano.rms',  color: [0.95, 0.95, 0.55, 1] },
  ];

  // 7 frequency bands — colour mapped low-freq (red) to high-freq (blue).
  const bandNames = ['sub', 'bass', 'low_mid', 'mid', 'high_mid', 'presence', 'brilliance'];
  const bands = bandNames.map((b, i) => ({
    name:  'band_' + b,
    src:   'audio.bands.' + b,
    color: _hsla((1 - i / (bandNames.length - 1)) * 0.7, 0.85, 0.55),
  }));

  // 12 chroma harmonic — colour mapped around the wheel.
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const chroma = noteNames.map((n, i) => ({
    name:  'chroma_' + n,
    src:   'audio.chroma_harmonic.' + n,
    color: _hsla(i / 12, 0.95, 0.55),
  }));

  return {
    name: 'beats',
    // Camera looks at the layout from the +Z axis, tilted slightly down.
    // World axes: rows span X (left-right on screen), z is depth (rows at
    // different z lie at different depths), Y is up. Particles jumping
    // up read as vertical streaks above each disc.
    cameraDist:   18,
    cameraAngle:  Math.PI / 2,   // eye on +Z axis
    cameraAngleY: 0.30,           // ~17° above the layout
    blend: 'additive',
    emitters: [
      ..._channelRow(drums,  -3, /*spacing*/ 1.6),
      ..._channelRow(stems,  -1, /*spacing*/ 1.6),
      ..._channelRow(bands,   1, /*spacing*/ 1.6),
      ..._channelRow(chroma,  3, /*spacing*/ 1.4),
    ],
  };
}
