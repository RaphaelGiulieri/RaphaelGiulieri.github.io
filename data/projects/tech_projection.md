---
id: tech_projection
title: "Projection mapping, skyboxes & flow-maps"
tagline: "Equirectangular sphere authoring, longitude-latitude skybox baking, flow-map water — the body of work on 'how does this 2D texture wrap onto 3D'."
categories: [graphics, rnd]
skills_short:
  - Equirectangular projection
  - Cubemap baking pipelines
  - Flow-map velocity fields
  - Skybox generator tools
  - Unproject matrices
year: 2024
year_range: "2022-2025"
status: active
client: null
role: Solo developer
highlight: false
rank: 63
hero:
  src: assets/projects/tech_projection/hero.webp
  alt: "Equirectangular sphere authoring — designer paints a sky, tool bakes to cubemap"
  type: image
gallery:
  - src: assets/projects/tech_projection/01-skybox.webp
    alt: "SABDA's skybox generator: paint, bake, sample"
    caption: "SABDA's skybox tool: paint procedurally, bake to equirect, sample as cubemap. Free at runtime."
  - src: assets/projects/tech_projection/02-flowmap.webp
    alt: "Flow-map water: RG velocity texture next to its rendered surface"
    caption: "Flow-maps encode velocity as RG; sample twice with time offset; blend to hide the seam."
headline:
  value: "bake-once"
  label: "sample-forever"
links:
  repo: null
  demo: null
---

# Projection mapping, skyboxes & flow-maps

Projection covers a lot of ground — the mapping between a 2D texture and a 3D surface that displays it. Equirectangular panoramas, cubemap skyboxes, flow-maps, screen-space reflection UV lookups, and the discipline of keeping three shaders synced to the same skybox formula so they don't drift visibly.

The centrepiece tool is the SABDA studio's skybox generator: a designer paints a sky procedurally, an editor tool bakes it to an equirectangular render target, runtime samples it as a cubemap. Expensive at design time, free at runtime. The same pattern shows up in Qatar 360° (the production 360° sphere), in Maelstorm (flow-map water), and in the current portfolio's hero shader.

![[gallery:0]]

## Highlights

- **Bake-once-sample-forever.** Universal pattern: do the expensive thing at design time, sample at runtime.
- **Flow-maps for cheap motion.** RG velocity encoding + two-sample blend trick is the standard pattern for water, hair, fur.
- **Same UV formula across three call sites** in Qatar 360°. Drift between them produces visible artifacts; one formula, three call sites.

## Where it stands

Active. Skybox patterns underpin Qatar 360° (live), SABDA (delivered), the portfolio hero shader (tech-art subsite). Flow-maps reappear whenever water or hair is on the menu.
