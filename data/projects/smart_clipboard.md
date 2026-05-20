---
id: smart_clipboard
title: "Smart clipboard manager"
tagline: "A Windows clipboard-history manager with favourites, search, and JSON persistence — single binary, no config."
categories: [tools]
skills_short:
  - Flet desktop UI
  - Clipboard polling
  - JSON persistence
  - System-tray integration
year: 2025
status: shipped
client: null
role: Solo developer
highlight: false
rank: 50
hero:
  src: assets/projects/smart_clipboard/hero.webp
  alt: "Smart Clipboard — history list with starred favourites at the top"
  type: image
headline:
  value: "single binary"
  label: "no config, no install"
links:
  repo: null
  demo: null
---

# Smart clipboard manager

A Windows clipboard-history app — Flet UI, system-tray integrated, single PyInstaller binary. Click an item to copy it back. Star one to pin it. Search filters substring-match. State persists between launches.

Background polling watches the clipboard for changes and appends to history with deduplication. Identical-to-previous entries are common (multiple copies of the same value) and would otherwise pollute the list.

## Highlights

- **Background polling deduplicates by previous-value.** Multiple copies of the same string are common and would otherwise pollute the list. Dedup against the previous entry only — full-list dedup would lose chronology.
- **Favourites are pinned to the top.** Starred items survive history rotation. Search is substring-match against the full history.
- **Single PyInstaller `.exe`.** No Python install, no config, no admin. Drop it anywhere and run.

## Decisions worth telling

- **Flet over Electron / Tauri.** Same language as the polling logic, no embedded browser, smaller binary, faster cold start for a tray app that the user opens ten times an hour.
- **JSON persistence instead of SQLite.** The history is a short list of strings; the migrations, schema, and index work SQLite buys are unjustified. One file, atomically rewritten on each change.
- **Six pre-rendered icon sizes (16 → 256).** Windows tray, title bar, alt-tab and `.ico` embedding all sample different sizes; rendering at runtime would scale poorly. Pre-baking once removes the artefact entirely.

## Where it stands

Polished, shipped. Personal tool.
