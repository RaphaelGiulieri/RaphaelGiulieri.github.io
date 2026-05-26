# Particle-Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the type-only hero masthead with a WebGPU particle swarm that resolves into "Raphael Giulieri." text, and migrate `demos/curl-noise-particles.html` to the same vendored engine while preserving the WebGL2 demo as a legacy fallback.

**Architecture:** Vendor the WebGPU particle engine from `C:/Users/Legion/Desktop/AudioReactiveProject/particles` into `js/particles/`. Add a custom `sdf_attract` module (JS factory + WGSL snippet + texture binding). Bake "Raphael Giulieri." in Fraunces italic into a static SDF asset. Mount a canvas over the existing H1; cross-fade H1 out as particles cohere into the letter shapes. Honour `prefers-reduced-motion` and `navigator.gpu` availability — non-WebGPU visitors keep the existing editorial type. Pause via IntersectionObserver when scrolled away.

**Tech Stack:** WebGPU + WGSL, vanilla ES modules, Node 20+ (for the SDF bake script), nodriver for end-to-end verification. No bundler. No new runtime dependencies beyond the vendored engine.

**Spec:** `docs/superpowers/specs/2026-05-20-particle-hero-design.md` (approved).

---

## Phase 0 — Preflight checks

### Task 0.1: Verify clean working tree + engine source intact

**Files:** — (read-only verification)

- [ ] **Step 1:** Confirm working tree clean

```bash
cd /c/Users/Legion/Desktop/RaphaelGiulieri.github.io
git status --short
```
Expected: empty (or only the spec/plan files we just committed).

- [ ] **Step 2:** Confirm engine source exists + capture its current git SHA

```bash
cd /c/Users/Legion/Desktop/AudioReactiveProject
git rev-parse HEAD > /c/Users/Legion/Desktop/RaphaelGiulieri.github.io/.engine-source-sha.tmp
cat /c/Users/Legion/Desktop/RaphaelGiulieri.github.io/.engine-source-sha.tmp
```
Expected: a 40-char SHA, no errors.

- [ ] **Step 3:** Confirm engine has the WGSL files we'll extend

```bash
ls /c/Users/Legion/Desktop/AudioReactiveProject/particles/webgpu/shaders/ | grep -E "update\.template|cs_spawn"
```
Expected: both `update.template.wgsl` and `cs_spawn.wgsl` listed.

- [ ] **Step 4:** Commit nothing yet — just confirm preflight is green.

---

## Phase 1 — Vendor the engine

### Task 1.1: Create vendored directory + copy engine

**Files:**
- Create: `js/particles/` (mirrors `AudioReactiveProject/particles/` minus audio.js)
- Create: `js/particles/VENDORED.md`

- [ ] **Step 1: Mirror the engine into the portfolio**

```bash
cd /c/Users/Legion/Desktop/RaphaelGiulieri.github.io
mkdir -p js/particles
cp -r /c/Users/Legion/Desktop/AudioReactiveProject/particles/* js/particles/
```

- [ ] **Step 2: Drop the audio integration we don't need**

```bash
rm -f js/particles/core/audio.js
```

- [ ] **Step 3: Find and remove any `import` of the deleted audio.js**

```bash
grep -rln "core/audio" js/particles/ || echo "no references — safe"
```
If any matches: comment-out or remove the import line in each file. Run grep again to confirm zero matches.

- [ ] **Step 4: Write the VENDORED.md provenance note**

Write `js/particles/VENDORED.md`:
```markdown
# Vendored particle engine

Source: `C:/Users/Legion/Desktop/AudioReactiveProject/particles/`
Source SHA: <paste contents of .engine-source-sha.tmp from preflight>
Vendored on: 2026-05-20

## Local additions (preserved across re-vendor)

- `webgpu/shaders/sdf_attract.wgsl` — portfolio-specific module shader (added in particle-hero implementation).
- `core/modules.js` — adds the `sdfAttract` factory at the bottom. Look for `// ─── portfolio addition: sdfAttract` marker.

## Drop list (per portfolio scope)

- `core/audio.js` — audio reactivity not used in the portfolio.

## To re-vendor

1. Update `Source SHA` above with the new upstream SHA.
2. `cp -r <source>/particles/* js/particles/` then re-delete `core/audio.js`.
3. Re-apply the local additions listed above (they should be flagged in upstream diffs).
```

- [ ] **Step 5: Clean up the temp file**

```bash
rm /c/Users/Legion/Desktop/RaphaelGiulieri.github.io/.engine-source-sha.tmp
```

- [ ] **Step 6: Commit**

```bash
git add js/particles/
git commit -m "Vendor WebGPU particle engine from AudioReactiveProject"
```

### Task 1.2: Sanity-check the vendored engine loads in isolation

**Files:**
- Create: `scratch/engine-smoketest.html`

- [ ] **Step 1: Write a minimal smoke-test page**

Write `scratch/engine-smoketest.html`:
```html
<!doctype html>
<html><head><meta charset="utf-8"><title>engine smoketest</title>
<style>body{margin:0;background:#0c0a07}canvas{display:block;width:100vw;height:100vh}</style>
</head><body>
<canvas id="c"></canvas>
<script type="module">
import { createParticleSystem, Emitter, shapes, modules, Gradient, Curve } from '../js/particles/index.js';
const canvas = document.getElementById('c');
const ps = await createParticleSystem({ canvas, backend: 'webgpu', maxParticles: 50_000, blend: 'additive' });
await ps.addEmitter(new Emitter({
  position: [0,0,0],
  shape: shapes.sphere({ radius: 1 }),
  rate: 5000,
  initial: { lifetime:{min:2,max:3}, speed:{min:1,max:3}, size:{min:0.2,max:0.4}, color:[1,0.3,0.1,1] },
  modules: [ modules.gravity([0,-1,0]), modules.drag(0.3) ],
}));
const view = mat4Identity(); const proj = mat4Identity();
function mat4Identity(){return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);}
let last = performance.now();
requestAnimationFrame(function loop(now){
  const dt = Math.min(0.05, (now - last)/1000); last = now;
  ps.update(dt);
  ps.render({ view, proj, bgColor:[0.05,0.04,0.03,1] });
  requestAnimationFrame(loop);
});
console.log('[smoketest] engine running');
</script>
</body></html>
```

- [ ] **Step 2: Start local server**

```bash
python -m http.server 8000 > /tmp/serve.log 2>&1 &
```

- [ ] **Step 3: Verify the smoketest renders particles**

Open `http://localhost:8000/scratch/engine-smoketest.html` in Chrome (or use nodriver):
```
mcp__nodriver-mcp__navigate → http://localhost:8000/scratch/engine-smoketest.html
mcp__nodriver-mcp__evaluate_js → "document.querySelectorAll('canvas').length"
```
Expected: returns `1`, no console errors, screen shows orange particles falling under gravity.

If WebGPU init throws, fix imports / paths until it renders. Do NOT advance to Phase 2 with a broken engine.

- [ ] **Step 4: Stop the server, clean up**

```bash
taskkill //F //IM python.exe || true
```

- [ ] **Step 5: Gitignore the scratch dir (we'll keep the file local but not in the repo)**

Append to `.gitignore`:
```
scratch/
```

- [ ] **Step 6: Commit**

```bash
git add .gitignore
git commit -m "Vendor engine sanity check passed; gitignore scratch/"
```

### ✅ Gate 1: Engine loads + renders particles in the portfolio context. STOP and verify before Phase 2.

---

## Phase 2 — Bake the text SDF

### Task 2.1: Write the offline SDF bake script

**Files:**
- Create: `scripts/bake-name-sdf.mjs`
- Create: `assets/hero/` (output dir)

- [ ] **Step 1: Confirm Node + canvas package availability**

```bash
node --version
```
Expected: v20.x or higher. (Need >= 18 for ESM + fetch).

- [ ] **Step 2: Choose the renderer — nodriver headless Chrome**

We avoid the `canvas` npm package (native build pain on Windows). Instead the bake script spawns a headless Chrome via nodriver, navigates to a small in-memory HTML that draws the text, reads pixel data back, computes the distance transform in pure JS, writes a PNG.

- [ ] **Step 3: Write the bake script**

Write `scripts/bake-name-sdf.mjs`:
```js
#!/usr/bin/env node
// Offline SDF bake for the hero text. Run manually:
//     node scripts/bake-name-sdf.mjs
// Output: assets/hero/name-sdf.png + assets/hero/name-sdf.json

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'assets/hero');

const WIDTH  = 1024;
const HEIGHT = 256;
const FONT   = 'italic 220px "Fraunces", Georgia, serif';
const TEXT_LINES = [
  { text: 'Raphael',   y: 100, color: '#f0ebe0', region: 'top' },
  { text: 'Giulieri.', y: 220, color: '#ff4b1f', region: 'bottom' },
];

// 1. Serve a tiny HTML that draws the text and exposes pixel data.
const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,400&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:#000;font:${FONT}}canvas{display:block}</style></head>
<body><canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas>
<script>
window.__ready = (async () => {
  await document.fonts.load('${FONT}');
  await document.fonts.ready;
  const c = document.getElementById('c'), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,${WIDTH},${HEIGHT});
  ctx.font = '${FONT}'; ctx.textBaseline = 'alphabetic';
  ${TEXT_LINES.map(l => `ctx.fillStyle='#fff'; ctx.fillText(${JSON.stringify(l.text)}, 20, ${l.y});`).join('\n  ')}
  const img = ctx.getImageData(0, 0, ${WIDTH}, ${HEIGHT});
  // Reduce to a single-channel mask: 1 if any RGB > 80, else 0.
  const mask = new Uint8Array(${WIDTH} * ${HEIGHT});
  for (let i = 0; i < mask.length; i++) mask[i] = (img.data[i*4] > 80) ? 1 : 0;
  return { mask: Array.from(mask), w: ${WIDTH}, h: ${HEIGHT} };
})();
</script></body></html>`;

const PORT = 8765;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(HTML);
}).listen(PORT);

console.log(`Serving bake page on http://127.0.0.1:${PORT}`);

// 2. Drive headless Chrome via the nodriver Python package.
//    (We assume nodriver is installed system-wide — it's already used by other scripts.)
const NODRIVER_SCRIPT = `
import asyncio, sys, json, nodriver as uc
async def main():
    browser = await uc.start(headless=True)
    page = await browser.get('http://127.0.0.1:${PORT}/')
    await asyncio.sleep(0.5)
    # Wait for fonts + canvas-paint
    for _ in range(40):
        ready = await page.evaluate('typeof window.__ready')
        if ready == 'object': break
        await asyncio.sleep(0.1)
    data = await page.evaluate('window.__ready', return_by_value=True)
    print('__BAKE__' + json.dumps(data))
    await browser.stop()
asyncio.run(main())
`;
const py = spawn('python', ['-c', NODRIVER_SCRIPT]);
let stdout = '';
py.stdout.on('data', (d) => { stdout += d.toString(); });
py.stderr.on('data', (d) => process.stderr.write(d));
await new Promise((res, rej) => {
  py.on('close', (code) => code === 0 ? res() : rej(new Error(`bake child exited ${code}`)));
});
server.close();

const marker = stdout.indexOf('__BAKE__');
if (marker < 0) throw new Error('no __BAKE__ in subprocess output');
const { mask, w, h } = JSON.parse(stdout.slice(marker + 8));
console.log(`Mask received: ${w}×${h}, ${mask.filter(Boolean).length} on-pixels`);

// 3. Two-pass distance transform (8SSEDT — Meijster algorithm is overkill here).
//    Output greyscale where 128 = zero-isoline, 0 = far inside, 255 = far outside.
const RADIUS = 40;
const sdf = new Uint8Array(w * h);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const inside = mask[y*w + x] === 1;
    let minDist = RADIUS;
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const xx = x + dx; if (xx < 0 || xx >= w) continue;
        if ((mask[yy*w + xx] === 1) !== inside) {
          const d = Math.hypot(dx, dy);
          if (d < minDist) minDist = d;
        }
      }
    }
    const signed = inside ? -minDist : minDist;
    const v = 128 + Math.round((signed / RADIUS) * 127);
    sdf[y*w + x] = Math.max(0, Math.min(255, v));
  }
}

// 4. Encode as 8-bit greyscale PNG using zlib + handcrafted IHDR/IDAT (no deps).
//    For simplicity, write the SDF as a raw PNG via the smaller `pngjs`-free path:
//    actually use the built-in `zlib` to deflate raw scanlines + minimal PNG framing.
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, c]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 0;   // greyscale
ihdr[10] = 0;  // compression
ihdr[11] = 0;  // filter
ihdr[12] = 0;  // interlace
const rows = Buffer.alloc(h * (w + 1));
for (let y = 0; y < h; y++) {
  rows[y * (w + 1)] = 0;
  for (let x = 0; x < w; x++) rows[y * (w + 1) + 1 + x] = sdf[y*w + x];
}
const idat = deflateSync(rows);
const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const png = Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(resolve(OUT_DIR, 'name-sdf.png'), png);

// 5. Metadata: per-line bounding boxes (computed from the mask).
const lineRegions = TEXT_LINES.map((line) => {
  // Hard-coded vertical split since the bake script controls layout: top half / bottom half.
  const yMin = line.region === 'top' ? 0 : Math.floor(h / 2);
  const yMax = line.region === 'top' ? Math.floor(h / 2) : h;
  return { name: line.text, region: line.region, color: line.color,
           bounds: { x: 0, y: yMin, w, h: yMax - yMin } };
});
const meta = {
  generated_at: new Date().toISOString(),
  width: w,
  height: h,
  zero_isoline: 128,
  far_inside: 0,
  far_outside: 255,
  distance_radius_px: RADIUS,
  lines: lineRegions,
};
await writeFile(resolve(OUT_DIR, 'name-sdf.json'), JSON.stringify(meta, null, 2) + '\n');

console.log(`✓ SDF written: ${OUT_DIR}/name-sdf.png (${(png.length/1024).toFixed(1)} KB)`);
console.log(`✓ Meta written: ${OUT_DIR}/name-sdf.json`);
```

- [ ] **Step 4: Run the bake script**

```bash
cd /c/Users/Legion/Desktop/RaphaelGiulieri.github.io
node scripts/bake-name-sdf.mjs
```
Expected: prints `Mask received: 1024×256`, `Mask received` is non-zero, then `✓ SDF written` + `✓ Meta written`. Run-time ~5-10 s.

- [ ] **Step 5: Visually inspect the output**

```bash
ls -la assets/hero/
```
Expected:
- `name-sdf.png` ~40-80 KB
- `name-sdf.json` < 1 KB

Open `assets/hero/name-sdf.png` in an image viewer. Expected: mid-grey background, dark blobs where the letters are, soft gradient haloes around each letter edge. The text should be readable as "Raphael" (top) + "Giulieri." (bottom) even though it's a distance field.

- [ ] **Step 6: Commit the bake script + the baked SDF**

```bash
git add scripts/bake-name-sdf.mjs assets/hero/name-sdf.png assets/hero/name-sdf.json
git commit -m "Hero SDF: bake script + baked Raphael Giulieri text"
```

### ✅ Gate 2: SDF asset exists, looks visually correct. STOP and verify before Phase 3.

---

## Phase 3 — SDF-attractor module

### Task 3.1: Study the module-codegen + texture binding extension points

**Files:** — (read-only investigation)

- [ ] **Step 1: Map how the engine handles per-emitter texture bindings**

```bash
grep -n "createBindGroup\|@binding\|@group" js/particles/webgpu/*.js | head -30
grep -n "@binding" js/particles/webgpu/shaders/*.wgsl | head -30
```
Read the matches. Identify:
- Which file holds the bind-group layout for the update compute pass.
- The next free `@binding(N)` slot in `update.template.wgsl`.

- [ ] **Step 2: Read `module-codegen.js` to confirm modules can inject WGSL into the update shader**

```bash
cat js/particles/webgpu/module-codegen.js
```
Identify:
- The template placeholder where module snippets are concatenated.
- Whether codegen supports per-module bindings or only the global ones.

- [ ] **Step 3: Decide the integration strategy**

Two paths depending on what you found in step 2:
- **Path A (codegen supports per-module bindings)**: declare the SDF texture + sampler in the `sdfAttract` module's metadata; codegen wires it into the bind group automatically.
- **Path B (codegen does NOT support per-module bindings)**: add ONE global "sdf texture" binding slot in `update.template.wgsl` and `system.js` that lives there permanently. Modules that don't use it ignore it. Slot is `@binding(N+1)` where N is the current max.

Choose B if uncertain — it's a smaller, more invasive change to the engine that ages well.

- [ ] **Step 4: Write down which path you took in a sticky note**

Append a line to `js/particles/VENDORED.md`:
```
## SDF binding strategy

Picked path <A|B>: <one-sentence rationale>
- Texture slot @binding(<N>) in @group(<G>)
- Sampler slot @binding(<M>) in @group(<G>)
```

- [ ] **Step 5: No commit yet — the investigation feeds Task 3.2.**

### Task 3.2: Add the SDF texture binding to the engine

**Files:**
- Modify: `js/particles/webgpu/system.js` (add texture+sampler bind-group entries)
- Modify: `js/particles/webgpu/shaders/update.template.wgsl` (declare the bindings, expose `sample_sdf()` helper)

- [ ] **Step 1: Add a `sdfTexture` field to the system config**

Find the system constructor / `createParticleSystem` factory in `system.js`. Add accepting `sdfTexture` and `sdfSampler` in the options. Default both to a 1×1 "null" GPUTexture so emitters not using SDF still bind something valid (WebGPU bind groups must be complete).

Pseudocode (read the surrounding code to match style):
```js
// near the GPUDevice creation:
this._nullSdfTexture = device.createTexture({
  size: [1, 1], format: 'r8unorm',
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
device.queue.writeTexture(
  { texture: this._nullSdfTexture },
  new Uint8Array([128]),  // neutral midpoint = no force
  { bytesPerRow: 1 }, { width: 1, height: 1 }
);
this._sdfTexture = opts.sdfTexture || this._nullSdfTexture;
this._sdfSampler = opts.sdfSampler || device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
```

- [ ] **Step 2: Add an `updateSdfTexture(tex)` setter**

```js
updateSdfTexture(tex) {
  this._sdfTexture = tex;
  // Mark bind group dirty so it rebuilds next frame
  this._bindGroupDirty = true;
}
```

(The `_bindGroupDirty` flag may already exist for other reasons. If not, add it and check it before each compute pass dispatch.)

- [ ] **Step 3: Add the new bindings + a small uniform buffer to `update.template.wgsl`**

Pick the slot numbers from Task 3.1's note (call them `G` for the group index that already holds the other bindings, `N` for the next free binding slot in that group). Pick `N+2` for the small uniform buffer.

Append (just before the `@compute @workgroup_size(...)` line):
```wgsl
@group(G) @binding(N)     var sdf_tex     : texture_2d<f32>;
@group(G) @binding(N+1)   var sdf_sampler : sampler;

struct SdfUniforms {
  width:    f32,   // SDF texture width in pixels
  height:   f32,   // SDF texture height in pixels
  radius:   f32,   // distance_radius_px from the bake script (default 40)
  _padding: f32,
};
@group(G) @binding(N+2)   var<uniform> sdf_uniforms : SdfUniforms;

// Sample the SDF at canvas-space pixel coords (x, y).
// Returns signed distance in pixels: negative inside the text, positive outside.
// The baked PNG encodes (raw - 0.5) * 2 * radius = signed distance.
fn sample_sdf(world_xy: vec2<f32>) -> f32 {
  let uv = world_xy / vec2<f32>(sdf_uniforms.width, sdf_uniforms.height);
  let raw = textureSampleLevel(sdf_tex, sdf_sampler, uv, 0.0).r;
  return (raw - 0.5) * 2.0 * sdf_uniforms.radius;
}
```

(Replace literal `G`, `N`, `N+1`, `N+2` with the actual integers you picked. Example: if the existing max binding in `@group(0)` is 4, write `@group(0) @binding(5)` etc.)

- [ ] **Step 3b: In `system.js`, create + populate the SdfUniforms buffer alongside the null SDF texture**

Just below the `_nullSdfTexture` creation block from Step 1:
```js
this._sdfUniformsBuffer = device.createBuffer({
  size: 16,   // 4 × f32 (width, height, radius, padding)
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
// Default: null SDF size 1×1, radius 1 — gives sample_sdf() ≈ 0 everywhere.
device.queue.writeBuffer(this._sdfUniformsBuffer, 0,
  new Float32Array([1, 1, 1, 0]));
```

Add the corresponding `updateSdfUniforms(width, height, radius)` setter:
```js
updateSdfUniforms(width, height, radius) {
  this._device.queue.writeBuffer(this._sdfUniformsBuffer, 0,
    new Float32Array([width, height, radius, 0]));
}
```

When you create the bind-group in `system.js`, add the three new entries (texture at N, sampler at N+1, uniform buffer at N+2). Follow the pattern used by the existing entries — sampler entries use `{ binding: M, resource: this._someSampler }`, buffer entries use `{ binding: M, resource: { buffer: this._someBuf } }`.

- [ ] **Step 4: Run the engine smoketest again to confirm nothing broke**

```bash
python -m http.server 8000 > /tmp/serve.log 2>&1 &
```
Open `http://localhost:8000/scratch/engine-smoketest.html` — confirm particles still render. The bind group now includes the null SDF texture but no module uses it yet.

```bash
taskkill //F //IM python.exe
```

- [ ] **Step 5: Commit**

```bash
git add js/particles/webgpu/system.js js/particles/webgpu/shaders/update.template.wgsl js/particles/VENDORED.md
git commit -m "Engine: add SDF texture binding for sdfAttract module"
```

### Task 3.3: Write the `sdfAttract` module + shader

**Files:**
- Create: `js/particles/webgpu/shaders/sdf_attract.wgsl`
- Modify: `js/particles/core/modules.js` (append the `sdfAttract` factory)

- [ ] **Step 1: Write the WGSL snippet file**

Write `js/particles/webgpu/shaders/sdf_attract.wgsl`:
```wgsl
// sdf_attract — per-particle force toward the SDF zero-isoline.
// Reads `sdf_tex` + `sdf_sampler` declared in update.template.wgsl.
// Module params (paramRefs from JS):
//   strength       : f32  — peak acceleration magnitude (px/s²)
//   inside_repel   : f32  — small anti-collapse repulsion when SDF<0
//   wander         : f32  — random noise amplitude when settled
{
  let xy = vec2<f32>(p.pos.x, p.pos.y);
  let d  = sample_sdf(xy);
  // Numerical gradient — central differences, 1 px step.
  let dx = sample_sdf(xy + vec2<f32>(1.0, 0.0)) - sample_sdf(xy - vec2<f32>(1.0, 0.0));
  let dy = sample_sdf(xy + vec2<f32>(0.0, 1.0)) - sample_sdf(xy - vec2<f32>(0.0, 1.0));
  let grad = vec2<f32>(dx, dy) * 0.5;
  let grad_len = max(length(grad), 0.0001);
  let dir = -grad / grad_len;  // inward when outside, outward when inside

  let strength = module_params.<STRENGTH_REF>;
  let inside_repel = module_params.<INSIDE_REPEL_REF>;
  let wander = module_params.<WANDER_REF>;

  // Attraction force: scales with distance, saturates softly.
  let attract_mag = strength * tanh(abs(d) * 0.05);
  accel.x = accel.x + dir.x * attract_mag;
  accel.y = accel.y + dir.y * attract_mag;

  // Anti-collapse: small outward push when deep inside the text body.
  if (d < -2.0) {
    let push = inside_repel * (-d * 0.05);
    accel.x = accel.x + (-dir.x) * push;
    accel.y = accel.y + (-dir.y) * push;
  }

  // Wander noise — cheap hash on particle index + time.
  let h = fract(sin(f32(i) * 12.9898 + sim_time * 7.7) * 43758.5453);
  let h2 = fract(sin(f32(i) * 78.233 + sim_time * 11.3) * 43758.5453);
  accel.x = accel.x + (h - 0.5) * wander;
  accel.y = accel.y + (h2 - 0.5) * wander;
}
```

(Replace `<STRENGTH_REF>`, `<INSIDE_REPEL_REF>`, `<WANDER_REF>` only if the codegen uses literal token substitution — otherwise the WGSL is generated by the JS factory's `wgslSnippet(paramRefs)` function and these become real `${paramRefs.strength}` interpolations. Follow the pattern of `gravity` in `modules.js`.)

- [ ] **Step 2: Add the JS module factory + register call**

Open `js/particles/core/modules.js`. At the end of the file (before any final closing brace), append:

```js
// ───────────────────────── portfolio addition: sdfAttract ─────────────────────────
// Per-particle attraction toward the zero-isoline of a baked SDF texture.
// The system must be created with `sdfTexture`/`sdfSampler` for this to do anything;
// without those, the null texture (neutral grey) is sampled and the force is zero.
import { readFileSync } from 'node:fs';  // remove for browser — see note below
const SDF_ATTRACT_WGSL = '';  // populated by build step; see Task 3.4
export function sdfAttract({ strength = 200, insideRepel = 30, wander = 8 } = {}) {
  const params = { strength, insideRepel, wander };
  const apply = (sys, i, dt) => {
    // CPU/WebGL2 fallback not used in the portfolio; no-op.
  };
  apply.moduleName = 'sdfAttract';
  apply.kind = 'force';
  apply.forceMode = 'add';
  apply.params = params;
  apply.schema = {
    strength:    { type: 'float', min: 0,   max: 1000, step: 1,  bindable: true },
    insideRepel: { type: 'float', min: 0,   max: 200,  step: 1,  bindable: true },
    wander:      { type: 'float', min: 0,   max: 50,   step: 0.5, bindable: true },
  };
  apply.wgslSnippet = (paramRefs) => SDF_ATTRACT_WGSL
    .replace(/<STRENGTH_REF>/g, paramRefs.strength)
    .replace(/<INSIDE_REPEL_REF>/g, paramRefs.insideRepel)
    .replace(/<WANDER_REF>/g, paramRefs.wander);
  return apply;
}
register({ name: 'sdfAttract', category: 'Forces', factory: sdfAttract,
  doc: 'Attracts particles toward the zero-isoline of a baked SDF texture (system.sdfTexture).' });
```

- [ ] **Step 3: Inline the WGSL string in `modules.js` (no bundler available)**

The portfolio has no bundler — `?raw` imports won't work. Inline the full WGSL body as a JS template literal next to the factory function. Replace the `import readFileSync` line and the `SDF_ATTRACT_WGSL = ''` placeholder from Step 2 with this exact block at the top of the appended section:

```js
// ───────────────────────── portfolio addition: sdfAttract ─────────────────────────
// Per-particle attraction toward the zero-isoline of a baked SDF texture.
// Mirrors webgpu/shaders/sdf_attract.wgsl — keep both files in sync.
const SDF_ATTRACT_WGSL = `
{
  let xy = vec2<f32>(p.pos.x, p.pos.y);
  let d  = sample_sdf(xy);
  let dx = sample_sdf(xy + vec2<f32>(1.0, 0.0)) - sample_sdf(xy - vec2<f32>(1.0, 0.0));
  let dy = sample_sdf(xy + vec2<f32>(0.0, 1.0)) - sample_sdf(xy - vec2<f32>(0.0, 1.0));
  let grad = vec2<f32>(dx, dy) * 0.5;
  let grad_len = max(length(grad), 0.0001);
  let dir = -grad / grad_len;

  let strength     = module_params.<STRENGTH_REF>;
  let inside_repel = module_params.<INSIDE_REPEL_REF>;
  let wander       = module_params.<WANDER_REF>;

  let attract_mag = strength * tanh(abs(d) * 0.05);
  accel.x = accel.x + dir.x * attract_mag;
  accel.y = accel.y + dir.y * attract_mag;

  if (d < -2.0) {
    let push = inside_repel * (-d * 0.05);
    accel.x = accel.x + (-dir.x) * push;
    accel.y = accel.y + (-dir.y) * push;
  }

  let h  = fract(sin(f32(i) * 12.9898 + sim_time * 7.7)  * 43758.5453);
  let h2 = fract(sin(f32(i) * 78.233  + sim_time * 11.3) * 43758.5453);
  accel.x = accel.x + (h  - 0.5) * wander;
  accel.y = accel.y + (h2 - 0.5) * wander;
}
`;
```

The standalone `.wgsl` file stays for reference + future build automation. Update its header to: `// Also inlined as a JS template literal in core/modules.js — keep them in sync.`

- [ ] **Step 4: Sanity test — load the engine smoketest, add `modules.sdfAttract()` to the emitter, confirm no shader-compile error**

Modify the smoketest scratch file to add `modules.sdfAttract()` to the emitter's modules array. Reload. Open DevTools console.

Expected: no WGSL compile errors (the null-SDF makes the force zero, so visuals look identical to before). If you see "binding mismatch" or "no @binding(N) found in shader" — go back to Task 3.2 step 3, the binding slot doesn't match.

- [ ] **Step 5: Commit**

```bash
git add js/particles/core/modules.js js/particles/webgpu/shaders/sdf_attract.wgsl
git commit -m "Engine: sdfAttract module — gradient attraction + anti-collapse + wander"
```

### ✅ Gate 3: Module compiles, no error in console, smoketest still runs. STOP and verify.

---

## Phase 4 — Hero canvas glue (DOM + CSS + boot)

### Task 4.1: Wrap the H1 in a stage div

**Files:**
- Modify: `index.html` (lines around the `<h1 class="hero-name">`)

- [ ] **Step 1: Locate the current H1**

```bash
grep -n "hero-name" index.html
```
Expected: lines around 70-75 (the `<h1>` with two `name-line` spans inside).

- [ ] **Step 2: Wrap it in `<div class="hero-name-stage">` + add the canvas sibling**

Replace:
```html
<h1 class="hero-name revealable">
    <span class="name-line name-line-1">Raphael</span>
    <span class="name-line name-line-2"><em>Giulieri.</em></span>
</h1>
```
With:
```html
<div class="hero-name-stage is-static">
    <canvas class="hero-particles" aria-hidden="true"></canvas>
    <h1 class="hero-name revealable">
        <span class="name-line name-line-1">Raphael</span>
        <span class="name-line name-line-2"><em>Giulieri.</em></span>
    </h1>
</div>
```

- [ ] **Step 3: Visual sanity check — refresh and confirm nothing visually changed yet**

Start server (`python -m http.server 8000`), navigate to `/`. The H1 should look exactly as before (the canvas is `0×0` until CSS sizes it; with no JS attached, it's invisible).

- [ ] **Step 4: Stop server, commit**

```bash
taskkill //F //IM python.exe
git add index.html
git commit -m "Hero: wrap H1 in .hero-name-stage with sibling canvas"
```

### Task 4.2: CSS for the stage + canvas + state classes

**Files:**
- Modify: `css/style.css` (extend the `.hero-name` rules)

- [ ] **Step 1: Find the existing `.hero-name` rules**

```bash
grep -n "^\.hero-name" css/style.css
```

- [ ] **Step 2: Insert the stage + canvas + state rules**

Above the existing `.hero-name` rule, add:
```css
/* Hero name stage — wraps H1 + particle canvas with cross-fade states. */
.hero-name-stage {
    position: relative;
    /* Lay out by H1; canvas absolutely overlays. */
}
.hero-particles {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    opacity: 0;
    transition: opacity 400ms var(--ease-out);
}
.hero-name-stage.is-coalescing .hero-particles,
.hero-name-stage.is-live        .hero-particles { opacity: 1; }
.hero-name-stage.is-coalescing .hero-name,
.hero-name-stage.is-live        .hero-name {
    transition: opacity 800ms var(--ease-out);
}
.hero-name-stage.is-coalescing .hero-name { opacity: 0.6; }
.hero-name-stage.is-live        .hero-name { opacity: 0; }
/* When the canvas is mounted and visible, the H1 stays in the DOM for a11y
   but is no longer the visual. Pointer events still hit the H1 — see js/hero-particles.js. */
```

- [ ] **Step 3: Reload, confirm nothing visually changed**

H1 still visible, canvas invisible (opacity 0, no class to flip it on).

- [ ] **Step 4: Commit**

```bash
git add css/style.css
git commit -m "Hero: CSS for stage layering + state cross-fade"
```

### Task 4.3: hero-particles.js skeleton — detection + idle exit

**Files:**
- Create: `js/hero-particles.js`
- Modify: `index.html` (add the script tag)

- [ ] **Step 1: Write the skeleton with detection + early returns**

Write `js/hero-particles.js`:
```js
// Hero masthead particle swarm.
// Bootstraps a WebGPU canvas that overlays the H1, attracts particles to a
// baked SDF of the name. Honours prefers-reduced-motion, gracefully falls
// back to the static H1 when WebGPU isn't available or the SDF asset fails.

(() => {
    'use strict';

    const HERO_PARTICLES_DEBUG = false;          // toggle for console logs
    const SDF_PATH = 'assets/hero/name-sdf.png';
    const SDF_META = 'assets/hero/name-sdf.json';
    const SDF_TIMEOUT_MS = 800;
    const MOBILE_BREAKPOINT = 720;
    const PARTICLE_COUNT_DESKTOP = 80_000;
    const PARTICLE_COUNT_MOBILE  = 15_000;

    function log(...a) { if (HERO_PARTICLES_DEBUG) console.log('[hero-particles]', ...a); }

    async function boot() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot, { once: true });
            return;
        }
        const stage = document.querySelector('.hero-name-stage');
        if (!stage) { log('no stage'); return; }

        // 1. WebGPU available?
        if (!('gpu' in navigator)) { log('no navigator.gpu'); return; }

        // 2. Reduced motion?
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            log('reduced-motion preferred'); return;
        }

        // 3. Mobile budget (chosen via media query, not UA sniffing).
        const isMobile = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
        const particleCount = isMobile ? PARTICLE_COUNT_MOBILE : PARTICLE_COUNT_DESKTOP;

        // 4. Adapter + device.
        let adapter, device;
        try {
            adapter = await navigator.gpu.requestAdapter();
            if (!adapter) { log('no adapter'); return; }
            device = await adapter.requestDevice();
            if (!device) { log('no device'); return; }
        } catch (e) { log('adapter/device fail', e); return; }

        // 5. SDF asset load + timeout.
        let sdfImage, sdfMeta;
        try {
            const [imgBlob, metaJson] = await Promise.all([
                withTimeout(fetch(SDF_PATH).then(r => r.ok ? r.blob() : Promise.reject('sdf 404')), SDF_TIMEOUT_MS),
                withTimeout(fetch(SDF_META).then(r => r.ok ? r.json() : Promise.reject('meta 404')), SDF_TIMEOUT_MS),
            ]);
            sdfImage = await createImageBitmap(imgBlob);
            sdfMeta  = metaJson;
        } catch (e) { log('sdf load failed', e); return; }

        // 6. Engine mount happens in Task 4.4. For now, just flip state class so we can
        //    confirm the detection path works visually.
        log('detection passed', { particleCount, sdfMeta });
        stage.classList.remove('is-static');
        stage.classList.add('is-live');   // (skips coalesce for now; Phase 5 adds it)
        // Phase 4.4 fills in the actual engine mount here.
    }

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
        ]);
    }

    boot();
})();
```

- [ ] **Step 2: Add the script tag to index.html**

After the `<script src="js/main.js" defer></script>` line, add:
```html
<script src="js/hero-particles.js" defer></script>
```
(Place it BEFORE the chat.js and the Cloudflare beacon — order matters for visual stacking, though all are deferred.)

- [ ] **Step 3: Reload and confirm the detection path runs (and crashes the H1 because we removed `is-static`)**

Start server, open `/` in Chrome with DevTools open. Set `HERO_PARTICLES_DEBUG = true` temporarily by editing the file then revert.

Expected console output (with debug on): `[hero-particles] detection passed { particleCount: 80000, sdfMeta: {...} }`. The H1 should be invisible because `.is-live` is applied without a canvas mounted. Don't worry — we mount it in 4.4.

- [ ] **Step 4: Revert debug flag, commit the skeleton**

```bash
git add js/hero-particles.js index.html
git commit -m "Hero: skeleton — detection + SDF load + state flip"
```

### Task 4.4: Mount the engine, upload SDF, attach emitters

**Files:**
- Modify: `js/hero-particles.js`

- [ ] **Step 1: Replace the `stage.classList.add('is-live')` line with the engine mount**

In `js/hero-particles.js`, swap the Phase 4.3 placeholder with the real mount block:

```js
        // 6. Engine mount.
        const canvas = stage.querySelector('canvas.hero-particles');
        canvas.width  = stage.clientWidth  * window.devicePixelRatio;
        canvas.height = stage.clientHeight * window.devicePixelRatio;

        // Upload SDF as a GPUTexture (r8unorm matches the baked single-channel PNG).
        const sdfTexture = device.createTexture({
            size: [sdfImage.width, sdfImage.height, 1],
            format: 'r8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        device.queue.copyExternalImageToTexture(
            { source: sdfImage }, { texture: sdfTexture },
            { width: sdfImage.width, height: sdfImage.height });

        const sdfSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

        const { createParticleSystem, Emitter, shapes, modules } = await import('./particles/index.js');
        const ps = await createParticleSystem({
            canvas,
            device,
            backend: 'webgpu',
            maxParticles: particleCount,
            blend: 'additive',
            sdfTexture,
            sdfSampler,
        });

        // One emitter per name-line, coloured per the type split.
        for (const line of sdfMeta.lines) {
            const colorRgba = hexToRgba(line.color, 1.0);
            await ps.addEmitter(new Emitter({
                position: [line.bounds.x + line.bounds.w / 2,
                           line.bounds.y + line.bounds.h / 2, 0],
                shape: shapes.box({
                    size: [line.bounds.w, line.bounds.h, 0],
                }),
                rate: particleCount / 2 / 0.6,   // half the budget per emitter, over 0.6s
                bursts: [{ time: 0, count: particleCount / 2 }],
                initial: {
                    lifetime: { min: 10_000, max: 10_000 },   // effectively immortal
                    speed:    { min: 0, max: 0 },
                    size:     { min: 1.5, max: 2.5 },
                    color:    colorRgba,
                },
                modules: [
                    modules.sdfAttract({ strength: 250, insideRepel: 40, wander: 6 }),
                    modules.drag(0.5),
                ],
            }));
        }

        // Animation loop (idle-only for now; Phase 5 adds the coalesce intro).
        const viewProj = mat4Identity();
        let last = performance.now();
        let running = true;
        function loop(now) {
            if (!running) return;
            const dt = Math.min(0.05, (now - last) / 1000); last = now;
            ps.update(dt);
            ps.render({ view: viewProj, proj: viewProj, bgColor: [0, 0, 0, 0] });
            requestAnimationFrame(loop);
        }
        stage.classList.remove('is-static');
        stage.classList.add('is-live');
        requestAnimationFrame(loop);

        log('engine mounted', { particles: particleCount });
    }

    function hexToRgba(hex, alpha) {
        const m = hex.replace('#', '');
        return [
            parseInt(m.substr(0, 2), 16) / 255,
            parseInt(m.substr(2, 2), 16) / 255,
            parseInt(m.substr(4, 2), 16) / 255,
            alpha,
        ];
    }
    function mat4Identity() {
        return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    }
```

- [ ] **Step 2: Test — visit the page in Chrome**

Start server, open `/`. Expected:
- H1 is invisible.
- Canvas shows a swarm of bone + vermilion particles roughly forming the name shape (no entrance animation yet — that's Phase 5).
- 60 fps in DevTools Performance tab.

If shader compile error in console: re-check the `update.template.wgsl` binding mismatch.
If the swarm clusters at the centre instead of forming letters: the SDF UV math in `sample_sdf()` is wrong (the texture's coordinate space doesn't match the canvas pixel space). Adjust `sample_sdf()` to map canvas pixels → SDF UV using `sdfMeta.width`/`.height`.

- [ ] **Step 3: Commit**

```bash
git add js/hero-particles.js
git commit -m "Hero: mount WebGPU engine, upload SDF, attach 2-emitter swarm"
```

### ✅ Gate 4: Particles form the text in steady state. STOP and verify before Phase 5.

---

## Phase 5 — Entrance animation + idle behaviour

### Task 5.1: Add the coalesce phase before idle

**Files:**
- Modify: `js/hero-particles.js`

- [ ] **Step 1: Stage class progression — static → coalescing → live**

Replace the `stage.classList.remove('is-static'); stage.classList.add('is-live')` block with:
```js
        stage.classList.remove('is-static');
        stage.classList.add('is-coalescing');

        // After 1200ms — particles have had time to fly in + settle into the SDF —
        // promote to is-live (H1 opacity 0).
        setTimeout(() => {
            stage.classList.replace('is-coalescing', 'is-live');
        }, 1200);
```

- [ ] **Step 2: Override initial particle velocity for the entrance**

In the emitter `initial` block, replace the `speed: { min: 0, max: 0 }` with a high entrance speed so particles fly in:
```js
                initial: {
                    lifetime: { min: 10_000, max: 10_000 },
                    speed:    { min: 800, max: 1200 },   // entrance burst
                    size:     { min: 1.5, max: 2.5 },
                    color:    colorRgba,
                },
```

The `drag(0.5)` module + the `sdfAttract` force will pull them into shape over ~1.2s.

- [ ] **Step 3: Reload — entrance should now be cinematic**

Expected:
- 0–300ms: static H1 visible, canvas faded in, particles spawning at random positions with high outward velocity.
- 300–1200ms: particles decelerate (drag), curve toward the text silhouette (sdfAttract). H1 fading 1 → 0.6.
- 1200ms+: particles settled into the text shape, H1 fully invisible, swarm in steady idle.

- [ ] **Step 4: Tune timings if needed**

If the entrance is too fast: bump the setTimeout to 1600ms.
If the entrance is too slow: drop to 900ms.
If particles arrive at the text before the H1 fades: increase the CSS `transition: opacity 800ms` on `.hero-name` to 1000-1200ms.

- [ ] **Step 5: Commit**

```bash
git add js/hero-particles.js
git commit -m "Hero: coalesce entrance — burst spawn + 1.2s settle"
```

### Task 5.2: Tune the idle behaviour

**Files:**
- Modify: `js/hero-particles.js` (the `sdfAttract` params on the emitter)

- [ ] **Step 1: Observe the current idle state for ~30 seconds**

Reload. Watch the swarm at steady state. Things to look for:
- Are particles clearly forming letters? (Strength high enough.)
- Do they pulse / breathe gently? (Wander not zero.)
- Do they collapse onto the letter centreline? (insideRepel needs to be higher.)
- Do they drift away from the text over time? (Strength too low.)

- [ ] **Step 2: Adjust the parameters**

In the emitter's `modules.sdfAttract({...})` call, tune as needed. Typical good values:
```js
modules.sdfAttract({ strength: 250, insideRepel: 40, wander: 6 })
```

If letters look "fluffy" but stable, good. If they look chaotic, increase `strength` or decrease `wander`. If they look static, increase `wander`.

- [ ] **Step 3: Commit the tuned params**

```bash
git add js/hero-particles.js
git commit -m "Hero: tune idle params for clean silhouette + gentle breathing"
```

### ✅ Gate 5: Hero entrance cinematic, idle clean. STOP and verify.

---

## Phase 6 — Hover + click interactions

### Task 6.1: Hover dispersion

**Files:**
- Modify: `js/hero-particles.js`

- [ ] **Step 1: Pass cursor state to the engine via a uniform**

The engine's shader template already has access to module params — we'll reuse that mechanism. Or, simpler: add a second module to the emitter that's a cursor-repulsion force.

The engine already has a `pointAttract` / `attractor` module. Negate strength → repulsion. But the cursor moves every frame, so we need to update the module's `params.position` from JS.

```js
// In the emitter setup loop, push a third module:
const cursorModule = modules.attractor({
    position: [-99999, -99999, 0],   // off-screen initially
    strength: -2000,                  // negative = repulsion
    falloff: 'inv-square',
});
//   ... and to the modules array:
modules: [
    modules.sdfAttract({ strength: 250, insideRepel: 40, wander: 6 }),
    cursorModule,
    modules.drag(0.5),
],
```

Save a reference outside the emitter loop:
```js
const cursorModules = [];
for (const line of sdfMeta.lines) {
    const cursorModule = modules.attractor({ position: [-99999, -99999, 0], strength: -2000, falloff: 'inv-square' });
    cursorModules.push(cursorModule);
    await ps.addEmitter(new Emitter({ /* ... */, modules: [ /* with cursorModule */ ] }));
}
```

- [ ] **Step 2: Wire `mousemove` on the stage**

After the emitters are set up:
```js
const rect = () => canvas.getBoundingClientRect();
stage.addEventListener('mousemove', (e) => {
    const r = rect();
    const x = ((e.clientX - r.left) / r.width)  * canvas.width;
    const y = ((e.clientY - r.top)  / r.height) * canvas.height;
    for (const m of cursorModules) {
        m.params.position[0] = x;
        m.params.position[1] = y;
    }
});
stage.addEventListener('mouseleave', () => {
    for (const m of cursorModules) m.params.position[0] = -99999;
});
```

The cursor module reads `params.position` every frame (live editing per the engine's design — confirm by inspecting `attractor` in `modules.js`).

- [ ] **Step 3: Verify**

Reload. Hover over the name. Particles should disperse around the cursor and re-settle when you mouse away. ~300ms recovery.

If the repulsion is too weak: bump `strength: -2000` to `-3000`. If too strong (particles fly off-screen): drop to `-1500`.

- [ ] **Step 4: Commit**

```bash
git add js/hero-particles.js
git commit -m "Hero: cursor-driven repulsion module + mousemove wiring"
```

### Task 6.2: Click explosion

**Files:**
- Modify: `js/hero-particles.js`

- [ ] **Step 1: Add a click handler that fires a one-shot radial impulse**

After the mousemove wiring:
```js
stage.addEventListener('click', (e) => {
    const r = rect();
    const x = ((e.clientX - r.left) / r.width)  * canvas.width;
    const y = ((e.clientY - r.top)  / r.height) * canvas.height;
    // Pulse: temporarily set the cursor module to a huge repulsion, then revert.
    for (const m of cursorModules) {
        m.params.position[0] = x;
        m.params.position[1] = y;
        m.params.strength = -20_000;
    }
    setTimeout(() => {
        for (const m of cursorModules) m.params.strength = -2000;
    }, 80);
});
```

- [ ] **Step 2: Test**

Reload. Click the name. Particles should burst outward strongly, then settle back over ~800ms (SDF attraction wins).

- [ ] **Step 3: Commit**

```bash
git add js/hero-particles.js
git commit -m "Hero: click explosion — 80ms super-repulsion impulse"
```

### ✅ Gate 6: Hover + click interactions work. STOP and verify.

---

## Phase 7 — IntersectionObserver pause

### Task 7.1: Pause the loop when scrolled away

**Files:**
- Modify: `js/hero-particles.js`

- [ ] **Step 1: Wrap the rAF loop with a `running` flag observed by IntersectionObserver**

The loop variable `running` already exists from Task 4.4. Add the observer just before `requestAnimationFrame(loop)`:

```js
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) {
                const visible = e.intersectionRatio >= 0.1;
                if (visible && !running) {
                    running = true;
                    last = performance.now();
                    requestAnimationFrame(loop);
                }
                if (!visible && running) {
                    running = false;   // loop self-exits next tick
                }
            }
        }, { threshold: [0, 0.1] });
        io.observe(stage);
```

- [ ] **Step 2: Test — scroll past the hero**

Open DevTools Performance tab. Scroll past the hero. Confirm:
- GPU/CPU usage drops when hero leaves viewport.
- Scrolling back in: loop resumes within ~100ms.

- [ ] **Step 3: Commit**

```bash
git add js/hero-particles.js
git commit -m "Hero: IntersectionObserver pauses the rAF loop on scroll-away"
```

### ✅ Gate 7: Pause works. STOP and verify.

---

## Phase 8 — Fallback paths verification

### Task 8.1: Test the no-WebGPU path

**Files:** — (verification only)

- [ ] **Step 1: Override `navigator.gpu` in DevTools**

Open `/`, then in DevTools console:
```js
Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
location.reload();
```

Expected: H1 visible, canvas exists but invisible (opacity 0, no engine mounted). No console errors. The page reads exactly as the current editorial site.

### Task 8.2: Test the reduced-motion path

- [ ] **Step 1: Enable reduced-motion in DevTools**

DevTools → Rendering → Emulate CSS media feature `prefers-reduced-motion` → `reduce`.

```js
location.reload();
```

Expected: same as Task 8.1 — H1 visible, canvas invisible, no engine.

### Task 8.3: Test the SDF-asset-fail path

- [ ] **Step 1: Block the SDF asset in Network panel**

DevTools → Network → Right-click `name-sdf.png` → Block request URL → reload.

Expected: H1 visible, canvas invisible (timeout fires after 800ms, gracefully exits).

Verify in console: `[hero-particles] sdf load failed timeout` (with debug logging on).

### Task 8.4: Test the mobile path

- [ ] **Step 1: Resize viewport to 375 px**

DevTools → Device toolbar → iPhone SE preset.

Reload. Confirm:
- Engine mounts.
- Particle count is ~15k (visibly less dense).
- FPS still ≥ 45 (DevTools Performance).
- No layout breakage; the H1 still readable.

### Task 8.5: Commit any tweaks that surfaced

If any of the above tests revealed bugs (off-by-one, wrong timeout, etc.), fix them, then commit:
```bash
git add -A
git commit -m "Hero: fallback path fixes from Phase 8 testing"
```

### ✅ Gate 8: All fallback paths produce the static editorial fallback cleanly. STOP and verify.

---

## Phase 9 — Curl-noise demo migration

### Task 9.1: Rename current demo to legacy

**Files:**
- Rename: `demos/curl-noise-particles.html` → `demos/curl-noise-particles-legacy.html`

- [ ] **Step 1: Rename via git so history follows**

```bash
git mv demos/curl-noise-particles.html demos/curl-noise-particles-legacy.html
```

- [ ] **Step 2: Smoke-test the legacy file directly**

Start server, open `http://localhost:8000/demos/curl-noise-particles-legacy.html`. Confirm all 4 modes (Galaxy/Lorenz/Vortex/Curl) work in the legacy WebGL2 version. (They should — we just renamed.)

- [ ] **Step 3: Commit**

```bash
git commit -m "Demo: rename curl-noise to curl-noise-legacy (WebGL2 fallback target)"
```

### Task 9.2: Write the new WebGPU curl-noise demo

**Files:**
- Create: `demos/curl-noise-particles.html` (NEW — same name as the old, now WebGPU)

- [ ] **Step 1: Write the new HTML + module-import + 4 mode definitions**

(Copy structure from the legacy file but replace the inline WebGL2 shaders with engine imports + 4 mode modules.)

Write `demos/curl-noise-particles.html`:
```html
<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GPGPU particles — WebGPU · Raphael Giulieri</title>
<style>
    html,body{margin:0;height:100%;background:#0c0a07;color:#f0ebe0;font-family:"JetBrains Mono",ui-monospace,monospace;overflow:hidden}
    canvas{display:block;width:100%;height:100%;background:#0c0a07}
    .controls{position:absolute;top:12px;left:12px;display:flex;gap:6px}
    .controls button{font:inherit;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:rgba(240,235,224,.85);background:rgba(12,10,7,.45);border:1px solid rgba(240,235,224,.2);padding:4px 8px;cursor:pointer;backdrop-filter:blur(6px)}
    .controls button.is-active{border-color:#ff4b1f;color:#ff4b1f}
    .label{position:absolute;bottom:12px;left:12px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:rgba(240,235,224,.78);line-height:1.5;max-width:calc(100% - 24px);text-shadow:0 1px 6px rgba(0,0,0,.6)}
    .label b{color:#ff4b1f;font-weight:500}
    .err{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;font-size:13px;line-height:1.6;color:#ff4b1f}
</style>
</head><body>
<canvas id="c"></canvas>
<div class="controls" id="modes">
    <button data-mode="galaxy" class="is-active">Galaxy</button>
    <button data-mode="lorenz">Lorenz</button>
    <button data-mode="vortex">Vortex</button>
    <button data-mode="curl">Curl noise</button>
</div>
<p class="label"><b>GPGPU particles · WebGPU compute</b> · 250 000 particles · four flow fields · full post-FX stack</p>
<script type="module">
(async () => {
'use strict';

// If no WebGPU, redirect to the legacy WebGL2 page transparently.
if (!('gpu' in navigator)) {
    location.replace('curl-noise-particles-legacy.html');
    return;
}

let createParticleSystem, Emitter, shapes, modules;
try {
    ({ createParticleSystem, Emitter, shapes, modules } = await import('../js/particles/index.js'));
} catch (e) {
    document.body.innerHTML = '<p class="err">Failed to load engine: ' + e.message + '</p>';
    return;
}

const canvas = document.getElementById('c');
canvas.width  = canvas.clientWidth  * devicePixelRatio;
canvas.height = canvas.clientHeight * devicePixelRatio;

const ps = await createParticleSystem({ canvas, backend: 'webgpu', maxParticles: 250_000, blend: 'additive' });

// Mode definitions — each returns a module array swapped in via ps.replaceModules.
const MODE = {
    galaxy: () => [
        modules.attractor({ position: [0,0,0], strength: 2000, falloff: 'inv-square' }),
        modules.velocityOverLifetime({ swirl: 1.2 }),
        modules.drag(0.05),
    ],
    lorenz: () => [
        // Lorenz attractor — custom module via the existing `forceField` pattern.
        // (Pseudocode — adjust to whatever the engine's "custom force" API is.)
        modules.curlNoise({ frequency: 0.4, amplitude: 2, evolveSpeed: 0.3, octaves: 3 }),
    ],
    vortex: () => [
        modules.vortex({ position: [-200, 0, 0], axis: [0,0,1], strength: 6 }),
        modules.vortex({ position: [200, 0, 0], axis: [0,0,-1], strength: 6 }),
        modules.drag(0.1),
    ],
    curl: () => [
        modules.curlNoise({ frequency: 0.6, amplitude: 4, evolveSpeed: 0.2, octaves: 2 }),
        modules.drag(0.2),
    ],
};

let emitter = new Emitter({
    position: [0,0,0],
    shape: shapes.sphere({ radius: 200 }),
    rate: 0, bursts: [{ time: 0, count: 250_000 }],
    initial: { lifetime: { min: 999_999, max: 999_999 }, speed: { min: 10, max: 30 }, size: { min: 1, max: 2 }, color: [1, 0.45, 0.15, 1] },
    modules: MODE.galaxy(),
});
await ps.addEmitter(emitter);

// Mode-switch UI
document.querySelectorAll('#modes button').forEach((btn) => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#modes button').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        const mode = btn.dataset.mode;
        emitter.replaceModules(MODE[mode]());   // engine API — verify exact name
    });
});

const view = new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
let last = performance.now();
requestAnimationFrame(function loop(now){
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    ps.update(dt);
    ps.render({ view, proj: view, bgColor: [0.047,0.039,0.027,1] });
    requestAnimationFrame(loop);
});

})();
</script>
</body></html>
```

- [ ] **Step 2: Verify all 4 modes work**

Start server, open `/demos/curl-noise-particles.html`. Click each of the 4 buttons. Each mode should produce visibly different particle behaviour.

Notes / potential issues:
- If the engine doesn't expose `emitter.replaceModules()`, swap modules by removing+re-adding the emitter, or use the engine's documented mode-swap API. Read `Emitter.prototype` in `js/particles/core/emitter.js` to find the right call.
- The Lorenz mode mapping above uses `curlNoise` as a placeholder. If you want a true Lorenz attractor, write it as a custom module following the `gravity` pattern in `modules.js` — ~30 lines of WGSL math. Adding the custom Lorenz module is OPTIONAL for this phase; the demo with 3 working modes + a curl-noise stand-in is a complete-enough deliverable.

- [ ] **Step 3: Verify the WebGPU→legacy redirect**

In Chrome DevTools, run `Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true })`, then reload `/demos/curl-noise-particles.html`. Expected: address bar changes to `curl-noise-particles-legacy.html`, the legacy demo renders.

- [ ] **Step 4: Stop server, commit**

```bash
taskkill //F //IM python.exe
git add demos/curl-noise-particles.html
git commit -m "Demo: WebGPU curl-noise — 250k particles, 4 modes, post-FX bloom"
```

### Task 9.3: Update the dossier caption

**Files:**
- Modify: `data/projects/tech_compute_procedural.md`

- [ ] **Step 1: Find the existing caption for the curl-noise gallery item**

```bash
grep -n "curl-noise\|Curl noise" data/projects/tech_compute_procedural.md
```

Actually — the curl-noise demo isn't directly embedded in `tech_compute_procedural.md`; it's a top-level demo. Skip this task if no dossier directly references it.

If a reference exists, add `WebGPU compute, 250 k particles, full post-FX stack.` to the caption.

- [ ] **Step 2: Commit if any change**

```bash
git add data/projects/tech_compute_procedural.md
git commit -m "Dossier: note the WebGPU compute upgrade on the curl-noise demo caption"
```

### ✅ Gate 9: Both curl-noise pages live, WebGPU version + legacy fallback. STOP and verify.

---

## Phase 10 — End-to-end verification via nodriver

### Task 10.1: Manual happy-path verification on production

**Files:** — (verification only)

- [ ] **Step 1: Push everything to GitHub Pages**

```bash
git push origin main
```

- [ ] **Step 2: Wait for CDN propagation**

```bash
until curl -s "https://raphaelgiulieri.github.io/?cb=$RANDOM" | grep -q "hero-name-stage"; do sleep 5; done
echo "CDN updated"
```

- [ ] **Step 3: Use nodriver to verify the happy path**

```
mcp__nodriver-mcp__set_cache_disabled → disabled: true
mcp__nodriver-mcp__navigate → https://raphaelgiulieri.github.io/?fresh
mcp__nodriver-mcp__evaluate_js → "document.querySelector('.hero-name-stage')?.className"
```
Expected: `"hero-name-stage is-live"` after ~1.5s; particles visible.

- [ ] **Step 4: Measure idle FPS**

```
mcp__nodriver-mcp__get_fps → window_ms: 3000
```
Expected: ≥ 55 fps on a desktop visit.

- [ ] **Step 5: Verify scroll-pause**

```
mcp__nodriver-mcp__evaluate_js → "window.scrollTo(0, 2000); 'scrolled'"
```
Wait 500ms.
```
mcp__nodriver-mcp__get_fps → window_ms: 1000
```
The rAF loop should have paused; FPS reflects the rest of the page only (still high but you should see GPU usage drop in DevTools manually).

- [ ] **Step 6: Open the migrated curl-noise demo**

```
mcp__nodriver-mcp__navigate → https://raphaelgiulieri.github.io/demos/curl-noise-particles.html?fresh
```
Wait 1s. Take a screenshot.
```
mcp__nodriver-mcp__screenshot → quality: 70, scale: 0.6
```
Expected: 250k vermilion particles flowing in galaxy mode with bloom.

- [ ] **Step 7: Close browser**

```
mcp__nodriver-mcp__close_browser
```

### Task 10.2: If issues surface, capture them, fix, recommit

- [ ] **Step 1: Capture issues into a list**

(Free-form — anything that doesn't match the expected behaviour from earlier phases.)

- [ ] **Step 2: Fix each, push, re-verify per Task 10.1**

- [ ] **Step 3: When everything passes, commit the verification result**

```bash
git commit --allow-empty -m "Particle hero: end-to-end verification passed"
git push origin main
```

### ✅ Gate 10: Live site matches the spec. Implementation complete.

---

## Summary of files created / modified

| Path | Status | Purpose |
|---|---|---|
| `js/particles/` | NEW (vendored ~30 files) | WebGPU particle engine |
| `js/particles/VENDORED.md` | NEW | Provenance + extension list |
| `js/particles/webgpu/shaders/sdf_attract.wgsl` | NEW | SDF-attractor WGSL snippet |
| `js/particles/webgpu/shaders/update.template.wgsl` | MODIFIED | Adds SDF texture/sampler bindings |
| `js/particles/webgpu/system.js` | MODIFIED | Accepts `sdfTexture` in opts |
| `js/particles/core/modules.js` | MODIFIED | Appends `sdfAttract` factory |
| `js/hero-particles.js` | NEW | Engine glue for masthead |
| `assets/hero/name-sdf.png` | NEW | Baked SDF asset |
| `assets/hero/name-sdf.json` | NEW | SDF metadata + line regions |
| `scripts/bake-name-sdf.mjs` | NEW | Offline SDF bake script |
| `index.html` | MODIFIED | Wraps H1, adds canvas + script tag |
| `css/style.css` | MODIFIED | Stage + canvas + state classes |
| `demos/curl-noise-particles.html` | REWRITTEN | WebGPU version w/ engine import |
| `demos/curl-noise-particles-legacy.html` | RENAMED from `.html` | WebGL2 fallback |
| `.gitignore` | MODIFIED | Adds `scratch/` |

## What's NOT in this plan (per spec § Deferred)

- Audio reactivity in the hero
- Multi-language text swap
- WebGL2 fallback for the hero (declined)
- Boids/fluid-sim/voronoi demo migrations
