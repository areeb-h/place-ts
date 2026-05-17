# 05 — Reactivity Test Plan

Per-phase invariants, enumerated. Each is a property test (fast-check on Vitest) unless marked otherwise. No phase ships without its invariants green.

This doc operationalizes [docs/platform/05-testing-strategy.md](../../../docs/platform/05-testing-strategy.md) for reactivity.

---

## Phase 1 — Synchronous core (8 invariants)

These are the contract of the synchronous foundation. Sourced from [03-implementation-plan.md §Phase 1](03-implementation-plan.md).

| # | Invariant | Property |
|---|-----------|----------|
| 1.1 | Glitch-freedom | Within a single `watch` evaluation, every `derived` read returns a consistent snapshot |
| 1.2 | Lazy evaluation | A `derived` that is never read does not run, even if its dependencies change |
| 1.3 | Memoization | A `derived` read twice without dependency changes runs exactly once |
| 1.4 | Deterministic order | When N nodes depend on the same source, re-evaluation order is topologically sorted, ties broken deterministically |
| 1.5 | Diamond convergence | A → X, B → X, C → A∧B; changing X causes C to re-evaluate exactly once |
| 1.6 | Cycle detection | A `derived` transitively depending on itself throws on read |
| 1.7 | Cleanup on unsubscribe | Disposing the last `watch` of a `derived` tears down its source subscriptions |
| 1.8 | Dynamic subscription | A `derived` whose code path changes between runs updates its dependency set |

**Coverage requirement:** every invariant has at least one fast-check property AND at least one regression unit test for the historical bug shape it prevents.

---

## Phase 2 — Derivable state (policy invariants)

The unified `state(value | () => value)` primitive introduces three policies for "local write meets upstream update."

### Revert policy (default)

| # | Invariant |
|---|-----------|
| 2.1 | After local write, `read()` returns local value |
| 2.2 | When upstream changes, local value is discarded; `read()` returns upstream-derived value |
| 2.3 | Local write before upstream change is observable in any `watch` that ran between them |
| 2.4 | Local write after upstream change persists until the next upstream change |

### Rebase policy

| # | Invariant |
|---|-----------|
| 2.5 | Local write is stored as a delta from the upstream value |
| 2.6 | When upstream changes, the delta is reapplied to the new upstream value |
| 2.7 | Delta type matches state type; non-deltable types throw at write time |

### Permanent policy

| # | Invariant |
|---|-----------|
| 2.8 | After first local write, upstream binding is severed permanently |
| 2.9 | Subsequent upstream changes do not affect the value |
| 2.10 | Severance event is observable (a `watch` can detect it) |

---

## Phase 3 — Scheduler invariants (shipped 2026-05-01)

Phase 3 design diverged from the original plan. Sync-default was kept; `batch`, `flush`, and per-watch `defer: true` were added as opt-in scheduler controls. The original "deferred-by-default with phase semantics" model is replaced by a leaner two-queue scheduler. Invariants below reflect what shipped.

| # | Invariant |
|---|-----------|
| 3.1 | `batch(fn)` defers all watch firing until the outermost batch returns |
| 3.2 | Nested `batch` calls only flush at the outermost level |
| 3.3 | `batch` returns the value `fn` returned |
| 3.4 | Reads inside a batch see writes performed earlier in the same batch |
| 3.5 | Mid-batch throw still flushes pending watches against the partial state |
| 3.6 | `flush()` synchronously drains both sync and deferred queues |
| 3.7 | `flush()` during a batch is a no-op |
| 3.8 | A watch with `defer: true` runs once on creation; subsequent re-runs are deferred to the next microtask |
| 3.9 | Multiple writes between microtask boundaries coalesce into one deferred run |
| 3.10 | Disposing a deferred watch removes it from the queue before the microtask fires |
| 3.11 | Sync and deferred watches coexist on the same source without interference |
| 3.12 | Cross-watch mutual feedback (A writes B's source, B writes A's source) triggers the round limit |
| 3.13 | Phase 1+2 invariants still hold with the new scheduler |
| 3.14 | `peek(state)` reads without subscribing the current observer |

**Performance constraint:** Phase 1 benchmarks must not regress by more than 50%.

---

## Phase 4 — Typed effects (mostly compile-time)

Static analysis invariants — most are checked by tests against the build system.

| # | Invariant |
|---|-----------|
| 4.1 | A function calling `fetch` carries `IO` in its type |
| 4.2 | A function with `IO` cannot be called from a context that has not installed an `IO` handler — compile error |
| 4.3 | `handle(['IO'], h, body)` catches `IO` from `body` and not from outside |
| 4.4 | Handler installation type-narrows the inner scope's effect set |
| 4.5 | Default handlers at the framework root pass effects through with their default semantics |
| 4.6 | Effect propagation does not have runtime cost (verified by benchmark) |

---

## Phase 5 — Time and forking

| # | Invariant |
|---|-----------|
| 5.1 | `state.at(t)` for `t < now()` returns the value at tick `t` |
| 5.2 | `state.at(t)` for `t > now()` throws |
| 5.3 | Per-state retention default of 32 ticks holds; older ticks are discarded |
| 5.4 | A fork's writes are not visible in the parent until commit |
| 5.5 | `fork.abandon()` discards all writes; parent state is unchanged |
| 5.6 | `fork.commit()` applies fork writes atomically — all visible in the same parent tick |
| 5.7 | Async values resolved after fork commit are tagged with the fork's commit tick, not the resolution wall-clock time |
| 5.8 | Glitch-freedom (1.1) holds within a fork |
| 5.9 | Multiple concurrent forks do not interact with each other |

---

## Phase 6 — Graph as artefact

| # | Invariant |
|---|-----------|
| 6.1 | `graph().serialize()` produces JSON that round-trips to an equivalent graph |
| 6.2 | After restore, all `read()` calls return values matching the pre-serialize state |
| 6.3 | Closure rehydration by hash succeeds; missing hashes throw on restore |
| 6.4 | `graph().atTime(t)` returns a snapshot consistent with what `state.at(t)` would have returned at the time |
| 6.5 | Inspection API is read-only — no mutation paths exposed |
| 6.6 | Serialized graph size grows linearly with node count |

---

## Conformance tests

Charter clause → conformance test mapping. These live in `tests/conformance/reactivity.charter.test.ts`.

| Charter clause | Conformance test |
|----------------|------------------|
| "Time as the primitive" | a `state` carries a tick; `at(tick)` works |
| "Derivation as primary" | `state(() => upstream.read())` is writable and self-updating |
| "Graph as artefact" | `graph().serialize()` produces JSON; restore reconstructs |
| "Typed effects" | A function with declared `IO` cannot be called without a handler |
| "Within 2x of Solid" | Benchmark suite runs both; ratio ≤ 2.0 |

---

## Benchmark targets

Run nightly. A regression of >25% on any benchmark blocks merge until investigated.

| Benchmark | Target | Source |
|-----------|--------|--------|
| Single-cell read | within 2x of Solid `createSignal` | tests/benchmark |
| Diamond dependency update | within 2x of Solid | tests/benchmark |
| 1000-node graph creation | within 2x of Solid | tests/benchmark |
| Graph serialization round-trip | linear in node count | tests/benchmark |
| Scheduler flush of 100 effects | within 50% of Phase 1 baseline | tests/benchmark |

---

## "Done" definitions

A phase ships only when:

1. All invariants for that phase pass as property tests.
2. Earlier phases' invariants still pass.
3. Conformance tests for the relevant charter clauses pass.
4. Benchmarks have not regressed beyond their target.
5. The corresponding chapter of the writeup is drafted.

These five together are the contract for "Phase N done."
