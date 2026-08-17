# ADR-004: Anonymous device identity, no accounts

## Status
Accepted

## Context
The game needs to know who you are for the leaderboard and the three-attempt
rule. It does not need to know anything about you.

## Decision
A UUID generated on the device at first launch, exchanged for a short-lived HMAC
token. An auto-generated handle. No email, no password, no identity provider.

## Consequences

### Positive
- Removes half the security checklist by construction: no password hashing, no
  account recovery, no OAuth, no login rate limiting. Those items are recorded as
  considered-and-not-applicable rather than forgotten.
- The Play Data Safety declaration is clean, which is one less thing to explain
  during review.
- GDPR becomes close to trivial: there is no personal data to export or erase.

### Negative
- Reinstalling loses the streak. Said plainly in the app; purchases still restore
  through the store.
- A player can mint new identities. Accepted: there is nothing to win but more
  attempts at a leaderboard with no prizes.

## Alternatives considered
1. **Google Play Games sign-in** — would fix cross-device streaks, but adds an
   SDK with weak Capacitor support and user data we would rather not hold.
   A candidate for v2.
2. **Email accounts** — all of the security and compliance cost, none of the
   benefit for this product.
