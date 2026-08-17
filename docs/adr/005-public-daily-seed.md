# ADR-005: A public, curated seed table

## Status
Accepted (amended)

## Context
If the client can derive the board, someone can move their clock forward and
practise tomorrow's puzzle early.

## Decision
The board for a date comes from a seed table shipped in the app, indexed by
puzzle number. No server salt. The server rejects any submission whose date is
not the current UTC day, with five minutes of grace for a run that began just
before the rollover.

**Amendment.** The original decision derived the seed from a public hash of the
date and accepted whatever board came out, filtered only by cheap structural
checks. Measurement showed roughly a quarter of those boards were flat or
largely unreachable. Seeds are now graded by the reference solver offline and
only approved ones ship. The properties that mattered — identical everywhere,
no network call, fully offline — are unchanged.

## Consequences

### Positive
- The game is fully playable with no connection, which is a real feature and not
  a side effect.
- Every board a player meets has been graded before shipping.
- No network call on the launch path.

### Negative
- Someone who bothers can prepare a future board early. **Accepted risk:** the
  leaderboard is social, there are no prizes, and protecting against it would
  cost offline play. Revisit only if players actually complain, in which case the
  fix is a server-published daily salt with one day of prefetch.
- The table is finite. Past its end the game degrades to on-the-fly structural
  selection rather than breaking, because a slightly worse puzzle beats no puzzle
  when someone has missed an update.
