---
id: planning_manager
title: "Workforce scheduling SaaS"
tagline: "A team-leader was hand-rotating a six-person rota each week in Excel and getting it wrong. This generates three legal options in four clicks."
categories: [web, client, tools]
skills_short:
  - FastAPI + Pydantic
  - Constraint-satisfaction scheduling
  - Excel + PDF export
  - Domain-specific UX
  - eTemptation XML import
year: 2025
status: shipped
client: "A French workforce-management team"
role: Solo developer
highlight: true
rank: 78
hero:
  src: assets/projects/planning_manager/hero.webp
  alt: "Planning Manager — the variant chooser, three weekly schedules side by side"
  type: image
gallery:
  - src: assets/projects/planning_manager/01-import.webp
    alt: "Importing the previous week's eTemptation XML into the system"
    caption: "Drag-and-drop the previous week's eTemptation XML — the system splits it into employees, days, and shift codes."
  - src: assets/projects/planning_manager/02-variants.webp
    alt: "Three generated variants of next week's schedule with warning counts"
    caption: "Three variants every week: raw rotation, coverage-first, adjacency-first. The team-leader picks one in a click."
  - src: assets/projects/planning_manager/03-pdf.webp
    alt: "Printed PDF schedule pinned to a noticeboard"
    caption: "The output is a styled PDF and Excel — what gets pinned on the noticeboard, what gets sent to HR."
headline:
  value: "Hours → minutes"
  label: "weekly rota generation"
links:
  repo: null
  demo: null
---

# Workforce scheduling SaaS

Every week, a team-leader at a French workforce-management firm sat down with Excel and hand-rotated next week's rota across six employees — and every week, something slipped. Somebody worked Sunday three weeks running. Somebody had a rest day split across the wrong gap. Operational coverage between 7 and 9 had a hole nobody noticed until Friday. French labour-law constraints compound; the rotation was deterministic but error-prone.

This replaces that. The previous week's schedule arrives as an eTemptation XML export. The system parses it, applies a shift-down-by-one rotation, runs a constraint-satisfaction fixer for staffing minimums and operational coverage, and produces **three variants** to choose between — raw rotation (baseline), coverage-first (fix gaps even at the cost of rest adjacency), adjacency-first (preserve consecutive rest even with small gaps). The team-leader picks one and gets a printable PDF + an Excel for HR.

![[gallery:0]]

## Highlights

- **Three variants, one human pick.** The constraint solver always finds *a* legal schedule; "which trade-off is acceptable this week" is a judgement call. Surfacing it explicitly puts the leader in the loop instead of pretending automation can decide.
- **Auto-learns shift codes.** The moment management invents a new code — a 4L800-1200 slot, say — the system picks it up on next import. No code deploy needed.
- **The PDF is the product.** Styled per-shift colours, French day-name abbreviations, A4 landscape, fits on one printable page. The schedule lives on the noticeboard; the database is just the source of truth behind it.

![[gallery:2]]

## Decisions worth telling

- **JSON files over a database.** One scheduler, six employees, fifty-two weeks a year. The overhead of an ORM, migrations and a schema-versioning scheme outweighs the storage win at this scale.
- **Vanilla JS over a framework** for the frontend. The IT person on the client's side can open the HTML and read what it does. Component state would be a nice-to-have; a four-step wizard is fine in plain JavaScript.
- **The constraint solver runs heuristics, not an ILP**. Twenty iterations, greedy swap-and-score, three variants. Optimal isn't the goal; *legal and explicable* is.

## Where it stands

In production. The team-leader's weekly Excel ritual went from a couple of hours to a four-click wizard, and the rotations don't drift any more. Open work is mostly per-employee preferences — an employee saying "I prefer Sunday off to Saturday off" should be a soft constraint, not a manual fix.
