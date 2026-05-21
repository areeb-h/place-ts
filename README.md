# place

A TypeScript-first web **platform** — a framework of nine interlocking
systems built on Bun — developed against a content-heavy commonplace-book
reference design.

This is not a UI framework. A UI framework has one job (Next.js, Svelte).
A platform has many jobs that share assumptions and conventions (Rails,
Phoenix + LiveView + Ecto + OTP, Redwood). The coherence *between* the
systems is the platform: one reactive timeline, derivation as the
primitive, one inspectable graph.

> **Status (2026-05-21).** Pre-publish. Eight systems shipping + one
> foundational build subsystem; `cache` is charter-only and deferred.
> **1691 tests passing / 7 skipped** across 95 files under Vitest,
> including **51 fast-check property tests** across five systems
> (security, reactivity, routing, capability, persistence). 56 ADRs.
> Islands are the only hydration model — content pages ship zero
> framework JS. A curated component library (`@place/design`, 14
> primitives) and a motion sub-module (`@place/reactivity/motion`)
> ship on top. The high-assurance server-action substrate
> ([`criticalAction()`, ADR 0055](docs/decisions/0055-critical-action-high-assurance-server-actions.md))
> ships envelope-signed requests, IPsec-style replay defense,
> capability-based macaroons, and a tamper-evident audit log. The
> docs site runs on the framework's own pipeline (`serve()` +
> per-route bundle splitting + auto-Tailwind v4 + strict CSP +
> cookie-driven theming) at **Lighthouse 100/100** — no Vite anywhere.

## The systems

| System | Status | Owns |
|---|---|---|
| [reactivity](systems/reactivity/) | v0.1 | `state` / `derived` / `watch` / `untrack` / `batch` / `flush` / `resource` / `history`; the dependency graph + scheduler; the **motion** sub-module (`animate` / `tween` / `sequence` / `curve` / `motionValue` / `motion` / `flip` / `colorMix`) |
| [component](systems/component/) | v0.1 | Component model, JSX via TS automatic runtime, SSR + islands hydration (`page` / `serve` / `boot` / `app`), per-route bundle splitting, per-island HMR, `action()` typed RPC, `recipe()`, `themeTokens()` / `theme()`, `viewport`, typed metadata, per-response CSP nonce, Tailwind v4 integration |
| [capability](systems/capability/) | v0.1 | `defineCapability` / `cap` / `provide` / `install` / `use` / `tryUse` / `requires`; per-request `AsyncLocalStorage` scopes; effect-kind brand types |
| [routing](systems/routing/) | v0.1 | URL ↔ state mapping, `pathRouter` / `hashRouter` / `memoryRouter` / `serverRouter`, `<Link>`, typed route schemas, the `place:nav` SPA-nav event |
| [persistence](systems/persistence/) | v0.1 | Storage adapters (`localStorage` / `indexedDB` / `server` HTTP+WS / `memory` / `crossTab`), `persistedState(adapter)`, durability semantics |
| [search](systems/search/) | v0.1 | `searchable(items)` — in-process substring + structured-query indexer |
| [data](systems/data/) | v0.1 | `collection<T>()` — keyed CRUD over a `State<T[]>` with reactive lookups |
| [security](systems/security/) | v0.1 | `signedToken` (HMAC-SHA256), `csrfToken`, `rateLimit`, `SessionCap` + `<Can>` RBAC gate, secure-by-default cookies, `cspHeader`, the HMAC envelope + IPsec-style nonce store + macaroon primitive + tamper-evident audit log that power `criticalAction()` |
| build | inside `@place/component` | `Bun.build` integration + per-route splitting, island discovery + bundler, the view classifier, SRI hashing, the dev supervisor. Lives in `systems/component/src/build/`; not a top-level system. |
| [cache](systems/cache/) | charter | Deferred. The internal `CacheStore` (powers ISR + image optimization) lives inside `@place/component`; the charter remains as design intent. |

On top of the platform:

- **[`@place/design`](systems/design/)** — a curated component library
  (Button, Field, Dialog, Sheet, Combobox, Toast, Tooltip, Menu,
  Disclosure, Avatar, Badge, Card, Copy, CodeBlock). Native-first:
  every primitive sits on a real browser primitive (`<dialog>`, the
  Popover API, CSS Anchor Positioning, `:user-invalid`,
  `@starting-style`). A package, not a tenth system — see
  [ADR 0016](docs/decisions/0016-design-library-as-package.md).

## Run it

Requires [Bun](https://bun.sh) ≥ 1.2.

```sh
bun install                 # one-time
bun run ci                  # lint + typecheck + 1691 tests
bun run docs                # docs site (the canonical example) → http://localhost:5175
bun run bench               # benchmark vs Solid
```

The docs site dogfoods every shipped system — router, security,
design, reactivity, persistence, search, data via the search palette,
capability via `RouterCap` + `SessionCap`, and the new
`criticalAction()` substrate via the API reference pages. It's
islands-based, hits Lighthouse 100, and is the canonical example
for app patterns.

## Navigation

- **[docs/platform/](docs/platform/)** — platform-level concerns
  (system map, charter, naming, interfaces, testing strategy,
  prior-art failures). **Start here.**
- **[docs/decisions/](docs/decisions/)** — 56 ADRs. ADR 0001 is the
  stack choice (Bun-everywhere + TypeScript latest); ADR 0055 is the
  high-assurance `criticalAction()` substrate.
- **[docs/roadmap.md](docs/roadmap.md)** — long-form project history.
- **[docs/journal/](docs/journal/)** — design journal, one entry per
  session.
- **[docs/audits/](docs/audits/)** — dated state-of-the-framework
  audits.
- **[docs/stability-covenant.md](docs/stability-covenant.md)** —
  versioning + deprecation commitments.
- **[docs/production-readiness.md](docs/production-readiness.md)** —
  honest catalog of what is load-tested vs not.
- **[systems/](systems/)** — one folder per system; each holds its own
  charter, design docs, source, and tests.
- **[examples/](examples/)** — `docs` (this framework's docs site,
  built on itself; the canonical example) and `overlay-preview`
  (dev-overlay sandbox). The Round-6 `sandbox` / `commonplace` /
  `sync-server` apps were retired in commit `d7b5875` (see
  [ADR 0009](docs/decisions/0009-commonplace-flagship.md)) — they
  ran on the pre-islands hydration model that the framework has
  since superseded.
- **[tests/](tests/)** — cross-cutting tests:
  [`conformance/`](tests/conformance/) for charter clauses;
  [`properties/`](tests/properties/) for fast-check property tests
  (51 across 5 systems). Per-system unit tests live inside each
  system at `systems/<name>/tests/`.

## Conventions

- **`systems/<name>/`** is the unit of organization — each holds its
  own charter, design, plan, source, and tests, and is independently
  understandable.
- **Numeric prefixes** on docs (`00-`, `01-`, …) set reading order;
  `00-charter.md` is always the entry point.
- **Per-system tests live in `systems/<name>/tests/`.** Cross-cutting
  tests live in `tests/`.
- **Bun workspaces** glob `systems/*`, `examples/*`, `tools/*`.

## Status & stability

Pre-publish. APIs change freely between sessions — see
[docs/stability-covenant.md](docs/stability-covenant.md) for what is
and isn't promised. Not yet published to npm.

## License

[MIT](LICENSE) © 2026 Areeb.
