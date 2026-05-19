---
id: shader_master
title: "Road to shader master — 9-day study"
tagline: "A self-directed nine-day shader curriculum. The HLSL library it produced is still shipping in production today."
categories: [graphics, docs]
skills_short:
  - Classical lighting models
  - Procedural noise
  - SDF + raymarching
  - Post-processing
  - Reference-implementation authorship
year: 2021
status: completed
client: null
role: Solo developer
highlight: false
rank: 42
hero:
  src: assets/projects/shader_master/hero.webp
  alt: "Reference scene from Day 5 — raymarched SDF composition with volumetric fog"
  type: image
headline:
  value: "still shipping"
  label: "the library that came out of it"
links:
  repo: null
  demo: null
---

# Road to shader master — 9-day study

A self-structured nine-day shader curriculum, worked through start to finish. Each day produced a reference implementation plus a short write-up of *why this works*. The artefact isn't a game or a tool — it's a **reference library** that later production work builds on.

Day 1-2 covered the classical lighting models. Day 3 — procedural noise (Perlin, Simplex, Voronoi, FBM). Day 4 — signed distance fields. Day 5-6 — raymarching and volumetric integration. Day 7 — colour and tone (Reinhard, ACES, Kelvin temperature). Day 8 — post-processing (bloom, FXAA, dither, scanlines, VHS). Day 9 — composition.

## Highlights

- **The HLSL library produced that week is still shipping.** Noise, SDF, colour utilities, common math — used in WallpaperShader, Qatar 360°, Remain. A week of deliberate study seeded three years of production work.
- **Curriculum, not gallery.** Day 1's lighting is the primitive Day 5's raymarching needs, which Day 9 composes. Each day builds on the last.
- **Explicit reference implementations.** Not cleverness, not perf golf. The point of a reference library is stability.

## Where it stands

Completed. The library files are live in downstream projects; the write-ups sit as a personal reference whenever a shader problem has an obvious shape.
