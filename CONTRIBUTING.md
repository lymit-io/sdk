# Contributing to Lymit

Thanks for looking under the hood. The SDK runs in your critical path, so we keep the bar high and the process light.

## Setup

```bash
corepack enable          # pnpm is pinned in package.json
pnpm install
pnpm build               # core + sdk dist (the edge tests import the built SDK)
pnpm test                # every credential-free test, all packages
```

Node 22 (`.nvmrc`). Bun and Deno are only needed for `pnpm --filter @lymit/sdk test:runtimes`.

## Where things live

| Path                | What                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------- |
| `packages/core`     | Pure algorithms and types — zero dependencies, zero I/O. Start here for limiter math. |
| `packages/sdk`      | `@lymit/sdk`, the published client. Fetch-only.                                       |
| `packages/storage`  | Storage contract, in-memory store, Turso migrations, events writer, roll-up job       |
| `packages/supabase` | Control-plane schema, RLS, generated types                                            |
| `apps/edge`         | The Edge API (Cloudflare Worker + Durable Objects)                                    |
| `apps/web`          | Dashboard, docs and landing page (Next.js)                                            |
| `docs/`             | Architecture, decisions (ADRs), benchmarks, plan                                      |

Read [docs/README.md](./docs/README.md) before a non-trivial change; the architecture docs are canonical and every change updates the docs it touches.

## Making a change

1. Tests first. Every algorithm and every storage backend has a spec (`*.test.ts`, the storage contract suite). Add or extend a test before the implementation.
2. `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` must pass. CI runs the same.
3. User-visible SDK changes need a changeset: `pnpm changeset`.
4. Conventional commits: `feat(core): …`, `fix(sdk): …`, `docs: …`.
5. Keep files small and functions focused; no mutation of inputs in `packages/core`.

## Reporting a security issue

Please do not open a public issue. See [SECURITY.md](./SECURITY.md).

## License

MIT. By contributing you agree your contribution is licensed under the same terms.
