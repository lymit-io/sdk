# Changesets

`@lymit/sdk` is versioned and published with [Changesets](https://github.com/changesets/changesets).

- **Made a user-visible change to the SDK?** Run `pnpm changeset`, pick `@lymit/sdk`, choose `patch` / `minor` / `major`, and write one or two lines a user would want in the changelog. Commit the generated `.changeset/*.md` with your change.
- Internal-only changes (tests, docs, CI, the private packages) need no changeset.
- On push to `main`, the **Release** workflow opens or updates a "Version Packages" PR that bumps versions and writes `packages/sdk/CHANGELOG.md`. Merging that PR publishes to npm with provenance.

Private workspace packages (`@lymit/core`, `@lymit/storage`, the apps) are never versioned or published; `@lymit/core` is bundled into the SDK at build time.
