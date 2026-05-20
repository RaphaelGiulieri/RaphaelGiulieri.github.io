---
id: lrd_calico
title: "Indie game shader library"
tagline: "A 70-shader production library for an indie studio — bullet impacts, damage flashes, custom-lit characters — all sharing one lighting include so a tweak lands across the whole game at once."
categories: [graphics, game, client]
skills_short:
  - Unity URP shader authoring
  - Custom lighting includes
  - Damage / impact systems
  - MaterialPropertyBlock patterns
  - Shader-library architecture
year: 2023
status: shipped
client: "An indie game studio"
role: Technical Artist
highlight: true
rank: 75
hero:
  src: assets/projects/lrd_calico/hero.mp4
  poster: assets/projects/lrd_calico/hero.webp
  alt: "Calico Inferno combat — explosion debris, impact flashes, and damage feedback all running through the shared shader library"
  type: video
gallery:
  - src: assets/projects/lrd_calico/01-impact.mp4
    poster: assets/projects/lrd_calico/01-impact.webp
    type: video
    alt: "Missile barrage with bright trails arcing across the screen"
    caption: "Missile trails and impact flashes — surface-conforming deformation, designed to read at a glance, all routed through the shared bullet-impact include."
  - src: assets/projects/lrd_calico/02-damage.mp4
    poster: assets/projects/lrd_calico/02-damage.webp
    type: video
    alt: "Scrap-cannon barrage from a player ship — projectiles, hit flashes, debris"
    caption: "Scrap-cannon barrage: every projectile, hit flash, and debris piece runs through the shared library — one tweak in the include and the feel of all of it shifts together."
  - src: assets/projects/lrd_calico/03-outline.mp4
    poster: assets/projects/lrd_calico/03-outline.webp
    type: video
    alt: "Tactical planning mode with dithered transparency and unit outlines"
    caption: "Tactical planning mode: dithered transparency for reveal, plus backface-extrude outlines on units — both library shaders sharing the same include."
  - src: assets/projects/lrd_calico/04-scanner.mp4
    poster: assets/projects/lrd_calico/04-scanner.webp
    type: video
    alt: "Long-range scanner sweep across an asteroid field, debris highlighted"
    caption: "Scanner sweep: a depth-driven outline pulses over hostiles, separation between threat and debris read at a glance — the same depth-mask shader that drives surface-conforming impacts."
  - src: assets/projects/lrd_calico/05-shockwave.mp4
    poster: assets/projects/lrd_calico/05-shockwave.webp
    type: video
    alt: "Expanding shockwave ring distorting the scene as it propagates"
    caption: "Shockwave: a single billboard with a screen-space distortion sample, expanding by a curve. One shader, no particle system."
  - src: assets/projects/lrd_calico/06-blood.mp4
    poster: assets/projects/lrd_calico/06-blood.webp
    type: video
    alt: "Blood-splatter test scene with multiple concurrent hits on a character"
    caption: "Blood-splatter test: multiple concurrent hits compositing through the property-block damage system. Surface-conforming, not flat decals."
  - src: assets/projects/lrd_calico/demo.mp4
    poster: assets/projects/lrd_calico/demo-poster.webp
    type: video
    caption: "20 s of combat from the studio's build — every effect on screen flows through the shader library."
headline:
  value: "70 shaders"
  label: "shipped on one shared include"
links:
  repo: null
  demo: null
---

# Indie game shader library

A full URP shader library shipped into an indie studio's Unity project. Seventy shaders covering character lighting, bullet impacts, damage feedback, blur UI, environment materials, backface outlines, depth-driven surface deformation. The point isn't the count — it's that all seventy lean on **one shared lighting include**, so the studio can tune the rim-light feel of the entire game by editing a single file.

The shaders show up in three places: on characters (a custom-lit pipeline replacing URP's default), on the world (an environment material plus depth-driven trails for footprints, bullet hits and explosions), and on UI (gaussian blur for menus, outlines for selectables). Damage feedback is the clever piece — instead of flashing the whole character when something connects, the shader takes a world-space hit point + radius from a property block and pulses colour locally, so multiple simultaneous hits read as separate wounds.

![[gallery:0]]

![[gallery:1]]

## Highlights

- **One include, seventy shaders.** Tuning "how does rim light feel across the whole game" is editing one file, not seventy. The interface is stable; the implementation isn't.
- **Localized damage flashes.** Hit point + radius come in via property block. Up to N concurrent hits composite. The result reads as "you got shot in the leg", not "the character glowed red".
- **Depth-driven surface deformation.** One shader handles footprints in snow, bullet impacts in grass, and explosion divots in sand — by reading depth against a per-surface mask. One pattern, four behaviours.

![[gallery:2]]

![[gallery:3]]

![[gallery:5]]

## Decisions worth telling

- **A shared include, not copy-paste.** The minute you have more than three shaders, centralise the lighting math. Otherwise fifty shaders carry fifty drifting copies of the same function.
- **Backface-extrude outlines** over screen-space outlines. Cheaper, per-object toggleable, doesn't need a render feature, plays nicely with the studio's low-poly silhouettes.
- **`MaterialPropertyBlock` for dynamic data**, not material instances. Damage points, hit timing, highlight states all flow through property blocks — preserves batching, avoids material proliferation.

![[gallery:4]]

![[gallery:6]]

## Where it stands

Delivered. Shipped into the studio's build. The library design — shared include, property-block dynamic data, depth-driven surface effects — is the pattern most of my Unity client work descends from.

![[gallery:7]]
