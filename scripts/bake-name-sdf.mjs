#!/usr/bin/env node
// Offline SDF bake for the hero text. Run manually:
//     node scripts/bake-name-sdf.mjs
// Output: assets/hero/name-sdf.png + assets/hero/name-sdf.json

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_DIR = resolve(ROOT, 'assets/hero');

const WIDTH  = 1100;
const HEIGHT = 440;
const FONT   = 'italic 220px "Fraunces", Georgia, serif';
const TEXT_X = 70;   // left margin so italic swashes don't kiss the canvas edge

// Each frame is a pair of lines (top / bottom). Line 1 always renders in the
// off-white emitter, line 2 always in the vermilion emitter — runtime keeps
// per-emitter colours fixed across frames; only the text silhouette changes.
// Baselines: top line y=210 (clears Fraunces italic ascenders + R-swash),
// bottom line y=395 (descenders + period of e.g. "Giulieri." sit safely inside).
const TEXT_FRAMES = [
  [ { text: 'Multi',      y: 210 }, { text: 'Discipline',  y: 395 } ],
  [ { text: 'Games',      y: 210 }, { text: 'Shaders',     y: 395 } ],
  [ { text: 'Web',        y: 210 }, { text: 'ML',          y: 395 } ],
  [ { text: '3D',         y: 210 }, { text: 'Automation',  y: 395 } ],
];
const COLORS = ['#f0ebe0', '#ff4b1f'];   // fixed per emitter, all frames

// 1. Serve a tiny HTML that draws every frame and exposes pixel data for all.
const HTML = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@1,9..144,400&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:#000;font:${FONT}}canvas{display:block}</style></head>
<body><canvas id="c" width="${WIDTH}" height="${HEIGHT}"></canvas>
<script>
window.__ready = (async () => {
  await document.fonts.load('${FONT}');
  await document.fonts.ready;
  const c = document.getElementById('c'), ctx = c.getContext('2d');
  ctx.font = '${FONT}'; ctx.textBaseline = 'alphabetic';

  // Bake one mask per (frame × line). Each line rendered alone on a fresh
  // canvas so neighbouring text doesn't bleed into the other channel's SDF.
  const frames = ${JSON.stringify(TEXT_FRAMES.map(pair => pair.map(l => ({ text: l.text, y: l.y }))))};
  const colors = ${JSON.stringify(COLORS)};
  const out = [];
  for (let f = 0; f < frames.length; f++) {
    const lines = frames[f];
    const masks = [];
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, ${WIDTH}, ${HEIGHT});
      ctx.fillStyle = '#fff'; ctx.fillText(line.text, ${TEXT_X}, line.y);
      const img = ctx.getImageData(0, 0, ${WIDTH}, ${HEIGHT});
      const mask = new Uint8Array(${WIDTH} * ${HEIGHT});
      for (let i = 0; i < mask.length; i++) mask[i] = (img.data[i*4] > 80) ? 1 : 0;
      const m = ctx.measureText(line.text);
      masks.push({
        name: line.text,
        region: li === 0 ? 'top' : 'bottom',
        color: colors[li],
        mask: Array.from(mask),
        bounds: {
          x: ${TEXT_X} - Math.ceil(m.actualBoundingBoxLeft || 0),
          y: line.y - Math.ceil(m.actualBoundingBoxAscent),
          w: Math.ceil((m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width)),
          h: Math.ceil(m.actualBoundingBoxAscent + m.actualBoundingBoxDescent),
        },
      });
    }
    out.push({ frame: f, masks });
  }
  return { frames: out, w: ${WIDTH}, h: ${HEIGHT} };
})();
</script></body></html>`;

const PORT = 8765;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(HTML);
}).listen(PORT);

console.log(`Serving bake page on http://127.0.0.1:${PORT}`);

// 2. Drive headless Chrome via the nodriver Python package.
const NODRIVER_SCRIPT = `
import asyncio, sys, json, nodriver as uc
async def main():
    browser = await uc.start(headless=True)
    page = await browser.get('http://127.0.0.1:${PORT}/')
    await asyncio.sleep(2.0)
    for _ in range(100):
        ready = await page.evaluate('typeof window.__ready')
        if ready == 'object': break
        await asyncio.sleep(0.1)
    # Await the promise and get the result serialised as JSON string from within the page.
    data_json = await page.evaluate(
        'window.__ready.then(d => JSON.stringify(d))',
        await_promise=True,
        return_by_value=True,
    )
    # return_by_value=True returns the .value field directly (a Python string)
    if hasattr(data_json, 'value'):
        data_json = data_json.value
    print('__BAKE__' + str(data_json))
    browser.stop()
asyncio.run(main())
`;
const py = spawn('python3', ['-c', NODRIVER_SCRIPT]);
let stdout = '';
py.stdout.on('data', (d) => { stdout += d.toString(); });
py.stderr.on('data', (d) => process.stderr.write(d));
await new Promise((res, rej) => {
  py.on('close', (code) => code === 0 ? res() : rej(new Error(`bake child exited ${code}`)));
});
server.close();

const marker = stdout.indexOf('__BAKE__');
if (marker < 0) throw new Error('no __BAKE__ in subprocess output');
// Extract only the JSON on the __BAKE__ line (ignore any trailing nodriver cleanup messages).
const bakeRaw = stdout.slice(marker + 8);
const jsonEnd = bakeRaw.indexOf('\n');
const jsonStr = jsonEnd >= 0 ? bakeRaw.slice(0, jsonEnd) : bakeRaw;
const { frames: bakedFrames, w, h } = JSON.parse(jsonStr);
console.log(`Bake received: ${w}×${h}, ${bakedFrames.length} frames`);
for (const f of bakedFrames) {
  for (const m of f.masks) {
    console.log(`  frame ${f.frame} — ${m.name}: ${m.mask.filter(Boolean).length} on-pixels, bounds (${m.bounds.x},${m.bounds.y}) ${m.bounds.w}×${m.bounds.h}`);
  }
}

// 3. Per-line distance transform → one SDF channel per line.
//    Each frame produces its own RGBA8 PNG with R = top line, G = bottom line.
const RADIUS = 40;
function maskToSdf(mask) {
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
  return sdf;
}

// 4. PNG encoder — hand-built IHDR/IDAT/IEND chunks, no deps.
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
function encodePng(sdfR, sdfG) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth per channel
  ihdr[9] = 6;   // colour type 6 = RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const rows = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 4);
    rows[off] = 0;   // filter type none
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = off + 1 + x * 4;
      rows[o]     = sdfR[i];
      rows[o + 1] = sdfG[i];
      rows[o + 2] = 0;
      rows[o + 3] = 255;
    }
  }
  const idat = deflateSync(rows);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

await mkdir(OUT_DIR, { recursive: true });

// 5. Bake each frame → PNG + metadata entry.
const metaFrames = [];
for (const f of bakedFrames) {
  const sdfR = maskToSdf(f.masks[0].mask);
  const sdfG = f.masks.length > 1 ? maskToSdf(f.masks[1].mask) : new Uint8Array(w * h).fill(255);
  const png = encodePng(sdfR, sdfG);
  const filename = `name-sdf-${f.frame}.png`;
  await writeFile(resolve(OUT_DIR, filename), png);
  console.log(`✓ ${filename} (${(png.length/1024).toFixed(1)} KB) — ${f.masks.map(m => m.name).join(' / ')}`);
  metaFrames.push({
    frame: f.frame,
    png: filename,
    lines: f.masks.map((m, idx) => ({
      name: m.name,
      region: m.region,
      color: m.color,
      channel: idx,
      bounds: m.bounds,
      center: {
        x: m.bounds.x + m.bounds.w / 2,
        y: m.bounds.y + m.bounds.h / 2,
      },
    })),
  });
}

const meta = {
  generated_at: new Date().toISOString(),
  width: w,
  height: h,
  zero_isoline: 128,
  far_inside: 0,
  far_outside: 255,
  distance_radius_px: RADIUS,
  frames: metaFrames,
};
await writeFile(resolve(OUT_DIR, 'name-sdf.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`✓ Meta written: ${OUT_DIR}/name-sdf.json (${metaFrames.length} frames)`);
