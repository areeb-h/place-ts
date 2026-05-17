# 05 — Testing Strategy

The thorough testing layer that ensures each functionality works. This is not "we run tests." It is the explicit contract between every system's behavior and the property tests that prove it.

The reactivity system's eight algebraic invariants are the model. Every other system gets the same treatment.

---

## Six layers

| Layer | What it proves | Tool | Speed | Where it lives |
|-------|----------------|------|-------|----------------|
| **Unit** | Single function does what it claims | Vitest | < 100ms each | `systems/<name>/tests/unit/` |
| **Property** | An invariant holds under all generated inputs | fast-check on Vitest | seconds | `systems/<name>/tests/property/` |
| **Integration** | Two systems compose correctly | Vitest | seconds | `systems/<name>/tests/integration/` (consumer-side) or `tests/integration/` (cross-cutting) |
| **End-to-end** | A full flow works through the commonplace example | Playwright | minutes | `tests/e2e/` |
| **Conformance** | A system implementation satisfies its charter | Vitest, structured | seconds | `tests/conformance/` |
| **Benchmark** | Performance has not regressed | tinybench / Vitest bench | minutes | `benchmarks/` |

Each layer answers a different question. None substitutes for another.

---

## Property tests are the load-bearing layer

For reactivity-graph systems, property tests beat unit tests. A unit test proves a specific case. A property test proves a class of cases. Reactivity bugs are *almost always* the case the unit test didn't think of.

**The eight reactivity invariants** (from [systems/reactivity/docs/03-implementation-plan.md](../../systems/reactivity/docs/03-implementation-plan.md), Phase 1):

1. Glitch-freedom within a watch evaluation
2. Lazy evaluation
3. Memoization
4. Deterministic re-evaluation order
5. Diamond convergence (no double-evaluation)
6. Cycle detection at read time
7. Cleanup on unsubscribe
8. Dynamic subscription

Each is a fast-check property. None is optional. None is "covered by unit tests."

Per-phase additions:

- **Phase 2 (derivable state):** revert / rebase / permanent policies each have their own invariants — write-then-upstream-update produces the right outcome under each policy, regardless of write timing.
- **Phase 3 (scheduler):** within-block snapshot consistency, effect ordering by depth, infinite-loop detection terminates, manual flush is idempotent.
- **Phase 4 (typed effects):** handler propagation is statically analyzable, unhandled effects are compile errors, mocked handlers compose with real ones.
- **Phase 5 (time):** fork independence (writes in fork don't affect parent), commit / abandon semantics, async-value timing tags resolve to initiation tick.
- **Phase 6 (graph):** serialize → deserialize round-trip yields equivalent graph, closure rehydration by hash succeeds, time-travel restoration is consistent.

Every other system enumerates its own invariants in its `docs/05-test-plan.md` before implementation begins.

---

## Conformance tests

A conformance test takes a system's *charter* and turns each clause into an executable check. This is what catches "the implementation has drifted from the design."

Example shape (reactivity charter clause: "all state is derivable"):

```ts
// tests/conformance/reactivity.charter.test.ts
test('charter: all state is derivable', () => {
  const upstream = state(0)
  const derived = state(() => upstream.read() * 2)
  upstream.write(5)
  expect(derived.read()).toBe(10)
  derived.write(99)
  expect(derived.read()).toBe(99)
  upstream.write(7)
  expect(derived.read()).toBe(14)  // upstream wins, default policy
})
```

Conformance tests are not unit tests. They prove the system is *the system its charter describes*. They are read alongside the charter; if the charter changes, the conformance tests change.

---

## Integration test ownership

When system A consumes system B, the integration test belongs to A.

- Component → reactivity: lives in `systems/component/tests/integration/reactivity.test.ts`.
- Data → cache: lives in `systems/data/tests/integration/cache.test.ts`.
- Persistence → reactivity (adapter contract): lives in `systems/persistence/tests/integration/reactivity-adapter.test.ts`.

Cross-cutting tests that span more than two systems live in `tests/integration/`.

---

## End-to-end tests

E2E lives in `tests/e2e/` and exercises the commonplace example as a real app.

Minimum E2E suite for v0.1:
- Create a note
- Edit a note, see the change reflected
- Link two notes, traverse the link
- Search for a term, see results
- Reload the page, all state restored
- Undo a change via time-indexing

These are the demos that prove the platform works end-to-end. If any breaks, v0.1 doesn't ship.

---

## Benchmarks

Benchmarks are not pass/fail tests. They are signals.

**What we benchmark:**
- Reactivity primitives vs Solid 2.0 signals (when shipped) and Vue's `ref`. Target: within 2x through Phase 5.
- Render throughput on the commonplace example: large note list (1000+), complex link graph, large search index.
- Graph serialization round-trip on a realistic graph state.

**What we do not benchmark:**
- Bundle size. (Tracked separately.)
- Cold start. (Tracked separately if it matters.)

Benchmark runs are nightly in CI. A 25%+ regression on any benchmark blocks merge until investigated.

---

## CI quality gates

Every PR must pass:

1. **Type check** — TypeScript strict, no `any`, no `// @ts-ignore` without ADR justification.
2. **Lint** — Biome, no warnings.
3. **Unit + property tests** — green on all.
4. **Conformance tests** — green on all.
5. **Integration tests** — green on the affected systems.

E2E and benchmarks run on merge to main, not per-PR.

A PR that adds a new public API entry must also add:
- A unit test
- A property test (if there's an algebraic invariant)
- A conformance test (if it's part of the charter)

This is non-negotiable. The discipline is what makes the property-test layer trustworthy.

---

## Tooling decisions

| Tool | Choice | Reason |
|------|--------|--------|
| Test runner | **Vitest** | Native TS, fast, watch mode is good, plays well with Bun |
| Property tests | **fast-check** | Most mature in JS ecosystem, integrates with Vitest |
| E2E | **Playwright** | Cross-browser, scriptable, decent debug story |
| Benchmarks | **tinybench** (or Vitest's built-in bench) | Lightweight, statistical |
| Coverage | **c8** (via Vitest) | Native V8 coverage |
| Mutation testing | **Stryker** (post-v0.1) | Verifies tests actually catch regressions |
| Snapshot testing | **avoid** | Snapshots are tests that always pass; we don't want any of those |

These are decisions, not options. Adding a tool is an ADR.

---

## Anti-patterns to avoid

- **Snapshot tests** — they pass when they shouldn't.
- **Tests that mock the system under test** — verify nothing.
- **Tests that share mutable state** — order-dependent, flaky.
- **Tests with timing waits** — replace with deterministic schedulers.
- **Skipping property tests because they're slow** — they're slow because they're useful.

---

## What "thorough" means

Thorough is not "100% line coverage." Thorough is:

1. Every charter clause has a conformance test.
2. Every algebraic invariant has a property test.
3. Every public API entry has a unit test.
4. Every cross-system contract has an integration test on the consumer side.
5. Every flow in the commonplace example has an E2E test.
6. Every performance-sensitive primitive has a benchmark with a baseline.

When all six are true for a system, the system is "test-complete." That is the definition of `done` for any phase that ships a system to v0.1.
