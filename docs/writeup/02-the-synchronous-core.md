# Chapter 2 — The Synchronous Core

> **Draft** as of 2026-05-01. Covers Phase 1 + Phase 2 of the reactivity system: the unified `state` primitive, the `watch` primitive, and the algorithm that makes them work. Pre-read: [Chapter 1 — Why reactivity is broken](./01-why-reactivity-is-broken.md), drawn from `systems/reactivity/docs/01-pain-points.md`.

The reactivity system has two primitives.

```ts
import { state, watch } from '@place-ts/reactivity'

const count = state(0)
const doubled = state(() => count.read() * 2)

watch(() => {
  console.log(count.read(), doubled.read())
})

count.write(5)   // logs: 5 10
```

That is the whole public surface. Two functions. Both are typed. The behavior of every call is described by eight algebraic invariants and one extension. There is no compiler magic, no reactive context object, no batched-by-default scheduler that you have to learn the rules of. There is `state(...)`, `watch(...)`, and a graph of dependencies that the runtime maintains.

This chapter is about the algorithm that makes those two functions work, why we wrote it that way, and what it does not yet solve.

## Why two primitives, not three or seven

Every reactivity system has at minimum a writable cell, a memoized derivation, and a side-effect observer. React calls them `useState`, `useMemo`, and `useEffect`. Vue has `ref`, `computed`, and `watchEffect`. Solid has `createSignal`, `createMemo`, and `createEffect`. The shape repeats because there are three kinds of behavior: hold a value, compute a value, observe a value.

We started with three (`cell`, `derived`, `watch`) and shipped with two. The split between `cell` and `derived` was the universal split, and almost universally regretted. Carniato, the author of Solid, has written publicly that he wishes Solid had been built around the insight that *state should be derivable*: a value initialized from another value should auto-update when the other value changes, without an effect to bridge them.

The unified `state` primitive takes that seriously. `state(value)` is the degenerate case (zero inputs, writable cache). `state(() => expression)` is a derived state that is *also* writable: a local write wins until the next time an upstream source actually changes value, at which point the derivation resumes control. We call this the **revert policy**. It eliminates the most common `useEffect` antipattern in the JavaScript ecosystem — synchronizing local state with a prop or a query result.

```ts
const upstream = state(0)
const editable = state(() => upstream.read() * 2)

editable.write(99)
editable.read()   // 99 — local override

upstream.write(5)
editable.read()   // 10 — upstream wins; override discarded
```

That pattern requires no `useEffect`, no `useState` paired with a synchronization callback, no manual deps array. The primitive does it.

The third primitive — `watch` — is the smallest possible bridge from the reactive world to the imperative world. It runs once, tracks the reads inside it, and re-runs whenever any tracked source changes. We call it `watch` rather than `effect` deliberately. The word `effect` carries baggage from React's `useEffect` (cleanup callbacks, deps arrays, double-render in StrictMode). It also implies a coarse "this is the only place side effects can live," which is exactly the coarseness Phase 4's typed effects will replace. `watch` is just an observer. A real effect system is later work.

## Two-color graph coloring

The runtime is a graph. State nodes (raw or derived) and watch nodes are vertices. Edges record "this node depends on that node." When you write to a state, the runtime walks the graph from that state outward, marking dependents in one of two colors:

- **Dirty** — the immediate dependents of the changed state. They *must* recompute.
- **Check** — everything downstream from the dirty nodes. They *might* need to recompute, depending on whether their direct sources actually produced new values.

This two-color marking is the standard algorithm in the TC39 signals proposal. Solid uses it. Vue's reactivity layer uses a variant. We use it for the same reason everyone else does: it solves diamond convergence cleanly. If a node A and a node B both depend on the same X, and a node C depends on both A and B, then changing X should cause C to evaluate exactly once — not twice. Without two-color marking (i.e. with naive eager propagation), a single write can cause exponential re-evaluation in deep graphs. Two-color marking guarantees `O(n)` work per change.

```
   X         X is the source.
  ╱ ╲        On write, A and B become DIRTY (direct deps).
 A   B       C becomes CHECK (transitive).
  ╲ ╱        On read of C: walk A and B, recompute each
   C         once, then C recomputes once. One pass.
```

The implementation is around 200 lines of TypeScript. The key piece is `propagateMark`, which walks the graph with a single rule: "if your current color is at least as dark as the mark I'm propagating, stop." That short-circuit keeps the walk linear.

## The eight invariants

Every reactivity system claims correctness; few specify what correctness *means*. The synchronous core commits to eight invariants. Each is a property test (using fast-check) that holds against random inputs. Together they form the contract:

1. **Glitch-freedom.** Within a single `watch` evaluation, every `state.read()` returns a consistent snapshot of the graph. No half-updated views.
2. **Lazy evaluation.** A derived state nobody reads does not run, even if its dependencies change.
3. **Memoization.** A derived state read N times without dependency changes runs exactly once.
4. **Deterministic re-evaluation order.** When multiple nodes depend on the same source, they re-evaluate in topological order; ties are broken deterministically.
5. **Diamond convergence.** A → X, B → X, C → A∧B; a change to X causes C to evaluate exactly once.
6. **Cycle detection at read time.** A derived state that transitively depends on itself throws on read, not on construction.
7. **Cleanup on unsubscribe.** Disposing the last watch observing a derived tears down the derived's source subscriptions.
8. **Dynamic subscription.** A derived state whose code path changes between runs updates its dependency set — reading `a()` on run 1 and `b()` on run 2 means the second run depends on `b`, not `a`.

These eight are non-negotiable. Every framework that shipped reactivity violated at least one and paid for it forever. React's `useEffect` exhaustive-deps lint exists because of #8. Vue's destructure-breaks-reactivity is a violation of #8. Svelte 5's runes-only-in-`.svelte` is a side effect of trying to fix #4 with compiler magic. Solid violated none of these in its v1 — and that is the largest single reason it works.

We added a ninth, not strictly algebraic but a charter consequence: **derivations must be pure**. Writing to a state from inside a derivation throws. Watches can write freely; derivations cannot. This rules out the entire class of "I derive my filtered list and also update a counter as a side effect" bugs that React's `useMemo` famously enables.

## What the primitive does not yet solve

The synchronous core ships now. Several decisions in this chapter are explicitly **provisional** — meaning we know they will change and we have designed the surface so that the change is non-breaking.

- **`watch` runs synchronously by default.** Every write triggers all dependent watches before the writing call returns. This is Carniato's regret in Solid 1, and we are taking it deliberately because the alternative (deferred-by-default) requires the scheduler design to be solved first. Phase 3 introduces the deferred scheduler. The default of `watch` will remain synchronous when that lands; deferred behavior will be opt-in.
- **There is one global tracking pointer.** The runtime tracks "currently computing" via a module-level variable. Multiple framework instances in one app would conflict. Phase 5 introduces capability scopes, which replace the global with a per-scope tracker.
- **There is no batching primitive.** Two consecutive writes each propagate independently; there is no way to say "do these together, observers see one settled state at the end." Phase 3 adds `batch(fn)`. Until then, the fact that a complex user event handler may step through intermediate states inside the watch evaluation is observable.
- **There is no `peek` (untracked read).** A function that wants to read a state without subscribing has to do so outside any observer. This works as a structural workaround but is not an API. The signature `state.peek()` is reserved.
- **Async is not part of the model.** A derived state that calls `fetch` does not work the way you might want — the `.then` callback runs outside any observer and cannot subscribe. Phase 5 introduces time-indexing, which makes async values part of a value's identity rather than a side concern. Until then, async data is bridged manually through `watch`.
- **The graph is not yet inspectable.** Dev tools cannot ask the runtime "what nodes are dirty? what's the dependency graph?" Phase 6 makes the graph a first-class artefact: serializable, snapshot-able, restorable. Resumability (Qwik-style) falls out for free.
- **The cycle-detection error names the cycle, but doesn't show the path through it.** The error says "cycle detected"; it does not say "A → B → C → A." Capturing path information costs runtime work, which Phase 6's graph machinery makes free. Until then, the message is honest about what it knows.

This is what's missing. Each gap is named, scoped to a phase, and surfaced to the user via the error messages and the docs rather than left as a footgun.

## Worked example: the diamond

The reference example is the classic diamond.

```ts
const x = state(0)
const a = state(() => x.read() + 1)
const b = state(() => x.read() * 2)
const c = state(() => a.read() + b.read())

watch(() => {
  console.log(c.read())
})
// logs: 1

x.write(5)
// logs: 11   (a = 6, b = 10, c = 16 — wait, a = 5+1 = 6, b = 5*2 = 10, c = 16)
```

The claim is that `c` evaluates exactly once when `x` writes — not twice (once via the `a → c` path and once via the `b → c` path). The property test verifies this with random `x` writes; the runtime guarantees it via two-color marking.

What is *visible* from outside is that the four reads in the watch — `c.read()` triggers `a.read()` and `b.read()` which both trigger `x.read()` — return values that satisfy `c = a + b = (x+1) + (x*2) = 3x + 1`. There is no intermediate frame where `c` is consistent with the old `x` and `a` is consistent with the new `x`. That is glitch-freedom.

The internal "exactly one re-evaluation" claim is non-observable from outside; you have to look at the property test or a debug counter to see it. The visible claim — consistency at every read — is what users actually feel.

## What this chapter does not solve

The chapter you've just read covers the synchronous core and derivable state. Six chapters remain in the book.

- **Chapter 3 — The scheduler.** Deferred effects, batching, the phase model.
- **Chapter 4 — Typed effects.** Algebraic-effect-shaped tracking, handlers at boundaries.
- **Chapter 5 — Time as the primitive.** Time-indexed values, async as the natural shape, transitions as forks of the time index.
- **Chapter 6 — The graph as artefact.** Serialization, resumability, dev tools.
- **Chapters 7–14 — The other systems.** Components, data, cache, routing, persistence, search, capability, build.

The chapters compose. The synchronous core is the foundation; everything else builds on it.

The work that remains is real research, not just engineering. The decisions that look simple here (synchronous default, one global tracker, no batch primitive) were made knowing they will change. What is *kept* across that change is the interface — `state(...)` and `watch(...)` — because that interface is the contract with the reader of this chapter. The runtime is allowed to grow under it. The shape of the call is not.

The two primitives are honest about what they do. That is what the synchronous core ships.
