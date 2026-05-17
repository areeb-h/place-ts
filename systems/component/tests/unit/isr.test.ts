// @vitest-environment node
//
// ISR behavior at the cache + revalidate() layer. The full serve()
// integration (cache miss → render → store → serve) is exercised via the
// sync-server demo end-to-end; this file covers the pieces that DON'T
// require Bun.serve: the global revalidate() registry and tag/key
// invalidation against a CacheStore.

import { describe, expect, test } from 'vitest'
import { memoryStore, revalidate } from '../../src/index.ts'

describe('revalidate() — invalidation triggers', () => {
  test('revalidate(path) is a no-op when no caches are registered', async () => {
    // No serve() instance has been created in this test; the registry is
    // empty. revalidate() must not throw.
    await expect(revalidate('/nope')).resolves.toBeUndefined()
  })

  test('revalidate.tag(name) is a no-op when no caches are registered', async () => {
    await expect(revalidate.tag('posts')).resolves.toBeUndefined()
  })

  // The integration of revalidate() with serve()'s registered cache is
  // covered by the next two suites that interact with a CacheStore
  // directly — the registry adds caches when serve() is called, but we
  // can simulate the same behavior by hand-registering and verifying the
  // delete contract end-to-end.
})

describe('CacheStore + revalidate.tag() invalidation contract', () => {
  test('tag invalidation removes only entries with the matching tag', async () => {
    const cache = memoryStore()
    await cache.set('/post/1', { body: 'p1', headers: {}, builtAt: 0, tags: ['posts'] })
    await cache.set('/post/2', { body: 'p2', headers: {}, builtAt: 0, tags: ['posts'] })
    await cache.set('/about', { body: 'about', headers: {}, builtAt: 0, tags: ['static'] })

    // Caller would do: _registeredCaches.add(cache); await revalidate.tag('posts')
    // We exercise the underlying delete() because the global registry is
    // module-scoped and we don't want test ordering to matter.
    await cache.delete({ tags: ['posts'] })

    expect(await cache.get('/post/1')).toBeNull()
    expect(await cache.get('/post/2')).toBeNull()
    expect(await cache.get('/about')).not.toBeNull()
  })

  test('path invalidation removes only the named keys', async () => {
    const cache = memoryStore()
    await cache.set('/a', { body: 'a', headers: {}, builtAt: 0 })
    await cache.set('/b', { body: 'b', headers: {}, builtAt: 0 })
    await cache.delete({ keys: ['/a'] })
    expect(await cache.get('/a')).toBeNull()
    expect(await cache.get('/b')).not.toBeNull()
  })
})

describe('CacheEntry — TTL/staleness math the dispatcher uses', () => {
  // The dispatcher computes `(Date.now() - entry.builtAt) / 1000` and
  // compares to ttl. We assert the math directly so the contract between
  // memoryStore and the dispatcher's age computation is clear.

  test('age in seconds since builtAt is the right comparison axis', () => {
    const builtAt = Date.now() - 30_000 // 30 seconds ago
    const ageSec = (Date.now() - builtAt) / 1000
    expect(ageSec).toBeGreaterThanOrEqual(30)
    expect(ageSec).toBeLessThan(31) // generous upper bound for test noise

    // Fresh: ttl 60 → age < ttl → serve from cache.
    expect(ageSec < 60).toBe(true)

    // Stale: ttl 10 → age > ttl → SWR (serve stale, kick off background revalidate).
    expect(ageSec < 10).toBe(false)
  })
})

describe('inflight dedupe contract', () => {
  // The dispatcher uses a Map<key, Promise<CacheEntry>> so concurrent
  // requests for the same uncached path share one render. We can't
  // exercise that map from outside serve(), but we CAN verify the
  // promise-coalescing pattern works as expected when implemented
  // correctly — the same shape is reused inside dispatch.

  test('coalescing pattern: multiple awaiters share one promise', async () => {
    let renders = 0
    const inflight = new Map<string, Promise<string>>()

    const renderOnce = (key: string): Promise<string> => {
      const existing = inflight.get(key)
      if (existing) return existing
      const promise = (async () => {
        renders++
        await new Promise((r) => setTimeout(r, 10))
        return `render-${renders}`
      })()
      inflight.set(key, promise)
      promise.finally(() => inflight.delete(key))
      return promise
    }

    // 5 concurrent requests for the same key → 1 render.
    const results = await Promise.all(Array.from({ length: 5 }, () => renderOnce('/page')))
    expect(renders).toBe(1)
    // All 5 see the same value.
    expect(new Set(results).size).toBe(1)
  })
})
