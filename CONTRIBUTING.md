# Contributing to Lymit

Thanks for looking under the hood. The SDK runs in your critical path, so we keep the bar high and the process light.

## Setup

```bash
corepack enable          # pnpm is pinned in package.json
pnpm install
pnpm build               # core + sdk dist
pnpm test                # every test, both packages
```

Node 22 (`.nvmrc`). Bun and Deno are only needed for `pnpm --filter @lymit/sdk test:runtimes`.

## Where things live

| Path            | What                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/core` | `@lymit/core`: pure algorithms, config resolution, block cache — zero dependencies, zero I/O. Start here for limiter math. |
| `packages/sdk`  | `@lymit/sdk`, the published client. One `fetch`; bundles core so customers install one dependency-free package.            |

The service behind the API (the Cloudflare Worker, Durable Objects, dashboard) lives in a private repository; this one is everything that runs in your process.

## Making a change

1. Tests first. Every algorithm and every storage backend has a spec (`*.test.ts`, the storage contract suite). Add or extend a test before the implementation.
2. `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` must pass. CI runs the same.
3. User-visible changes need a changeset: `pnpm changeset`.
4. Conventional commits: `feat(core): …`, `fix(sdk): …`, `docs: …`.
5. Keep files small and functions focused; no mutation of inputs in `packages/core`.
6. API surface changes to `@lymit/sdk` are checked by `pnpm --filter @lymit/sdk check:package` (publint + arethetypeswrong).

## Reporting a security issue

Please do not open a public issue. See [SECURITY.md](./SECURITY.md).

## License

MIT. By contributing you agree your contribution is licensed under the same terms.
