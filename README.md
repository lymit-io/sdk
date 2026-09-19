# Lymit SDK

Edge-first rate limiting and per-user AI budgets. This repository is everything that runs inside **your** process: the client and the algorithms it bundles.

| Package                          | npm                                                                                               | What                                                                                                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@lymit/sdk`](./packages/sdk)   | [![npm](https://img.shields.io/npm/v/%40lymit%2Fsdk)](https://www.npmjs.com/package/@lymit/sdk)   | The client: `new Lymit({ apiKey })`, `namespace()`, `limit()`. Zero dependencies. Node, Bun, Deno, Cloudflare Workers.                                                                   |
| [`@lymit/core`](./packages/core) | [![npm](https://img.shields.io/npm/v/%40lymit%2Fcore)](https://www.npmjs.com/package/@lymit/core) | Pure algorithms — fixed window, sliding window, token bucket — config resolution and the block cache. Bundled into the SDK; published for anyone who wants the math without the service. |

```ts
import { Lymit } from "@lymit/sdk";

const lymit = new Lymit({ apiKey: process.env.LYMIT_API_KEY });
const ai = lymit.namespace("ai_generation", {
  algorithm: "tokenBucket",
  capacity: 5000, // tokens per user
  refillRate: 1000, // refilled every…
  interval: "1h",
});

const result = await ai.limit("user_123", { cost: 150 });
// { success, limit, remaining, reset }
```

Docs: [lymit.io/docs](https://lymit.io/docs). Sign in at [lymit.io](https://lymit.io) for a key.

## Principles

- **A rejection is a result, not an exception.** `success: false` comes back with `remaining` and `reset`; only unreachable service or bad input throws.
- **Your uptime does not depend on ours.** If Lymit cannot be reached the SDK fails **open** by default (configurable), after one retry, within a 3 s timeout.
- **No hidden dependencies.** One `fetch`. Core's algorithms are inlined at build time.
- **Known-blocked callers cost no round trip.** An in-process block cache answers repeat offenders until their `reset`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Security reports: [SECURITY.md](./SECURITY.md).

MIT — see [LICENSE](./LICENSE).
