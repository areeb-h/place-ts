# Reactivity System: Implementation Plan, v0.1

**Scope.** This plan covers from "no code exists" to "a working reactivity system that powers a toy commonplace book demo." It is the foundation the rest of the framework will sit on. The plan is staged across roughly 12-18 months of part-time solo work with AI assistance.

**The system being built.** A reactivity primitive based on three commitments:
- **Time as the primitive.** Every reactive value is time-indexed. Async values are values that haven't resolved at the current time index.
- **Derivation as primary.** State and derivation are the same thing. Raw state is derivation with no inputs.
- **Graph as artifact.** The reactive graph is serializable, inspectable, persistable.

With **typed effects as a constraint**: every effect-performing operation declares its kind in the type, and the compiler enforces handler installation at boundaries.

**What this plan deliberately does not include.** Routing, components, rendering, persistence as a separate system, search, capabilities as a separate system, build pipeline beyond what's needed to test the reactivity layer. Those are downstream of this and have their own plans later. The temptation to scope creep here is the single biggest risk to the project.

**What "works" means at v0.1.** A toy commonplace book runs end-to-end on the reactivity system. Notes can be created, edited, linked, searched. History is queryable. The graph survives a page reload. There is one short writeup published explaining the model. That's v0.1. Nothing more, nothing less.

---

## Phase 0 — Foundations (weeks 1-4)

The phase before the project really starts. Everything here exists to make the next 12 months tractable.

### Goals

Set up the development environment, the testing infrastructure, the writing infrastructure, and the most important deliverable of this phase: a **design journal** that you will keep for the entire project. The journal is a daily 10-minute habit. It's where decisions get recorded, alternatives get noted, and unanswered questions get logged. Without it, you will lose track of why you made decisions in month 3 by the time you need to revisit them in month 8.

### Tasks

**Repository setup.** Single monorepo, pnpm workspaces. Folders: `packages/core` (the reactivity runtime), `packages/compiler` (the syntax compiler, empty for now), `packages/syntax` (the language definition, empty for now), `examples/commonplace` (the toy app, empty for now), `docs` (the writeup), `journal` (the design journal). Set up TypeScript strict mode, Biome for formatting, Vitest for tests. Use Bun as the runtime — it's faster, has native TypeScript, and the test runner is cleaner than Node's. AI decision: Bun, not Node. The maturity is sufficient now and the speed difference matters across thousands of test runs.

**Testing infrastructure.** Two test layers. Unit tests for primitives in Vitest. Property tests using fast-check for the algebraic invariants of the system (these matter more than unit tests for reactivity — see Phase 1 rationale). Set up CI to run both on every commit. AI decision: fast-check over alternatives. It's the most mature property-testing library in the JS ecosystem and reactivity systems live or die on invariants.

**Writing infrastructure.** A single Markdown file structure for the writeup, with one chapter per major design decision. Set it up now so writing is frictionless when you have something to say. The journal lives in `journal/YYYY-MM.md` files, one per month, with one entry per session. Use Obsidian if you want — your existing workflow already supports this.

**The design journal template.** Three sections per entry: *what I worked on*, *what I decided and why*, *what I'm uncertain about*. Ten minutes maximum. The point is not to write well; it's to leave a trail. In month 9 you will need this trail.

### Decisions I'm making for you

Bun over Node. Vitest over Jest. fast-check for property tests. Biome over ESLint+Prettier. pnpm over npm or yarn. TypeScript strict mode, no exceptions. No bundler in core (it's a library, not an app). Markdown for writing, no fancy doc generator yet.

### Decisions waiting on your taste

The repository name. The name of the framework itself. Whether the journal is public or private. Whether you commit to the Markdown writeup being readable as a book, or if it'll evolve into something else.

### Done when

`pnpm test` runs successfully on an empty test in `packages/core`. The journal has its first entry. The writeup has chapter stubs.

---

## Phase 1 — The synchronous core (weeks 5-16)

This is where the real work begins. The synchronous core is the foundation. Async, time-indexing, and graph serialization all build on it. If the synchronous core is wrong, everything downstream is wrong.

The mistake every reactivity system makes is rushing this phase. Solid took years to refine the synchronous primitives and Carniato is *still* finding wrong choices in them. Spending three months here is not slow; it's the right pace.

### Goals

Build the smallest possible primitive set that is correct, well-tested, and provably has the algebraic properties you want. No async yet. No time-indexing yet. No serialization yet. Just: signals that hold values, derivations that depend on signals, and a way to observe when values change.

### The primitive set, v0

Three things only:

**`cell<T>(initial: T)`** — a writable atomic state. Has `read()` and `write(v)`. The simplest possible thing. Everything builds on this.

**`derived<T>(fn: () => T)`** — a computation that auto-tracks its reads. Lazy by default. Memoized. Re-evaluates when dependencies change *and* it's read.

**`watch(fn: () => void)`** — runs `fn` once, tracks reads, schedules re-runs when dependencies change. This is the lowest-level "effect" — but we don't call it that yet, because the trinity-too-coarse problem warns us that "effect" carries baggage we don't want.

That's it. No batching. No transactions. No `untrack`. No async. No effects-with-cleanup. Add nothing until something forces it.

### Why these three

`cell` is the irreducible core. You cannot have less.

`derived` is the simplest expression of "computed from other reactive values." It's the lazy/memoized variant because every other variant can be built from it but not vice versa.

`watch` is the smallest possible bridge from the reactive world to the imperative world. It exists to make tests possible — you need *some* way to observe when things change. Calling it `watch` rather than `effect` is deliberate: it keeps the door open to designing the effect system properly later, with algebraic types, rather than baking in a coarse `createEffect` shape now.

### The algebraic invariants you must enforce

These are the property tests that must pass. Every one of these is a way Solid, Vue, or React has historically broken. Writing the test before the code is the only way to know the invariant holds.

1. **Glitch-free.** Within a single `watch` evaluation, every `derived` read must return a consistent snapshot of the graph. No stale values, no half-updated views.

2. **Lazy evaluation.** A `derived` that nobody reads must not run, even if its dependencies change.

3. **Memoization.** A `derived` that is read twice without dependency changes must run exactly once.

4. **Deterministic re-evaluation order.** When multiple `derived` and `watch` nodes depend on the same cell, the order they re-run in must be deterministic and topologically sorted (deepest dependencies first).

5. **Diamond dependencies converge.** If `A` and `B` both depend on `X`, and `C` depends on both `A` and `B`, then changing `X` must cause `C` to re-evaluate exactly once, not twice.

6. **No cycles.** A `derived` that transitively depends on itself must throw an error. Detection happens at read time, not write time.

7. **Cleanup on unsubscribe.** When the last `watch` observing a `derived` is removed, the `derived`'s subscription to its sources must be torn down. Otherwise you leak.

8. **Subscription is dynamic.** A `derived` that takes a different code path on its second run must update its dependency set. Reading `a()` on run 1 and `b()` on run 2 means the second run depends on `b`, not `a`.

These eight invariants are the contract of the synchronous core. Every framework violates at least one and pays for it forever. Property tests for each are non-negotiable.

### How to actually build it

The implementation strategy that has worked best across the industry — Solid, Vue, the TC39 polyfill — is **two-color graph coloring**. Each node has a state: `clean`, `check`, `dirty`, `computing`. State transitions are deterministic and the algorithm for "should this re-run?" is a simple traversal. This is well-documented in the TC39 proposal's algorithm section and Milo Mighdoll's "Graph Coloring for Reactivity" blog post (read both before writing a line of code).

Implementation order:

1. **Week 5-6.** Read the TC39 proposal's algorithm section line by line. Implement the polyfill from scratch (don't copy theirs — type it out yourself, learning by doing). Run the polyfill's tests against your implementation.

2. **Week 7-8.** Write the property tests for invariants 1-8 above. They will fail. That's the point.

3. **Week 9-12.** Make the property tests pass. This will be harder than you expect. Diamond dependencies and dynamic subscription will eat at least two weeks combined.

4. **Week 13-14.** Benchmark against Solid's signals primitive. Don't aim for faster — aim for "within 2x." Speed is a phase-3 concern; correctness is now.

5. **Week 15-16.** Write the first chapter of the writeup, explaining the synchronous core. Writing forces you to find the holes in your understanding. If you can't explain it clearly, you don't understand it yet.

### Decisions I'm making for you

**Read API: function call style, `cell.read()` and `derived()`.** Not `.value`. Not bare-identifier-with-compiler-magic. Function calls are unambiguous, debuggable, and fit the type system without compiler tricks. You can sugar this later in your custom syntax. AI decision rationale: Solid's experience is the strongest evidence here. The function call style has aged best across eight years of production use.

**Equality: `Object.is` by default, with optional custom comparator.** Same as TC39, same as Solid. The cases where you want structural equality are real but rare and should be opt-in.

**Effects (well, `watch`) run synchronously by the default scheduler.** This is the choice Carniato regrets. We're going to make it deliberately because the alternative (deferred-by-default) requires the scheduler design to be solved first, and that's Phase 3 work. We will keep the API such that switching the default later is non-breaking. AI decision rationale: do not block on the scheduler design. Ship synchronous first, change the default later.

**Cell is mutable. Setting via `.write(v)` or `.write(prev => next)`.** Both signatures supported. The function form is for atomic-update patterns.

**No `batch` API.** Carniato regrets it. We agree. If it turns out to be needed later, we'll add it then.

**No `untrack`.** Same reasoning. The Carniato "Async Derivations" piece argues that with derivable state, `untrack` becomes meaningless. We're betting he's right. If we're wrong, we add it back in Phase 4.

### Decisions waiting on your taste

The names of the primitives. `cell`, `derived`, `watch` are placeholders, chosen because they're short and don't carry React/Vue/Solid baggage. You may want different names that fit the framework's voice. This is a *real* taste decision and you should sit with the candidates for a few days before committing. Some alternatives to consider: `state`/`computed`/`effect` (familiar but baggage), `signal`/`memo`/`watcher` (Solid-flavored), `now`/`derive`/`observe` (more verbal), `ref`/`fn`/`run` (terse), or something genuinely your own.

The error messages. Reactivity errors are notoriously bad in every framework. What does your "cycle detected" error look like? What does your "wrote during a derived computation" error look like? These are small touches that compound. I'll write functional error messages; you'll want to rewrite them for tone.

### Done when

All eight invariants pass as property tests. Performance is within 2x of Solid's primitives on a standard benchmark suite (krausest's js-framework-benchmark or similar). The first chapter of the writeup is drafted and you've read it back to yourself and it makes sense.

---

## Phase 2 — Derivable state (weeks 17-22)

The first genuinely novel commitment. This is where your framework starts to differ from everything else.

### Goals

Replace the `cell` / `derived` split with a unified primitive: state that can be either raw or derived, and is writable in both cases. Carniato's "state should be derivable" insight, taken seriously.

### The primitive change

The new shape:

```
state(initialOrFn): State<T>
```

If you pass a value, it's a raw cell. If you pass a function, it's a derived cell that auto-updates when its dependencies change. In both cases, you can `.write(v)` to override locally. Local writes persist until the next dependency-driven update, then are cleared (the policy is configurable).

This is the primitive that eliminates the most common `useEffect` antipattern in the entire JS ecosystem — synchronizing local state with a prop. Currently every framework has this footgun. Yours doesn't.

### Why this is harder than it sounds

The semantics of "local write that's overridden by upstream update" need to be precisely defined. Three policies are possible:

**Override-then-revert.** Local writes win until the upstream changes again, at which point the local write is discarded. This is what most users expect.

**Override-then-rebase.** Local writes are stored as a "delta" that's applied on top of the upstream value. When the upstream changes, the delta is reapplied.

**Override-permanent.** Once you write locally, the upstream binding is severed.

Each policy has cases where it's right and cases where it's wrong. The decision matters because it changes the mental model.

### Decisions I'm making for you

**Default policy: override-then-revert.** This matches user expectation in the common case (form input bound to a server value, where typing locally should override but a server refresh should win). The other policies are available as opt-ins.

**API shape:** `state(value | () => value, options?)`. The function-vs-value detection is type-driven. Options include `policy: 'revert' | 'rebase' | 'permanent'`.

**No `set state` lifecycle hooks.** Some frameworks let you hook into "before write" and "after write." We don't. Effects of writes belong in `watch`, not in the primitive itself.

### Decisions waiting on your taste

Whether to expose all three policies in v0.1 or just the default. The conservative answer is "just the default, add the others when someone asks." The ambitious answer is "ship all three, force me to think about each clearly." Your call.

The terminology for "the upstream value updated and your local write was discarded." There needs to be a word for this event because users will want to react to it. It's not exactly "reset," not exactly "rebase," not exactly "override." Naming this is your taste call.

### Done when

`state(() => upstream.read())` produces a self-updating value that can also be written locally. Property tests for each policy pass. The "useEffect to sync state" antipattern is demonstrably eliminated for at least three concrete examples drawn from real React/Solid code.

---

## Phase 3 — The scheduler and deferred effects (weeks 23-32)

This is the phase where Carniato's regret becomes our opportunity. We're going to do scheduling right from the start instead of bolting it on.

### Goals

Replace the synchronous-by-default `watch` with a scheduler-driven model. Effects run in batches, scheduled by the framework, with explicit phase semantics. This solves several problems at once: glitch-free updates across multi-write transactions, batched DOM updates, integration points for transitions, and the foundation for time-indexing.

### The scheduler design

The scheduler has phases. Within a phase, all writes complete before any reads or effects run. Between phases, effects scheduled in phase N run before phase N+1 begins. The default phases are:

1. **Write phase.** All `state.write(v)` calls in the current synchronous block accumulate. No `derived` is re-evaluated yet. No `watch` runs yet.

2. **Propagate phase.** When the synchronous block ends (microtask), all dirty `derived` are marked. Their `clean` -> `check` -> `dirty` state transitions happen here.

3. **Effect phase.** All `watch` callbacks whose dependencies are dirty run. They may write to `state`, which schedules the next round.

4. **Settle phase.** If new writes occurred in the effect phase, the scheduler loops back to phase 1. Otherwise, the round ends.

This is what Vue calls "next tick" and what React calls a "render pass." We're making it explicit and primitive rather than implicit.

### Why this matters

It eliminates the values-from-the-past problem entirely. Within a synchronous block, you can write to state ten times and read other state ten times, and every read sees a consistent snapshot. Updates to derived values don't happen until the block ends. Effects don't run until derivations have settled.

It also gives us the foundation for time-indexing in Phase 5. Each round of the scheduler is a candidate "time tick." The graph state at the end of round N is a snapshot. If we make the snapshot persistable, we get history for free.

### Decisions I'm making for you

**Default scheduling: microtask.** When the current synchronous block ends, the scheduler runs. This is fast enough for everything except animation; animation gets a separate scheduling primitive in a later phase.

**Effects can write to state.** They schedule the next round, they don't loop infinitely. We detect infinite loops via a per-round write counter and throw if the same effect writes the same state more than N times (default 50) in a single scheduler invocation.

**Effects run in declaration order within their depth class.** Deepest first, ties broken by declaration order. This is necessary for predictable cleanup-then-setup ordering when components mount and unmount.

**Manual control via `schedule.flush()` and `schedule.batch(fn)`.** For tests and for cases where you need synchronous control. These are escape hatches, not primary APIs.

### Decisions waiting on your taste

The terminology. "Scheduler," "phase," "round," "tick," "settle" — these are terms of art and you may want to choose differently. The vocabulary you pick will appear in error messages, dev tools, and the writeup. Choose deliberately.

Whether to expose the scheduler at all in v0.1, or hide it behind the primitives. Hiding it makes the API simpler; exposing it makes power-user cases possible. I'd lean toward exposing it, but it's a taste call.

### Done when

The full property test suite from Phase 1 still passes with scheduling now async-by-default. A new set of tests for "write-then-read-in-same-block sees consistent snapshot" passes. The scheduler can be inspected (you can ask "what's pending?" and "what just ran?"). Performance has not regressed by more than 50% from Phase 1 — speed is acceptable to lose for correctness here, but not unbounded.

---

## Phase 4 — Typed effects (weeks 33-40)

This is where the algebraic-effects discipline lands. Not full Koka-style algebraic effects (that requires too much type machinery to make ergonomic), but a typed-effect tracking system that takes the lessons.

### Goals

Effects (the side-effecting kind, not the `watch` kind) declare their kind in their type. The compiler tracks effect propagation. Components must install handlers for the effects their children perform.

### The shape

A function that performs IO has a type like `() => Effect<IO, T>`. A function that's pure has `() => T`. The type system propagates the effect set up through the call graph. At a boundary (a component, a route, a major component), you install handlers for each effect kind.

The minimal effect kinds for v0.1:

- `IO` — anything that reads or writes the outside world (network, disk, time, randomness)
- `Mutate` — anything that mutates non-local state (writes to a `state`)
- `Throws<E>` — anything that can fail
- `Async` — anything that suspends

This is enough to make the discipline real without becoming a full effect system.

### Why this matters

Effects are the universal escape hatch in every framework. Making them typed means:

- The compiler can warn when an effect crosses a boundary without a handler
- Components can refuse to mount children that perform effects they can't handle
- AI-generated code is more constrainable (the compiler stops sloppy effects)
- The system composes (effects can be combined, intercepted, mocked)

This is genuinely new for UI frameworks. Nobody else has shipped it.

### Why this is in Phase 4, not Phase 1

Doing typed effects from day one means designing the type system before the runtime, which is the wrong order. You need real code first to know which effects matter. By Phase 4 you'll have written enough reactive code to know what the kinds should be.

### Decisions I'm making for you

**Effects are tracked at the type level only.** No runtime tag. The compiler analyses statically; the runtime is unaware. This keeps performance pristine.

**Handler installation is via a `handle(effects, fn)` primitive.** Inside `fn`, the listed effects are caught. Outside, they propagate.

**Default handler at the framework root.** Top-level handlers exist for each effect kind; they implement the obvious thing (IO performs the IO, Mutate performs the mutation, Throws propagates, Async awaits). Components override them to intercept.

**No effect polymorphism in v0.1.** A function declares its effects literally. Generic effect handling (where a function says "I propagate whatever effects my callback has") is Phase 5+ work.

### Decisions waiting on your taste

Whether to require effects at all in v0.1, or treat the typed effect system as a stretch goal. The honest answer is that without typed effects, you have a competent reactivity system. With them, you have a genuinely novel one. The cost is real — designing this well will take all eight weeks. Your call.

The names of the effect kinds. `IO`, `Mutate`, `Throws`, `Async` are placeholders.

### Done when

A function that calls `fetch` cannot be called from a component that hasn't installed an `IO` handler — the compiler refuses. The toy commonplace book demo's data layer correctly declares its effects. The writeup chapter on typed effects is drafted.

---

## Phase 5 — Time and the temporal tuple (weeks 41-52)

The final big-design phase. This is where the framework becomes recognizably *yours*.

### Goals

Every reactive value is time-indexed. The current value is `now`. Past values are addressable via the time index. Async values are values that haven't resolved at the current time index. Transitions are forks of the time index.

### The shape

A `state` is no longer just a value — it's a function from time index to value. The default time index is "now." You can address past values: `state.at(time-3)`. You can fork: `let alt = time.fork()` produces a new index that diverges from the current one. Within a fork, writes don't affect the parent index until the fork is committed.

Async naturally fits: a value at time T might be `pending` and at time T+1 be resolved. The system has explicit support for "this value hasn't yet resolved at this time index."

### Why this is the last big phase

Time-indexing affects every primitive. Doing it earlier would have forced design choices before we knew which were right. By Phase 5 you have a working synchronous-derivable-scheduled-typed-effect system, and adding time-indexing on top is a *cohesive* extension rather than a foundational rewrite.

This is also where you've earned the right to do something genuinely novel. The earlier phases were about making the boring choices well. This phase is where the writeup gets its lead chapter.

### Decisions I'm making for you

**Time is discrete and integer-indexed.** Each scheduler round advances the time by 1. Real wall-clock time is not the same as graph time.

**Default retention: short.** By default, only the last N (default 32) time indices are kept. Beyond that, history is discarded. Users can opt into longer retention per-state.

**Forking is explicit.** You don't accidentally fork. You call `time.fork(fn)` and the function runs in the forked time. Commit/abandon is explicit.

**Async values are tagged with the time index they were initiated at.** When they resolve, the resolved value is associated with the *initiation* time, not the resolution time. This makes "what was the user looking at when they triggered this?" queryable.

### Decisions waiting on your taste

The vocabulary around time is yours. "Tick," "moment," "epoch," "round," "frame," "step" — pick what fits the framework's voice.

Whether transitions and time-forking are exposed as primary APIs or hidden behind higher-level abstractions like `transition(fn)`. The conservative answer is "expose the primitives, build abstractions later." The opinionated answer is "hide the time machinery behind ergonomic transition APIs from day one." Your call.

### Done when

The toy commonplace book has working "undo" via time-indexing. Async data fetching for the search demo works correctly without explicit suspense management. The graph state is serializable to JSON and restorable across page reloads.

---

## Phase 6 — Graph as artifact (weeks 53-58)

The final commitment. The reactive graph becomes a first-class object: serializable, inspectable, persistable.

### Goals

The graph state at any time index can be:
- Serialized to JSON
- Restored from JSON
- Inspected at runtime via a stable API
- Snapshotted for debugging

### Why this enables resumability

If you can serialize the graph at the end of an SSR pass and restore it on the client, you have resumability — Qwik-style — without Qwik's specific architecture. The closures captured by `derived` need to be referenced by stable identifiers (assigned at compile time), but the runtime reactivity state — current values, dependencies, scheduled work — can be JSON.

This is also the foundation for time-travel debugging in dev tools, which is the kind of feature that makes a framework feel mature.

### Decisions I'm making for you

**Serialization format: JSON, with a separate code-loader for closures.** The graph's data is JSON-serializable. The `derived` closures are referenced by stable IDs that get resolved against a code module. This matches Qwik's approach.

**Closure identity: hash-based.** Each `derived` closure gets a stable hash assigned at compile time (Phase 7+ work, but plan for it now). Restoring a graph reattaches closures by hash.

**Inspection API: `graph.snapshot()` returns a tree of nodes; `graph.dependencies(node)` walks the edges; `graph.atTime(t)` returns a snapshot at past time T.** Read-only; mutations go through the normal write path.

### Done when

The toy commonplace book persists across browser reloads via graph serialization. A simple dev-tools page can render the graph as a navigable tree. The writeup's resumability chapter is drafted.

---

## v0.1 release (weeks 59-66)

Polishing, the final demo, the writeup, the announcement.

### Tasks

Polish the API surface. Stabilize names. Write the README. Ship the toy commonplace book demo as a deployable thing. Finalize the writeup. Cross-reference everything. Make the dev tools usable. Run the property tests one more time on the entire system. Benchmark against Solid 2.0 (which will likely have shipped by then) and Vue's signals system.

Publish the writeup. Not as a manifesto — as a careful technical articulation of what the system does and why, with worked examples and honest limitations. The tone is: "here's what I built, here's what it can and can't do, here's why I made these choices, here's where the design space goes from here."

If the writeup is good, adoption follows. If it's not, the framework dies regardless of how good the code is. The writeup is at least 50% of the v0.1 deliverable.

### Done when

The toy commonplace book is deployed. The writeup is published. The library is published to npm. There's a brief Twitter/Bluesky announcement. You've taken a week off before considering Phase 7+.

---

## Risk register

The five most likely ways this project fails, and what to watch for.

**Scope creep into the rest of the framework.** Every week you'll have an idea for a router primitive, a component primitive, a persistence primitive. None of them belong here. Write them down in a "Phase 7+" file and forget them. The reactivity system is the deliverable. Discipline on this is the single biggest determinant of success.

**Premature optimization.** You'll be tempted to chase Solid's benchmark numbers. Don't. Within 2x is acceptable through Phase 5. Performance work happens in Phase 6 onward. Spending two weeks shaving 10% off `derived` evaluation in Phase 2 means two weeks not spent on the design that actually matters.

**Async paralysis.** Async is genuinely hard. You will spend more weeks on Phase 5 than the plan says. That's expected. The way to fail is to not start because you're afraid of getting it wrong. Ship something async-related at the end of Phase 5 even if it's incomplete; the writeup is allowed to acknowledge open questions.

**Writeup procrastination.** The writeup will feel less urgent than the code. It is more important than the code. If the writeup is six months behind by Phase 4, you're going to lose the project. Write the chapter for each phase as you finish that phase. Don't batch.

**Burnout from solo isolation.** You'll be working on this in evenings while doing OneUI by day, the MSc/MBA path, hifz, training, content. The risk isn't dramatic — it's gradual. Six months in, the project loses its shine and you start skipping nights. The defenses are: keep the journal religious (it makes progress visible), publish small things along the way (a tweet about an interesting bug, a journal entry that becomes a blog post), and find one person to talk to about it. Not collaborate with — just talk to. Every framework author has this person.

---

## What you should do this week

Not the full Phase 0. Just the first three things.

1. Decide whether the plan as written is the project you want to build. Read it once now, sit with it for 24 hours, read it again. If something feels wrong, push back before any code is written. Plans are easy to change before they're started.

2. Pick a working name for the project. Doesn't have to be the final name. You need *some* word to put on folders and journal entries. Working names get used for months and the right one will emerge from use.

3. Set up the repository. Single commit. README that says "reactivity research project, see plan/README.md for details." First journal entry: today's date, what you decided about the plan, what you're uncertain about.

That's enough for week one. The rest of Phase 0 follows naturally from there.

---

## What I'm waiting for from you

Three things, before we go further:

1. Does the plan as written match the project you want to build? Specifically: does the phase structure feel right, or are there phases you'd reorder, expand, or cut?

2. The taste decisions I flagged throughout. Names of primitives, names of effect kinds, the project's working name. These don't all need answers now, but the project's working name does.

3. The honest question: is this still the project you want? The plan is real and ambitious. Reading it as an artifact rather than a conversation may shift how you feel about the commitment. If it's still yes, we proceed. If reading the plan changes your mind, we should know now.

The next artifact after you respond to this isn't more research and isn't more planning. It's actual code — the first draft of the synchronous core, written against the property tests, in the working repo. Phase 1 begins the moment you say go.
