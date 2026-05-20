---
id: site_avocat
title: "Law-firm website (Nice, France)"
tagline: "Forty-two hand-written HTML pages, thirty in-depth legal guides, no tracking, no framework, no analytics. The cleanest website I've ever shipped."
categories: [web, client]
skills_short:
  - Semantic HTML5
  - Accessibility-first
  - Schema.org SEO
  - GDPR-by-architecture
  - Vanilla CSS + JS
year: 2025
status: shipped
client: "A Nice-based French lawyer"
role: Solo developer
highlight: true
rank: 68
hero:
  src: assets/projects/site_avocat/hero.webp
  alt: "Law-firm website — landing page in navy and gold"
  type: image
gallery:
  - src: assets/projects/site_avocat/01-article.webp
    alt: "A long-form legal guide article — strong typographic hierarchy, FAQ accordion at the bottom"
    caption: "Thirty long-form legal guides — strong typographic hierarchy, FAQ accordion, schema.org structured data."
  - src: assets/projects/site_avocat/02-mobile.webp
    alt: "The same site on mobile — typography reflows, navigation collapses cleanly"
    caption: "Mobile-first: fluid type via clamp, content reflows from desktop's two-column to a single column."
headline:
  value: "Lighthouse 95+"
  label: "across the board"
links:
  repo: null
  demo: null
---

# Law-firm website (Nice, France)

A professional site for a Nice lawyer with twenty-seven years at the bar. Built entirely in vanilla HTML, CSS, and JavaScript — no build tool, no framework, no analytics, no cookies. Forty-two pages: a homepage, eight practice-area landing pages, four compliance pages, and **thirty in-depth legal guide articles** covering the procedures the firm's clients actually search for.

The decision to reject Next.js + Tailwind was deliberate. The firm's IT person can open any page and read what it does. There's no compiled bundle, no source maps in production, no dependency audit. The site will still work in five years. SEO is guaranteed because there's no JavaScript hydration to delay indexing. GDPR compliance is automatic because no third-party cookies exist; no consent banner is needed.

![[gallery:0]]

## Highlights

- **Thirty legal-guide articles**, each one written to a real client query — divorce by mutual consent, what to do after a *garde à vue*, how to recover a security deposit. Each article carries `Article` + `FAQPage` + `BreadcrumbList` schema, so Google surfaces the FAQ block as a rich snippet.
- **AAA colour contrast, 88 ARIA attributes, skip link, reduced-motion support.** The firm's clientele skews older — high contrast and clear focus rings aren't optional for them.
- **`mailto:` contact form, no backend.** PII never leaves the user's device until they hit send from their own mail client. GDPR-compliant by construction; no email storage, no Mailgun, no audit surface.

![[gallery:1]]

## Decisions worth telling

- **No tracking, ever.** Explicitly no Google Analytics, no Facebook Pixel, no third-party fonts that aren't Google. Stated in the privacy policy; verified by Lighthouse.
- **Fluid typography via `clamp()`** instead of media-query type steps. Smoother scaling, fewer breakpoints, less CSS to maintain.
- **`noindex` on legal/privacy pages.** Mentions légales and privacy policy shouldn't rank for anything; they're required compliance, not content.

## Where it stands

In production. The whole `site/` folder deploys to anything — Vercel, Netlify, an OVH bucket, a USB stick. ~1.1 MB uncompressed. Loads in under a second. The architecture is the deliverable as much as the design.
