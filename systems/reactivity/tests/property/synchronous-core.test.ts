// Phase 1 algebraic invariants — see docs/05-test-plan.md §Phase 1.
//
// These eight properties are the contract of the synchronous core. They are
// non-negotiable; every framework that ships reactivity violates at least one
// and pays for it. Property tests use fast-check; failure messages name the
// invariant they prove.
//
// Phase 2 unified `cell` and `derived` into a single `state` primitive:
//   - state(value)        — raw state (was: cell)
//   - state(() => expr)   — derived state (was: derived)

import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { state, watch } from '../../src/index.ts'

describe('Phase 1: synchronous core invariants', () => {
  // ─── 1.1 Glitch-freedom ────────────────────────────────────────────────
  test('1.1 glitch-freedom: a watch sees a consistent snapshot', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: 1000 }), (delta) => {
        const a = state(0)
        const b = state(() => a() + 1)
        const c = state(() => a() + 2)
        const observations: Array<readonly [number, number, number]> = []

        const dispose = watch(() => {
          observations.push([a(), b(), c()] as const)
        })
        a.set(delta)
        dispose()

        for (const [av, bv, cv] of observations) {
          expect(bv, 'b should equal a+1 within snapshot').toBe(av + 1)
          expect(cv, 'c should equal a+2 within snapshot').toBe(av + 2)
        }
      }),
      { numRuns: 50 },
    )
  })

  // ─── 1.2 Lazy evaluation ───────────────────────────────────────────────
  test('1.2 lazy: a derived state no one reads does not run', () => {
    fc.assert(
      fc.property(fc.array(fc.integer(), { minLength: 1, maxLength: 10 }), (writes) => {
        const a = state(0)
        let runs = 0
        // Created but never read — invariant says fn must not run
        state(() => {
          runs++
          return a() * 2
        })
        for (const v of writes) a.set(v)
        expect(runs, 'unread derived state should never run').toBe(0)
      }),
      { numRuns: 50 },
    )
  })

  // ─── 1.3 Memoization ───────────────────────────────────────────────────
  test('1.3 memoized: repeated reads with no dep change run once', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), fc.integer(), (readCount, n) => {
        const a = state(n)
        let runs = 0
        const b = state(() => {
          runs++
          return a() * 2
        })
        for (let i = 0; i < readCount; i++) b()
        expect(runs, 'derived state should compute once and memoize').toBe(1)
      }),
      { numRuns: 50 },
    )
  })

  // ─── 1.4 Deterministic re-evaluation order ─────────────────────────────
  test('1.4 deterministic order: dependents re-run in topological order', () => {
    const a = state(0)
    const b = state(() => a() + 1)
    const c = state(() => b() * 2)
    const log: number[] = []

    const dispose = watch(() => {
      log.push(c())
    })
    log.length = 0

    a.set(5)
    expect(log).toEqual([12]) // a=5 → b=6 → c=12

    a.set(10)
    expect(log).toEqual([12, 22]) // a=10 → b=11 → c=22

    dispose()
  })

  // ─── 1.5 Diamond convergence ───────────────────────────────────────────
  test('1.5 diamond: changing root causes leaf to evaluate exactly once', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
        (start, next) => {
          fc.pre(start !== next)

          const x = state(start)
          let aRuns = 0
          let bRuns = 0
          let cRuns = 0
          let watchRuns = 0

          const a = state(() => {
            aRuns++
            return x() + 1
          })
          const b = state(() => {
            bRuns++
            return x() + 2
          })
          const c = state(() => {
            cRuns++
            return a() + b()
          })

          const dispose = watch(() => {
            watchRuns++
            c()
          })

          const aBase = aRuns
          const bBase = bRuns
          const cBase = cRuns
          const wBase = watchRuns

          x.set(next)

          expect(aRuns - aBase, 'a evaluates once').toBe(1)
          expect(bRuns - bBase, 'b evaluates once').toBe(1)
          expect(cRuns - cBase, 'c evaluates once (no diamond duplication)').toBe(1)
          expect(watchRuns - wBase, 'watch runs once').toBe(1)

          dispose()
        },
      ),
      { numRuns: 50 },
    )
  })

  // ─── 1.6 Cycle detection ───────────────────────────────────────────────
  test('1.6 cycle detection: throws when a derived state reads itself transitively', () => {
    let bRef: (() => number) | null = null
    const b = state(() => (bRef ? bRef() : 0) + 1)
    bRef = b
    expect(() => b()).toThrow(/cycle/i)
  })

  test('1.6 cycle detection: longer cycle through multiple derived states', () => {
    let cRef: (() => number) | null = null
    const a = state(() => (cRef ? cRef() : 0) + 1)
    const b = state(() => a() + 1)
    const c = state(() => b() + 1)
    cRef = c
    expect(() => c()).toThrow(/cycle/i)
  })

  // ─── 1.7 Cleanup on unsubscribe ────────────────────────────────────────
  test('1.7 cleanup: disposing the last watch tears down subscriptions', () => {
    const a = state(0)
    let bRuns = 0
    const b = state(() => {
      bRuns++
      return a() * 2
    })

    const dispose = watch(() => {
      b()
    })
    expect(bRuns).toBeGreaterThan(0)

    bRuns = 0
    a.set(1)
    expect(bRuns, 'b runs once for the active watch').toBe(1)

    dispose()
    bRuns = 0
    a.set(2)
    a.set(3)
    a.set(4)
    expect(bRuns, 'b should not run after watch is disposed').toBe(0)
  })

  // ─── 1.8 Dynamic subscription ──────────────────────────────────────────
  test('1.8 dynamic subscription: dependencies update across runs', () => {
    const flag = state(true)
    const a = state(1)
    const b = state(100)

    let lastValue = 0
    let runs = 0

    const dispose = watch(() => {
      runs++
      lastValue = flag() ? a() : b()
    })

    expect(lastValue).toBe(1)

    flag.set(false)
    expect(lastValue).toBe(100)

    runs = 0
    a.set(99)
    expect(runs, 'writing to no-longer-tracked source should not trigger').toBe(0)

    b.set(200)
    expect(runs, 'writing to current-path source triggers').toBe(1)
    expect(lastValue).toBe(200)

    dispose()
  })

  // ─── Bonus: write inside a derived computation is forbidden ─────────────
  test('charter: write during a derived computation throws', () => {
    const a = state(0)
    const bad = state(() => {
      a.set(1) // illegal
      return 0
    })
    expect(() => bad()).toThrow(/write during a derived/i)
  })
})
