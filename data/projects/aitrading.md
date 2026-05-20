---
id: aitrading
title: "Quantitative trading R&D framework"
tagline: "A live paper-trading system that bets only when the math agrees — and a multi-agent supervisor that runs the research overnight."
categories: [ml]
skills_short:
  - Quantitative ML
  - Walk-forward validation
  - Conformal prediction
  - Risk-managed sizing
  - Multi-agent automation
year: 2025
status: shipped
client: null
role: Solo developer
highlight: true
rank: 91
hero:
  src: assets/projects/aitrading/hero.webp
  alt: "AITrading — equity curve over the live paper-trading window"
  type: image
gallery:
  - src: assets/projects/aitrading/01-dashboard.webp
    alt: "The Flask dashboard — current positions, signals, drawdown, model AUC per ticker"
    caption: "The dashboard tells you what's happening right now: positions, calibrated probabilities, current drawdown, circuit-breaker state."
  - src: assets/projects/aitrading/02-walkforward.webp
    alt: "Walk-forward validation chart with purged embargo gaps"
    caption: "Five folds, embargo gaps where the label could leak — every result you'll ever cite has to come out of one of these windows."
  - src: assets/projects/aitrading/03-orchestrator.webp
    alt: "Overnight orchestrator log — research and dev agents working in parallel"
    caption: "Overnight, an orchestrator dispatches research + dev agents on a budget and files results into a searchable knowledge store."
  - src: assets/projects/aitrading/demo.mp4
    poster: assets/projects/aitrading/demo-poster.webp
    type: video
    caption: "Dashboard tour — opening positions, the gating logic, an overnight run."
headline:
  value: "Sharpe 1.4 – 1.7"
  label: "live paper, walk-forward"
links:
  repo: null
  demo: null
---

# Quantitative trading R&D framework

A multi-year quantitative research programme that turned into a live paper-trading system. Eight tickers, automatic overnight signals, calibrated probabilities, per-trade sizing tied to confidence, broker integration via bracket orders. The framework's job is to *not* bet when the math doesn't agree.

Each night, an AI orchestrator dispatches research and development agents on a budget. They run new experiments, file the results, and the next morning starts with a fresh shortlist of tested ideas. During market hours, the production loop generates calibrated signals, sizes positions against win-probability, and routes orders to the broker before the open. Headline result over walk-forward validation: a blended Sharpe of **1.4 to 1.7**.

![[gallery:1]]

## Highlights

- **Conformal prediction abstains on ambiguous trades.** The bot literally chooses not to bet when the signal isn't strong enough — across the validation set, that's roughly 30 % of opportunities skipped, with the survivors meaningfully sharper.
- Each ticker gets its **own bespoke feature set**, scored against the others before it earns a slot in the live portfolio. NVDA's hard; treating it like Apple was the original sin.
- The overnight orchestrator runs research as a job — hypothesis, experiment, validation, write-up — and **persists everything in a searchable memory store**. The next morning's first action is reading what last night's runs found.

![[gallery:2]]

## Decisions worth telling

- Chose **walk-forward with purged embargo** over k-fold cross-validation. K-fold's information leakage produced fantasy backtests; walk-forward's results survive contact with reality.
- Half-Kelly sizing, not full. Full-Kelly is mathematically optimal but psychologically unbearable when a four-percent drawdown is in your "expected" zone.
- Realistic backtester from day one — fees, slippage, ATR stops, partial exits, time stops. The original frictionless results are kept around as historical reference, marked clearly so they can never sneak into a current claim.

![[video:demo]]

## Where it stands

Live on paper since spring 2025. Real-money go-live is gated on a thirty-day clean track. The current frontier is making the orchestrator run longer experiments unattended — multi-day campaigns that wake up with their own progress reports.
