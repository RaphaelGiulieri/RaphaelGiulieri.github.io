---
id: tech_volumetric
title: "Volumetric, fluid & atmospheric rendering"
tagline: "Clouds as Navier-Stokes on textures. Fog as a twelve-step volumetric raymarch. Water as flow-maps. The body of work on continuous media."
categories: [graphics, rnd]
skills_short:
  - 2D Navier-Stokes solvers
  - Volumetric raymarching
  - Flow-map water
  - Atmospheric scattering
  - Density-field sampling
year: 2024
year_range: "2021-2025"
status: live R&D
client: null
role: Solo developer
highlight: true
rank: 70
hero:
  src: assets/projects/tech_volumetric/hero.webp
  alt: "Aerial sunset over a volumetric weather system — mountains, mist, and god-rays drawn from a 3D Worley density"
  type: image
gallery:
  - src: assets/projects/tech_volumetric/01-clouds.mp4
    poster: assets/projects/tech_volumetric/01-clouds.webp
    type: video
    alt: "Volumetric clouds with god-rays scattering through the layer over a mountain terrain"
    caption: "Volumetric clouds raymarched through a 3D Worley density texture — god-rays appear naturally where the sun pierces gaps in the layer."
  - src: assets/projects/tech_volumetric/02-fog.webp
    alt: "Mountain ridges silhouetted by atmospheric fog and warm-tinted god-rays"
    caption: "Single-scattering atmospheric fog with god-rays: integrated along the view ray, modulated by the cloud density above."
  - src: assets/projects/tech_volumetric/03-water.mp4
    poster: assets/projects/tech_volumetric/03-water.webp
    type: video
    alt: "Sunset ocean surface with rippling waves and warm reflections"
    caption: "Flow-map water: velocity encoded as RG channels, two time-offset samples blended to hide the seam."
  - src: assets/projects/tech_volumetric/04-thunder.mp4
    poster: assets/projects/tech_volumetric/04-thunder.webp
    type: video
    alt: "Lightning illuminating a thick cloud layer from within"
    caption: "Thunder pass: lightning samples a noise field, the strike injects emissive density into the cloud volume — light scatters out through the same march."
  - src: assets/projects/tech_volumetric/05-scattering.mp4
    poster: assets/projects/tech_volumetric/05-scattering.webp
    type: video
    alt: "Side-by-side comparison of single-scattering vs multi-scattering through the cloud volume"
    caption: "Light scattering: side-by-side compare of single-scattering vs cheap multi-scatter. The integrator runs once; the difference is the phase function."
  - src: assets/projects/tech_volumetric/06-rain.mp4
    poster: assets/projects/tech_volumetric/06-rain.webp
    type: video
    alt: "Heavy rain shafts falling from the cloud underside onto a coastline"
    caption: "Rain shafts: a precipitation density texture displaces the cloud underside; opacity over distance gives the falling-water look without any particle system."
  - src: assets/projects/tech_volumetric/07-foglit.mp4
    poster: assets/projects/tech_volumetric/07-foglit.webp
    type: video
    alt: "Pink-tinted sunset fog hugging a lake with a sun reflection"
    caption: "Sunset fog over a lake — same atmospheric integrator as the day scenes, just a different sun direction and warm extinction profile."
  - src: assets/projects/tech_volumetric/08-erosion.mp4
    poster: assets/projects/tech_volumetric/08-erosion.webp
    type: video
    alt: "Cloud underside being erosion-sculpted by a moving brush"
    caption: "Erosion pass: a brush carves the cloud's underside in real time, sculpting the silhouette without re-baking the volume."
  - src: assets/projects/tech_volumetric/09-precip.mp4
    poster: assets/projects/tech_volumetric/09-precip.webp
    type: video
    alt: "Animated precipitation displacement texture cycling through a storm pattern"
    caption: "The precipitation displacement texture: a cycling density that drives where the rain shafts fall on the underside of the cloud layer."
  - src: assets/projects/tech_volumetric/10-density.mp4
    poster: assets/projects/tech_volumetric/10-density.webp
    type: video
    alt: "Time-lapse of the cloud density field forming and dissolving over many hours"
    caption: "Density timelapse: the volume sampled as the wind field advects the FBM cloud potential — minutes of weather compressed into seconds."
  - src: assets/projects/tech_volumetric/11-windtex.webp
    alt: "RG flow-map showing wind direction encoded as red/green channels"
    caption: "The wind flow map: velocity encoded as RG channels and sampled as a 2D vector field that advects the cloud density above the terrain."
  - src: assets/projects/tech_volumetric/12-worley.webp
    alt: "256³ R8 Worley noise volume rendered as a cube — black cells, red foam"
    caption: "The 3D Worley density volume: 256³ × R8 = 18 MB, stored once, sampled trilinearly along the view ray to give the cloud its shape."
  - src: assets/projects/tech_volumetric/demo.mp4
    poster: assets/projects/tech_volumetric/demo-poster.webp
    type: video
    caption: "20 s flythrough of the volumetric weather system — clouds drift, god-rays sweep, the camera slowly arcs over the terrain."
  - src: demos/fluid-sim.html
    type: shader
    alt: "Live 2D Navier-Stokes fluid simulation"
    caption: "Live demo · 256² velocity grid · 30-iteration Jacobi pressure · vorticity confinement · drag to paint dye"
headline:
  value: "60 fps"
  label: "fluid sim, in-browser"
links:
  repo: null
  demo: null
---

# Volumetric, fluid & atmospheric rendering

The body of work on continuous media — clouds, fog, water, sky, atmosphere. Across three engines and five years. The technique is always the same shape (you have a density or velocity field, you advect it, you composite it with the rest of the scene); the difference is the budget and the engine paradigm.

![[gallery:0]]

The most-correct implementation is the volumetric weather article system — a single density volume sampled along the view ray, lit by a multi-scatter approximation, with a thunder pass, a precipitation displacement, and an erosion sculpt all reading from the same underlying field. The same physics shows up in Remain's clouds (2D Navier-Stokes), Qatar 360° (depth-driven reveal), and earlier Unity work (cloud raymarcher).

![[gallery:1]]

![[gallery:3]]

## Highlights

- **One density volume, four passes.** Cloud, lightning, rain shafts, erosion — every effect samples the same 256³ Worley field. New behaviour ≈ a new shader; the data stays put.
- **Light scattering as a phase function.** Single vs cheap multi-scatter is one slider. The integrator doesn't change; the phase function does.
- **Wind as an RG flow map.** A 2D vector field advects the FBM potential above the terrain. Tunable per scene without rebuilding the volume.

![[gallery:4]]

![[gallery:5]]

## Decisions worth telling

- **Bake the noise once.** 256³ × R8 = 18 MB stored once, sampled trilinearly forever. Re-evaluating at frame time is wasted budget.
- **Ping-pong textures for everything that updates.** Velocity, density, reveal accumulation. Trying to do it in-place gets sync-cost grief.
- **Same noise across call sites.** Drift between three samplers produces visible artifacts. Write once, call thrice.

![[gallery:6]]

![[gallery:7]]

## Under the hood

The pieces that aren't visible in a single frame — the wind flow map, the Worley density, the precipitation cycle, the density timelapse over hours — are what make the system feel like *weather* and not a static skybox.

![[gallery:8]]

![[gallery:9]]

![[gallery:10]]

![[gallery:11]]

## Where it stands

Active. Every project with a sky or a cloud or water or fog draws from this body of work. Open work: 3D fluid solvers in WebGPU at game-tick rates, Gaussian-splat experiments as a volumetric format.

![[gallery:2]]

![[gallery:12]]

## See it live

The fluid solver lifted out of the production stack into a browser tab. The marching-squares iso-extractor that's the 2D ancestor of every isosurface mesher here lives under [tech_compute_procedural](tech_compute_procedural).

![[gallery:13]]
