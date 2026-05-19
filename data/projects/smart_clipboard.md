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
status: polished
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

- **Flet over Electron / Tauri.** Single language, no embedded browser, smaller binary.
- **JSON persistence** instead of SQLite. The history is a small list of strings; SQLite's overhead is unjustified.
- **Six pre-rendered icon sizes** (16 → 256). Windows tray, title bar, alt-tab and `.ico` embedding all want different sizes; rendering at runtime would scale poorly.

## Where it stands

Polished, shipped. Personal tool.
