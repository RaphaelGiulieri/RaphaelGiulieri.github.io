---
id: tech_compute_procedural
title: "Compute shaders & procedural generation"
tagline: "A million-blade grass culler, a Gray-Scott reaction-diffusion sandbox, L-system trees baked offline, simplex-noise archipelagos. The body of work on 'where does the data live'."
categories: [graphics, game, rnd]
skills_short:
  - GPU compute (WGSL / HLSL)
  - Procedural generation
  - DOTS / ECS exploration
  - Reaction-diffusion
  - L-system / FBM noise
year: 2024
year_range: "2021-2026"
status: live R&D
client: null
role: Solo developer
highlight: true
rank: 68
hero:
  src: assets/projects/tech_compute_procedural/hero.webp
  alt: "A montage — Remain's grass culler, ReactionDiffusion patterns, HytaleMods caves"
  type: image
gallery:
  - src: assets/projects/tech_compute_procedural/01-grass.webp
    alt: "Compute-driven grass culler — million-blade grid, only visible blades drawn"
    caption: "Remain's grass culler: a million-blade grid, only the visible ones reach the rasteriser."
  - src: assets/projects/tech_compute_procedural/02-reaction.mp4
    poster: assets/projects/tech_compute_procedural/02-reaction.webp
    type: video
    alt: "Gray-Scott reaction-diffusion patterns growing across a surface"
    caption: "ReactionDiffusion: Gray-Scott in a compute pass, patterns animated by the ongoing simulation."
  - src: assets/projects/tech_compute_procedural/03-rd-sphere.mp4
    poster: assets/projects/tech_compute_procedural/03-rd-sphere.webp
    type: video
    alt: "Reaction-diffusion patterns mapped onto a glossy sphere — alien-egg material"
    caption: "RD on a sphere: the same Gray-Scott field used as a height + colour map on a PBR sphere — material that grew, not painted."
  - src: assets/projects/tech_compute_procedural/04-rd-watery.mp4
    poster: assets/projects/tech_compute_procedural/04-rd-watery.webp
    type: video
    alt: "Watery, blistery reaction-diffusion surface with reflective specular"
    caption: "RD with watery shading: same field, different material response — the bumps catch a moving specular and read like wet paint."
  - src: assets/projects/tech_compute_procedural/05-rd-bricks.mp4
    poster: assets/projects/tech_compute_procedural/05-rd-bricks.webp
    type: video
    alt: "RD pattern blended with a brick wall texture, growing organically over masonry"
    caption: "RD blended with a brick texture: pattern grows over the masonry as if mould — the underlying brick stays readable, the growth feels alive."
  - src: assets/projects/tech_compute_procedural/03-trees.webp
    alt: "Five tree archetypes generated procedurally with seeded RNG"
    caption: "L-system trees baked offline, GPU-instanced at runtime — five archetypes, four variants each."
  - src: demos/wfc-tiles.html
    type: shader
    alt: "Live wave function collapse tile generator"
    caption: "Live demo · 11 tiles · 6 sockets · pick lowest-entropy cell, collapse, propagate adjacency, backtrack on contradiction"
  - src: demos/marching-squares.html
    type: shader
    alt: "Live marching squares iso-contour on metaball field"
    caption: "Live demo · 6 metaballs · 192×120 lattice · 16-case lookup · 8 stacked iso-levels for the topographic mode"
  - src: demos/l-system-tree.html
    type: shader
    alt: "Live L-system tree growth"
    caption: "Live demo · 5 archetypes · turtle interpreter for F · +/− · [ ] · stochastic angle jitter · grows in real time, regenerates after a beat"
  - src: demos/voronoi.html
    type: shader
    alt: "Live Voronoi mosaic with animated sites"
    caption: "Live demo · 40 animated sites · F1 + F2 nearest-distances · cells / edges / Worley / cracked modes · move the cursor to drag a site"
headline:
  value: "1.96M cells"
  label: "culled per frame"
links:
  repo: null
  demo: null
---

# Compute shaders & procedural generation

Two themes that belong together. *Compute shaders* are the mechanism — arbitrary GPU work outside the render pipeline. *Procedural generation* is the main use case — content built at runtime rather than authored. The intersection is most of my engine-level technical work.

The most-recent piece is Remain's grass culler — a compute pass over a 1,400 × 1,400 camera-anchored grid, doing per-blade frustum + region tests, atomically appending the survivors into a draw buffer. Most of the million-and-change blades never reach the rasteriser. The same pattern shows up in earlier Unity work (DrawProcedural's Boids, Grass and Marching Cubes), in WallpaperShader's audio-reactive compute, in HytaleMods' island generator (CPU-side simplex noise feeding a three-layer cave system), and in personal experiments with reaction-diffusion patterns.

![[gallery:0]]

## Highlights

- **State in GPU buffers, drawn via indirect draw.** The compute pass writes survivors; the indirect-draw uses the count from the same buffer. The CPU never knows how many blades are visible.
- **Gray-Scott reaction-diffusion** in a compute sandbox — the patterns look *grown*, not designed, which is exactly what you want for corrosion / mould / biological texture.
- **Same noise primitives across engines.** Simplex / Voronoi / FBM. Used in WGSL (Remain), HLSL (Unity / WallpaperShader), Java (HytaleMods). Same functions, three languages, identical output.

![[gallery:1]]

## Reaction-diffusion as material

The same Gray-Scott field used three ways — as the height + colour of a glossy sphere (the alien-egg material), as a watery blistery surface where the bumps catch a moving specular, and blended over a brick texture so the pattern grows like mould over masonry. One simulation, three different material languages.

![[gallery:2]]

![[gallery:3]]

![[gallery:4]]

## Decisions worth telling

- **Workgroup sizes matched to wavefronts** — 8×8, 64, 128. Mismatched sizes cost half the GPU's throughput silently.
- **Seeded RNG everywhere procedural.** Reproducibility is the feature you didn't know you needed until a bug appears only on seed 4782. All procedural work seeds from a single canonical generator.
- **Bake offline when content is static.** L-system trees are baked then GPU-instanced. Terrain erosion runs once at level-build time. Don't burn frame-budget on what doesn't have to be live.

![[gallery:5]]

## Where it stands

Active. Remain's compute pipeline is the production case study. The DOTS exploration ([code on GitHub](https://github.com/RaphaelGiulieri/ECSProject)) sits as a capability for future large-entity projects. The Gray-Scott reaction-diffusion sandbox is [also public](https://github.com/RaphaelGiulieri/ReactionDiffusion). The next horizon is GPU compute for 3D fluid sims and physics — bridging from "particles and cellular automata" into proper rigid-body / soft-body work.

## See it live

Four procedural-generation classics in a browser tab — wave function collapse on an adjacency-constrained tile set, marching squares contouring an animated metaball field, an L-system tree turtle, and a Voronoi mosaic. Same craft as the production work, no project chrome around it.

![[gallery:6]]

![[gallery:7]]

![[gallery:8]]

![[gallery:9]]
