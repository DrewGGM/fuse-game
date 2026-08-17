# ADR-003: Cloudflare Workers and D1

## Status
Accepted

## Context
Load arrives in a spike around the daily reset. The budget is zero. Nobody is on
call, so operational work has to be near zero too.

## Decision
Cloudflare Workers for the API, D1 for storage, KV for a short-lived leaderboard
cache.

## Consequences

### Positive
- Scales to zero. At 150 players the cost is nothing; at 9,000 it is still
  trivial.
- **Workers run V8, the same engine family as the Android WebView.** Of all the
  runtime choices, this one adds the least risk to ADR-002; a backend on another
  engine would be a free source of divergence.
- Deployed from the CLI with `wrangler`, so an agent can ship it without a console.

### Negative
- CPU time per request is capped, which forces a hard bound on simulation steps.
  That bound was needed anyway, both as a game rule and as a denial-of-service
  control.
- Vendor lock-in. Softened because the logic lives in the pure package, not in
  the Worker: moving to Node means rewriting handlers, not rules.

## Alternatives considered
1. **No backend at all** — kills the shared leaderboard and the winning-run
   reveal, which is most of the product.
2. **Supabase** — excellent for CRUD, but re-running the simulation server-side
   would still need an edge function. It adds a piece without removing one.
3. **Firebase** — generous free tier, but a worse fit for "run this validation
   code at the edge" and harder to drive from a CLI alone.
