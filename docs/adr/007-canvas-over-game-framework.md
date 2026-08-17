# ADR-007: Canvas 2D instead of a game framework

## Status
Accepted — supersedes the renderer choice in ADR-001

## Context
The blueprint specified Phaser 3. Once the game design settled, what it actually
needs became clear: a grid, a point that moves one cell per tick, additive glow,
and a handful of tweens. No physics, no sprite atlases, no scene graph, no
tilemap loader.

Meanwhile the project's largest technical risk is WebView performance on a cheap
Android phone.

## Decision
Render the board with the Canvas 2D API directly. Use the DOM for all chrome —
menus, HUD, dialogs, settings.

## Consequences

### Positive
- The client bundle is **42 KB of JavaScript** (18 KB gzipped) plus 13 KB of CSS,
  against roughly a megabyte for a framework build. That directly attacks the
  risk that motivated the whole stack choice.
- Complete control of the look. The warm-lit-against-cool-unlit contrast that
  makes a clip readable is a handful of gradient calls, not a fight with a
  particle system.
- The DOM handles typography, focus, safe areas and accessibility properly —
  all of which are laborious inside a canvas-only framework.

### Negative
- Tweening, input and the render loop are hand-written. In practice that is about
  three hundred lines, and it is code the agent can read in one pass.
- No built-in asset pipeline. Not needed: the game ships zero art files.

### Risks
- Two rendering systems (canvas and DOM) could drift visually. Mitigated by
  driving both from the same CSS custom properties and by rendering piece glyphs
  through one shared function used by the board, the tray and the how-to screen.

## Alternatives considered
1. **Phaser 3 as planned** — real value in scene management, tweens and
   particles, but all of it duplicated by the DOM or unused, at a cost measured
   in exactly the metric the project is most worried about.
2. **WebGL / PixiJS** — more headroom than this game will ever need, and a
   heavier failure mode on old drivers.
