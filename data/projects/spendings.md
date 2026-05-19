---
id: spendings
title: "Personal spending tracker (PWA)"
tagline: "A local-first expense tracker that installs to your home screen, works offline, and never ships your data off the device."
categories: [web, tools]
skills_short:
  - React 19
  - Dexie / IndexedDB
  - Tailwind 4
  - PWA service worker
  - Local-first architecture
year: 2025
status: wip
client: null
role: Solo developer
highlight: false
rank: 54
hero:
  src: assets/projects/spendings/hero.webp
  alt: "Spendings tracker — monthly chart with expense list below"
  type: image
gallery:
  - src: assets/projects/spendings/01-mobile.webp
    alt: "Mobile install — running fullscreen on the home screen"
    caption: "Installs to the home screen via PWA. Works offline; data lives in IndexedDB."
headline:
  value: "0 servers"
  label: "data never leaves the device"
links:
  repo: null
  demo: null
---

# Personal spending tracker (PWA)

Expense tracking is an inherently personal dataset. Most consumer apps in this space require an account, sync to a server, and monetise aggregated behaviour. This rejects that model: no backend, no auth, no analytics, no telemetry. The data lives in IndexedDB; the app installs to the home screen via PWA; everything works offline.

The trade-off — no cross-device sync — is an accepted cost. Backup is a JSON export the user controls.

![[gallery:0]]

## Highlights

- **Dexie + dexie-react-hooks** for live IndexedDB queries. Changes in one component re-render every other component that queried that table.
- **Service-worker offline shell** via `vite-plugin-pwa`. Pre-cache the app, runtime-cache fonts, offline fallback page.
- **Local-first by construction.** Nothing leaves the device. No GDPR question to answer because there's nothing to retain.

## Where it stands

Work-in-progress. Core flows in. Open work: budget caps with visual alerts, recurring expenses, schema-versioned JSON export/import. Deployable as a static SPA on Vercel.
