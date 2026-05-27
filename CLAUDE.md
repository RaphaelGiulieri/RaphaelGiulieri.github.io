# CLAUDE.md

Notes for future agents working on this repo. Keep this file short — it's loaded into every conversation.

## Architecture

- Vanilla HTML/CSS/JS, no frameworks, no bundler. Served from GitHub Pages.
- Three sections drive the editorial page: `data/projects.json` (work grid), `data/research.json` (Most Wanted), `data/experiences.json` (timeline). Per-project case studies in `data/projects/<id>.md`.
- The bottom-right "Ask the portfolio" assistant is Claude Haiku 4.5 behind a Cloudflare Worker (`worker/`). The agent's knowledge is a corpus built from the three JSONs above + dossier highlights.

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
