# ADR 0011: Layout persistence in `boot()` — page swaps without remounting the chain

**Status:** accepted
**Date:** 2026-05-13
**Affects:** `systems/component/src/index.ts` `boot()` body

## Context

A mutation-observer audit during the v0.5 polish round 7 showed that
every SPA navigation in the docs site removed and re-added the entire
`<body>` subtree:

```
[ MutationObserver on body.childList ]
  → after click on a sidebar Link:
  → removed: 1 child (the whole layout subtree)
  → added: 1 child (a fresh layout subtree)
```

The visible result: sidebar's reactive state (search trigger focus,
hover highlight, scroll position) reset on every navigation. ToC
component's heading scan ran fresh. Theme toggle's local state would
reset if it carried any. Header / footer / nav DOM-identity changed
every nav. Users perceived this as a "page jump" — a brief flicker
between routes.

The cause was in `boot()`'s SPA-nav handler. The original logic:

```ts
routerWatchDispose = watch(() => {
  const nextPath = router.path()
  if (nextPath === lastPath) return
  lastPath = nextPath
  currentDispose()                                        // dispose previous tree
  while (document.body.firstChild) document.body.removeChild(...)  // clear all
  const next = buildPageTreeForUrl(newUrl)                // build NEW layout-wrapped tree
  currentDispose = next.view.mount(document.body, null)   // mount fresh
})
```

Every nav rebuilt the layout chain *and* the inner page view, then
mounted the whole thing from scratch. Even when the layout chain was
identical across routes (the common case — every docs page uses the
same `docsLayout`), the layout DOM was destroyed and recreated.

## Decision

Refactor `boot()` to keep the layout chain mounted across navigations
and swap only the inner page view via a reactive children slot.

### Implementation

1. Split `matchUrl(url)` from the page-tree builder. It returns
   `{ pageView, layouts, layoutProps, matched }` — the inner page View
   and the un-applied layout chain — without wrapping. Pure; called
   on initial render and every nav.

2. A `pageSlot = state<View | null>(initial.pageView)` holds the
   current inner page view. The layout chain is wrapped with a
   **reactive children function** that reads from `pageSlot`:

   ```ts
   const wrapped = wrapInLayouts(layouts, layoutProps, () => pageSlot() as Child)
   ```

   `wrapInLayouts` returns the layout chain with `children` set to the
   reactive function. The framework's existing mountReactiveChild +
   Fragment.hydrate (ADR 0012) handle the reactive children slot
   identically across hydrate and post-hydrate paths.

3. Initial render: `hydrate(wrapped, document.body)`. Layout DOM is
   adopted from SSR; inner pageSlot subscribes; first paint matches
   SSR exactly.

4. On nav: compare the new match's layout chain to the current one by
   reference array (`sameLayoutChain`). The common case (every page
   uses the same imported `docsLayout`) hits this fast path: just
   `pageSlot.set(next.pageView)`. The layout DOM stays mounted; only
   the reactive children slot re-evaluates and swaps the inner content.

5. Different layout chain (rare — `page({ layout })` overrides): full
   unmount + remount. Preserves correctness for the uncommon case.

### Verified

After the refactor, the same mutation-observer audit on navigation:

```
[ MutationObserver on body.childList ]
  → 4 navigations across /, /getting-started, /why, /concepts/reactivity:
  → 0 mutations
```

DOM-identity checks confirm `aside === initialAside`,
`header === initialHeader` across every nav. Sidebar links update
`aria-current` reactively (per ADR 0010's universal RouterCap); ToC
rescans within the same mounted component.

## Consequences

### User-visible

- Page jumps eliminated. Navigation feels instant — the layout chrome
  doesn't repaint, only the inner content swaps.
- Sidebar / header / footer / theme toggle / search palette keep
  their state across navigation. Search palette opened on `/`, the
  user navigates to `/getting-started`, the palette stays open with
  its query intact.
- Scroll-to-top still happens; the existing
  `globalThis.scrollTo?.(0, 0)` runs unchanged.

### Compatibility

- App authors don't see an API change. Existing `boot({...})` and
  `app({...}).boot()` calls work identically.
- Apps with per-page layouts (`page({ layout })` declaring a
  different chain) fall through to the full-remount path — same
  behavior as before. The fast path covers the common case (one
  shared layout across all pages, or page-level layouts that happen
  to share the same chain prefix).

### Hydration

- The layout chain is mounted with a reactive children function,
  whose hydration relies on the Fragment.hydrate reactive-function-
  child fix (ADR 0012). Without that fix, the page-swap on nav
  would not propagate to the DOM.
- SSR-emitted HTML must match the initial pageView's shape so
  hydration adopts cleanly. This is unchanged from prior boot()
  behavior; the same `buildPageTreeForUrl` data fed both paths.

### Trade-offs

- "Layout chain unchanged" is detected by reference equality of the
  layout array. An app that recreates layout values on every render
  would defeat the fast path. The standard pattern (define layouts
  as module-level values, import them) makes this a non-issue.
- Page-level state (state declared inside the page view, not in the
  layout) still resets on nav because the page view itself is a new
  `View` value each match. That's the right behavior — pages are not
  meant to share state with each other; if cross-page state is
  needed, use a capability or a state in a layout.

## Out of scope

- Layout-prop reactivity. The wrapper passes `layoutProps` (load
  data + URL props) from the initial match; if a page-specific prop
  changes across navigations, the layout doesn't see the update. In
  practice docs/sandbox/commonplace layouts don't use page-specific
  props (they read children only). If a layout needs per-page props,
  it should reach for a capability (e.g. `PageContextCap`) which
  re-installs on each nav.
- Diffing the layout chain element-by-element when reference equality
  fails but the chain happens to compose equally. Premature; the
  common case is one shared layout.
