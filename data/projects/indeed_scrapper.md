---
id: indeed_scrapper
title: "Indeed job-search automation"
tagline: "A Flask dashboard + Selenium automation that tracks every Indeed posting through a five-stage pipeline, with SQLite persistence."
categories: [automation, web]
skills_short:
  - Selenium automation
  - Flask + SQLite
  - Pipeline UX (kanban-style)
  - Local-first state
year: 2024
status: live R&D
client: null
role: Solo developer
highlight: false
rank: 38
hero:
  src: assets/projects/indeed_scrapper/hero.webp
  alt: "Indeed pipeline view — five columns from New through Applied to Rejected"
  type: image
headline:
  value: "5-stage pipeline"
  label: "single-user kanban"
links:
  repo: null
  demo: null
---

# Indeed job-search automation

Built during an active job search. Selenium drives Chrome through Indeed's search UI, extracts every listing on configured queries, and persists to SQLite keyed by Indeed's internal job ID so re-runs dedupe automatically.

A Flask dashboard sits on top: five pipeline columns — **New → Viewed → Interested → Applied → Rejected**. Drag or click to advance a card; notes per job; colour-coded badges for posting age.

## Highlights

- **The value isn't scraping** — Indeed has APIs for that. It's the pipeline-of-applications UI and the zero-network state persistence: nothing leaves the machine.
- **SQLite keyed by job ID** so re-running is cheap and deduped automatically.

## Where it stands

Functional. Used for its intended campaign; still runs.
