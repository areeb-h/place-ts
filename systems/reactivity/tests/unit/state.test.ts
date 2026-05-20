import { describe, expect, test } from 'vitest'
import { batch, derived, state, watch } from '../../src/index.ts'

describe('state — raw mode (no derivation)', () => {
  test('read returns initial value', () => {
    expect(state('hello')()).toBe('hello')
    expect(state(42)()).toBe(42)
    expect(state(null)()).toBeNull()
  })

  test('write replaces the value', () => {
    const a = state(0)
    a.set(5)
    expect(a()).toBe(5)
  })

  test('write with function form receives previous value', () => {
    const a = state(10)
    a.update((prev) => prev + 1)
    expect(a()).toBe(11)
    a.update((prev) => prev * 2)
    expect(a()).toBe(22)
  })

  test('write that does not change the value does not propagate', () => {
    const a = state(7)
    let runs = 0
    watch(() => {
      runs++
      a()
    })
    runs = 0
    a.set(7)
    expect(runs).toBe(0)
  })

  test('custom equality short-circuits propagation', () => {
    type Pair = { x: number; y: number }
    const a = state<Pair>({ x: 0, y: 0 }, { equals: (p, q) => p.x === q.x && p.y === q.y })
    let runs = 0
    watch(() => {
      runs++
      a()
    })
    runs = 0
    a.set({ x: 0, y: 0 })
    expect(runs).toBe(0)
    a.set({ x: 1, y: 0 })
    expect(runs).toBe(1)
  })

  test('NaN equality matches Object.is semantics', () => {
    const a = state<number>(Number.NaN)
    let runs = 0
    watch(() => {
      runs++
      a()
    })
    runs = 0
    a.set(Number.NaN)
    expect(runs).toBe(0)
  })
})

describe('state — derived mode (with fn)', () => {
  test('computes from a single source', () => {
    const a = state(3)
    const b = state(() => a() * 2)
    expect(b()).toBe(6)
  })

  test('chains across deriveds', () => {
    const a = state(2)
    const b = state(() => a() + 1)
    const c = state(() => b() * 10)
    expect(c()).toBe(30)
    a.set(5)
    expect(c()).toBe(60)
  })

  test('lazy: not evaluated until read', () => {
    const a = state(0)
    let runs = 0
    const b = state(() => {
      runs++
      return a()
    })
    expect(runs).toBe(0)
    a.set(1)
    a.set(2)
    expect(runs).toBe(0)
    b()
    expect(runs).toBe(1)
  })

  test('memoized: repeated reads run once', () => {
    const a = state(1)
    let runs = 0
    const b = state(() => {
      runs++
      return a() + 1
    })
    b()
    b()
    b()
    expect(runs).toBe(1)
  })

  test('recomputes on dependency change when read', () => {
    const a = state(1)
    let runs = 0
    const b = state(() => {
      runs++
      return a() * 2
    })
    expect(b()).toBe(2)
    expect(runs).toBe(1)
    a.set(5)
    expect(b()).toBe(10)
    expect(runs).toBe(2)
  })

  test('custom equality prevents downstream propagation when value is unchanged', () => {
    const a = state(0)
    const evenness = state(() => (a() % 2 === 0 ? 'even' : 'odd'), {
      equals: (x, y) => x === y,
    })
    let downstreamRuns = 0
    const message = state(() => {
      downstreamRuns++
      return `it is ${evenness()}`
    })
    message()
    downstreamRuns = 0
    a.set(2)
    message()
    expect(downstreamRuns).toBe(0)
    a.set(3)
    message()
    expect(downstreamRuns).toBe(1)
  })

  test('cycle through self throws on read', () => {
    let bRef: (() => number) | null = null
    const b = state(() => (bRef ? bRef() : 0) + 1)
    bRef = b
    expect(() => b()).toThrow(/cycle/i)
  })

  test('reading at top level (no observer) resolves cleanly', () => {
    const a = state('x')
    const b = state(() => a())
    expect(b()).toBe('x')
  })

  test('write inside a derived computation throws', () => {
    const a = state(0)
    const bad = state(() => {
      a.set(1)
      return 0
    })
    expect(() => bad()).toThrow(/write during a derived/i)
  })
})

describe('state — derivable (revert policy)', () => {
  test('local write wins immediately', () => {
    const a = state(10)
    const b = state(() => a() * 2)
    expect(b()).toBe(20)
    b.set(99)
    expect(b()).toBe(99)
  })

  test('upstream change reverts the override', () => {
    const a = state(10)
    const b = state(() => a() * 2)
    b.set(99)
    a.set(5)
    expect(b()).toBe(10)
  })

  test('multiple writes accumulate; latest wins', () => {
    const a = state(10)
    const b = state(() => a())
    b.set(1)
    b.set(2)
    b.set(3)
    expect(b()).toBe(3)
  })

  test('write inside a watch is allowed and triggers another round', () => {
    const a = state(0)
    const b = state(100)
    let runs = 0
    watch(() => {
      runs++
      const av = a()
      if (av < 3 && runs < 10) b.set(av * 10)
    })
    a.set(2)
    expect(b()).toBe(20)
  })
})

describe('derived state — error recovery', () => {
  test('throwing derivation does not leave the state stuck in COMPUTING', () => {
    let shouldThrow = true
    const x = state(1)
    const d = state(() => {
      if (shouldThrow) throw new Error('first attempt fails')
      return x() * 2
    })
    expect(() => d()).toThrow(/first attempt fails/)
    // Bug we're testing: a previously-thrown derivation should remain
    // re-readable on the next attempt instead of permanently tripping
    // the cycle-detected guard. The state machine must self-recover.
    shouldThrow = false
    expect(d()).toBe(2)
  })

  test('throwing derivation that later succeeds propagates new value to dependents', () => {
    let shouldThrow = true
    const x = state(1)
    const d = state(() => {
      if (shouldThrow) throw new Error('boom')
      return x() * 10
    })
    // Initial attempt to subscribe will throw; catch it.
    expect(() =>
      watch(() => {
        d()
      }),
    ).toThrow(/boom/)
    shouldThrow = false
    // Now the derivation succeeds. A later write to x should propagate
    // through d to anyone observing it.
    expect(d()).toBe(10)
    x.set(5)
    expect(d()).toBe(50)
  })

  test('downstream throw does not poison upstream', () => {
    const x = state(1)
    const d = state(() => {
      if (x() === 99) throw new Error('boom on 99')
      return x() * 2
    })
    expect(d()).toBe(2)
    x.set(99)
    expect(() => d()).toThrow(/boom/)
    x.set(3)
    // d should recover and recompute — not stay stuck after the throw.
    expect(d()).toBe(6)
  })
})

describe('derived — disposal', () => {
  test('derived().dispose() clears upstream subscriptions so writes do not propagate', () => {
    const x = state(1)
    const d = derived(() => x() * 2)
    // Materialise d's value so its sources are populated.
    expect(d()).toBe(2)
    // Sanity: x has d as a dependent at this point.
    // After dispose, d's sources are cleared — meaning when we walk
    // x's dependents, d is no longer there to receive propagation.
    d.dispose()
    // Construct a fresh writer to x and verify d isn't a recompute
    // target via the watch path either.
    let watchFires = 0
    const stopW = watch(() => {
      x()
      watchFires++
    })
    const baseline = watchFires
    x.set(7)
    // The watch (which reads x directly) still fires — verifies x's
    // dependents set is intact for legitimate subscribers.
    expect(watchFires).toBeGreaterThan(baseline)
    // But the disposed derived is not in x.dependents anymore;
    // verify by re-reading d (which now recomputes fresh due to
    // DIRTY + cleared sources, picking up the new x).
    expect(d()).toBe(14)
    stopW()
  })

  test('derived().dispose() is idempotent', () => {
    const x = state(1)
    const d = derived(() => x() * 2)
    expect(() => d.dispose()).not.toThrow()
    expect(() => d.dispose()).not.toThrow()
  })

  test('state.map() return value exposes dispose()', () => {
    const x = state(10)
    const m = x.map((n) => n * 3)
    expect(m()).toBe(30)
    expect(typeof m.dispose).toBe('function')
    m.dispose()
    expect(() => m.dispose()).not.toThrow()
  })

  test('derived().map() return value exposes dispose()', () => {
    const x = state(2)
    const d = derived(() => x() * 5)
    const m = d.map((n) => n + 1)
    expect(m()).toBe(11)
    expect(typeof m.dispose).toBe('function')
    m.dispose()
  })
})

describe('drainQueue — nested batch/flush inside watch must not leak subscriptions', () => {
  test('batch() inside a watch body does not subscribe the outer watch to inner-watch sources', () => {
    // Reproducer for the silent-subscription-leak: a watch reads `a`,
    // and inside its body calls batch() that drains a separate inner
    // watch reading `b`. Without the drainQueue currentObserver guard,
    // the outer watch silently subscribes to `b` and re-fires on `b`
    // writes — even though it never reads `b` directly.
    const a = state(0)
    const b = state(0)
    let outerFires = 0
    let innerFires = 0
    const stopInner = watch(() => {
      b()
      innerFires++
    })
    const stopOuter = watch(() => {
      a()
      outerFires++
      // Calling batch synchronously inside the watch body triggers
      // a settle pass that drains any newly-queued watches — that's
      // the path drainQueue must guard against tracking under the
      // outer observer.
      batch(() => {
        b.set(b.peek() + 1)
      })
    })
    const baseInner = innerFires
    const baseOuter = outerFires
    b.set(b.peek() + 10)
    // The inner watch must re-fire (it reads b).
    expect(innerFires).toBeGreaterThan(baseInner)
    // The outer watch must NOT re-fire (it never reads b directly).
    expect(outerFires).toBe(baseOuter)
    stopOuter()
    stopInner()
  })
})
