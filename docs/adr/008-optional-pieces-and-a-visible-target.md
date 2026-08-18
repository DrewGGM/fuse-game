# ADR-008: Optional pieces and a visible target

## Status
Accepted — amends the placement rule assumed by ADR-002 and the earlier UI

## Context
The first person to play the game asked how to *solve* the opening board. Fuse
has no win condition — you place pieces and chase a score — but nothing on
screen said so, and two things actively implied the opposite:

1. **The game demanded all five pieces before it would let you light the fuse.**
   That reads as "there is an arrangement where every piece has its place".
2. **The result screen showed a bare number.** Scoring 5,400 told a player
   nothing, because no target was ever displayed.

Measuring the shipped boards settled the first point. Across all 800 curated
seeds, the best run the reference solver can find uses:

| pieces | boards | share |
|---|---|---|
| 1 | 14 | 2% |
| 2 | 146 | 18% |
| 3 | 291 | 36% |
| 4 | 263 | 33% |
| 5 | 86 | 11% |

On 89% of days the best known line uses fewer than five. The rule was not merely
confusing, it was wrong: it forced players to litter the board with pieces that,
parked in the spark's path, actively cost them points.

## Decision
1. A run needs **at least one** piece and at most the inventory. `MIN_PLACEMENTS`
   replaces the exact-count check in `validatePlacements`, and the API schema
   accepts 1–5 placements.
2. The day's **target is shipped and shown**: `packages/gen/src/pars.json` holds
   the reference solver's best score for every curated board. The home screen
   shows it beside the streak; the result screen marks it on the score bar and
   states the distance in points.
3. A **first-run tutorial** teaches the mechanic on a hand-built board and closes
   on the sentence the game was missing: there is no correct solution to find.

## Consequences

### Positive
- The dominant confusion disappears: a score now carries meaning, and a player
  who is short knows by how much.
- The solver had to learn the same lesson. `prune()` drops pieces that cost
  points, so par reflects what a run can actually reach rather than what five
  forced placements reach.
- Fewer taps to a first result, which matters most for the player who has not
  yet decided whether to care.

### Negative
- Par is a *best known* score, not a proven maximum. The copy says so, and a
  player who beats it is told they beat the machine rather than shown an error.
- Shipping the table costs a few kilobytes and must be regenerated whenever the
  simulation changes. `npm run pars` does it; `npm run fingerprint` reveals when
  it is needed.

### Risks
- Relaxing a validation rule is only safe in one direction. Every previously
  legal five-piece run stays legal and scores identically — verified by the
  behavioural fingerprint being unchanged across the change.
