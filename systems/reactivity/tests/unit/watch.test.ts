import { describe, expect, test } from 'vitest'
import { __internal, state, watch } from '../../src/index.ts'

describe('watch', () => {
  test('runs once on creation', () => {
    let runs = 0
    watch(() => {
      runs++
    })
    expect(runs).toBe(1)
  })

  test('captures initial dependencies on first run', () => {
    const a = state(0)
    let observed = -1
    watch(() => {
      observed = a()
    })
    expect(observed).toBe(0)
    a.set(7)
    expect(observed).toBe(7)
  })

  test('disposing prevents further runs', () => {
    const a = state(0)
    let runs = 0
    const dispose = watch(() => {
      runs++
      a()
    })
    runs = 0
    a.set(1)
    expect(runs).toBe(1)
    dispose()
    a.set(2)
    a.set(3)
    expect(runs).toBe(1)
  })

  test('disposing twice is idempotent', () => {
    const a = state(0)
    const dispose = watch(() => {
      a()
    })
    dispose()
    dispose()
    a.set(1)
    expect(true).toBe(true)
  })

  test('disposing during a run leaves no pending state', () => {
    const a = state(0)
    let dispose: () => void = () => {}
    let runs = 0
    dispose = watch(() => {
      runs++
      const v = a()
      if (v === 99) dispose()
    })
    a.set(99)
    expect(runs).toBe(2)
    a.set(100)
    a.set(101)
    expect(runs).toBe(2)
    expect(__internal.hasPendingSync()).toBe(false)
    expect(__internal.hasPendingDeferred()).toBe(false)
  })

  test('multiple watches on the same source run independently', () => {
    const a = state(0)
    let r1 = 0
    let r2 = 0
    const d1 = watch(() => {
      r1++
      a()
    })
    const d2 = watch(() => {
      r2++
      a()
    })
    r1 = 0
    r2 = 0
    a.set(1)
    expect(r1).toBe(1)
    expect(r2).toBe(1)
    d1()
    a.set(2)
    expect(r1).toBe(1)
    expect(r2).toBe(2)
    d2()
  })

  test('watch on a derived chain re-runs only when transitive value changes', () => {
    const a = state(0)
    const evenness = state(() => (a() % 2 === 0 ? 'even' : 'odd'))
    let runs = 0
    let last = ''
    watch(() => {
      runs++
      last = evenness()
    })
    runs = 0
    a.set(2)
    expect(runs).toBe(0)
    expect(last).toBe('even')
    a.set(3)
    expect(runs).toBe(1)
    expect(last).toBe('odd')
  })

  test('write inside a watch schedules another round', () => {
    const a = state(0)
    const b = state(0)
    watch(() => {
      const av = a()
      if (av < 5) b.set(av)
    })
    a.set(3)
    expect(b()).toBe(3)
    a.set(7)
    expect(b()).toBe(3)
  })
})
