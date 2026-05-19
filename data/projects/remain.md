---
id: remain
title: "Remain"
tagline: "A WebGPU multiplayer where the whole frame composites through a 7-pass retro pipeline that makes it look like a 1998 cassette rip of a game that never existed."
categories: [game, graphics, web, ai]
skills_short:
  - WebGPU + WGSL
  - Retro post-processing
  - GPU compute culling
  - Real-time multiplayer
  - Procedural worlds
year: 2025
status: functional
client: null
role: Solo developer
highlight: true
rank: 93
hero:
  src: assets/projects/remain/hero.webp
  alt: "Remain — overcast grassland with a colossus on the horizon"
  type: image
gallery:
  - src: assets/projects/remain/01-grass.webp
    alt: "Close-up of compute-culled grass at the player's feet"
    caption: "Per-blade culling on a million-blade grid runs at 60 fps because most blades never reach the rasteriser."
  - src: assets/projects/remain/02-colossus.webp
    alt: "Player swinging from a grappling hook around the colossus's leg"
    caption: "The colossus is hit-tested before skinning, so the grappling hook lands on bone, not animation."
  - src: assets/projects/remain/03-clouds.webp
    alt: "Fluid-simulated clouds reacting to the colossus walking through them"
    caption: "Clouds run a 2D Navier-Stokes solve on textures; the colossus is a moving pressure source."
  - src: assets/projects/remain/demo.mp4
    poster: assets/projects/remain/demo-poster.webp
    type: video
    caption: "60 s of play — multiplayer, grappling, the cloud sim, the retro post."
headline:
  value: "60 fps · WebGPU"
  label: "in a browser tab"
links:
  repo: null
  demo: null
---

# Remain

A WebGPU multiplayer set in an overcast grassland with a road, a lake, a giant skinned colossus, a herd of curious AI weirdos, floating sky structures, fluid-simulated clouds, flying snakes, stilt striders, and a grappling hook that actually feels good. Built solo. No runtime dependencies on the client.

You drop in alongside a few other players — voice chat is spatial, so people farther away sound farther away. The world is present whether you do anything or not: the herd wanders, the colossus wades through clouds, the wind moves the grass. You can grapple onto buildings, the colossus, breakable rocks, or each other. Everything composites through a final pass that gives the whole image the texture of a 1998 cassette rip — pixelation, dither, scanlines, VHS bands, chromatic aberration — without breaking the underlying physics or readability.

![[gallery:0]]

## Highlights

- A million-blade grass field rendered at 60 fps because most blades never get drawn — a compute pre-pass discards anything outside the camera's frustum, anything in the road or lake, and anything on a slope steeper than the grass cares about.
- The colossus is **hit-testable before it's animated** — the grappling hook lands on bone geometry, not on whatever the skinning shader produced that frame. Feels surgical instead of sloppy.
- Clouds aren't a billboard trick. They're a 2D Navier-Stokes solve on texture pairs, with the colossus injected as a pressure source. You can see it walking through them.

![[gallery:2]]

## Decisions worth telling

- Picked **WebGPU over WebGL** because the compute shaders are the entire point. WebGL couldn't have done the grass culler, the skinning, or the cloud sim at speed.
- The whole post-process is **one giant fragment shader**, not a chain — chaining ten one-pass filters would tank mobile fill-rate.
- Multiplayer runs on a single hand-rolled file: the server only relays. Authority for the colossus and herd belongs to whichever player has the lowest UUID hash. No leader-election RPC, no dedicated sim server.

![[video:demo]]

## Where it stands

Functional and playable. Recent work: cigarette + smoke props, terrain erosion baking, tentacle-fur strand rendering, a death system covering falls, drowning, colossus stomps and monster kills. Active areas: environmental storytelling beats, more creature behaviours, packet-loss robustness.

The retro composite that turns the modern frame into a 1998 cassette rip has its own showcase under [tech_stylization_post](tech_stylization_post). The herd behaviour — Reynolds' three rules with predators chasing prey — was built for SABDA's underwater installation and lives there as a live demo.
