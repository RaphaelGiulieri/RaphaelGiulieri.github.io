---
id: tech_raymarching_sdf
title: "Raymarching & signed-distance fields"
tagline: "A full SDF library — primitives plus operations — that ships in production. Smooth-min unions are doing most of the work."
categories: [graphics, rnd]
skills_short:
  - SDF primitives + ops
  - Sphere-trace raymarching
  - Volumetric integration
  - Numerical-gradient normals
  - Smooth-min compositing
year: 2024
year_range: "2021-2025"
status: live R&D
client: null
role: Solo developer
highlight: false
rank: 65
hero:
  src: assets/projects/tech_raymarching_sdf/hero.webp
  alt: "A raymarched scene composed from SDF primitives — spheres, capsules, smooth unions"
  type: image
gallery:
  - src: assets/projects/tech_raymarching_sdf/01-library.webp
    alt: "The SDF library — primitives and operations side by side"
    caption: "Primitives plus operations: union, subtraction, intersection, smooth-min, round, onion, repeat, elongate, extrude."
  - src: demos/sdf-raymarch.html
    type: shader
    alt: "Live sphere-traced SDF scene with 3 swappable compositions"
    caption: "Live demo · single-pass sphere-trace · primitives composed with smooth-min unions · 4-sample sub-pixel AA · drag to orbit · switch between Lattice / Hall / Twist"
headline:
  value: "in production"
  label: "WallpaperShader, Qatar 360°"
links:
  repo: null
  demo: null
---

# Raymarching & signed-distance fields

A library, not a demo. The valuable thing about SDF work is the operations — smooth-minimum unions, subtractions, infinite repeats, shell-thickness, extrude-from-2D. With those, a scene becomes a few dozen lines of shader code instead of a mesh asset.

The library lives in WallpaperShader and ports between WGSL and HLSL. Primitives: sphere, box, cylinder, torus, capsule, plane. Operations: union (with smooth-min), subtraction, intersection, round, onion, repeat (infinite), elongate, extrude. The same library shows up integrated into a production raymarch in Qatar 360°'s Discover mode — a twelve-step volumetric march through a depth-driven density field.

![[gallery:0]]

## Highlights

- **Operations matter more than primitives.** Smooth-min union (Inigo Quilez's polynomial form) makes otherwise-obvious joints look continuous; without it, scenes read as Lego.
- **Step-count tuning is the perf knob.** Sixty-four on desktop, twelve on mobile — visual difference small because the density field is smooth.
- **Numerical-gradient normals.** Universal trick; no need for per-primitive analytical normals.

## Where it stands

Active in production. The library is the backbone of WallpaperShader's shipped demos. Next direction: Gaussian splatting as a complementary representation — raymarching's nearest cousin and a closer fit for photogrammetric content.

## See it live

The library distilled into one fragment shader — three scenes you can switch between, all built from the same primitives composed with smooth-min unions, lit through soft shadows and 5-tap ambient occlusion.

![[gallery:1]]
