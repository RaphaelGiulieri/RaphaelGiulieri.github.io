---
id: lifesim
title: "LifeSim"
tagline: "An AI-driven medieval sandbox where the NPCs don't need you — and remember when you lied."
categories: [game, ai, simulation]
skills_short:
  - Emergent NPC simulation
  - Layered AI cost model
  - Local TTS / STT
  - Permadeath systems
  - Memory & relationships
year: 2025
status: prototype
client: null
role: Solo developer
highlight: true
rank: 92
hero:
  src: assets/projects/lifesim/hero.svg
  alt: "LifeSim — concept render of the village relationship graph (design visualisation, not gameplay)"
  type: image
gallery:
  - src: demos/lifesim.html
    type: shader
    aspect: "16 / 10"
    alt: "Interactive directed relationship graph — representative village NPCs, asymmetric edges on four axes"
    caption: "Interactive concept · the village as a directed graph — hover a villager to see who they love, fear, trust or owe. Edges are asymmetric: A can love B while B fears A. Illustrative design data, not gameplay."
  - src: assets/projects/lifesim/decision-loop.svg
    alt: "NPC decision-loop diagram — perception, memory, goals and needs, action"
    caption: "How an NPC thinks each tick: perception (real line-of-sight and earshot) → memory (episodic; gossip that decays and lies) → goals & needs (discrete traits driving a behaviour-utility score) → action. Architecture diagram."
  - src: assets/projects/lifesim/daily-routine.svg
    alt: "Daily-routine timeline — the elder's morning round and the herd's boids schedule"
    caption: "Authored routine templates over a day: the elder's morning round (temple, council, market) and the boids-driven herd schedule. Illustrative design — emergent timings arise at runtime, this is not a recording."
headline:
  value: "≈ €1 / hour"
  label: "four-tier AI cost target"
links:
  repo: null
  demo: null
---

# LifeSim

A medieval sandbox where the world doesn't need you — an in-development research project, not a finished game. The villagers are designed to wake up with their own goals, remember what happened yesterday, and refuse to help you if you've given them a reason to.

You arrive as a stranger with nothing. Talk your way into food and shelter, or steal it; befriend the smith and learn a trade, or insult him and watch the rumour spread. There are no quest markers because there's no script. Every NPC carries memories, relationships across four asymmetric axes, and a personality that drives what they do when nobody is watching. Speak to anyone in plain text or with your voice — replies come back in voiced English through 28 distinct local voices.

![[gallery:0]]

## Highlights

- The village runs on a four-tier AI: most decisions are local-rules and free, but real conversations and unusual moments call out to a model. By design, cost lands around **a euro an hour** of simulation.
- Relationships are asymmetric and directional. The smith may admire you while you secretly resent him; gossip travels and confidence in a rumour decays each time it changes mouth.
- Death is permanent for everyone — the elder included. Lose her and the council loses a tie-breaker, the temple loses its custodian, and the next crisis plays out differently.
- Voice in, voice out. Push to talk; the response is rendered locally in a voice picked deterministically from the NPC's gender, age and traits.

![[gallery:1]]

## Decisions worth telling

- Picked a curated list of **discrete personality traits** over a continuous Big-Five model. Easier to explain to a player; cleaner to drive a behaviour-utility pipeline; less prone to "all NPCs feel the same".
- Speech runs entirely in the browser — no cloud round-trip. The latency was the immersion-breaker; cost was secondary.
- NPCs only know what they perceived. Vision and hearing are real geometric checks. Gossip is the canonical information network — and it lies, just enough.

![[gallery:2]]

## Where it stands

In development — a research project, not yet playable. The systems are designed and prototyped in isolation — the four-tier NPC AI, asymmetric relationships, gossip, permadeath, local voice — but not yet assembled into a playable whole. That's the question it exists to probe: how far per-NPC autonomy can stretch before cost or coherence breaks.

Below the four-tier AI sits a much simpler movement substrate — Reynolds' boids — the same flocking that drives the village herd and patrol formations. The live boids demo is hosted under [sabda_vfx](sabda_vfx) where the underwater-installation marine-life simulation reused the same code.
