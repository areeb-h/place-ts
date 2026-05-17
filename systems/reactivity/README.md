# Reactivity System

The foundation of the platform. Time-indexed reactive primitives, derivation as primary, graph as artefact, with typed effects as a constraint.

**Status:** Phase 1 + 2 + 3 shipping (synchronous core, derivable state, scheduler). Phase 5 partial: `resource(loader)` async-as-pending primitive + `history(state)` undo/redo helper shipping. 91 tests green.

## Reading order

1. [docs/00-charter.md](docs/00-charter.md) — scope, non-goals, depends-on
2. [docs/01-pain-points.md](docs/01-pain-points.md) — research: what's broken in every reactivity system
3. [docs/02-design.md](docs/02-design.md) — the A+C+F+B argument, consolidated *(stub)*
4. [docs/03-implementation-plan.md](docs/03-implementation-plan.md) — the 6-phase build, weeks 1-66
5. [docs/04-interfaces.md](docs/04-interfaces.md) — what this system exposes / consumes
6. [docs/05-test-plan.md](docs/05-test-plan.md) — invariants per phase

## Shipping API

### Phase 1+2 — synchronous core + derivable state

```ts
import { state, watch, untrack } from '@place/reactivity'

const a = state(1)                // raw state
const b = state(() => a() + 1)    // derived (also writable; revert policy)
watch(() => console.log(b()))     // re-runs when sources actually change

a.set(2)                          // logs 3
b.set(99)                         // logs 99 (override wins)
a.set(3)                          // logs 4 (upstream change reverts override)
```

- **`state(value | () => value, options?)`** — unified primitive. Raw state is the degenerate case of derived. Derived is also writable: local writes win until any upstream actually changes value (revert policy). `equals` defaults to `Object.is`; pass a structural comparator to short-circuit propagation.
- **`watch(fn, options?)`** — observe; re-runs synchronously when tracked sources change. `defer: true` opts into microtask coalescing. The default-stability of `defer: false` is committed.
- **`state.peek()`** — untracked read on the state value. Doesn't subscribe the current observer. (The standalone `peek(state)` function was removed at Tier 15-A; use the method form.)
- **`untrack(fn)`** — broader form. Used internally at component mount boundaries so descendant reads don't pollute ancestor watches.

### Phase 3 — scheduler

```ts
import { batch, flush } from '@place/reactivity'

batch(() => {
  a.write(1); b.write(2); c.write(3)
})  // watches see the final state, not the intermediate ones

flush()  // synchronously drain pending watches (no-op inside a batch)
```

### Phase 5 (partial) — `resource(loader)` async-as-pending

```ts
import { resource } from '@place/reactivity'

const note = resource(() =>
  fetch(`/notes/${id.read()}`).then((r) => r.json()),
)

// In a component:
const s = note.status()
if (s.state === 'loading') return 'Loading…'
if (s.state === 'error') return `Error: ${String(s.error)}`
return <NoteView note={s.value} />

note.refresh()                        // re-runs the loader
note.read() / note.loading() / note.error()  // independent reactive views
```

The loader runs inside a `watch`. Its synchronous reactive reads (before the first `await`) become tracked deps — change one, the resource re-fetches. Stale in-flight fetches are dropped via an internal token.

No Suspense, no compiler, no rendering boundary. Async lives inside the same two-color graph as everything else, exposed as a discriminated `status` your component switches on.

### Phase 5 (partial) — `history(state, options?)` undo/redo

```ts
import { history, state } from '@place/reactivity'

const note = state({ title: '', content: '' })
const h = history(note, { limit: 50, equals: (a, b) => a.title === b.title && a.content === b.content })

note.write({ title: 'first', content: '' })
note.write({ title: 'first', content: 'hello' })

h.undo()           // → { title: 'first', content: '' }
h.canRedo()        // → true (reactive)
h.redo()           // → { title: 'first', content: 'hello' }
note.write({ title: 'edit', content: 'world' })
h.canRedo()        // → false (new edit cleared redo)
h.dispose()        // stop snapshotting
```

Wraps a `State<T>` with a bounded undo/redo stack. New edits clear the redo stack; the `applying` flag inside `undo`/`redo` keeps the auto-snapshot watch from re-recording the restoration as a fresh edit (same cycle-break pattern `persistedState` uses for cross-tab observe). `canUndo()` / `canRedo()` are reactive — wire them to button `disabled` props directly.

## Algorithm — two-color graph coloring

On a state write: direct dependents marked `DIRTY`, transitive dependents marked `CHECK`. On read of a `CHECK` node: walk sources; if any actually changed value, recompute; otherwise mark `CLEAN`. This is what TC39 standardizes and what Solid/Vue/Vapor converge on. Place implements it in ~80 LOC. Diamond convergence is O(n).

A `__internal` namespace exposes test-only inspection (`hasPendingSync`, `hasPendingDeferred`, `isFlushing`, `batchDepth`).

## Tests

- `tests/property/synchronous-core.test.ts` — Phase 1 invariants (10) via fast-check
- `tests/property/derivable-state.test.ts` — Phase 2 invariants (10)
- `tests/unit/state.test.ts` — raw + derived + revert (19)
- `tests/unit/watch.test.ts` — sync + defer (8)
- `tests/unit/scheduler.test.ts` — batch / flush / peek / cycle detection (23)
- `tests/unit/resource.test.ts` — async-as-pending (11)
- `tests/unit/history.test.ts` — undo/redo + bounded limit + dedupe (10)
- `tests/benchmark/sync-core.bench.ts` — vs Solid 1.9. Single-read parity (1.01x); graph creation 4.5x faster. Propagation comparisons have a known setup caveat — see the bench's instrumentation comments.

## What this system is responsible for

State, derivation, observation, scheduling, time-indexing, graph inspection, typed-effect declarations (Phase 4, deferred).

## What this system is *not* responsible for

Rendering (component system). Storage (persistence system). Routing (routing system). Capability scoping at the policy level (capability system). The compiler (build system).

## What's deferred

- **Phase 4 — typed effects.** `function fetch(): Effect<IO, T>` style. Runtime piece (capability) is shipping; compile-time enforcement is the deferred half.
- **Phase 5 (rest) — time-indexing, fork, scope-passing.** `resource` is the first piece. Time-tuple state and graph fork land later.
- **Phase 6 — graph serialization, dev tools, hydration replacement.**
