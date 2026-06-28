---
id: site_avocat
title: "Law-firm website (Nice, France)"
tagline: "Forty-two semantic-HTML pages, thirty in-depth legal guides, no tracking, no framework, no analytics. AI-assisted build; a complete build — not yet deployed."
categories: [web, client]
skills_short:
  - Semantic HTML5
  - AI-assisted development
  - Accessibility-first
  - Schema.org SEO
  - Vanilla CSS + JS
year: 2025
status: self-directed
client: null
role: Solo developer
highlight: true
rank: 68
hero:
  src: assets/projects/site_avocat/hero.svg
  alt: "De-identified type specimen of the firm's design system — not the live client site"
  type: image
gallery:
  - src: demos/site_avocat.html
    type: shader
    aspect: "16 / 10"
    alt: "Interactive de-identified design system — type scale, FAQ accordion, desktop-to-mobile reflow"
    caption: "Design system (de-identified, placeholder copy): the clamp() type scale, a working FAQ accordion, and the real two-column → one-column reflow. Toggle desktop / mobile. Not the client's site."
  - src: assets/projects/site_avocat/architecture.svg
    alt: "Sitemap diagram — 42 pages, 30 legal guides with schema.org, zero-dependency stack"
    caption: "Information architecture: 42 semantic-HTML pages — home, 8 practice areas, 4 compliance pages, and 30 legal guides each carrying Article + FAQPage + BreadcrumbList schema. AI-assisted build, no framework, no build step, no analytics. Concept diagram, not the live site."
  - src: assets/projects/site_avocat/performance.svg
    alt: "Performance infographic — 0 frameworks, 0 trackers, 0 cookies, ~1.1 MB, sub-1s load, Lighthouse 95+"
    caption: "Zero frameworks, zero trackers, zero third-party cookies — ~1.1 MB, sub-1s load, Lighthouse 95+, 88 ARIA attributes, AAA contrast. GDPR-compliant by architecture. Figures per dossier, not live-measured."
headline:
  value: "Lighthouse 95+"
  label: "across the board"
links:
  repo: null
  demo: null
---

# Law-firm website (Nice, France)

A self-directed build for a small Nice law firm — complete, though not yet deployed. Built in vanilla HTML, CSS, and JavaScript with significant AI assistance for the legal-guide copy and the schema-rich page scaffolding — no build tool, no framework, no analytics, no cookies in the shipped output. Forty-two pages: a homepage, eight practice-area landing pages, four compliance pages, and **thirty in-depth legal guide articles** covering the procedures the firm's clients actually search for.

The decision to reject Next.js + Tailwind was deliberate. Anyone can open any page and read what it does. There's no compiled bundle, no source maps in production, no dependency audit. The site will still work in five years. SEO is helped because there's no JavaScript hydration to delay indexing. GDPR compliance is automatic because no third-party cookies exist; no consent banner is needed.

![[gallery:1]]

## Highlights

- **Thirty legal-guide articles**, each one written to a real legal query — divorce by mutual consent, what to do after a *garde à vue*, how to recover a security deposit. Each article carries `Article` + `FAQPage` + `BreadcrumbList` schema, so Google surfaces the FAQ block as a rich snippet.
- **AAA colour contrast, 88 ARIA attributes, skip link, reduced-motion support.** The firm's clientele skews older — high contrast and clear focus rings aren't optional for them.
- **`mailto:` contact form, no backend.** PII never leaves the user's device until they hit send from their own mail client. GDPR-compliant by construction; no email storage, no Mailgun, no audit surface.

![[gallery:0]]

## Decisions worth telling

- **No tracking, ever.** Explicitly no Google Analytics, no Facebook Pixel, no third-party fonts that aren't Google. Stated in the privacy policy; verified by Lighthouse.
- **Fluid typography via `clamp()`** instead of media-query type steps. Smoother scaling, fewer breakpoints, less CSS to maintain.
- **`noindex` on legal/privacy pages.** Mentions légales and privacy policy shouldn't rank for anything; they're required compliance, not content.

![[gallery:2]]

## Where it stands

Complete — built, but not deployed or published (local only). The whole `site/` folder deploys to anything — Vercel, Netlify, an OVH bucket, a USB stick. ~1.1 MB uncompressed. Loads in under a second. The architecture is the deliverable as much as the design.
