---
id: tech_lighting
title: "Lighting systems & shading pipelines"
tagline: "From the classical lighting models up through a shared include that drove a 70-shader production library, with cascaded shadows, anisotropic hair, subsurface skin, and Rayleigh sky."
categories: [graphics, rnd]
skills_short:
  - PBR shading
  - Custom lighting includes
  - Shadow cascades
  - Atmospheric scattering
  - Subsurface approximation
year: 2024
year_range: "2021-2025"
status: active
client: null
role: Solo developer
highlight: true
rank: 68
hero:
  src: assets/projects/tech_lighting/hero.webp
  alt: "A side-by-side reference scene showing five lighting models on the same geometry"
  type: image
gallery:
  - src: assets/projects/tech_lighting/01-classical.webp
    alt: "A stylised crystal shader with a 'Specular Lighting' label — one of the classical-model reference scenes"
    caption: "Classical-model reference scenes — Lambert, Blinn-Phong, Cook-Torrance, Oren-Nayar, anisotropic — the studies that seeded the shared CustomLighting include."
  - src: assets/projects/tech_lighting/02-rayleigh.mp4
    poster: assets/projects/tech_lighting/02-rayleigh.webp
    type: video
    alt: "Earth-like planet rotating with a cyan atmospheric limb"
    caption: "Rayleigh scattering at a planet's atmospheric limb — the single-scattering integrator ports between Unity URP and WebGPU without changing the math."
  - src: assets/projects/tech_lighting/03-room.mp4
    poster: assets/projects/tech_lighting/03-room.webp
    type: video
    alt: "Cozy interior with warm light bouncing off plants and a window"
    caption: "An interior reference scene: HDRP indirect bounces driving every secondary surface from one window of warm light."
  - src: assets/projects/tech_lighting/04-pool.mp4
    poster: assets/projects/tech_lighting/04-pool.webp
    type: video
    alt: "Empty pool with cyan water-line light and underwater caustics"
    caption: "Pool reference: water caustics projected via a flow-distorted texture, plus an emissive water-line that spills into the surrounding floor through GI."
  - src: assets/projects/tech_lighting/05-probes.mp4
    poster: assets/projects/tech_lighting/05-probes.webp
    type: video
    alt: "Light-probe debug visualisation showing baked irradiance volumes"
    caption: "Light-probe debug: red emissives feed irradiance into the probe volume, the volume samples back into surrounding surfaces as warm bounce."
  - src: demos/pbr-studio.html
    type: shader
    alt: "Live PBR material studio with metallic, roughness, hue and environment sliders"
    caption: "Live demo · GGX specular · Schlick Fresnel · Smith geometric term · procedural cubemap environment · 5 directional lights · live material parameters"
headline:
  value: "1 include"
  label: "70 shaders, ported across engines"
links:
  repo: null
  demo: null
---

# Lighting systems & shading pipelines

The thread that runs through almost every project I ship — from classical lighting reference scenes through a shared include that powered a 70-shader production library, into a three-cascade WebGPU shadow system in Remain, and an atmospheric scattering integrator that ports between Unity and WebGPU without changing the math.

The body of work is the *throughline*: classical models studied with reference implementations (Lambert, Blinn-Phong, Cook-Torrance, Oren-Nayar, anisotropic), then composed into shared includes that production projects can lean on. When the indie studio I worked with wanted to tune rim-light feel across their entire game at once, the answer was an include rebuild, not seventy shader edits.

![[gallery:0]]

## Highlights

- **One shared include, seventy shaders.** Production case study (LRD Calico). Tuning the lighting feel of a whole game by editing a single file. This is the pattern.
- **Subsurface scattering, the cheap version.** Two-layer wrap-lighting + a per-mesh thickness texture is good enough for skin, ears, leaves at real-time cost. Burley SSS is for cinematic hero characters; this is for game NPCs.
- **Rayleigh scattering ports cleanly.** Same single-scattering integrator runs in Unity HLSL and WebGPU WGSL. The math is portable; only the input semantics (sun direction, view ray, camera) change.

![[gallery:1]]

## Decisions worth telling

- **A shared include, never copy-paste.** The minute you have more than three shaders, centralise. Otherwise fifty shaders carry fifty drifting copies of the same function and you'll never align them again.
- **Hardware PCF** for free shadow anti-aliasing — `textureSampleCompare` is two lines of WGSL and visibly better than plain depth comparisons.
- **Vertex-space lighting as a runtime switch** in Remain. Flipping it on at runtime gives the scene a chunky PSX-era feel; flipping off restores fragment-space PBR. Same shader, different rendering era, one slider.

## Where it stands

Active. The CustomLighting include pattern is now the default approach on new Unity work. Remain's shadow system is in production. The Rayleigh math gets re-imported whenever a sky is needed.

## See it live

The PBR core distilled into one fragment shader — drag the sliders to feel the response of the GGX BRDF across the metallic / roughness / albedo space. Same lobe shape that ships in production.

![[gallery:3]]
