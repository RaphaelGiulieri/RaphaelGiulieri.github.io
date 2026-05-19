# CLAUDE.md — /tech-art/ sub-site

This file provides guidance for the **technical-artist journey site** that lives at `raphaelgiulieri.github.io/tech-art/`.

## Project Overview

Deep-dive / technical-artist showcase sub-site for Raphael Giulieri. Static site with a "Vertical Journey" concept—users scroll from Sky → Sea → Depths through themed zones. No build system; pure vanilla HTML/CSS/JS served via GitHub Pages.

**Relationship to the main site**: this is linked from the editorial root at `raphaelgiulieri.github.io/`. The nav logo goes back to `../`. The main site is a different codebase that lives at the repository root; this folder is intentionally self-contained.

## Development

**Local preview:** Open `index.html` directly in browser, or use a local server:
```bash
python -m http.server 8000
# or
npx serve
```

**Deploy:** Push to `main` branch—GitHub Pages auto-deploys.

**Note:** The skybox texture (`assets/skybox/sky_06_2k.png`) loads via WebGL and may show CORS errors when opened via `file://` protocol. Use a local HTTP server or test on GitHub Pages.

## Architecture

### Zone System
The page is divided into 6 scrollable zones, each with distinct visual treatment:
- **Sky** (`zone-sky`): Hero section with WebGL equirectangular skybox shader
- **Overlook** (`zone-overlook`): Gallery room with experience posters + window showing synced skybox
- **Surface** (`zone-surface`): Ocean transition with Gerstner wave shader
- **Aquarium** (`zone-aquarium`): Skills section with Canvas 2D fish boids simulation
- **Bunker** (`zone-bunker`): Projects cinema room
- **Mine** (`zone-mine`): Contact section with floating crystal particles

### Key Classes in main.js

| Class | Purpose |
|-------|---------|
| `EnvironmentRenderer` | WebGL2 renderer managing fullscreen shaders (skybox, ocean, underwater) |
| `ZoneManager` | IntersectionObserver-based zone detection, updates `state.currentZone` |
| `FishBoids` | Canvas 2D boid simulation (separation, alignment, cohesion) |
| `SkyboxParallax` | Canvas 2D renderer for the gallery window, syncs UV sampling with hero shader |
| `CrystalParticles` | Floating particle effect for the mine/contact section |

### Shader Programs
All shaders are inline GLSL strings in `main.js`:
- `programs.skybox`: Equirectangular panorama sampling with time drift, scroll-based fade
- `programs.ocean`: Gerstner waves + simplex noise foam + caustics
- `programs.underwater`: Deep blue gradient with animated caustics and floating particles

### State Management
Global `state` object tracks: `scrollY`, `scrollProgress`, `currentZone`, `mouse`, `time`, `isUnderwater`

### Window-Hero Skybox Sync
The gallery window (`SkyboxParallax`) must use identical UV formulas as the hero shader:
- Horizontal: `hCenter + (screenUV.x - 0.5) * hFov` where `hCenter = 0.5 + time * 0.001`
- Vertical: `vBase - (screenUV.y - 0.5) * vFov` clamped to `[0.05, 0.55]`
- Time scale difference: Hero shader receives seconds, `SkyboxParallax.update()` receives milliseconds from `performance.now()`

## File Structure

```
├── index.html          # All HTML structure
├── css/style.css       # All styles (CSS custom properties, zone theming)
├── js/main.js          # All JavaScript (WebGL, Canvas 2D, interactions)
└── assets/
    ├── images/posters/ # Experience section images
    └── skybox/         # Equirectangular panorama + cubemap faces
```

## CSS Zone Variables

Color palette defined in `:root`:
- Sky: `--sky-gold`, `--sky-orange`, `--sky-pink`, `--sky-blue`
- Ocean: `--ocean-deep`, `--ocean-glow`, `--ocean-bio`
- Bunker: `--bunker-dark`, `--bunker-steel`
- Mine: `--mine-crystal-cyan`, `--mine-crystal-amber`, `--mine-crystal-purple`
