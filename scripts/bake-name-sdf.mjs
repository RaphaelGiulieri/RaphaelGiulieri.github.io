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
const { mask, w, h } = JSON.parse(jsonStr);
console.log(`Mask received: ${w}×${h}, ${mask.filter(Boolean).length} on-pixels`);

// 3. Two-pass distance transform (naive O(n × radius²) — fine for 1024×256).
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

// 4. Encode as 8-bit greyscale PNG (no deps — hand-built IHDR/IDAT/IEND chunks).
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

// 5. Metadata: per-line bounding boxes (hard-coded vertical split since the bake controls layout).
const lineRegions = TEXT_LINES.map((line) => {
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
