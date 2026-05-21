# ADR 0023: Islands as the only hydration model (T5-D phase 2)

**Status:** accepted, shipped (2026-05-15)
**Date:** 2026-05-15
**Affects:** `systems/component/src/app.ts` (auto-default `clientEntry`
suppressed when `islands` is set); the docs site
(`examples/docs/src/app.ts`, `layouts/docs.layout.tsx`, all chrome
components moved from `components/` → `islands/`); ADRs 0018, 0019,
0020, 0021, 0022 — this is the close-out that makes their separate
pieces work together end-to-end.

## Context

T5-A through T5-D-phase-1 shipped:
- T5-A audit: docs ships 65 KB gzipped (not 16 KB as memory said).
- T5-B-1 per-route splitting: 65 → 14 KB per page.
- T5-B-2 styles leak fix: -3 KB.
- T5-C islands MVP: 0 KB on pages without `<Island>`.
- T5-C polish: hydrate() + 4 mount strategies.
- T5-E phase 1: dynamic-import bundlers (kill `node:path` leak).
- T5-D phase 1: `splitting: true` for shared chunks across islands.

The remaining gap: the docs site still ran on `clientEntries` (per-
route bundles) because the partial T5-D-phase-1 ThemeToggle migration
**double-paid** — both the per-route bundle AND the island bundle
shipped the same component code. Last session honestly rolled it back.

This session closes the gap by **completing the migration**: all
chrome → islands; remove `clientEntries`; the docs site runs as
islands-only.

## Two architectural questions the migration forced us to solve

### 1. Cross-island state sharing

The MobileNav pattern (button in header, drawer at layout root)
shares `state(false)` via a module-level signal. Two separate islands
can't share module-scope state directly — each bundle has its own
module instance.

**Solution: shared module + `splitting: true`.** Extract the shared
signal into its own tiny module (e.g. `_mobile-nav-state.ts`). Both
islands import from it. Bun's `splitting: true` puts the shared
module in an extracted chunk; the chunk loads ONCE per page (per ES
module spec); both islands see the same `open` signal instance.

Verified empirically (`probes/test-shared-island-state.ts`): two
islands sharing `state(false)` via a third module produce a build
where both entry stubs import from the same shared chunk (`opener.js`
+ `drawer.js` each 934 B; shared chunks ~13 KB total).

No new framework primitive needed. The ES module system gives us this
for free.

### 2. Capabilities (RouterCap) in islands

Full-page hydration installed RouterCap during `boot()` via
`app({ router: pathRouter })`. With islands, there is no `boot()` —
each island self-mounts from its own bundle.

**Solution: `_init.ts` side-effect module.** Islands that use caps
import `./_init.ts` at the top of their module. The init module's
top-level statements install RouterCap. ES module semantics evaluate
the module exactly ONCE per page; `splitting: true` puts it in a
shared chunk so any island can be the first to load it.

```ts
// examples/docs/src/islands/_init.ts
import { pathRouter, RouterCap } from '@place-ts/routing'
const existing = RouterCap.use(null)
if (existing === null) {
  RouterCap.install(pathRouter())
}
```

```ts
// any island using RouterCap:
import './_init.ts'
import { RouterCap } from '@place-ts/routing'
// ... RouterCap.use() works
```

Defense-in-depth: the install is guarded so dynamic-import edge cases
+ HMR don't double-install.

## Decision

Drop `clientEntries` (per-route bundles) for the docs site. All
interactive components live as islands; no full-page hydration runs.
The framework's `app()` is updated so that when `islands` is set,
`clientEntry` is NOT auto-defaulted to `Bun.main` — this is what made
the legacy `/client.js` bundle disappear.

Migration scope:
- Created `examples/docs/src/islands/` directory
- Migrated 7 chrome components into 7 islands + 2 shared-state modules
- `_init.ts` for RouterCap install
- `_mobile-nav-state.ts` + `_search-state.ts` for cross-island state
- Updated `docs.layout.tsx` imports
- Removed `clientEntries` from `app.ts`
- Deleted the 5 obsolete chrome files in `components/`
- Patched `app.ts` framework code: when `islands` is set, suppress
  the auto-clientEntry default

## Result — production-mode measurements

Live docs server, `NODE_ENV=production`:

| Asset | Raw | Gzipped |
|---|---:|---:|
| 7 island entries (combined) | 21.59 KB | **10.32 KB** |
| 2 shared chunks (framework + helpers) | 31.72 KB | **11.70 KB** |
| Landing HTML (incl. inline Tailwind CSS) | 116.70 KB | **16.84 KB** |
| **Full first-page load total** | **138.29 KB** | **27.16 KB** |
| `/client.js` (legacy) | — | **404** |
| `/client/<route>.js` (per-route) | — | **404** |

**Multi-page session comparison** (5 page views, typical reading):

| Architecture | First-nav cost | Subsequent navs | 5-nav total |
|---|---:|---:|---:|
| Single shared bundle (pre-T5) | 65 KB | 0 KB (cached) | 65 KB |
| Per-route splitting (T5-B-1) | 14 KB | 14 KB each | **70 KB** |
| **Islands (T5-D-phase-2)** | 22 KB | 0 KB each | **22 KB** |

Islands win 3.2× over per-route in multi-nav sessions; the shared
chunks cache across every page on the site.

For pages with NO islands (hypothetical content-only site): **0 KB**.

## Consequences

### Positive

- **Multi-nav sessions ship 3× less JS** than per-route bundling.
  Shared chunks cache forever (content-hashed); only entry stubs
  (typically <2 KB) cost anything new.
- **Pages with zero interactivity ship zero JS.** The docs site
  always has chrome, but a hypothetical blog or static landing could
  drop to 0 KB of framework JS — matching Astro / Fresh / Enhance.
- **Cross-island state pattern is documented + verified.** Any future
  island pair (or trio) that shares state uses the same `_xyz-state.ts`
  module pattern — no new framework primitive.
- **Cap installation in islands is documented + verified.** `_init.ts`
  is the documented pattern; works via ES module module-once-only
  semantics + Bun's `splitting: true`.
- **No more `clientEntries` complexity.** The docs config dropped a
  25-entry record. New apps using `islands:` get the right model by
  default (auto-clientEntry off).
- **The framework's `app()` auto-default is now smarter.** Old apps
  without `islands` still get `clientEntry = Bun.main` auto-set;
  new apps with `islands` get a clean islands-only build.

### Cost

- **First-page JS is bigger than per-route** (22 KB vs 14 KB). Apps
  where users hit one page and leave (referral traffic, SEO landing
  pages) don't see the win. For docs / blog / portfolio sites where
  users read multiple pages, islands win.
- **Author overhead.** Every interactive sub-tree explicitly marked
  via `island(import.meta.url, fn)`. Cross-island state requires an
  explicit shared module. The user knows the boundary. This is the
  correct trade-off per ADR 0019 — typed primitives, no magic
  strings.
- **Tightly-coupled cross-island state lives across multiple files.**
  MobileNav split into `mobile-nav-button.tsx`, `mobile-nav-drawer.tsx`,
  `_mobile-nav-state.ts`. Acceptable: this is what they ALWAYS were
  conceptually, just now structurally explicit.

### What this does NOT do

- **No SPA-style client-side navigation.** Each navigation is still
  a full HTML fetch. The shared chunks DO cache via HTTP cache
  semantics, so the JS cost amortizes — but the HTML round-trip is
  there. SPA navigation is a separate (future) feature; doesn't
  conflict with islands.
- **No re-introduction of full-page hydration.** Apps that want it
  can use `clientEntry` explicitly (the auto-default skip is opt-out
  via setting `islands` to a non-empty value). Mixing both is
  allowed but ill-advised.
- **No automatic island discovery via static analysis.** Users
  explicitly register islands in `app({ islands: [...] })`. A future
  compiler pass could discover `island(...)` calls and auto-register;
  for now, explicit is the policy.

## Verification

Live server probe (`examples/docs/probes/probe-prod.sh`):
- 7 island bundles served at `/islands/<name>.js`
- 2 shared chunks served at `/islands/chunk-<hash>.js`
- `/client.js` and `/client/<route>.js` return **404** (no leftover
  full-page-hydration bundles)
- HTML for `/` includes 7 `<script type="module" src="...">` tags
  with CSP nonces

Test suite: 1090 passing / 14 skipped / 0 failed
Typecheck: clean across 14 projects

## Files touched (summary)

New:
- `examples/docs/src/islands/_init.ts`
- `examples/docs/src/islands/_mobile-nav-state.ts`
- `examples/docs/src/islands/_search-state.ts`
- `examples/docs/src/islands/theme-toggle.tsx`
- `examples/docs/src/islands/mobile-nav-button.tsx`
- `examples/docs/src/islands/mobile-nav-drawer.tsx`
- `examples/docs/src/islands/search-trigger.tsx`
- `examples/docs/src/islands/search-palette.tsx`
- `examples/docs/src/islands/toc.tsx`
- `examples/docs/src/islands/page-nav.tsx`
- `examples/docs/probes/test-shared-island-state.ts`
- `examples/docs/probes/probe-prod.sh`

Deleted:
- `examples/docs/src/components/theme-toggle.tsx`
- `examples/docs/src/components/mobile-nav.tsx`
- `examples/docs/src/components/search-palette.tsx`
- `examples/docs/src/components/toc.tsx`
- `examples/docs/src/components/page-nav.tsx`

Modified:
- `examples/docs/src/app.ts` — replaced `clientEntries` with `islands`
- `examples/docs/src/layouts/docs.layout.tsx` — imports updated
- `systems/component/src/app.ts` — auto-clientEntry default skipped
  when `islands` is set
