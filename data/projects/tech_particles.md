---
id: tech_particles
title: "Particle systems — the body of work"
tagline: "Five years of particles across four engines — Unity VFX Graph, WebGPU compute, WebGL GPGPU, and CPU boids — chasen across whatever rig the project asked for."
categories: [graphics, rnd]
skills_short:
  - Unity VFX Graph
  - WebGPU compute particles
  - WebGL GPGPU simulation
  - Curl-noise physics
  - Boids flocking
year: 2024
year_range: "2021-2025"
status: live R&D
client: null
role: Solo developer
highlight: true
rank: 73
hero:
  src: assets/projects/tech_particles/hero.webp
  alt: "A montage of particle systems — Qatar 360 curl noise, Remain dust, Unity VFX Graph fireworks"
  type: image
gallery:
  - src: assets/projects/tech_particles/01-gpgpu.webp
    alt: "WebGL GPGPU particles parting under the user's gaze in Qatar 360"
    caption: "WebGL GPGPU: position field IS a floating-point texture; advection happens in a fragment shader."
  - src: assets/projects/tech_particles/02-vfx-graph.webp
    alt: "Unity VFX Graph node graph driving an EmberGen-baked smoke effect"
    caption: "Unity VFX Graph + EmberGen flipbooks: the expensive fluid sim happens offline; runtime is one texture sample."
  - src: assets/projects/tech_particles/03-boids.webp
    alt: "A herd of boid-driven creatures wandering near the player in Remain"
    caption: "CPU boids on the herd in Remain — separation, alignment, cohesion, with one loner that approaches."
  - src: demos/curl-noise-particles.html
    type: shader
    alt: "Live curl-noise GPGPU particle field"
    caption: "Live demo · 65k particles · positions in a floating-point texture, advected each frame by the curl of a simplex-noise potential"
headline:
  value: "4 engines"
  label: "same problem, four physics"
links:
  repo: null
  demo: null
---

# Particle systems — the body of work

A cross-engine technical thread spanning five years. Same fundamental problem — *where does the state live, who moves it, how do you draw a million of them at frame-rate* — answered four different ways. Unity VFX Graph (state on GPU, simulation in a node graph). WebGPU compute (state in a buffer, simulation in WGSL kernels). WebGL GPGPU (state in a floating-point texture, simulation in a fragment shader). CPU boids (state in a list, simulation in a Lua-or-TypeScript tick loop).

The choice is never about which is "best" — it's about which paradigm fits the engine's strengths and the project's budget. Unity VFX Graph is fastest to author. WebGPU compute is what unlocks production-grade WebGL2 successors. WebGL GPGPU is the answer when you need particles in a browser tab and can't lean on compute yet. CPU boids are right when the entity count is low and the behaviour matters more than the count.

![[gallery:0]]

## Highlights

- **The same curl-noise physics ports between engines.** The 4D-Simplex-derivative implementation that drives Qatar 360°'s GPGPU particles is a near-direct port of the same function in Unity HLSL and Remain's WGSL. Math is portable; integration isn't.
- **EmberGen flipbook bake** as the trick that makes mobile-grade VFX possible. Author a fluid sim offline, pre-bake to a 4×8 flipbook sheet, sample once at runtime. A hundred-times cheaper than runtime simulation, near-identical look.
- **Same noise lib in three places.** Curl-4D, Voronoi-3D, FBM. Used in WallpaperShader's HLSL, Remain's WGSL and Qatar 360°'s GLSL. Same function, three languages, identical output.

![[gallery:1]]

## Decisions worth telling

- **Workgroup sizes matched to GPU wavefronts** — 8×8, 64, 128, never 17 or 33. Mismatched sizes cost half the GPU's throughput silently.
- **Ping-pong textures are the universal pattern.** Whether GPGPU or compute, particle state lives in two textures and you swap them every tick. Avoid trying to do it in-place; the sync cost will undo you.
- **Per-mood / per-tier configs** rather than a global simulation step. Same simulator skeleton, different force fields and spawn logic. Lets the same engine express ten distinct visual languages.

## Where it stands

Active. Every current project touches particles somewhere; each one chooses its paradigm based on the budget and the engine. Cross-engine fluency is the body of work; no single project is the headline.

## See it live

A pared-down version of the WebGL GPGPU particle pipeline — same simplex-noise-derivative-driven curl, same position-texture ping-pong, no project chrome around it.

![[gallery:3]]
