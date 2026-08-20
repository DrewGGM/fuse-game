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

**Status:** feature complete. The daily board, the shared leaderboard, the
offline queue, clip export, the tutorial and the reminder all work; the release
AAB builds signed and minified at 2.5 MB. What remains is provisioning —
a Cloudflare account, a signing key and a Play listing — all of it in
[docs/release.md](docs/release.md).

Ads and purchases still run against development adapters. That is deliberate:
the game is complete without them, so the sensible order is publish, see whether
anyone plays, then monetise.

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

### Running the whole thing locally

The client works with no server at all — that is the point of deriving the board
on the device — but the leaderboard needs one:

```bash
cd apps/api
npx wrangler d1 migrations apply fuse-db --local
npx wrangler dev                       # http://localhost:8787

# in another shell, build the client against it
FUSE_API_BASE=http://localhost:8787 npm run build --workspace=@fuse/game
npm run preview --workspace=@fuse/game
```

`FUSE_API_BASE` sets both the API the client calls and the CSP's `connect-src`.
Building without it points at production, and the local Worker is then refused
by the policy — which is correct behaviour, and confusing for ten minutes if you
do not know it.

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

### Two numbers, not one

`pars.json` holds the **record** — the best the reference solver can find.
`targets.json` holds a **reachable target**, measured with a sampling-only budget
calibrated against simulated players.

Both exist because of what the population simulation showed: the record is
reached by essentially nobody. The median player got 31% of it and not one of
forty matched it, so a single number labelled "objetivo" told almost every
player, every day, that they had fallen short. The target is hit by 38% of
simulated players — 7% of those playing blind, 82% of those thinking about it.

```bash
npm run simulate -- 60      # 60 players of mixed skill against a local Worker
```

That script is the closest thing to a playtest that can be run on demand: it
drives real HTTP, so a scoring bug, a broken attempt limit or a leaderboard that
disagrees with itself shows up as a rejection rather than a plausible number.

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
| [009](docs/adr/009-offline-first-leaderboard.md) | The leaderboard is optional to the game |

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
| Eight sound cues | Kenney's *Interface Sounds*, *Digital Audio* and *Sci-Fi Sounds*, trimmed and levelled by `scripts/build-sfx.mjs` | CC0 1.0 |

The board is still drawn entirely in code — a sprite sheet cannot follow a beam
whose path changes every run, or recolour itself when the player switches
palette. Sound is the one place a recorded asset beats a generated one: the
oscillator tones these replaced were correct and thin, and no amount of
synthesis at this scale was going to give them a body.

CC0 asks for nothing, but Kenney is credited here and in the game's settings
screen anyway.

Regenerate the icon set after changing `scripts/make-icon.mjs`:

```bash
node scripts/make-icon.mjs
cd apps/game && npx @capacitor/assets generate --android --assetPath assets
```

Rebuild the sound cues after changing `scripts/build-sfx.mjs` — it fetches the
packs itself and needs ffmpeg on the path:

```bash
node scripts/build-sfx.mjs
```

That tool writes a full-bleed PNG splash at every density, which costs about
2.3 MB. `android/app/src/main/res/drawable/splash.xml` replaces it with a flat
colour and the centred mark — delete the regenerated `drawable-land-*` and
`drawable-port-*` folders and the stray `drawable/splash.png` afterwards.

## Licence

[PolyForm Noncommercial 1.0.0](LICENSE.md).

Read it, learn from it, fork it, run it yourself, send a patch — all fine.
Publishing it to an app store or selling it is not: that right stays with the
author, because this is a commercial game and its store listing is the thing
worth protecting. A clone on Play would be a licence violation, not merely
against Google's rules.

If you want to use any of it commercially, ask.
