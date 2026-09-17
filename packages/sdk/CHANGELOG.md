# @lymit/sdk

## 0.1.1

### Patch Changes

- [`a9f3509`](https://github.com/corbae/lymit/commit/a9f350910090f54122523dda472f6a3f624d9b35) Thanks [@corbae](https://github.com/corbae)! - Add the `too_many_requests` error code (the Edge API's per-workspace burst ceiling) to `LymitErrorCode`, and use a full `git+https` repository URL in package metadata.

## 0.1.0

### Minor Changes

- [`b185187`](https://github.com/corbae/lymit/commit/b1851872c447a2e6234ba5ef91b1e2a1ecbf82ce) Thanks [@corbae](https://github.com/corbae)! - Initial release: `Lymit` client with `namespace()` and `limit()`, fixed window, sliding window and cost-based token bucket algorithms, `failMode` open/closed, timeouts with one retry, and an in-process cache for rejected identifiers. Zero dependencies; tested on Node (ESM and CJS), Bun, Deno and Cloudflare Workers.
