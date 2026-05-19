---
id: custom_engine_tps
title: "TPS on a custom C++ engine"
tagline: "A third-person stealth shooter built on a from-scratch C++ engine, where collision, enemy vision, and the sand trail are all driven by GPU textures instead of CPU data structures."
categories: [game, graphics]
skills_short:
  - Custom C++ engine architecture
  - OpenGL rendering
  - Texture-as-state design
  - Enemy AI state machines
  - ImGui debug tooling
year: 2022
year_range: "2021-2022"
status: completed
client: null
role: Solo developer (school project)
highlight: false
rank: 60
hero:
  src: assets/projects/custom_engine_tps/hero.webp
  alt: "TPS — desert at night, player creeping past patrolling enemies"
  type: image
gallery:
  - src: assets/projects/custom_engine_tps/01-fov.webp
    alt: "Debug visualisation of FOV cones rasterised into a shared visibility texture"
    caption: "Every enemy's FOV cone is rasterised into a shared 2D texture each frame. Visibility check is one sample."
headline:
  value: "Texture-as-state"
  label: "the engine philosophy"
links:
  repo: null
  demo: null
---

# TPS on a custom C++ engine

A third-person stealth shooter built on a from-scratch C++ engine. Player spawns in a desert at night, has to eliminate twenty-five enemies, dies instantly if seen up close. The interesting bit isn't the game — it's that **collision, enemy vision and the terrain's sand trail are all driven by GPU textures instead of CPU structures**.

A 2D collision texture is sampled for every movement query. A FOV texture has every enemy's vision cone rasterised into it each frame; player visibility is one sample. A trail texture is written by the player walking and read by the terrain shader to render footprints. Three engine subsystems collapsed into one *sample-a-texture* pattern.

![[gallery:0]]

## Highlights

- **Texture-as-state.** Three engine systems on one pattern: rasterise into a shared texture, sample at fragment-shader rates. Scales because samples stay O(1) regardless of enemy count.
- **Gradient-descent "pathfinding"** on the collision texture. Not optimal paths, but fast and shader-friendly — good enough for a desert map with a clear flat plane.
- **ImGui-backed debug** that lets gameplay values be tuned at runtime — FOV radius, surface friction, trail decay — without rebuilds.

## Where it stands

Completed. Reference material now — the texture-as-state pattern shows up conceptually in later work (LifeSim's spatial-hash perception, Remain's grass-culling compute).
