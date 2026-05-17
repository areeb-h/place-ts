// Phase 2 invariants — derivable state with `revert` policy.
// See docs/05-test-plan.md §Phase 2.
//
// `state(() => upstream)` is derivable AND writable. Local writes win until
// the next time an upstream source actually changes value, at which point the
// derivation regains control. This is the "revert" policy — the default and
// (at v0.1) the only policy that ships. Rebase and permanent are deferred.

import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { state, watch } from '../../src/index.ts'

describe('Phase 2: derivable state — revert policy', () => {
  // ─── 2.1 After local write, read returns local value ──────────────────
  test('2.1 local write wins until upstream changes', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), (upstream, override) => {
        const a = state(upstream)
        const b = state(() => a() * 2)
        b() // prime
        b.set(override)
        expect(b()).toBe(override)
      }),
      { numRuns: 50 },
    )
  })

  // ─── 2.2 When upstream changes, local override is discarded ────────────
  test('2.2 upstream change discards local override (revert)', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer(), fc.integer(), (upstream, override, next) => {
        fc.pre(upstream !== next)
        const a = state(upstream)
        const b = state(() => a() * 2)
        b()
        b.set(override)
        expect(b()).toBe(override)
        a.set(next)
        expect(b(), 'override discarded; derivation wins').toBe(next * 2)
      }),
      { numRuns: 50 },
    )
  })

  // ─── 2.3 Local write is observable in any watch that runs between ──────
  test('2.3 local write is observable to watches that run between write and revert', () => {
    const a = state(0)
    const b = state(() => a() + 1)
    const observed: number[] = []
    const dispose = watch(() => {
      observed.push(b())
    })
    observed.length = 0
    b.set(99)
    expect(observed).toContain(99)
    dispose()
  })

  // ─── 2.4 Local write persists until upstream change ────────────────────
  test('2.4 multiple reads after a local write all see the override', () => {
    const a = state(10)
    const b = state(() => a() * 2)
    b()
    b.set(7)
    expect(b()).toBe(7)
    expect(b()).toBe(7)
    expect(b()).toBe(7)
  })

  test('2.4 unrelated reads to other states do not invalidate the override', () => {
    const a = state(10)
    const c = state(100)
    const b = state(() => a() * 2)
    b()
    b.set(7)
    c.set(200) // unrelated
    expect(b()).toBe(7)
  })

  // ─── 2.x writing the same value as the derived value is a no-op ────────
  test('writing the current derived value sets override, but is value-identical', () => {
    const a = state(5)
    const b = state(() => a() * 2) // = 10
    expect(b()).toBe(10)
    let watchRuns = 0
    const dispose = watch(() => {
      watchRuns++
      b()
    })
    watchRuns = 0
    b.set(10) // value identical
    expect(watchRuns, 'no-op write should not trigger watches').toBe(0)
    dispose()
  })

  // ─── 2.x function form on derived state uses current effective value ───
  test('write(prev => next) receives the current effective value', () => {
    const a = state(10)
    const b = state(() => a() * 2) // = 20
    b()
    b.update((prev) => prev + 1) // 20 + 1 = 21
    expect(b()).toBe(21)
    a.set(100)
    expect(b(), 'reverts to derived').toBe(200)
  })

  // ─── 2.x raw state has no override behavior ────────────────────────────
  test('raw state writes are immediate; no override semantics apply', () => {
    const a = state(0)
    a.set(5)
    expect(a()).toBe(5)
    a.set(10)
    expect(a()).toBe(10)
  })

  // ─── 2.x writing to a derived state without ever reading first ─────────
  test('write to derived state before first read sets override', () => {
    const a = state(10)
    const b = state(() => a() * 2)
    b.set(99) // never read first
    expect(b()).toBe(99) // override wins
    a.set(5)
    expect(b(), 'upstream change reverts').toBe(10)
  })

  // ─── 2.x downstream watchers see writes that change effective value ────
  test('downstream watch fires when override differs from previous effective value', () => {
    const a = state(10)
    const b = state(() => a() * 2) // = 20
    let observed = -1
    const dispose = watch(() => {
      observed = b()
    })
    expect(observed).toBe(20)
    b.set(7)
    expect(observed).toBe(7)
    a.set(100)
    expect(observed).toBe(200)
    dispose()
  })
})
