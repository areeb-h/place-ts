# ADR 0027: "Thaw" — resumability, our way

**Status:** deferred — classifier ready, runtime not built (2026-05-21)
**Date:** 2026-05-15
**Affects:** future `systems/component/src/thaw.ts`; future
`systems/component/src/build/thaw-bundler.ts`; documentation under
`systems/component/docs/`.

> **Inventory note (2026-05-21).** No `thaw.ts` runtime, no
> `thaw-bundler.ts`. The view-classifier ([view-classifier.ts])
> recognises the L1 "thaw" level and the manifest labels which
> islands could compile to it, but every island today emits at L2
> ("island", per ADR 0030's inventory note). The trigger to build
> the L1 thaw runtime hasn't fired: the candidate workload is a
> static-mostly site whose islands carry only `state` + reactive
> reads (no `watch`, no `onMount`), where the 1.5KB shared thaw
> runtime would beat the per-island L2 hydration bundles. The
> docs site has plenty of such candidates per the classifier
> report (`page-nav`, `theme-toggle`, `code-block` would all
> classify as L1) — but the L2 emitter at 4-7KB per island
> already hits Lighthouse 100 with TBT 0ms, so the demand is
> theoretical. Build the runtime when a workload demonstrates a
> measurable improvement, not before.

## Context

Qwik invented "resumability": the server emits the rendered HTML
*plus* a serialized snapshot of all state + serialized references to
all event handlers. The client downloads a tiny (~1 kB) shell;
nothing else runs until the user touches something, at which point
the relevant code chunk lazy-loads.

We surveyed it in Tier 5 and rejected the full Qwik model because
the **serialization tax** dominates the wins:

- Every captured closure must be serializable.
- Every state slot is part of the wire format.
- The compiler splits source by **QRL** (Qwik Resource Locator) — an
  implicit annotation the author cannot easily inspect, audit, or
  fail-loud-when-wrong. Charter non-negotiable #7 ("magic with
  clarity", ADR 0026) wants every magical inference to be
  discoverable in source, traceable in tooling, and faithful to
  performance budgets. QRLs fail the first two.
- Debugging is a maze of dozens of micro-chunks named after content
  hashes.

But the *outcome* Qwik chases is the right outcome: **page → HTML →
zero JS work until interaction → only-what's-needed JS on demand.**
Today, place-ts's islands model gets us to the same first-paint
profile (0 kB framework on a content page) but pays a hydration tax
on every island load: the impl function re-runs, every `state(…)`
call re-runs, every `watch(…)` re-fires once on registration. For a
docs site with 7 islands per page that's measurable (~3-8 ms of JS
work per island × 7 = 21-56 ms after T6's setAttr + scheduler fixes;
single-digit ms each since the bug fix).

We can take a piece of resumability's idea without the tax. This
ADR specifies what.

## The insight

The hydration tax has two sources:

1. **Building the reactive graph** (running `state()`, `derived()`,
   `watch()`). Cheap individually, real in aggregate. Wraps every
   island load.
2. **Attaching DOM listeners to the SSR'd tree.** This is the actual
   "make it interactive" cost, and it's unavoidable for full
   interactivity.

Qwik attacks #1 by serializing the graph state and *never running
the impl on the client* — handlers reach back through QRLs into
isolated bundles. Heavy serialization, fragile compiler magic.

place-ts can take a narrower bite. For **a large class of common UI
patterns** — toggles, counters, form-driven state, click-to-set
behavior, value-bound updates — the reactive graph IS trivially
reconstructable from `data-*` attributes the server already knows.
For those, we don't need to ship the impl at all; we ship a small
**action registry** plus an inline event-delegating runtime, and let
the SSR'd HTML *be* the source of truth for what's interactive.

Call this **thaw**: the SSR'd page comes off the wire cold; user
interaction "thaws" the relevant action; the framework runs the
action; state updates flow back to the SSR'd DOM via marker
attributes. No island bundle for the static-shape case.

Components whose state graph isn't trivially reconstructable (the
ones with `onMount` timers, async resources, cross-island shared
state) fall back to the existing island model — no regression for
them.

## Design

### Authoring shape (proposed)

```tsx
import { thaw, state } from '@place-ts/component'

// `thaw()` is the sibling of `island()`. Same place in the JSX call
// site (`<Counter />` becomes a marker at SSR + delegated event
// listeners at runtime). What's different: the impl declares its
// state slots + named actions explicitly, so the server can
// serialize "what's interactive" without ever needing to ship the
// component's JS.
export default thaw(import.meta.url, {
  // Initial state values. Each slot becomes a DOM-anchored signal.
  state: () => ({
    count: 0,
  }),

  // Named actions. The function bodies CAN run on the client, but
  // the framework also extracts a *symbolic* representation when the
  // body is pure-arithmetic-on-state (the common case). When pure,
  // the action runs server-side or via a tiny inline action
  // interpreter; the action body never ships as code. When NOT pure
  // (you reach for `Date.now()`, `fetch`, etc.), the framework
  // bundles just that action as a micro-chunk and lazy-loads it.
  actions: {
    inc: ({ state }) => state.count.set(state.count() + 1),
    dec: ({ state }) => state.count.set(state.count() - 1),
    reset: ({ state }) => state.count.set(0),
  },

  // View. JSX with `thaw:click`, `thaw:input`, `thaw:submit`, etc.
  // directives instead of `onClick={…}`. The value is an action name
  // (a closed enum of `keyof actions`), not a function — typed.
  view: ({ state }) => (
    <div>
      {/* Reading `state.count` in the view wires up a `data-thaw-bind`
          attribute the runtime watches. The displayed text is the
          server's render; subsequent updates come from the action
          interpreter. */}
      <span>{state.count}</span>
      <button thaw:click="inc">+</button>
      <button thaw:click="dec">−</button>
      <button thaw:click="reset">reset</button>
    </div>
  ),
})
```

### SSR output

```html
<!-- thaw marker, like data-place-island but with a snapshot of the
     state values + the bundle URL for non-pure actions only -->
<div data-thaw="counter" data-thaw-state='{"count":3}'>
  <span data-thaw-bind="count">3</span>
  <button data-thaw-click="inc">+</button>
  <button data-thaw-click="dec">−</button>
  <button data-thaw-click="reset">reset</button>
</div>
```

State is **inline JSON** on the marker (small — a few numbers, not
a full object graph). Action names are inline. No URL fetch
required for the trivial case.

### Inline runtime (~1.5 kB gzipped)

One inline script registers a *single delegated event listener* per
event type. On click of any `[data-thaw-click]`:

1. Walk up to the nearest `[data-thaw]` ancestor (the component
   boundary).
2. Read `data-thaw-state` JSON.
3. Look up the action name in either (a) the inline action
   registry for pure actions (interpreted: `state.x.set(state.x() +
   1)` is a small AST), or (b) the action's lazy-loaded micro-bundle
   for impure actions.
4. Run the action against an in-memory state object derived from
   the JSON snapshot.
5. Walk descendant `[data-thaw-bind="<key>"]` elements, update their
   textContent (or attribute, for `data-thaw-attr-<name>`).
6. Re-serialize `data-thaw-state` so subsequent clicks compose.

### Pure-action interpreter

The framework's compile-time pass over each thaw declaration
inspects the action body. If it consists of:

- `state.<key>(…).set(<arithmetic on state values + constants>)`
- `state.<key>(…).update(<pure fn on state>)`
- early returns based on `if (state.<key>() === …)`

then it's **pure** and can run client-side without shipping JS —
the interpreter walks the AST blob shipped inline with the registry.
The body of `inc: ({state}) => state.count.set(state.count() + 1)`
serializes to a 30-byte op-list:
`{op: "set", key: "count", expr: ["+", ["get", "count"], 1]}`.

For the docs reactivity demo's `bump(a, 1, aFlash)` — that calls a
helper, reads + writes multiple states. Borderline pure; the
compile-time pass either inlines the helper (yes — it's defined in
the same module) or punts to lazy-load.

When punted: a `/thaw/<bundle>.js` URL is fetched on first
interaction. Bundle is tiny (just that one action, not the whole
component). Cached after first fetch.

### What thaw CANNOT do

Be honest in the docs about the boundary:

- **No `onMount` lifecycle.** Thaw components don't run code on
  mount — they have no JS yet. Need a periodic timer, websocket,
  IntersectionObserver? Use `island()`.
- **No `derived()`.** Derived values must be expressible as
  pure-arithmetic actions OR computed server-side and re-snapshotted
  per action. We can support the second pattern: every action that
  writes to a state slot also recomputes the derived slots from the
  same op-list.
- **No `watch()` outside the action interpreter.** Reactive
  side-effects fire only as a direct consequence of an action.
- **No cross-component shared signals across thaw boundaries.** Two
  thaws on the same page each have their own `data-thaw-state`
  snapshot. Shared state requires an island.
- **No `Activity` / `Show` / `Deferred` orchestration components.**
  These need real reactivity. Their thaw equivalents would be
  `thaw:show="<state-key>"` / `thaw:hidden="<state-key>"` —
  attribute-driven, computed at action time.

### What thaw IS great for

- Counters, toggles, accordion open/close, tab indices, hover
  pop-ups
- Form fields with simple validation (`thaw:input="setEmail"` +
  `thaw-bind:invalid="!isValidEmail"`)
- Pagination + sort controls (the indexes are small enums)
- Modal dialogs whose open/close is driven by a single state slot
- Tooltips, dropdowns, menus — the entire `@place-ts/design` surface
  except those that need timers (Toast, animated transitions)

In ~80 % of UI code, the state graph IS expressible as
pure-arithmetic-on-state. For those, thaw saves the entire impl
bundle — typically 3-10 kB gzipped per component dropped to a few
hundred bytes of action AST shipped inline.

## How thaw composes with islands

Both ship in the same app. Authors pick per component:

- `thaw(import.meta.url, {...})` — for static-shape interactive UI.
- `island(import.meta.url, fn)` — for stateful / async / event-loop
  interactive UI.

The two coexist at the framework level: the same auto-discovery
mechanism scans `src/islands/`; the discover-islands pass tags each
default export as `kind: 'thaw' | 'island'`. The dispatch wraps
them differently:

- Thaw: SSR the JSX, emit `data-thaw` + `data-thaw-state` + the
  inline action registry. Skip the per-component bundle entirely
  (only the shared thaw runtime ships, once per page).
- Island: existing path. SSR the JSX with `data-place-island`
  marker, ship the per-island bundle.

A page with N thaws + M islands ships **1 runtime + M bundles**,
not **1 runtime + N bundles + M bundles**.

## Implementation phases

This is a multi-session feature. Phase it.

### Phase 1: spec + zero-JS-floor measurement
**This ADR + a benchmark.** Pick 3 of the docs site's chrome islands
that are trivially-pure-state-graphs (theme-toggle, mobile-nav-button,
search-trigger — toggle a boolean). Measure: what would they ship
under thaw vs under the current island model? If the win is < 1 kB
per component the model isn't worth it. If it's 3+ kB the case is
real.

### Phase 2: prototype thaw runtime
~300 LOC inline runtime: event delegation + JSON state snapshot +
DOM-bind update. NO action interpreter yet — every action is
lazy-loaded. Prove the wire format works on one component.

### Phase 3: pure-action interpreter
Compile-time pass that recognizes the pure subset of action bodies
and serializes them to the inline op-list. Build-time error on
non-pure actions that don't declare `lazy: true`. ~500 LOC.

### Phase 4: migrate docs chrome
theme-toggle, mobile-nav-button, search-trigger move from `island()`
to `thaw()`. Measure first-paint JS reduction. Expected: docs site's
first-paint JS for an interactive-chrome-only page drops by ~70 %.

### Phase 5: design-library
Buttons, Tabs, Tooltips, Menu, Toast (where state is simple) — port
to thaw. The library ships with both `thaw`-shaped and `island`-
shaped variants of each primitive; recipe choice picks which.

### Phase 6: devtool
Charter clause 3 ("the graph is observable") composes here:
the devtool needs to render BOTH `data-thaw` and `data-place-island`
roots in one panel, attribute snapshot visible, action op-list
visible per component.

## Comparison

| | thaw | place-ts island | Qwik | React Server Components |
|---|---|---|---|---|
| First-paint framework JS (content page) | 0 kB | 0 kB | ~1 kB | ~50 kB |
| Per-interactive-component JS | inline action AST (~300 B) or lazy chunk | 3-10 kB gzipped per island | per-event lazy chunk via QRL | bundled into route |
| State serialization | JSON snapshot per component, ~50 B typical | none — recomputed on hydrate | full closure tree, every captured var | RSC payload |
| Authoring complexity | declare state + actions + view | normal component | QRL-aware split-by-magic | "use server"/"use client" string directives |
| Discoverable in source (ADR-0026 (a)) | yes — `state`, `actions`, `view` are typed object fields | yes — `island(fn)` wrapper | partial — QRL split is hidden | no — string directives |
| Traceable in tooling (ADR-0026 (b)) | yes — action AST is JSON, attributes carry origin | yes — per-island manifest | no — micro-chunks named by hash | partial — RSC inspector |
| Faithful to budgets (ADR-0026 (c)) | yes — pure case ships ~300 B | yes — per-island 3-10 kB | partial — debug-id resolver + many requests | no — RSC payload is heavy |
| Server-side state-snapshot tax | one JSON per component, tiny | none | full closure graph | RSC payload (largest) |

The thaw row passes all three of the ADR-0026 criteria; both Qwik and
RSC fail at least one. The island row also passes — they coexist.

## Risks

1. **Compile-time pure detection is bounded.** Authors will hit the
   "your action isn't pure, ship it as a chunk" boundary often, and
   the message must be specific and actionable. Failure mode: a
   surprising number of components quietly become "lazy actions" and
   the perceived simplicity goes away. **Mitigation:** a CLI flag
   that prints a per-component report — "Counter: pure (300 B);
   Tooltip: lazy (1.2 kB chunk)". Make the boundary visible.

2. **The two models split the design library in half.** Each
   primitive has to be written twice or be cleverly factored to share
   markup. **Mitigation:** primitives whose state can be expressed
   purely (Button, Tabs, Accordion) ship as thaw. Primitives that
   need timers or async (Toast, transition-animated Dialogs) ship as
   island. Document which is which on the primitive docs page.

3. **Pure-action interpreter is a piece of compile-time magic.** It
   walks JS ASTs, recognizes a subset, errors loudly when not in the
   subset. Passes ADR-0026 (a) only if the boundary is in source
   (e.g., a typed `kind: 'pure' | 'lazy'` field on each action, or a
   compile-time annotation). **Mitigation:** require an explicit
   `lazy: true` on actions known to be non-pure; the compiler errors
   on actions without `lazy: true` whose body doesn't fit the pure
   subset. Surfaces the split decision in source.

4. **The wire format for state snapshots becomes a stable interface.**
   Once apps depend on `data-thaw-state` JSON shape, changing it
   breaks live pages mid-deploy. **Mitigation:** version it. The
   runtime reads `data-thaw-version` and refuses to thaw markers
   from a future schema (the user gets full-page reload as fallback).

## Out of scope

- Replacing islands entirely. Both ship.
- "Auto-thaw" of all components. The split is explicit.
- Cross-thaw shared state via attribute reads. If two thaws need to
  coordinate, one of them becomes an island OR they wire through a
  URL parameter.
- Compile-time conversion of arbitrary JS to AST op-lists. We accept
  only a small named subset of operations; rest is lazy.

## Decision

**Adopt the thaw model as a sibling of islands for the static-shape
case. Phase 1–6 are sequential, gated by the Phase 1 measurement.**
If Phase 1's benchmark shows the win is < 1 kB on the docs chrome
components, abandon and revisit only when a real consumer pulls
the trigger.

This ADR establishes the design + boundaries. Code lands in a
follow-on ADR per phase as built.

## Open questions

- **Action ID stability for cache busting.** When an app's action
  AST changes, in-flight pages from the old version still have
  `data-thaw-click="old-action-id"`. Either the runtime falls back
  to full reload, or actions carry a content-hash suffix. Pick one
  before Phase 2.
- **Form-field bindings.** `thaw:input="setEmail"` reads `event.target.value`
  — does the runtime pass that through to the action? Yes; the
  delegated listener captures `event.target.value` into the action
  invocation context. Specify this in the wire format.
- **Multiple thaws inside one island (or vice versa).** Should be
  fine — the data-attribute scoping makes them independent. Verify
  in Phase 2.

## References

- [Qwik resumability concept](https://qwik.dev/docs/concepts/resumable/) — what we're learning from.
- [ADR 0019 — typed islands, not string directives](./0019-typed-islands-not-string-directives.md) — the design discipline that lets thaw stay typed.
- [ADR 0023 — islands as the only hydration model](./0023-islands-as-the-only-hydration-model.md) — supplemented, not replaced, by this.
- [ADR 0026 — magic with clarity](./0026-magic-with-clarity.md) — the three criteria thaw must satisfy.
