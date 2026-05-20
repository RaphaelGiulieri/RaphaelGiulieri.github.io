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
  src: assets/projects/lifesim/hero.webp
  alt: "LifeSim — a medieval village waking up in early light"
  type: image
gallery:
  - src: assets/projects/lifesim/01-conversation.webp
    alt: "An NPC approaches the player at the edge of the village"
    caption: "A villager approaches you on her own — because she heard from the smith that you can fight."
  - src: assets/projects/lifesim/02-relationships.webp
    alt: "Relationship-graph debug overlay"
    caption: "Asymmetric relationships: A can love B while B fears A. The whole village is a directed graph."
  - src: assets/projects/lifesim/demo.mp4
    poster: assets/projects/lifesim/demo-poster.webp
    type: video
    caption: "60 s of emergent behaviour — herd routines, conversations, the elder's morning round."
headline:
  value: "≈ €1 / hour"
  label: "to run a living village"
links:
  repo: null
  demo: null
---

# LifeSim

A medieval sandbox where the world doesn't need you. The villagers wake up with their own goals, remember what happened yesterday, and will absolutely refuse to help you if you've given them a reason to.

You arrive as a stranger with nothing. Talk your way into food and shelter, or steal it; befriend the smith and learn a trade, or insult him and watch the rumour spread. There are no quest markers because there's no script. Every NPC carries memories, relationships across four asymmetric axes, and a personality that drives what they do when nobody is watching. Speak to anyone in plain text or with your voice — replies come back in voiced English through 28 distinct local voices.

![[gallery:0]]

## Highlights

- The village runs on a four-tier AI: most decisions are local-rules and free, but real conversations and unusual moments call out to a model. Cost lands around **a euro an hour of play**.
- Relationships are asymmetric and directional. The smith may admire you while you secretly resent him; gossip travels and confidence in a rumour decays each time it changes mouth.
- Death is permanent for everyone — the elder included. Lose her and the council loses a tie-breaker, the temple loses its custodian, and the next crisis plays out differently.
- Voice in, voice out. Push to talk; the response is rendered locally in a voice picked deterministically from the NPC's gender, age and traits.

![[gallery:1]]

## Decisions worth telling

- Picked a curated list of **discrete personality traits** over a continuous Big-Five model. Easier to explain to a player; cleaner to drive a behaviour-utility pipeline; less prone to "all NPCs feel the same".
- Speech runs entirely in the browser — no cloud round-trip. The latency was the immersion-breaker; cost was secondary.
- NPCs only know what they perceived. Vision and hearing are real geometric checks. Gossip is the canonical information network — and it lies, just enough.

![[video:demo]]

## Where it stands

Playable. Core simulation, conversation, combat, law, economy and speech are all in. Open work: deeper narrator arcs, more dynamic world-gen, ecosystem balancing. LifeSim seeds the research direction: how far can per-NPC autonomy stretch before cost or coherence breaks?

Below the four-tier AI sits a much simpler movement substrate — Reynolds' boids — the same flocking that drives the village herd and patrol formations. The live boids demo is hosted under [sabda_vfx](sabda_vfx) where the underwater-installation marine-life simulation reused the same code.
