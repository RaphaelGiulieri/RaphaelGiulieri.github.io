# Hero Galaxy — Design Spec

**Date:** 2026-06-03
**Status:** approved (brainstorming complete; pending writing-plans)
**Replaces:** the WebGPU particle-text masthead shipped 2026-05-27 (`js/hero-particles.js`).

## Goal

Replace the current particle-text masthead with a 3D interactive galaxy where the visitor explores three solar systems — one per discipline — drilling from galaxy → system → planet → moon → project dossier. The visual metaphor encodes Raphael's positioning ("multi-disciplinary creative technologist") more directly than typographic particles ever could, and turns the hero from decorative chrome into a literal navigator for the work grid.

## Locked decisions (from brainstorm)

| Decision | Value |
|---|---|
| What a planet represents | Sub-category within a discipline |
| What a moon represents | A specific project under that sub-category |
| What a sun represents | One of three top-level disciplines (Graphics & shading / ML & AI / Web-systems-tooling) |
| Multi-system view | Galaxy — three distant suns coexist; click one to fly into its system |
| Hero scope on the page | Full-viewport (100vh) dedicated landing |
| Initial state on page load | Galaxy view (three suns visible immediately; visitor clicks to drill in) |
| Rendering tech | All-WebGPU, single canvas, mesh planets + integrated particles |
| Planets per system | Curated 4–6 (≈12–18 total across the galaxy) |
| Camera controls | Orbit + zoom only; no pan; camera always focal-locked |

## Architecture

### Three depth levels

The camera transitions between three named states. Each state has a fixed focal point at which the camera orbits; scroll-zoom is clamped per state.

| State | Focal point | Camera distance | Visible content |
|---|---|---|---|
| `galaxy` | origin `(0, 0, 0)` | far (e.g., 80 world units) | Three suns drifting in deep space with floating labels; ~20k starfield always visible |
| `system` | the chosen sun | mid (e.g., 12 world units) | Sun + 4–6 planets in an oblique orbital plane; some planets carry rings or moons; the other two suns become tiny background lights |
| `planet` | the chosen planet | near (e.g., 3 world units) | Planet centred + its moons in orbit; planet's sub-category title and its parent discipline pinned in the panel chrome |

Transitions between states are Bezier-eased over 800–1200 ms. The camera's distance, direction, and (mildly) field-of-view all interpolate.

### Scene graph

```
Galaxy
├── Sun "Graphics & shading"   ← discipline 0
│   ├── Planet "WebGPU + WGSL"
│   │   └── Moon "Remain", Moon "Particle engine", ...
│   ├── Planet "GPGPU compute"
│   ├── Planet "Raymarching / SDF"
│   ├── Planet "Procedural worlds"
│   └── Planet "Retro post-processing"
├── Sun "ML & AI"               ← discipline 1
│   └── ... (4–6 planets)
└── Sun "Web-systems-tooling"   ← discipline 2
    └── ... (4–6 planets)
```

### File layout

```
js/hero-galaxy/
  index.js              entry point — replaces js/hero-particles.js
  scene.js              galaxy → system → planet state machine + scene graph
  render/
    sphere-mesh.js      icosphere geometry generator (one mesh, all bodies)
    ring-mesh.js        flat-disc geometry (256 segs) for `disc`-type rings
    pipeline.js         WebGPU mesh pipeline + per-planet shader compile cache
    camera.js           view/proj matrices + orbit/zoom controls + transitions
    raycast.js          ray-vs-sphere hit testing for click selection
  shaders/
    _planet-prelude.wgsl    helper library — noise3, voronoi, simplex2, palette
    default-planet.wgsl     fallback for planets without a custom shader
    default-moon.wgsl       small spheroids
    sun.wgsl                base sun shader (per-system colour tint via uniform)
    ring-disc.wgsl          for `ring.type: "disc"` planets
    planets/                YOUR per-planet shaders, one .wgsl each
      planet-webgpu-wgsl.wgsl
      planet-gpgpu.wgsl
      planet-raymarch.wgsl
      ...

js/particles/core/modules.js                ← extend: add `orbit` module
js/particles/core/shapes.js                 ← extend: add `ring` shape factory

data/hero-galaxy.json                       ← new — scene composition

assets/hero-galaxy/                         ← reserved for future textures / LUTs

css/style.css                               ← `.hero-galaxy` section styles
                                              + `.is-fallback` cascade

index.html                                  ← replace .hero contents with
                                              <section.hero-galaxy>
```

The existing `js/hero-particles.js` and `assets/hero/name-sdf-*.png` are **removed** when this lands. The particle engine at `js/particles/` is preserved and reused (starfield + rings).

## Rendering pipeline

### One render pass per frame

```
encoder begin
  → clear scene texture (postfx render target) with black, depth = 1.0
  → starfield pass     (additive blend, depth test off, depth write off)
  → mesh layer pass    (depth test ON, depth write ON; planets, moons, suns, rings)
  → ring-particle pass (additive blend, depth test ON, depth write OFF; per-planet ring emitters)
  → postfx chain       (bright pass → blur passes → composite → vignette)
  → blit composite to swapchain view
encoder submit
```

Stars render first so they always sit "infinitely far"; ring particles render after meshes so they correctly occlude behind a planet on the planet's far side; postfx applies once at the end.

### Shared sphere geometry

A single icosphere is created at boot with subdivision level 5 (≈ 5k verts; level 4 ≈ 1.3k for mobile). Every sphere body — sun, planet, moon — reuses the same vertex + index buffer; per-body data lives in a uniform buffer mutated per draw call.

### Per-body uniform layout

```wgsl
struct BodyUniforms {
  model_matrix : mat4x4f,   // local-to-world transform
  accent       : vec4f,     // primary colour from data/hero-galaxy.json
  meta         : vec4f,     // x = time (s), y = radius_world,
                            // z = planet_id (encoded for hit-test highlight),
                            // w = hover_t in [0, 1] (eased on cursor-over)
};
```

This shape is **identical for every body**. Swapping the planet's custom shader is just swapping the pipeline's fragment shader module; the bind-group layout doesn't change.

### Per-planet shader API

Each planet authors **one WGSL file** with a single function the engine wires into a templated vertex+fragment pipeline:

```wgsl
// shaders/planets/planet-webgpu-wgsl.wgsl
// Engine prepends _planet-prelude.wgsl, declares the standard BodyUniforms
// bind group, and provides this Surface struct as the surface() input.

struct Surface {
  world_pos    : vec3f,
  world_normal : vec3f,
  uv_sphere    : vec2f,   // longitude/latitude in [0, 1]
  view_dir     : vec3f,   // normalized vector from surface to camera
  time         : f32,
  accent       : vec3f,
  hover_t      : f32,
};

fn surface(s: Surface) -> vec4f {
  // user-authored body
  let n = noise3(s.world_pos * 4.0 + s.time * 0.05);
  let crack = smoothstep(0.55, 0.6, n);
  let base = mix(s.accent * 0.4, s.accent * 1.5, crack);
  let rim  = pow(1.0 - dot(s.view_dir, s.world_normal), 3.0);
  return vec4f(base + s.accent * rim * (0.4 + s.hover_t), 1.0);
}
```

The shader prelude (`_planet-prelude.wgsl`) provides a toolbox: `noise3(p)`, `voronoi(p)`, `simplex2(uv)`, `palette(t, base, ramp)`, `fresnel(view_dir, normal, power)`. Every planet shader can rely on these without copy-paste.

### Compilation strategy

- **Boot**: compile default-planet + default-moon + sun + ring-disc shaders only (4 pipelines). Galaxy view never needs more.
- **First entry into a system**: lazy-compile that system's planet shaders. Subsequent re-entries are free (pipeline cache).
- **Compile failure** on a planet shader → fall back to `default-planet.wgsl` for that planet, log error to console with file path + WGSL diagnostic. Authoring loop stays unbroken even with broken WGSL.
- **Cache key**: `<shader_path>:<sha256(file_contents)>`. Hot-reloading by reloading the page picks up file changes automatically.

### Shader rule alignment

Per `CLAUDE.md`: shaders live in their own files, loaded via `fetch`, never inlined. Every WGSL file in `js/hero-galaxy/shaders/` is fetched at runtime. Authors edit the file, reload the page, see the change — no build step.

## Camera + interaction

### Controls (every state)

| Input | Action |
|---|---|
| Left-drag **or** middle-drag | Orbit (yaw + pitch around focal point) |
| Scroll wheel | Zoom (clamped per-state) |
| Touch one-finger drag | Orbit (mobile equivalent) |
| Touch pinch | Zoom (mobile equivalent) |
| Tap / click empty space | Zoom out one level (galaxy → exits no-op; system → galaxy; planet → system) |
| Tap / click a body | Transition into that body (sun → system; planet → planet view; moon → open project dossier modal) |
| `Escape` key | Same as click empty space |
| Click breadcrumb crumb | Zoom directly to that level |

**Pitch clamp**: ±80° to prevent flipping upside-down. **Inertia**: drag-release continues velocity with ease-out (~600 ms). **Zoom bounds**: per-state min/max clamped so the camera cannot crash into the focal body or escape into infinity.

### Transitions

All transitions Bezier-eased; during transitions, user input is queued (not lost) and applied after settle. Transition durations:

| From → To | Duration | Behaviour |
|---|---|---|
| galaxy → system | 1200 ms | Dolly-in cinematic: position lerps along Bezier toward sun, distance shrinks, FOV nudges from 50° to 60° for "zooming through space" feel |
| system → planet | 900 ms | Reframe: camera lerps to orbit around the planet at close range; non-focal planets fade out via post-mesh alpha multiplier |
| planet → moon | n/a (no transition) | Click on moon → opens existing dossier modal via `window.openModal(projectId, anchorEl)`. Camera holds. |
| planet → system | 900 ms | Reverse of system → planet |
| system → galaxy | 1200 ms | Reverse of galaxy → system |

### Hit testing

On `requestAnimationFrame` (NOT mousemove — throttled), if the cursor moved since the last frame, cast a ray from camera through cursor into world space. Test against visible bodies (≈ 15 at system level, ≤ 6 moons at planet level). Closest hit wins.

- Hovered body → tween `hover_t` from 0 → 1 over 200 ms; shader picks up rim glow / scale wobble / whatever the planet author chose.
- Click on a body → trigger the transition for that body's type (see table above).

### Default ambient motion

Each state has a slow always-on motion that keeps the scene alive:

| State | Motion |
|---|---|
| galaxy | Camera auto-orbits origin at ~0.5°/s (≈12 minutes per revolution). Visitor drag interrupts. Resumes after 4 s idle. |
| system | Camera holds. Planets orbit the sun at their JSON-defined `orbit.period` values. |
| planet | Camera holds. Planet rotates on its axis (period ~30 s). Moons orbit. |

### Breadcrumb UI

Pinned top-left of the section. Mono small-caps, vermilion accent on the active node, dim grey on inactive prior nodes.

```
GALAXY  →  GRAPHICS & SHADING  →  WEBGPU + WGSL
```

At galaxy state: only `GALAXY` shown. At system state: `GALAXY → <SYSTEM NAME>`. At planet state: full three-level crumb. Click any prior crumb to zoom directly to that level.

## Particles

### Distant starfield (always-on)

| Setting | Desktop | Mobile |
|---|---|---|
| Particle count | 20 000 | 8 000 |
| Spawn shape | `shapes.sphere({ radius: 200, shell: true })` |
| Lifetime | Infinite (`min: 1e9, max: 1e9`) |
| Forces | None (particles are stationary in world space) |
| Twinkle | Per-particle phase-offset sine on alpha in shader |
| Spawn cost | One-time at boot (~0.4 ms) |
| Per-frame cost | Negligible (~0.8 ms on desktop) |

Reuses the existing engine emitter — no new code beyond config.

### Per-planet rings (subset)

A planet's JSON may carry one of two ring configs:

```jsonc
"ring": { "type": "disc",      "innerRadius": 1.4, "outerRadius": 2.1, "tilt": 18 }
"ring": { "type": "particles", "count": 3500, "innerRadius": 1.4, "outerRadius": 2.1, "tilt": 18 }
```

`disc` → flat ring-disc mesh, alpha-blended bands authored in `shaders/ring-disc.wgsl`. Static; rotates with the planet's rotation.

`particles` → particle emitter parented to the planet's transform. Spawn shape is a new `shapes.ring(innerRadius, outerRadius, tilt)` factory; orbital motion comes from a new `modules.orbit({ centerX, centerY, axis, speed })` module.

Both new factories follow existing engine patterns (`shapes.sphere`, `modules.vortex`). The `modules.orbit` addition is ~50 lines WGSL + ~20 lines JS schema and is reusable for the particle playground demo.

### Per-planet click impulse

Already-shipped behaviour from the masthead carries over. Clicking any body fires a brief radial impulse via an `attractor` module's strength burst at the body's centre. Visual confirmation of the click.

### Engine integration

- Shared GPUDevice: mesh pipeline and `createParticleSystem` both initialise off `ps.device`, exactly as the masthead does today.
- Shared view/proj matrices: same matrices passed to `ps.render({ view, proj, ... })` and to the mesh pipeline. Single source of truth.
- Bounded total particles: 20k stars + (3 500 × ≤5 ring planets) = ≤37 500 live particles on desktop. Comfortably under the 80k the masthead has been running.

## Data model

`data/hero-galaxy.json`:

```jsonc
{
  "updated": "2026-06-03",
  "systems": [
    {
      "id": "graphics",
      "name": "Graphics & shading",
      "accent": "#ff4b1f",
      "galaxyPosition": [-30, 0, -20],   // world-space at galaxy depth
      "sunShader": "sun",                 // file id in shaders/
      "sunTint": [1.0, 0.5, 0.2],         // RGB multiplied in sun.wgsl
      "planets": [
        {
          "id": "webgpu-wgsl",
          "name": "WebGPU + WGSL",
          "shader": "planet-webgpu-wgsl",  // → shaders/planets/planet-webgpu-wgsl.wgsl
          "size": 1.0,                     // relative; affects icosphere model scale
          "orbit": {                       // around the parent sun, system depth
            "radius": 6.0,
            "period": 60.0,                // seconds per revolution
            "phase": 0.0,                  // initial angle in radians
            "tilt": 8.0                    // degrees from system's orbital plane
          },
          "ring": {
            "type": "particles",
            "count": 3500,
            "innerRadius": 1.4,
            "outerRadius": 2.1,
            "tilt": 18
          },
          "moons": [
            {
              "projectId": "remain",
              "size": 0.25,
              "orbit": { "radius": 1.8, "period": 12.0, "phase": 0.0, "tilt": 0.0 }
            },
            { "projectId": "tech_particles", "size": 0.22, "orbit": { "radius": 2.4, "period": 18.0, "phase": 2.1, "tilt": 4.0 } }
          ]
        },
        { "id": "gpgpu-compute", ... },
        { "id": "raymarch-sdf", ... },
        { "id": "procedural-worlds", ... },
        { "id": "retro-post", ... }
      ]
    },
    { "id": "ml-ai", ... },
    { "id": "web-systems", ... }
  ]
}
```

`projectId` keys resolve into `data/projects.json` entries. The runtime fetches the project's `title` and `cover` for moon labels, and clicking a moon invokes `window.openModal(projectId, anchorEl)` (already exposed by `js/main.js`).

## Page integration

### HTML

The current `<section #hero>` contents are replaced wholesale:

```html
<section id="hero" class="hero-galaxy" data-section="hero">
  <canvas id="galaxy-canvas" aria-hidden="true"></canvas>

  <!-- accessible / SEO content, visually hidden when canvas is live -->
  <h1 class="hero-name sr-only">Raphael Giulieri.</h1>
  <p class="hero-tagline sr-only">Multi-disciplinary creative technologist — games, web, ML, 3D, automation.</p>
  <section class="hero-disciplines sr-only" aria-label="Disciplines">
    <!-- the existing 3-column block, kept for fallback -->
  </section>

  <!-- live overlay -->
  <nav class="galaxy-breadcrumb" aria-label="Navigation">
    <ol id="breadcrumb-list"></ol>
  </nav>
  <p class="galaxy-scroll-hint" aria-hidden="true">scroll ↓</p>
</section>
```

The `hero-eyebrow` ("Creative technologist / Nice / FR / Available for freelance") and the `hero-stats` (Since / Catalogue / Clients / Disciplines) **move out** of the hero. Eyebrow lives in the page chrome / header area; stats relocate to the About section as a small inline stat row.

### CSS

```css
.hero-galaxy {
  position: relative;
  height: 100vh;
  background: #010101;
}
.hero-galaxy #galaxy-canvas {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
}
.hero-galaxy .sr-only {
  /* screen-reader / SEO only — visually hidden */
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* Fallback: no WebGPU / reduced motion / data load fail */
.hero-galaxy.is-fallback #galaxy-canvas,
.hero-galaxy.is-fallback .galaxy-breadcrumb,
.hero-galaxy.is-fallback .galaxy-scroll-hint { display: none; }
.hero-galaxy.is-fallback .hero-name,
.hero-galaxy.is-fallback .hero-tagline,
.hero-galaxy.is-fallback .hero-disciplines {
  position: static; width: auto; height: auto; margin: 0; padding: 0;
  overflow: visible; clip: auto; white-space: normal;
  /* additional editorial layout — match current hero styling */
}
```

### Fallback path

Identical mechanic to the current masthead. Any of these conditions trip `section.classList.add('is-fallback')`:

- `!('gpu' in navigator)` → no WebGPU
- `window.matchMedia('(prefers-reduced-motion: reduce)').matches` → user opt-out
- `fetch('data/hero-galaxy.json')` fails or times out at 1500 ms
- `createParticleSystem(...)` throws (engine init failure)
- Compiling the four boot shaders fails

`.is-fallback` reverts the H1, tagline, and disciplines block to their visible editorial layout — visually indistinguishable from the current site's textual hero.

## Performance

### Per-frame budget (desktop, 60fps target)

| Layer | Frame cost |
|---|---|
| Mesh layer (≤ 15 planets + ≤ 31 moons + 3 suns at system view, fewer per state) | ~2.5 ms |
| Starfield (20k pts) | ~0.8 ms |
| Ring particles (≤ 17.5k aggregate) | ~1.5 ms |
| Postfx (bloom 3 passes + vignette) | ~1.5 ms |
| Raycast + camera math (JS) | < 0.5 ms |
| **Total** | **~6.8 ms (~41% of 16.6ms budget)** |

Headroom is allocated to per-planet shader complexity. The dev profiling view from the particle playground already reports the relevant timings if a custom shader regresses.

### Pause when invisible

- `IntersectionObserver` on the `<section>` with `threshold: 0.1` → pause rAF loop AND any setInterval timers (auto-orbit, etc.) when the section is off-screen. Resumes when scrolled back.
- `document.hidden` → rAF auto-pauses (browser-native); same setInterval clear applies.

Off-screen GPU work: zero. Off-screen JS work: only the IntersectionObserver callback on visibility change.

## Scope boundaries

### In scope (v1)

- Galaxy → system → planet camera + interaction
- Curated 4–6 planets per system, hand-authored data file
- Per-planet WGSL shader system with fallback default
- 20k starfield + per-planet rings (≤ 5 planets carry rings in v1)
- Click moon → existing dossier modal
- Breadcrumb navigation, ESC to zoom out
- 100vh page integration + fallback path
- Mobile rendering at reduced budget

### Out of scope (deferred to v2+)

- **Pan / free-camera mode** — explicitly chosen against (focal-locked orbit + zoom only).
- **Multi-pass per-planet shaders** (refraction, atmospheric scattering as separate passes). v1's single `surface()` entry point covers most sphere variety. v2 escape hatch: `customPipeline: true` flag in JSON to opt a planet out of the standard template.
- **Vertex displacement** (lumpy/ridged planets via vertex shader). v1 uses shared icosphere; surface shader fakes parallax. v2 escape hatch: per-planet vertex shader file.
- **Search / filter** within the galaxy (e.g., "show me planets that use WebGL"). Editorial nav by clicking is enough for v1.
- **Auto-fly intro** (cinematic from galaxy down into one system on page load). Visitor lands in galaxy view by choice.
- **Camera bookmarks** / shareable URL state (`#system=graphics&planet=webgpu-wgsl`). Nice-to-have, deferred.
- **Sound design**. Discussed but out of scope.
- **Real ephemeris / accurate orbital mechanics**. Orbits are cosmetic; periods are tuned for visual rhythm not realism.

## Migration notes

When this lands:

| File / asset | Action |
|---|---|
| `js/hero-particles.js` | **Delete** (replaced by `js/hero-galaxy/index.js`) |
| `assets/hero/name-sdf-*.png`, `assets/hero/name-sdf.json` | **Delete** (no longer used) |
| `scripts/bake-name-sdf.mjs` | **Delete** (no longer used) |
| `index.html` `<section #hero>` contents | **Replace** per the HTML block above |
| `index.html` `<script src="js/hero-particles.js">` | **Replace** with `<script src="js/hero-galaxy/index.js" type="module">` |
| `css/style.css` `.hero-name-stage`, `.hero-particles`, `.is-fallback`, `.is-live` rules | **Replace** with `.hero-galaxy` block |
| Hero stats block | **Move** from hero section into About section |

The vendored particle engine at `js/particles/` is preserved (used here, and continues to power `demos/particle-playground.html`).

## Open questions for v2

These are deliberately deferred but worth flagging now so the JSON schema accommodates them:

1. **Per-planet rotation axis** — currently planets rotate on Y. Add `rotationAxis: [x, y, z]` to JSON later.
2. **Planet density mapping** — should planet size in JSON reflect project count (`size: numProjects * 0.1`) automatically, or stay hand-authored? Defaulting to hand-authored for v1.
3. **Moon → multiple projects** — a single moon could represent a project series (e.g., "Hytale mods" as one moon for 3 mod projects). Defer the data shape; v1 is 1 moon = 1 project.
4. **Galaxy-level auto-rotation rate** — 0.5°/s is a guess; tune in playtest.
