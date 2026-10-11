# @lymit/sdk

Edge-first, application-level rate limiting for AI apps. Limit by `userId`, `workspaceId` or `tier` — not IP — and deduct real LLM token cost from a budget with one call. Zero dependencies; tested on every release against Node (ESM and CJS), Bun, Deno and Cloudflare Workers (`workerd`).

```bash
npm install @lymit/sdk
```

```ts
import { Lymit } from "@lymit/sdk";

const lymit = new Lymit({ apiKey: process.env.LYMIT_API_KEY });

const ai = lymit.namespace("ai_generation", {
  algorithm: "tokenBucket",
  capacity: 5000, // tokens the bucket holds
  refillRate: 1000, // tokens added every `interval`
  interval: "1h",
});

const { success, retryAfter } = await ai.limit(user.id, { cost: estimatedTokens });
if (!success) return new Response("Budget exhausted", { status: 429 });

const result = await generateText({ model, prompt });
await ai.settle(user.id, { reserved: estimatedTokens, actual: result.usage.totalTokens });
```

## API

### `new Lymit(options)`

| Option    | Default                | Notes                                      |
| --------- | ---------------------- | ------------------------------------------ |
| `apiKey`  | —                      | Required. `lym_live_…` from the dashboard. |
| `baseUrl` | `https://api.lymit.io` | Point at staging or `wrangler dev`.        |
| `fetch`   | global `fetch`         | Inject for tests or custom agents.         |

Resilience options (`failMode`, `timeoutMs`, `onError`, `enableEphemeralCache`) are under [Resilience](#resilience).

### `lymit.namespace(name, config)`

Declares a namespace. `config` is validated immediately, so a typo fails at startup rather than on the first request. Limits can be changed later from the dashboard (Pro) without touching code — the edge layers workspace config and per-identifier rules over what you declare here.

| Algorithm       | Config                               | Use for                                                   |
| --------------- | ------------------------------------ | --------------------------------------------------------- |
| `fixedWindow`   | `{ limit, window }`                  | Simple request caps                                       |
| `slidingWindow` | `{ limit, window }`                  | Caps without boundary bursts                              |
| `tokenBucket`   | `{ capacity, refillRate, interval }` | Budgets where requests have different costs (LLM tokens). |

Durations are ms or `"500ms"`, `"30s"`, `"10m"`, `"1h"`, `"1d"`.

### `namespace.limit(identifier, { cost? })`

Resolves to `{ success, limit, remaining, reset, retryAfter? }`.

- `cost` — non-negative integer, default `1`; `0` peeks without consuming.
- `reset` — Unix ms. Windows: end of the current window. Token bucket: when full again (success) or when `cost` is affordable (rejection).
- `retryAfter` — ms until a retry can succeed. Absent on success and when the rejection can never clear (`cost` > capacity).

A rate-limit **rejection is a normal result** (`success: false`), never an exception. A mistake in your code or setup (`invalid_api_key`, `feature_not_in_plan`, `bad_request`) throws a `LymitError` with a stable `code` and `status`. Everything else on our side goes through `failMode` (below).

### `namespace.settle(identifier, { reserved, actual })`

Charges the real cost once you know it: pass the `cost` you reserved with `limit()` and what the call actually cost (for an LLM, the response's total tokens).

- **Over-estimate:** the difference is refunded, never past `capacity`.
- **Under-estimate:** the difference is charged even if that leaves the identifier **in debt**; its next `limit()` waits until refill has repaid it. Dropping the charge instead would give a nearly empty budget, the abuse case, free tokens.
- Resolves to the state after settling, or `null` when `actual === reserved` (no request is made) or Lymit could not be reached. The cost was already incurred, so settle never fails your request on an outage, whatever `failMode` says; it reports through `onError`.
- On windows (`fixedWindow`, `slidingWindow`) it adjusts the current window's count, never below zero.

## Resilience

| Option                 | Default        | Notes                                                                                        |
| ---------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| `failMode`             | `"open"`       | What happens when Lymit cannot answer (below).                                               |
| `timeoutMs`            | `1000`         | Per attempt. One retry, so an outage adds at most ~2 s.                                      |
| `onError`              | `console.warn` | Receives the `LymitError` whenever `failMode` applies.                                       |
| `enableEphemeralCache` | `true`         | Remember rejected identifiers in-process until their `reset`; repeat offenders cost no call. |

One attempt plus one retry on network failure or timeout; HTTP responses are never retried. When Lymit is down, times out, returns a 5xx, or your workspace is over its plan quota or per-minute ceiling (`quota_exceeded`, `too_many_requests`), `failMode` decides: **open** (default) lets the request through with `remaining = limit` and calls `onError`, because nothing on our side, billing included, should take your app down; **closed** rejects it.

A warm call takes 11–23 ms in North America, Europe and Australia. The first call into a cold Cloudflare location can take over a second, which is why the default timeout is not lower. Method and numbers: [lymit.io/docs](https://lymit.io/docs).
