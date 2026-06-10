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
  src: assets/projects/aitrading/hero.svg
  alt: "AITrading — signal pipeline from market data through a conformal abstention gate to a sized bracket order"
  type: image
gallery:
  - src: assets/projects/aitrading/pipeline.svg
    alt: "Data-and-signal pipeline diagram — features per ticker, calibrated model, conformal abstention gate, risk-managed sizing, broker"
    caption: "The pipeline: per-ticker feature sets feed a calibrated model, a conformal gate abstains on weak signals, then risk-managed ATR sizing routes bracket orders to the broker. Concept diagram, not a screenshot."
  - src: assets/projects/aitrading/walkforward.svg
    alt: "Walk-forward validation diagram — five folds with purged embargo gaps"
    caption: "Walk-forward with purged embargo: five folds, embargo gaps where the label could leak — every cited result comes out of one of these out-of-sample windows. Illustrative fold layout."
  - src: assets/projects/aitrading/orchestrator.svg
    alt: "Overnight orchestrator diagram — research and dev agents dispatched on a budget into a memory store, handed off each morning"
    caption: "The overnight orchestrator: a leader routes ephemeral research + dev agents on a budget, each run filed into a searchable memory store the next morning reads first."
headline:
  value: "conformal abstention"
  label: "bets only when the math agrees"
links:
  repo: null
  demo: null
---

# Quantitative trading R&D framework

A multi-year quantitative research programme that turned into a live paper-trading system. Eight tickers, automatic overnight signals, calibrated probabilities, per-trade sizing tied to confidence, broker integration via bracket orders. The framework's job is to *not* bet when the math doesn't agree.

Each night, an AI orchestrator dispatches research and development agents on a budget. They run new experiments, file the results, and the next morning starts with a fresh shortlist of tested ideas. During market hours, the production loop generates calibrated signals, sizes positions against win-probability, and routes orders to the broker before the open. The thesis isn't a number on a chart — it's a discipline: bet only when the calibrated probability and the conformal gate agree, and abstain otherwise.

![[gallery:0]]

## Highlights

- **Conformal prediction abstains on ambiguous trades.** The bot literally chooses not to bet when the signal isn't strong enough — in practice that means roughly a third of candidate opportunities get skipped, and only the higher-conviction survivors ever reach the order router.
- Each ticker gets its **own bespoke feature set**, scored against the others before it earns a slot in the live portfolio. NVDA's hard; treating it like Apple was the original sin.
- The overnight orchestrator runs research as a job — hypothesis, experiment, validation, write-up — and **persists everything in a searchable memory store**. The next morning's first action is reading what last night's runs found.

![[gallery:2]]

## Decisions worth telling

- Chose **walk-forward with purged embargo** over k-fold cross-validation. K-fold's information leakage produced fantasy backtests; walk-forward's results survive contact with reality.
- **Fixed 1%-risk / ATR sizing, not Kelly.** Every position risks the same small fraction of equity to its ATR stop; confidence and correlation can shrink that, never grow it. Predictable, survivable drawdowns beat a rule that balloons the bet on a hot streak.
- Realistic backtester from day one — fees, slippage, ATR stops, partial exits, time stops. The original frictionless results are kept around as historical reference, marked clearly so they can never sneak into a current claim.

![[gallery:1]]

## Where it stands

Live on paper since spring 2025. Real-money go-live is gated on a thirty-day clean track. The current frontier is making the orchestrator run longer experiments unattended — multi-day campaigns that wake up with their own progress reports.
