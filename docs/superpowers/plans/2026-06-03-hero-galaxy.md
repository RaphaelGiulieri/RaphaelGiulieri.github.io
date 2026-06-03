# Hero Galaxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the WebGPU particle-text masthead with a 3D interactive galaxy where three discipline-suns each contain 4–6 sub-category planets and their project moons, navigated via focal-locked orbit + zoom across galaxy → system → planet camera states.

**Architecture:** All-WebGPU single canvas at 100vh. Custom mesh pipeline (icosphere + per-body uniform + per-planet WGSL surface shader) renders bodies; the existing vendored particle engine renders the 20k starfield and per-planet ring particles in the same encoder. Scene state machine drives camera target + Bezier transitions. Hit-testing on bodies via ray-vs-sphere; click moons opens the existing dossier modal via `window.openModal`.

**Tech Stack:** Vanilla JS (ES modules), WebGPU + WGSL, the vendored particle engine at `js/particles/`, the existing math helpers in `js/particles/core/math.js` (mat4LookAt, mat4Perspective, vec3 helpers), `IntersectionObserver`, no frameworks. Spec at [docs/superpowers/specs/2026-06-03-hero-galaxy-design.md](docs/superpowers/specs/2026-06-03-hero-galaxy-design.md).

**Spec deviations discovered during planning:**
- `shapes.ring` already exists in the engine ([js/particles/core/shapes.js:99](js/particles/core/shapes.js#L99)) with `{radius, thickness, height}`. We reuse it (radius = (inner+outer)/2, thickness = outer−inner, height small) instead of adding a new shape. Tilt is applied at the emitter transform level.
- Only `modules.orbit` is genuinely new on the engine side.

---

## File Structure

```
js/hero-galaxy/                                    NEW — entire 3D hero
  index.js                                         entry; mounts, gates, dispatches to scene
  scene.js                                         scene graph + state machine (galaxy/system/planet)
  bodies.js                                        body factory (sun/planet/moon) + uniform buffer pool
  data-loader.js                                   loads + validates data/hero-galaxy.json + cross-refs projects.json
  breadcrumb.js                                    DOM breadcrumb + click handlers
  render/
    sphere-mesh.js                                 icosphere geometry generator
    ring-mesh.js                                   flat-disc geometry generator
    pipeline.js                                    mesh pipeline builder + shader cache
    starfield.js                                   particle engine integration for stars
    camera.js                                      orbit/zoom math + state Bezier interpolation
    controls.js                                    DOM event wiring → camera updates
    raycast.js                                     ray-vs-sphere hit test
  shaders/
    _planet-prelude.wgsl                           helper library (noise3, voronoi, simplex2, palette, fresnel)
    default-planet.wgsl                            fallback planet surface
    default-moon.wgsl                              small moon surface
    sun.wgsl                                       per-system tinted sun
    ring-disc.wgsl                                 alpha-blended ring bands
    mesh-vertex.wgsl                               shared vertex shader template
    planets/                                       per-planet authored surfaces
      planet-webgpu-wgsl.wgsl
      planet-gpgpu.wgsl
      planet-raymarch.wgsl
      ... (one per planet, lazy compiled)

data/hero-galaxy.json                              NEW — scene composition

js/particles/core/modules.js                       MODIFY — append `orbit` module

index.html                                         MODIFY — replace .hero contents
css/style.css                                      MODIFY — replace hero rules with .hero-galaxy block

DELETE: js/hero-particles.js
DELETE: assets/hero/name-sdf-*.png
DELETE: assets/hero/name-sdf.json
DELETE: scripts/bake-name-sdf.mjs
```

---

## Phase 0 — Preflight

### Task 0.1: Verify environment + create feature branch

**Files:** none (env check)

- [ ] **Step 1: Confirm clean working tree**

Run: `git status --short`
Expected: empty (or only files unrelated to the hero — fail if any js/hero-particles.js or assets/hero/ changes are staged)

- [ ] **Step 2: Check current commit + main is up-to-date**

Run: `git log --oneline -3 && git rev-parse --abbrev-ref HEAD`
Expected: HEAD shows recent particle-hero commits; branch is `main` or a worktree branch from `main`.

- [ ] **Step 3: Confirm engine math + shape helpers exist**

Run: `grep -n "mat4LookAt\|mat4Perspective" js/particles/core/math.js`
Expected: both exported (lines around 10 and 37).

Run: `grep -n "^export function ring" js/particles/core/shapes.js`
Expected: line 99 — `shapes.ring` exists.

- [ ] **Step 4: Confirm window.openModal is exposed**

Run: `grep -n "window.openModal" js/main.js`
Expected: a line assigning `window.openModal = openModal`.

- [ ] **Step 5: Start local dev server (background)**

Run: `python -m http.server 8000` (run in background; leave the shell free).
Verify: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/` returns 200.

---

### ✅ Gate 0: Environment verified. Proceed to Phase 1.

---

## Phase 1 — Demolish old masthead + scaffold new section with fallback live

This phase's gate: visiting `/` with WebGPU disabled shows the editorial H1+tagline+disciplines block; with WebGPU enabled shows a black 100vh canvas (engine not yet doing anything). Old hero deleted.

### Task 1.1: Remove old masthead artifacts

**Files:**
- Delete: `js/hero-particles.js`
- Delete: `assets/hero/name-sdf.json`
- Delete: `assets/hero/name-sdf-0.png`
- Delete: `assets/hero/name-sdf-1.png`
- Delete: `assets/hero/name-sdf-2.png`
- Delete: `assets/hero/name-sdf-3.png`
- Delete: `scripts/bake-name-sdf.mjs`

- [ ] **Step 1: Remove via git rm**

Run:
```
git rm js/hero-particles.js \
       assets/hero/name-sdf.json \
       assets/hero/name-sdf-0.png \
       assets/hero/name-sdf-1.png \
       assets/hero/name-sdf-2.png \
       assets/hero/name-sdf-3.png \
       scripts/bake-name-sdf.mjs
```

- [ ] **Step 2: Remove the script reference from index.html**

Find and delete the line in `index.html`:
```html
<script src="js/hero-particles.js" defer></script>
```

- [ ] **Step 3: Verify build still loads (broken hero is OK at this gate)**

Reload `http://localhost:8000/` — the page should load with no JS console errors. The .hero section will look broken (empty canvas, current CSS expects `is-static`/`is-live`) but no script-not-found errors.

- [ ] **Step 4: Commit**

```
git commit -m "Hero galaxy: remove particle-text masthead artifacts"
```

---

### Task 1.2: Replace `<section #hero>` contents in index.html

**Files:**
- Modify: `index.html` (the `<section id="hero">` block — replace inner contents)

- [ ] **Step 1: Locate the existing hero section**

Find in `index.html`:
```html
<section id="hero" class="hero" data-section="hero">
  <div class="hero-grid">
    <p class="hero-eyebrow revealable">...</p>
    <div class="hero-name-stage is-static">
      <canvas class="hero-particles" aria-hidden="true"></canvas>
      <h1 class="hero-name revealable">...</h1>
    </div>
    <p class="hero-tagline revealable">...</p>
    <dl class="hero-stats revealable">...</dl>
  </div>
  <section class="hero-disciplines revealable" aria-label="Disciplines">...</section>
  <p class="hero-catalogue-link revealable">...</p>
</section>
```

- [ ] **Step 2: Replace it with the galaxy structure**

Replace the entire `<section id="hero">…</section>` with:
```html
<section id="hero" class="hero-galaxy" data-section="hero">
  <canvas id="galaxy-canvas" aria-hidden="true"></canvas>

  <!-- Live overlay (visible when canvas runs) -->
  <nav class="galaxy-breadcrumb" aria-label="Galaxy navigation">
    <ol id="breadcrumb-list"></ol>
  </nav>
  <p class="galaxy-scroll-hint" aria-hidden="true">scroll <span aria-hidden="true">↓</span></p>

  <!-- Accessible content (visually hidden when canvas runs; revealed on .is-fallback) -->
  <div class="hero-fallback">
    <p class="hero-eyebrow">
      <span class="eyebrow-dot"></span>
      Creative technologist
      <span class="eyebrow-sep">/</span>
      Nice<span class="thin"> / </span>FR
      <span class="eyebrow-sep">/</span>
      <span class="eyebrow-avail">Available for freelance</span>
    </p>
    <h1 class="hero-name">
      <span class="name-line name-line-1">Raphael</span>
      <span class="name-line name-line-2"><em>Giulieri.</em></span>
    </h1>
    <p class="hero-tagline">
      Multi-disciplinary creative technologist — games, web, ML, 3D, automation. I work across engines and stacks on the problems that need a graphics mindset, a systems mindset, and an engineering mindset all at once.
    </p>
    <section class="hero-disciplines" aria-label="Disciplines">
      <div class="discipline-col">
        <h3 class="discipline-head"><em>Graphics &amp; shading</em></h3>
        <ul class="discipline-list">
          <li>WebGPU &amp; WGSL</li>
          <li>HLSL (URP, HDRP, Wallpaper Engine)</li>
          <li>GLSL (Three.js, WebGL2)</li>
          <li>GPGPU compute &amp; Navier-Stokes</li>
          <li>Reaction-diffusion</li>
          <li>Raymarching, signed-distance fields</li>
          <li>Procedural worlds (WFC, L-systems, simplex, Voronoi)</li>
          <li>Retro post-processing (Kuwahara, CRT, Bayer dither)</li>
        </ul>
      </div>
      <div class="discipline-col">
        <h3 class="discipline-head"><em>ML &amp; AI</em></h3>
        <ul class="discipline-list">
          <li>Claude API + tool use</li>
          <li>Multi-agent orchestration</li>
          <li>Local diffusion stack (ComfyUI, SDXL, IP-Adapter, LoRA)</li>
          <li>XGBoost + walk-forward validation</li>
          <li>Conformal prediction</li>
          <li>Kelly / HRP sizing</li>
          <li>Cheap-inference NPCs (4-layer LLM stack)</li>
        </ul>
      </div>
      <div class="discipline-col">
        <h3 class="discipline-head"><em>Web, systems, tooling</em></h3>
        <ul class="discipline-list">
          <li>FastAPI / Flask back-ends</li>
          <li>React 19 + TypeScript</li>
          <li>Cloudflare Workers + KV</li>
          <li>Browser automation (nodriver, curl-cffi, Akamai-grade)</li>
          <li>3D CAD scripting (SketchUp Python)</li>
          <li>Engine modding (Hytale Java, Darktide DMF/Lua, Bitsquid)</li>
          <li>Custom C++ engines, Unity URP &amp; HDRP</li>
        </ul>
      </div>
    </section>
    <p class="hero-catalogue-link">
      <a href="#about"><em>About this work</em> <span aria-hidden="true">↓</span></a>
    </p>
  </div>
</section>
```

- [ ] **Step 3: Add the script tag at the end of `<body>` before `js/main.js`**

Find:
```html
<script src="js/main.js" defer></script>
```

Insert above it:
```html
<script type="module" src="js/hero-galaxy/index.js"></script>
```

- [ ] **Step 4: Reload to confirm HTML parses**

Reload `http://localhost:8000/`. Console should show: a 404 for `js/hero-galaxy/index.js` (we'll fix in Task 1.4). The fallback content should already render in the DOM (currently visible because CSS hasn't been updated — that's expected, fixed next task).

- [ ] **Step 5: Commit**

```
git add index.html
git commit -m "Hero galaxy: new <section #hero> with galaxy canvas + fallback content"
```

---

### Task 1.3: Replace hero CSS with .hero-galaxy block

**Files:**
- Modify: `css/style.css` (replace all `.hero-name-stage`, `.hero-particles`, `.hero-name.revealable`, `.is-static`, `.is-coalescing`, `.is-live`, `.is-fallback` rules with the new `.hero-galaxy` block)

- [ ] **Step 1: Locate existing rules**

In `css/style.css`, find the block starting near `.hero-name-stage` (around line 418 in the current file) and ending at the last `.is-fallback` rule. This is the block being replaced.

- [ ] **Step 2: Replace it with**

```css
/* ─── Hero galaxy — 100vh dedicated landing ─── */
.hero-galaxy {
    position: relative;
    height: 100vh;
    width: 100%;
    background: #010101;
    overflow: hidden;
    /* Cancel the .hero/.section-* padding that would inset the canvas */
    padding: 0;
    margin: 0;
}
.hero-galaxy #galaxy-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
}

/* Live-mode overlay chrome */
.hero-galaxy .galaxy-breadcrumb {
    position: absolute;
    top: 88px;
    left: 24px;
    z-index: 5;
    font-family: var(--f-mono, monospace);
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: rgba(240, 235, 224, 0.5);
}
.hero-galaxy .galaxy-breadcrumb ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: 12px;
    align-items: baseline;
}
.hero-galaxy .galaxy-breadcrumb li {
    cursor: pointer;
    transition: color 200ms var(--ease-out, ease-out);
}
.hero-galaxy .galaxy-breadcrumb li:hover { color: var(--accent, #ff4b1f); }
.hero-galaxy .galaxy-breadcrumb li.is-active {
    color: var(--accent, #ff4b1f);
    cursor: default;
}
.hero-galaxy .galaxy-breadcrumb li + li::before {
    content: '→';
    margin-right: 12px;
    color: rgba(240, 235, 224, 0.2);
}
.hero-galaxy .galaxy-scroll-hint {
    position: absolute;
    bottom: 32px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
    font-family: var(--f-mono, monospace);
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: rgba(240, 235, 224, 0.45);
    pointer-events: none;
}

/* Fallback content is hidden in live mode (visually + from clicks; kept for SR/SEO) */
.hero-galaxy .hero-fallback {
    position: absolute;
    inset: 0;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    margin: -1px;
    padding: 0;
    border: 0;
}

/* Fallback path: WebGPU absent / reduced-motion / data fail → un-hide editorial content,
   hide the canvas overlay chrome. */
.hero-galaxy.is-fallback #galaxy-canvas,
.hero-galaxy.is-fallback .galaxy-breadcrumb,
.hero-galaxy.is-fallback .galaxy-scroll-hint { display: none; }
.hero-galaxy.is-fallback {
    height: auto;
    background: var(--bg, #fbf4ea);
}
.hero-galaxy.is-fallback .hero-fallback {
    position: static;
    width: auto;
    height: auto;
    overflow: visible;
    clip: auto;
    white-space: normal;
    margin: 0;
    padding: var(--s-7, 88px) var(--s-5, 32px) var(--s-6, 56px);
    display: grid;
    gap: var(--s-4, 24px);
    max-width: 1100px;
    margin-left: auto;
    margin-right: auto;
}
.hero-galaxy.is-fallback .hero-eyebrow {
    font-family: var(--f-mono, monospace);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(28, 22, 14, 0.55);
}
.hero-galaxy.is-fallback .hero-name {
    font-family: var(--f-display, serif);
    font-size: var(--t-hero, clamp(56px, 9vw, 124px));
    line-height: 0.95;
    margin: 0;
}
.hero-galaxy.is-fallback .hero-name em { color: var(--accent, #ff4b1f); font-style: italic; }
.hero-galaxy.is-fallback .hero-tagline {
    font-family: var(--f-display, serif);
    font-size: var(--t-lede, clamp(20px, 2.4vw, 30px));
    line-height: 1.35;
    max-width: 32ch;
    color: rgba(28, 22, 14, 0.85);
}
.hero-galaxy.is-fallback .hero-disciplines {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--s-5, 32px);
    margin-top: var(--s-4, 24px);
}
.hero-galaxy.is-fallback .discipline-head {
    font-family: var(--f-display, serif);
    font-size: 18px;
    margin: 0 0 12px;
}
.hero-galaxy.is-fallback .discipline-list {
    list-style: none;
    padding: 0;
    margin: 0;
    font-family: var(--f-mono, monospace);
    font-size: 11px;
    line-height: 1.7;
    color: rgba(28, 22, 14, 0.75);
}
.hero-galaxy.is-fallback .hero-catalogue-link a {
    font-family: var(--f-mono, monospace);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent, #ff4b1f);
    text-decoration: none;
}

@media (max-width: 720px) {
    .hero-galaxy .galaxy-breadcrumb { top: 72px; left: 16px; font-size: 10px; }
    .hero-galaxy.is-fallback .hero-fallback { padding: 64px 20px 48px; }
}
```

- [ ] **Step 3: Reload + force fallback via DevTools to check styles**

Reload `http://localhost:8000/`. Page should now show a black 100vh hero with no visible chrome (canvas not yet drawing). Editorial content is invisible.

In DevTools console:
```
document.querySelector('.hero-galaxy').classList.add('is-fallback')
```
Expected: black canvas disappears, editorial H1 + tagline + 3-discipline-column block becomes visible and laid out cleanly.

Remove the class to return to live mode:
```
document.querySelector('.hero-galaxy').classList.remove('is-fallback')
```

- [ ] **Step 4: Commit**

```
git add css/style.css
git commit -m "Hero galaxy: replace masthead CSS with .hero-galaxy + .is-fallback block"
```

---

### Task 1.4: Skeleton hero-galaxy/index.js — gates + fallback only

**Files:**
- Create: `js/hero-galaxy/index.js`

- [ ] **Step 1: Create the directory**

Run: `mkdir -p js/hero-galaxy`

- [ ] **Step 2: Write the skeleton entry**

Create `js/hero-galaxy/index.js`:
```js
// Hero galaxy entry point — gates WebGPU / reduced-motion / data availability,
// then mounts the 3D scene. Falls back to the editorial H1 + tagline + disciplines
// block (via .is-fallback) on any failure or unsupported configuration.

(() => {
    'use strict';

    const HERO_GALAXY_DEBUG = false;
    const log = (...a) => { if (HERO_GALAXY_DEBUG) console.log('[hero-galaxy]', ...a); };

    async function boot() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot, { once: true });
            return;
        }

        const section = document.querySelector('.hero-galaxy');
        if (!section) { log('no .hero-galaxy section'); return; }

        const showFallback = () => section.classList.add('is-fallback');

        // Gate 1 — WebGPU available?
        if (!('gpu' in navigator)) { log('no navigator.gpu'); showFallback(); return; }

        // Gate 2 — Reduced motion?
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            log('reduced-motion preferred'); showFallback(); return;
        }

        // Gate 3 — Engine + scene modules import OK?
        let mountScene;
        try {
            ({ mountScene } = await import('./scene.js'));
        } catch (e) {
            log('module import failed', e); showFallback(); return;
        }

        // Gate 4 — Scene mount OK?
        try {
            await mountScene({ section });
        } catch (e) {
            log('scene mount failed', e); showFallback(); return;
        }

        log('galaxy mounted');
    }

    boot();
})();
```

- [ ] **Step 3: Create a minimal scene stub so the import resolves**

Create `js/hero-galaxy/scene.js`:
```js
// Scene mount + state machine. Phase 1 stub: throws so the fallback path triggers
// until Phase 2 lands a real WebGPU init. Each later phase replaces parts of this.
export async function mountScene({ section }) {
    throw new Error('scene not yet implemented');
}
```

- [ ] **Step 4: Reload + verify**

Reload `http://localhost:8000/`. In DevTools console — no errors should be logged at info level. Section element should have `is-fallback` class (because scene.js throws). Inspect:
```
document.querySelector('.hero-galaxy').classList.contains('is-fallback')
```
Expected: `true`. Editorial H1 + tagline + disciplines block visible.

- [ ] **Step 5: Test the no-WebGPU branch directly**

In DevTools console:
```
Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
location.reload();
```
Expected: same result — `.is-fallback` class added, editorial content visible, no errors.

- [ ] **Step 6: Commit**

```
git add js/hero-galaxy/index.js js/hero-galaxy/scene.js
git commit -m "Hero galaxy: skeleton entry — gates + fallback only, scene stub"
```

---

### ✅ Gate 1: Old masthead removed. Fallback works on all four early-exit paths. Live mode shows black 100vh canvas. STOP and verify before Phase 2.

---

## Phase 2 — WebGPU device + clear pass + camera scaffolding

Gate: a black 100vh canvas being actively rendered (clear color in a render pass each frame) with the `.is-fallback` class NOT applied. Camera math module is in place but not yet driving anything visible.

### Task 2.1: Camera module — view + perspective matrices

**Files:**
- Create: `js/hero-galaxy/render/camera.js`

- [ ] **Step 1: Create the directory**

Run: `mkdir -p js/hero-galaxy/render`

- [ ] **Step 2: Write camera.js**

Create `js/hero-galaxy/render/camera.js`:
```js
// Focal-locked orbital camera. State is (yaw, pitch, distance, fov, target),
// from which view + projection matrices are derived. No pan — target is the
// authoritative focal point and rotation always happens around it.

import {
    mat4LookAt, mat4Perspective, v3Set, clamp, TAU
} from '../../particles/core/math.js';

export function createCamera() {
    const cam = {
        // Authoritative state
        target:   new Float32Array([0, 0, 0]),
        yaw:      Math.PI * 0.25,    // radians, around world Y
        pitch:    Math.PI * 0.12,    // radians, clamped ±80°
        distance: 30,
        fov:      Math.PI / 3.5,     // ~51.4° vertical
        aspect:   1,
        near:     0.1,
        far:      500,

        // Derived (filled by recompute())
        view:     new Float32Array(16),
        proj:     new Float32Array(16),
        eye:      new Float32Array(3),
    };
    recompute(cam);
    return cam;
}

const PITCH_LIMIT = (80 / 180) * Math.PI;

export function setAspect(cam, aspect) {
    cam.aspect = aspect;
    recompute(cam);
}

export function setTarget(cam, x, y, z) {
    cam.target[0] = x; cam.target[1] = y; cam.target[2] = z;
    recompute(cam);
}

export function applyOrbitDelta(cam, dYaw, dPitch) {
    cam.yaw   = (cam.yaw + dYaw) % TAU;
    cam.pitch = clamp(cam.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
    recompute(cam);
}

export function applyZoomDelta(cam, factor, minDist, maxDist) {
    cam.distance = clamp(cam.distance * factor, minDist, maxDist);
    recompute(cam);
}

export function recompute(cam) {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const cy = Math.cos(cam.yaw),   sy = Math.sin(cam.yaw);
    // Eye position relative to target, then add target.
    cam.eye[0] = cam.target[0] + cam.distance * cp * sy;
    cam.eye[1] = cam.target[1] + cam.distance * sp;
    cam.eye[2] = cam.target[2] + cam.distance * cp * cy;
    mat4LookAt(cam.eye, cam.target, [0, 1, 0], cam.view);
    mat4Perspective(cam.fov, cam.aspect, cam.near, cam.far, cam.proj);
}
```

- [ ] **Step 3: Smoke-test the camera in DevTools**

There's no UI yet to test the camera. We'll verify it via Node-like check by importing in the browser console once the dev server is reachable. For now, ensure the module parses by opening it in a browser via direct URL:

Visit: `http://localhost:8000/js/hero-galaxy/render/camera.js`
Expected: the JS file loads (200 OK, raw source visible).

- [ ] **Step 4: Commit**

```
git add js/hero-galaxy/render/camera.js
git commit -m "Hero galaxy: focal-locked orbital camera math"
```

---

### Task 2.2: WebGPU device init + clear-pass render loop

**Files:**
- Modify: `js/hero-galaxy/scene.js` (replace the stub)

- [ ] **Step 1: Replace scene.js with a clear-pass scene**

Overwrite `js/hero-galaxy/scene.js`:
```js
// Scene mount + state machine. Phase 2: brings up a WebGPU device, configures
// the swapchain, and runs a render loop that clears to near-black. No content
// rendered yet — proves the canvas is alive.

import { createCamera, setAspect } from './render/camera.js';

const CLEAR_COLOR = { r: 0.004, g: 0.004, b: 0.004, a: 1.0 };

export async function mountScene({ section }) {
    const canvas = section.querySelector('#galaxy-canvas');
    if (!canvas) throw new Error('no #galaxy-canvas in section');

    // Set canvas backing-store size to its rendered size × DPR.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
        const w = Math.floor(canvas.clientWidth  * dpr);
        const h = Math.floor(canvas.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w; canvas.height = h;
            return true;
        }
        return false;
    }
    resize();

    // WebGPU device + swapchain
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no GPUAdapter');
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const camera = createCamera();
    setAspect(camera, canvas.width / canvas.height);

    let running = true;
    function frame() {
        if (!running) return;
        if (resize()) setAspect(camera, canvas.width / canvas.height);

        const enc = device.createCommandEncoder({ label: 'galaxy frame' });
        const pass = enc.beginRenderPass({
            label: 'clear',
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: CLEAR_COLOR,
                loadOp: 'clear',
                storeOp: 'store',
            }],
        });
        pass.end();
        device.queue.submit([enc.finish()]);

        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // Expose for downstream phases
    return { device, context, format, camera, canvas };
}
```

- [ ] **Step 2: Reload + verify**

Reload `http://localhost:8000/`. Expected:
- DevTools console: no errors
- `.hero-galaxy` element does NOT have `.is-fallback`
- Canvas fills 100vh, shows a near-black colour (`#010101` from CSS, then clear color barely visible)

In DevTools:
```
document.querySelector('.hero-galaxy').classList.contains('is-fallback')
```
Expected: `false`.

- [ ] **Step 3: Confirm the render loop is alive**

In DevTools console:
```
performance.now()
```
Wait 5s, run it again — the delta should be ~5000ms (confirms tab is alive; rAF runs).

- [ ] **Step 4: Commit**

```
git add js/hero-galaxy/scene.js
git commit -m "Hero galaxy: WebGPU device + clear-pass render loop"
```

---

### ✅ Gate 2: Black 100vh canvas rendered by WebGPU at 60fps, no errors, fallback NOT engaged. STOP and verify before Phase 3.

---

## Phase 3 — Icosphere mesh + default shader + single sphere render

Gate: one rotating white sphere visible at the centre of the canvas, rendered via a real mesh pipeline with the default planet shader. Shader cache + lazy compile in place.

### Task 3.1: Icosphere geometry generator

**Files:**
- Create: `js/hero-galaxy/render/sphere-mesh.js`

- [ ] **Step 1: Write the generator**

Create `js/hero-galaxy/render/sphere-mesh.js`:
```js
// Icosphere — recursively-subdivided icosahedron. Returns interleaved
// vertex data (position x3, normal x3 = 6 floats per vertex) and a u16 index
// buffer. Subdivision=5 yields ~5k verts, =4 ~1.3k, =3 ~320.

export function makeIcosphere(subdivisions = 5) {
    const t = (1 + Math.sqrt(5)) / 2;
    // 12 base vertices of an icosahedron, normalised to unit sphere
    let verts = [
        [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
        [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
        [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1],
    ].map(v => normalise(v));

    // 20 base triangles
    let faces = [
        [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
        [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
        [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
        [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
    ];

    // Subdivide
    const mid = new Map();
    function midpoint(a, b) {
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        if (mid.has(key)) return mid.get(key);
        const pa = verts[a], pb = verts[b];
        const m = normalise([(pa[0]+pb[0])*0.5, (pa[1]+pb[1])*0.5, (pa[2]+pb[2])*0.5]);
        const idx = verts.length;
        verts.push(m);
        mid.set(key, idx);
        return idx;
    }
    for (let s = 0; s < subdivisions; s++) {
        const next = [];
        for (const [a, b, c] of faces) {
            const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
            next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
        }
        faces = next;
        mid.clear();
    }

    // Pack — position == normal for a unit sphere centred at origin
    const vertexData = new Float32Array(verts.length * 6);
    for (let i = 0; i < verts.length; i++) {
        const v = verts[i];
        vertexData[i*6    ] = v[0]; vertexData[i*6 + 1] = v[1]; vertexData[i*6 + 2] = v[2];
        vertexData[i*6 + 3] = v[0]; vertexData[i*6 + 4] = v[1]; vertexData[i*6 + 5] = v[2];
    }

    // Indices — use u32 if needed
    const idxCount = faces.length * 3;
    const Idx = idxCount > 65535 ? Uint32Array : Uint16Array;
    const indexData = new Idx(idxCount);
    for (let i = 0; i < faces.length; i++) {
        indexData[i*3    ] = faces[i][0];
        indexData[i*3 + 1] = faces[i][1];
        indexData[i*3 + 2] = faces[i][2];
    }

    return {
        vertexData,
        indexData,
        vertexCount: verts.length,
        indexCount: idxCount,
        indexFormat: Idx === Uint16Array ? 'uint16' : 'uint32',
    };
}

function normalise(v) {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0]/l, v[1]/l, v[2]/l];
}
```

- [ ] **Step 2: Smoke-test the generator in the browser console**

Reload `/`, then in DevTools console:
```
const m = await import('/js/hero-galaxy/render/sphere-mesh.js');
const ico = m.makeIcosphere(5);
console.log(ico.vertexCount, ico.indexCount, ico.indexFormat);
```
Expected: ~10242 vertices, ~61440 indices, `uint32`. (Adjust subdivision=4 → 2562, 30720, `uint16`.)

- [ ] **Step 3: Commit**

```
git add js/hero-galaxy/render/sphere-mesh.js
git commit -m "Hero galaxy: icosphere geometry generator"
```

---

### Task 3.2: WGSL prelude + default-planet shader + shared vertex shader

**Files:**
- Create: `js/hero-galaxy/shaders/_planet-prelude.wgsl`
- Create: `js/hero-galaxy/shaders/mesh-vertex.wgsl`
- Create: `js/hero-galaxy/shaders/default-planet.wgsl`

- [ ] **Step 1: Create the shaders directory**

Run: `mkdir -p js/hero-galaxy/shaders/planets`

- [ ] **Step 2: Write the prelude**

Create `js/hero-galaxy/shaders/_planet-prelude.wgsl`:
```wgsl
// Helper library prepended to every per-planet surface shader.
// Provides noise, palette, fresnel utilities so authors don't copy-paste.

fn hash13(p3: vec3<f32>) -> f32 {
    var p = fract(p3 * 0.1031);
    p = p + dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

fn noise3(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let n000 = hash13(i + vec3<f32>(0.0, 0.0, 0.0));
    let n100 = hash13(i + vec3<f32>(1.0, 0.0, 0.0));
    let n010 = hash13(i + vec3<f32>(0.0, 1.0, 0.0));
    let n110 = hash13(i + vec3<f32>(1.0, 1.0, 0.0));
    let n001 = hash13(i + vec3<f32>(0.0, 0.0, 1.0));
    let n101 = hash13(i + vec3<f32>(1.0, 0.0, 1.0));
    let n011 = hash13(i + vec3<f32>(0.0, 1.0, 1.0));
    let n111 = hash13(i + vec3<f32>(1.0, 1.0, 1.0));
    let nx00 = mix(n000, n100, u.x);
    let nx10 = mix(n010, n110, u.x);
    let nx01 = mix(n001, n101, u.x);
    let nx11 = mix(n011, n111, u.x);
    return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z);
}

fn fbm3(p: vec3<f32>, octaves: i32) -> f32 {
    var s = 0.0;
    var a = 0.5;
    var f = 1.0;
    for (var i = 0; i < octaves; i++) {
        s = s + a * noise3(p * f);
        f = f * 2.02;
        a = a * 0.5;
    }
    return s;
}

fn voronoi(p: vec3<f32>) -> f32 {
    let ip = floor(p);
    let fp = fract(p);
    var d = 1e9;
    for (var z = -1; z <= 1; z++) {
        for (var y = -1; y <= 1; y++) {
            for (var x = -1; x <= 1; x++) {
                let g = vec3<f32>(f32(x), f32(y), f32(z));
                let o = vec3<f32>(
                    hash13(ip + g + vec3<f32>(0.1, 0.0, 0.0)),
                    hash13(ip + g + vec3<f32>(0.0, 0.1, 0.0)),
                    hash13(ip + g + vec3<f32>(0.0, 0.0, 0.1)));
                let r = g + o - fp;
                d = min(d, dot(r, r));
            }
        }
    }
    return sqrt(d);
}

fn palette(t: f32, base: vec3<f32>, ramp: vec3<f32>) -> vec3<f32> {
    return base + ramp * cos(6.2831853 * (t + vec3<f32>(0.0, 0.33, 0.67)));
}

fn fresnel(view_dir: vec3<f32>, normal: vec3<f32>, power: f32) -> f32 {
    return pow(1.0 - max(0.0, dot(view_dir, normal)), power);
}
```

- [ ] **Step 3: Write the shared vertex shader**

Create `js/hero-galaxy/shaders/mesh-vertex.wgsl`:
```wgsl
// Shared vertex shader for all sphere bodies. Engine prepends this and the
// planet-specific surface() function into one module.

struct BodyUniforms {
    model     : mat4x4<f32>,
    accent    : vec4<f32>,
    meta      : vec4<f32>,    // x = time, y = radius_world, z = body_id, w = hover_t
};

struct CameraUniforms {
    view      : mat4x4<f32>,
    proj      : mat4x4<f32>,
    eye       : vec4<f32>,    // xyz = world-space eye, w = unused
};

@group(0) @binding(0) var<uniform> camera : CameraUniforms;
@group(1) @binding(0) var<uniform> body   : BodyUniforms;

struct VertexIn {
    @location(0) position : vec3<f32>,
    @location(1) normal   : vec3<f32>,
};

struct VertexOut {
    @builtin(position) clip_pos     : vec4<f32>,
    @location(0)       world_pos    : vec3<f32>,
    @location(1)       world_normal : vec3<f32>,
    @location(2)       uv_sphere    : vec2<f32>,
    @location(3)       view_dir     : vec3<f32>,
};

@vertex
fn vs_main(in: VertexIn) -> VertexOut {
    var out : VertexOut;
    let world4 = body.model * vec4<f32>(in.position, 1.0);
    out.world_pos    = world4.xyz;
    // For a unit sphere body, normal == position (in body space).
    // Transform normal by upper-3x3 of model — assumes uniform scale, fine for us.
    let nrm4 = body.model * vec4<f32>(in.normal, 0.0);
    out.world_normal = normalize(nrm4.xyz);
    out.uv_sphere    = vec2<f32>(
        atan2(in.position.z, in.position.x) * 0.15915494 + 0.5,    // longitude in [0,1]
        in.position.y * 0.5 + 0.5);                                // latitude in [0,1]
    out.view_dir     = normalize(camera.eye.xyz - out.world_pos);
    out.clip_pos     = camera.proj * camera.view * world4;
    return out;
}
```

- [ ] **Step 4: Write the default-planet surface**

Create `js/hero-galaxy/shaders/default-planet.wgsl`:
```wgsl
// Default planet surface — used when a planet's specific shader is missing
// or fails to compile. Soft warm sphere with rim highlight on hover.

struct Surface {
    world_pos    : vec3<f32>,
    world_normal : vec3<f32>,
    uv_sphere    : vec2<f32>,
    view_dir     : vec3<f32>,
    time         : f32,
    accent       : vec3<f32>,
    hover_t      : f32,
};

fn surface(s: Surface) -> vec4<f32> {
    let ndl  = clamp(dot(s.world_normal, normalize(vec3<f32>(0.3, 0.7, 0.4))), 0.0, 1.0);
    let rim  = fresnel(s.view_dir, s.world_normal, 3.0);
    let base = s.accent * (0.25 + 0.75 * ndl);
    return vec4<f32>(base + s.accent * rim * (0.4 + s.hover_t * 1.5), 1.0);
}
```

- [ ] **Step 5: Verify all three files are fetchable**

Visit each URL — each should return 200 with the WGSL source:
- `http://localhost:8000/js/hero-galaxy/shaders/_planet-prelude.wgsl`
- `http://localhost:8000/js/hero-galaxy/shaders/mesh-vertex.wgsl`
- `http://localhost:8000/js/hero-galaxy/shaders/default-planet.wgsl`

- [ ] **Step 6: Commit**

```
git add js/hero-galaxy/shaders/_planet-prelude.wgsl \
        js/hero-galaxy/shaders/mesh-vertex.wgsl \
        js/hero-galaxy/shaders/default-planet.wgsl
git commit -m "Hero galaxy: WGSL prelude + shared vertex + default-planet shader"
```

---

### Task 3.3: Shader loader with lazy compile + cache + fallback

**Files:**
- Create: `js/hero-galaxy/render/pipeline.js`

- [ ] **Step 1: Write the pipeline + shader manager**

Create `js/hero-galaxy/render/pipeline.js`:
```js
// Mesh pipeline builder + shader cache. Each "planet kind" gets one cached
// pipeline keyed by its surface-shader file path. Compile failures fall back
// to the default surface shader and log the diagnostic.

const SHADER_DIR = '/js/hero-galaxy/shaders/';

const _wgslCache = new Map();    // path → source string
const _pipelineCache = new Map(); // surfacePath → GPURenderPipeline

let _prelude = null;
let _vertex  = null;
let _defaultSurface = null;

async function fetchWgsl(path) {
    if (_wgslCache.has(path)) return _wgslCache.get(path);
    const url = SHADER_DIR + path;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`wgsl 404: ${url}`);
    const txt = await res.text();
    _wgslCache.set(path, txt);
    return txt;
}

async function ensureCore() {
    if (_prelude && _vertex && _defaultSurface) return;
    [_prelude, _vertex, _defaultSurface] = await Promise.all([
        fetchWgsl('_planet-prelude.wgsl'),
        fetchWgsl('mesh-vertex.wgsl'),
        fetchWgsl('default-planet.wgsl'),
    ]);
}

export async function getMeshPipeline(device, format, surfacePath) {
    await ensureCore();
    const key = surfacePath;
    if (_pipelineCache.has(key)) return _pipelineCache.get(key);

    let surface = _defaultSurface;
    let usingFallback = false;
    if (surfacePath !== 'default-planet.wgsl') {
        try {
            surface = await fetchWgsl(surfacePath);
        } catch (e) {
            console.warn('[hero-galaxy] shader fetch failed, falling back:', surfacePath, e);
            surface = _defaultSurface;
            usingFallback = true;
        }
    }

    const fragmentCode = `
${_prelude}

${surface}

struct VertexOut {
    @builtin(position) clip_pos     : vec4<f32>,
    @location(0)       world_pos    : vec3<f32>,
    @location(1)       world_normal : vec3<f32>,
    @location(2)       uv_sphere    : vec2<f32>,
    @location(3)       view_dir     : vec3<f32>,
};

struct BodyUniforms {
    model  : mat4x4<f32>,
    accent : vec4<f32>,
    meta   : vec4<f32>,
};
@group(1) @binding(0) var<uniform> body : BodyUniforms;

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
    var s : Surface;
    s.world_pos    = in.world_pos;
    s.world_normal = normalize(in.world_normal);
    s.uv_sphere    = in.uv_sphere;
    s.view_dir     = normalize(in.view_dir);
    s.time         = body.meta.x;
    s.accent       = body.accent.rgb;
    s.hover_t      = body.meta.w;
    return surface(s);
}
`;

    const vertexModule   = device.createShaderModule({ label: `vert ${key}`, code: _vertex });
    const fragmentModule = device.createShaderModule({ label: `frag ${key}`, code: fragmentCode });

    // Check compile info — if the per-planet shader has a fatal error, retry with default.
    const compInfo = await fragmentModule.getCompilationInfo?.();
    const hasError = compInfo && compInfo.messages.some(m => m.type === 'error');
    if (hasError && !usingFallback) {
        console.warn('[hero-galaxy] shader compile error, falling back:', surfacePath, compInfo.messages);
        // Recurse with default — caching will ensure no infinite loop.
        return getMeshPipeline(device, format, 'default-planet.wgsl');
    }

    const cameraBGL = device.createBindGroupLayout({
        label: 'camera BGL',
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    const bodyBGL = device.createBindGroupLayout({
        label: 'body BGL',
        entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });

    const pipeline = device.createRenderPipeline({
        label: `mesh pipeline ${key}`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [cameraBGL, bodyBGL] }),
        vertex: {
            module: vertexModule,
            entryPoint: 'vs_main',
            buffers: [{
                arrayStride: 6 * 4,
                attributes: [
                    { shaderLocation: 0, offset: 0,     format: 'float32x3' },
                    { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
                ],
            }],
        },
        fragment: {
            module: fragmentModule,
            entryPoint: 'fs_main',
            targets: [{ format, blend: undefined /* opaque */ }],
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less',
        },
    });

    const result = { pipeline, cameraBGL, bodyBGL };
    _pipelineCache.set(key, result);
    return result;
}
```

- [ ] **Step 2: Verify pipeline.js loads as a module**

Visit `http://localhost:8000/js/hero-galaxy/render/pipeline.js` → 200.

In DevTools console (rough syntax-check via import):
```
await import('/js/hero-galaxy/render/pipeline.js')
```
Expected: returns a module object with `getMeshPipeline` exported.

- [ ] **Step 3: Commit**

```
git add js/hero-galaxy/render/pipeline.js
git commit -m "Hero galaxy: mesh pipeline + WGSL fetch/compile/cache with fallback"
```

---

### Task 3.4: Render one sphere with default shader

**Files:**
- Modify: `js/hero-galaxy/scene.js`

- [ ] **Step 1: Update scene.js to upload geometry + render one sphere**

Replace `js/hero-galaxy/scene.js` with:
```js
// Phase 3: one rotating sphere at origin via the default planet shader.

import { createCamera, setAspect } from './render/camera.js';
import { makeIcosphere } from './render/sphere-mesh.js';
import { getMeshPipeline } from './render/pipeline.js';

const CLEAR_COLOR = { r: 0.004, g: 0.004, b: 0.004, a: 1.0 };

export async function mountScene({ section }) {
    const canvas = section.querySelector('#galaxy-canvas');
    if (!canvas) throw new Error('no #galaxy-canvas');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resizeBacking() {
        const w = Math.floor(canvas.clientWidth  * dpr);
        const h = Math.floor(canvas.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
        return false;
    }
    resizeBacking();

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no adapter');
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const camera = createCamera();
    setAspect(camera, canvas.width / canvas.height);
    camera.distance = 4;        // close enough to see a single unit sphere

    // Geometry — one icosphere reused for all bodies
    const ico = makeIcosphere(5);
    const vbuf = device.createBuffer({ size: ico.vertexData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vbuf, 0, ico.vertexData);
    const ibuf = device.createBuffer({ size: ico.indexData.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ibuf, 0, ico.indexData);

    // Depth target (recreated on resize)
    let depthTex = null;
    function ensureDepth() {
        if (depthTex && depthTex.width === canvas.width && depthTex.height === canvas.height) return;
        depthTex?.destroy();
        depthTex = device.createTexture({
            size: [canvas.width, canvas.height, 1],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }
    ensureDepth();

    // Camera UBO (mat4 view + mat4 proj + vec4 eye = 144 bytes; pad to 192)
    const camUbo = device.createBuffer({ size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Body UBO (mat4 model + vec4 accent + vec4 meta = 96 bytes; pad to 128)
    const bodyUbo = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Pipeline — default planet shader
    const { pipeline, cameraBGL, bodyBGL } = await getMeshPipeline(device, format, 'default-planet.wgsl');

    const cameraBG = device.createBindGroup({
        layout: cameraBGL,
        entries: [{ binding: 0, resource: { buffer: camUbo } }],
    });
    const bodyBG = device.createBindGroup({
        layout: bodyBGL,
        entries: [{ binding: 0, resource: { buffer: bodyUbo } }],
    });

    // Static accent for this one sphere
    const accent = new Float32Array([1.0, 0.30, 0.10, 1.0]);
    // Identity model matrix (sphere at origin, scale 1)
    const model = new Float32Array([
        1,0,0,0,  0,1,0,0,  0,0,1,0,  0,0,0,1,
    ]);

    let last = performance.now();
    let running = true;
    function frame(now) {
        if (!running) return;
        if (resizeBacking()) { setAspect(camera, canvas.width / canvas.height); ensureDepth(); }
        const dt = Math.min(0.05, (now - last) / 1000); last = now;

        // Camera UBO
        const camArr = new Float32Array(48);
        camArr.set(camera.view, 0);
        camArr.set(camera.proj, 16);
        camArr.set([camera.eye[0], camera.eye[1], camera.eye[2], 0], 32);
        device.queue.writeBuffer(camUbo, 0, camArr);

        // Body UBO — rotate around Y over time
        const t = now * 0.001;
        const c = Math.cos(t * 0.5), s = Math.sin(t * 0.5);
        model[0] = c; model[2] = s; model[8] = -s; model[10] = c;
        const bodyArr = new Float32Array(32);
        bodyArr.set(model, 0);
        bodyArr.set(accent, 16);
        bodyArr.set([t, 1.0, 0.0, 0.0], 20);  // meta: time, radius_world, body_id, hover_t
        device.queue.writeBuffer(bodyUbo, 0, bodyArr);

        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: CLEAR_COLOR,
                loadOp: 'clear', storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: depthTex.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear', depthStoreOp: 'store',
            },
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, cameraBG);
        pass.setBindGroup(1, bodyBG);
        pass.setVertexBuffer(0, vbuf);
        pass.setIndexBuffer(ibuf, ico.indexFormat);
        pass.drawIndexed(ico.indexCount);
        pass.end();
        device.queue.submit([enc.finish()]);

        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return { device, context, format, camera, canvas };
}
```

- [ ] **Step 2: Reload + verify**

Reload `http://localhost:8000/`. Expected: a slowly-rotating vermilion-tinted sphere visible centred on the canvas. No errors.

- [ ] **Step 3: Commit**

```
git add js/hero-galaxy/scene.js
git commit -m "Hero galaxy: render one rotating sphere with default shader"
```

---

### ✅ Gate 3: Single sphere rendered + rotates + default shader. STOP and verify before Phase 4.

---

## Phase 4 — Multi-body uniforms + scene data + 3 suns visible

Gate: three coloured spheres at the JSON-defined galaxy positions, each using `sun.wgsl` with a per-system colour tint. Scene data file is loaded and parsed.

### Task 4.1: Author data/hero-galaxy.json

**Files:**
- Create: `data/hero-galaxy.json`

- [ ] **Step 1: Write the data file**

Create `data/hero-galaxy.json`:
```json
{
  "updated": "2026-06-03",
  "schema_version": 1,
  "systems": [
    {
      "id": "graphics",
      "name": "Graphics & shading",
      "accent": "#ff4b1f",
      "galaxyPosition": [-30, 4, -8],
      "sunShader": "sun.wgsl",
      "sunTint": [1.0, 0.55, 0.25],
      "sunRadius": 2.2,
      "planets": [
        { "id": "webgpu-wgsl",      "name": "WebGPU + WGSL",      "shader": "planets/planet-webgpu-wgsl.wgsl", "size": 1.0, "orbit": {"radius": 6.0,  "period": 60, "phase": 0.0, "tilt": 8.0},  "ring": {"type": "particles", "count": 3500, "innerRadius": 1.4, "outerRadius": 2.1, "tilt": 18}, "moons": [
            { "projectId": "remain",         "size": 0.30, "orbit": {"radius": 1.8, "period": 12, "phase": 0.0, "tilt": 0.0} },
            { "projectId": "tech_particles", "size": 0.28, "orbit": {"radius": 2.4, "period": 18, "phase": 2.1, "tilt": 4.0} }
        ]},
        { "id": "gpgpu-compute",    "name": "GPGPU compute",       "shader": "planets/planet-gpgpu.wgsl",       "size": 0.85, "orbit": {"radius": 9.5,  "period": 90, "phase": 1.3, "tilt": -4.0}, "moons": [
            { "projectId": "qatar_360",      "size": 0.26, "orbit": {"radius": 1.6, "period": 14, "phase": 0.0, "tilt": 0.0} }
        ]},
        { "id": "raymarch-sdf",     "name": "Raymarching & SDF",  "shader": "planets/planet-raymarch.wgsl",    "size": 0.75, "orbit": {"radius": 12.5, "period": 110, "phase": 3.1, "tilt": 2.0},  "moons": [] },
        { "id": "procedural-worlds","name": "Procedural worlds",  "shader": "planets/planet-procedural.wgsl",  "size": 0.95, "orbit": {"radius": 16,   "period": 140, "phase": 4.5, "tilt": -6.0}, "ring": {"type": "disc", "innerRadius": 1.2, "outerRadius": 1.7, "tilt": 12}, "moons": [] },
        { "id": "retro-post",       "name": "Retro post-processing","shader": "planets/planet-retro.wgsl",     "size": 0.70, "orbit": {"radius": 19.5, "period": 180, "phase": 5.8, "tilt": 3.0},  "moons": [] }
      ]
    },
    {
      "id": "ml-ai",
      "name": "ML & AI",
      "accent": "#7ec4ff",
      "galaxyPosition": [25, -3, -5],
      "sunShader": "sun.wgsl",
      "sunTint": [0.55, 0.7, 1.0],
      "sunRadius": 2.0,
      "planets": [
        { "id": "agents",     "name": "Multi-agent orchestration", "shader": "planets/planet-agents.wgsl",   "size": 1.0,  "orbit": {"radius": 6.0,  "period": 70, "phase": 0.0, "tilt": 6.0},  "moons": [
            { "projectId": "aitrading",      "size": 0.32, "orbit": {"radius": 1.9, "period": 14, "phase": 0.0, "tilt": 0.0} }
        ]},
        { "id": "npc-ai",     "name": "Live NPCs",                "shader": "planets/planet-npc.wgsl",      "size": 0.9,  "orbit": {"radius": 10,   "period": 105, "phase": 1.5, "tilt": -3.0}, "ring": {"type": "particles", "count": 2800, "innerRadius": 1.3, "outerRadius": 1.9, "tilt": 14}, "moons": [
            { "projectId": "lifesim",        "size": 0.30, "orbit": {"radius": 1.8, "period": 16, "phase": 0.0, "tilt": 0.0} }
        ]},
        { "id": "diffusion",  "name": "Local diffusion stack",     "shader": "planets/planet-diffusion.wgsl", "size": 0.8,  "orbit": {"radius": 13,   "period": 130, "phase": 2.8, "tilt": 4.0},  "moons": [
            { "projectId": "imagegen",       "size": 0.26, "orbit": {"radius": 1.5, "period": 12, "phase": 0.0, "tilt": 0.0} }
        ]},
        { "id": "quant-ml",   "name": "Quantitative ML",           "shader": "planets/planet-quant.wgsl",     "size": 0.85, "orbit": {"radius": 16.5, "period": 160, "phase": 4.2, "tilt": -5.0}, "moons": [] }
      ]
    },
    {
      "id": "web-systems",
      "name": "Web, systems, tooling",
      "accent": "#9ee37d",
      "galaxyPosition": [5, 6, 22],
      "sunShader": "sun.wgsl",
      "sunTint": [0.7, 1.0, 0.65],
      "sunRadius": 2.1,
      "planets": [
        { "id": "fullstack",     "name": "Full-stack web",        "shader": "planets/planet-fullstack.wgsl",  "size": 1.0,  "orbit": {"radius": 6.0,  "period": 68, "phase": 0.0, "tilt": 7.0},  "moons": [
            { "projectId": "events_arena",   "size": 0.30, "orbit": {"radius": 1.8, "period": 13, "phase": 0.0, "tilt": 0.0} },
            { "projectId": "planning_manager","size": 0.28, "orbit": {"radius": 2.3, "period": 17, "phase": 2.0, "tilt": 3.0} },
            { "projectId": "site_avocat",    "size": 0.22, "orbit": {"radius": 2.8, "period": 22, "phase": 4.0, "tilt": -2.0} }
        ]},
        { "id": "automation",    "name": "Browser automation",     "shader": "planets/planet-automation.wgsl", "size": 0.9,  "orbit": {"radius": 10,   "period": 100, "phase": 1.4, "tilt": -4.0}, "ring": {"type": "particles", "count": 3000, "innerRadius": 1.3, "outerRadius": 1.9, "tilt": 16}, "moons": [
            { "projectId": "rms",            "size": 0.32, "orbit": {"radius": 1.8, "period": 14, "phase": 0.0, "tilt": 0.0} }
        ]},
        { "id": "tools",         "name": "Desktop & dev tools",    "shader": "planets/planet-tools.wgsl",      "size": 0.75, "orbit": {"radius": 13.5, "period": 130, "phase": 2.6, "tilt": 5.0},  "moons": [
            { "projectId": "wallpaper_shader","size": 0.26, "orbit": {"radius": 1.6, "period": 13, "phase": 0.0, "tilt": 0.0} }
        ]},
        { "id": "modding",       "name": "Engine modding",         "shader": "planets/planet-modding.wgsl",    "size": 0.8,  "orbit": {"radius": 17,   "period": 170, "phase": 4.0, "tilt": -7.0}, "moons": [
            { "projectId": "hytale_tower",   "size": 0.24, "orbit": {"radius": 1.5, "period": 11, "phase": 0.0, "tilt": 0.0} },
            { "projectId": "darktide_mods",  "size": 0.22, "orbit": {"radius": 2.0, "period": 15, "phase": 3.1, "tilt": 4.0} }
        ]}
      ]
    }
  ]
}
```

- [ ] **Step 2: Validate JSON parses + spot-check shape**

Run: `node -e "const d=require('./data/hero-galaxy.json'); console.log('systems', d.systems.length); for (const s of d.systems) console.log(' ',s.id,'planets',s.planets.length,'moons',s.planets.reduce((n,p)=>n+(p.moons?.length||0),0))"`
Expected:
```
systems 3
  graphics planets 5 moons 3
  ml-ai planets 4 moons 3
  web-systems planets 4 moons 7
```

- [ ] **Step 3: Commit**

```
git add data/hero-galaxy.json
git commit -m "Hero galaxy: scene data file — 3 systems, 13 planets, 13 moons"
```

---

### Task 4.2: Data loader + project cross-ref

**Files:**
- Create: `js/hero-galaxy/data-loader.js`

- [ ] **Step 1: Write the loader**

Create `js/hero-galaxy/data-loader.js`:
```js
// Loads data/hero-galaxy.json + cross-references projects.json so each moon
// carries the real project title and cover path. Validates required keys; an
// unresolved projectId logs a warning and the moon stays renderable with a
// placeholder name (still navigable, just less informative).

const GALAXY_URL = '/data/hero-galaxy.json';
const PROJECTS_URL = '/data/projects.json';

export async function loadGalaxyData() {
    const [galaxyRes, projectsRes] = await Promise.all([
        fetch(GALAXY_URL), fetch(PROJECTS_URL),
    ]);
    if (!galaxyRes.ok)  throw new Error(`galaxy json ${galaxyRes.status}`);
    if (!projectsRes.ok) throw new Error(`projects json ${projectsRes.status}`);
    const galaxy   = await galaxyRes.json();
    const projects = await projectsRes.json();
    if (!Array.isArray(galaxy.systems) || galaxy.systems.length === 0) {
        throw new Error('galaxy.systems is missing or empty');
    }
    const byId = new Map(projects.projects.map(p => [p.id, p]));

    // Resolve every moon's projectId → carry title + cover into the moon node.
    for (const sys of galaxy.systems) {
        for (const planet of sys.planets) {
            for (const moon of planet.moons || []) {
                const proj = byId.get(moon.projectId);
                if (proj) {
                    moon.title = proj.title;
                    moon.cover = proj.cover;
                } else {
                    console.warn('[hero-galaxy] unresolved projectId:', moon.projectId);
                    moon.title = moon.projectId;
                    moon.cover = null;
                }
            }
        }
    }
    return galaxy;
}

// Hex like "#ff4b1f" → [r, g, b, a] in [0,1]
export function parseAccent(hex, a = 1) {
    const m = hex.replace('#', '');
    return [
        parseInt(m.substr(0, 2), 16) / 255,
        parseInt(m.substr(2, 2), 16) / 255,
        parseInt(m.substr(4, 2), 16) / 255,
        a,
    ];
}
```

- [ ] **Step 2: Smoke-test the loader**

In DevTools console:
```
const m = await import('/js/hero-galaxy/data-loader.js');
const g = await m.loadGalaxyData();
console.log('systems', g.systems.length, 'first sun:', g.systems[0].name);
console.log('first moon:', g.systems[0].planets[0].moons[0]);
```
Expected: 3 systems; first moon should have a `title` (e.g., "Remain") populated.

- [ ] **Step 3: Commit**

```
git add js/hero-galaxy/data-loader.js
git commit -m "Hero galaxy: data loader + project cross-ref"
```

---

### Task 4.3: Sun shader

**Files:**
- Create: `js/hero-galaxy/shaders/sun.wgsl`

- [ ] **Step 1: Write the sun surface shader**

Create `js/hero-galaxy/shaders/sun.wgsl`:
```wgsl
// Per-system tinted sun. Accent comes from sunTint in JSON. Bright corona via
// fresnel + a slow internal noise churn for "alive star" feel.

struct Surface {
    world_pos    : vec3<f32>,
    world_normal : vec3<f32>,
    uv_sphere    : vec2<f32>,
    view_dir     : vec3<f32>,
    time         : f32,
    accent       : vec3<f32>,
    hover_t      : f32,
};

fn surface(s: Surface) -> vec4<f32> {
    let churn = fbm3(s.world_pos * 2.5 + vec3<f32>(0.0, s.time * 0.07, 0.0), 4);
    let hot   = s.accent * (1.2 + churn * 0.8);
    let corona = pow(1.0 - max(0.0, dot(s.view_dir, s.world_normal)), 2.0);
    return vec4<f32>(hot + s.accent * corona * 1.5, 1.0);
}
```

- [ ] **Step 2: Verify fetchable**

Visit `http://localhost:8000/js/hero-galaxy/shaders/sun.wgsl` → 200.

- [ ] **Step 3: Commit**

```
git add js/hero-galaxy/shaders/sun.wgsl
git commit -m "Hero galaxy: per-system tinted sun shader"
```

---

### Task 4.4: Bodies factory + render N spheres from data

**Files:**
- Create: `js/hero-galaxy/bodies.js`
- Modify: `js/hero-galaxy/scene.js`

- [ ] **Step 1: Write bodies factory**

Create `js/hero-galaxy/bodies.js`:
```js
// Per-body GPU state: one uniform buffer + bind group per body. Bodies are
// allocated up-front from the scene data; their model matrices are mutated
// per-frame by the scene state machine.

import { parseAccent } from './data-loader.js';

export function createBody(device, bodyBGL, opts) {
    const buf = device.createBuffer({
        label: opts.label || 'body uniform',
        size: 128,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bg = device.createBindGroup({
        layout: bodyBGL,
        entries: [{ binding: 0, resource: { buffer: buf } }],
    });
    return {
        kind: opts.kind,                  // 'sun' | 'planet' | 'moon'
        id: opts.id,
        shaderPath: opts.shaderPath,      // e.g. 'sun.wgsl' or 'planets/planet-x.wgsl'
        accent: opts.accent,              // Float32Array(4)
        worldPos: new Float32Array(3),    // current world-space centre
        radiusWorld: opts.radiusWorld || 1.0,
        scale: opts.scale || 1.0,
        hoverT: 0.0,
        buf, bg,
        // The parent/orbit metadata lives here for the scene to read each frame.
        parent: opts.parent || null,
        orbit:  opts.orbit  || null,
        meta:   opts.meta   || {},        // free-form, e.g. { systemId, planetId }
    };
}

export function writeBodyUbo(device, body, model16, time) {
    const arr = new Float32Array(32);
    arr.set(model16, 0);
    arr.set(body.accent, 16);
    arr[20] = time;
    arr[21] = body.radiusWorld;
    arr[22] = 0; // body_id (used later for selection)
    arr[23] = body.hoverT;
    device.queue.writeBuffer(body.buf, 0, arr);
}

// Convenience: turn a JSON system or planet into a body description.
export function bodyDescFromSun(sys) {
    return {
        kind: 'sun',
        id: sys.id,
        shaderPath: sys.sunShader || 'sun.wgsl',
        accent: new Float32Array(parseAccent(sys.accent || '#ffffff')),
        radiusWorld: sys.sunRadius || 2.0,
        scale: sys.sunRadius || 2.0,
        meta: { systemId: sys.id, sunTint: sys.sunTint || [1, 1, 1] },
    };
}

export function bodyDescFromPlanet(planet, sys) {
    return {
        kind: 'planet',
        id: planet.id,
        shaderPath: planet.shader || 'default-planet.wgsl',
        accent: new Float32Array(parseAccent(sys.accent || '#ffffff')),
        radiusWorld: planet.size || 1.0,
        scale: planet.size || 1.0,
        orbit: planet.orbit,
        meta: { systemId: sys.id, planetId: planet.id, ring: planet.ring },
    };
}

export function bodyDescFromMoon(moon, planet, sys) {
    return {
        kind: 'moon',
        id: moon.projectId,
        shaderPath: 'default-moon.wgsl',
        accent: new Float32Array(parseAccent(sys.accent || '#ffffff')),
        radiusWorld: moon.size || 0.25,
        scale: moon.size || 0.25,
        orbit: moon.orbit,
        meta: { systemId: sys.id, planetId: planet.id, projectId: moon.projectId, title: moon.title },
    };
}
```

- [ ] **Step 2: Create the default moon shader**

Create `js/hero-galaxy/shaders/default-moon.wgsl`:
```wgsl
// Small moon — lambertian shading with a slight emissive tint.

struct Surface {
    world_pos    : vec3<f32>,
    world_normal : vec3<f32>,
    uv_sphere    : vec2<f32>,
    view_dir     : vec3<f32>,
    time         : f32,
    accent       : vec3<f32>,
    hover_t      : f32,
};

fn surface(s: Surface) -> vec4<f32> {
    let ndl = clamp(dot(s.world_normal, normalize(vec3<f32>(0.3, 0.7, 0.4))), 0.0, 1.0);
    let base = vec3<f32>(0.35, 0.32, 0.30) * (0.3 + 0.7 * ndl);
    let glow = s.accent * 0.15 + s.accent * s.hover_t * 0.6;
    return vec4<f32>(base + glow, 1.0);
}
```

- [ ] **Step 3: Update scene.js to render 3 suns from the data**

Overwrite `js/hero-galaxy/scene.js`:
```js
// Phase 4: render the 3 suns at their galaxy positions, each with sun.wgsl.

import { createCamera, setAspect } from './render/camera.js';
import { makeIcosphere } from './render/sphere-mesh.js';
import { getMeshPipeline } from './render/pipeline.js';
import { loadGalaxyData } from './data-loader.js';
import { createBody, writeBodyUbo, bodyDescFromSun } from './bodies.js';
import { mat4Identity } from '../particles/core/math.js';

const CLEAR_COLOR = { r: 0.004, g: 0.004, b: 0.004, a: 1.0 };

export async function mountScene({ section }) {
    const canvas = section.querySelector('#galaxy-canvas');
    if (!canvas) throw new Error('no #galaxy-canvas');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function resizeBacking() {
        const w = Math.floor(canvas.clientWidth  * dpr);
        const h = Math.floor(canvas.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; return true; }
        return false;
    }
    resizeBacking();

    const galaxy = await loadGalaxyData();

    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const camera = createCamera();
    setAspect(camera, canvas.width / canvas.height);
    camera.distance = 80;
    camera.target.set([0, 0, 0]);

    const ico = makeIcosphere(5);
    const vbuf = device.createBuffer({ size: ico.vertexData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(vbuf, 0, ico.vertexData);
    const ibuf = device.createBuffer({ size: ico.indexData.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ibuf, 0, ico.indexData);

    let depthTex = null;
    function ensureDepth() {
        if (depthTex && depthTex.width === canvas.width && depthTex.height === canvas.height) return;
        depthTex?.destroy();
        depthTex = device.createTexture({
            size: [canvas.width, canvas.height, 1],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }
    ensureDepth();

    const camUbo = device.createBuffer({ size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // Build one pipeline + bodyBGL by warming the default-planet pipeline first.
    const { pipeline: defaultPipeline, cameraBGL, bodyBGL } =
        await getMeshPipeline(device, format, 'default-planet.wgsl');
    const cameraBG = device.createBindGroup({
        layout: cameraBGL,
        entries: [{ binding: 0, resource: { buffer: camUbo } }],
    });

    // Sun pipeline (one shared for all three suns; per-sun tint via accent uniform)
    const { pipeline: sunPipeline } = await getMeshPipeline(device, format, 'sun.wgsl');

    // Build sun bodies from data
    const suns = [];
    for (const sys of galaxy.systems) {
        const body = createBody(device, bodyBGL, {
            ...bodyDescFromSun(sys),
            label: `sun ${sys.id}`,
        });
        // Apply sunTint as accent so the sun colour is per-system.
        body.accent[0] = sys.sunTint[0];
        body.accent[1] = sys.sunTint[1];
        body.accent[2] = sys.sunTint[2];
        body.accent[3] = 1.0;
        body.worldPos[0] = sys.galaxyPosition[0];
        body.worldPos[1] = sys.galaxyPosition[1];
        body.worldPos[2] = sys.galaxyPosition[2];
        suns.push(body);
    }

    function frame(now) {
        if (resizeBacking()) { setAspect(camera, canvas.width / canvas.height); ensureDepth(); }
        const t = now * 0.001;

        // Camera UBO
        const camArr = new Float32Array(48);
        camArr.set(camera.view, 0);
        camArr.set(camera.proj, 16);
        camArr.set([camera.eye[0], camera.eye[1], camera.eye[2], 0], 32);
        device.queue.writeBuffer(camUbo, 0, camArr);

        // Per-sun model matrix: translate to galaxy position, scale by radius.
        for (const s of suns) {
            const M = new Float32Array(16);
            mat4Identity(M);
            const sc = s.scale;
            M[0] = sc; M[5] = sc; M[10] = sc;
            M[12] = s.worldPos[0]; M[13] = s.worldPos[1]; M[14] = s.worldPos[2];
            writeBodyUbo(device, s, M, t);
        }

        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: CLEAR_COLOR,
                loadOp: 'clear', storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: depthTex.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear', depthStoreOp: 'store',
            },
        });
        pass.setPipeline(sunPipeline);
        pass.setBindGroup(0, cameraBG);
        pass.setVertexBuffer(0, vbuf);
        pass.setIndexBuffer(ibuf, ico.indexFormat);
        for (const s of suns) {
            pass.setBindGroup(1, s.bg);
            pass.drawIndexed(ico.indexCount);
        }
        pass.end();
        device.queue.submit([enc.finish()]);

        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return { device, context, format, camera, canvas, galaxy, suns };
}
```

- [ ] **Step 2: Reload + verify**

Reload `http://localhost:8000/`. Expected: three coloured glowing spheres visible at different positions in the canvas — vermilion (Graphics), cool blue (ML), green (Web-systems). No errors.

- [ ] **Step 3: Commit**

```
git add js/hero-galaxy/bodies.js js/hero-galaxy/shaders/default-moon.wgsl js/hero-galaxy/scene.js
git commit -m "Hero galaxy: 3 suns rendered from data with per-system tints"
```

---

### ✅ Gate 4: 3 suns visible at JSON positions with per-system colour. STOP and verify before Phase 5.

---

## Phase 5 — Orbit + zoom camera controls

Gate: dragging on the canvas orbits around the galactic centre; scroll-wheel zooms in/out. Pitch is clamped. Inertia after release.

### Task 5.1: Mouse drag → camera orbit

**Files:**
- Create: `js/hero-galaxy/render/controls.js`
- Modify: `js/hero-galaxy/scene.js`

- [ ] **Step 1: Write controls.js**

Create `js/hero-galaxy/render/controls.js`:
```js
// DOM event wiring → camera state. Owns the per-state zoom clamps and
// inertia. Touch is handled symmetrically to mouse (one-finger drag = orbit,
// pinch = zoom).

import { applyOrbitDelta, applyZoomDelta } from './camera.js';

export function wireControls({ canvas, camera, getState }) {
    let dragging = false;
    let lastX = 0, lastY = 0;
    let velYaw = 0, velPitch = 0;

    function clampForState() {
        const s = getState();
        switch (s) {
            case 'galaxy':  return { min: 25,  max: 140 };
            case 'system':  return { min: 6,   max: 35  };
            case 'planet':  return { min: 1.5, max: 8   };
            default:        return { min: 1,   max: 200 };
        }
    }

    function onPointerDown(e) {
        if (e.button !== undefined && e.button !== 0 && e.button !== 1) return;
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        velYaw = 0; velPitch = 0;
        canvas.setPointerCapture?.(e.pointerId ?? 1);
    }
    function onPointerMove(e) {
        if (!dragging) return;
        const dx = e.clientX - lastX, dy = e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        const yaw = -dx * 0.005;
        const pit = -dy * 0.005;
        applyOrbitDelta(camera, yaw, pit);
        velYaw = yaw * 0.5; velPitch = pit * 0.5;
    }
    function onPointerUp(e) {
        dragging = false;
        canvas.releasePointerCapture?.(e.pointerId ?? 1);
    }
    function onWheel(e) {
        e.preventDefault();
        const factor = Math.pow(1.0015, e.deltaY);
        const { min, max } = clampForState();
        applyZoomDelta(camera, factor, min, max);
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup',   onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // Inertia tick — called once per frame from the main loop.
    function tickInertia(dt) {
        if (dragging) return;
        if (Math.abs(velYaw) < 1e-5 && Math.abs(velPitch) < 1e-5) return;
        applyOrbitDelta(camera, velYaw, velPitch);
        const decay = Math.exp(-3.0 * dt);
        velYaw *= decay; velPitch *= decay;
    }

    return { tickInertia };
}
```

- [ ] **Step 2: Wire controls into scene.js**

In `js/hero-galaxy/scene.js`, add the import at top:
```js
import { wireControls } from './render/controls.js';
```

In the body of `mountScene`, immediately after `camera.distance = 80; camera.target.set([0, 0, 0]);`, add:
```js
const controls = wireControls({ canvas, camera, getState: () => 'galaxy' });
```

Inside the `frame(now)` function, near the top after computing `const t`, compute `dt` and tick inertia:
```js
const lastNow = frame._lastNow ?? now;
const dt = Math.min(0.05, (now - lastNow) / 1000);
frame._lastNow = now;
controls.tickInertia(dt);
```

- [ ] **Step 3: Reload + verify**

Reload `http://localhost:8000/`. Drag on the canvas: the three suns should sweep around. Scroll wheel: zoom in/out. Release after a drag: gentle decay continues briefly.

- [ ] **Step 4: Commit**

```
git add js/hero-galaxy/render/controls.js js/hero-galaxy/scene.js
git commit -m "Hero galaxy: orbit + zoom controls with inertia"
```

---

### ✅ Gate 5: Drag orbits, scroll zooms, inertia decays. STOP and verify before Phase 6.

---

## Phase 6 — Scene state machine + per-state visibility + planet/moon bodies

Gate: a programmatic state switch (e.g., `window.HERO_GALAXY.gotoSystem('graphics')`) hides the other two suns, shows the Graphics sun's planets orbiting it. Same for `gotoPlanet` showing moons.

### Task 6.1: Allocate planet + moon bodies up front

**Files:**
- Modify: `js/hero-galaxy/scene.js`

- [ ] **Step 1: After the sun loop, allocate planet + moon bodies**

In `js/hero-galaxy/scene.js`, after the existing `for (const sys of galaxy.systems) { ... suns.push(body); }` loop, add:
```js
import { bodyDescFromPlanet, bodyDescFromMoon } from './bodies.js';
```
*(Add to the existing bodies.js import line.)*

After the suns loop in `mountScene`:
```js
    const planets = []; // [{ body, sun }]
    const moons   = []; // [{ body, planet }]
    for (const sys of galaxy.systems) {
        const sun = suns.find(s => s.id === sys.id);
        for (const p of sys.planets) {
            const planetBody = createBody(device, bodyBGL, {
                ...bodyDescFromPlanet(p, sys), label: `planet ${p.id}`,
            });
            planets.push({ body: planetBody, sun });
            for (const m of p.moons || []) {
                const moonBody = createBody(device, bodyBGL, {
                    ...bodyDescFromMoon(m, p, sys), label: `moon ${m.projectId}`,
                });
                moons.push({ body: moonBody, planet: planetBody });
            }
        }
    }
```

- [ ] **Step 2: Reload + verify no errors**

Reload `/`. No errors expected. Page looks identical (planets aren't being drawn yet).

- [ ] **Step 3: Commit**

```
git add js/hero-galaxy/scene.js
git commit -m "Hero galaxy: allocate planet + moon bodies at boot"
```

---

### Task 6.2: State machine + per-state visibility

**Files:**
- Modify: `js/hero-galaxy/scene.js`

- [ ] **Step 1: Add state machine + render-list logic**

Near the top of `mountScene` (after `camera.distance = 80`), add:
```js
    // State machine
    const state = {
        level: 'galaxy',          // 'galaxy' | 'system' | 'planet'
        focusedSystemId: null,
        focusedPlanetId: null,
    };

    function visibleSuns()    { return suns; }                     // always
    function visiblePlanets() {
        if (state.level === 'galaxy') return [];
        return planets.filter(p => p.body.meta.systemId === state.focusedSystemId);
    }
    function visibleMoons() {
        if (state.level !== 'planet') return [];
        return moons.filter(m => m.body.meta.planetId === state.focusedPlanetId);
    }

    // Per-state camera targets and distances
    function applyStateCamera() {
        if (state.level === 'galaxy') {
            camera.target.set([0, 0, 0]);
            camera.distance = 80;
        } else if (state.level === 'system') {
            const sun = suns.find(s => s.id === state.focusedSystemId);
            camera.target.set(sun.worldPos);
            camera.distance = 18;
        } else if (state.level === 'planet') {
            const planet = planets.find(p => p.body.id === state.focusedPlanetId)?.body;
            if (planet) {
                camera.target.set(planet.worldPos);
                camera.distance = 3.5;
            }
        }
        // Force-recompute by nudging
        applyOrbitDelta(camera, 0, 0);
    }
```

(Add `applyOrbitDelta` to the existing camera import: `import { createCamera, setAspect, applyOrbitDelta } from './render/camera.js';`)

- [ ] **Step 2: Make `getState` reflect real state in controls**

Change the existing `const controls = wireControls({ canvas, camera, getState: () => 'galaxy' });` to:
```js
const controls = wireControls({ canvas, camera, getState: () => state.level });
```

- [ ] **Step 3: Compute planet world position each frame**

In `frame(now)`, after the camera UBO write, add:
```js
        // Update planet world positions (around their sun) and moon world positions (around their planet).
        for (const { body, sun } of planets) {
            const o = body.orbit; if (!o) continue;
            const a = (t * (2 * Math.PI / o.period)) + (o.phase || 0);
            const tilt = (o.tilt || 0) * Math.PI / 180;
            body.worldPos[0] = sun.worldPos[0] + Math.cos(a) * o.radius;
            body.worldPos[1] = sun.worldPos[1] + Math.sin(tilt) * o.radius * 0.15;
            body.worldPos[2] = sun.worldPos[2] + Math.sin(a) * o.radius * Math.cos(tilt);
        }
        for (const { body, planet } of moons) {
            const o = body.orbit; if (!o) continue;
            const a = (t * (2 * Math.PI / o.period)) + (o.phase || 0);
            const tilt = (o.tilt || 0) * Math.PI / 180;
            body.worldPos[0] = planet.worldPos[0] + Math.cos(a) * o.radius;
            body.worldPos[1] = planet.worldPos[1] + Math.sin(tilt) * o.radius * 0.2;
            body.worldPos[2] = planet.worldPos[2] + Math.sin(a) * o.radius * Math.cos(tilt);
        }
```

- [ ] **Step 4: Render visible planets + moons via the default-planet pipeline**

Inside `frame(now)`, after the sun rendering loop, add (still inside the pass):
```js
        // Render planets
        const pls = visiblePlanets();
        if (pls.length) {
            pass.setPipeline(defaultPipeline);
            for (const { body } of pls) {
                const M = new Float32Array(16);
                mat4Identity(M);
                const sc = body.scale;
                M[0] = sc; M[5] = sc; M[10] = sc;
                M[12] = body.worldPos[0]; M[13] = body.worldPos[1]; M[14] = body.worldPos[2];
                writeBodyUbo(device, body, M, t);
                pass.setBindGroup(1, body.bg);
                pass.drawIndexed(ico.indexCount);
            }
        }
        // Render moons
        const ms = visibleMoons();
        if (ms.length) {
            for (const { body } of ms) {
                const M = new Float32Array(16);
                mat4Identity(M);
                const sc = body.scale;
                M[0] = sc; M[5] = sc; M[10] = sc;
                M[12] = body.worldPos[0]; M[13] = body.worldPos[1]; M[14] = body.worldPos[2];
                writeBodyUbo(device, body, M, t);
                pass.setBindGroup(1, body.bg);
                pass.drawIndexed(ico.indexCount);
            }
        }
```

- [ ] **Step 5: Expose state-switch API on window**

At the bottom of `mountScene`, before the `return`, add:
```js
    window.HERO_GALAXY = {
        gotoGalaxy() { state.level = 'galaxy'; state.focusedSystemId = null; state.focusedPlanetId = null; applyStateCamera(); },
        gotoSystem(systemId) {
            const sys = galaxy.systems.find(s => s.id === systemId);
            if (!sys) return console.warn('no system', systemId);
            state.level = 'system'; state.focusedSystemId = systemId; state.focusedPlanetId = null;
            applyStateCamera();
        },
        gotoPlanet(planetId) {
            const pl = planets.find(p => p.body.id === planetId);
            if (!pl) return console.warn('no planet', planetId);
            state.level = 'planet'; state.focusedSystemId = pl.body.meta.systemId; state.focusedPlanetId = planetId;
            applyStateCamera();
        },
        state, suns, planets, moons,
    };
```

- [ ] **Step 6: Reload + test the API**

In DevTools console:
```
HERO_GALAXY.gotoSystem('graphics')
```
Expected: camera dollies in to the Graphics sun's position, the other two suns become distant points, Graphics's 5 planets appear orbiting the sun.

```
HERO_GALAXY.gotoPlanet('webgpu-wgsl')
```
Expected: camera focuses on the WebGPU planet, its 2 moons appear orbiting.

```
HERO_GALAXY.gotoGalaxy()
```
Expected: back to all three suns visible.

- [ ] **Step 7: Commit**

```
git add js/hero-galaxy/scene.js
git commit -m "Hero galaxy: state machine + per-state body visibility + window.HERO_GALAXY API"
```

---

### ✅ Gate 6: State switches work programmatically. STOP and verify before Phase 7.

---

## Phase 7 — Hit testing + click navigation + Bezier transitions

Gate: clicking a sun flies the camera into that system with a smooth Bezier transition; clicking a planet flies into the planet; clicking empty space or pressing Escape zooms out one level.

### Task 7.1: Ray-vs-sphere raycast

**Files:**
- Create: `js/hero-galaxy/render/raycast.js`

- [ ] **Step 1: Write the raycast helpers**

Create `js/hero-galaxy/render/raycast.js`:
```js
// Pick a screen pixel → world-space ray (eye, dir). Hit-test against a list
// of {worldPos, radiusWorld, ref}. Closest hit wins.

import { mat4Multiply } from '../../particles/core/math.js';

export function screenToRay(camera, ndcX, ndcY) {
    // Inverse VP; nearest plane point at ndc.z = 0 (note WebGPU NDC z in [0,1] near=0).
    const vp = new Float32Array(16);
    mat4Multiply(camera.proj, camera.view, vp);
    const inv = invert4(vp);
    if (!inv) return null;
    const n = transformPoint(inv, ndcX, ndcY, 0.0);
    const f = transformPoint(inv, ndcX, ndcY, 1.0);
    const dir = [f[0] - n[0], f[1] - n[1], f[2] - n[2]];
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    return { eye: [camera.eye[0], camera.eye[1], camera.eye[2]], dir: [dir[0]/l, dir[1]/l, dir[2]/l] };
}

export function hitSphere(ray, center, radius) {
    const ox = ray.eye[0] - center[0], oy = ray.eye[1] - center[1], oz = ray.eye[2] - center[2];
    const b = ox * ray.dir[0] + oy * ray.dir[1] + oz * ray.dir[2];
    const c = ox*ox + oy*oy + oz*oz - radius*radius;
    const disc = b*b - c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    const t1 = -b - sq;
    if (t1 > 0) return t1;
    const t2 = -b + sq;
    return t2 > 0 ? t2 : -1;
}

export function hitTestBodies(ray, bodies) {
    let bestT = Infinity, best = null;
    for (const b of bodies) {
        const t = hitSphere(ray, b.worldPos, b.radiusWorld * b.scale);
        if (t > 0 && t < bestT) { bestT = t; best = b; }
    }
    return best ? { body: best, t: bestT } : null;
}

// 4×4 matrix inverse — Gauss-Jordan
function invert4(m) {
    const out = new Float32Array(16);
    const a00 = m[0],  a01 = m[1],  a02 = m[2],  a03 = m[3];
    const a10 = m[4],  a11 = m[5],  a12 = m[6],  a13 = m[7];
    const a20 = m[8],  a21 = m[9],  a22 = m[10], a23 = m[11];
    const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00*a11 - a01*a10, b01 = a00*a12 - a02*a10, b02 = a00*a13 - a03*a10;
    const b03 = a01*a12 - a02*a11, b04 = a01*a13 - a03*a11, b05 = a02*a13 - a03*a12;
    const b06 = a20*a31 - a21*a30, b07 = a20*a32 - a22*a30, b08 = a20*a33 - a23*a30;
    const b09 = a21*a32 - a22*a31, b10 = a21*a33 - a23*a31, b11 = a22*a33 - a23*a32;
    const det = b00*b11 - b01*b10 + b02*b09 + b03*b08 - b04*b07 + b05*b06;
    if (!det) return null;
    const id = 1 / det;
    out[0]  = ( a11*b11 - a12*b10 + a13*b09) * id;
    out[1]  = (-a01*b11 + a02*b10 - a03*b09) * id;
    out[2]  = ( a31*b05 - a32*b04 + a33*b03) * id;
    out[3]  = (-a21*b05 + a22*b04 - a23*b03) * id;
    out[4]  = (-a10*b11 + a12*b08 - a13*b07) * id;
    out[5]  = ( a00*b11 - a02*b08 + a03*b07) * id;
    out[6]  = (-a30*b05 + a32*b02 - a33*b01) * id;
    out[7]  = ( a20*b05 - a22*b02 + a23*b01) * id;
    out[8]  = ( a10*b10 - a11*b08 + a13*b06) * id;
    out[9]  = (-a00*b10 + a01*b08 - a03*b06) * id;
    out[10] = ( a30*b04 - a31*b02 + a33*b00) * id;
    out[11] = (-a20*b04 + a21*b02 - a23*b00) * id;
    out[12] = (-a10*b09 + a11*b07 - a12*b06) * id;
    out[13] = ( a00*b09 - a01*b07 + a02*b06) * id;
    out[14] = (-a30*b03 + a31*b01 - a32*b00) * id;
    out[15] = ( a20*b03 - a21*b01 + a22*b00) * id;
    return out;
}

function transformPoint(m, x, y, z) {
    const w = m[3]*x + m[7]*y + m[11]*z + m[15];
    const iw = w === 0 ? 1 : 1 / w;
    return [
        (m[0]*x + m[4]*y + m[8]*z + m[12]) * iw,
        (m[1]*x + m[5]*y + m[9]*z + m[13]) * iw,
        (m[2]*x + m[6]*y + m[10]*z + m[14]) * iw,
    ];
}
```

- [ ] **Step 2: Smoke-test in DevTools**

```
const r = await import('/js/hero-galaxy/render/raycast.js');
const ray = { eye: [0,0,5], dir: [0,0,-1] };
console.log('hit', r.hitSphere(ray, [0,0,0], 1));   // expect ≈ 4
console.log('miss', r.hitSphere(ray, [3,0,0], 1));   // expect -1
```

- [ ] **Step 3: Commit**

```
git add js/hero-galaxy/render/raycast.js
git commit -m "Hero galaxy: ray-vs-sphere raycast helpers"
```

---

### Task 7.2: Hover + click hit testing + body highlight tween

**Files:**
- Modify: `js/hero-galaxy/scene.js`

- [ ] **Step 1: Add hover tracking + click dispatch**

In `scene.js`, add the raycast import at top:
```js
import { screenToRay, hitTestBodies } from './render/raycast.js';
```

After the `wireControls` call, add:
```js
    // Hit-test state
    let cursorNdc = null;  // {x, y} in NDC each frame; null = off-canvas
    let hovered = null;     // body | null

    canvas.addEventListener('pointermove', (e) => {
        const r = canvas.getBoundingClientRect();
        cursorNdc = {
            x: ((e.clientX - r.left) / r.width)  * 2 - 1,
            y: -((e.clientY - r.top)  / r.height) * 2 + 1,
        };
    });
    canvas.addEventListener('pointerleave', () => { cursorNdc = null; });

    canvas.addEventListener('click', (e) => {
        const r = canvas.getBoundingClientRect();
        const ndc = {
            x: ((e.clientX - r.left) / r.width)  * 2 - 1,
            y: -((e.clientY - r.top)  / r.height) * 2 + 1,
        };
        const ray = screenToRay(camera, ndc.x, ndc.y);
        if (!ray) return;
        const targets = currentSelectionTargets();
        const hit = hitTestBodies(ray, targets);
        if (hit) {
            handleBodyClick(hit.body);
        } else {
            handleEmptyClick();
        }
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') handleEmptyClick();
    });

    function currentSelectionTargets() {
        // Sun is selectable in galaxy state; planets in system state; moons in planet state.
        if (state.level === 'galaxy') return suns;
        if (state.level === 'system') return visiblePlanets().map(p => p.body);
        if (state.level === 'planet') return visibleMoons().map(m => m.body);
        return [];
    }

    function handleBodyClick(body) {
        if (body.kind === 'sun')    transitionTo({ level: 'system', focusedSystemId: body.id });
        else if (body.kind === 'planet') transitionTo({ level: 'planet', focusedSystemId: body.meta.systemId, focusedPlanetId: body.id });
        else if (body.kind === 'moon') {
            const projectId = body.meta.projectId;
            const anchorEl = section;
            if (typeof window.openModal === 'function') window.openModal(projectId, anchorEl);
        }
    }

    function handleEmptyClick() {
        if (state.level === 'planet')      transitionTo({ level: 'system', focusedSystemId: state.focusedSystemId });
        else if (state.level === 'system') transitionTo({ level: 'galaxy' });
    }
```

`transitionTo` will be defined in Task 7.3.

- [ ] **Step 2: Hover tween each frame**

Inside `frame(now)`, after the per-body world position computation, add:
```js
        // Hover detection (cheap each frame; pool of bodies is small)
        let newHovered = null;
        if (cursorNdc) {
            const ray = screenToRay(camera, cursorNdc.x, cursorNdc.y);
            const targets = currentSelectionTargets();
            const hit = hitTestBodies(ray, targets);
            if (hit) newHovered = hit.body;
        }
        hovered = newHovered;
        // Ease hover_t per body
        const allBodies = suns.concat(planets.map(p => p.body), moons.map(m => m.body));
        for (const b of allBodies) {
            const target = (b === hovered) ? 1.0 : 0.0;
            b.hoverT += (target - b.hoverT) * Math.min(1, dt * 8);
        }
```

- [ ] **Step 3: Reload + verify (skip transition for now)**

Reload `/`. Hover over a sun — the rim should pulse subtly (sun's accent brightens slightly). Click a sun — currently throws because `transitionTo` is undefined; we'll fix in the next task.

- [ ] **Step 4: Commit (intermediate, broken click is OK; documented in next task)**

```
git add js/hero-galaxy/scene.js
git commit -m "Hero galaxy: hover detection + hover_t tween + click hit-test"
```

---

### Task 7.3: Bezier-eased camera transitions

**Files:**
- Modify: `js/hero-galaxy/scene.js`

- [ ] **Step 1: Add the transition system**

In `scene.js`, after `applyStateCamera`, add:
```js
    // Bezier-eased camera transition. Holds (yaw, pitch, distance, target).
    let transition = null;
    function transitionTo(goal) {
        // Snapshot start state
        const start = {
            yaw: camera.yaw, pitch: camera.pitch, distance: camera.distance,
            target: [camera.target[0], camera.target[1], camera.target[2]],
        };
        // Compute end-state target + distance
        let endTarget = [0, 0, 0], endDist = 80;
        if (goal.level === 'system') {
            const sun = suns.find(s => s.id === goal.focusedSystemId);
            if (sun) { endTarget = [sun.worldPos[0], sun.worldPos[1], sun.worldPos[2]]; endDist = 18; }
        } else if (goal.level === 'planet') {
            const planetEntry = planets.find(p => p.body.id === goal.focusedPlanetId);
            if (planetEntry) {
                const body = planetEntry.body;
                endTarget = [body.worldPos[0], body.worldPos[1], body.worldPos[2]];
                endDist = 3.5;
            }
        }
        // Tween length depends on state delta magnitude
        const fromLevel = state.level, toLevel = goal.level;
        const ms = (fromLevel === 'galaxy' || toLevel === 'galaxy') ? 1200 : 900;
        transition = {
            start, end: { yaw: camera.yaw, pitch: camera.pitch, distance: endDist, target: endTarget },
            t0: performance.now(), ms, goal,
        };
    }
    function tickTransition(now) {
        if (!transition) return;
        const u = Math.min(1, (now - transition.t0) / transition.ms);
        const e = cubicBezier(u, 0.4, 0, 0.2, 1);
        const { start, end } = transition;
        camera.target[0] = start.target[0] + (end.target[0] - start.target[0]) * e;
        camera.target[1] = start.target[1] + (end.target[1] - start.target[1]) * e;
        camera.target[2] = start.target[2] + (end.target[2] - start.target[2]) * e;
        camera.distance = start.distance + (end.distance - start.distance) * e;
        applyOrbitDelta(camera, 0, 0);  // recompute view
        if (u >= 1) {
            // Lock in the new state
            state.level = transition.goal.level;
            state.focusedSystemId = transition.goal.focusedSystemId ?? null;
            state.focusedPlanetId = transition.goal.focusedPlanetId ?? null;
            transition = null;
        }
    }
    function cubicBezier(t, p1x, p1y, p2x, p2y) {
        // Standard CSS cubic-bezier — approximate via Newton
        const cx = 3 * p1x, bx = 3 * (p2x - p1x) - cx, ax = 1 - cx - bx;
        const cy = 3 * p1y, by = 3 * (p2y - p1y) - cy, ay = 1 - cy - by;
        function sampleCurveX(u) { return ((ax * u + bx) * u + cx) * u; }
        function sampleCurveY(u) { return ((ay * u + by) * u + cy) * u; }
        function sampleCurveDerivX(u) { return (3 * ax * u + 2 * bx) * u + cx; }
        let u = t;
        for (let i = 0; i < 8; i++) {
            const x = sampleCurveX(u) - t;
            const d = sampleCurveDerivX(u);
            if (Math.abs(x) < 1e-4) break;
            if (Math.abs(d) < 1e-6) break;
            u -= x / d;
        }
        return sampleCurveY(u);
    }
```

- [ ] **Step 2: Call tickTransition in the frame loop**

Inside `frame(now)`, immediately after `controls.tickInertia(dt);`, add:
```js
        tickTransition(now);
```

- [ ] **Step 3: Reload + verify**

Reload `/`. Click any sun → smooth 1.2s fly-in to that system. Click any planet → 0.9s fly-in to the planet. Click empty space → zoom out. ESC also zooms out.

- [ ] **Step 4: Commit**

```
git add js/hero-galaxy/scene.js
git commit -m "Hero galaxy: Bezier camera transitions between states"
```

---

### ✅ Gate 7: Full click navigation works galaxy ↔ system ↔ planet, with ESC + empty-click zoom out. STOP and verify before Phase 8.

---

## Phase 8 — Breadcrumb UI

Gate: top-left breadcrumb tracks the current state (`GALAXY` / `GALAXY → GRAPHICS` / `GALAXY → GRAPHICS → WEBGPU + WGSL`). Clicking any non-active crumb zooms to that level.

### Task 8.1: Breadcrumb DOM manager

**Files:**
- Create: `js/hero-galaxy/breadcrumb.js`
- Modify: `js/hero-galaxy/scene.js`

- [ ] **Step 1: Write breadcrumb.js**

Create `js/hero-galaxy/breadcrumb.js`:
```js
// Builds + updates the <ol id="breadcrumb-list"> based on scene state.
// Click any non-active crumb to invoke the corresponding transition handler.

export function createBreadcrumb({ root, galaxyData, onCrumbClick }) {
    const ol = root.querySelector('#breadcrumb-list');
    if (!ol) throw new Error('no #breadcrumb-list');

    function render(state) {
        const items = [{ key: 'galaxy', label: 'Galaxy', active: state.level === 'galaxy' }];
        if (state.focusedSystemId) {
            const sys = galaxyData.systems.find(s => s.id === state.focusedSystemId);
            items.push({
                key: `system:${state.focusedSystemId}`,
                label: sys?.name || state.focusedSystemId,
                active: state.level === 'system',
            });
        }
        if (state.focusedPlanetId) {
            const sys = galaxyData.systems.find(s => s.id === state.focusedSystemId);
            const pl = sys?.planets.find(p => p.id === state.focusedPlanetId);
            items.push({
                key: `planet:${state.focusedPlanetId}`,
                label: pl?.name || state.focusedPlanetId,
                active: state.level === 'planet',
            });
        }
        ol.innerHTML = items.map(it =>
            `<li class="${it.active ? 'is-active' : ''}" data-key="${it.key}">${escapeHtml(it.label)}</li>`
        ).join('');
        for (const li of ol.querySelectorAll('li')) {
            if (li.classList.contains('is-active')) continue;
            li.addEventListener('click', () => onCrumbClick(li.dataset.key));
        }
    }
    return { render };
}

function escapeHtml(s) {
    return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
```

- [ ] **Step 2: Wire breadcrumb into scene.js**

In `scene.js`, add import:
```js
import { createBreadcrumb } from './breadcrumb.js';
```

After `state` is defined, create the breadcrumb:
```js
    const breadcrumb = createBreadcrumb({
        root: section,
        galaxyData: galaxy,
        onCrumbClick: (key) => {
            if (key === 'galaxy') transitionTo({ level: 'galaxy' });
            else if (key.startsWith('system:')) transitionTo({ level: 'system', focusedSystemId: key.slice(7) });
            else if (key.startsWith('planet:')) transitionTo({ level: 'planet', focusedSystemId: state.focusedSystemId, focusedPlanetId: key.slice(7) });
        },
    });
```

- [ ] **Step 3: Re-render breadcrumb whenever state changes**

In `transitionTo`, before the `transition = { ... }` assignment, add (at the END, after settle, but for now use both start AND end calls): replace the end of `tickTransition`'s `if (u >= 1) {...}` block with:
```js
        if (u >= 1) {
            state.level = transition.goal.level;
            state.focusedSystemId = transition.goal.focusedSystemId ?? null;
            state.focusedPlanetId = transition.goal.focusedPlanetId ?? null;
            transition = null;
            breadcrumb.render(state);
        }
```

Also at the start of `transitionTo`, immediately after defining `goal`, call:
```js
        breadcrumb.render({
            level: goal.level,
            focusedSystemId: goal.focusedSystemId ?? state.focusedSystemId,
            focusedPlanetId: goal.focusedPlanetId ?? state.focusedPlanetId,
        });
```
(This shows the destination during the fly, then re-confirms on arrival.)

Finally, render once at boot. At the bottom of `mountScene` before the `return`:
```js
    breadcrumb.render(state);
```

- [ ] **Step 4: Reload + verify**

Reload `/`. Breadcrumb top-left shows "GALAXY". Click the Graphics sun → breadcrumb updates to "GALAXY → GRAPHICS & SHADING" during the transition, stays after settle. Click "GALAXY" → flies back to galaxy view.

- [ ] **Step 5: Commit**

```
git add js/hero-galaxy/breadcrumb.js js/hero-galaxy/scene.js
git commit -m "Hero galaxy: breadcrumb DOM + click-to-jump"
```

---

### ✅ Gate 8: Breadcrumb live + clickable. STOP and verify before Phase 9.

---

## Phase 9 — Per-planet shader system (4 distinctive shaders + JSON-driven loading)

Gate: Each planet uses its own WGSL shader on first system entry. Missing or broken shaders fall back to default-planet with a console warning.

### Task 9.1: Author 4 distinctive planet shaders

**Files:**
- Create: `js/hero-galaxy/shaders/planets/planet-webgpu-wgsl.wgsl`
- Create: `js/hero-galaxy/shaders/planets/planet-gpgpu.wgsl`
- Create: `js/hero-galaxy/shaders/planets/planet-raymarch.wgsl`
- Create: `js/hero-galaxy/shaders/planets/planet-agents.wgsl`

The other planet shaders referenced in the JSON intentionally do NOT exist yet — they'll fall back to default-planet.wgsl until Raphael authors them. The system gracefully handles this (Task 9.2).

- [ ] **Step 1: Author planet-webgpu-wgsl (cracked-glass / circuit)**

Create `js/hero-galaxy/shaders/planets/planet-webgpu-wgsl.wgsl`:
```wgsl
struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
};
fn surface(s: Surface) -> vec4<f32> {
    let p = s.world_pos * 5.0;
    let n = fbm3(p + vec3<f32>(0.0, s.time * 0.04, 0.0), 4);
    let crack = smoothstep(0.55, 0.62, n);
    let base = mix(s.accent * 0.25, s.accent * 1.6, crack);
    let rim = fresnel(s.view_dir, s.world_normal, 3.0);
    return vec4<f32>(base + s.accent * rim * (0.4 + s.hover_t * 1.5), 1.0);
}
```

- [ ] **Step 2: Author planet-gpgpu (swirling fluid)**

Create `js/hero-galaxy/shaders/planets/planet-gpgpu.wgsl`:
```wgsl
struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
};
fn surface(s: Surface) -> vec4<f32> {
    let lat = s.uv_sphere.y;
    let lon = s.uv_sphere.x + s.time * 0.02;
    let swirl = sin(lon * 14.0 + sin(lat * 8.0 + s.time * 0.1) * 2.0) * 0.5 + 0.5;
    let band = sin(lat * 18.0) * 0.5 + 0.5;
    let v = mix(swirl, band, 0.4);
    let base = mix(s.accent * 0.4, s.accent * 1.4, v);
    let rim = fresnel(s.view_dir, s.world_normal, 2.0);
    return vec4<f32>(base + s.accent * rim * (0.3 + s.hover_t), 1.0);
}
```

- [ ] **Step 3: Author planet-raymarch (SDF-tile)**

Create `js/hero-galaxy/shaders/planets/planet-raymarch.wgsl`:
```wgsl
struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
};
fn surface(s: Surface) -> vec4<f32> {
    let v = voronoi(s.world_pos * 6.0 + vec3<f32>(0.0, 0.0, s.time * 0.03));
    let edge = smoothstep(0.0, 0.05, v);
    let base = mix(s.accent * 0.15, s.accent * 0.9, edge);
    let ndl = clamp(dot(s.world_normal, normalize(vec3<f32>(0.5, 0.6, 0.6))), 0.0, 1.0);
    return vec4<f32>(base * (0.4 + 0.6 * ndl) + s.accent * s.hover_t * 0.6, 1.0);
}
```

- [ ] **Step 4: Author planet-agents (pulsing neural)**

Create `js/hero-galaxy/shaders/planets/planet-agents.wgsl`:
```wgsl
struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
};
fn surface(s: Surface) -> vec4<f32> {
    let pulse = sin(s.time * 1.8 + s.world_pos.y * 5.0) * 0.5 + 0.5;
    let mesh  = fbm3(s.world_pos * 4.0 + vec3<f32>(s.time * 0.07, 0.0, 0.0), 3);
    let v = pulse * mesh;
    let base = mix(s.accent * 0.2, s.accent * 1.3, v);
    let rim = fresnel(s.view_dir, s.world_normal, 2.5);
    return vec4<f32>(base + s.accent * rim * (0.5 + s.hover_t), 1.0);
}
```

- [ ] **Step 5: Verify fetchable + commit**

Visit each URL — all should be 200. Then:
```
git add js/hero-galaxy/shaders/planets/
git commit -m "Hero galaxy: 4 distinctive planet shaders (WebGPU/GPGPU/raymarch/agents)"
```

---

### Task 9.2: Use per-planet pipelines in scene render

**Files:**
- Modify: `js/hero-galaxy/scene.js`

- [ ] **Step 1: Pre-fetch all referenced planet pipelines lazily**

In `mountScene`, after the sun pipeline build, replace the planet render block (the `pls.length` loop) with the version that picks the right pipeline per body. First, add a pipeline lookup cache:

```js
    // Per-planet pipeline cache (separate from the shader-source cache in pipeline.js)
    const planetPipelineCache = new Map(); // shaderPath → { pipeline }
    async function planetPipelineFor(shaderPath) {
        if (planetPipelineCache.has(shaderPath)) return planetPipelineCache.get(shaderPath);
        const built = await getMeshPipeline(device, format, shaderPath);
        planetPipelineCache.set(shaderPath, built);
        return built;
    }
```

- [ ] **Step 2: Warm pipelines for the system being entered**

In `transitionTo`, just after computing `endTarget`/`endDist`, add a fire-and-forget warm-up for any new system:
```js
        if (goal.level === 'system' || goal.level === 'planet') {
            const sys = galaxy.systems.find(s => s.id === (goal.focusedSystemId || state.focusedSystemId));
            if (sys) {
                for (const p of sys.planets) planetPipelineFor(p.shader || 'default-planet.wgsl');
            }
        }
```

- [ ] **Step 3: Render planets via per-shader pipelines**

Replace the existing planet-render block:
```js
        const pls = visiblePlanets();
        if (pls.length) {
            pass.setPipeline(defaultPipeline);
            for (const { body } of pls) { /* ... */ }
        }
```

with:
```js
        const pls = visiblePlanets();
        for (const { body } of pls) {
            const built = planetPipelineCache.get(body.shaderPath);
            if (!built) continue;   // pipeline still being compiled this frame; skip
            pass.setPipeline(built.pipeline);
            const M = new Float32Array(16);
            mat4Identity(M);
            const sc = body.scale;
            M[0] = sc; M[5] = sc; M[10] = sc;
            M[12] = body.worldPos[0]; M[13] = body.worldPos[1]; M[14] = body.worldPos[2];
            writeBodyUbo(device, body, M, t);
            pass.setBindGroup(1, body.bg);
            pass.drawIndexed(ico.indexCount);
        }
```

- [ ] **Step 4: Reload + verify**

Reload `/`. Click the Graphics sun → see WebGPU planet (cracked-glass shader), GPGPU planet (swirling), Raymarch planet (voronoi tiles), Procedural + Retro planets (default shader, since their files don't exist). Console should show warnings for the missing shaders. **No crashes.**

- [ ] **Step 5: Commit**

```
git add js/hero-galaxy/scene.js
git commit -m "Hero galaxy: per-planet WGSL shader pipelines with graceful fallback"
```

---

### ✅ Gate 9: Each planet picks its own shader; missing files fall back. STOP and verify before Phase 10.

---

## Phase 10 — Starfield via the existing particle engine

Gate: in galaxy view, a ~20k starfield (stationary, slight twinkle) fills the background; visible at every state level.

### Task 10.1: Create starfield module + wire into scene

**Files:**
- Create: `js/hero-galaxy/render/starfield.js`
- Modify: `js/hero-galaxy/scene.js`

- [ ] **Step 1: Write starfield.js**

Create `js/hero-galaxy/render/starfield.js`:
```js
// Stationary star particles in a huge surrounding shell. Reuses the
// vendored particle engine; the engine creates its own buffers off the
// same GPUDevice and renders into the same swap target each frame.

export async function mountStarfield({ canvas, device, format }) {
    const { createParticleSystem, Emitter, shapes, modules } = await import('/js/particles/index.js');
    const ps = await createParticleSystem({
        canvas, device, format,
        backend: 'webgpu',
        maxParticles: 22_000,
        blend: 'additive',
    });
    // Spawn one big burst on a thin shell at radius 200; stationary thereafter.
    await ps.addEmitter(new Emitter({
        position: [0, 0, 0],
        shape: shapes.sphere({ radius: 200, shell: true, thickness: 8 }),
        rate: 0,
        bursts: [{ time: 0, count: 20_000 }],
        initial: {
            lifetime: { min: 1e9, max: 1e9 },
            speed:    { min: 0, max: 0 },
            size:     { min: 0.4, max: 1.6 },
            color:    [1, 1, 1, 1],
        },
        modules: [],
    }));
    return ps;
}
```

- [ ] **Step 2: Mount + render in the scene frame loop**

In `scene.js`, add import:
```js
import { mountStarfield } from './render/starfield.js';
```

After all bodies are allocated and pipelines are warmed, add (before `frame(now)`):
```js
    let starPs = null;
    try {
        starPs = await mountStarfield({ canvas, device, format });
    } catch (e) {
        console.warn('[hero-galaxy] starfield mount failed (continuing without stars):', e);
    }
```

Inside `frame(now)`, after the mesh-rendering pass.end() and **before** `device.queue.submit(...)`, call the particle render in a NEW encoder operation:

Replace:
```js
        pass.end();
        device.queue.submit([enc.finish()]);
```

with:
```js
        pass.end();
        device.queue.submit([enc.finish()]);

        // Starfield in its own pass (engine encodes + submits internally)
        if (starPs) {
            starPs.update(dt);
            starPs.render({ view: camera.view, proj: camera.proj, bgColor: [0, 0, 0, 0] });
        }
```

Wait — engine's `ps.render` will CLEAR the swap-chain. We need it to load (not clear) so the meshes stay. Inspect the engine to confirm its loadOp behavior. For now, **add starfield to be its own first pass** so the mesh pass starts from the cleared starfield framebuffer:

Restructure `frame(now)` to:
1. Run starfield render first into swap-chain (clears + draws stars)
2. Mesh pass `loadOp: 'load'` (preserves stars) + `depthLoadOp: 'clear'`

Concretely, replace the existing `frame(now)` body's encoder block with:
```js
        // Stage 1 — starfield clears + draws stars
        if (starPs) {
            starPs.update(dt);
            starPs.render({ view: camera.view, proj: camera.proj, bgColor: [CLEAR_COLOR.r, CLEAR_COLOR.g, CLEAR_COLOR.b, 1] });
        }

        // Stage 2 — mesh pass, loadOp:'load' to preserve stars in the framebuffer
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                clearValue: CLEAR_COLOR,
                loadOp: starPs ? 'load' : 'clear',
                storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: depthTex.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear', depthStoreOp: 'store',
            },
        });
        pass.setPipeline(sunPipeline);
        pass.setBindGroup(0, cameraBG);
        pass.setVertexBuffer(0, vbuf);
        pass.setIndexBuffer(ibuf, ico.indexFormat);
        for (const s of suns) { pass.setBindGroup(1, s.bg); pass.drawIndexed(ico.indexCount); }

        // Planets per-pipeline
        for (const { body } of visiblePlanets()) {
            const built = planetPipelineCache.get(body.shaderPath);
            if (!built) continue;
            pass.setPipeline(built.pipeline);
            const M = new Float32Array(16);
            mat4Identity(M);
            const sc = body.scale;
            M[0] = sc; M[5] = sc; M[10] = sc;
            M[12] = body.worldPos[0]; M[13] = body.worldPos[1]; M[14] = body.worldPos[2];
            writeBodyUbo(device, body, M, t);
            pass.setBindGroup(1, body.bg);
            pass.drawIndexed(ico.indexCount);
        }
        // Moons via default-planet pipeline (default-moon shader is used via per-body shaderPath)
        for (const { body } of visibleMoons()) {
            const built = planetPipelineCache.get(body.shaderPath) || (await planetPipelineFor(body.shaderPath));
            pass.setPipeline(built.pipeline);
            const M = new Float32Array(16);
            mat4Identity(M);
            const sc = body.scale;
            M[0] = sc; M[5] = sc; M[10] = sc;
            M[12] = body.worldPos[0]; M[13] = body.worldPos[1]; M[14] = body.worldPos[2];
            writeBodyUbo(device, body, M, t);
            pass.setBindGroup(1, body.bg);
            pass.drawIndexed(ico.indexCount);
        }
        pass.end();
        device.queue.submit([enc.finish()]);
```

(Note: the `await planetPipelineFor` inside the moon loop is a side-effect to ensure the default-moon pipeline gets cached on first need; subsequent frames the cache hits.)

- [ ] **Step 3: Reload + verify**

Reload `/`. Expected: dim starfield visible behind the three suns. Drag-orbit: stars do not move with the camera (they're at radius 200 in world space, so orbit shows parallax-free starfield — correct for "distant stars"). No errors.

- [ ] **Step 4: Commit**

```
git add js/hero-galaxy/render/starfield.js js/hero-galaxy/scene.js
git commit -m "Hero galaxy: 20k stationary starfield via particle engine"
```

---

### ✅ Gate 10: Starfield visible behind meshes. STOP and verify before Phase 11.

---

## Phase 11 — modules.orbit engine extension

Gate: a new `modules.orbit({ centerX, centerY, centerZ, axisX, axisY, axisZ, speed, radius })` exists in the engine and produces stable circular orbits when applied to a particle emitter.

### Task 11.1: Add orbit module to engine

**Files:**
- Modify: `js/particles/core/modules.js` (append a new export at the end, before the `register({...})` calls if any, following the existing module patterns)

- [ ] **Step 1: Read existing vortex implementation for the pattern**

Run: `grep -n "^export function vortex" js/particles/core/modules.js`
Open the file to read lines around the vortex export. It has both a CPU `apply` and a `wgslSnippet`. The orbit module should follow the same pattern.

- [ ] **Step 2: Append orbit module**

At the end of `js/particles/core/modules.js`, append:
```js
// ─────────────────────── orbit ───────────────────────
// Forces particles into a circular orbit around `center` at `radius`,
// in the plane perpendicular to `axis`, at angular `speed` (rad/s).
// Position is projected onto the plane each frame, distance corrected
// toward `radius` (spring), velocity set to tangent × speed × radius.
// Use case: planet rings, satellites.

export function orbit({ center = [0, 0, 0], axis = [0, 1, 0], speed = 0.5, radius = 1.5, springK = 6 } = {}) {
    const params = {
        cx: center[0], cy: center[1], cz: center[2],
        ax: axis[0], ay: axis[1], az: axis[2],
        speed, radius, springK,
    };
    const apply = (sys, i, dt) => {
        const cx = evalBoundScalar(params.cx, i, sys, null);
        const cy = evalBoundScalar(params.cy, i, sys, null);
        const cz = evalBoundScalar(params.cz, i, sys, null);
        let nx = evalBoundScalar(params.ax, i, sys, null),
            ny = evalBoundScalar(params.ay, i, sys, null),
            nz = evalBoundScalar(params.az, i, sys, null);
        const al = Math.hypot(nx, ny, nz) || 1; nx /= al; ny /= al; nz /= al;
        const ks = evalBoundScalar(params.speed, i, sys, null);
        const rt = evalBoundScalar(params.radius, i, sys, null);
        const sk = evalBoundScalar(params.springK, i, sys, null);
        // r = pos - center, projected onto plane perp to axis
        const rx = sys.pos[i*3]     - cx;
        const ry = sys.pos[i*3 + 1] - cy;
        const rz = sys.pos[i*3 + 2] - cz;
        const rn = rx * nx + ry * ny + rz * nz;
        const px = rx - rn * nx, py = ry - rn * ny, pz = rz - rn * nz;
        const pl = Math.hypot(px, py, pz) || 1e-6;
        const ux = px / pl, uy = py / pl, uz = pz / pl;
        // Tangent = axis × radial
        const tx = ny * uz - nz * uy;
        const ty = nz * ux - nx * uz;
        const tz = nx * uy - ny * ux;
        // Target velocity: tangent × speed × radius; spring toward radius
        const rerr = rt - pl;
        sys.vel[i*3]     = tx * ks * rt + ux * rerr * sk;
        sys.vel[i*3 + 1] = ty * ks * rt + uy * rerr * sk;
        sys.vel[i*3 + 2] = tz * ks * rt + uz * rerr * sk;
    };
    apply.moduleName = 'orbit';
    apply.kind = 'force-field';
    apply.forceMode = 'set';   // overrides velocity directly
    apply.params = params;
    apply.schema = {
        cx: { type: 'float', min: -50, max: 50, step: 0.1, bindable: true },
        cy: { type: 'float', min: -50, max: 50, step: 0.1, bindable: true },
        cz: { type: 'float', min: -50, max: 50, step: 0.1, bindable: true },
        ax: { type: 'float', min: -1, max: 1, step: 0.01 },
        ay: { type: 'float', min: -1, max: 1, step: 0.01 },
        az: { type: 'float', min: -1, max: 1, step: 0.01 },
        speed:   { type: 'float', min: -10, max: 10, step: 0.01, bindable: true },
        radius:  { type: 'float', min: 0,   max: 20, step: 0.01, bindable: true },
        springK: { type: 'float', min: 0,   max: 20, step: 0.1, bindable: true },
    };
    apply.wgslSnippet = (paramRefs) => `
{
  let o_cx = eval_bound(module_params.${paramRefs.cx}, p, i);
  let o_cy = eval_bound(module_params.${paramRefs.cy}, p, i);
  let o_cz = eval_bound(module_params.${paramRefs.cz}, p, i);
  let o_ax = eval_bound(module_params.${paramRefs.ax}, p, i);
  let o_ay = eval_bound(module_params.${paramRefs.ay}, p, i);
  let o_az = eval_bound(module_params.${paramRefs.az}, p, i);
  let o_sp = eval_bound(module_params.${paramRefs.speed}, p, i);
  let o_rt = eval_bound(module_params.${paramRefs.radius}, p, i);
  let o_sk = eval_bound(module_params.${paramRefs.springK}, p, i);
  let o_axis_raw = vec3<f32>(o_ax, o_ay, o_az);
  let o_aLen = max(length(o_axis_raw), 0.000001);
  let o_n = o_axis_raw / o_aLen;
  let o_r = p.pos - vec3<f32>(o_cx, o_cy, o_cz);
  let o_rn = dot(o_r, o_n);
  let o_perp = o_r - o_n * o_rn;
  let o_pl = max(length(o_perp), 0.000001);
  let o_u = o_perp / o_pl;
  let o_t = cross(o_n, o_u);
  let o_err = o_rt - o_pl;
  p.vel = o_t * o_sp * o_rt + o_u * o_err * o_sk;
}`;
    return apply;
}
```

If the engine has an `index.js` that explicitly re-exports modules, add `orbit` there as well. Run:
```
grep -n "modules\." js/particles/index.js
```
Look for re-exports; if a named-export list exists for modules, add `orbit` to it.

- [ ] **Step 3: Smoke-test in the particle playground**

Open `http://localhost:8000/demos/particle-playground.html`. In the playground's emitter inspector, the new module should be selectable. If the playground's module list is hard-coded, that's a v2 concern; for now confirm the module is callable via the engine's `modules.orbit` JS export.

```
const m = await import('/js/particles/index.js');
console.log(typeof m.modules.orbit, typeof m.modules.orbit({}).apply);
```
Expected: `function`, `function`.

- [ ] **Step 4: Commit**

```
git add js/particles/core/modules.js
git commit -m "Engine: add modules.orbit — stable circular-orbit force field"
```

---

### ✅ Gate 11: New orbit module exists + smoke-test passes. STOP and verify before Phase 12.

---

## Phase 12 — Per-planet rings (disc + particles)

Gate: planets configured with `ring.type:'particles'` in the JSON show a particle ring orbiting them in system view; planets with `ring.type:'disc'` show an alpha-blended mesh ring.

### Task 12.1: Disc mesh + ring shader

**Files:**
- Create: `js/hero-galaxy/render/ring-mesh.js`
- Create: `js/hero-galaxy/shaders/ring-disc.wgsl`

- [ ] **Step 1: Disc-ring geometry**

Create `js/hero-galaxy/render/ring-mesh.js`:
```js
// Flat ring-disc: two concentric circles, triangle-stripped into a band.
// Vertex layout matches sphere-mesh (pos x3, normal x3) — normal is the up
// axis of the ring so shaders can fade by view angle.

export function makeRingDisc(innerRadius, outerRadius, segments = 256) {
    const v = new Float32Array(segments * 2 * 6);
    const idx = new Uint16Array(segments * 6);
    for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        // Outer ring
        v[i*12 + 0] = c * outerRadius; v[i*12 + 1] = 0; v[i*12 + 2] = s * outerRadius;
        v[i*12 + 3] = 0;               v[i*12 + 4] = 1; v[i*12 + 5] = 0;
        // Inner ring
        v[i*12 + 6] = c * innerRadius; v[i*12 + 7] = 0; v[i*12 + 8] = s * innerRadius;
        v[i*12 + 9] = 0;               v[i*12 +10] = 1; v[i*12 +11] = 0;
    }
    for (let i = 0; i < segments; i++) {
        const a = i * 2, b = ((i + 1) % segments) * 2;
        idx[i*6 + 0] = a;     idx[i*6 + 1] = b;     idx[i*6 + 2] = a + 1;
        idx[i*6 + 3] = b;     idx[i*6 + 4] = b + 1; idx[i*6 + 5] = a + 1;
    }
    return { vertexData: v, indexData: idx, indexCount: idx.length, indexFormat: 'uint16' };
}
```

- [ ] **Step 2: Ring shader**

Create `js/hero-galaxy/shaders/ring-disc.wgsl`:
```wgsl
// Alpha-blended ring bands.

struct Surface {
    world_pos    : vec3<f32>, world_normal : vec3<f32>, uv_sphere : vec2<f32>,
    view_dir     : vec3<f32>, time : f32, accent : vec3<f32>, hover_t : f32,
};

fn surface(s: Surface) -> vec4<f32> {
    // Distance from local origin (radial coord in the ring's local plane).
    let r = length(s.uv_sphere - vec2<f32>(0.5));
    let band = abs(sin(r * 60.0 + s.time * 0.1));
    let edge = smoothstep(0.0, 0.25, 0.5 - r);
    let a = band * edge * 0.55;
    return vec4<f32>(s.accent * (0.4 + band * 0.6), a);
}
```

- [ ] **Step 3: Commit**

```
git add js/hero-galaxy/render/ring-mesh.js js/hero-galaxy/shaders/ring-disc.wgsl
git commit -m "Hero galaxy: disc ring mesh + alpha-blended ring shader"
```

---

### Task 12.2: Render disc-type rings in scene

**Files:**
- Modify: `js/hero-galaxy/scene.js`

- [ ] **Step 1: Build the ring pipeline (alpha blend, no depth write)**

In `scene.js`, after the planet-pipeline cache is set up, add (inside `mountScene`):
```js
    // Disc-ring pipeline — alpha-blended, depth-test on, depth-write OFF
    const ringDiscBuilt = await getMeshPipeline(device, format, 'ring-disc.wgsl');
    // We need a DIFFERENT pipeline with alpha blending; pipeline.js creates opaque.
    // For v1 we recompile the same fragment with alpha-blend target. Simpler:
    // duplicate-build with a custom blend descriptor by directly composing.
```

For v1 simplicity, **reuse the same pipeline but accept opaque rendering** (rings won't blend, will just render as solid bands cut by the alpha threshold in the shader). This is a known v1 limitation — Task 12.4 fully blends them.

- [ ] **Step 2: Build per-planet ring meshes once**

After the planet bodies are allocated, add:
```js
    import { makeRingDisc } from './render/ring-mesh.js';
```
*(adjust the import to be at the top of the file)*

Inside `mountScene`, after the planet/moon body loop:
```js
    // Disc-ring meshes (per planet that has one)
    const discRings = [];  // [{ planetBody, vbuf, ibuf, indexCount, indexFormat, tilt }]
    for (const sys of galaxy.systems) {
        for (const p of sys.planets) {
            const r = p.ring;
            if (!r || r.type !== 'disc') continue;
            const planetEntry = planets.find(pl => pl.body.id === p.id);
            if (!planetEntry) continue;
            const m = makeRingDisc(r.innerRadius, r.outerRadius, 128);
            const vb = device.createBuffer({ size: m.vertexData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(vb, 0, m.vertexData);
            const ib = device.createBuffer({ size: m.indexData.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
            device.queue.writeBuffer(ib, 0, m.indexData);
            discRings.push({ planetBody: planetEntry.body, vbuf: vb, ibuf: ib, indexCount: m.indexCount, indexFormat: m.indexFormat, tilt: r.tilt || 0 });
        }
    }
```

- [ ] **Step 3: Render disc rings in the mesh pass after planets**

In `frame(now)`, after the planet render block and before the moon render block, add:
```js
        // Disc rings (only when in system or planet state showing this planet)
        if (state.level !== 'galaxy') {
            for (const r of discRings) {
                if (state.level === 'system' && r.planetBody.meta.systemId !== state.focusedSystemId) continue;
                if (state.level === 'planet' && r.planetBody.id !== state.focusedPlanetId) continue;
                const planetBody = r.planetBody;
                pass.setPipeline(ringDiscBuilt.pipeline);
                const M = new Float32Array(16);
                mat4Identity(M);
                M[12] = planetBody.worldPos[0]; M[13] = planetBody.worldPos[1]; M[14] = planetBody.worldPos[2];
                // Tilt is rotation around X by `tilt` degrees
                const tr = r.tilt * Math.PI / 180;
                M[5] = Math.cos(tr); M[6] = -Math.sin(tr); M[9] = Math.sin(tr); M[10] = Math.cos(tr);
                writeBodyUbo(device, planetBody, M, t);
                pass.setBindGroup(1, planetBody.bg);
                pass.setVertexBuffer(0, r.vbuf);
                pass.setIndexBuffer(r.ibuf, r.indexFormat);
                pass.drawIndexed(r.indexCount);
            }
            // Restore icosphere VB/IB for following draws (moons)
            pass.setVertexBuffer(0, vbuf);
            pass.setIndexBuffer(ibuf, ico.indexFormat);
        }
```

- [ ] **Step 4: Reload + verify**

Click the Graphics sun → enter system. The "Procedural worlds" planet (which has `ring.type: 'disc'`) should show a ring band around it.

- [ ] **Step 5: Commit**

```
git add js/hero-galaxy/scene.js
git commit -m "Hero galaxy: disc-type ring meshes per planet"
```

---

### Task 12.3: Particle-type rings via shapes.ring + modules.orbit

**Files:**
- Modify: `js/hero-galaxy/scene.js`

- [ ] **Step 1: Spawn one particle emitter per particle-ring planet**

In `scene.js`, after `starPs` is mounted, add:
```js
    // Per-planet particle rings — each is an emitter on the same starPs system.
    // Spawn position = ring shape; motion = orbit module locked to planet centre.
    if (starPs) {
        const { Emitter, shapes, modules } = await import('/js/particles/index.js');
        for (const sys of galaxy.systems) {
            for (const p of sys.planets) {
                const r = p.ring;
                if (!r || r.type !== 'particles') continue;
                const planetEntry = planets.find(pl => pl.body.id === p.id);
                if (!planetEntry) continue;
                const body = planetEntry.body;
                const meanR = (r.innerRadius + r.outerRadius) / 2;
                const thick = r.outerRadius - r.innerRadius;
                const tiltRad = (r.tilt || 0) * Math.PI / 180;
                // Axis perpendicular to the ring's plane (around X tilt)
                const axis = [0, Math.cos(tiltRad), Math.sin(tiltRad)];
                const orbitMod = modules.orbit({
                    center: [body.worldPos[0], body.worldPos[1], body.worldPos[2]],
                    axis,
                    speed: 0.3, radius: meanR, springK: 8,
                });
                // Stash for per-frame center update
                planetEntry.ringOrbitModule = orbitMod;
                await starPs.addEmitter(new Emitter({
                    position: [body.worldPos[0], body.worldPos[1], body.worldPos[2]],
                    shape: shapes.ring({ radius: meanR, thickness: thick, height: 0.08 }),
                    rate: 0,
                    bursts: [{ time: 0, count: r.count || 3000 }],
                    initial: {
                        lifetime: { min: 1e9, max: 1e9 },
                        speed:    { min: 0, max: 0 },
                        size:     { min: 0.6, max: 1.3 },
                        color:    body.accent,
                    },
                    modules: [orbitMod],
                }));
            }
        }
    }
```

- [ ] **Step 2: Update ring orbit centres per-frame (planets move as they orbit their sun)**

Inside `frame(now)`, after the planet-position update, add:
```js
        for (const planetEntry of planets) {
            const m = planetEntry.ringOrbitModule;
            if (!m) continue;
            const b = planetEntry.body;
            m.params.cx = b.worldPos[0];
            m.params.cy = b.worldPos[1];
            m.params.cz = b.worldPos[2];
        }
```

- [ ] **Step 3: Reload + verify**

Click Graphics sun → see WebGPU planet with a particle ring of vermilion particles orbiting it. Same for the other particle-ring planets in ML and Web-Systems.

- [ ] **Step 4: Commit**

```
git add js/hero-galaxy/scene.js
git commit -m "Hero galaxy: particle rings via shapes.ring + modules.orbit"
```

---

### ✅ Gate 12: Rings visible (mesh + particle types). STOP and verify before Phase 13.

---

## Phase 13 — Moon click → existing dossier modal

Gate: clicking a moon while in planet view opens the corresponding project's dossier modal.

### Task 13.1: Wire moon click to window.openModal

This was already partially wired in Task 7.2 (`handleBodyClick` calls `window.openModal(projectId, anchorEl)` for moons). Verify it works end-to-end.

- [ ] **Step 1: Reload + drill in**

Reload `/`. Click Graphics sun → Click WebGPU planet → Click the "Remain" moon. Expected: existing project-modal opens with the Remain dossier loaded. ESC closes the modal; camera state remains on the planet (modal close does NOT trigger a zoom-out, because the modal handles ESC).

- [ ] **Step 2: If ESC currently triggers BOTH modal close AND camera zoom-out, fix the keydown handler**

Look at the keydown handler in `scene.js`:
```js
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') handleEmptyClick();
});
```

Change to:
```js
window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // Don't zoom-out if the project modal is open (existing modal owns ESC then)
    const modal = document.querySelector('.dossier-modal.is-open, #project-modal.is-open');
    if (modal) return;
    handleEmptyClick();
});
```

(Use whatever selector matches the existing modal's "open" state — check `js/main.js` for the class it adds. Likely `.dossier-modal` or similar.)

- [ ] **Step 3: Reload + verify ESC behaviour**

Click moon → modal opens → press ESC → modal closes, camera stays on planet. Press ESC again → camera zooms out to system. Press ESC again → zooms out to galaxy.

- [ ] **Step 4: Commit**

```
git add js/hero-galaxy/scene.js
git commit -m "Hero galaxy: moon click → dossier modal; ESC scoped to modal first"
```

---

### ✅ Gate 13: Moons open dossier modal correctly. STOP and verify before Phase 14.

---

## Phase 14 — Post-FX bloom + ambient motion + IntersectionObserver pause

Gate: bloom glow on suns + ambient camera/orbit motions; scrolling past the hero stops all GPU work and timers.

### Task 14.1: Post-FX bloom integration

The engine's `ps.render` applies its own post-FX chain to the swap target. For v1, since our meshes render BEFORE the engine's particles, the engine's bloom won't process the mesh image. Simplest workable v1: enable bloom on the **starfield** render call only (so suns glow softly because their bright pixels are picked up by the additive starfield blur? No — that wouldn't work without unifying targets).

For v1, **defer bloom to engine-handled stars + a manual sun glow**: add a soft fresnel glow inside the sun shader (already there) and ship without a full-frame bloom. v2 task: render meshes into the engine's HDR scene texture and let the engine's postfx run over the union.

- [ ] **Step 1: Document the deferral**

Add a comment near the `starPs` render call in `scene.js`:
```js
        // NOTE: engine post-FX bloom processes the starfield only in v1.
        // Mesh layer relies on per-shader fresnel for body glow. v2: render
        // meshes into the engine's HDR scene texture and apply postfx over
        // the union of meshes + particles.
```

- [ ] **Step 2: Commit**

```
git add js/hero-galaxy/scene.js
git commit -m "Hero galaxy: document v1 bloom scope; defer mesh bloom to v2"
```

---

### Task 14.2: Galaxy auto-orbit + planet self-rotation

**Files:**
- Modify: `js/hero-galaxy/scene.js`

- [ ] **Step 1: Galaxy auto-orbit + idle resume**

Add tracking of last user input time:
```js
    let lastInputAt = performance.now();
    canvas.addEventListener('pointerdown', () => { lastInputAt = performance.now(); });
    canvas.addEventListener('wheel',       () => { lastInputAt = performance.now(); });
```

In `frame(now)`, after `tickTransition(now)`, add:
```js
        // Galaxy idle drift: 0.5°/s after 4s of no user input
        if (state.level === 'galaxy' && !transition && (now - lastInputAt > 4000)) {
            applyOrbitDelta(camera, 0.5 * (Math.PI / 180) * dt, 0);
        }
```

- [ ] **Step 2: Planet self-rotation already happens via the model matrix**

Currently the planet's model matrix is identity scaled. To add slow self-spin, replace the planet model matrix block:
```js
            const M = new Float32Array(16);
            mat4Identity(M);
            const sc = body.scale;
            M[0] = sc; M[5] = sc; M[10] = sc;
            M[12] = body.worldPos[0]; M[13] = body.worldPos[1]; M[14] = body.worldPos[2];
```

with a version that adds a slow Y-axis rotation:
```js
            const M = new Float32Array(16);
            const spin = t * 0.2 + body.id.length;  // deterministic per-planet phase
            const cs = Math.cos(spin), sn = Math.sin(spin);
            const sc = body.scale;
            M[0]  =  cs * sc; M[2] =  sn * sc;
            M[5]  =        sc;
            M[8]  = -sn * sc; M[10] = cs * sc;
            M[15] = 1;
            M[12] = body.worldPos[0]; M[13] = body.worldPos[1]; M[14] = body.worldPos[2];
```

- [ ] **Step 3: Reload + verify**

Reload `/`. Galaxy view: after ~4s no input, camera slowly drifts. Click a sun: planets visibly self-rotate as they orbit.

- [ ] **Step 4: Commit**

```
git add js/hero-galaxy/scene.js
git commit -m "Hero galaxy: galaxy idle auto-orbit + planet self-rotation"
```

---

### Task 14.3: IntersectionObserver pause on scroll-away

**Files:**
- Modify: `js/hero-galaxy/scene.js`

- [ ] **Step 1: Add IO + running flag**

In `mountScene`, before the first `requestAnimationFrame(frame);`, add:
```js
    let running = true;
    const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
            const wasRunning = running;
            running = e.intersectionRatio >= 0.1;
            if (running && !wasRunning) {
                // Resume — re-enter the loop
                requestAnimationFrame(frame);
            }
        }
    }, { threshold: [0, 0.1] });
    io.observe(section);
```

In `frame(now)`, at the very top, add:
```js
    if (!running) return;
```

- [ ] **Step 2: Reload + verify**

Reload `/`. Open DevTools Performance tab. Scroll past the hero — GPU activity should drop to ~0% in the Performance trace. Scroll back — animation resumes within ~100ms.

- [ ] **Step 3: Commit**

```
git add js/hero-galaxy/scene.js
git commit -m "Hero galaxy: IntersectionObserver pauses loop off-screen"
```

---

### ✅ Gate 14: Polished motions + scroll-pause. STOP and verify before Phase 15.

---

## Phase 15 — Page integration cleanup + mobile + E2E + ship

Gate: live on production. Editorial layout below the 100vh hero is clean; fallback paths all verified; mobile touch controls work.

### Task 15.1: Move hero stats block to About section + verify other content removal

**Files:**
- Modify: `index.html`
- Modify: `css/style.css` (small adjustments for the stat block in About)

- [ ] **Step 1: Find and copy the hero stats block**

The stats block currently lives inside the OLD `.hero-grid` (which we replaced in Task 1.2). It's not in the page anymore — it lives in the spec only. Re-add the `<dl class="about-stats">` directly inside the About section.

In `index.html`, find:
```html
<section id="about" class="section section-about" data-section="about">
  <header class="section-head">
    ...
  </header>
  <div class="about-grid">
```

Inside `<div class="about-grid">`, add:
```html
<dl class="about-stats">
  <div><dt>Since</dt><dd>2021</dd></div>
  <div><dt>Catalogue</dt><dd data-stat="catalogue">—</dd></div>
  <div><dt>Clients</dt><dd><span data-stat="clients">—</span><span class="stat-sup">*</span></dd></div>
  <div><dt>Disciplines</dt><dd data-stat="disciplines">—</dd></div>
</dl>
```

Add minimal CSS in `style.css`:
```css
.about-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--s-4, 24px);
    margin-bottom: var(--s-5, 32px);
    padding: var(--s-3, 16px) 0;
    border-top: 1px solid rgba(28, 22, 14, 0.15);
    border-bottom: 1px solid rgba(28, 22, 14, 0.15);
    font-family: var(--f-mono, monospace);
}
.about-stats dt {
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: rgba(28, 22, 14, 0.5);
    margin-bottom: 4px;
}
.about-stats dd {
    margin: 0;
    font-family: var(--f-display, serif);
    font-size: 28px;
    color: var(--accent, #ff4b1f);
}
.about-stats .stat-sup { font-size: 11px; vertical-align: super; opacity: 0.6; }
```

- [ ] **Step 2: Confirm the existing stat-populator in main.js still wires up to `data-stat`**

Run: `grep -n "data-stat" js/main.js`
The existing populator targets `[data-stat="..."]` — it'll still find them in the new location.

- [ ] **Step 3: Reload + verify**

Reload `/`. Scroll past hero. About section now shows the four stats inline. Catalogue / Clients / Disciplines should populate with numbers (computed from projects.json).

- [ ] **Step 4: Commit**

```
git add index.html css/style.css
git commit -m "Hero galaxy: move hero stats into About section"
```

---

### Task 15.2: Verify all four fallback paths

- [ ] **Step 1: Reload + force each fallback path one at a time**

For each test, hard-reload the page. Use DevTools console.

(a) **No-WebGPU:**
```
Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
location.reload();
```
Expected: `.is-fallback` added; editorial H1+tagline+disciplines visible.

(b) **Reduced motion:** Open DevTools → Rendering → Emulate CSS media feature `prefers-reduced-motion` → `reduce`. Reload.
Expected: same fallback.

(c) **SDF/JSON load fail:** DevTools → Network → block URL pattern `*hero-galaxy.json`. Reload.
Expected: same fallback within ~1.5s.

(d) **Shader load fail:** Network → block URL pattern `*shaders/sun.wgsl`. Reload.
Expected: shader cache catches it, falls back to default-planet pipeline. Scene still renders; suns look like default planets. No `.is-fallback`. Console warns about shader fetch.

- [ ] **Step 2: Document any failure modes that don't behave as expected**

If any of the above doesn't gracefully fallback, fix the corresponding gate in `js/hero-galaxy/index.js` or in the shader cache before continuing.

- [ ] **Step 3: Commit any fallback fixes (if needed)**

```
git add js/hero-galaxy/
git commit -m "Hero galaxy: fix fallback path discovered in verification"
```
(Skip this step if no fix needed.)

---

### Task 15.3: Mobile budget + touch verification

- [ ] **Step 1: Add the mobile budget tier**

In `scene.js`, near the top of `mountScene`, after `dpr` is computed, add:
```js
    const isMobile = window.matchMedia('(max-width: 720px)').matches;
    const STAR_COUNT = isMobile ? 8000 : 20000;
    const ICOSPHERE_SUBDIV = isMobile ? 4 : 5;
```

Use them:
- Replace `const ico = makeIcosphere(5);` with `const ico = makeIcosphere(ICOSPHERE_SUBDIV);`
- Replace the starfield `count: 20_000` literal with `count: STAR_COUNT`
- Reduce per-ring count similarly: in the particle-ring mount loop, replace `count: r.count || 3000` with `count: isMobile ? Math.floor((r.count || 3000) * 0.35) : (r.count || 3000)`

- [ ] **Step 2: Touch test in DevTools device mode**

DevTools → Toggle device toolbar → pick "iPhone 14 Pro" (or any touch device). Reload `/`.
- One-finger drag → orbit
- Pinch (Cmd/Ctrl-click+drag in emulator) → zoom
- Tap a sun → fly into system

- [ ] **Step 3: Commit**

```
git add js/hero-galaxy/scene.js
git commit -m "Hero galaxy: mobile particle budget + lower-poly icospheres"
```

---

### Task 15.4: nodriver E2E verification

- [ ] **Step 1: Smoke-test the happy path via nodriver**

Run a brief nodriver session:
```
mcp__nodriver-mcp__set_cache_disabled → disabled: true
mcp__nodriver-mcp__navigate → http://localhost:8000/?fresh
```
Then in a JS evaluate:
```js
JSON.stringify({
  fallback: document.querySelector('.hero-galaxy').classList.contains('is-fallback'),
  breadcrumb: document.querySelector('#breadcrumb-list')?.textContent.trim(),
})
```
Expected: `{ fallback: false, breadcrumb: 'Galaxy' }`.

Then programmatically navigate:
```js
HERO_GALAXY.gotoSystem('graphics')
```
Wait 1500ms. Re-evaluate:
```js
JSON.stringify({ breadcrumb: document.querySelector('#breadcrumb-list')?.textContent.trim() })
```
Expected: `{ breadcrumb: 'Galaxy → Graphics & shading' }`.

Take a screenshot for posterity.

- [ ] **Step 2: Verify no JS exceptions**

Run `mcp__nodriver-mcp__get_js_exceptions`. Expected: empty array.

- [ ] **Step 3: Verify no WebGPU validation errors**

Run `mcp__nodriver-mcp__get_webgpu_errors`. Expected: empty array.

---

### Task 15.5: Push to production

- [ ] **Step 1: Check status and stage everything**

```
git status --short
```
Confirm all expected files are tracked / modified / new.

```
git add -A js/hero-galaxy/ data/hero-galaxy.json js/particles/core/modules.js index.html css/style.css
git status --short
```

- [ ] **Step 2: Final commit**

```
git commit -m "$(cat <<'EOF'
Hero galaxy: ship — 3D interactive masthead

Replaces the WebGPU particle-text masthead with a focal-locked orbit
camera traversing galaxy → system → planet across three discipline
suns, ~15 sub-category planets (per-planet WGSL surface shaders), and
~13 project moons that open the existing dossier modal on click.

Engine extension: modules.orbit (stable circular-orbit force field) is
new in js/particles/core/modules.js. shapes.ring already existed.

Page integration: 100vh dedicated landing, fallback un-hides
H1/tagline/disciplines via .is-fallback for no-WebGPU / reduced-motion
/ data load failure paths. Stats block relocated into About.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push**

```
git push origin main
```

- [ ] **Step 4: Verify live URL**

Wait ~60s for GitHub Pages CDN propagation. Then:
```
curl -s "https://raphaelgiulieri.github.io/?cb=$RANDOM" | grep -c hero-galaxy
```
Expected: ≥ 1 match (HTML contains `hero-galaxy`).

Navigate via nodriver to the live URL, repeat the smoke test from Task 15.4 against the production URL.

---

### ✅ Gate 15: Live on production, all fallback paths verified, mobile + E2E checks pass. **Implementation complete.**

---

## Summary of files created / modified

| Path | Status | Purpose |
|---|---|---|
| `js/hero-galaxy/index.js` | NEW | Entry; gates + fallback dispatch |
| `js/hero-galaxy/scene.js` | NEW | Scene graph + state machine + render loop |
| `js/hero-galaxy/bodies.js` | NEW | Per-body uniform / bind-group factory |
| `js/hero-galaxy/data-loader.js` | NEW | data/hero-galaxy.json + projects.json cross-ref |
| `js/hero-galaxy/breadcrumb.js` | NEW | DOM breadcrumb manager |
| `js/hero-galaxy/render/camera.js` | NEW | Focal-locked orbital camera math |
| `js/hero-galaxy/render/controls.js` | NEW | Pointer/wheel/touch → camera deltas |
| `js/hero-galaxy/render/pipeline.js` | NEW | Mesh pipeline + shader fetch/compile/cache |
| `js/hero-galaxy/render/sphere-mesh.js` | NEW | Icosphere generator |
| `js/hero-galaxy/render/ring-mesh.js` | NEW | Disc ring generator |
| `js/hero-galaxy/render/raycast.js` | NEW | Ray-vs-sphere hit test |
| `js/hero-galaxy/render/starfield.js` | NEW | Particle engine integration for stars |
| `js/hero-galaxy/shaders/*.wgsl` | NEW | Prelude, vertex, default, sun, ring, 4 per-planet |
| `data/hero-galaxy.json` | NEW | Scene composition (3 systems × 4–5 planets × moons) |
| `js/particles/core/modules.js` | MODIFY | Append `orbit` module |
| `index.html` | MODIFY | Replace .hero, relocate stats into About |
| `css/style.css` | MODIFY | Replace masthead rules with .hero-galaxy + .is-fallback |
| `js/hero-particles.js` | DELETE | Old masthead |
| `assets/hero/name-sdf-*.png` | DELETE | Old SDF assets |
| `assets/hero/name-sdf.json` | DELETE | Old SDF metadata |
| `scripts/bake-name-sdf.mjs` | DELETE | Old bake script |

## What's NOT in this plan (per spec § Out of scope)

- Pan / free-camera mode (explicit non-goal)
- Multi-pass per-planet shaders (single `surface()` entry point in v1)
- Vertex displacement (shared icosphere, surface fakes parallax)
- Search / filter within the galaxy
- Auto-fly intro from galaxy down into one system on page load
- Camera bookmarks / shareable URL state
- Sound design
- Mesh-bloom full-frame post-FX (deferred to v2 per Task 14.1)

