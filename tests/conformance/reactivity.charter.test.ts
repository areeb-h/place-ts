// Conformance tests for the reactivity system charter.
//
// One test per charter clause that is provable at the current phase. Charter
// clauses gated to later phases get tests when those phases ship.
//
// See systems/reactivity/docs/00-charter.md and docs/platform/05-testing-strategy.md.

import { describe, expect, test } from 'vitest'
import { state, watch } from '../../systems/reactivity/src/index.ts'

describe('reactivity charter conformance — Phase 1+2 provable claims', () => {
  // ─── Charter: state holds a writable atomic value ──────────────────────
  test('charter: state holds writable atomic value', () => {
    const a = state(42)
    expect(a()).toBe(42)
    a.set(7)
    expect(a()).toBe(7)
  })

  // ─── Charter: derivation is the unit; raw state is degenerate ──────────
  test('charter: state(value) and state(() => fn) share one primitive', () => {
    const raw = state(5)
    const derived = state(() => raw() + 1)
    expect(raw()).toBe(5)
    expect(derived()).toBe(6)
    raw.set(10)
    expect(derived()).toBe(11)
  })

  // ─── Charter: derived state is writable (revert policy) ────────────────
  test('charter: state(() => upstream) is writable; revert on upstream change', () => {
    const upstream = state(0)
    const derived = state(() => upstream() * 2)
    derived.set(99)
    expect(derived()).toBe(99)
    upstream.set(5)
    expect(derived(), 'upstream wins; override reverted').toBe(10)
  })

  // ─── Charter: derived state is lazy and memoized ───────────────────────
  test('charter: derived state is lazy and memoized', () => {
    const a = state(2)
    let runs = 0
    const b = state(() => {
      runs++
      return a() * 3
    })
    expect(runs).toBe(0)
    expect(b()).toBe(6)
    expect(b()).toBe(6)
    expect(runs).toBe(1)
  })

  // ─── Charter: watch observes the graph and re-runs on change ───────────
  test('charter: watch observes and re-runs on change (Phase 1: synchronous)', () => {
    const a = state(0)
    let observed = -1
    watch(() => {
      observed = a()
    })
    expect(observed).toBe(0)
    a.set(5)
    expect(observed).toBe(5)
  })

  // ─── Charter: derivations must be pure ─────────────────────────────────
  test('charter: derivations must be pure', () => {
    const a = state(0)
    const bad = state(() => {
      a.set(1)
      return 0
    })
    expect(() => bad()).toThrow(/write during a derived/i)
  })

  // ─── Charter: equality short-circuits propagation ──────────────────────
  test('charter: equality short-circuits propagation', () => {
    const a = state(5)
    let runs = 0
    watch(() => {
      runs++
      a()
    })
    runs = 0
    a.set(5)
    expect(runs).toBe(0)
  })

  // ─── Charter: cycles are detected at read time ─────────────────────────
  test('charter: cycles detected at read time, not write time', () => {
    let bRef: (() => number) | null = null
    const b = state(() => (bRef ? bRef() : 0) + 1)
    bRef = b
    expect(() => b()).toThrow(/cycle/i)
  })

  // ─── Charter: subscription is dynamic ──────────────────────────────────
  test('charter: subscription is dynamic across runs', () => {
    const flag = state(true)
    const a = state(1)
    const b = state(100)
    let runs = 0
    let last = 0
    watch(() => {
      runs++
      last = flag() ? a() : b()
    })
    flag.set(false)
    runs = 0
    a.set(99)
    expect(runs).toBe(0)
    expect(last).toBe(100)
    b.set(200)
    expect(last).toBe(200)
  })

  // ─── Charter: cleanup tears down subscriptions ─────────────────────────
  test('charter: disposing a watch tears down derived subscriptions', () => {
    const a = state(0)
    let derivedRuns = 0
    const b = state(() => {
      derivedRuns++
      return a()
    })
    const dispose = watch(() => {
      b()
    })
    derivedRuns = 0
    a.set(1)
    expect(derivedRuns).toBe(1)
    dispose()
    derivedRuns = 0
    a.set(2)
    a.set(3)
    expect(derivedRuns).toBe(0)
  })
})

// ─── Deferred clauses ────────────────────────────────────────────────────
//
// - "Time as the primitive"            — Phase 5 (state.at(tick))
// - "Graph as artefact"                — Phase 6 (graph().serialize() / restore)
// - "Typed effects"                    — Phase 4 (compile-time effect kinds)
// - "Persistence-adapter contract"     — Phase 4+ (PersistenceAdapter interface)
// - "Rebase / permanent policies"      — deferred indefinitely; revert is the
//                                         only ship-default at v0.1
