---
id: niche_finder
title: "Niche-finder + auto-site generator"
tagline: "A two-bot pipeline: one mines profitable web niches; the other spins up SEO-optimised affiliate sites from the data, with a local LLM doing the copywriting."
categories: [automation, web, ml]
skills_short:
  - Multi-bot orchestration
  - Cloudflare-bypass scraping
  - Local LLM (Ollama)
  - Static-site generation
  - Schema.org SEO
year: 2025
status: live R&D
client: null
role: Solo developer
highlight: false
rank: 62
hero:
  src: assets/projects/niche_finder/hero.webp
  alt: "Niche-finder dashboard — discovered niches ranked by composite profitability"
  type: image
gallery:
  - src: assets/projects/niche_finder/01-dashboard.webp
    alt: "Real-time discovery dashboard with Socket.IO log streaming"
    caption: "Real-time dashboard streams discovery / analysis events as they happen, no page reload."
headline:
  value: "127 affiliate programs"
  label: "hand-curated database"
links:
  repo: null
  demo: null
---

# Niche-finder + auto-site generator

A two-bot pipeline. **NicheFinder** discovers profitable web niches by mining keyword-autocomplete APIs, scraping volume + CPC data, running SERP competitor analysis, and matching against a hand-curated database of one hundred and twenty-seven affiliate programs across thirty-six categories. **SiteCreator** takes the discovered niche, runs a local LLM for article generation, and spins up a complete static affiliate site with Schema.org structured data, sitemap, and embedded affiliate links.

A Flask + Socket.IO dashboard orchestrates both bots with live-streamed progress. Underneath, a `nodriver`-driven Cloudflare-bypass layer keeps the scraping resilient against modern anti-bot.

![[gallery:0]]

## Highlights

- **Local LLM for content generation.** Ollama running Qwen 2.5 Coder. Zero per-token cost during development; unlimited iteration; privacy for the niche choices.
- **Hand-curated affiliate database** over scraped one. A small, correct, dated set of programs is more useful than a bigger, rotting one.
- **Score-then-analyse pipeline.** Quick API-only scoring on a hundred niches, full deep analysis only on the top five. Discovery in minutes, not hours.

## Where it stands

Functional research tool, not a live commercial operation. The reusable parts (nodriver-Cloudflare bypass, Ollama-driven content, Schema.org static-site templates) get pulled into other projects when the shape fits.
