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

- `webgpu/system.js`, `webgpu/shaders/eval_bound.wgsl` — adds the global SDF binding at `@group(2) bindings 4-6` (texture, sampler, SdfUniforms buffer) + the `sample_sdf()` helper. Mirrors the curve/gradient LUT pattern; required for the `sdfAttract` portfolio module in Task 3.3. Null fallback `_nullSdfTexture` (1×1 rgba8unorm, R=128) ensures bind groups stay complete for emitters that don't use SDF. In Task 4.4 the `SdfUniforms` struct grew from 16 bytes (4 × f32: width, height, radius, padding) to 32 bytes (8 × f32: width, height, radius, offsetX, offsetY, pad×3) to support centered SDF positioning within a larger canvas; `minBindingSize` on binding 6 updated to 32 accordingly, and `updateSdfUniforms` gained `offsetX`/`offsetY` optional parameters.

## SDF binding strategy

Picked path B: module-codegen has no per-module binding hook — modules only contribute WGSL via `wgslSnippet(paramRefs) → string` spliced into one of five marker buckets, with all params funnelled through the single `ModuleParams` uniform struct emitted by `bound-codegen.js`. Adding a global SDF binding to `@group(2)` mirrors how the curve/gradient LUTs are already wired (declared in `eval_bound.wgsl`, built unconditionally in `system.js` with fallback textures for emitters that don't sample them), so the change is one extra entry on `moduleParamsLayout` + one declaration in the template — no codegen surgery.
- Texture slot @binding(4) in @group(2)  — `var sdf_tex: texture_2d<f32>` (sampleType `'float'` so a filtering sampler can read it for gradient lookups)
- Sampler slot @binding(5) in @group(2)  — `var sdf_samp: sampler` (filtering, clamp-to-edge — exact address mode locked in by Task 3.2 when wiring the actual sampler)
