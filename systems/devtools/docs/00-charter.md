# `@place/devtools` — charter

## Thesis

A developer cannot reason about a framework they cannot see. `@place/devtools`
makes the running app observable from inside the browser: the reactive
graph, the islands on the page, the active route, and how much JavaScript
the page paid for. It is the charter's clause 3 — *"the graph is
observable"* — made into a thing you can open and look at.

It ships as **one dev-only island**, dropped into an app's root layout.
It dogfoods the framework: the devtool is itself a place island, built
with `@place/component` + `@place/reactivity`.

## Trigger

The platform charter's non-negotiable #3 says the reactive graph must be
observable. Until now nothing surfaced it. The Tier 20 audit recorded
this as blocker **B3** ("no reactivity-graph devtool"). `@place/reactivity`
now exposes `inspectGraph()` / `onGraphTick()`; this package is the UI
that consumes them.

## Scope

Four panels, each answering one question:

| Panel | Question |
|---|---|
| Graph | What state / derived / watch nodes exist, what are their values, what depends on what? |
| Islands | Which islands are on this page — hydrated? what load strategy? |
| Routes | What route is active, with what params and query? |
| Perf | How fast did the page load, how much JS shipped? |

## Non-goals

- **Not a production tool.** Dev-only. The reactive-graph data source is
  gated off in production builds; the island should only be rendered
  behind a dev check.
- **Not a profiler.** No flame charts, no CPU sampling. Perf shows load
  timing + JS weight, nothing that needs instrumentation hooks.
- **Not a network inspector.** The browser's own devtools do that better.
- **Not a state editor (v1).** v1 observes; it does not let you write
  values back into the graph. Editing is a deliberate later cut — it
  needs a careful think about reactivity invariants.
- **Not themeable by the host app.** The devtool ships its own
  self-contained stylesheet (adopted via a constructable `CSSStyleSheet`,
  so it is CSP-safe and never collides with app styles). It does not
  read the app's theme tokens — a tool should look the same in every app.

## Failure modes guarded against

- **Perturbing what it observes.** `inspectGraph()` never forces a
  recompute; reading the graph has zero effect on it. The devtool's own
  signals are part of the graph — it must not present them as the app's
  (filtered by origin where it matters).
- **Production cost.** The reactivity introspection registration is
  DCE'd in production. The devtool island, if accidentally shipped,
  is one more island bundle — so the app gates it behind a dev check.
- **CSP friction.** No inline `<style>`, no inline event handlers. The
  stylesheet is a constructable `CSSStyleSheet`; all behaviour is in the
  island bundle.
- **Layout interference.** The widget is `position: fixed` and pointer-
  events-scoped — it never participates in the app's layout or intercepts
  clicks outside its own surface.

## Public surface

- `devtoolsView` — the devtools component (a `() => View`). The package
  exports the view rather than a pre-wrapped `island()` because the
  island bundler requires an island's source file to live under the
  consuming app's project tree. The app wraps it in a one-line island
  file (`island(import.meta.url, devtoolsView)`) and renders it once in
  a root layout behind a dev gate. See the README.
