# CLAUDE.md

Notes for future agents working on this repo. Keep this file short — it's loaded into every conversation.

## Architecture

- Vanilla HTML/CSS/JS, no frameworks, no bundler. Served from GitHub Pages.
- Three sections drive the editorial page: `data/projects.json` (work grid), `data/research.json` (Most Wanted), `data/experiences.json` (timeline). Per-project case studies in `data/projects/<id>.md`.
- The bottom-right "Ask the portfolio" assistant is Claude Haiku 4.5 behind a Cloudflare Worker (`worker/`). The agent's knowledge is a corpus built from the three JSONs above + dossier highlights.
- The masthead is the **hero galaxy** — a 3D WebGPU scene in `js/hero-galaxy/` (replaces the old particle-text SDF masthead). Three discipline-suns (graphics, ml-ai, web-systems) with planets (sub-categories) and moons (projects). Click navigation: sun → system → planet → moon. Data lives in `data/hero-galaxy.json`. See "Hero galaxy notes" below.

## The chat corpus stays in sync only if you rebuild + redeploy

After **any** edit to `data/projects.json`, `data/research.json`, or `data/experiences.json`:

```powershell
npm run deploy-chat
```

This runs `scripts/build-corpus.mjs` (regenerates `worker/src/corpus.js`) then `wrangler deploy`. Forget it and the chat will keep referencing the previous corpus — meaning it may link to deleted dossiers or omit new ones.

The corpus is byte-stable across runs (sorted keys, fixed indent) so identical data → identical bytes → Anthropic prompt cache stays warm. Don't hand-edit `worker/src/corpus.js` — it's a generated artefact.

Other npm scripts: `npm run build-corpus` (rebuild without deploying), `npm run dev-worker` (local Wrangler dev on :8787), `npm run tail-worker` (live Worker logs).

## Client anonymisation

Client work is referenced by sector, not by company name. SABDA, LRD/Calico, and the Sabda VFX studio are cited by name; every other client is anonymised in dossiers, research, and experiences. If a real client name appears anywhere outside this rule, treat it as a bug — replace with the sector-level reference. When in doubt, anonymise.

## Shader rule

GLSL shaders live in their own `.glsl` files under `demos/shaders/<demo>/`, loaded via `fetch`. **Never** embed shader strings inline in HTML/JS — see `demos/boids.html` for the loader pattern.

## Particle playground

`demos/particle-playground.html` exposes the full vendored WebGPU particle engine (`js/particles/`) — sixteen presets, every emitter param editable, copy-JSON to share. WebGPU-only (page renders a notice + back-link if `navigator.gpu` is missing). It's a thin wrapper over `js/particles/index.js`; no inline shaders, no duplicated UI logic. The engine source (`C:/Users/Legion/Desktop/AudioReactiveProject/particles/demo.html`) is where it came from — re-vendor by copying that file again and re-applying the same patches: change the import path to `../js/particles/index.js`, drop the `AudioFeed` named import (audio is out of scope for the portfolio), delete the `<aside id="audio-panel">`, and keep the WebGPU gate at the top of the module.

## Tech-art subsite

The legacy WebGL journey site lives at `/tech-art/` and is not linked from the main nav anymore. It still works; leave the files alone unless explicitly asked.

## Hero galaxy notes

The masthead galaxy is a 3D WebGPU scene with its own mesh pipeline, custom orbit-locked camera, and a per-body dev-tuning panel. Architecture:

**Files**
- `js/hero-galaxy/scene.js` — main mount, frame loop, body allocation, sim dispatch
- `js/hero-galaxy/render/pipeline.js` — `getMeshPipeline` + `getBloomPipeline`. Fragment template is the prelude + the planet's surface() + `_planet-postlude.wgsl` (which holds `VertexOut`, `BodyUniforms`, `fs_main` — split out so wgsl-analyzer can lint and so no shader strings live in JS).
- `js/hero-galaxy/shaders/` — `_planet-prelude.wgsl` (noise helpers) + `_planet-postlude.wgsl` (fs_main contract) + `mesh-vertex.wgsl` + per-tier surface shaders
- `js/hero-galaxy/render/fluid-sim.js` + `shaders/fluid-sim.wgsl` — gas-giant Navier-Stokes sim
- `js/hero-galaxy/dev-panel.js` — every tunable. Reset = restore saved, Factory = clear save + restore code defaults, Save = persist current to localStorage
- `js/hero-galaxy/console.js` — bottom-left "instrumentation" panel that updates per zoom level

**Planet shaders are tier-based** — `bodyDescFromPlanet` picks from `PLANET_TIER_SHADERS = {rocky, earth, gas}` keyed by orbit-rank within the system (innermost → rocky, next → earth, outer → gas). The JSON's `planet.shader` field is ignored. Only 3 tier shaders + `default-planet.wgsl` + `default-moon.wgsl` + `star.wgsl` + `star-halo.wgsl` + `star-bloom.wgsl` + `fluid-sim.wgsl` are alive; everything else was cleaned out.

**Surface shaders use `local_pos`** (normalized object-space) for procedural noise, NOT `world_pos`. Noise patterns stay painted on a planet as it orbits. `uv_sphere` is computed per-fragment in fs_main (not per-vertex) so the longitude wrap is a 1-pixel discontinuity, not a triangle-spanning stripe.

**Body visibility per zoom level**:
- galaxy: all stars + all planets + all moons (every sun bloomed)
- system: focused sun only + all planets + all moons (focused sun bloomed)
- planet: NO stars + all planets + focused planet's moons (no bloom — sun bloom at this zoom is the "rogue blob" that wasted hours to diagnose)
- moon: NO stars + all planets + focused planet's moons (no bloom)

**Picking is screen-space**, not 3D ray. `pickBodyAtPx` projects every candidate body to pixel coordinates and picks whichever visible disc the cursor sits inside, with a 14 px minimum radius so moons stay grabbable. Click excludes the focused body; hover ALSO excludes it (so bodies behind the focused one are hover-selectable).

**Particle rings are mutually exclusive with moons** — `if ((p.moons || []).length > 0) continue;` in the ring loop. Saturn-style rings on a moon-having planet bloomed into a rogue torus across multiple sessions; the rule is XOR by design. If you want a ring on a moon-less planet, the brightness/count tuning is already dialled below the bloom threshold (factory: count × 0.18, accent × 0.12).

**Orbital motion follows Kepler's third law**: ω = K / r^(3/2). `world.planetOrbitalRate` is K for planet orbits, `world.moonOrbitalRate` for moons. Outer planets are automatically (r_outer / r_inner)^1.5 times slower than inner ones — same physics as the real solar system. The JSON's per-planet `period` value is no longer used.

**Gas-giant fluid sim is Navier-Stokes**, 256×128 grid, multi-kernel architecture (8 compute passes per frame: advect-vel, forces, curl, vorticity-force, divergence, jacobi-pressure×N, pressure-project, advect-tracer). 5 textures per gas planet (vel ping-pong, tracer ping-pong, pressure ping-pong, divergence, curl). Lifted from `C:/Users/Legion/Desktop/Remain/src/shaders/cloud-fluid.wgsl` (pressure-projected multi-kernel) + `demos/fluid-sim.html` (vorticity confinement, the Qatar/volumetric-fluid demo). Physics tuning is research-derived:
- β-plane Coriolis term in cs_add_forces (Tan-Showman 2019) — this is THE physics that makes bands emerge
- Distributed convective splats at random lat/lon with finite lifetime (Heimpel-Aurnou 2007) — NOT equator-only
- Prograde-equator forcing fakes Jupiter super-rotation (Warneford-Dellar 2014)
- Global `sim_speed` multiplier scales dt + accumulated per-planet sim time
- Only ticks for gas planets in `state.focusedSystemId`; idle systems freeze

**Dev panel persists to localStorage** under `hero-galaxy-dev-defaults`. `applySavedDefaults` runs on boot BEFORE the panel mounts, so saved values are already in the live state objects. Reset = restore saved (or factory if no save). Factory = clear save + restore code defaults. When ready to bake the live values as the new factory defaults, dump that localStorage entry and paste into the literals in `scene.js`'s `postfx` / `ambient` / `world` declarations.

**To turn off the dev panel for prod**: flip `HERO_GALAXY_DEV_PANEL` to `false` at the top of `scene.js`. The panel and `applySavedDefaults` won't run; visitors see the code-side factory defaults.
