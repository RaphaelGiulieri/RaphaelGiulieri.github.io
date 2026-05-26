# particles — WebGPU particle system

Browser particle library, GPU-resident simulation. Spawn / update / stream-compaction / indirect draw run as compute shaders; PostFX (bloom + tonemap + vignette + gamma) runs as compute + fragment passes. Tested at **1M particles at 80 fps** on an RTX 3070 with full PostFX, **8M particles at 11 fps**; the spawn pipeline sustains **250k particles/sec** without frame-time spikes.

The library has no runtime dependencies. Drop the `particles/` folder into a project, point a `<script type="module">` at `./particles/index.js`, give it a `<canvas>`, and it works.

**Browser support:** Chrome 113+, Edge, Safari 17.4+, Firefox with `dom.webgpu.enabled=true`. The WebGL2 fallback was decommissioned in Phase 7 — browsers without WebGPU get a clear error from `createParticleSystem`.

## Quick start

```js
import { createParticleSystem, Emitter, shapes, modules, Curve, Gradient }
  from './particles/index.js';

const canvas = document.getElementById('myCanvas');
const ps = await createParticleSystem({
  canvas,
  backend: 'auto',          // 'auto' | 'webgpu' | 'webgl2'  (auto picks webgpu when supported)
  maxParticles: 1_000_000,  // hard cap (buffer size); see Capacity below
  blend: 'additive',        // 'additive' | 'alpha' | 'opaque'
  seed: 42,                 // RNG seed (deterministic spawns within one backend)
});

await ps.addEmitter(new Emitter({
  position: [0, 0, 0],
  shape: shapes.cone({ radius: 0.3, halfAngle: Math.PI / 6 }),
  rate:   250,                                          // particles/sec
  bursts: [{ time: 0, count: 200 }],                    // optional one-shots
  initial: {
    lifetime: { min: 1.5, max: 2.5 },
    speed:    { min: 6, max: 9 },
    size:     { min: 0.25, max: 0.45 },
    color:    [1, 0.5, 0.1, 1],
  },
  modules: [
    modules.gravity([0, -9.8, 0]),
    modules.drag(0.3),
    modules.sizeOverLifetime(new Curve([[0, 0], [0.1, 1], [1, 0]])),
    modules.colorOverLifetime(new Gradient([
      [0,   [1, 1, 1, 1]],
      [0.5, [1, 0.55, 0.1, 1]],
      [1,   [0, 0, 0, 0]],
    ])),
  ],
}));

function frame(now) {
  requestAnimationFrame(frame);
  ps.update(dt);
  ps.render({ view, proj, bgColor: [0.04, 0.03, 0.02, 1] });
}
requestAnimationFrame(frame);
```

## Capacity

| Practical ceiling | Limit source |
|---|---|
| ~26 M particles | adapter `maxStorageBufferBindingSize / 80B` (2 GB / 80 = 26.8 M on RTX 3070) |

`maxParticles` sizes the GPU buffer at construction; runtime growth is supported via `ps.setMaxParticles(n)` (destructive — clears alive particles). The demo's burst-count input auto-grows when the user types beyond the current cap.

## Public API

| Export | What it is |
|---|---|
| `createParticleSystem({canvas, backend, maxParticles, blend, seed})` | async backend-agnostic factory |
| `Emitter`                | one config (rate, bursts, shape, initial values, triggers, modules) |
| `shapes`                 | spawn-shape factories: `point`, `sphere`, `cone`, `box`, `ring`, `line`, `disc` |
| `modules`                | per-particle behaviours (see Modules below) |
| `Curve` / `Gradient`     | over-lifetime LUTs — pre-baked, `sample(t)` is O(1); `update(keys)` mutates in place + bumps `_version` |
| `AudioFeed`              | loads `analysis.json` + `frames.bin` + `melspec.bin` for audio bindings |
| `evalBoundScalar`, `evalBoundColor`, `getSource`, `listSources` | binding internals |

`ps` instance API:

| Member | Purpose |
|---|---|
| `ps.update(dt)` | step the simulation |
| `ps.render({view, proj, pixelScale, bgColor, postfx})` | draw to canvas |
| `ps.addEmitter(emitter)` | (async) attach an Emitter and build its per-emitter resources |
| `ps.reset()` | clear alive particles, reset time, re-seed |
| `ps.setMaxParticles(n)` | (async) re-allocate buffers at new size |
| `ps.getStats()` | `{alive, dropped, simMs, renderMs, gpuMemBytes, maxParticles, backend, realFps}` |
| `ps.aliveByEmitter(idx)` | GPU-synced per-emitter alive count |
| `ps.audioFeed` | optional `AudioFeed` for audio.* bindings |

## Modules

Modules namespaced by intent. Application order each frame:
**`emit.* (once) → force.* → set.* → mul.* → add.* → constraint.* → death events`**.

### `force.*` — accelerations

| Module | Effect |
|---|---|
| `gravity([x,y,z])` | constant acceleration |
| `drag(coefficient)` | exponential velocity decay |
| `attractor({ position, strength, falloff })` | inverse-square or 1/r pull (negative `strength` = repel) |
| `curlNoise({ frequency, amplitude, evolveSpeed, octaves })` | 2-octave pseudo-curl turbulence |
| `wind({ x, y, z, gustiness, gustFreq })` | directional force with optional sinusoidal gusts |
| `vortex({ position, axis, strength, inwardPull })` | rotation around an axis; positive `inwardPull` = spiral sink |
| `spring({ anchor, k, damping })` | Hooke's law pull toward anchor + linear damping |

### `set.*` / `mul.*` / `add.*` — replace / scale / offset each frame

`set.size`, `set.alpha`, `set.color`, `set.rotation`, `set.rotationVel`, `mul.size`, `mul.alpha`, `mul.intensity`, `add.size`, `add.rotation`. Each takes a `Bound` value:
- a number → constant
- a `Curve` / `Gradient` → sampled by particle life
- `{ source, curve|gradient, normalise, range, smooth, multiplier }` → audio-driven

### `constraint.*` — clamp or kill

`constraint.sphere`, `constraint.box`, `constraint.plane`, `constraint.distance`, all with `mode: 'kill' | 'bounce' | 'wrap' | 'clamp'` and optional `restitution` (for bounce).

### Over-lifetime sugar

`sizeOverLifetime(curve)`, `colorOverLifetime(gradient)`, `rotationOverLifetime(curve)`, `velocityOverLifetime(...)`. Convenience wrappers around `set.*`.

## Audio bindings

Any module param accepting a Bound also accepts `{ source: 'audio.<name>', curve|gradient, ...opts }`. The `AudioFeed` constructor takes the URL of an `analysis.json` produced by [the Python pipeline](../README.md). Sources include `audio.rms`, `audio.bands.bass/mid/...`, `audio.beat.flash`, `audio.onsets.<stem>.flash`, `audio.stems.<stem>.rms`, `audio.chroma.<note>`, etc.

Per-emitter `triggers: [{source, threshold, count}]` fires bursts on rising audio edges (drum hits, beat flashes).

## Demo + headless

- `particles/demo.html` — full live editor. URL params: `?preset=<name>`.
- `particles/headless.html` — minimal scriptable harness for screenshots. URL params: `?count=N`, `?shape=<ring|grid|line|cloud>`, `?frames=N`, `?seed=N`. Used by `tools/snap.py`.
- `particles/test.html` — deterministic regression suite (84/0/7 at HEAD).

## Architecture overview

```
particles/
├── core/                    # config + math, no GPU dependencies
│   ├── emitter.js           # Emitter class (rate / bursts / triggers / config)
│   ├── bound.js             # Bound: source registry + curve/smooth/multiplier
│   ├── modules.js           # module registry + WGSL snippets per module
│   ├── shapes.js            # spawn-shape factories
│   ├── curves.js            # Curve / Gradient with version-tracked .update()
│   ├── presets.js           # 9 demo presets
│   ├── audio.js, math.js, rng.js
│   └── pickers.js           # color / curve picker UI
├── webgpu/                  # the GPU backend
│   ├── system.js            # device init, ping-pong, render passes
│   ├── compute.js           # PipelineCache (per-emitter shader codegen)
│   ├── bound-codegen.js     # JS Bound → WGSL Bound struct
│   ├── module-codegen.js    # JS Module → WGSL snippet, runtime disable bitmask
│   ├── postfx.js            # PostFXPipeline (bloom + tonemap + vignette + gamma)
│   ├── spawn-pipeline.js, spawn-descriptor.js
│   └── shaders/             # WGSL: cs_spawn, cs_main, cs_compact_*, postfx_*, eval_bound, ...
└── index.js                 # public API facade
```

## Phase tags

The migration shipped in stages, each tagged on `main`:

| Tag | Brought |
|---|---|
| `phase1-webgpu-mvp`            | WebGPU MVP, single preset, minimum loop |
| `phase2a-foundation`           | Bound codegen, eval_bound WGSL, PipelineCache, curve/gradient LUTs, 6 modules |
| `phase2b-modules-bindings`     | 24 modules total, audio uniforms, per-emitter `triggers` |
| `phase25-gpu-spawning`         | GPU spawn pipeline, 3-pass stream compaction, drawIndirect |
| `phase4-postfx`                | PostFX in WebGPU (bloom + Reinhard + vignette + gamma) |
| `phase5-wiring-polish`         | Backend selector UI, README rewrite, headless `?backend=` (later removed in Phase 7) |
| `phase6-perf-char`             | Perf characterization document (manual benches at 1K → 8M) |
| `phase7-decommission-webgl2`   | WebGL2 backend deleted; WebGPU is the sole rendering path |

## License

(Same as the parent repo.)
