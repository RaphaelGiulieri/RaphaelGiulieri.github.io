---
id: volum_audio
title: "Volume & audio-device switcher"
tagline: "Windows has no official per-app audio routing API. This bridges Windows Core Audio with NirSoft's CSV output to fake one."
categories: [tools]
skills_short:
  - Windows Core Audio (pycaw)
  - SoundVolumeView CSV bridging
  - Flet UI
  - PyInstaller packaging
year: 2025
status: polished
client: null
role: Solo developer
highlight: false
rank: 58
hero:
  src: assets/projects/volum_audio/hero.webp
  alt: "Audio Switcher — per-app routing dropdowns next to Spotify, Discord, Chrome"
  type: image
gallery:
  - src: assets/projects/volum_audio/01-perapp.webp
    alt: "Per-app device dropdowns showing different output devices for different running apps"
    caption: "Per-app routing: Spotify to headphones, Discord to speakers, Chrome to whatever was last."
headline:
  value: "per-app routing"
  label: "without an official API"
links:
  repo: null
  demo: null
---

# Volume & audio-device switcher

Windows exposes Core Audio for device enumeration and volume control through `pycaw` — but **per-app audio routing has no supported API**. The system setting for "route Spotify to headphones but Discord to speakers" lives in the Sound → App volume panel, and no Python binding reaches it.

This bridges the gap by calling NirSoft's `SoundVolumeView.exe` under the hood, mapping its CSV-format device names to pycaw's GUID-format device IDs, and exposing the whole thing through a small Flet tray UI.

![[gallery:0]]

## Highlights

- **Two device namespaces reconciled** — pycaw's GUID identifiers and SoundVolumeView's friendly names — into a unified table the UI can drive.
- **Shells out to NirSoft's CLI** to actually flip per-app routing. Not pretty, but it's the only reliable path.
- **No auto-refresh.** UI updates only on user action. Background polling causes the dropdowns to flicker as Windows shuffles internal device state.

## Where it stands

Polished. Personal tool — the author flips between speakers / headphones / Discord audio per-app multiple times a day and this eliminates the sound-panel dance.
