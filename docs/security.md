# Security

Audited 19 August 2026, against the code at that commit. Nothing is deployed
yet, so this is a code, configuration and dependency review plus an adversarial
test suite — not a penetration test against a live host. Those tests live in
`apps/api/test/security.test.ts` and `apps/game/test/hardening.test.ts` and run
on every push.

## What protects what

The system has one asset worth attacking: **the leaderboard**. There are no
accounts, no personal data, no payments handled in-app, and no server-held
secrets belonging to players. That shapes everything below — most of the usual
web attack surface simply does not exist here.

| Asset | Threat | Control |
|---|---|---|
| Leaderboard integrity | Forged scores | Server replays every run with the same simulation module the client used; the score must reproduce exactly (ADR-002) |
| Attempt budget | More than three ranked tries a day | Counted on the player row, not the token; unique index on `(player, date, attempt_no)` |
| Today's answer | Reading the winning run before the day closes | `/v1/replays/:date/top` refuses while `date >= today` |
| Server CPU | Crafted payloads causing unbounded work | Zod bounds the payload; `MAX_TICKS` and `MAX_SPARKS` bound the simulation |
| Local save | Extraction over ADB | `allowBackup=false`, `dataExtractionRules` excludes everything |

## Findings and what was done

Nine issues, none of them exploitable in the shipped build, all fixed.

### Fixed

| # | Issue | Why it mattered | Fix |
|---|---|---|---|
| 1 | **CSP absent** | A compromised dependency could exfiltrate freely; the WebView had no instruction to refuse | Strict policy: `default-src 'none'`, no inline or remote script, `connect-src` limited to the app's own API |
| 2 | **CSP silently broken** | The first version was indented across lines; the browser read the continuation as extra sources and **ignored `object-src` entirely**. A policy that looks stricter than it is | One line per policy, plus a test asserting `'none'` never appears beside other sources |
| 3 | **`allowBackup="true"`** | Capacitor's default. Lets `adb backup` pull the save off an unrooted phone, and restore it onto another | `false`, with `dataExtractionRules` excluding cloud backup and device transfer |
| 4 | **FileProvider scoped to storage roots** | `path="."` on external storage and cache: any app handed a shared URI could walk everything the app can see | Scoped to `cache/shared/`, the only directory a clip is ever written to |
| 5 | **`<access origin="*" />`** | Cordova whitelist wide open in a generated compatibility file. Inert today, load-bearing the day a Cordova plugin is added | Scoped to the app's own API host, and the file is now **tracked** — see below |
| 6 | **`innerHTML` in four places** | Not exploitable — every value went in via `textContent` — but the pattern invites it. A server-supplied handle interpolated there is stored XSS | Replaced with a `make()` helper; there is no `innerHTML` left in the client, enforced by test |
| 7 | **`@capacitor/cli` a production dependency** | A build tool in the runtime tree, dragging `xcode` and `uuid` advisories into the shipped dependency graph | Moved to `devDependencies`; **production advisories went from 3 to 0** |
| 8 | **CI had no `permissions:` block** | Jobs inherited the default token scope; a compromised dependency in a workflow could use it | `permissions: contents: read` |
| 9 | **No dependency audit in CI** | Nothing would notice a new advisory | Production audit fails the build; tooling audit reports without failing |

### Accepted, with reasons

- **Nine advisories remain in build tooling** (`wrangler`, `sharp`, `esbuild`,
  `ws`, `undici`). None runs on a device or serves traffic. `esbuild`'s is a dev
  server issue; `sharp`'s is in image processing that only runs when icons are
  regenerated. Fixing them means a breaking `wrangler` major, which buys nothing.
  CI reports them so the decision is revisited rather than forgotten.
- **CORS is `*`.** The API serves public, non-personal data and the app is not
  browser-origin bound. There is no cookie or ambient credential for a hostile
  origin to ride — the token is sent explicitly.
- **`frame-ancestors` is not in the CSP.** Browsers ignore it in a `<meta>` tag.
  It belongs on the response header, which is the API's job once deployed.
- **Anonymous identities are cheap to mint.** A player can create a new one for
  more attempts. There are no prizes; the alternative is collecting personal
  data to defend a social scoreboard (ADR-004).
- **The daily board is derivable ahead of time.** Deliberate — it is what makes
  offline play work (ADR-005).

### A fix that did not ship

Worth recording, because the failure mode is general. `config.xml` is in
Capacitor's generated `.gitignore`, so the hardened version lived only on one
machine: `cap sync` restored the wildcard locally, and CI — which had never seen
the file — failed with `ENOENT`. The guard test caught it, but only by accident
of the file being missing rather than wrong.

Two changes came out of that. The file is tracked against Capacitor's
`.gitignore`, so a regeneration shows up as a diff. And `read()` in the guard
suite now throws a specific error when a file is absent, because **a hardened
file that is not in the repository is a finding, not a broken test.**

Anything else generated by a tool and then hardened by hand has the same
problem. The manifest is tracked; these tests are what notice if that changes.

## Attacks that were tried and failed

`apps/api/test/security.test.ts` runs the real handler against real SQLite:

- Claiming scores the placements do not produce, in four variations
- Smuggling five bombs past a five-mirror inventory
- Stacking pieces on one cell
- Submitting another day's winning board against today
- Unsigned tokens, wrong-secret tokens, expired-but-validly-signed tokens
- Eight malformed `authorization` headers, injected past `Headers` validation
- Resetting the attempt budget by minting a fresh token for the same id
- Ten concurrent submissions racing the attempt limit
- SQL injection through the date path and the date field
- A 5,000-element placement array
- Coordinates at `MAX_SAFE_INTEGER`
- Prototype pollution via `__proto__` and `constructor.prototype`
- Eight malformed JSON bodies
- Reading player ids off the leaderboard
- Forcing an internal error to leak a connection string

All rejected. The last one is worth stating plainly: an internal fault returns
`{"error":{"code":"INTERNAL"}}` and the cause goes to the log, not the client.

## Before going live

Not blockers for a debug build; blockers for production.

- [ ] `wrangler secret put TOKEN_SECRET` — a real random secret, never a var
- [ ] Set response headers on the Worker: `X-Frame-Options: DENY`,
      `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`
- [ ] Narrow `connect-src` to the real API hostname once it exists
- [ ] Per-IP rate limit on `POST /v1/players` — currently unbounded row creation
- [ ] `minifyEnabled true` and a signing config for the release build
- [ ] Verify RevenueCat purchases by webhook, not client claim, when billing goes live
- [ ] Alert when `SCORE_MISMATCH` exceeds ~1% of submissions: that is either an
      attack or, worse, the client and server simulations having diverged

## Running it yourself

```bash
npm run audit          # production dependencies only; fails on moderate+
npm test               # includes both security suites
npm run csp:check      # loads the built app in a clean browser, reports violations
```

`csp:check` exists because a local antivirus was rewriting the CSP meta tag in
the developer's browser and inventing violations. A test that only matches
strings would never have caught the real parsing bug (#2), and a browser with an
extension in the way reports bugs that are not yours.
