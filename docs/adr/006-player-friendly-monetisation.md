# ADR-006: Rewarded opt-in only, no interstitials

## Status
Accepted

## Context
With no acquisition budget, Google Play's organic ranking is the only channel —
and that ranking weighs retention and ratings velocity. A study of 18,302
ad-related reviews found that 70.5% of complaints concern the *quantity* and
*frequency* of ads rather than their existence, and that 76.1% of reviews
mentioning ads are low or neutral rated.

Google's own Better Ads Experiences policy independently forbids unexpected
full-screen interstitials and explicitly exempts opt-in rewarded ads.

## Decision
At most two opt-in rewarded videos per player per day, both on the result screen.
No interstitials, no app-open ads, no energy timers. Revenue is complemented by
cosmetics, a one-time ad-free purchase and a season pass. Nothing sold or watched
grants a competitive advantage.

## Consequences

### Positive
- Opt-in rewarded is the format the policy exempts, so this is also the
  lowest-risk option for review.
- It protects the rating, which protects the ranking, which is the channel.
- The invariant is enforced in the type system: `Reward` has no variant that can
  touch attempts or score, and `assertRewardIsFair` rejects one by name if
  somebody adds it later. Covered by an end-to-end test.

### Negative
- ARPDAU sits deliberately at the low end of the market range. This is a business
  decision taken with open eyes, not an oversight.

### Honest note
A peer-reviewed study of 21 games and 99,620 users found **no** statistically
significant effect of first-session ad density on retention, and concluded that
game-specific effects dominate. The case for this decision therefore rests on
reviews and ranking, not on retention. Worth knowing, so nobody defends it with
the wrong argument — and worth heeding, because the same study implies effort is
better spent on the core loop than on tuning placements.
