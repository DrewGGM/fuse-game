# ADR-001: TypeScript + Capacitor, with no visual editor anywhere

## Status
Accepted

## Context
The code is written by an AI agent with no access to a GUI. Unity and Godot were
ruled out early: in both, the load-bearing work does not live in text files but
in serialised scenes, prefabs and `.meta` files bound by GUID. An agent can write
a flawless component and still be unable to connect it to anything.

The team is one or two people with no budget. The result must build to an AAB and
monetise with ads and in-app purchases.

## Decision
TypeScript, bundled by Vite, wrapped for Android by Capacitor. Every part of the
project — logic, screens, content, `build.gradle`, CI — is a text file editable
from a terminal.

## Consequences

### Positive
- Web game code is the largest corpus of gameplay code a language model has seen.
- The verification loop closes without a human: the agent opens the game in a
  browser, plays it, reads the console and compares screenshots. This turned out
  to matter more than raw performance.
- A playable web build falls out for free — a marketing asset and, more usefully,
  the way to recruit the twelve testers Google requires before production access.

### Negative
- WebView performance on mid-range Android is the real unknown, and it is not
  answerable from a desk. It has to be measured on a cheap phone.
- Audio latency in a WebView is worse than native. Mitigated with short
  synthesised blips through Web Audio, preloaded, with no audio files at all.

  *Revised 20 Aug 2026.* The latency argument held; the "no audio files" part
  did not survive contact with how it sounded. Eight CC0 one-shots (37 kB,
  precached, decoded once into AudioBuffers) replaced the oscillators and cost
  nothing measurable at launch. The synthesised versions are still in
  `sound.ts` as the fallback, so the property that actually mattered — a game
  that cannot be silenced by a failed download — is unchanged.

### Risks
- Google Play's spam and minimum-functionality policies target WebView wrappers.
  A self-contained offline game with native billing is not what those clauses
  describe, but the mitigations are cheap and all are applied: assets are local,
  no remote URL is ever loaded, and the web demo is not published as the app.

## Alternatives considered
1. **Flutter + Flame** — better raw performance, and the only non-native stack
   with ad mediation documented by Google itself. The verification loop is
   slower and the Dart game corpus is far smaller. *Retained as plan B, with a
   defined trigger: if the prototype cannot hold 60fps on a mid-range device.*
2. **React Native + Skia** — not a game engine; the runtime is not built for a
   simulation loop.
3. **Kotlin native / LibGDX** — the best SDK support of any option, but a slow
   compile cycle and expensive visual verification for an agent.
