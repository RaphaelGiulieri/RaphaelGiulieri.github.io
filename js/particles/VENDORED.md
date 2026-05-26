# Vendored particle engine

Source: `C:/Users/Legion/Desktop/AudioReactiveProject/particles/`
Source SHA: 495e996fb7bf2d29e070014409c58c042462bc5e
Vendored on: 2026-05-20

## Local additions (preserved across re-vendor)

- `webgpu/shaders/sdf_attract.wgsl` — portfolio-specific module shader (added in particle-hero implementation).
- `core/modules.js` — adds the `sdfAttract` factory at the bottom. Look for `// ─── portfolio addition: sdfAttract` marker.
- `index.js` (line ~44) + `test.html` (lines ~1310, ~1354) — comment-out `core/audio` import/export lines, since `core/audio.js` is dropped from the portfolio scope. Look for the marker `// dropped: audio.js not vendored into portfolio`.
- `webgpu/spawn-pipeline.js`, `webgpu/postfx.js`, `webgpu/grid.js`, `webgpu/interact.js`, `webgpu/system.js` — WGSL fetch paths converted from root-absolute (`/particles/...`) to `new URL('./shaders/...', import.meta.url)`. Upstream assumes the engine lives at `/particles/` on the server; the portfolio mounts it at `/js/particles/`. The fix is portable — it works regardless of mount path — and could be upstreamed. Search the files for the original pattern to re-apply on re-vendor.

## Drop list (per portfolio scope)

- `core/audio.js` — audio reactivity not used in the portfolio.

## To re-vendor

1. Update `Source SHA` above with the new upstream SHA.
2. `cp -r <source>/particles/* js/particles/` then re-delete `core/audio.js`.
3. Re-apply the local additions listed above (they should be flagged in upstream diffs).
