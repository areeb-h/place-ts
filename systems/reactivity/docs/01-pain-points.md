# Reactivity Research: Pain Points and Rethink Directions

**Scope.** What's actually broken in every reactivity system shipping today, what's being attempted in the next generation (Solid 2.0, TC39, Angular signals), and where the genuine open design space is.

**Audience.** A solo framework builder who is willing to abandon orthodoxy and is building for a content-heavy commonplace-book reference design.

---

## Part 1 — The pain points, by framework

### React (hooks model)

The single most-disliked API in the entire React ecosystem is `useEffect` — 37% of respondents in the State of React 2025 survey named it the top pain point. The reactivity model is: re-run the whole component on every state change, memoize selectively to skip work, and use `useEffect` to bridge gaps the model can't express. Everything that breaks downstream — stale closures, exhaustive-deps warnings, double renders in StrictMode, memoization fatigue, the entire mental burden of `useCallback`/`useMemo`/`React.memo` — flows from this one architectural choice.

The React Compiler exists specifically to compensate. That a framework needs an opt-in compiler to fix its core reactivity ergonomics tells you the model itself is wrong, not just the syntax around it. React's official answer to "we know it's painful" has been "the compiler will fix it" for about three years now, and the compiler still doesn't ship by default.

`setState` being asynchronous produces the "values-from-the-past" problem. Reading state immediately after writing it returns the old value. Every React developer has been bitten by this and learned to wrap state-dependent logic in `useEffect`, which is the antipattern the API is trying to discourage.

### Solid (signals model — Carniato's own retrospective)

Carniato, in public Solid 2.0 design discussions, has stated explicitly that he wishes Solid had been built with: **deferred effects by default, no synchronous effects, no `batch` API, and a reactivity system fully decoupled from component-specific features.** He believes synchronous effects exist primarily as a stop-gap to fix problems caused by the synchronous-effect implementation itself — i.e., the API generates the bugs it tries to solve.

The cross-cutting concern problem is the deepest one. Suspense and Transitions in Solid cannot be implemented "on top" of the reactivity primitives — they must be cross-cut into core. Carniato has tried to extract the Solid reactivity system into its own subpackage four times and failed each time because of these cross-cuts. The reactivity layer ended up inseparable from rendering, which is exactly what a "reactivity is a separable primitive" claim was supposed to avoid.

The implicit `untrack` on component bodies means `createSignal(props.count)` doesn't update when `props.count` updates — it captures the initial value only. Solving this requires `useEffect`-style synchronization, which is exactly the pattern Solid was supposed to make unnecessary. Carniato's own conclusion in his "Async Derivations" essay (2024): the right answer is that **state should be derivable** — `createSignal(() => props.count)` should be valid syntax that produces self-updating state. No current framework has this.

`props` destructuring breaks reactivity in Solid. The fix is `splitProps`/`mergeProps`, which is boilerplate every Solid component pays. Solid's class+style merging story (`classList` vs `class`) is so awkward that experienced Solid developers describe it as the framework's weakest point.

Server vs client builds of Solid have subtly different reactivity behavior — using Solid's primitives in Node.js doesn't work the same as in the browser, because the SSR build has a stripped-down tracking implementation. This silently breaks isomorphic code.

### Svelte 5 (runes model)

The biggest design failure: runes can only be used in `.svelte` and `.svelte.ts` files. Trying to extract reactive logic into a regular `.ts` file silently fails. This forces what one critic called "code infection" — your project structure is dictated by where reactivity is allowed to live. Vue 3 and Solid don't have this restriction, and the difference is felt the moment you try to factor reactive code into a shared module.

The TypeScript story is genuinely bad. Strongly-typed props in Svelte 5 require writing every prop name twice:

```ts
interface Props { min?: number; value?: number; max?: number; }
let { min = 0, value = $bindable(0), max = 99 }: Props = $props();
```

This produces ESLint warnings (because some props should be `const` but `value` needs to be `let` to be reassignable) and is significantly more boilerplate than Svelte 4 had. The official examples in the docs avoid TypeScript precisely because the typing is awkward.

Hooks (custom logic factories) using runes must wrap state in getter functions to maintain reactivity when returning values across the function boundary. This is exactly the kind of mechanical boilerplate signals were supposed to eliminate.

The runes/stores split. Stores still exist for backward compatibility but the ecosystem is moving to runes. Both work but in subtly different ways. New developers don't know which to use. Library authors have to support both. The bifurcation will likely persist for years.

### Vue 3 (proxy + ref model)

The `ref` vs `reactive` split is the architectural decision Vue developers most regret. `reactive` only works on objects, can't be reassigned (loses the proxy), can't be destructured (loses tracking), and produces a proxy with different identity than the original. `ref` works for everything but requires `.value` access. The official guidance is "use `ref` by default" — which means `reactive` is essentially deprecated in practice while still being prominent in docs.

Destructuring breaks reactivity universally. `const { count } = reactive({ count: 0 })` silently produces a non-reactive `count`. This is the single most common Vue bug. The fix (`toRefs`) is awkward boilerplate that should never have been necessary.

Reassigning a `reactive()` variable loses the connection silently. `let state = reactive({...}); state = newData;` looks correct, runs, and breaks. The template still points at the old proxy.

`watchEffect` doesn't track dependencies behind unexecuted branches initially. If a dependency is gated by an `if (enabled)` and `enabled` starts false, the dependency isn't tracked until `enabled` flips true. Then it's tracked. This dynamic-tracking model produces bugs that are nearly impossible to debug because the bug only manifests on the second state transition.

### Angular signals (the newcomer)

Better than expected, given Angular's history. The `signal()`, `computed()`, `effect()` triple is a clean signals API. But Angular's signals don't currently have **derived updateable state** (Carniato's "state from prop" pattern), and the docs explicitly tell you not to use effects to synchronize state — leaving you with no good answer when you need exactly that pattern. RxJS is the official escape hatch, but RxJS for simple state synchronization is a ten-pound hammer.

### TC39 Signals proposal (the would-be standard)

Two explicit punts in the proposal itself, by the authors:

1. **Async is omitted.** Issue #30 acknowledges async signals are needed but unsolved. The current proposal handles async via "throw on unresolved" exception caching, which the authors describe as inadequate.

2. **Transactions are omitted.** Issue #73 acknowledges that transitions between views (where two states must coexist while the new one renders before committing) require "forking" the signal graph, possibly multiple concurrent forks, and this is unsolved.

The proposal also relies on a global tracking context (the "currently computing" pointer), which Issue #147 raises as a real interop problem — same shape as the React hooks-must-be-called-in-order problem, just in a different domain.

The `Watcher` API (which is the basis for effects) has been criticized as the wrong shape — it's a callback-based notification system when one-shot promise-based delivery would be more composable with `async`/`await`. Issue #222.

These aren't small gaps. Async and transactions are *exactly* the things UI frameworks use reactivity systems for. The TC39 proposal in its current form is a sound *core* but it doesn't solve the problems that motivated frameworks to build their own systems in the first place.

---

## Part 2 — The cross-cutting problems nobody has solved

These are the issues that cut across every framework. They're the design space where new work is genuinely needed.

### Problem 1 — Async is unsolved everywhere

Every reactivity system in production today treats async as bolted-on. React has `Suspense` + `use`. Solid has `createResource` + `Suspense` + `Transition`. Vue has `asyncComputed` (a separate library). Svelte has special-cased `await` in templates. Angular delegates to RxJS. None of them compose cleanly with the core reactivity primitives.

Carniato's "Async Derivations in Reactivity" essay (August 2024) is the clearest articulation of why: when you make a signal possibly async, **everything downstream becomes potentially reactive**, and `untrack` becomes meaningless. You can't escape the async character once it enters the graph. The current frameworks all compromise by drawing arbitrary lines between "sync reactive state" and "async resource state," and the boundary creates the bugs.

Solid 2.0's emerging answer: the **Temporal Tuple**. Every reactive value carries both a `Now` and a `Future`. Async is part of the value's identity, not a side effect. The runtime owns the timeline.

This is a genuinely new direction and it's where the entire field is going to converge over the next 2-3 years.

### Problem 2 — Effects are the universal escape hatch that became a crutch

Every framework has effects. Every framework documents that you should use them sparingly. Every framework has codebases where effects are everywhere and the docs' warnings are ignored. The pattern is so universal it's now a meme: "you're not supposed to use `useEffect` for that."

The deeper issue: effects exist because the reactivity system can't express certain kinds of dependencies. State synchronization with external sources, side effects in response to changes, manual subscription bridges to non-reactive APIs — all of these get dumped into effects because there's nowhere else to put them.

Two design responses are visible in current research:

**Algebraic effects (Koka, OCaml 5).** Make effects a typed, tracked thing. A function that performs IO has `IO` in its type. Handlers are installed at boundaries. The type system enforces that effects are handled. This is a 30-year-old PL idea that has not been applied to UI reactivity.

**Derivable state (Carniato's emerging position).** If state itself is derivable, you don't need most effects. `createSignal(() => props.count)` with auto-update behavior eliminates the "useEffect to sync state" antipattern entirely. This is currently theoretical — no framework has shipped it.

### Problem 3 — Forking the graph (transitions, optimistic updates, time-travel)

For a transition between two views, you need both states to exist simultaneously while the new one prepares. For an optimistic update, you need a "speculative" branch of the state graph that can be committed or rolled back. For time-travel debugging, you need historical states to be addressable.

All three are the same problem: **the reactive graph needs to be forkable**. Currently no framework can do this cleanly. React's Concurrent Mode is the most ambitious attempt and it's been in "experimental" purgatory for years. Solid's transitions are described in the community as "still buggy" by Solid's own author. The TC39 proposal explicitly punts.

This is one of the deepest design questions in reactivity and there's a genuine opening for a framework that gets it right.

### Problem 4 — Reactive vs persistent state is split arbitrarily

In every framework, "reactive state" lives in memory and "persistent state" lives somewhere else (localStorage, IndexedDB, a server). The split is arbitrary — both are state, both can change, both should be observable. But the framework treats them as different categories with different APIs.

For a commonplace-book-shaped app, this is the central pain point. Notes are state. They're also persisted. They sync. They have history. The framework should treat them all as one thing. None do.

### Problem 5 — Reactivity has hidden globals

Auto-tracking depends on a global "currently computing" pointer. Set it before evaluating a computed, read inside the computed registers a dependency, restore after. This is universal across Solid, Vue, MobX, Svelte 5 internals, and the TC39 proposal.

It works but it has costs:
- Multiple framework instances in one app conflict (the "two Reacts" problem in a different domain)
- Tracking can leak across async boundaries unexpectedly (the dependency-behind-an-await problem in Vue)
- SSR vs client tracking diverges in subtle ways (Solid's Node.js vs browser issue)
- It's hostile to multiple isolated reactive scopes, which is what transitions need

Capability-passing reactivity — where a component receives the reactive scope it lives in as an explicit parameter, like a Reader monad — is unexplored in UI frameworks but is a 20-year-old idea in functional programming.

### Problem 6 — The state/derivation/effect trinity is too coarse

Every framework has these three categories: writable state, derived (computed/memo) values, effects (side effects). The categories are tidy but every framework has the same problem: you frequently want a *fourth* kind of thing that doesn't fit cleanly.

You want **state that's also derived** — initialized from a derivation but writable, updating automatically when the derivation changes, but with local writes that override until the next derivation update. Carniato's "Async Derivations" essay arrives at this. No framework has it as a primitive.

You want **derivation with side-effect-like behavior** — `createMemo` but with cleanup, or `createEffect` but with a return value that's itself reactive. Currently you compose primitives awkwardly.

You want **effects with structured outputs** — an effect that produces a stream of values you can subscribe to. Currently you nest signals inside effects, which is officially discouraged in most frameworks.

The trinity is a leaky abstraction. The right shape is probably *one* primitive with a richer set of properties.

---

## Part 3 — Six rethink directions

The research justifies more than just "build a competent signals system." Here are six directions that each take seriously one of the cross-cutting problems above. These are not mutually exclusive — a framework might combine 2-3 of them. Each one is a real design commitment with real costs.

### Direction A — Time as the primitive

**The thesis.** Reactive values are not cells, they are time-indexed functions. A signal is a function from time to value, where "time" is explicit, addressable, and forkable. Past values are queryable. Async is just a value that hasn't resolved yet at the current time index. Transitions are just multiple time indices coexisting.

**What it solves.** Async (Problem 1, the Carniato Temporal Tuple direction). Forking (Problem 3, transitions become forking the time index). Time-travel debugging (Problem 3, falls out for free). Optimistic updates (Problem 3, branches of the time index).

**What it costs.** The mental model is genuinely new. Most developers think in terms of "the current value of x" and time-indexed values are unfamiliar. The implementation is harder — you need a real timeline data structure, garbage collection of old time points, and well-defined semantics for time arithmetic.

**Closest prior art.** Solid 2.0's emerging Temporal Tuple. FRP (Functional Reactive Programming) research from the 2000s — Conal Elliott's work, Yampa in Haskell. Almost no production UI framework uses time as a primitive.

**The thing to write about.** "Why time should be a first-class primitive in UI reactivity, and what changes if it is."

### Direction B — Effects as algebraic effects

**The thesis.** Effects are typed and tracked. Every effect declares its kind (`IO`, `Async`, `Mutate`, `Throws`, `Read<scope>`, etc.) in the type. Components compose freely; the type system propagates the effect set; handlers are installed at boundaries. The framework's "effect" system is a structured handler installation, not an opaque callback.

**What it solves.** The effects-as-crutch problem (Problem 2). Capability-passing (Problem 5). The trinity-too-coarse problem (Problem 6) by replacing the trinity with effect-tracked computations.

**What it costs.** The hardest dimension to make ergonomic. Algebraic effects in OCaml 5 are powerful but the syntax is brutal for non-PL people. You need a custom type system or aggressive compiler analysis to make it ergonomic. AI co-authoring helps a lot here because effect declarations are exactly the kind of explicit syntax LLMs handle well.

**Closest prior art.** Koka language. OCaml 5's effect handlers. React's "use" hook is a *very* watered-down algebraic effect. No JS framework has done this seriously.

**The thing to write about.** "Algebraic effects for UI: making effects a first-class typed thing instead of a code smell."

### Direction C — Derivation as the primary primitive

**The thesis.** There is no separate "state" and "derived" — there is only derivation. Raw state is a degenerate case (a derivation with no inputs and a writable cache). All state is derivable. All derivations are potentially writable (via projection back to source). The trinity collapses to one primitive.

This is the direction Carniato is currently most excited about and the one he believes Solid 2.0 will move toward.

**What it solves.** The state-vs-derived split (Problem 6). The "useEffect to sync props to state" antipattern (Problem 2 in its most common form). The Vue ref-vs-reactive confusion (specific Vue pain). Most of the boilerplate around deriving state from props.

**What it costs.** Conceptually demanding. Understanding "all state is derived" requires thinking about every value as having upstream sources, even when the upstream is "the user typing." The implementation is non-trivial — projections back to source require careful handling of bidirectional data flow.

**Closest prior art.** Some FRP systems. Adapton (incremental computation research). Carniato's "Mutable Derivations in Reactivity" essay (October 2024) is the cleanest current articulation.

**The thing to write about.** "Why state and derivation are the same thing, and what changes when you stop treating them differently."

### Direction D — Reactivity = persistence

**The thesis.** The reactive primitive and the persistence primitive are the same primitive. A "signal" can be backed by memory, by IndexedDB, by a server-synced store, by a CRDT. The framework doesn't distinguish — local-first, server-authoritative, eventually-consistent are all views over the same primitive. Reading and writing are the same in all cases; the storage is a configuration.

**What it solves.** The reactive-vs-persistent split (Problem 4). For a commonplace-book-shaped app, this is the central feature. It also makes server state, client state, and offline state into one model.

**What it costs.** Implementation depth. You're now building the persistence layer too, which is a large system. Conflict resolution (CRDTs, OT, last-write-wins) becomes part of the framework. The performance characteristics of "read a signal" vs "read from IndexedDB" are wildly different and the framework has to handle both gracefully.

**Closest prior art.** Replicache, ElectricSQL, RxDB (closer to "reactive database" than "reactive UI" but in the right family). Yjs and Automerge (CRDTs as reactive primitives). Riffle from the Ink & Switch team. None of these are full UI frameworks; they're libraries that get partially integrated.

**The thing to write about.** "There is no client state and server state, only state with different storage policies."

### Direction E — Capability-passed reactive scopes

**The thesis.** Reactivity is not global. Every component receives the reactive scope it operates in as an explicit parameter (or capability). Components cannot read from scopes they weren't given. Multiple isolated reactive scopes coexist trivially. Transitions are "fork the scope, give the new one to the new render tree."

**What it solves.** The hidden-globals problem (Problem 5). Multi-instance issues. Forking the graph (Problem 3) — fork = new scope. SSR/client divergence — they're just different scopes. Library composition without conflicts.

**What it costs.** Verbose at the boundary. Every component signature gets an extra parameter (or the framework hides it via a context that's still effectively a global, defeating the purpose). The mental model of "which scope am I in?" is unfamiliar to UI developers.

**Closest prior art.** Reader monads in functional programming. Lexical scoping in Lisps. Capability-based security (which is what this borrows from at the ideology level). React Context is a watered-down version. No framework does this rigorously.

**The thing to write about.** "What happens when reactivity isn't a global thing."

### Direction F — Graph as a first-class artifact

**The thesis.** The reactive graph is not an internal implementation detail. It's a first-class object: serializable, inspectable, persistable across reloads (resumability falls out), snapshot-able for time-travel debugging, fork-able for transitions, query-able by dev tools. The framework provides APIs to introspect and manipulate it.

**What it solves.** Resumability without Qwik's specific architecture (just serialize the graph). Time-travel debugging. Better dev tools. The forkable-graph problem (Problem 3). Persistence (Problem 4) at least partially — the graph itself can be persisted.

**What it costs.** The graph must be designed for serialisation from day one. This constrains what can be in it (no closures over arbitrary JS values, no DOM references in graph nodes, etc.). Performance tooling becomes more complex because the graph isn't an opaque thing the runtime can optimize freely.

**Closest prior art.** Qwik's serialization is the closest production system. Adapton's incremental computation graphs. Most reactive systems have an internal graph but treat it as private. Solid 2.0's roadmap includes "reactive graph serialization" as a precursor to resumability.

**The thing to write about.** "When the reactive graph is your data, not your implementation."

---

## Part 4 — My honest read on what to combine

The directions are not equally compatible with each other. Some compose well; some are in tension. Here's my read:

**A and C compose naturally.** Time-as-primitive and derivation-as-primitive are the same idea seen from different angles. Carniato is converging on both simultaneously in Solid 2.0.

**A and F compose naturally.** Time-as-primitive almost requires graph-as-artifact, because addressing past values needs the graph to be an inspectable thing.

**D and F compose naturally.** Reactivity-equals-persistence requires a serializable graph anyway.

**B is independent.** Algebraic effects can be combined with any of the others. It's a typing/compiler discipline, not a runtime model.

**E is in tension with the others.** Capability-passed scopes complicate everything else because every primitive has to thread the scope through.

Given the commonplace-book reference design and your stated goals, the combination I'd push hardest is **A + C + F**. Time as the primitive. Derivation as the primary unit. Graph as a first-class artifact. The combination produces a reactivity system where:

- A note in the commonplace book is a derivation, not a "state"
- Its history is queryable (any past version is addressable via time index)
- Async data (semantic search results, server sync) is the same shape as sync data
- Transitions and optimistic updates are forks of the graph
- The graph can be serialized to disk, restored on reload, inspected in dev tools, snapshotted for debugging
- Effects (when you need them) are typed and rare, not the universal escape hatch

This is also a writeup that *nobody else has written*. Carniato has written about the time-and-derivation parts in his blog series; nobody has put the three together as a unified system. There's a genuine opening here.

**Direction B (algebraic effects) I'd add as a secondary commitment** — typed effects in the type system, with handlers at boundaries — because it composes with everything else and because AI co-authoring loves explicit type-tracked syntax. But I'd treat it as a constraint on the design rather than the lead.

**Directions D and E I'd defer.** Reactivity-equals-persistence is the right long-term direction but adds a huge implementation surface that delays v0.1 significantly. Capability-passed scopes are intellectually attractive but produce verbose code at every boundary, which fights the aesthetic-ownership goal.

---

## Part 5 — What this means for the next conversation

The reactivity system isn't a small thing. It's the foundation of the entire framework, and the choices here propagate through every other system you'll build later. A wrong choice here can't really be fixed without rebuilding everything that depends on it.

Three things I'd want to talk through next, in order:

1. **Do the rethink directions land?** Specifically: is A + C + F the combination you want, or is there a different combination (or a direction I missed) that pulls at you more? The "A + C + F + B-as-constraint" recommendation is mine, but it's a recommendation, not an answer.

2. **What's your stance on the effects-question?** Effects are everyone's least-favorite primitive. The two responses I outlined (algebraic effects vs derivable state eliminating most effects) are different design philosophies. Which one is more *yours*?

3. **The async question.** The Solid 2.0 Temporal Tuple is the most ambitious answer current frameworks have. Do you want to go further, or is the Temporal Tuple the answer and our job is to implement it well?

One thing I want to flag before we proceed. The combination I've recommended is genuinely ambitious. It is *more* ambitious than Solid 2.0 in some ways and *equal* to it in others. Building this is real research, not just engineering. The 12-18 months we discussed earlier is a *minimum* for a working v0.1 of this — and a working v0.1 here means the reactivity system alone, not the framework around it.

If after reading this you want to scale back to "a competent signals implementation with the boring choices made well," that's a legitimate answer and we should know it now, not later. The boring version has a real claim too — most reactivity systems are *not* well-implemented, and a beautifully-engineered conventional one is genuinely useful.

If you want the ambitious version, we proceed knowing what we're committing to.

Either way, the next artefact is a design sketch — actual semantics for one or two primitives, written precisely, that we can argue about and refine. Pick a direction and we go.
