# ADR 0019: Typed islands (not string-directives)

**Status:** accepted (T5-C, MVP shipped 2026-05-14)
**Date:** 2026-05-14
**Affects:** `systems/component/src/index.ts` (new `<Island>` primitive +
`islands` ServeOption + render-time collection); new
`systems/component/src/build/island-bundler.ts`; the framework's
hydration model.

## Context

T5-A's audit measured the docs app shipping 65 KB gzipped on every
page; T5-B-1's per-route splitting dropped that to ~14 KB per page.
But the competitive floor for content pages is **0 KB** — Astro,
Fresh, Enhance, and 11ty all hit this on pages with zero interactivity.
The framework's current model (full-page hydration with fine-grained
reactivity) cannot reach 0 KB because every page mounts on the client,
even when the page has no event handlers.

The strategic call (user, 2026-05-14): **drop full-page hydration,
commit to islands.** Industry consensus is clear; we're on the losing
side.

But ADR 0003 explicitly rejected `'use client'` / `'use server'`
string-directives:

> RSC's compile-time string scan... we will not.

Research correction (T5 research pass): that rejection was about
**string-as-directive magic**, not about typed per-component runtime
targeting. Astro's `client:visible` is a typed JSX prop the compiler
statically resolves — not a magic string. This ADR records that
distinction so future-me doesn't re-litigate it.

## Decision

Add a typed `<Island>` primitive + an `islands` registry in
`ServeOptions` / `AppConfig`. Pages opt into client interactivity by
rendering `<Island name="..." props={...}>` for the sub-trees that
need it. Pages without any `<Island>` ship **zero `<script>` tags
→ 0 KB JS floor**.

### API

```ts
// Some island component (a regular component module).
// islands/counter.tsx
export default function Counter({ start = 0 }: { start?: number }) {
  const count = state(start)
  return <button onClick={() => count.set(count() + 1)}>{count}</button>
}
```

```ts
// app.ts — register the island
import counter from './islands/counter.tsx'

app({
  pages: [...],
  islands: {
    Counter: { component: counter, src: './islands/counter.tsx' },
  },
})
```

```tsx
// In any page's view:
<main>
  <h1>Hello</h1>
  <Island name="Counter" props={{ start: 5 }} />
</main>
```

The framework:
1. **SSR**: renders `Counter({ start: 5 })` server-side, wraps in
   `<div data-place-island="Counter" data-place-island-props='{"start":5}'>...SSR'd HTML...</div>`
2. **Build**: produces a self-contained `/islands/Counter.js` bundle
   that imports the island module + an auto-mount footer
3. **Render**: collects island names used during render; emits one
   `<script type="module" src="/islands/Counter.js">` per used island
   (deduped automatically) at the end of `<body>`
4. **Client**: the bundle's auto-mount footer finds every
   `[data-place-island="Counter"]` marker, deserializes the props,
   and `mount()`s the component into the marker

Pages with NO `<Island>` element emit no `<script>` tag, no bootstrap
import, no framework JS at all.

### Why this is NOT a string-directive

The `name` prop is a typed string with autocomplete (TypeScript can
narrow `name` to the keys of `islands` if the user types their config).
The `<Island>` element is a normal JSX element, statically resolvable
at parse time — no compiler magic, no string-as-directive convention,
no `'use client'`. ADR 0003 stands; this is additive, not contradictory.

### What the registration shape gives us

Two reasons to pass `{ component, src }` (instead of just one):

1. **`component`** is the eagerly-imported server-side component.
   Importing it at the user's `app.ts` (or wherever they want)
   gives the framework a real callable for SSR — no dynamic import
   at render time, no waiting on a Promise.
2. **`src`** is the source-file path the framework bundles per-
   island. The framework can't introspect "where on disk is this
   component's source?" from a function reference; the explicit
   `src` closes that gap without compiler magic.

Verbose but explicit. A future compiler pass (Tier 2-B template
hoisting / static JSX extraction) could derive both fields from a
single `import` if we want to reduce ceremony — but it's not the
critical path.

## Consequences

### Positive

- **Content pages: 0 KB JS floor.** Verified by the T5-C probe — a
  page with no `<Island>` element emits no `<script>` tags.
- **Interactive pages: only the island ships JS.** Measured 7.64 KB
  gzipped for a Counter island. Compare: pre-T5-C content pages
  shipped 14–65 KB regardless of interactivity.
- **No breaking change to ADR 0003.** Typed primitives ≠ string-
  directives. Future code can still rely on "no `'use client'` magic."
- **Composes with T5-B-1 per-route splitting.** Routes that use no
  islands AND no `clientEntries` ship 0 KB. Routes that use islands
  ship ONLY their island bundles. Routes that have legacy full-route
  bundles (via `clientEntries`) still work — no migration is forced.

### Negative / Costs

- **Build time scales with island count.** Each island is one
  `Bun.build` call. 10 islands = 10 builds. Bun is fast; not a real
  concern at the framework's target scale.
- **Author overhead.** Users mark interactive sub-trees explicitly.
  This is the correct trade-off (the framework can't auto-detect
  what's interactive without a compiler scan) — but it's friction
  vs. "everything just works" frameworks.
- **First-paint flash on islands.** MVP uses `mount()` which
  re-renders the island after SSR; SSR'd content is briefly replaced.
  Acceptable for v1. Future cut: switch to `hydrate()` which attaches
  reactivity to existing DOM without re-rendering.

### Neutral / clarifying

- **No mount strategies yet (MVP).** Every island mounts immediately
  on `DOMContentLoaded`. Astro-style `client:load` / `client:idle` /
  `client:visible` / `client:interaction` strategies are a follow-up
  cut. The primitive's API is forward-compatible: `<Island name="..."
  on="idle" ...>` can be added later without breaking existing call
  sites.
- **No cross-island state composition** (yet). Islands today render
  in isolation; passing state between two islands requires either
  prop drilling at SSR time or a module-scoped signal (which works
  because reactivity is module-scoped, not React-context-scoped).
  A future cut can add explicit cross-island state via the
  capability system.

## Implementation outline (shipped)

| File | Action |
|---|---|
| `systems/component/src/index.ts` | Added: `IslandRegistration` type, `<Island>` component, `_beginIslandCollection` / `_endIslandCollection` / `_setIslandRegistry` / `_setIslandBundleUrls` internals, `islands` option on `ServeOptions`, render-time collection + per-page script emission. |
| `systems/component/src/build/island-bundler.ts` | New module: `buildIslandBundles()` generates a wrapper entry per island (auto-mount footer) + builds via `Bun.build`. |
| `systems/component/src/meta.ts` | Added `extraScripts?: readonly string[]` to `DocumentParts`; `renderDocument` emits one `<script type="module" src>` per entry. |
| `examples/docs/probes/verify-t5c.tsx` | Verification probe — proves zero-JS floor + island bundle works. |

## Verification

T5-C MVP verified end-to-end (2026-05-14):

- `bun examples/docs/probes/verify-t5c.tsx`:
  - Test A — page without islands: zero islands collected, no
    `data-place-island` in HTML ✓
  - Test B — page with `<Island name="Counter" props={{ start: 5 }}>`:
    island name "Counter" collected; marker emitted with serialized
    props + SSR'd content ✓
  - Test C — per-island bundle: 20.08 KB raw / **7.64 KB gzipped**;
    auto-mount footer included ✓
- `bun run typecheck` clean across all 14 tsconfig projects
- `bun run test` — 1090 passed / 14 skipped / 0 failed

## What this does NOT do (yet)

- **Mount strategies** (`load` / `idle` / `visible` / `interaction`).
  MVP is `load`-style only (mount on `DOMContentLoaded`).
- **Hydration without re-render.** MVP uses `mount()`; switch to
  `hydrate()` later to eliminate the first-paint flash.
- **Retire `<ClientOnly>` / `<Deferred>` / `hydrate()`.** Those stay
  for back-compat through T5-D. The full-page hydration model isn't
  removed yet — just no longer the only option.
- **Cross-island shared state.** Islands today are independent. A
  later cut can wire shared state via the capability system.
- **`<Island>` as a compiler-detected primitive.** Today users
  register islands explicitly in `app({ islands })`. A future
  compiler pass could discover `<Island>` call sites and auto-
  generate the registry — but the explicit pattern is enough for
  shipping the floor-to-zero outcome.

## Migration recipe

For new code: use `<Island>` for any sub-tree that needs
interactivity; otherwise plain JSX. Pages with no `<Island>` ship 0 KB.

For existing apps using `<ClientOnly>` / `<Deferred>`: those still
work. Migration to `<Island>` is incremental — convert one
interactive component at a time, measure the bundle reduction, move
on. T5-D will eventually retire the legacy primitives once all docs
+ commonplace + sandbox examples migrate.
