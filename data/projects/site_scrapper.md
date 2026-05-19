---
id: site_scrapper
title: "LinkedIn scraper with LLM parsing"
tagline: "A scraper that pulls LinkedIn job pages and pipes the raw HTML through an LLM to extract structured data — because LinkedIn's DOM changes every second Tuesday."
categories: [automation, ml, web]
skills_short:
  - Selenium browser automation
  - LLM-driven extraction
  - Schema-prompted JSON
  - DOM-churn resilience
year: 2025
status: functional
client: null
role: Solo developer
highlight: false
rank: 42
hero:
  src: assets/projects/site_scrapper/hero.webp
  alt: "Scraper dashboard — raw HTML on the left, extracted JSON on the right"
  type: image
headline:
  value: "DOM-churn resilient"
  label: "by design"
links:
  repo: null
  demo: null
---

# LinkedIn scraper with LLM parsing

A scraper that resists the DOM churn LinkedIn puts every CSS-selector-based crawler through. Instead of chasing constantly-shifting class names, it pulls the raw HTML, cleans it into a digestible representation, and **passes it to either Claude or GPT** with a schema prompt that returns structured JSON: role, company, level, location, salary, description, skills, posted-age.

When LinkedIn reorganises a section, the LLM still recognises the content from context even if the CSS class has mutated from `jobs-description-content__text` to `jobs-unified-top-card__job-title-v2`. Trade-off: per-page cost of a few hundred tokens versus the zero cost + constant breakage of CSS-selector scraping.

## Highlights

- **Provider-agnostic.** Same prompt, swap between Claude and GPT via a config flag.
- **Manual-correct UI** for edge cases where the LLM got a field wrong. Corrections get logged and can be folded into a refined system prompt.

## Where it stands

Functional. Part of a personal job-search toolkit. Useful as a reference for when LLM-driven extraction beats brittle CSS scraping.
