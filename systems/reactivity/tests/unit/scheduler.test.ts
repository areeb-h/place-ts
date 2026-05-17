// Phase 3 — scheduler primitives: batch, flush, state.peek(), watch defer.
//
// See systems/reactivity/docs/05-test-plan.md for the per-phase invariant
// ledger and docs/03-implementation-plan.md §Phase 3 for design rationale.

import { describe, expect, test } from 'vitest'
import { __internal, batch, flush, state, watch } from '../../src/index.ts'

describe('state.peek() — untracked read', () => {
  test('peek returns the current value', () => {
    const a = state(42)
    expect(a.peek()).toBe(42)
    a.set(7)
    expect(a.peek()).toBe(7)
  })

  test('peek inside a watch does not subscribe', () => {
    const a = state(0)
    let runs = 0
    watch(() => {
      runs++
      a.peek()
    })
    runs = 0
    a.set(1)
    a.set(2)
    expect(runs, 'peek should not have subscribed the watch').toBe(0)
  })

  test('peek inside a derived does not add a source', () => {
    const a = state(0)
    let runs = 0
    const b = state(() => {
      runs++
      return a.peek() + 1
    })
    expect(b()).toBe(1)
    runs = 0
    a.set(99)
    expect(b(), 'b should still report 1 — peek did not subscribe').toBe(1)
    expect(runs).toBe(0)
  })

  test('peek works on a derived state', () => {
    const a = state(10)
    const b = state(() => a() * 2)
    expect(b.peek()).toBe(20)
    a.set(5)
    expect(b.peek()).toBe(10)
  })

  test('peek does not interfere with surrounding tracking', () => {
    const a = state(0)
    const b = state(0)
    let runs = 0
    let lastA = -1
    watch(() => {
      runs++
      lastA = a()
      b.peek() // should not subscribe to b
    })
    runs = 0
    a.set(1)
    expect(runs).toBe(1)
    expect(lastA).toBe(1)
    runs = 0
    b.set(99)
    expect(runs, 'b is peeked, not tracked — write should not fire watch').toBe(0)
  })
})

describe('batch — defer watches until end', () => {
  test('multiple writes inside batch fire watches once at end', () => {
    const a = state(0)
    const b = state(0)
    let runs = 0
    watch(() => {
      runs++
      a()
      b()
    })
    runs = 0
    batch(() => {
      a.set(1)
      b.set(2)
      a.set(3)
    })
    expect(runs, 'one watch run for the whole batch').toBe(1)
  })

  test('batch returns fn return value', () => {
    const a = state(0)
    const result = batch(() => {
      a.set(5)
      return 'done'
    })
    expect(result).toBe('done')
    expect(a()).toBe(5)
  })

  test('nested batches only flush at outermost', () => {
    const a = state(0)
    let runs = 0
    watch(() => {
      runs++
      a()
    })
    runs = 0
    batch(() => {
      a.set(1)
      batch(() => {
        a.set(2)
        batch(() => {
          a.set(3)
        })
      })
    })
    expect(runs, 'nested batches collapse to one flush').toBe(1)
    expect(a()).toBe(3)
  })

  test('reads inside batch see written values immediately', () => {
    const a = state(0)
    let observed = -1
    batch(() => {
      a.set(5)
      observed = a() // sees own write within batch
    })
    expect(observed).toBe(5)
  })

  test('batch isolates failure: partial writes still propagate', () => {
    const a = state(0)
    let runs = 0
    watch(() => {
      runs++
      a()
    })
    runs = 0
    expect(() => {
      batch(() => {
        a.set(1)
        throw new Error('mid-batch')
      })
    }).toThrow('mid-batch')
    // After throw, batch unwinds, batchDepth back to 0; watches still see
    // the partial state (this matches Solid's behavior; Phase 5 transitions
    // will offer atomic semantics if needed).
    expect(a()).toBe(1)
    expect(runs).toBeGreaterThan(0)
  })
})

describe('flush — drain queues now', () => {
  test('flush is a no-op when nothing pending', () => {
    expect(() => flush()).not.toThrow()
  })

  test('flush drains the deferred queue synchronously', () => {
    const a = state(0)
    let runs = 0
    watch(
      () => {
        runs++
        a()
      },
      { defer: true },
    )
    runs = 0
    a.set(1)
    expect(runs, 'deferred — not yet').toBe(0)
    flush()
    expect(runs, 'flush drains it').toBe(1)
  })

  test('flush during batch is a no-op', () => {
    const a = state(0)
    let runs = 0
    watch(() => {
      runs++
      a()
    })
    runs = 0
    batch(() => {
      a.set(1)
      flush() // no-op inside batch
      expect(runs).toBe(0)
    })
    expect(runs, 'flush deferred to batch end').toBe(1)
  })
})

describe('watch with defer option', () => {
  test('deferred watch runs initially (synchronous on creation)', () => {
    const a = state(0)
    let runs = 0
    watch(
      () => {
        runs++
        a()
      },
      { defer: true },
    )
    expect(runs, 'first run is synchronous regardless of defer').toBe(1)
  })

  test('deferred watch defers re-runs to microtask', async () => {
    const a = state(0)
    let runs = 0
    watch(
      () => {
        runs++
        a()
      },
      { defer: true },
    )
    runs = 0
    a.set(1)
    expect(runs, 'not yet — deferred').toBe(0)
    await Promise.resolve()
    expect(runs, 'after microtask').toBe(1)
  })

  test('multiple writes coalesce into one deferred run', async () => {
    const a = state(0)
    let runs = 0
    let lastValue = -1
    watch(
      () => {
        runs++
        lastValue = a()
      },
      { defer: true },
    )
    runs = 0
    a.set(1)
    a.set(2)
    a.set(3)
    expect(runs).toBe(0)
    await Promise.resolve()
    expect(runs).toBe(1)
    expect(lastValue).toBe(3)
  })

  test('sync and deferred watches coexist', async () => {
    const a = state(0)
    let syncRuns = 0
    let deferredRuns = 0
    watch(() => {
      syncRuns++
      a()
    })
    watch(
      () => {
        deferredRuns++
        a()
      },
      { defer: true },
    )
    syncRuns = 0
    deferredRuns = 0
    a.set(1)
    expect(syncRuns, 'sync ran').toBe(1)
    expect(deferredRuns, 'deferred not yet').toBe(0)
    await Promise.resolve()
    expect(deferredRuns, 'deferred ran at microtask').toBe(1)
  })

  test('disposing a deferred watch removes it from the deferred queue', async () => {
    const a = state(0)
    let runs = 0
    const dispose = watch(
      () => {
        runs++
        a()
      },
      { defer: true },
    )
    runs = 0
    a.set(1)
    dispose()
    await Promise.resolve()
    expect(runs, 'disposed before microtask fired').toBe(0)
  })

  test('batch defers both sync and deferred watches together', async () => {
    const a = state(0)
    let syncRuns = 0
    let deferredRuns = 0
    watch(() => {
      syncRuns++
      a()
    })
    watch(
      () => {
        deferredRuns++
        a()
      },
      { defer: true },
    )
    syncRuns = 0
    deferredRuns = 0
    batch(() => {
      a.set(1)
      a.set(2)
      expect(syncRuns).toBe(0)
      expect(deferredRuns).toBe(0)
    })
    expect(syncRuns, 'sync ran at batch end').toBe(1)
    expect(deferredRuns, 'deferred ran at batch end too').toBe(1)
  })
})

describe('infinite-loop detection', () => {
  // Self-feedback within one watch (`a.set(a() + 1)`) AND
  // cross-watch mutual-feedback both eventually trip the round-limit.
  // The COMPUTING-state guard no longer silently drops a same-watch
  // re-trigger — it sets `needsRerun` so the re-runs settle, and the
  // round-limit is what bounds runaway loops. Errors fire the moment
  // the cycle actually executes (typically on the second watch's
  // creation, not on a later external trigger).

  test('mutual-feedback between watches triggers the round limit', () => {
    const a = state(0)
    const b = state(0)
    let counter = 0
    watch(() => {
      b.set(a() + ++counter) // monotonically changing — defeats equality short-circuit
    })
    // The second watch's initial run writes `a`, which schedules the
    // first watch via the now-correct re-queue path. The first watch
    // writes `b`, scheduling the second. The drain loop ping-pongs
    // until the round limit fires.
    expect(() => {
      watch(() => {
        a.set(b() + 1)
      })
    }).toThrow(/scheduler did not settle/i)
  })

  test('the limit error message includes diagnosis hint', () => {
    const a = state(0)
    const b = state(0)
    let counter = 0
    watch(() => {
      b.set(a() + ++counter)
    })
    let captured: Error | null = null
    try {
      watch(() => {
        a.set(b() + 1)
      })
    } catch (e) {
      captured = e as Error
    }
    expect(captured?.message).toMatch(/watch writes to a state/i)
  })

  test('a watch that writes to a state it reads does NOT re-trigger itself', () => {
    // Auto-untrack-self-write semantics. Reading `x` then writing `x`
    // inside the same watch updates the state but does NOT re-fire this
    // watch — the watch has already observed the new value via its own
    // write. Other observers of `x` still see the change.
    const x = state(1)
    let runs = 0
    const stop = watch(() => {
      runs++
      const v = x()
      if (v < 3) x.set(v + 1)
    })
    expect(x()).toBe(2) // one write happened during the first (and only) run
    expect(runs).toBe(1) // watch did NOT self-trigger
    // External writes still re-fire the watch normally:
    x.set(0)
    expect(runs).toBe(2)
    stop()
  })

  test('self-feedback within one watch does NOT trip the round limit', () => {
    // The auto-untrack-self-write rule eliminates the round-limit
    // failure mode for this specific footgun. The watch runs once;
    // its single write updates `a`; no infinite loop.
    const a = state(0)
    let runs = 0
    const stop = watch(() => {
      runs++
      a.set(a() + 1)
    })
    expect(a()).toBe(1)
    expect(runs).toBe(1)
    stop()
  })
})

describe('scheduler internals (test-only hooks)', () => {
  test('batchDepth tracking', () => {
    expect(__internal.batchDepth()).toBe(0)
    batch(() => {
      expect(__internal.batchDepth()).toBe(1)
      batch(() => {
        expect(__internal.batchDepth()).toBe(2)
      })
      expect(__internal.batchDepth()).toBe(1)
    })
    expect(__internal.batchDepth()).toBe(0)
  })

  test('queues drain after settled', async () => {
    const a = state(0)
    watch(() => {
      a()
    })
    watch(
      () => {
        a()
      },
      { defer: true },
    )
    a.set(1)
    expect(__internal.hasPendingSync()).toBe(false)
    await Promise.resolve()
    expect(__internal.hasPendingDeferred()).toBe(false)
  })
})
