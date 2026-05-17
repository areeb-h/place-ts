import { describe, expect, test } from 'vitest'
import { flush, resource, state, watch } from '../../src/index.ts'

// Small helper: yield a microtask so promise resolutions settle.
const tick = () => Promise.resolve()

describe('resource — async-as-pending primitive', () => {
  test('starts in loading state synchronously', () => {
    const r = resource(() => Promise.resolve(42))
    expect(r.status()).toEqual({ state: 'loading' })
    expect(r.loading()).toBe(true)
    expect(r()).toBeUndefined()
    expect(r.error()).toBeUndefined()
    r.dispose()
  })

  test('transitions to ready on resolve', async () => {
    const r = resource(() => Promise.resolve(42))
    await tick()
    expect(r.status()).toEqual({ state: 'ready', value: 42 })
    expect(r.loading()).toBe(false)
    expect(r()).toBe(42)
    expect(r.error()).toBeUndefined()
    r.dispose()
  })

  test('transitions to error on reject', async () => {
    const oops = new Error('boom')
    const r = resource(() => Promise.reject(oops))
    await tick()
    expect(r.status()).toEqual({ state: 'error', error: oops })
    expect(r.loading()).toBe(false)
    expect(r()).toBeUndefined()
    expect(r.error()).toBe(oops)
    r.dispose()
  })

  test('synchronous throw in loader → error state', async () => {
    const oops = new Error('sync-boom')
    const r = resource<number>(() => {
      throw oops
    })
    // Sync throws are caught inside refresh and surface immediately —
    // no microtask wait needed.
    expect(r.status()).toEqual({ state: 'error', error: oops })
    r.dispose()
  })

  test('refresh re-runs the loader', async () => {
    let n = 0
    const r = resource(() => Promise.resolve(++n))
    await tick()
    expect(r()).toBe(1)
    await r.refresh()
    expect(r()).toBe(2)
    await r.refresh()
    expect(r()).toBe(3)
    r.dispose()
  })

  test('refresh flips back to loading before resolving', async () => {
    let resolveFn: ((v: number) => void) | undefined
    const r = resource(
      () =>
        new Promise<number>((resolve) => {
          resolveFn = resolve
        }),
    )
    expect(r.loading()).toBe(true)
    resolveFn?.(1)
    await tick()
    expect(r.status()).toEqual({ state: 'ready', value: 1 })

    const refreshed = r.refresh()
    expect(r.loading()).toBe(true)
    resolveFn?.(2)
    await refreshed
    expect(r.status()).toEqual({ state: 'ready', value: 2 })
    r.dispose()
  })

  test('stale resolution does not clobber a newer fetch', async () => {
    const resolvers: ((v: number) => void)[] = []
    const r = resource(
      () =>
        new Promise<number>((resolve) => {
          resolvers.push(resolve)
        }),
    )
    // Trigger a refresh while the first fetch is in flight.
    void r.refresh()
    expect(resolvers.length).toBe(2)

    // Resolve the SECOND (newer) fetch first, then the older one.
    resolvers[1]?.(99)
    await tick()
    expect(r()).toBe(99)

    // Older fetch resolves with 1 — must be ignored.
    resolvers[0]?.(1)
    await tick()
    expect(r()).toBe(99)

    r.dispose()
  })

  test('auto-refetches when a tracked source changes', async () => {
    const id = state('a')
    const fetched: string[] = []
    const r = resource(() => {
      const cur = id()
      fetched.push(cur)
      return Promise.resolve(`note-${cur}`)
    })
    await tick()
    expect(r()).toBe('note-a')
    expect(fetched).toEqual(['a'])

    id.set('b')
    flush()
    await tick()
    expect(r()).toBe('note-b')
    expect(fetched).toEqual(['a', 'b'])

    r.dispose()
  })

  test('dispose stops auto-refetch but refresh still works', async () => {
    const id = state(0)
    const fetched: number[] = []
    const r = resource(() => {
      const cur = id()
      fetched.push(cur)
      return Promise.resolve(cur * 10)
    })
    await tick()
    expect(fetched).toEqual([0])

    r.dispose()
    id.set(1)
    flush()
    await tick()
    // dep change should NOT trigger a fetch after dispose
    expect(fetched).toEqual([0])

    // explicit refresh still works
    await r.refresh()
    expect(fetched).toEqual([0, 1])
  })

  test('reactive consumers re-run on status transitions', async () => {
    const r = resource(() => Promise.resolve('hi'))
    const seen: string[] = []
    const stop = watch(() => {
      seen.push(r.status().state)
    })
    expect(seen).toEqual(['loading'])

    await tick()
    flush()
    expect(seen).toEqual(['loading', 'ready'])

    await r.refresh()
    flush()
    // 'loading' → 'ready' adds two more entries
    expect(seen.slice(-2)).toEqual(['loading', 'ready'])

    stop()
    r.dispose()
  })

  test('read / loading / error are independently reactive views of status', async () => {
    const r = resource(() => Promise.resolve(7))
    let v: number | undefined
    let l = false
    const stopV = watch(() => {
      v = r()
    })
    const stopL = watch(() => {
      l = r.loading()
    })
    expect(v).toBeUndefined()
    expect(l).toBe(true)

    await tick()
    flush()
    expect(v).toBe(7)
    expect(l).toBe(false)

    stopV()
    stopL()
    r.dispose()
  })

  test('dispose invalidates in-flight fetches — late resolutions do not write status', async () => {
    let resolveFn: ((v: number) => void) | undefined
    const r = resource(
      () =>
        new Promise<number>((resolve) => {
          resolveFn = resolve
        }),
    )
    expect(r.loading()).toBe(true)

    r.dispose()
    // Now the fetch is in flight but the resource is disposed. A late
    // resolution must not write to status — semantically the resource
    // is "torn down". Without the dispose-token-bump fix, the status
    // would transition to 'ready' here.
    resolveFn?.(42)
    await tick()
    expect(r.status()).toEqual({ state: 'loading' })
    expect(r()).toBeUndefined()
  })

  test('refresh aborts the previous in-flight fetch', async () => {
    const aborts: boolean[] = []
    let counter = 0
    const r = resource(
      (signal) =>
        new Promise<number>((resolve) => {
          const id = ++counter
          signal.addEventListener('abort', () => aborts.push(true))
          // Resolve after the test triggers refresh — only the latest
          // call wins.
          setTimeout(() => resolve(id), 5)
        }),
    )
    void r.refresh()
    void r.refresh()
    await new Promise((r) => setTimeout(r, 20))
    // Two aborts: the initial fetch was aborted by the first refresh,
    // and the first refresh's fetch was aborted by the second refresh.
    expect(aborts.length).toBeGreaterThanOrEqual(2)
    // Final status reflects the latest call (id=3).
    expect(r()).toBe(3)
    r.dispose()
  })

  test('dispose aborts the in-flight fetch via the signal', () => {
    const aborts: boolean[] = []
    const r = resource(
      (signal) =>
        new Promise<number>(() => {
          signal.addEventListener('abort', () => aborts.push(true))
        }),
    )
    expect(aborts.length).toBe(0)
    r.dispose()
    expect(aborts.length).toBe(1)
  })

  test('AbortError from the aborted fetch does not surface as an error', async () => {
    const r = resource(
      (signal) =>
        new Promise<number>((_, reject) => {
          signal.addEventListener('abort', () => {
            // Simulate fetch's behavior: reject with an AbortError
            // when the signal fires.
            reject(new DOMException('Aborted', 'AbortError'))
          })
        }),
    )
    void r.refresh()
    await tick()
    // Before any fetch settles, the previous one's AbortError must
    // not have been written to status.
    expect(r.status().state).toBe('loading')
    r.dispose()
  })

  test('dispose invalidates a rejected in-flight fetch too', async () => {
    let rejectFn: ((reason: unknown) => void) | undefined
    const r = resource(
      () =>
        new Promise<number>((_, reject) => {
          rejectFn = reject
        }),
    )

    r.dispose()
    rejectFn?.(new Error('late rejection'))
    await tick()
    expect(r.error()).toBeUndefined()
    expect(r.status()).toEqual({ state: 'loading' })
  })
})
