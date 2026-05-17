// @vitest-environment node

import { describe, expect, test } from 'vitest'
import { defineCapability, runWithCapabilityScope } from '../../../capability/src/index.ts'
import { cache, memoryStore } from '../../src/cache.ts'
import { revalidate } from '../../src/index.ts'

describe('memoryStore — in-process cache backend', () => {
  test('get returns null for missing keys', async () => {
    const s = memoryStore()
    expect(await s.get('/missing')).toBeNull()
  })

  test('set then get round-trips the entry', async () => {
    const s = memoryStore()
    const entry = { body: '<html>hi</html>', headers: {}, builtAt: 100 }
    await s.set('/page', entry)
    const got = await s.get('/page')
    expect(got).toEqual(entry)
  })

  test('overwriting a key replaces the entry', async () => {
    const s = memoryStore()
    await s.set('/page', { body: 'v1', headers: {}, builtAt: 100 })
    await s.set('/page', { body: 'v2', headers: {}, builtAt: 200 })
    expect((await s.get('/page'))?.body).toBe('v2')
  })

  test('delete by exact keys removes only those entries', async () => {
    const s = memoryStore()
    await s.set('/a', { body: 'a', headers: {}, builtAt: 0 })
    await s.set('/b', { body: 'b', headers: {}, builtAt: 0 })
    await s.set('/c', { body: 'c', headers: {}, builtAt: 0 })
    await s.delete({ keys: ['/a', '/c'] })
    expect(await s.get('/a')).toBeNull()
    expect(await s.get('/b')).not.toBeNull()
    expect(await s.get('/c')).toBeNull()
  })

  test('delete by tag invalidates every entry carrying that tag', async () => {
    const s = memoryStore()
    await s.set('/post/1', { body: '1', headers: {}, builtAt: 0, tags: ['posts'] })
    await s.set('/post/2', { body: '2', headers: {}, builtAt: 0, tags: ['posts', 'featured'] })
    await s.set('/about', { body: 'about', headers: {}, builtAt: 0, tags: ['static'] })
    await s.delete({ tags: ['posts'] })
    expect(await s.get('/post/1')).toBeNull()
    expect(await s.get('/post/2')).toBeNull()
    expect(await s.get('/about')).not.toBeNull()
  })

  test('delete by tag matches even one tag from a multi-tag entry', async () => {
    const s = memoryStore()
    await s.set('/x', { body: 'x', headers: {}, builtAt: 0, tags: ['a', 'b', 'c'] })
    await s.delete({ tags: ['b'] })
    expect(await s.get('/x')).toBeNull()
  })

  test('delete with both keys AND tags applies the union', async () => {
    const s = memoryStore()
    await s.set('/a', { body: 'a', headers: {}, builtAt: 0 })
    await s.set('/b', { body: 'b', headers: {}, builtAt: 0, tags: ['rss'] })
    await s.set('/c', { body: 'c', headers: {}, builtAt: 0 })
    await s.delete({ keys: ['/a'], tags: ['rss'] })
    expect(await s.get('/a')).toBeNull()
    expect(await s.get('/b')).toBeNull()
    expect(await s.get('/c')).not.toBeNull()
  })

  test('delete with no filter clears everything', async () => {
    const s = memoryStore()
    await s.set('/a', { body: 'a', headers: {}, builtAt: 0 })
    await s.set('/b', { body: 'b', headers: {}, builtAt: 0 })
    await s.delete({})
    expect(await s.get('/a')).toBeNull()
    expect(await s.get('/b')).toBeNull()
  })

  test('delete with empty arrays is a no-op', async () => {
    const s = memoryStore()
    await s.set('/a', { body: 'a', headers: {}, builtAt: 0 })
    await s.delete({ keys: [], tags: [] })
    expect(await s.get('/a')).not.toBeNull()
  })

  test('preserves Uint8Array bodies (image cache use case)', async () => {
    const s = memoryStore()
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG header
    await s.set('/img/cover.jpg?w=800', {
      body: bytes,
      headers: { 'Content-Type': 'image/png' },
      builtAt: 0,
    })
    const got = await s.get('/img/cover.jpg?w=800')
    expect(got?.body).toBe(bytes)
    expect(got?.headers['Content-Type']).toBe('image/png')
  })
})

describe('cache(fn) — opt-in function-level memoization', () => {
  test('memoizes results: second call with same args returns cached value', async () => {
    let calls = 0
    const f = cache(async (n: number) => {
      calls++
      return n * 2
    })
    expect(await f(3)).toBe(6)
    expect(await f(3)).toBe(6)
    expect(calls).toBe(1)
  })

  test('different args → different cache entries', async () => {
    let calls = 0
    const f = cache(async (n: number) => {
      calls++
      return n * 2
    })
    expect(await f(3)).toBe(6)
    expect(await f(4)).toBe(8)
    expect(await f(3)).toBe(6)
    expect(calls).toBe(2)
  })

  test('TTL: stale entry recomputes', async () => {
    let calls = 0
    const f = cache(
      async (n: number) => {
        calls++
        return n * 2
      },
      { ttl: 0.05 }, // 50ms
    )
    await f(3)
    await f(3)
    expect(calls).toBe(1)
    await new Promise((r) => setTimeout(r, 70))
    await f(3)
    expect(calls).toBe(2)
  })

  test('inflight dedupe: 10 concurrent calls share one execution', async () => {
    let calls = 0
    let resolveFn: (v: number) => void = () => {}
    const f = cache(async (n: number) => {
      calls++
      return new Promise<number>((r) => {
        resolveFn = r
      }).then(() => n * 2)
    })
    const promises = Array.from({ length: 10 }, () => f(3))
    // All 10 are in-flight, sharing one fn call.
    expect(calls).toBe(1)
    resolveFn(0)
    const results = await Promise.all(promises)
    expect(results.every((r) => r === 6)).toBe(true)
    expect(calls).toBe(1)
  })

  test('throws are NOT cached (next call retries)', async () => {
    let calls = 0
    const f = cache(async () => {
      calls++
      if (calls === 1) throw new Error('first try')
      return 'ok'
    })
    await expect(f()).rejects.toThrow('first try')
    expect(await f()).toBe('ok')
    expect(calls).toBe(2)
  })

  test('custom key fn: only the first arg participates', async () => {
    let calls = 0
    const f = cache(
      async (id: string, _opts: { trace?: boolean }) => {
        calls++
        return `user:${id}`
      },
      { key: (id) => id },
    )
    await f('a', { trace: true })
    await f('a', { trace: false })
    await f('a', {})
    expect(calls).toBe(1)
  })

  test('tags: revalidate.tag() clears matching entries', async () => {
    let userCalls = 0
    let postCalls = 0
    const getUser = cache(async (id: string) => `user:${id}:${++userCalls}`, {
      tags: ['user'],
    })
    const getPost = cache(async (id: string) => `post:${id}:${++postCalls}`, {
      tags: ['post'],
    })
    expect(await getUser('a')).toBe('user:a:1')
    expect(await getPost('p')).toBe('post:p:1')
    // Hit the cache — no recomputation.
    expect(await getUser('a')).toBe('user:a:1')
    expect(await getPost('p')).toBe('post:p:1')
    // Invalidate just the user cache.
    await revalidate.tag('user')
    expect(await getUser('a')).toBe('user:a:2')
    // Post cache untouched.
    expect(await getPost('p')).toBe('post:p:1')
  })

  test('sync fn: works (wrapped in Promise.resolve internally)', async () => {
    let calls = 0
    const f = cache((n: number) => {
      calls++
      return n + 1
    })
    expect(await f(3)).toBe(4)
    expect(await f(3)).toBe(4)
    expect(calls).toBe(1)
  })

  test('regression: invalidation mid-flight does NOT re-cache the stale result', async () => {
    // Stale-write race: a fetch starts, invalidation fires before it
    // resolves, the stale promise should NOT populate the cache after
    // resolution. Was a real bug — the in-flight promise captured the
    // generation; mismatch on resolve skips the write.
    let calls = 0
    let resolveFirst: (v: string) => void = () => {}
    const f = cache(
      async (id: string): Promise<string> => {
        calls++
        if (calls === 1)
          return new Promise<string>((r) => {
            resolveFirst = r
          })
        return `fresh:${id}`
      },
      { tags: ['user'] },
    )
    // Start in-flight fetch.
    const p1 = f('a')
    expect(calls).toBe(1)
    // Invalidate mid-flight.
    await revalidate.tag('user')
    // Resolve the (now-stale) first promise. Per the contract, the
    // promise itself still resolves with whatever fn returned — we
    // can't cancel it — but it should NOT populate the cache.
    resolveFirst('stale:a')
    expect(await p1).toBe('stale:a')
    // Next call must trigger a fresh fetch (the post-invalidation
    // state is empty), not return the just-resolved stale value.
    const p2 = f('a')
    expect(calls).toBe(2)
    expect(await p2).toBe('fresh:a')
  })

  test('undefined return value is cached and re-served', async () => {
    let calls = 0
    const f = cache(async (): Promise<undefined> => {
      calls++
      return undefined
    })
    expect(await f()).toBeUndefined()
    expect(await f()).toBeUndefined()
    expect(calls).toBe(1)
  })
})

describe('cache(fn) — capability-scope isolation prevents auth-context bleed', () => {
  // Per-request capabilities (Session, Router, etc.) installed inside a
  // request handler must NOT be visible inside a cached fn, otherwise a
  // user's session could leak into another user's cache hit. Structural
  // fix: cache(fn) runs `fn` in `runWithCapabilityScope` so per-request
  // caps are isolated and only module-level (cross-request) baseline
  // caps remain visible.

  test('per-request cap installed inside the request is NOT visible inside cache(fn)', async () => {
    const SessionCap = defineCapability<{ user: string }>('SessionCap')
    let captured: { user: string } | null = null
    const cachedRead = cache(async () => {
      captured = SessionCap.tryUse() // null = absent
      return captured
    })
    // Simulate a request handler that installs a session cap.
    await runWithCapabilityScope(async () => {
      const dispose = SessionCap.install({ user: 'alice' })
      try {
        await cachedRead()
      } finally {
        dispose()
      }
    })
    expect(captured).toBeNull()
  })

  test('module-level baseline cap IS visible inside cache(fn) (cross-request defaults)', async () => {
    const FlagCap = defineCapability<{ enabled: boolean }>('FlagCap')
    // Module-level install (cross-request baseline).
    const dispose = FlagCap.install({ enabled: true })
    try {
      let captured: { enabled: boolean } | null = null
      const cachedRead = cache(async () => {
        captured = FlagCap.tryUse()
        return captured
      })
      await runWithCapabilityScope(async () => {
        await cachedRead()
      })
      expect(captured).toEqual({ enabled: true })
    } finally {
      dispose()
    }
  })

  test('SessionCap.use() inside cache(fn) throws with the cache-fix hint', async () => {
    const SessionCap = defineCapability<{ user: string }>('SessionCap2')
    const cachedRead = cache(async () => SessionCap.use())
    await runWithCapabilityScope(async () => {
      const dispose = SessionCap.install({ user: 'alice' })
      try {
        // Catch + inspect message directly. `expect.rejects.toThrow(regex)`
        // has divergent matching semantics between vitest and bun:test
        // for multi-line messages; explicit catch is portable.
        let captured: Error | null = null
        try {
          await cachedRead()
        } catch (e) {
          captured = e as Error
        }
        expect(captured).not.toBeNull()
        // The cache(fn) wrapper augments cap-not-installed errors with
        // a fix hint pointing at the real cause.
        expect(captured?.message).toContain("aren't visible inside cache(fn)")
      } finally {
        dispose()
      }
    })
  })

  test('SessionCap.tryUse() inside cache(fn) returns null (no throw, cap absent)', async () => {
    const SessionCap = defineCapability<{ user: string }>('SessionCap3')
    const cachedRead = cache(async () => SessionCap.tryUse())
    let result: unknown = 'unset'
    await runWithCapabilityScope(async () => {
      const dispose = SessionCap.install({ user: 'alice' })
      try {
        result = await cachedRead()
      } finally {
        dispose()
      }
    })
    expect(result).toBeNull()
  })

  test('two requests with different sessions do not share cached results', async () => {
    const SessionCap = defineCapability<{ user: string }>('SessionCap4')
    // Cache by username explicitly so the test isolates the leak vector
    // (without an explicit key, cache memoizes by JSON.stringify(args)).
    const cachedFor = cache(
      async (username: string) => {
        // If SessionCap leaked, this would read alice's session in bob's
        // call. Structural isolation prevents it.
        const session = SessionCap.tryUse()
        return { username, sessionUser: session?.user ?? null }
      },
      { key: (u) => u },
    )
    const aliceResult = await runWithCapabilityScope(async () => {
      const dispose = SessionCap.install({ user: 'alice' })
      try {
        return cachedFor('alice')
      } finally {
        dispose()
      }
    })
    const bobResult = await runWithCapabilityScope(async () => {
      const dispose = SessionCap.install({ user: 'bob' })
      try {
        return cachedFor('bob')
      } finally {
        dispose()
      }
    })
    // Both are null: cache(fn) doesn't see the per-request caps. The
    // app-author is forced to pass the user as an argument (which we do
    // here as `username`), so the cache key correctly differentiates.
    expect(aliceResult.sessionUser).toBeNull()
    expect(bobResult.sessionUser).toBeNull()
    expect(aliceResult.username).toBe('alice')
    expect(bobResult.username).toBe('bob')
  })

  test('cap reads OUTSIDE cache(fn) continue to work normally (regression guard)', async () => {
    const SessionCap = defineCapability<{ user: string }>('SessionCap5')
    let outside: { user: string } | null = null
    await runWithCapabilityScope(async () => {
      const dispose = SessionCap.install({ user: 'alice' })
      try {
        outside = SessionCap.use()
      } finally {
        dispose()
      }
    })
    expect(outside).toEqual({ user: 'alice' })
  })
})
