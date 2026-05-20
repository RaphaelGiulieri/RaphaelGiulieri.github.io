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

- **Drag-and-drop is the verb.** Drop one file → converted file, no dialog. The 76 × 76 always-on-top cube collapses the whole "open app · pick file · pick format · pick output · click convert" sequence into a single gesture.
- **8 × 8 × 8 formats covered.** Eight image, eight audio, eight video formats — PNG/JPEG/WebP/BMP/TIFF/GIF/ICO/HEIC; MP3/WAV/FLAC/AAC/M4A/OGG/OPUS/WMA; MP4/MKV/MOV/AVI/WEBM/FLV/WMV/MPEG — plus PDF in and out. Covers ~95 % of what you'd actually need.
- **Background-thread conversion** with progress callbacks. UI stays responsive during a 2 GB MKV transcode.

## Decisions worth telling

- **ffmpeg auto-installed on first run, not bundled.** Bundling adds 100 MB to the binary; `imageio-ffmpeg` downloads it on demand, ~30 MB, cached forever. Smaller release, less to package, nothing for the user to manage.
- **Flet over Electron / Tauri.** Single Python process, no embedded Chromium, ~40 MB binary instead of ~120 MB. The downside is a smaller component vocabulary; for a single-cube UI, that's a feature.
- **Two UI modes are a commitment, not a setting.** The compact cube is the entire app surface for the common case; the expanded panel is a separate mental mode. Trying to merge them produced a worse version of both — chose the discontinuity over the compromise.

## Where it stands

Polished. Personal tool used regularly, shipped as a PyInstaller `.exe`.
