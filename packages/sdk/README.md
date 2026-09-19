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

const { success, remaining, reset, retryAfter } = await ai.limit(user.id, {
  cost: estimatedTokens,
});
if (!success) return new Response("Budget exhausted", { status: 429 });
```

## API

### `new Lymit(options)`

| Option    | Default                | Notes                                      |
| --------- | ---------------------- | ------------------------------------------ |
| `apiKey`  | —                      | Required. `lym_live_…` from the dashboard. |
| `baseUrl` | `https://api.lymit.io` | Point at staging or `wrangler dev`.        |
| `fetch`   | global `fetch`         | Inject for tests or custom agents.         |

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

A rate-limit **rejection is a normal result** (`success: false`), never an exception. A **failure to reach Lymit** or a server-side refusal (bad key, plan gate) is a `LymitError` with a stable `code` (`invalid_api_key`, `feature_not_in_plan`, `quota_exceeded`, `bad_request`, `network_error`, `timeout`, `internal`) and `status`.

## Resilience

One attempt plus one retry on network failure or timeout; HTTP responses are never retried. If Lymit is down, times out, or returns a 5xx, `failMode` decides: **open** (default) lets the request through with `remaining = limit` and calls `onError`, because an outage on our side must never take your app down; **closed** rejects it. See the repository's `docs/` for the full design.
