# particles — expansion plan

## Why this plan

Today the library has 9 modules. The names are mixed (`colorOverLifetime`,
`attractor`, `velocityOverLifetime`) and every "X over lifetime" is a separate
module. That doesn't scale: every new property you'd want to drive (size from
speed, hue from chroma, gravity strength from RMS, attractor strength from
bass band) becomes its own module class with its own UI. Predictable result is
50 near-duplicate modules with subtle differences.

The expansion has three goals:

1. **Coupling** — any numeric parameter on any module can be driven by any
   source: per-particle (age, speed, height, distance, …), system (time,
   beat phase), or audio (RMS, band energies, chroma, onsets, beats).
2. **Coverage** — fill obvious gaps in forces, constraints, sub-emitters.
3. **Cleaner naming** — namespaced categories so the picker (which already
   groups them) is self-documenting.

The goal at the end is "drop a Michelle (Beatles) analysis into the demo,
spend a few minutes wiring sources, and have particles that visibly track the
song." Audio binding is the headliner. Everything else is in service of it.

## 1. Naming convention

Move from a flat module list to a categorised namespace. The picker already
groups by category — this just makes the JS API match.

| Old name                  | New name                          | Notes |
|---------------------------|-----------------------------------|-------|
| `gravity`                 | `force.gravity`                   |       |
| `drag`                    | `force.drag`                      |       |
| `attractor`               | `force.attract`                   | repel = negative strength |
| `curlNoise`               | `force.curl`                      |       |
| `velocityOverLifetime` (swirl) | `force.swirlY`               | axis-specific name |
| `velocityOverLifetime` (multiplier) | folded into `force.drag` curve | merge |
| `colorOverLifetime`       | `set.color` with `source: 'life'` | one module, many bindings |
| `sizeOverLifetime`        | `set.size`  with `source: 'life'` |       |
| `rotationOverLifetime`    | `set.rotationVel` with `source: 'life'` |  |
| `boundary` (sphere/box)   | `constraint.sphere` / `constraint.box` | split |

Categories used:

- `force.*`  — adds to velocity each frame
- `set.*`    — replaces a property each frame (color, size, rotation, …)
- `constraint.*` — clamps / kills / bounces against a shape
- `emit.*`   — spawns more particles in response to events
- `audio.*`  — audio-data sinks (these are *modules*, not sources; they
  "pulse" properties on the particle in response to audio events)

Backward compat: keep the old names as deprecated re-exports (`gravity =
force.gravity`) for one release so presets keep working. Strip them in v2.

## 2. The binding system

This is the unification trick. Every "Bound" value is one of:

```js
// constant
5
[0, -9.8, 0]

// random-per-spawn (existing semantics)
{ min: 1.0, max: 2.5 }

// driven by a source, optionally shaped through a curve
{
  source: 'life',                  // see Sources below
  curve:  new Curve([[0,0],[0.5,1],[1,0]]),  // optional
  scale:  1.0,                     // optional, default 1
  offset: 0.0,                     // optional, default 0
}

// audio shorthand
{ source: 'audio.bands.bass', scale: 8.0 }

// gradient (rgba) bound to source
{
  source: 'life',
  gradient: new Gradient([...]),
}
```

A single `evalBound(value, particleIdx, system, ctx)` helper resolves any of
the above. The hot path is one type check and one read, so per-particle cost
is small (≤10 ns/eval in V8).

Where a module currently takes a constant, it now accepts a Bound. Existing
constants still work — they pass through unchanged.

```js
// Old:                            // New:
force.gravity([0, -9.8, 0])        force.gravity({ vector: [0, -9.8, 0] })
                                   force.gravity({ vector: [0, { source: 'audio.bass', scale: -50 }, 0] })

force.attract({                    force.attract({
  position: [0, 5, 0],               position: [0, 5, 0],
  strength: 6,                       strength: { source: 'audio.flux', scale: 20 },
})                                 })
```

### Sources catalog

| ID                         | What it returns | Range typical |
|----------------------------|-----------------|---------------|
| `life`                     | `age / lifetime` (0..1)            | [0, 1] |
| `age`                      | raw seconds since spawn            | [0, ∞) |
| `speed`                    | `|vel|`                            | [0, ~30] |
| `posY`                     | `pos.y`                            | varies |
| `radial`                   | `|pos|` distance from origin        | [0, ∞) |
| `random`                   | per-particle stable random         | [0, 1] |
| `time`                     | `system.time` (seconds)            | [0, ∞) |
| `frame`                    | `system.frame`                     | int |
| `audio.rms`                | mix RMS at playhead                | [0, ~1] |
| `audio.flux`               | spectral flux                       | [0, ~20] |
| `audio.centroid`           | spectral centroid (normalized)     | [0, 1] |
| `audio.rolloff`            | rolloff (normalized)               | [0, 1] |
| `audio.flatness`, `audio.zcr` | …                              | [0, 1] |
| `audio.bands.<name>`       | one of 7 bands                     | [0, ~1] |
| `audio.stems.<name>.rms`   | per-stem RMS (vocals, drums, bass, other) | [0, ~1] |
| `audio.chroma.<note>`      | one of 12 pitch classes            | [0, 1] |
| `audio.chroma`             | full 12-vec (gradient pickers)     | — |
| `audio.beat.flash`         | exponential-decay impulse, 1 at beat | [0, 1] |
| `audio.beat.phase`         | normalized phase between beats     | [0, 1] |
| `audio.onset.<stem>.flash` | per-stem onset flash               | [0, 1] |
| `audio.bpm`                | constant for the track             | scalar |

`audio.*` returns 0 if no audio feed is bound — graceful degradation, not an
error.

### Audio feed

A separate small class:

```js
import { AudioFeed } from './audio.js';

const feed = await AudioFeed.load('/tracks/michelle-…/');  // reads analysis.json + frames.bin + melspec.bin
feed.bindAudio(htmlAudioElement);   // listens to currentTime
ps.context = { audio: feed };
```

Internally `feed.sample('audio.bands.bass')` does an O(1) frame lookup
(`floor(t / hopSec) → channel offset → Float32 read`). Pre-computed per-stem
onset flash uses a small linear scan from the cached "last seen" index — fast
in practice.

This **does not** depend on the existing `livedash.js`; we extract the load
logic into a shared module that both the audio dashboard and the particle
demo can use.

## 3. New modules

### `force.*` (acceleration sources)

| Module                | What it does | Notes |
|-----------------------|--------------|-------|
| `force.gravity`       | already have | refactor params: `{ vector: Bound<vec3> }` |
| `force.drag`          | already have | `{ coefficient: Bound<float> }` |
| `force.attract`       | already have, rename | `{ position, strength: Bound, falloff }` |
| `force.curl`          | already have, rename | true Stefan-Gustavson curl-noise (port from visualiser) instead of sin·cos approx |
| `force.wind`          | new          | constant-direction force with optional turbulence amplitude |
| `force.vortex`        | new          | rotation around an arbitrary axis at a point |
| `force.swirlY`        | already have axial swirl as part of velocityOverLifetime; lift to a real module |
| `force.repel`         | new          | `force.attract` with negative strength is fine, but a named alias is friendlier |
| `force.spring`        | new          | pull toward an anchor (`{ anchor, k, damping }`) |
| `force.field`         | new          | user-supplied `(pos, t) => vec3` callback |

### `set.*` (property replacements)

| Module                | Property |
|-----------------------|----------|
| `set.color`           | `color[i*4..]` from a Bound (gradient or rgba) |
| `set.size`            | `size[i]` from a scalar Bound |
| `set.rotation`        | `rot[i]` from a scalar Bound |
| `set.rotationVel`     | `avel[i]` from a scalar Bound |
| `set.alpha`           | `color[i*4 + 3]` only (preserves rgb) |
| `set.intensity`       | multiplies `color[i*4..2]` by a Bound (HDR scaling) |

### `constraint.*`

| Module                | Effect |
|-----------------------|--------|
| `constraint.sphere`   | already have, split out |
| `constraint.box`      | already have, split out |
| `constraint.plane`    | new — Y=0 ground with bounce / kill / wrap |
| `constraint.distance` | new — kill if too far from emitter / point |
| `constraint.life`     | new — clamp lifetime range mid-flight (rare but useful with audio) |

### `emit.*` (sub-emitters)

| Module                | When it fires |
|-----------------------|---------------|
| `emit.onDeath`        | particle dies → spawns N particles at its position into another emitter |
| `emit.onBeat`         | reads `audio.beat.flash` → bursts when above threshold |
| `emit.onOnset`        | per-stem onsets fire bursts |
| `emit.onCollision`    | when constraint triggers (future, expensive) |

Sub-emitters need a "target emitter" reference. Easiest: emitters get string
names; `emit.onBeat({ target: 'sparks', count: 30 })` looks the target up by
name in the system.

### `audio.*` (convenience sinks)

These wrap common audio bindings so the user doesn't have to write the full
binding object. They're sugar over `set.*` / `force.*` with an audio source
already wired in.

| Module                | Equivalent to |
|-----------------------|---------------|
| `audio.beatPulse`     | `set.intensity({ source: 'audio.beat.flash', curve: ... })` |
| `audio.bandToScale`   | `set.size({ source: 'audio.bands.bass', curve: ... })` |
| `audio.chromaPalette` | `set.color({ source: 'audio.chroma', mapping: 'chromaCircleHue' })` |

## 4. Editor UX for bindings

The inspector already has sliders for constant scalars and the gradient/curve
pickers. We add:

- A small **🔗 link icon** next to every numeric parameter.
- Click the icon → small popover: "Bind this to…" with the source list grouped
  by category (per-particle / system / audio).
- After binding: the slider is replaced with a compact "source: audio.bass.x — curve: [tiny preview]" row. Click the row to edit the curve.
- "Unbind" reverts to a constant equal to the current sample value.

For the picker: the Add Module modal gets the new categories and slightly
restructured docs. Every entry includes a one-line description.

## 5. Implementation phases

Each phase is non-breaking on its own (or has a deprecation shim).

### Phase A — bindings infrastructure (non-breaking)

- New file `particles/bound.js` with `evalBound(...)` + `precomputePerSpawn(...)`.
- Sources catalogue with per-particle-only sources first
  (`life`, `age`, `speed`, `posY`, `random`, `time`, `frame`, `radial`).
- Migrate `colorOverLifetime`, `sizeOverLifetime`, `rotationOverLifetime` to
  delegate to `set.color/size/rotationVel` with `source: 'life'`. Keep old
  names as aliases.
- Editor reads `mod.schema[k].bindable === true` to add the link icon.
- **Verify:** existing 12/12 tests pass; add a new test that
  `set.size({source:'speed', curve})` produces correct sizes for known
  speeds.

### Phase B — `force.*` namespace + new forces

- `force.wind`, `force.vortex`, `force.spring`, `force.repel`, `force.field`.
- Replace `curlNoise` JS approximation with a real port of
  `noise.glsl` to JS (3D simplex with analytical derivative + curl helper).
  Rename to `force.curl`.
- **Verify:** snap each new force in isolation, verify motion in JSON dumps
  matches expectation (e.g. wind drifts particles in its direction; vortex
  produces circular motion around its axis).

### Phase C — audio feed

- New `particles/audio.js` with `AudioFeed.load(trackUrl)` returning a feed
  with `sample(sourceId)` and `update(currentTime)`.
- Move shared loading logic (already in `livedash.js`) into a tiny
  `loadFrames.js` reused by both.
- Editor: a "Load track" button in the Stage panel that lets you pick a
  track from `output/index.json`.
- Demo: a small audio player at the top with the source dropdown.
- New audio sources in the catalogue (rms, bands, chroma, beats, onsets).
- **Verify:** snap demo with audio playing; assert that
  `set.size({source:'audio.bass'})` produces visibly larger particles during
  bass-heavy moments.

### Phase D — `constraint.*`, `emit.*`, `audio.*` sinks

- All the new modules above.
- Editor UX for sub-emitters (target picker, per-emitter naming).
- A new "Beats" preset that demonstrates audio-driven everything.
- **Verify:** dropping the Mobb Deep stems through the demo produces visibly
  beat-locked particles.

### Phase E — deprecation + cleanup

- Drop the deprecated old names in a single commit.
- Update `presets.js` to use new namespaced names.
- README refresh.

## 6. Killer demo (the "Michelle test")

Once Phase D is in, this should look great with ~10 minutes of editing in the
demo:

```js
emit('shimmer', {
  shape: shapes.disc({ radius: 4 }),
  rate: { source: 'audio.rms', scale: 800 },        // emission rate tracks loudness
  initial: {
    speed: { min: 0.5, max: 2.0 },
    lifetime: 2.0,
    color: { source: 'audio.chroma', mapping: 'chromaCircleHue' },
  },
  modules: [
    force.curl({ amplitude: { source: 'audio.flux', scale: 3 } }),
    set.size({ source: 'life', curve: ... }),
    audio.beatPulse({ target: 'intensity', amount: 2.0 }),
    emit.onOnset({ stem: 'drums', target: 'sparks', count: 20 }),
  ],
});

emit('sparks', {
  shape: shapes.point(),
  // no continuous rate; only fired by sub-emitter
  initial: { speed: { min: 8, max: 14 }, lifetime: 0.4, size: 0.15 },
  modules: [ force.gravity([0, -10, 0]), force.drag(2) ],
});
```

Result: the shimmer follows song dynamics; drum hits fire fast bright sparks
that arc and fade.

## 7. Risks & open questions

- **Performance.** Per-particle binding evaluation adds ~5 ns × 5 sources × 50 k
  particles = ~1.25 ms / frame in the worst case. Acceptable. We'll add a
  micro-benchmark in Phase A.
- **Audio sync.** The audio dashboard already syncs `currentTime` to a
  master `<audio>` element via Web Audio. We need the same for the demo —
  but stems aren't relevant unless we expose a stem-mute UI. Skip for v1.
- **Editor complexity.** The link-icon UI is the biggest UX risk. If it's
  not done well, users won't discover bindings. Plan: add a "Bind to audio"
  one-click button at the top of every parameter row, next to the link icon.
- **Backward compatibility.** Old preset configs use the old module names.
  Aliases in Phase A protect us through Phases B–D.

## 8. Out of scope (for now)

- GPGPU module path (only relevant past 50 k particles).
- Trails (per-particle history buffer).
- Sprite atlases (texture-based particles).
- Constraint solving between particles (collision, springs between specific pairs).
- Live curve drawing into 2D timeline like Unity Shuriken's "curves" tab.

These are obvious future work but each is a meaningful build of its own.

---

**To approve this plan:** say which phases you want and in what order. Phase
A is the foundation everything else stands on; B and C are independent of
each other once A is done; D needs both B and C; E is the cleanup pass.
