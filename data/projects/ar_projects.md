---
id: ar_projects
title: "AR exploration projects"
tagline: "Two Unity XR experiments — face-tracking with XRI, and image-target AR over Pokémon cards and printed mats."
categories: [graphics, game]
skills_short:
  - Unity XR / XRI
  - ARFoundation
  - Face tracking
  - Image-target tracking
year: 2023
year_range: "2022-2023"
status: live R&D
client: null
role: Solo developer
highlight: false
rank: 48
hero:
  src: assets/projects/ar_projects/hero.webp
  alt: "AR card-tracking — a 3D model overlaid on a Pokémon card back"
  type: image
gallery:
  - src: assets/projects/ar_projects/01-face.webp
    alt: "Face-tracking AR with blendshape-driven material parameters"
    caption: "ARFoundation face tracking; blendshape values feed material parameters."
headline:
  value: "ARFoundation"
  label: "iOS + Android, one codebase"
links:
  repo: null
  demo: null
---

# AR exploration projects

Two Unity XR projects exploring two different AR surfaces. Both archived from earlier technical-art work; surface here as evidence of fluency rather than as a flagship.

**Face tracking + XRI**: ARFoundation face tracking with the XR Interaction Toolkit for input. Face-landmark blendshapes map to material parameters so visible effects respond to facial expression. **Image-target AR**: a tracked-image library covering printed references — Pokémon card backs, a playing mat, a legal document. When the camera sees a known image, a 3D overlay anchors with correct world-scale, orientation, and depth.

![[gallery:0]]

## Highlights

- **ARFoundation, not native ARKit / ARCore.** Cross-platform by default; same codebase ships to iOS and Android.
- **Pokémon card back as a worst-case test target.** Densely-patterned, near-symmetric — the worst case for feature-point tracking. Getting stable pose out of it required real care during the reference-image prep.
- **Depth-aware compositing in the shader**, not the render feature. Cheaper on mobile, pass-through for most renderers.

## Where it stands

Functional. Exploration-tier rather than production-tier; the AR surface is a direction the technical-art practice stays current on.
