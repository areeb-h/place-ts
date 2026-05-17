# ADR 0024: SPA navigation + island DX

**Status:** accepted, shipped (2026-05-15)
**Date:** 2026-05-15
**Affects:** new `systems/component/src/__spa_nav.ts` (inline runtime);
new `systems/component/src/build/discover-islands.ts` (auto-discovery);
`systems/routing/src/index.ts` (pathRouter listens for `place:nav`);
`systems/component/src/build/island-bundler.ts` (auto-mount wrapper
re-scans on `place:nav`); `systems/component/src/index.ts` (renderPage
emits SPA runtime + ServeOptions adds `islandsDir`); docs site
slimmed (every island file -3 lines, app.ts -10 lines).

## Context

T5-D phase 2 (ADR 0023) shipped islands-only docs. Two follow-on
problems surfaced when running the site live:

1. **Full page reload on every navigation.** Without `clientEntry`,
   no JavaScript intercepted `<Link>` clicks. The browser performed
   native anchor-follow → fresh HTML fetch → all island bundles
   re-fetched (bytes cached, but the document restarted, scripts
   re-executed, scroll reset). Astro / Fresh / Solid all provide
   SPA-style navigation in their islands model; we didn't.

2. **Boilerplate.** Each island file ended with three lines:
   ```tsx
   const ThemeToggle = island(import.meta.url, ThemeToggleImpl)
   export default ThemeToggle
   export { ThemeToggle }
   ```
   And `app.ts` had seven `import`s plus an `islands: [...]` array.
   The user wrote ~30 extra lines just for the islands ceremony.

## Decision

### 1. Inline SPA-navigation runtime (`PLACE_SPA_NAV`)

A small (~1.2 KB raw / ~600 B gzipped) inline script injected into
every HTML response when the app has `islands` configured. Plain
`<script>` (not module) so it runs synchronously before any island
bundle. The runtime:

- Captures clicks on `<a data-place-link>` (the marker `<Link>` already
  emits)
- Skips modifier-clicks, `target="_blank"`, external origins, and
  same-page `#fragment` links — those fall through to native behavior
- For everything else: `e.preventDefault()`, fetches the destination
  URL with `Accept: text/html`, parses the response via `DOMParser`,
  swaps `<main>` content (preserving header / footer / sidebar)
- Updates `<title>` and `<html class>` (theme toggle persistence)
- Uses `document.startViewTransition()` when supported (smooth same-
  document animation; falls back to immediate replace on older browsers)
- `history.pushState` to update the URL
- Dispatches `place:nav` so:
  - `pathRouter` updates `RouterCap.path()` (islands subscribed see
    the new path)
  - Each island's auto-mount wrapper re-scans `data-place-island`
    markers in the swapped content (new markers get mounted; existing
    ones are idempotent via `dataset.placeIslandMounted`)
- For browser back/forward (real `popstate`): fetches + swaps the
  same way; the URL is already updated by the browser

Fallback: any fetch error or non-2xx response falls back to
`location.href = url`, so the user can always navigate even if the
SPA runtime fails.

What this does NOT do (deferred):
- Prefetch on hover
- Loading indicator / progress bar
- Form-action SPA submission (forms still submit normally; this is
  separate from `<Link>` interception)
- Disposers on swap (DOM nodes are GC'd; some signal subscriptions
  may leak in the short term — the page GCs them on next navigation)

### 2. `islandsDir` auto-discovery

New `ServeOptions.islandsDir?: string` field. When set, `serve()`
scans the directory at startup, dynamic-imports each `.tsx`/`.ts`/
`.jsx`/`.js` file, and registers the default export as an island.
Files prefixed with `_` are skipped (convention for private modules:
shared state, helpers, `_init.ts`).

The discovery happens server-only (`node:fs/promises` import is
behind a dynamic-import inside `_serveImpl` so it stays out of any
client bundle that might transitively reach this file).

Each discovered file MUST default-export an `island(...)`-wrapped
component. The framework reads `__islandName` and `__islandSrc`
metadata for the registry; missing metadata is a build-time error
with a clear message telling the user to wrap with `island(...)`.

### 3. Slimmer island files

The triple-export pattern was for cases where both `default` and a
named export were needed. With `islandsDir`, the framework only needs
the default; the named export wasn't carrying its weight. Each island
file now ends with:

```tsx
export default island(import.meta.url, MyComponentImpl)
```

One line. The framework's auto-mount wrapper imports default; the
layout/page imports default. Two consistent rules.

## Result

### Files diff

| Before | After |
|---|---|
| `app.ts`: 7 imports + array reg | `app.ts`: `islandsDir: './src/islands'` |
| Each island: 4-line export block | Each island: 1-line `export default island(...)` |
| `<Link>` click: full page reload | SPA fetch + `<main>` swap |

### Live verification

```
=== fetch / ===
islands found:
  /islands/mobile-nav-button.js
  /islands/mobile-nav-drawer.js
  /islands/page-nav.js
  /islands/search-palette.js
  /islands/search-trigger.js
  /islands/theme-toggle.js
  /islands/toc.js
spa runtime:
  1     (PLACE_SPA_NAV injected inline)
```

All 7 islands discovered without explicit registration. SPA runtime
present in every HTML response. Tests: 1090 passed / 14 skipped.

### Bundle cost of the SPA runtime

Inline source: 1,247 B uncompressed in HTML. Gzipped through HTTP
content-encoding: ~600 B. Adds ~600 B per page that's part of an
islands app. Worth it: enables every subsequent navigation to skip
the island bundle re-fetch (each bundle is otherwise re-parsed +
re-executed on every page transition).

## Consequences

### Positive

- **No page reloads on link clicks.** Click → fetch → swap. View
  Transitions API engages automatically for smooth visual transition
  (Chrome 111+, Safari 18+, Firefox 144+).
- **Island bundles + chunks stay in module cache.** Browser doesn't
  re-parse + re-execute on every navigation. Real perf win on slow
  CPUs.
- **DX boilerplate cut roughly in half** for the docs app. From ~30
  lines of island ceremony to ~7.
- **Auto-discovery is a "convention with escape hatch":** the
  framework finds islands by directory + filename; explicit `islands`
  array still works for apps that want to control the order or
  register from multiple sources. Both forms coexist; explicit wins
  if both are set.
- **The pattern composes:** Layouts that use `<Link to="/...">`
  automatically get SPA nav once `islandsDir` is set. No per-link
  opt-in. No `<TransitionLink>` vs `<Link>` distinction.

### Cost

- **The SPA runtime is inline + non-module.** It's always loaded
  immediately. ~600 B gzipped on every page that has any island.
  Cost is fixed regardless of island count.
- **The "all islands import once" doesn't help on first nav.** First
  page load still ships all chrome island bundles (theme, mobile-nav,
  search, ToC, page-nav, mobile-nav-drawer) — same as before. The
  SPA win is on every subsequent navigation.
- **Cross-page state preserved by accident.** Module-level signals
  (e.g. `_mobile-nav-state.ts`'s `open`) keep their value across
  swaps. This is what users typically want for chrome state — the
  search palette stays open during navigation — but unusual for
  page-content islands. Document the behavior; add a `place:nav-
  before` hook in a follow-up if anyone needs to reset state.

### What this does NOT change

- **Same-page `#fragment` links still work via the browser.** The
  runtime explicitly skips them (`location.pathname === u.pathname &&
  location.search === u.search && u.hash`) so deep-link anchor
  scrolling stays standard.
- **External links + `target="_blank"` still open natively.** Runtime
  skips them.
- **The framework's existing pre-boot capture runtime (PLACE_RUNTIME)**
  for streaming-suspense pages is unchanged. SPA_NAV ships alongside.
- **Pages without islands still ship 0 KB of framework JS.** The SPA
  runtime is only injected when `islands` (or `islandsDir`) is set on
  `app()`.

## Verification

End-to-end live with the docs site running on port 4321:
- `curl http://localhost:4321/` returns HTML with all 7 `<script
  type="module" src="/islands/*.js">` tags + inline `PLACE_SPA_NAV`
  runtime
- The runtime references `__place_spa`, `place-link`, `place:nav`
  (all confirmed via grep on the served HTML)
- `bun run typecheck` clean across 14 projects
- `bun run test` — 1090 passed / 14 skipped / 0 failed

## Files diff

New:
- `systems/component/src/__spa_nav.ts` — inline runtime source
- `systems/component/src/build/discover-islands.ts` — directory scan

Modified:
- `systems/component/src/index.ts` — added `islandsDir` option,
  `enableSpaNav` render option, PLACE_SPA_NAV injection
- `systems/routing/src/index.ts` — pathRouter listens for `place:nav`
- `systems/component/src/build/island-bundler.ts` — auto-mount wrapper
  re-scans on `place:nav`
- `examples/docs/src/app.ts` — `islandsDir: './src/islands'`, no
  per-island imports
- `examples/docs/src/islands/*.tsx` (7 files) — single-line default
  export each
- `examples/docs/src/layouts/docs.layout.tsx` — default imports

## Open follow-ups

- **Prefetch on hover.** `<Link prefetch>` already exists as a prop;
  add an `IntersectionObserver`-based eager-prefetch when the link
  enters the viewport. Cost: ~200 B in the SPA runtime.
- **Form-action SPA submission.** `<Form action={action}>` still does
  a full submit. Add interception parallel to the link path so form
  submits also SPA-swap.
- **Disposers across swap.** Wire a `place:before-nav` event that
  fires BEFORE the swap; islands listen + dispose their resources.
  Plus a `place:after-nav` event AFTER swap for analytics hooks.
- **Bun plugin for `island()` boilerplate.** Today users write
  `island(import.meta.url, fn)` per file. A small plugin could
  transform `island(fn)` → `island(import.meta.url, fn)` at build
  time, saving one argument per island. Documented as a follow-up;
  the explicit form stays the public API for now.
