# Security policy

Lymit sits in your request path and holds per-user budgets, so we take reports seriously.

**Report privately** to security@lymit.io with steps to reproduce. You will get an acknowledgement within two business days and a fix or mitigation plan within seven for confirmed issues. Please give us reasonable time to ship before disclosing.

In scope: the `@lymit/sdk` package, `api.lymit.io`, `lymit.io` and the dashboard. Out of scope: denial-of-service testing against production, social engineering, and third-party services we use (Cloudflare, Supabase, Turso, Stripe) — report those to them.

Our own review is published at [docs/security-review.md](./docs/security-review.md).
