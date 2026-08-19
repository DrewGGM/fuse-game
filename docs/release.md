# Releasing

Everything in the repository is done. What remains is provisioning things only
you can own: a Cloudflare account, a signing key, and a Play Console listing.

Work through this in order — the Worker has to exist before the app can be built
against it, and the app has to be built before anything can be uploaded.

---

## Deploying on every push

Once the two Cloudflare secrets are set, a push to `main` that passes CI
deploys the API itself — migrations included. Setup and the exact token scopes
are in the web repository:
[fuse-web/docs/continuous-deployment.md](https://github.com/DrewGGM/fuse-web/blob/main/docs/continuous-deployment.md).

The steps below are the first-time provisioning, which has to happen once by
hand because it creates the resources the pipeline then updates.

## 1. The backend

```bash
cd apps/api
npx wrangler login
npx wrangler d1 create fuse-db
```

Copy the `database_id` it prints into `wrangler.toml`, replacing
`local-dev-placeholder`. Then:

```bash
npx wrangler d1 migrations apply fuse-db --remote
npx wrangler secret put TOKEN_SECRET        # paste a long random string
npx wrangler deploy
```

**About `TOKEN_SECRET`.** It signs the anonymous player tokens. Generate it with
`openssl rand -base64 32` or equivalent, and never reuse the development value
from `apps/api/.dev.vars` — that file is gitignored and local-only, and its
contents are known.

It briefly lived in a `[vars]` block in `wrangler.toml` for local development,
which would have deployed a known value as the production secret. Vars in that
file are not overridden by secrets; they simply *become* the deployed value.
Local development reads `.dev.vars` instead, which `wrangler deploy` ignores.

Rotating it later logs every device out of its identity, so put it somewhere you
will not lose it.

Check it answers:

```bash
curl -X POST https://<your-worker>.workers.dev/v1/players
```

A `201` with an id, handle and token means the database binding and the secret
are both live.

### Response headers still to add

The CSP in the app covers the WebView. The Worker should set its own headers on
every response before you take real traffic:

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

### Rate limiting

`POST /v1/players` currently creates a row for anyone who asks. Every other
endpoint is bounded — three ranked attempts per player per day, enforced on the
player row — but player creation is not. Add a per-IP limit in Cloudflare's
dashboard (Security → WAF → Rate limiting rules) before launch. It is a few
clicks and it is the one unbounded write in the system.

---

## 2. The app

Point the build at the deployed Worker. This sets both the API base **and** the
CSP's `connect-src`, which is why it must not be edited by hand:

```bash
export FUSE_API_BASE=https://<your-worker>.workers.dev
npm run android:sync
```

### The upload key

Generate it once. If you lose it you cannot update the app on Play ever again —
back it up somewhere that is not this machine.

```bash
keytool -genkeypair -v \
  -keystore upload.jks -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

`.local/test-only.jks` in this repository is **not** it: that is a disposable key
used to prove the minified release build installs and runs. It is gitignored and
worthless.

### Build the bundle

```bash
cd apps/game/android
FUSE_KEYSTORE=/absolute/path/upload.jks \
FUSE_KEYSTORE_PASSWORD='…' \
FUSE_KEY_ALIAS=upload \
FUSE_KEY_PASSWORD='…' \
FUSE_VERSION_CODE=1 \
FUSE_VERSION_NAME=1.0.0 \
./gradlew bundleRelease
```

The AAB lands in `app/build/outputs/bundle/release/app-release.aab`, about
2.5 MB. **`FUSE_VERSION_CODE` must increase on every single upload** — Play
rejects a bundle whose code is not higher than the last one, and it is the most
common upload failure.

Nothing about signing is stored in a tracked file, so a release can also be cut
from CI by putting the same values in repository secrets.

---

## 3. Play Console

### Before you can publish at all

A personal developer account created after 13 November 2023 must run a **closed
test with at least 12 testers, opted in continuously for 14 days**, before it can
apply for production access. Start this the day the account exists — it is the
longest lead time in the whole project, and it blocks nothing else.

The web build is the easiest way to recruit those testers: it is the same game,
it needs no install, and it costs nothing to share.

### Listing

- **Title (30 chars):** `Fuse: Daily Chain Puzzle` — keyword first, as Play
  weights the opening of the title most.
- **Short description (80):** the single line that decides installs. Test
  variants with Store Listing Experiments once there is traffic.
- **Icon and feature graphic:** `assets/icon.png` is 1024×1024 and ready. The
  feature graphic (1024×500) does not exist yet.
- **Screenshots:** at least two. The result screen with a beaten target and the
  mid-run board are the two that show what the game is.

### Data safety

Answer honestly, and the answers are unusually short:

| Question | Answer |
|---|---|
| Does the app collect data? | Yes — a device-generated anonymous id and game scores |
| Is it linked to identity? | No |
| Is it shared with third parties? | No |
| Can users request deletion? | No account exists to delete; uninstalling removes it |

There is no email, no name, no location, no advertising id in the build as it
stands. That changes the moment AdMob goes in — revisit this page then.

### Content rating

Questionnaire answers are all "no": no violence, no user-generated content, no
purchases of chance-based items. It should come back as suitable for everyone.

---

## Still mocked, and what to do about it

Ads and purchases run against development adapters (`apps/game/src/commerce.ts`).
The game is complete and shippable without them — they are how it earns, not how
it works — so the sensible order is: publish, see whether anyone plays, then
monetise.

When you do, the ports are already the right shape:

- **AdMob**: `@capacitor-community/admob`, wired behind `AdPort`. The UMP consent
  flow must run before the first ad request in the EEA.
- **Purchases**: RevenueCat's Capacitor SDK behind `PurchasePort`. Verify
  entitlements by webhook on the server, never from a client claim.
- Both need the Data safety answers above revisited, because an advertising id
  is collected data.

`assertRewardIsFair` and its test enforce ADR-006's rule that nothing bought or
watched grants a ranked attempt. Keep it that way.

---

## Release checklist

```
[ ] wrangler d1 create + migrations applied --remote
[ ] TOKEN_SECRET set with `wrangler secret put`, not as a var in wrangler.toml
[ ] Worker deployed and answering POST /v1/players
[ ] Security headers added to Worker responses
[ ] Rate limit on POST /v1/players
[ ] FUSE_API_BASE exported, app rebuilt, CSP verified with npm run csp:check
[ ] Upload keystore generated and backed up off this machine
[ ] AAB built with a fresh FUSE_VERSION_CODE
[ ] 12 testers running the closed test for 14 days
[ ] Listing, data safety and content rating completed
[ ] Production access granted
```
