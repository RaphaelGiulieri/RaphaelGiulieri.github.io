---
id: tech_stylization_post
title: "Stylisation & post-processing"
tagline: "A 7-pass retro pipeline that turns a modern WebGPU scene into a 1998 cassette rip. Plus Kuwahara painting, Bayer dithering in perceptual space, and a live retro-intensity slider."
categories: [graphics, rnd]
skills_short:
  - Retro post-processing
  - Bayer dither (perceptual)
  - Kuwahara NPR
  - CRT / VHS aesthetics
  - Selective bloom
year: 2024
year_range: "2021-2025"
status: active
client: null
role: Solo developer
highlight: true
rank: 66
hero:
  src: assets/projects/tech_stylization_post/hero.webp
  alt: "Remain's retro pipeline output — pixelated, dithered, scanlined, VHS-banded"
  type: image
gallery:
  - src: assets/projects/tech_stylization_post/01-retro.webp
    alt: "The 7-pass retro stack at full intensity"
    caption: "Remain's 7-pass retro stack at full intensity. Pixelation, dither, scanlines, VHS bands, vignette."
  - src: assets/projects/tech_stylization_post/02-kuwahara.mp4
    poster: assets/projects/tech_stylization_post/02-kuwahara.webp
    type: video
    alt: "Better Fantasy Grass — a stylised meadow scene processed through a Kuwahara filter, in motion"
    caption: "Better Fantasy Grass: a real-time Kuwahara pass turns the meadow into painterly motion — edge-preserving smoothing, anisotropic kernel, the smear stays coherent as the camera moves."
  - src: assets/projects/tech_stylization_post/03-slider.webp
    alt: "Same scene, two retro-intensity values — clean modern PBR vs full PSX-era chunkiness"
    caption: "Same scene, retro-intensity slider at 0 and 1: the live demo of why PBR matters."
  - src: demos/retro-post.html
    type: shader
    alt: "Live retro CRT post-process pipeline with toggle-able effects"
    caption: "Live demo · single-pass fragment shader · pixelation · 4×4 Bayer dither · scanlines · per-channel chromatic shift · VHS jitter bands · toggle each effect"
headline:
  value: "1 shader · 11 effects"
  label: "single fragment pass"
links:
  repo: null
  demo: null
---

# Stylisation & post-processing

The final chance to change what an image *feels* like. The body of work spans two ends of a spectrum — **the most production-hardened piece is Remain's 7-pass retro stack**, and the conceptual range includes a Kuwahara-filter painterly grass scene, a PSX-era rendering sandbox, and the tuning sliders that make "how retro is this" a runtime knob instead of a compile-time flag.

The retro stack is the headline. Eleven effects composited in order inside one fragment shader: barrel distortion (CRT curvature), pixelation (downsample + nearest), chromatic aberration, volumetric light add, anamorphic bloom add, Bayer 8×8 ordered dither (in perceptual sRGB space, after the transfer), CRT scanlines, optional phosphor mask, VHS grain, VHS tracking bar, vignette. All in one shader because chaining ten one-pass filters would tank mobile fill-rate.

![[gallery:0]]

## Highlights

- **One big post-process shader, not a chain.** Mobile fill-rate is the binding constraint; a single fragment shader doing ten effects is faster than ten 1-effect passes each sampling the scene.
- **Bayer dither in perceptual space.** Quantisation error in linear space is visually nonuniform; dithering after the sRGB transfer puts the noise where human vision distributes evenly.
- **Live retro-intensity uniforms.** Vertex snap, fog band count, Gouraud toggle, texture-resolution scale — all live. Flipping the Gouraud switch reshapes the entire scene's lighting character at runtime.

![[gallery:1]]

## Decisions worth telling

- **Selective bloom over full bloom.** Particles and emissives glow; the rest of the scene doesn't. Cheaper, stronger visual result, halos don't wash out the underlying image.
- **Authentic PSX, not a post-process fake.** Vertex snapping + affine texture mapping + Gouraud lighting happen *upstream*. You can't fake the era's character with a single screen-space filter; you have to do what the period hardware did.
- **Retro mode as a slider, not a flag.** The whole stack scales from "off" through "modern with grain" to "full cassette rip" via a live uniform. Designers tune the era; engineering doesn't have to ship a new build.

## Where it stands

Active. Remain's retro is in production; Qatar 360°'s mood overlays and selective bloom ship; WallpaperShader's post-process chain is the live final stage. The reference implementations from the early shader-master curriculum are still the go-to when a new post-process question comes up.

## See it live

A pared-down version of the retro stack — same single-pass approach, toggle each effect on or off to see what it contributes.

![[gallery:3]]
