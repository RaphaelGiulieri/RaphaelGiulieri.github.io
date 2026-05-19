---
id: sabda_vfx
title: "Immersive 360° exhibition VFX"
tagline: "Handpainted skies that bake to a cubemap, audio-reactive ambience driven by live FFT, and an editor tool that makes investor renders happen without the art team stopping work."
categories: [graphics, game, client]
skills_short:
  - Unity HDRP + URP
  - Audio-reactive shaders
  - Skybox baking pipeline
  - Editor tool authoring
  - Handpainted asset integration
year: 2024
year_range: "2023-2024"
status: delivered
client: "A studio producing immersive 360° exhibitions"
role: Technical Artist
highlight: true
rank: 74
hero:
  src: assets/projects/sabda_vfx/hero.webp
  alt: "SABDA — sunset 360° ocean panorama with island silhouettes and reflections, the production exhibition's hero scene"
  type: image
gallery:
  - src: assets/projects/sabda_vfx/01-skybox.webp
    alt: "View from above the cloud layer with a planet on the horizon — a baked handpainted skybox in use"
    caption: "Designer authors a sky procedurally in editor; the tool bakes it to a cubemap; the runtime samples it for free."
  - src: assets/projects/sabda_vfx/02-audio.mp4
    poster: assets/projects/sabda_vfx/02-audio.webp
    type: video
    alt: "Underwater Sabda installation — bioluminescent particles, audio-reactive coral, custom water surface"
    caption: "Underwater scene: bioluminescent particles + audio-reactive coral coloration. FFT bands drive material parameters across the scene."
  - src: assets/projects/sabda_vfx/03-aquarium-dive.mp4
    poster: assets/projects/sabda_vfx/03-aquarium-dive.webp
    type: video
    alt: "Camera dive past illuminated coral colonies in the underwater installation"
    caption: "Diving past the illuminated coral colonies — the lighting beacons and bioluminescent particles all reach for the same FFT-driven uniform."
  - src: assets/projects/sabda_vfx/04-sky-bake.mp4
    poster: assets/projects/sabda_vfx/04-sky-bake.webp
    type: video
    alt: "In-engine view of the skybox-bake editor tool generating an equirectangular cubemap"
    caption: "The skybox generator at work: handpainted sky → equirectangular render target → cubemap → runtime sample. Authored once, free forever."
  - src: assets/projects/sabda_vfx/05-coral.mp4
    poster: assets/projects/sabda_vfx/05-coral.webp
    type: video
    alt: "Audio-reactive coral lighting cycle — colors pulse with bass / treble bands"
    caption: "Coral lighting: bass band drives the deep-tone pulse, treble drives the highlights. Same uniform routes to every audio-reactive surface."
  - src: assets/projects/sabda_vfx/06-iteration.mp4
    poster: assets/projects/sabda_vfx/06-iteration.webp
    type: video
    alt: "Mid-iteration sandbox build — exposing the skybox + audio uniforms to the design team"
    caption: "Mid-iteration sandbox: the design team probed the skybox + audio uniforms here before changes promoted into the production exhibition build."
  - src: assets/projects/sabda_vfx/demo.mp4
    poster: assets/projects/sabda_vfx/demo-poster.webp
    type: video
    caption: "25 s tour through the underwater installation — bioluminescence and coral driven by the live audio FFT."
  - src: demos/boids.html
    type: shader
    alt: "Live boids predator-prey flocking — the marine-life simulation from the underwater installation"
    caption: "Live demo · the CPU-boids marine-life simulation built for the underwater installation · prey on Reynolds' three rules · predators pursue the nearest target · prey flee within fear range · cursor (left-click to toggle) acts as phantom prey or predator"
headline:
  value: "3 exhibitions"
  label: "delivered to a 360° venue"
links:
  repo: null
  demo: null
---

# Immersive 360° exhibition VFX

Three project folders' worth of work for a studio that produces 360° immersive exhibitions — installation pieces meant to be experienced in a hemispheric venue. The job was technical-artist-flavoured: not shipping a game, but building the visual pipeline a non-technical design team could feed into. Handpainted skies, audio-reactive ambience, equirectangular skybox generation, editor-side render-texture tooling, and the unglamorous-but-valuable plumbing that lets investor renders happen without the art team stopping work.

The work spanned an HDRP reference build (quality target), the production exhibition (URP, runs reliably across hardware), and a sandbox where new mechanics got prototyped before promotion. The thread between them is the same set of editor tools and runtime systems — designed once, polished iteratively, deployed three times.

![[gallery:0]]

![[gallery:1]]

## Highlights

- **The skybox generator.** A designer paints a sky procedurally; an editor tool bakes it to an equirectangular render target; the runtime samples it as a cubemap. Expensive at design time, free at runtime — the wheel of real-time graphics, applied where it matters.
- **Audio-reactive ambience that doesn't jitter.** FFT on the exhibition's live audio, perceptually-binned, smoothed in time. Bass shakes the rocks, mid-band ripples water, treble sparkles on highlights — without ever feeling twitchy.
- **An investor render-texture generator.** Automates high-resolution stills from fixed vantage points so pitch decks happen without the art team stopping to frame shots. Boring tool, outsized impact on velocity.

![[gallery:2]]

![[gallery:3]]

![[gallery:4]]

## Decisions worth telling

- **HDRP for the quality bar; URP for the production build.** The exhibition needs consistent frame-rate across a wider hardware envelope; HDRP is the reference target the URP build chases.
- **Bake-once-sample-forever.** The expensive sky happens in editor at design time, not every frame at runtime. Same logic across the whole pipeline: authored at design time, sampled at runtime.
- **Half the value was the editor tools.** The art team used the generator and the render-texture pipeline directly. The runtime shaders mattered, but the *pipeline* was the deliverable.

![[gallery:5]]

![[gallery:6]]

## Where it stands

Delivered. Three installation cycles across roughly a year of technical-artist work. The skybox-bake pattern, audio-reactive plumbing, and editor-render automation reappear in later projects — both client and personal.

![[gallery:7]]

## See it live

The CPU-boids marine-life simulation built for the underwater installation, lifted out of the engine and running in your browser tab — Reynolds' three rules, predators pursuing prey, prey fleeing within fear range. Same code that drove the fish schools in the production exhibit.

![[gallery:8]]
