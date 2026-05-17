# place

A TypeScript-first web **platform** — a framework of nine interlocking
systems built on Bun — developed against a content-heavy commonplace-book
reference design.

This is not a UI framework. A UI framework has one job (Next.js, Svelte).
A platform has many jobs that share assumptions and conventions (Rails,
Phoenix + LiveView + Ecto + OTP, Redwood). The coherence *between* the
systems is the platform: one reactive timeline, derivation as the
primitive, one inspectable graph.

> **Status (2026-05-17).** Pre-publish. Eight systems shipping + one
> foundational build system; `cache` is charter-only and deferred.
> **1446 tests passing / 14 skipped** across 84 files under Vitest;
> 50 ADRs. Islands are the only hydration model — content pages ship
> zero framework JS. A curated component library (`@place/design`,
> 14 primitives) and a motion sub-module (`@place/reactivity/motion`)
> ship on top. Three example apps run on the framework's own pipeline
> (`serve()` + per-route bundle splitting + auto-Tailwind v4 + strict
> CSP + cookie-driven theming) — no Vite anywhere.

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
| [security](systems/security/) | v0.1 | `signedToken` (HMAC-SHA256), `csrfToken`, `rateLimit`, `SessionCap` + `<Can>` RBAC gate, secure-by-default cookies, `cspHeader` |
| [build](systems/build/) | v0.1 | `Bun.build` integration + per-route splitting, island discovery + bundler, the view classifier, SRI hashing, the dev supervisor |
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
bun run ci                  # lint + typecheck + 1446 tests
bun run dev                 # sandbox playground   → http://localhost:5173
bun run commonplace         # commonplace book app → http://localhost:5174
bun run docs                # docs site            → http://localhost:5175
bun run sync-server         # Bun + bun:sqlite sync server → http://localhost:5180
bun run bench               # benchmark vs Solid
```

## Navigation

- **[docs/platform/](docs/platform/)** — platform-level concerns
  (system map, charter, naming, interfaces, testing strategy,
  prior-art failures). **Start here.**
- **[docs/decisions/](docs/decisions/)** — 50 ADRs. ADR 0001 is the
  stack choice (Bun-everywhere + TypeScript latest).
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
- **[examples/](examples/)** — `sandbox` (reactivity playground),
  `commonplace` (the reference app), `docs` (this framework's docs
  site, built on itself), `sync-server` (single-file Bun sync server).
- **[tests/](tests/)** — cross-cutting e2e + integration + conformance
  tests. Per-system tests live inside each system.

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
