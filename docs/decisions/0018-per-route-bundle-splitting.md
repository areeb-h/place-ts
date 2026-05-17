# ADR 0018: Per-route bundle splitting

**Status:** in progress (T5-B-1)
**Date:** 2026-05-14
**Affects:** `systems/component/src/index.ts` (`serve()`'s `Bun.build`
call), new `systems/component/src/build/route-splitter.ts`; the framework's
client-bundle delivery semantics for every consumer.

## Context

T5-A's audit (`docs/probes/16kb-breakdown.md`) measured the docs app
shipping **62.20 KB gzipped** on every page (post-styles-leak fix).
Per-source attribution showed 53% of the bundle was every docs page's
view code, all bundled together. The root cause is structural: today
`serve()` calls `Bun.build` once at startup with one entry, producing
**one shared `client.js`** served to every page. Every page downloads
every other page's source.

The per-route simulation probe built each of the 25 docs pages as its
own client entry: average per-route gzipped was **20.48 KB** — a 68%
reduction with zero other framework changes. Production splitting
(shared chunk for layout + framework + N per-page chunks) will
outperform the simulation because the shared chunk is amortized across
navigations.

This is the highest-ROI single intervention available before islands
(T5-C). Ship it now.

## Decision

Add per-route bundle splitting to `serve()`'s build pipeline. Each
page route gets its own client bundle (or shared-chunk + per-route
chunk). The HTML emitted for each route references that route's
bundle URL.

### API surface

Add a new optional `clientEntries` option to `app()` / `serve()`:

```ts
app({
  pages: [landing, why, ...],
  // NEW: per-route entry file mapping.
  // Keys are route paths (matching page.path).
  // Values are the absolute or workspace-relative source files
  // to use as that route's bundle entry.
  clientEntries: {
    '/': './pages/index.page.tsx',
    '/why': './pages/why.page.tsx',
    '/concepts/reactivity': './pages/concepts/reactivity.page.tsx',
    // ...
  },
  clientEntry: './app.ts',  // fallback / default entry, also serves
                            // as the shared-chunk seed
}).run()
```

When `clientEntries` is provided:
1. `serve()` calls `Bun.build({ entrypoints: [...all entries], splitting: true })`
   — Bun produces one chunk per entry + auto-extracts shared chunks.
2. Each entry's output URL is recorded in a route → bundle map.
3. For each request, `renderPage()` receives `bootstrap: routeBundleMap[route]`
   instead of the global `clientEntry`.

When `clientEntries` is NOT provided, the existing behavior is
preserved (single shared bundle from `clientEntry`).

### Why opt-in (not auto-discovery)

Three reasons:

1. **Knowing the per-page source path is structural information** the
   framework doesn't have today. `page()` takes the rendered Page
   object as input — it can't introspect "where on disk does this
   come from?" Auto-discovery would require either compile-time
   plugin work (scan the user's `app.ts` for `import` lines) or a
   convention (file-system routes). Both are bigger surgery than
   "let the user say the obvious thing."
2. **It's literally one line per page**, and the user has already
   typed `import landing from './pages/index.page.tsx'` — adding
   `'/': './pages/index.page.tsx'` is mechanical and obvious.
3. **It composes with the future** (T5-C islands, T5-E per-system
   gating, T5-F adapters). Each later cut can layer on the per-route
   bundle map without re-litigating "how do we know each page's
   source."

### What we do NOT do in this ADR

- **No file-system routing.** ADR 0007 and ADR 0003 hold; routes are
  values, paths are strings. The `clientEntries` map is values too —
  no convention.
- **No automatic chunk-splitting heuristics.** We let Bun's
  `splitting: true` extract shared chunks; we don't try to engineer
  the chunking ourselves.
- **No retroactive change to `clientEntry`.** Apps that don't provide
  `clientEntries` keep working unchanged. The opt-in is additive.
- **No retiring of `clientEntry`.** Even with per-route entries, a
  fallback / default entry is useful for legacy routes, 404 pages,
  and SSR-only pages that need no client bundle but still want one
  available.

## Consequences

### Positive

- **Bundle floor drops from 62 KB → ~17–20 KB per content page** on
  the docs site. After T5-B-2's styles.ts fix, this is a further 65–70%
  reduction.
- **No new architectural primitive.** This is a build-pipeline change.
  User-facing API: one map entry per page.
- **Sets up T5-C islands.** Per-route bundles make island manifest
  generation cleaner (islands are per-page, not global).
- **Improves cache hit rate.** When deploying, only routes that changed
  invalidate their bundles. Today every deploy invalidates one shared
  `/client.<hash>.js`.

### Negative / Costs

- **Build time scales with route count.** 25 routes ≈ 25× the build
  computation. Bun is fast (~1 s for the docs app build today), so
  25 s for the full multi-build at the worst case. With `splitting:
  true` and a shared graph, actual cost will be much lower.
- **Memory in dev.** Bun keeps multiple bundles in memory. Should be
  fine for app sizes we target; revisit if dev memory becomes a
  bottleneck.
- **Migration friction for existing apps.** Adding `clientEntries`
  is opt-in but recommended for any app shipping more than 3 pages.
  Documentation needs a clear migration recipe.

### Neutral / clarifying

- **Routes that DON'T have an entry in `clientEntries`** fall back to
  the global `clientEntry`. This lets gradual adoption work.
- **The framework chunk + layout chunk** are extracted by Bun's
  `splitting: true` automatically; we don't manage chunking manually.

## Implementation outline

| File | Action |
|---|---|
| `systems/component/src/build/route-splitter.ts` | New module: takes the `clientEntries` map + bundler options, runs `Bun.build` once with multi-entry + `splitting: true`, returns `{ routeBundleMap, sharedChunks, ... }`. |
| `systems/component/src/index.ts` (the `Bun.build` call at line ~4882) | Edit — if `options.clientEntries` is set, delegate to the splitter. Otherwise existing single-entry path. |
| Routes table (`compileServeRoutes`) | Extend — each route stores its bundle URL alongside the existing `page` ref. |
| Built-in static file route | Extend — serve every bundle in `routeBundleMap` plus the shared chunks. |
| `RenderPageOptions.bootstrap` | Now per-call (per-page), not per-app. |
| `examples/docs/src/app.ts` | Edit — declare `clientEntries` for all pages. |

## Verification

- Re-run `examples/docs/probes/16kb-breakdown.ts` after the change:
  docs bundle on a typical route should drop from 62 KB → ~17–20 KB
  gzipped.
- Re-run `examples/docs/probes/per-route-simulation.ts`: real per-route
  numbers should match the simulation ±5% (production splitter shares
  more, simulation duplicates the layout chrome).
- `bun run test` (1090+ existing tests) stays green.
- Add new tests in `systems/component/tests/unit/route-splitter.test.ts`:
  - Multi-entry build runs without error.
  - Each route's bundle is served at the expected URL.
  - Shared chunks are deduplicated across routes.
  - Fallback (`clientEntry` only, no `clientEntries`) preserves the
    existing single-bundle behavior.
- Browser smoke: visit the docs `/`, `/why`, `/concepts/reactivity`
  pages on the dev server. Each loads its own bundle URL (DevTools
  Network tab). Cross-navigation works. Cmd+K search still works.

## Migration recipe for existing apps

In `app.ts`, add `clientEntries` alongside `pages`:

```ts
import landing from './pages/index.page.tsx'
import why from './pages/why.page.tsx'
// ... etc

export default app({
  pages: [landing, why, ...],
  clientEntries: {
    '/': './pages/index.page.tsx',
    '/why': './pages/why.page.tsx',
    // ... one line per page
  },
}).run()
```

For apps with many pages, a helper:

```ts
// utility that builds clientEntries from a list of [path, sourcePath] pairs
const clientEntries = Object.fromEntries(PAGES_MAP)
```

The relative paths in `clientEntries` resolve from the project root
(or from a configurable base — TBD in implementation).

## Out of scope (deferred to T5-C / T5-E)

- True islands (`island(...)` primitive, per-island bundles) — T5-C.
- Per-system gating (strip unused system code per route) — T5-E.
- Auto-discovery of per-page source paths (scan app.ts imports) —
  deferred indefinitely; opt-in `clientEntries` is enough.
