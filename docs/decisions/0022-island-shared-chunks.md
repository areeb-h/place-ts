# ADR 0022: Island bundles use `splitting: true` for cross-island sharing

**Status:** accepted, phase 1 shipped (2026-05-14)
**Date:** 2026-05-14
**Affects:** `systems/component/src/build/island-bundler.ts` (rewritten
to build all islands in ONE `Bun.build` with `splitting: true`);
serving pipeline already serves arbitrary URLs in the bundles map.

## Context

T5-C shipped per-island bundles. T5-C polish added `hydrate()` + 4
mount strategies. T5-E phase 1 fixed a 2 KB-gzipped leak from the
framework barrel statically importing the server-only bundlers.

After all of that, **a typical per-island bundle was still 8.35 KB
gzipped**. The audit (`island-bundle-attribution.ts`) showed ~73% of
that came from `systems/component/src/index.ts` (the framework barrel),
~17% from `systems/reactivity`, ~6% from `systems/capability` —
**every island duplicated the framework runtime**.

For a chrome-heavy page (theme toggle + mobile nav + search palette +
ToC = 4 islands), the naive per-island bundling shipped:
- 4 × 8.35 KB = ~33 KB gzipped just for chrome
- Compare per-route splitting (T5-B-1): 14 KB per page
- **Per-island was WORSE than per-route for chrome-heavy pages.**

This contradicted the "islands ship less JS" promise.

## Decision

Build all islands in **ONE** `Bun.build` call with `splitting: true`.
Bun extracts shared modules (the framework runtime, reactivity core,
capability scope helpers) into auto-named shared chunks. Each island's
entry becomes a thin stub that imports from the shared chunks.

```ts
// Before — N separate builds, each self-contained:
for (const name of names) {
  await Bun.build({ entrypoints: [entryPath], ... })
}

// After — ONE build, splitting:true:
await Bun.build({
  entrypoints: entryPaths,
  splitting: true,
  ...
})
// Returns: N entry-point outputs + M auto-generated shared chunks.
```

Served URL pattern:
- `/islands/<name>.js` — entry stub per island
- `/islands/chunk-<hash>.js` — shared chunks Bun extracted

The browser's ES module import resolution handles cross-bundle imports
correctly because each bundle's relative `./chunk-…` resolves against
its own URL.

## Result

Measured via `test-island-splitting.ts` with 3 synthetic islands
(alpha/beta/gamma, each a counter using `state()`):

| Configuration | First-load total | Per-island marginal |
|---|---:|---:|
| Pre-T5-D (no splitting, 3 separate builds) | ~30 KB gzipped | ~10 KB |
| **Post-T5-D (splitting:true, ONE build)** | **15.74 KB gzipped** | **~952 B** |
| Reduction | -48% | -90% |

Per-island marginal cost dropped from ~10 KB to **~952 B gzipped**.
The first island still pays the framework's ~13 KB shared-chunk cost,
but every additional island on the same page is essentially free
(just the entry stub).

## Consequences

### Positive

- **Linear cost: O(1) framework + O(N) tiny stubs**. The chrome
  problem is fixed: 4 islands ≈ 13 KB shared + 4 × 952 B = ~17 KB
  gzipped total. Compare per-route (14 KB) — comparable on first
  page; islands then **win every subsequent navigation** because the
  shared chunk is cached.
- **Astro-class numbers**. ~952 B per island marginal is better than
  Astro's 3–5 KB per component for the same model.
- **Bundle architecture stays clean.** No manual chunking, no
  `manualChunks` configuration. Bun's automatic splitting works here
  because all islands genuinely share the framework runtime.

### Cost

- **Cross-bundle dependency in ES module form.** Each island bundle
  references `./chunk-<hash>.js` via static `import` statements. The
  browser fetches the chunk on-demand when the island bundle loads.
  Negligible for the modern web; pre-2018 browsers wouldn't handle it.
- **Bun's chunk naming includes a content hash** (`chunk-XYZ.js`).
  Stable within a build but changes between builds. Fine for prod
  (immutable cache headers per content hash) but means dev rebuilds
  produce new URLs each time.
- **The shared chunk content depends on what's used across ALL
  islands.** Adding a new island may change shared-chunk content if
  it pulls in new framework primitives. Cache invalidation is
  per-chunk, not per-island.

### Why this didn't work for routes (T5-B-1)

Earlier we tried `splitting: true` for ROUTE bundles and saw 30
fragmented chunks producing a strictly worse first-load (72 KB total
vs 65 KB baseline). The difference:

- **Routes don't share much code with each other.** Each route's
  page module is unique; the only common code is the layout. Bun
  fragmented aggressively because most shared edges were thin.
- **Islands genuinely share the framework + reactivity + capabilities.**
  These dependencies are SUBSTANTIAL (~13 KB gzipped of code that
  every island uses). The shared chunk amortizes that cost across N
  islands.

The conclusion: **use `splitting: true` ONLY when there's a clear
shared-runtime substrate**. Routes don't have one; islands do.

## Implementation notes

Bun's `BuildArtifact.kind` distinguishes entries (`'entry-point'`)
from chunks (`'chunk'`). The bundler maps entries back to their
island names via the original `entrypoints` array index (Bun
preserves input order). Shared chunks get served at
`/islands/chunk-<hash>.js`; the same `splitterBundles` map in
`serve()` already handles arbitrary URLs.

## Verification

- `bun examples/docs/probes/test-island-splitting.ts` with 3 islands:
  - 3 entries × ~952 B each
  - 5 shared chunks totaling ~12.95 KB gzipped
  - Page first-load: 15.74 KB
  - Per-island marginal cost: ~952 B
- `bun examples/docs/probes/measure-docs-islands.ts` (just
  ThemeToggle):
  - Single island: 10.31 KB gzipped (paid full shared cost, no
    sharing benefit since only one island)
- `bun run typecheck`: clean across 14 projects
- `bun run test`: 1090 passed / 14 skipped / 0 failed

## What this does NOT yet do

- **The docs site has only ThemeToggle migrated.** MobileNav,
  SearchPalette, ToC still use full-page hydration via `clientEntries`.
  Once all four chrome components are islands, `clientEntries` can be
  removed entirely from the docs config — content pages will ship
  only the chrome islands + their shared chunks.
- **No SRI** on the chunk script tags yet. The shared chunks have
  content hashes; adding `integrity` attributes is a one-line
  follow-up but out of scope here.
- **No CSP audit for cross-chunk imports.** The chunk URLs are
  same-origin, so `script-src 'self'` covers them, but a strict
  CSP review is worth a follow-up.

## Migration recipe — converting a component to an island

1. **Identify the component's interaction surface.** Does it use
   `state()`, `onMount`, event handlers, signals? If yes, candidate
   for island. If it's pure JSX, leave it as a regular component.
2. **Rename the implementation function** (e.g. `MyWidget` →
   `MyWidgetImpl`) so we can keep the public name on the island
   wrapper.
3. **Wrap with `island()`** at the bottom of the module:
   ```tsx
   import { island } from '@place-ts/component'
   const MyWidget = island(import.meta.url, MyWidgetImpl)
   export default MyWidget
   export { MyWidget }   // for ergonomic named imports
   ```
4. **Register in `app({ islands: [MyWidget, ...] })`.** Array form
   pulls the name + src from the island's metadata.
5. **No changes needed at use sites.** `<MyWidget ... />` already
   works; the framework auto-detects the island marker emission.
6. **For deferred mounting**, pass `client="idle" | "visible" |
   "interaction"` on the use site:
   ```tsx
   <MyWidget client="visible" {...} />
   ```
