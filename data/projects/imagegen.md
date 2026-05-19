---
id: imagegen
title: "ComfyUI dashboard for local image generation"
tagline: "A Flask front-end that orchestrates four diffusion backends on an 8 GB GPU — and remembers the quirks of each one so you don't have to."
categories: [ml, tools]
skills_short:
  - Local diffusion stack
  - GGUF quantisation
  - IP-Adapter consistency
  - ControlNet stacking
  - Prompt engineering by shot
year: 2025
status: functional
client: null
role: Solo developer
highlight: true
rank: 78
gallery:
  - src: assets/projects/imagegen/01-character-consistency.webp
    alt: "Four photoreal portraits of the same character — pixie cut, blue eyes, freckles, small cross earring — all preserved across generations"
    caption: "Character consistency in practice: four generations of the same character profile, minutes apart. Face, freckles, hair length, the earring — all preserved. The rig uses IP-Adapter FaceID + a structured prompt ordered face-first for portraits."
  - src: assets/projects/imagegen/02-sprite-scale.webp
    alt: "Four pixel-art knight sprites — two chibi (small-head) variants, two full-size soldier variants — all in the same armoured-guard style"
    caption: "Style-locked sprite generation at two scales — chibi for inventory icons, full-size for in-game characters. Seed numbers in the filenames track the prompt-vs-seed experiment that nailed the chainmail texture."
headline:
  value: "8 GB GPU"
  label: "four backends, one dashboard"
links:
  repo: null
  demo: null
---

# ComfyUI dashboard for local image generation

A Flask dashboard that orchestrates a local image-generation stack on an 8 GB consumer GPU. Four backends — Z-Image Turbo, BigASP v2, vanilla SDXL, and SDXL with IP-Adapter FaceID — each with their own quirks, baked into the dashboard so the user picks an intent (character portrait, environmental, sprite, texture) without having to remember that BigASP needs DPM++ 2M SDE with Karras and a CFG of two-point-something.

The crown-jewel feature is **character profiles**: a structured description of a recurring character — face, body, hair, eye colour, signature accessories, optional LoRA reference — that gets *re-ordered into the prompt depending on the shot type*. Diffusion models weight leading tokens more; a portrait of the same character builds the prompt with face details first, a full-body shot builds it with shot type and pose first.

![[gallery:0]]

## Highlights

- **Four backends, one VRAM budget.** Each gets bespoke handling: GGUF-quantised UNet, CPU-offloaded text encoder, locked-in scheduler, sane CFG. The user picks "Balanced" instead of remembering twelve hyperparameters.
- **Character consistency.** IP-Adapter FaceID + up to five reference images per generation, plus optional LoRA. The same character lands across different scenes, lighting, and poses.
- **Stacked ControlNet** — pose, depth, canny, HED, MLSD all at once with independent strengths, in a single workflow node-graph built procedurally.

![[gallery:1]]

## Decisions worth telling

- Picked **ComfyUI over rolling my own diffusion stack.** The community keeps custom nodes for Z-Image, BigASP and IP-Adapter alive; the dashboard is just procedural workflow construction over a stable API.
- **Quality presets, not raw sliders.** "Turbo / Fast / Balanced / Quality" maps to model-aware step counts and schedulers. The user has shot-type intent, not sampler theory.
- **Prompt re-ordering by shot type** is the surprise that pays off. Diffusion attention decays along token order; ordering matters more than wording.

## Where it stands

Functional. Personal tool. Active threads: LoRA training pipeline against musubi-tuner, overnight IP-Adapter consistency campaigns, and pose-driven generation feeding from extracted OpenPose skeletons.
