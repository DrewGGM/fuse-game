# ADR-002: One simulation, shared verbatim by client and server

## Status
Accepted

## Context
A global daily leaderboard is the heart of the product. Without integrity it
fills with garbage in a week and the game loses its reason to be shared. A team
of two cannot maintain anti-cheat heuristics.

## Decision
A pure TypeScript package with no dependencies (`@fuse/sim`) that runs the
simulation. The client imports it and the Worker imports it. The server re-runs
every submission and accepts the score only if it reproduces exactly.

## Consequences

### Positive
- Anti-cheat is exact rather than probabilistic, and it costs nothing to run.
- A run stores in roughly a hundred bytes — five placements — so replays are
  almost free and can be re-simulated rather than recorded.
- It forces "functional core, imperative shell" out of necessity instead of
  discipline, which is the only way that separation survives contact with a
  deadline.

### Negative
- It constrains how the core may be written, permanently: fixed timestep, no
  `Math.random`, no `sin`/`cos`/`pow`, no reliance on `Map` iteration order.
  This is not negotiable later.

### Risks
- A divergence between engines breaks the leaderboard and validation at the same
  time, silently. Guarded by `e2e/parity.spec.ts`, which runs a thousand cases in
  Chromium and in Node and compares a full checksum of every step, on every push.
- Any behavioural change silently redefines every score ever stored. Guarded by
  `npm run fingerprint`, which must be identical across a refactor.

## Alternatives considered
1. **Trust the client** — free today, leaderboard destroyed within weeks.
2. **Heuristic validation** — false positives punish the strongest players, who
   are exactly the ones worth keeping.
3. **A server simulation in another language** — requires maintaining two
   implementations that must agree forever. That is precisely the bug this ADR
   exists to prevent.
