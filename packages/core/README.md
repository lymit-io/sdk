# @lymit/core

Pure rate-limit algorithms and shared types. Design: [docs/architecture/algorithms.md](../../docs/architecture/algorithms.md). **Zero runtime dependencies, zero I/O** — no clocks, no network, no storage. Every function takes `now` as an argument, which is what makes the algorithms testable at 0 ms and lets the same code run in the Edge API, the SDK, and any future storage backend.

## Algorithms

All three share one shape:

```ts
algorithm(state | null, resolvedConfig, now, cost = 1) → { state, response }
```

- `state` is the next state to persist (input is never mutated; `null` means "no record yet").
- `response` is a `LimitResponse { success, limit, remaining, reset, retryAfter? }`.
- `cost` is a non-negative integer; `0` peeks without consuming. Rejections never consume.

| Algorithm       | State                                          | Notes                                                                                                                            |
| --------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `fixedWindow`   | `{ windowStart, count }`                       | Epoch-aligned windows, so every node agrees on boundaries with no coordination.                                                  |
| `slidingWindow` | `{ windowStart, currentCount, previousCount }` | Weighted two-window approximation; O(1) state. `retryAfter` is solved exactly.                                                   |
| `tokenBucket`   | `{ tokens, lastRefill }`                       | Lazy continuous refill; all-or-nothing deduction. `reset` = time until full (success) or until `cost` is affordable (rejection). |

All three honour a stored state that is _ahead_ of the local clock rather than resetting it, so a fast-clocked node can never hand out a fresh allowance.

## Helpers

- `resolveConfig(config)` — validates a user `LimitConfig` and converts durations (`"30s"`, `"1h"`, `"1d"`, or ms) to a `ResolvedLimitConfig`. Throws `LymitConfigError` naming the bad field.
- `BlockCache` — bounded LRU cache of known-blocked keys. Stores only retryable rejections, so a stale entry can cost a round trip but never leak capacity.
- `toHeaders(response)` — `X-RateLimit-Limit/Remaining/Reset` and `Retry-After` (whole seconds, never `0`).
- `keyFor(workspaceId, namespace, identifier)` — injective storage/cache key using the ASCII unit separator, which no part may contain.
