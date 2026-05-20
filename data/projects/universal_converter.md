---
id: universal_converter
title: "Universal file converter"
tagline: "A drag-and-drop desktop app that converts images, PDFs, audio and video — always-on-top, compact or expanded, ffmpeg auto-installed."
categories: [tools]
skills_short:
  - Flet desktop UI
  - Format conversion pipelines
  - Auto-bundled ffmpeg
  - Always-on-top windowing
  - PyInstaller packaging
year: 2025
status: shipped
client: null
role: Solo developer
highlight: false
rank: 60
hero:
  src: assets/projects/universal_converter/hero.webp
  alt: "Universal Converter — compact 76px cube floating over the desktop"
  type: image
gallery:
  - src: assets/projects/universal_converter/01-modes.webp
    alt: "Compact cube mode and expanded panel mode side by side"
    caption: "Compact cube for the common case (drop a file, get the converted version). Expanded panel for batch + custom output."
headline:
  value: "8 × 8 × 8"
  label: "image · audio · video formats"
links:
  repo: null
  demo: null
---

# Universal file converter

A small desktop app that turns conversion into a drop-and-drop affair. Stays always-on-top in a 76 × 76 cube; drop a file, it converts to the configured default and lands in a `converted/` folder. Eight image formats, eight audio, eight video, plus PDFs in and out.

The expanded mode is for when the default isn't right — output folder picker, target format dropdown, quality settings. The compact mode is for the common case: most file conversions are "I just want this PNG as a JPEG, right now".

![[gallery:0]]

## Highlights

- **ffmpeg auto-installed** on first run via `imageio-ffmpeg`. No 100 MB binary in the bundle; small download when needed; nothing for the user to configure.
- **Two UI modes, deliberate.** Compact cube for "right now"; expanded for "batch / custom". Same app, different commitments.
- **Background-thread conversion** with progress callbacks. UI stays responsive during a 2 GB MKV transcode.

## Where it stands

Polished. Personal tool used regularly, shipped as a PyInstaller `.exe`.
