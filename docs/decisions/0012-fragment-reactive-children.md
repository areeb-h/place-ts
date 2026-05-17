# ADR 0012: Fragment.hydrate handles reactive function children via paired sentinel anchors

**Status:** accepted
**Date:** 2026-05-13
**Affects:** `systems/component/src/index.ts` `Fragment.hydrate`; `systems/component/src/types.ts` `HydrationSlot.parent()`; `tests/conformance` + hydrate unit tests

## Context

Several user reports across v0.5 polish rounds traced back to the same
underlying gap. Symptoms:

1. TypingCode component on the landing page rendered empty on hard
   refresh. Returning `<>{() => <CodeBlock code={text.slice(0, visible())} />}</>` —
   a Fragment containing a function child that reads reactive state —
   the SSR-emitted CodeBlock adopted at hydrate, then never re-rendered
   when `visible()` advanced.

2. ToC's `<Show when={() => headings().length > 0}>{() => <ul>...</ul>}</Show>`
   stayed empty after navigation. Same shape: Show is implemented as
   `Fragment({ children: () => when() ? children() : null })` — a
   function child of a Fragment that reads reactive state.

3. Modal/drawer patterns using `<Show when={open}>` for content that
   appears post-hydrate didn't render the content when `open()` flipped.

The cause was in `Fragment.hydrate`. Function children were resolved
once via `untrack(fn)`, the result was hydrated against the slot, and
no reactive subscription was set up:

```ts
if (typeof child === 'function') {
  const resolved = untrack(() => (child as () => Child)())
  hydrateChild(resolved)
  return
}
```

This treated the function as static at hydrate time. Any subsequent
state change that should have re-evaluated it was lost. The same code
path worked correctly via element.hydrate (which uses
`mountReactiveChild` for function children), but Fragment had no
element to bound the reactive region.

Workarounds users had developed:
- Wrap in a `<div>{() => …}</div>` (uses element.hydrate path — works,
  but adds a wrapper element)
- Wrap in `<ClientOnly>` (suppresses SSR entirely — drops first-paint
  content)
- Replace `<Show>` with `<Activity>` (renders all branches with hidden
  toggle — works but different semantic)

Each workaround dodged the bug; none fixed it.

## Decision

`Fragment.hydrate` adopts function children with paired comment-marker
anchors that bound the reactive region. When the function's result
changes after hydrate, the watch tears down the prior render (DOM +
disposers) and remounts the new value between the anchors.

### Implementation

The slot abstraction gained a `parent(): ParentNode` accessor so the
hydrate path can insert anchor comments into the same node the slot
walks. Per function child:

1. Insert `startAnchor` (an empty `Comment`) at the current cursor
   position — BEFORE the function's SSR'd output.
2. Resolve `initial = untrack(fn)` and `hydrateChild(initial)` into a
   sub-cleanups array. The slot cursor advances past the SSR'd nodes.
3. Insert `endAnchor` at the new cursor position — AFTER the function's
   SSR'd output.
4. Snapshot every DOM node between the two anchors (the "current"
   range).
5. Register a `watch(fn)`. First firing returns without remount
   (re-subscribes to fn's deps). Subsequent firings:
   - Dispose `subCleanups`, clear `currentNodes` from the DOM
   - `mountChild(parent, resolved, endAnchor)` — fresh mount before the
     end anchor
   - Re-snapshot the new range as the next `currentNodes`

The two anchors make the range unambiguous even when fn renders
nothing (closed `<Show>` with no fallback): startAnchor and endAnchor
are adjacent siblings; subsequent open-state remounts insert between
them.

Error handling routes via `ErrorBoundaryCap.tryUse()` (same path as
`mountReactiveChild`).

### Tests

Three new tests in `systems/component/tests/unit/hydrate.test.ts`:

1. Reactive function child of a Fragment, predicate flips
   closed→open→closed across multiple cycles. Asserts surrounding
   Fragment siblings stay mounted.
2. `<Show>` re-renders when the predicate flips post-hydration. The
   regression test for the original reports.
3. Function child SSR-rendered with the TRUE branch (open initially),
   then closed and reopened. Covers the inverse adoption path —
   adopted nodes must be tracked and replaceable.

945/945 tests green.

## Consequences

### User-visible

- `<Show when={…}>{() => …}</Show>` works correctly across
  hydration. Modals, drawers, conditional content all re-render when
  the predicate flips.
- `<>{() => …}</>` (Fragment with reactive function child) is no
  longer a hydration trap. Users can use the natural shape.
- Three workarounds previously deployed in the docs (TypingCode
  wrap-in-div, ToC wrap-in-ClientOnly, mobile-nav/search-palette
  swap-to-Activity) became unnecessary. TypingCode reverted to the
  clean Fragment shape this session; the other two stay on `<Activity>`
  because Activity is the genuinely-right primitive for those cases
  (modal content stays in DOM, animation-friendly).

### Architectural

- Layout persistence (ADR 0011) depends on this fix. The layout
  chain wraps the inner page view with a reactive children function;
  hydrating that function relies on Fragment.hydrate's new behavior.
- The slot abstraction gained one method (`parent()`). Backward-
  compatible; existing consumers (only `el()`-internal code) ignore it.

### Trade-offs

- Two anchor comments per function child add ~2 DOM nodes. Negligible.
- The watch fires once on initial mount (to subscribe) without
  remounting; tiny overhead.
- Comparing this to a "rebuild the full subtree on every fn() change"
  approach would be simpler but lose the per-element granularity. The
  paired-anchor approach matches the precision of element.hydrate's
  clear-and-mountChildren.

## Out of scope

- `mountReactiveChild` unification. The two paths (element-level
  reactive children via `mountChild`, fragment-level via these anchors)
  could share more code. They're similar but not identical
  (element-level has a single comment anchor; fragment-level needs
  two). Refactor candidate for a later session.
- Reactive function children that return a *function* themselves.
  Such recursion would need extra care; today's implementation
  resolves once per watch fire, treats the result as a Child, and
  recurses for arrays. Function-returning-function is unhandled.
