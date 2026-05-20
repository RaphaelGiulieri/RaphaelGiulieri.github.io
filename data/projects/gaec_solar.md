---
id: gaec_solar
title: "Solar PV 3D modelling & calepinage"
tagline: "A 337 kWc rooftop solar install for a French dairy farm — 734 panels, 35 strings, four inverters — modelled parametrically from the building permit drawings."
categories: [client, 3d, docs]
skills_short:
  - Parametric 3D modelling
  - Solar PV engineering
  - Reproducible deliverables
  - French regulatory documentation
  - Editorial documentation HTML
year: 2026
status: shipped
client: "A French dairy farm"
role: Solo developer
highlight: true
rank: 70
hero:
  src: assets/projects/gaec_solar/hero.webp
  alt: "Rooftop solar calepinage rendered over the parametric 3D model of the dairy-farm buildings"
  type: image
gallery:
  - src: assets/projects/gaec_solar/01-mesh.webp
    alt: "Parametric OBJ mesh of the new-build barn with solar panels overlaid"
    caption: "Both buildings modelled parametrically from the permit drawings — re-run the script and the mesh regenerates."
  - src: assets/projects/gaec_solar/02-calepinage.webp
    alt: "Excel calepinage grid showing per-panel layout across the roof"
    caption: "The calepinage grid: one cell per panel, per row. The legally-binding schedule installers must match exactly."
  - src: assets/projects/gaec_solar/03-manual.webp
    alt: "Browser view of the HTML installer manual with table of contents"
    caption: "The installer manual is HTML, prints clean, works on a tablet on the roof, doesn't need a PDF reader."
headline:
  value: "337 kWc · 734 panels"
  label: "permit-traceable from drawings"
links:
  repo: null
  demo: null
---

# Solar PV 3D modelling & calepinage

Engineering documentation for a 337 kWc rooftop solar installation on a French dairy farm. Two buildings — one new-build barn, one renovation that replaces an asbestos roof — sharing a single grid connection. **734 panels, 35 electrical strings, four inverters.** Every dimension on the deliverable traces back to a specific page of the permit documents.

The geometry isn't surveyed; it's modelled parametrically from the dimensions on the building permit. A short Python script reads the permit constants — eave heights, ridge position, structural grid — and emits the OBJ mesh of each building with the panel zone laid out on the roof. Re-run the script after a dimension changes and the mesh regenerates. No magic numbers, no opaque CAD file.

![[gallery:0]]

## Highlights

- **Permit-traceable geometry.** Every dimension in the OBJ comes from a specific document. Re-running the Python regenerates byte-for-byte; an inspector can audit the chain end-to-end.
- **Excel calepinage** as the legally-binding panel schedule. One cell per panel, per row, per roof pan. This is the format French inspectors expect; the engineering deliverable speaks the right language.
- **An HTML installer manual** that walks the SketchUp + Arkelios workflow step by step. Prints clean, works offline on a tablet taken up onto the roof, doesn't need a PDF reader.

![[gallery:2]]

## Decisions worth telling

- **Parametric Python over a Revit / CAD file.** Portable, diffable, regenerable. The client's IT person can open it in any text editor; the script is 280 lines of obvious code; no proprietary file format to maintain.
- **Excel for the calepinage**, not a custom format. French inspectors expect Excel; engineering doesn't need to fight that.
- **HTML for the installer manual** with embedded Google Fonts and system fallbacks. Prints to PDF cleanly via the browser; works offline; updates by editing one file.

## Where it stands

Delivered. The package — three reference PDFs from the permit, two Excel workbooks, the OBJ + MTL files, the HTML manual — is the source of truth for the install. Reproducible: re-run the Python and re-open the Excel and you have the same deliverable byte-for-byte.
