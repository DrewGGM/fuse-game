# Fuse

A daily chain-reaction puzzle for Android. Everyone in the world gets the same
board and the same five pieces each day. Place as many or as few as you like,
light one spark, and watch what happens.

There is no correct solution to find. You chase a score, and the game tells you
what the best known score is so the number means something.

```
        ▽
        ●            ← nodes light as the spark passes
        ●
        ●
      ╲   ●
  ▓▓  ●   ▓▓  ○      ← walls kill the spark
  ●  ╲        ○
  ●  ●  ●  ●  ○      ← unlit nodes stay cold
```

**Status:** playable end to end on web and Android. Ads and in-app purchases run
against development adapters; the native SDKs are wired behind ports and need
live accounts before release.

---

## Why it is built this way

One decision drives the whole repository: **the score is decided by a simulation
that runs identically on the player's phone and on the server.**

A run is nothing but a handful of placements and a date. The server re-executes
it with the very same module the client used and compares the result. Either the number
reproduces exactly or the submission is rejected. There are no heuristics, no
"suspicious score" thresholds, and no way to fake a leaderboard entry.

That guarantee is only as strong as the simulation's determinism, which is why
`packages/sim` has hard rules — integer arithmetic only, no `Math.random`, no
transcendental functions, no dependency on iteration order — and why CI runs a
thousand identical cases in a browser and in Node on **every push**. If that gate
ever fails, every score ever submitted is suspect. Do not relax it; find the
divergence.

---

## Layout

```
packages/
  sim/     deterministic simulation — the definition of a valid run
  gen/     seeded board generation, the reference solver, and the curated seeds
apps/
  game/    the playable client: canvas board, DOM chrome, Capacitor shell
  api/     Cloudflare Worker: re-runs submissions, serves leaderboard and replays
e2e/       cross-engine parity gate and end-to-end tests
scripts/   board grading, seed curation, behavioural fingerprint
docs/adr/  the decisions and what they cost
```

`sim` and `gen` are pure: no I/O, no framework, no runtime dependencies. A test
fails the build if `sim` ever declares one.

---

## Getting started

```bash
npm ci
npm run dev          # the game at http://localhost:5173
npm test             # unit + integration
npm run ci           # everything CI runs, minus the browser suites
```

Browser suites need Chromium once:

```bash
npx playwright install chromium
npx playwright test --project=parity   # the gate that matters
npx playwright test --project=app      # end-to-end on a Pixel 5 viewport
```

### Android

```bash
npm run android:sync
cd apps/game/android
./gradlew bundleRelease          # needs a signing config
```

`local.properties` must point at your SDK (`sdk.dir=/path/to/Android/Sdk`), using
forward slashes even on Windows — backslashes are read as escape sequences and
fail with a confusing "filename, directory name, or volume label syntax is
incorrect".

---

## Working on the puzzle itself

Board quality is not a matter of taste here; it is measured.

```bash
npm run grade -- 2026-09-01 30          # grade a stretch of dailies
npm run grade -- 2026-09-01 30 --show   # and print the bad ones
npm run seeds -- 800                    # re-curate the shipped seed table
```

Boards are **generated from a traced solution**, not from noise. The generator
first walks a plausible route with two or three turns, lays most nodes along it,
and deals the inventory that route needs. Scattering nodes at random was tried
first and produced boards where the best possible run lit a quarter of them.

Seeds are then curated offline: the solver grades every candidate and only
approved ones ship, in `packages/gen/src/seeds.json`. The client still derives
the board itself with no network call, so the game works fully offline.

Grading uses a frozen search budget (`CURATION_BUDGET`). The search is
stochastic and its variance is large enough that a different budget can find a
par 40% apart on the same board, so "good" only means anything relative to a
fixed effort. **Changing that constant invalidates every curated seed.**

The target shown to players lives in `packages/gen/src/pars.json`, rebuilt with
`npm run pars`. It is the best score the reference solver found — not a proven
maximum — and the game says as much when a player beats it.

To check that every shipped board really is playable:

```bash
npm run verify:seeds        # all 800: a scoring solution exists and replays
```

### A note on the rules

A run may use **one to five** pieces. Requiring all five implied there was an
arrangement in which every piece mattered; on 89% of boards the best known line
uses fewer, and a spare piece parked in the spark's path costs points. See
[ADR-008](docs/adr/008-optional-pieces-and-a-visible-target.md).

### Changing the simulation

Any change to `packages/sim` changes what every past score meant. Before and
after, run:

```bash
npm run fingerprint
```

Identical output means the change was a refactor. Different output means it was
a rule change, and the seed table needs re-curating.

---

## Monetisation rules

These are enforced in code, not just documented (`apps/game/src/commerce.ts`):

- Rewarded video only, opt-in, at most two per player per day, only on the result
  screen.
- No interstitials, no app-open ads, no ad before or during play, no energy timers.
- **Nothing bought or watched grants a ranked attempt or any scoring advantage.**
  The `Reward` type has no variant that could; the guard rejects one by name if
  someone adds it later.

The reasoning, including the evidence that cuts against it, is in
[docs/adr/006-player-friendly-monetisation.md](docs/adr/006-player-friendly-monetisation.md).

---

## Decisions

| ADR | Decision |
|-----|----------|
| [001](docs/adr/001-code-first-stack.md) | TypeScript + Capacitor, no visual editor anywhere |
| [002](docs/adr/002-shared-deterministic-sim.md) | One simulation, shared by client and server |
| [003](docs/adr/003-serverless-backend.md) | Cloudflare Workers + D1 |
| [004](docs/adr/004-anonymous-identity.md) | Anonymous device identity, no accounts |
| [005](docs/adr/005-public-daily-seed.md) | Public seed table, offline play, accepted risk |
| [006](docs/adr/006-player-friendly-monetisation.md) | Rewarded opt-in only, no interstitials |
| [007](docs/adr/007-canvas-over-game-framework.md) | Canvas 2D instead of a game framework |
| [008](docs/adr/008-optional-pieces-and-a-visible-target.md) | Pieces are optional; the target is shown |

---

## Security

Audited 19 August 2026: nine issues found and fixed, none exploitable in the
shipped build. Production dependencies carry **zero advisories**; the remaining
nine are build tooling that never reaches a device.

The adversarial suite runs the real Worker against real SQLite and tries to
forge scores, smuggle pieces, reset the attempt budget, inject SQL, pollute
prototypes and leak internals. `apps/game/test/hardening.test.ts` locks the
client and Android posture in place, because regenerating the Capacitor project
silently reverts the manifest.

```bash
npm run audit        # production dependencies; fails on moderate and above
npm run csp:check    # loads the built app in a clean browser
```

Full report, including what was accepted rather than fixed and the pre-launch
checklist: [docs/security.md](docs/security.md).

## Assets

Everything is generated or self-hosted; nothing is fetched at runtime.

| Asset | Source | Licence |
|---|---|---|
| Chakra Petch | `@fontsource/chakra-petch`, subset to latin | SIL OFL 1.1 |
| App icon, splash | Drawn by `scripts/make-icon.mjs` with the game's own palette | this project |
| Sound | Synthesised at runtime with Web Audio; no audio files exist | — |

Regenerate the icon set after changing `scripts/make-icon.mjs`:

```bash
node scripts/make-icon.mjs
cd apps/game && npx @capacitor/assets generate --android --assetPath assets
```

That tool writes a full-bleed PNG splash at every density, which costs about
2.3 MB. `android/app/src/main/res/drawable/splash.xml` replaces it with a flat
colour and the centred mark — delete the regenerated `drawable-land-*` and
`drawable-port-*` folders and the stray `drawable/splash.png` afterwards.

## Licence

Not yet chosen. All rights reserved until then.
