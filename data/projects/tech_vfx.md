---
id: tech_vfx
title: "Visual effects composition"
tagline: "Bullet impacts, damage flashes, EmberGen-baked smoke, audio-reactive shader materials. The body of work on stylised real-time effects."
categories: [graphics, game, rnd]
skills_short:
  - Unity VFX Graph
  - EmberGen flipbooks
  - Impact / outline / damage shaders
  - MaterialPropertyBlock patterns
  - Audio-reactive materials
year: 2024
year_range: "2021-2025"
status: active
client: null
role: Solo developer
highlight: false
rank: 64
hero:
  src: assets/projects/tech_vfx/hero.webp
  alt: "A montage of VFX work — Unity VFX Graph particles, LRD impacts, water vortex"
  type: image
gallery:
  - src: assets/projects/tech_vfx/01-impacts.webp
    alt: "Bullet impact flashes on different surface types"
    caption: "Impact + deform trail shaders that conform to the surface they hit, not flat quads stuck to it."
  - src: assets/projects/tech_vfx/02-vortex.webp
    alt: "Flow-map driven water vortex with foam and refraction"
    caption: "Flow-map vortex: velocity encoded as RG, two time-offset samples blended to hide the seam."
headline:
  value: "MaterialPropertyBlock"
  label: "is the universal pattern"
links:
  repo: null
  demo: null
---

# Visual effects composition

The catch-all for effects that aren't the primary rendering — impacts, explosions, hit flashes, trails, outlines, damage overlays. Across Unity VFX Graph sandboxes (with and without custom HLSL blocks), EmberGen-baked flipbooks, the LRD shader library's impact + damage system, MaelstormProject's flow-map vortex, and audio-reactive material plumbing.

The technique that recurs everywhere is **MaterialPropertyBlock for dynamic data**. Hit points, timing, highlight states all flow through property blocks instead of new material instances. Preserves batching; avoids material proliferation; lets one shader respond to dozens of concurrent events.

![[gallery:0]]

## Highlights

- **EmberGen flipbook bake** beats runtime fluid sim by a factor of a hundred. Same look on mobile.
- **Damage localization** via property-block hit-point arrays — wounds read as wounds, not whole-body tints.
- **Backface-extrude outlines** per-object, no render feature needed. Cheap and toggleable.

## Where it stands

Active. LRD Calico is the production case study. Unity VFX Graph sandboxes are the reference library drawn on whenever a new VFX problem comes up.
