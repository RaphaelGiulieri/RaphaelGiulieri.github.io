---
id: qatar_360
title: "360° tourism campaign — WebGL + GPGPU"
tagline: "A QR code at an event booth, a phone in your hand, and a 360° video where the unrevealed frame is a curtain of curl-noise particles you part with your gaze."
categories: [web, graphics, client]
skills_short:
  - WebGL / GLSL
  - GPGPU particle systems
  - Curl-noise physics
  - Mobile-first PWA
  - Production deployment
year: 2025
status: production
client: "A Doha creative agency, for a Gulf tourism board"
role: Solo developer
highlight: true
rank: 90
hero:
  src: assets/projects/qatar_360/hero.webp
  alt: "A 360° desert scene with golden curl-noise particles parting under the user's gaze"
  type: image
gallery:
  - src: assets/projects/qatar_360/01-relax.webp
    alt: "Relax mood — golden particles drifting upward under a wide sky"
    caption: "Relax: golden dust rising. The reveal is a fluid simulation — gaze splats velocity into a 2D pressure field."
  - src: assets/projects/qatar_360/02-discover.webp
    alt: "Discover mood — depth-driven cloud veil revealing architecture"
    caption: "Discover: a depth-driven veil. Near things reveal first; far things last; voronoi noise shapes the dissolve."
  - src: assets/projects/qatar_360/03-move.webp
    alt: "Move mood — kinetic teal water with refraction and chromatic aberration"
    caption: "Move: kinetic water. Same fluid sim as Relax, tuned for vorticity and momentum that lingers."
  - src: assets/projects/qatar_360/demo.mp4
    poster: assets/projects/qatar_360/demo-poster.webp
    type: video
    caption: "20 s tour through the three moods — RELAX → DISCOVER → MOVE."
headline:
  value: "Live · Spring 2026"
  label: "deployed at event booths"
links:
  repo: null
  demo: null
---

# 360° tourism campaign — WebGL + GPGPU

A mobile-first immersive web experience for a Gulf tourism board, produced through a Doha creative agency. Visitors at an event booth scan a QR code; their phone loads a 360° equirectangular video; on top of it runs a GPGPU particle system that *is* the reveal — the unrevealed frame is a curtain of curl-noise particles you part with your gaze. Three emotional moods: **Relax** (calm golden dust), **Discover** (architectural precision through a depth veil), **Move** (kinetic water with momentum).

Each mood is a different reveal physics. Relax and Move use a 2D incompressible fluid solver — gaze splats velocity into a pressure field, dye advects with it. Discover uses depth-driven dissolution: near objects reveal first, far ones last, and a 3D voronoi noise shapes the boundary so it dissolves like cloud rather than wiping like a transition.

![[gallery:0]]

## Highlights

- **Three reveal mechanisms, one simulator.** Fluid for Relax and Move (responsive, momentum-keeping). SDF stamps composited with a depth-driven veil for Discover (architectural, geometric). Same particle pipeline underneath all three.
- **Runs on a phone.** 65 k particles on the smaller moods, 130 k on Move, all GPGPU-simulated through a position-texture ping-pong with curl-noise physics. Holds frame on iPhones from 2019.
- **Selective bloom only over the particles**, not the whole scene. Full-scene bloom is 4-6 ms on mobile; this version costs under one and reads stronger because the halos don't wash out the video.

![[gallery:2]]

## Decisions worth telling

- Built on **the GPGPU foundation of "The Spirit"** by Edan Kwan. Reusing tested ping-pong patterns let the work concentrate on the reveal semantics — where the design value sits — instead of relitigating particle physics.
- The full post-process is **a single fragment shader**, not a chain. Mobile fill-rate dies under chained passes; one big shader stays inside the budget.
- **PWA with offline fallback**, because event venues have terrible Wi-Fi and a tourism campaign cannot brick on a dropped packet.

![[video:demo]]

## Where it stands

Deployed in production. Recent iteration concentrated on Discover mode's depth-driven veil — seven versions until the spawn gate, the videosphere mask, and the debug view all agreed. The mood system, scene catalogue, and deployment tooling are stable.

The underlying tech — curl-noise GPGPU particles and the Navier-Stokes fluid solver — has its own dedicated showcase under [tech_particles](tech_particles) and [tech_volumetric](tech_volumetric).
