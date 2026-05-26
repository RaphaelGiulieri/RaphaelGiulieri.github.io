# Design — WebGPU particle-swarm hero masthead

**Date:** 2026-05-20
**Status:** approved (brainstorming phase), pending implementation plan

## Context

The portfolio's current masthead is entirely typographic — Fraunces serif name, mono eyebrow, dense stats panel. It reads as well-designed but tells the visitor nothing about the actual craft. For a creative technologist whose differentiation is *visual* (shaders, particles, real-time graphics), opening with no visible craft is a missed opportunity. A recruiter on a 5-second scan currently reads "well-set editorial site" rather than "this person makes things move."

This design replaces the type-only hero with a WebGPU particle swarm that resolves into the name "Raphael Giulieri." The particle engine already exists in production-grade form at `C:/Users/Legion/Desktop/AudioReactiveProject/particles` (~1M particles at 80 fps on an RTX 3070, with stream compaction, indirect draw, and a full post-FX stack). The portfolio reuses it.

Two integrations land in this design:
1. **Hero masthead** — name forms from particles attracted to a baked SDF of the text.
2. **`demos/curl-noise-particles.html` migration** — same 4 modes, ported from WebGL2 to the new engine.

The existing editorial frame stays. The H1 stays in the DOM for accessibility, SEO, and as the no-WebGPU fallback.

## Scope

**In:**
- Vendor the particle engine into `js/particles/`.
- Hero canvas with SDF-driven attraction, two-tone palette, cinematic entrance, hover dispersion, click explosion.
- Replace `demos/curl-noise-particles.html` with a WebGPU version using the new engine (250 k particles, post-FX bloom, same 4 modes).
- Preserve the WebGL2 curl-noise demo as a fallback file for non-WebGPU visitors.
- Detection + graceful fallback to the existing editorial type for non-WebGPU / reduced-motion / mobile-fail cases.
- IntersectionObserver pause-on-scroll-away for both hero and demo.

**Out (explicit non-goals for this design):**
- Audio reactivity in the hero (engine supports it; deferred until AudioReactiveProject ships).
- Multi-language text swap (SDF is baked for one string).
- WebGL2 fallback for the hero (declined — static editorial type is the fallback by design).
- Migrating other particle/sim demos (boids, fluid-sim, voronoi, etc.) — each is its own design.

## Architecture & file layout

```
RaphaelGiulieri.github.io/
├── js/
│   ├── main.js                  (existing — adds hero-particles boot call)
│   ├── chat.js                  (untouched)
│   ├── hero-particles.js        (NEW — engine glue for the masthead)
│   └── particles/               (NEW — vendored from AudioReactiveProject)
│       ├── index.js
│       ├── core/                  (audio.js dropped; rest copied as-is)
│       ├── webgpu/
│       │   ├── system.js
│       │   ├── compute.js
│       │   ├── …
│       │   └── shaders/
│       │       ├── (all existing .wgsl files)
│       │       └── sdf_attract.wgsl   (NEW — portfolio-specific force module)
│       └── VENDORED.md            (NEW — source path + git SHA + date)
├── assets/
│   └── hero/
│       ├── name-sdf.png           (NEW — baked text SDF, ~512×128, ~30 KB)
│       └── name-sdf.json          (NEW — bounds metadata for sampling)
├── demos/
│   ├── curl-noise-particles.html  (REWRITTEN — uses the new engine)
│   ├── curl-noise-particles-legacy.html  (RENAMED from current — WebGL2 fallback)
│   └── shaders/curl-noise-particles/    (kept for the legacy file)
├── scripts/
│   └── bake-name-sdf.mjs          (NEW — runs offline to produce the SDF)
└── docs/superpowers/specs/
    └── 2026-05-20-particle-hero-design.md   (this file)
```

**Boundaries:**
- `js/particles/` is the vendored engine — treat as read-only-ish. Modifications go via documented extension points (modules, presets). The `sdf_attract.wgsl` shader and its module wrapper are marked clearly as portfolio additions for future re-vendor preservation.
- `js/hero-particles.js` is the only file in the portfolio that touches the engine for the hero. Contains: detection, SDF load, engine init, H1 layering, hover/click handlers, IntersectionObserver pause.
- `assets/hero/name-sdf.png` is a static asset, fetched once, cached forever. Re-baked only if the displayed text changes.

## Hero design

### DOM structure

The existing `<h1 class="hero-name">` stays in place. A `<canvas>` is added as a sibling and absolutely-positioned over the same bounding box. A wrapping `.hero-name-stage` element makes the layering explicit and the click target unambiguous.

```html
<div class="hero-name-stage">
    <canvas class="hero-particles" aria-hidden="true"></canvas>
    <h1 class="hero-name revealable">
        <span class="name-line name-line-1">Raphael</span>
        <span class="name-line name-line-2"><em>Giulieri.</em></span>
    </h1>
</div>
```

The stage is `position: relative`; the canvas is `position: absolute; inset: 0; pointer-events: none`. The H1 keeps `position: relative` so it is the click target.

### Visual states

The stage carries one of three state classes; CSS handles the cross-fade.

| State class | H1 opacity | Canvas opacity | Engine |
|---|---|---|---|
| `is-static` (initial & fallback) | 1 | 0 | not mounted |
| `is-coalescing` (entry, ~1.2 s) | 1 → 0 | 0 → 1 | spawning, attracting |
| `is-live` (idle + hover + click) | 0 | 1 | running |

Static H1 renders immediately. Particles spawn over the H1 while the H1 fades; the cohering moment IS the fade. No "blank waiting" perceived.

### Boot sequence

```
1. DOMContentLoaded fires → H1 visible, stage is .is-static.
2. hero-particles.js: detect WebGPU + screen size + reduced-motion.
   ↳ any check fails → stop. Stage stays .is-static. Silent fallback.
3. fetch('/assets/hero/name-sdf.png') + name-sdf.json in parallel.
4. createParticleSystem({ canvas, backend: 'webgpu', maxParticles }).
5. Upload SDF as a sampled texture binding to the sdf_attract module.
6. Add 2 emitters — one per name-line — coloured per the type split.
7. Switch stage class .is-static → .is-coalescing.
8. Particles spawn (rate burst over 600 ms) and attract toward SDF (~600 ms more).
9. Switch class .is-coalescing → .is-live; H1 opacity now 0.
10. Install hover + click + IntersectionObserver handlers.
```

If any step 2–7 errors (timeout, WebGPU rejection, SDF 404), the stage stays at `.is-static`. The visitor sees the editorial type. No error message is shown.

### Behaviour states

| Event | Engine action |
|---|---|
| **Entry** (`coalescing`) | Particles spawn with velocity vectors pointing at their SDF target sample. Speed ramps from high to settle. Duration ~1.2 s. ~80 k particles spawned over 600 ms (desktop). |
| **Idle** (`live`, default) | Strong attraction to SDF + small wander noise (~5 % of attraction magnitude). Particles "breathe" gently around the silhouette. ~60 fps target. |
| **Hover** | Cursor position read each frame; particles within ~120 px feel a repulsive force scaled by inverse distance. Cursor leaves → attraction wins back, particles re-form within ~300 ms. |
| **Click** (anywhere within the H1 bounding box) | Single radial impulse at click point — strong outward velocity kick to all particles within ~300 px. Attraction stays on; particles re-settle ~800 ms later. The H1's normal click semantics fire too (no link currently; future-safe). |

### Palette

Particles attracting to "Raphael" get the bone ink colour (`--ink`, `#f0ebe0`). Particles attracting to "Giulieri." get the vermilion accent (`--accent`, `#ff4b1f`). Bloom in the post-FX favours the vermilion side, leading the eye to the accent the same way the existing type does.

### Two-emitter spawn topology

One SDF asset is baked for the entire phrase. Two emitters share it; each emitter has a `spawn_region` rectangle that confines its spawn-position sampling to the relevant half of the canvas (top half for "Raphael", bottom for "Giulieri."). The `sdf_attract` module samples the same SDF field for both emitters — colour comes from the emitter, not the SDF. Because the two name-lines occupy non-overlapping vertical bands, this is sufficient.

### Attraction mechanics

The `sdf_attract` module computes a per-particle force from the SDF gradient: particles outside the text receive a force toward the zero-isoline, particles already on or near the silhouette receive zero attraction plus a small wander noise. A weak distance-tapered repulsion inside the text body prevents the swarm from collapsing onto the centreline. Net effect: particles settle into a soft band along the letter silhouette and breathe gently.

### Click target

The H1 is the click target, not the canvas. Canvas is `pointer-events: none` (visual only). Click handler is attached to the H1. If the H1 ever wraps in `<a href="…">`, both the explosion effect and the link navigation fire from one gesture.

### Scroll pause

IntersectionObserver rooted on `document.documentElement`, watching the stage. `intersectionRatio < 0.1` → call `ps.pause()` (engine has this — stops the compute pass). Back in view → `ps.resume()`. Saves battery + GPU heat when the hero is off-screen.

## Curl-noise demo migration

The existing demo is a self-contained WebGL2 page at `demos/curl-noise-particles.html` with 4 shader files under `demos/shaders/curl-noise-particles/`. It's embedded in the `tech_compute_procedural` dossier via `![[gallery:6]]` and opens in its own tab via the "↗ open" affordance.

### Changes

| Layer | Before | After |
|---|---|---|
| Backend | WebGL2 + GPGPU ping-pong textures | WebGPU compute via `js/particles/` engine |
| Particle count | 65 k (256×256 texture) | 250 k |
| Post-FX | None | Bloom + tonemap + vignette + gamma (from engine) |
| Modes | Galaxy · Lorenz · Vortex · Curl-noise | Same 4 modes, same UI |
| Source files | Inline `<script>` + 4 `.wgsl` shaders | `<script type="module">` importing `js/particles/index.js`, four small module functions inline per mode |

### Mode → engine-module mapping

Each mode becomes a small custom module passed via `modules: [ ... ]` on the emitter:
- **Galaxy** — gravity pull toward centre + tangential velocity component (rotation).
- **Lorenz** — classic dx/dy/dz = σ(y−x), x(ρ−z)−y, xy−βz attractor; per-particle integration step.
- **Vortex** — two counter-rotating gravity wells, distance-weighted curl around each.
- **Curl-noise** — divergence-free curl of a 3D simplex noise field, ported from GLSL to WGSL.

The existing mode-switch UI calls `ps.replaceModules([newMode])` (engine API).

### Fallback

`demos/curl-noise-particles-legacy.html` is the current WebGL2 file, renamed. The new `demos/curl-noise-particles.html` is a thin loader page that:
1. Checks `navigator.gpu`.
2. If WebGPU available → mounts the WebGPU demo inline.
3. If not → `window.location.replace('curl-noise-particles-legacy.html')`.

Visitor never sees the chooser; the dossier modal always opens the right one.

### Dossier caption update

The current caption stays accurate. Add one phrase: *"WebGPU compute, 250 k particles, full post-FX stack."*

## Detection & fallback

Feature-detection sequence in `hero-particles.js` (first failure short-circuits to static):

```
1. document.readyState ≥ 'interactive'.
2. navigator.gpu exists.
3. adapter = await navigator.gpu.requestAdapter() resolves to non-null.
4. device  = await adapter.requestDevice() succeeds.
5. matchMedia('(prefers-reduced-motion: reduce)').matches === false.
6. matchMedia('(max-width: 720px)').matches → mobile branch.
7. SDF asset loads within 800 ms.
```

| Visitor profile | Hero rendering |
|---|---|
| Desktop + WebGPU + motion-on | Full swarm, ~80 k particles, all behaviours active |
| Mobile + WebGPU + motion-on | Reduced swarm, ~15 k particles, hover/click active |
| Any + reduced-motion | Static H1, no canvas mounted |
| Any + no WebGPU | Static H1, no canvas mounted |
| Any + SDF asset fails / times out | Static H1, no canvas mounted |

`prefers-reduced-motion` is non-negotiable accessibility.

## Performance budget

| Knob | Desktop | Mobile |
|---|---|---|
| Particle count (hero) | 80 000 | 15 000 |
| Particle count (curl-noise demo) | 250 000 | 50 000 |
| Compute pass target | 60 fps (16.6 ms) | 50 fps (20 ms) |
| Hero init time ceiling | 800 ms | 1200 ms |
| Idle GPU usage cap | < 30 % of frame | < 40 % |
| Battery posture | IntersectionObserver pause | same |

## SDF baking

Offline-baked via `scripts/bake-name-sdf.mjs`. Run manually with `node scripts/bake-name-sdf.mjs` — not part of any build pipeline, not part of `npm run deploy-chat`. One-shot, output committed.

Pipeline:
1. Renders the text *"Raphael Giulieri."* at high resolution in Fraunces italic to an OffscreenCanvas (or via headless Chrome through nodriver if OffscreenCanvas's font loading proves unreliable).
2. Computes a signed distance field via the existing two-pass distance transform (or msdfgen if simpler).
3. Writes `assets/hero/name-sdf.png` (8-bit greyscale, distance encoded — 128 = zero-isoline, 0 = far inside, 255 = far outside) and `assets/hero/name-sdf.json` (text bounds in pixels, scale factor, per-name-line spawn-region rectangles for the two emitters).

Re-baked only when the displayed text changes.

## Testing

### Manual / nodriver — desktop happy path
1. Cold-load `/` in latest Chrome → static H1 → particles coalesce → idle.
2. Hover → particles displace; mouse out → re-settle within ~300 ms.
3. Click the name → explosion; particles back within ~800 ms.
4. Scroll past hero → `ps.pause()` fires; scroll back → resume.
5. `get_fps` window over 3 s during idle: ≥ 55 fps.
6. `get_perf_metrics`: idle GPU usage reasonable, JS heap stable.

### Fallback paths
7. DevTools: `navigator.gpu = undefined` → reload → static H1, no canvas in DOM.
8. `prefers-reduced-motion: reduce` → same outcome.
9. Viewport 360 px wide → mobile branch, 15 k particles, idle FPS ≥ 45.
10. `tech_compute_procedural` dossier with WebGPU disabled → legacy WebGL2 curl-noise renders.
11. Same dossier with WebGPU enabled → new WebGPU demo with bloom.

### Edge cases
12. Reload-spam (5× rapid) — no orphan WebGPU devices / GPU contexts. Engine has cleanup paths; verify.
13. Open chat panel + hero particles running — both coexist, no frame drops.
14. Open dossier modal over hero — hero `IntersectionObserver` pauses (dossier covers ≥ 90 % of viewport).

### Not tested this round (acknowledged)
- iOS Safari 18 — real device when available, browser-emulated meanwhile.
- Firefox WebGPU behind the flag — best-effort.
- 4K / DPR-3 displays.
- Power-throttled Mac laptop mode.

## Deferred / explicit non-goals

- **Audio reactivity in the hero.** Engine supports it; AudioReactiveProject's offline analysis pipeline could drive the swarm. Deferred until that project ships. Feature-flag add later.
- **Multi-language text swap.** The SDF is baked once. A French/English swap would be a re-bake task, not a runtime feature.
- **WebGL2 fallback for the hero.** Declined — non-WebGPU visitors get the static editorial type, which is the existing design's strength.
- **Migrating other particle/sim demos** (boids, fluid-sim, voronoi, marching-squares, etc.). Each is its own design.

## Open questions / unknowns

- Engine pause/resume API — README does not explicitly document `ps.pause()` / `ps.resume()`. If absent, implementation adds them as a small extension (the compute pass dispatcher just needs a guard flag). Verified at implementation time.
- Exact mobile threshold — `matchMedia('(max-width: 720px)')` is a coarse proxy. Real-device testing may shift to a perf-probe-based decision (e.g. measure first frame time, downgrade if > 25 ms).
- SDF format — 8-bit greyscale is sufficient for soft attraction. Multi-channel MSDF only needed if sharp letterform edges become visible at the swarm density we use. Decide empirically during implementation.
