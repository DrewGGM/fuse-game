# ADR-009: The leaderboard is optional to the game

## Status
Accepted

## Context
The daily comparison is the reason the game is worth sharing, so it is tempting
to treat the server as load bearing. But the board is derived on the device and
a run is scored on the device (ADR-002, ADR-005) — the network adds the
comparison and nothing else.

That leaves a choice about what happens when the network is not there. A player
on the underground finishes a run: does it count?

## Decision
Every network call is optional and no failure reaches a render path.

- A run is written to a **persistent queue before any network call**, so the
  score exists on disk the instant the chain finishes.
- The API client returns a discriminated result and never throws. Failures are
  either retryable (`offline`, `server`) or final (`rejected`).
- A rejected run is **dropped with its reason shown**, never retried. The server
  has looked at it and said no; sending it again produces the same answer.
- The queue drains on returning to the home screen and on the `online` event,
  one run at a time — the server orders attempts, and parallel submission would
  race them into the wrong slots.
- A player with no identity yet gets one on first contact. Failing to create one
  costs the leaderboard and nothing else.

## Consequences

### Positive
- The single-player game is complete with the aeroplane mode on, which is not a
  degraded state but the normal one for a puzzle you play on a commute.
- The result screen never waits: score, target, verdict and share text are all
  local, and the rank slots in when it arrives or silently does not.
- Proven rather than assumed. The CSP initially blocked the local API by
  accident, which turned into an unplanned offline test: the run queued, the UI
  said "Sin conexión · 1 por enviar", and it sent itself on the next launch.

### Negative
- A run can be recorded locally and refused by the server, so a player's local
  best can exceed their leaderboard best. The rejection message says which
  happened rather than hiding it.
- The queue is capped at eight attempts per run. Beyond that the run is dropped:
  an unbounded queue that never drains is its own bug, and a run that has failed
  eight times is not going to succeed on the ninth.

### Risks
- Anything added to the result screen that *awaits* the network would undo this
  quietly. The tests in `e2e/leaderboard.spec.ts` play a full run with the API
  aborted and assert the local half is untouched.

## Alternatives considered
1. **Submit synchronously and block the result screen** — simplest, and makes
   every player pay for the worst network in the population.
2. **Fire and forget with no queue** — loses runs, which is the one thing a
   daily game cannot do: there is no way to play that board again tomorrow.
3. **Retry a rejected run** — spins forever against a server that has already
   given its final answer, and hides a real problem behind a spinner.
