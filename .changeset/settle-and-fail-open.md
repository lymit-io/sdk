---
"@lymit/core": minor
"@lymit/sdk": minor
---

Settle the real cost of a call after it runs, and fail open on plan limits.

- `@lymit/core`: `settleLimit(state, config, now, delta)` (plus `tokenBucketSettle`, `fixedWindowSettle`, `slidingWindowSettle` and `assertDelta`). A settle always applies: it refunds an over-estimate (never past capacity) and charges an under-estimate even when that leaves a token bucket in debt, which refill then repays. A token bucket in debt reports `remaining: 0`, never a negative number.
- `@lymit/sdk`: `namespace.settle(identifier, { reserved, actual })` posts the difference to `/v1/settle`. It never fails your request on an outage; it reports through `onError` and resolves `null`.
- `@lymit/sdk`: **behaviour change.** `quota_exceeded` and `too_many_requests` now follow `failMode` (open by default) instead of always throwing, so a workspace at its plan cap no longer turns every limited route into a 500. They still reach `onError`.
- `@lymit/sdk`: **behaviour change.** The default `timeoutMs` drops from 3000 to 1000, so an outage adds at most ~2 s instead of ~6 s.
