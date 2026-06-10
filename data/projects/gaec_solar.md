---
id: gaec_solar
title: "Solar PV 3D modelling & calepinage"
tagline: "A self-directed engineering study: a 337 kWc rooftop solar install — 734 panels, 35 strings, four inverters — modelled parametrically from building-permit drawings."
categories: [3d, docs]
skills_short:
  - Parametric 3D modelling
  - Solar PV engineering
  - Reproducible deliverables
  - French regulatory documentation
  - Editorial documentation HTML
year: 2026
status: self-directed
client: null
role: Solo developer
highlight: true
rank: 70
hero:
  src: assets/projects/gaec_solar/hero.svg
  alt: "Abstract calepinage grid — 734 panels colour-coded into 35 strings (illustrative layout, not the site roof)"
  type: image
gallery:
  - src: demos/gaec_solar.html
    type: shader
    alt: "Interactive abstract calepinage grid and single-line electrical fan-in"
    caption: "Concept demo · 734 panels → 35 strings → 4 inverters → grid (PDL) · hover a panel to read its string · abstract layout, not the site roof."
  - src: assets/projects/gaec_solar/pipeline.svg
    alt: "Process diagram: permit dimensions → generate_mesh.py → OBJ mesh → Excel calepinage → HTML manual"
    caption: "Parametric pipeline (concept diagram): permit dimensions → generate_mesh.py → OBJ → calepinage → HTML manual; re-run regenerates byte-for-byte."
  - src: assets/projects/gaec_solar/wiring.svg
    alt: "Single-line electrical fan-in: 734 panels into 35 strings into 4 inverters into the grid PDL"
    caption: "Electrical fan-in (concept single-line): 734 panels → 35 strings → 4 inverters → grid (PDL). String→inverter grouping is representative, not the as-built combiner map."
headline:
  value: "337 kWc · 734 panels"
  label: "permit-traceable from drawings"
links:
  repo: null
  demo: null
---

# Solar PV 3D modelling & calepinage

A self-directed engineering-documentation study for a 337 kWc rooftop solar installation. Two buildings — one new-build barn, one renovation that replaces an asbestos roof — sharing a single grid connection. **734 panels, 35 electrical strings, four inverters.** Every dimension on the deliverable traces back to a specific page of the permit documents.

![[gallery:2]]

The geometry isn't surveyed; it's modelled parametrically from the dimensions on the building permit. A short Python script reads the permit constants — eave heights, ridge position, structural grid — and emits the OBJ mesh of each building with the panel zone laid out on the roof. Re-run the script after a dimension changes and the mesh regenerates. No magic numbers, no opaque CAD file.

![[gallery:0]]

## Highlights

- **Permit-traceable geometry.** Every dimension in the OBJ comes from a specific document. Re-running the Python regenerates byte-for-byte; an inspector can audit the chain end-to-end.
- **Excel calepinage** as the legally-binding panel schedule. One cell per panel, per row, per roof pan. This is the format French inspectors expect; the engineering deliverable speaks the right language.
- **An HTML installer manual** that walks the SketchUp + Arkelios workflow step by step. Prints clean, works offline on a tablet taken up onto the roof, doesn't need a PDF reader.

![[gallery:1]]

## Decisions worth telling

- **Parametric Python over a Revit / CAD file.** Portable, diffable, regenerable. Anyone can open it in any text editor; the script is 280 lines of obvious code; no proprietary file format to maintain.
- **Excel for the calepinage**, not a custom format. French inspectors expect Excel; engineering doesn't need to fight that.
- **HTML for the installer manual** with embedded Google Fonts and system fallbacks. Prints to PDF cleanly via the browser; works offline; updates by editing one file.

## Where it stands

Built as a self-directed study. The package — three reference PDFs from the permit, two Excel workbooks, the OBJ + MTL files, the HTML manual — is internally consistent and reproducible: re-run the Python and re-open the Excel and you get the same output byte-for-byte.
