// @vitest-environment happy-dom

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { PersistenceAdapter } from '../../src/index.ts'
import {
  crossTabAdapter,
  indexedDBAdapter,
  localStorageAdapter,
  memoryAdapter,
  persistedState,
  serverAdapter,
} from '../../src/index.ts'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

// Poll until `cond` returns true, up to `timeoutMs`. Used for cross-tab
// tests because Node's BroadcastChannel delivers messages on its own
// schedule (worker_threads-backed) — a single `setTimeout(0)` isn't a
// reliable signal that the message has arrived. Polling fixes the flake
// at its actual cause without weakening the assertion.
const waitFor = async (cond: () => boolean, timeoutMs = 200): Promise<void> => {
  const start = Date.now()
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise<void>((r) => setTimeout(r, 1))
  }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('memoryAdapter', () => {
  test('returns initial when nothing saved', () => {
    const a = memoryAdapter(42)
    expect(a.load()).toBe(42)
  })

  test('save / load round-trips', () => {
    const a = memoryAdapter(0)
    a.save(7)
    expect(a.load()).toBe(7)
  })
})

describe('localStorageAdapter', () => {
  test('returns default when key absent', () => {
    const a = localStorageAdapter('test:key', 'default')
    expect(a.load()).toBe('default')
  })

  test('round-trips a string', () => {
    const a = localStorageAdapter('test:key', 'default')
    a.save('hello')
    expect(a.load()).toBe('hello')
    expect(localStorage.getItem('test:key')).toBe('"hello"')
  })

  test('round-trips a complex object', () => {
    type Note = { id: string; title: string; tags: string[] }
    const a = localStorageAdapter<Note[]>('test:notes', [])
    a.save([{ id: '1', title: 'first', tags: ['x'] }])
    expect(a.load()).toEqual([{ id: '1', title: 'first', tags: ['x'] }])
  })

  test('returns default on corrupt JSON', () => {
    localStorage.setItem('test:bad', '{not valid json')
    const a = localStorageAdapter('test:bad', { ok: true })
    expect(a.load()).toEqual({ ok: true })
  })

  test('custom serialize / deserialize', () => {
    const a = localStorageAdapter<Date>('test:date', new Date(0), {
      serialize: (d) => String(d.getTime()),
      deserialize: (raw) => new Date(Number(raw)),
    })
    const d = new Date('2026-05-01T00:00:00Z')
    a.save(d)
    expect(a.load().getTime()).toBe(d.getTime())
  })

  test('falls back to default if storage unavailable', () => {
    const a = localStorageAdapter('test:key', 'default', {
      storage: undefined as never,
    })
    expect(a.load()).toBe('default')
    expect(() => a.save('x')).not.toThrow()
  })
})

describe('persistedState', () => {
  test('initializes from adapter', () => {
    const a = memoryAdapter(99)
    const { state, dispose } = persistedState(a)
    expect(state.read()).toBe(99)
    dispose()
  })

  test('loads from existing localStorage', () => {
    localStorage.setItem('counter', '42')
    const adapter = localStorageAdapter('counter', 0)
    const { state, dispose } = persistedState(adapter)
    expect(state.read()).toBe(42)
    dispose()
  })

  test('saves on every write', () => {
    const adapter = localStorageAdapter('counter', 0)
    const { state, dispose } = persistedState(adapter)
    state.write(5)
    expect(localStorage.getItem('counter')).toBe('5')
    state.write(10)
    expect(localStorage.getItem('counter')).toBe('10')
    dispose()
  })

  test('survives across persistedState calls (the reload simulation)', () => {
    // Session 1
    const a1 = localStorageAdapter<string[]>('todos', [])
    const ps1 = persistedState(a1)
    ps1.state.write(['buy milk', 'walk dog'])
    ps1.dispose()

    // Session 2 — fresh adapter, should pick up persisted value
    const a2 = localStorageAdapter<string[]>('todos', [])
    const ps2 = persistedState(a2)
    expect(ps2.state.read()).toEqual(['buy milk', 'walk dog'])
    ps2.dispose()
  })

  test('dispose stops the auto-save watch', () => {
    const writes: number[] = []
    const adapter: ReturnType<typeof memoryAdapter<number>> = {
      load: () => 0,
      save: (v) => writes.push(v),
    }
    const { state, dispose } = persistedState(adapter)
    state.write(1)
    state.write(2)
    expect(writes).toEqual([0, 1, 2]) // initial save + two writes
    dispose()
    state.write(3)
    expect(writes, 'no save after dispose').toEqual([0, 1, 2])
  })

  test('handles complex object state', () => {
    interface Note {
      id: string
      title: string
      content: string
    }
    const adapter = localStorageAdapter<Note[]>('notes:v1', [])
    const { state, dispose } = persistedState(adapter)
    state.write([
      { id: 'a', title: 'first', content: 'hello' },
      { id: 'b', title: 'second', content: 'world' },
    ])
    expect(JSON.parse(localStorage.getItem('notes:v1') ?? '[]')).toEqual([
      { id: 'a', title: 'first', content: 'hello' },
      { id: 'b', title: 'second', content: 'world' },
    ])
    dispose()
  })

  test('subscribes to adapter.observe and re-loads on external change', () => {
    // A test adapter with an explicit observe channel.
    let stored = 0
    const subs = new Set<() => void>()
    const adapter: PersistenceAdapter<number> = {
      load: () => stored,
      save: (v) => {
        stored = v
      },
      observe: (cb) => {
        subs.add(cb)
        return () => subs.delete(cb)
      },
    }
    const fireExternal = (newValue: number) => {
      stored = newValue
      for (const cb of subs) cb()
    }
    const { state, dispose } = persistedState(adapter)
    expect(state.read()).toBe(0)

    fireExternal(42)
    expect(state.read()).toBe(42)

    dispose()
    // After dispose the observer should be removed.
    expect(subs.size).toBe(0)
  })

  test('remote change does NOT echo back through save (cycle break)', () => {
    let stored = 0
    let saveCount = 0
    const subs = new Set<() => void>()
    const adapter: PersistenceAdapter<number> = {
      load: () => stored,
      save: (v) => {
        stored = v
        saveCount++
      },
      observe: (cb) => {
        subs.add(cb)
        return () => subs.delete(cb)
      },
    }
    const { dispose } = persistedState(adapter)
    saveCount = 0 // ignore the initial-load save

    // Simulate a remote change: bump stored and fire observers.
    stored = 99
    for (const cb of subs) cb()

    // The auto-save watch saw the state change but should have
    // SKIPPED saving — otherwise the remote update would loop.
    expect(saveCount).toBe(0)
    dispose()
  })

  test('custom equality short-circuits saves on no-op writes', () => {
    let saveCount = 0
    const adapter: ReturnType<typeof memoryAdapter<{ x: number }>> = {
      load: () => ({ x: 0 }),
      save: () => {
        saveCount++
      },
    }
    const { state, dispose } = persistedState(adapter, {
      equals: (a, b) => a.x === b.x,
    })
    saveCount = 0
    state.write({ x: 0 }) // structurally equal — should not save
    expect(saveCount).toBe(0)
    state.write({ x: 1 }) // changed — should save
    expect(saveCount).toBe(1)
    dispose()
  })
})

describe('crossTabAdapter', () => {
  // Each test uses a unique channel name so listeners from prior tests
  // don't bleed across — Node's BroadcastChannel persists for the test
  // process, and we don't dispose it in v0.2.
  let counter = 0
  const fresh = (): string => `xtab:test:${++counter}:${Date.now()}`

  test('save broadcasts; other tabs observe and see updated load()', async () => {
    const channel = fresh()
    const a = crossTabAdapter(localStorageAdapter<number>(channel, 0), channel)
    const b = crossTabAdapter(localStorageAdapter<number>(channel, 0), channel)

    let bObserved = 0
    const stop = b.observe?.(() => {
      bObserved++
    })

    a.save(42)
    await waitFor(() => bObserved >= 1)

    expect(bObserved).toBe(1)
    expect(b.load()).toBe(42)

    stop?.()
  })

  test('sender does not receive its own broadcast', async () => {
    const channel = fresh()
    const a = crossTabAdapter(memoryAdapter(0), channel)

    let aObserved = 0
    const stop = a.observe?.(() => {
      aObserved++
    })

    a.save(1)
    a.save(2)
    a.save(3)
    // No condition to wait for here — we want to confirm the negative.
    // Two short ticks is enough to surface any spurious self-delivery.
    await tick()
    await tick()

    expect(aObserved).toBe(0)
    stop?.()
  })

  test('end-to-end with persistedState — remote change flows into local state', async () => {
    const channel = fresh()
    const aAdapter = crossTabAdapter(localStorageAdapter<number>(channel, 0), channel)
    const bAdapter = crossTabAdapter(localStorageAdapter<number>(channel, 0), channel)

    const aSession = persistedState(aAdapter)
    const bSession = persistedState(bAdapter)

    aSession.state.write(99)
    await waitFor(() => bSession.state.read() === 99)
    expect(bSession.state.read()).toBe(99)

    aSession.dispose()
    bSession.dispose()
  })

  test('two persistedStates do not infinite-loop on local writes', async () => {
    const channel = fresh()
    let aSaves = 0
    let bSaves = 0
    const wrap = (count: () => void): PersistenceAdapter<number> => {
      const inner = localStorageAdapter<number>(channel, 0)
      return {
        load: inner.load,
        save: (v) => {
          count()
          inner.save(v)
        },
      }
    }

    const aSession = persistedState(
      crossTabAdapter(
        wrap(() => {
          aSaves++
        }),
        channel,
      ),
    )
    const bSession = persistedState(
      crossTabAdapter(
        wrap(() => {
          bSaves++
        }),
        channel,
      ),
    )
    // Reset counters after the initial-load saves both sides do.
    aSaves = 0
    bSaves = 0

    aSession.state.write(7)
    await waitFor(() => bSession.state.read() === 7)

    // A saved once for its local write. B received the broadcast and
    // updated its state — but the cycle-break must keep B from saving
    // back. So total saves are 1 (A's), not 2+ from a feedback loop.
    expect(aSaves).toBe(1)
    expect(bSaves).toBe(0)
    expect(bSession.state.read()).toBe(7)

    aSession.dispose()
    bSession.dispose()
  })

  test('observe disposer removes the listener', async () => {
    const channel = fresh()
    const a = crossTabAdapter(memoryAdapter(0), channel)
    const b = crossTabAdapter(memoryAdapter(0), channel)

    let count = 0
    const stop = b.observe?.(() => {
      count++
    })

    a.save(1)
    await waitFor(() => count >= 1)
    expect(count).toBe(1)

    stop?.()
    a.save(2)
    // Negative confirmation — short fixed wait is acceptable here.
    await tick()
    await tick()
    expect(count).toBe(1)
  })

  test('composes with an inner adapter that also has observe', async () => {
    // Inner adapter that emits its own external changes (e.g. simulating
    // a future IndexedDB adapter that fires after async load resolves).
    const innerSubs = new Set<() => void>()
    let stored = 0
    const inner: PersistenceAdapter<number> = {
      load: () => stored,
      save: (v) => {
        stored = v
      },
      observe: (cb) => {
        innerSubs.add(cb)
        return () => innerSubs.delete(cb)
      },
    }

    const channel = fresh()
    const wrapped = crossTabAdapter(inner, channel)

    let received = 0
    const stop = wrapped.observe?.(() => {
      received++
    })

    // External change from the inner adapter (not from cross-tab) still
    // reaches the consumer.
    stored = 5
    for (const cb of innerSubs) cb()
    expect(received).toBe(1)

    stop?.()
    expect(innerSubs.size).toBe(0)
  })
})

describe('indexedDBAdapter', () => {
  // Each test uses a fresh fake IDB so the data is isolated.
  const settle = () => new Promise<void>((r) => setTimeout(r, 10))

  test('returns the default before the async load resolves', () => {
    const factory = new IDBFactory()
    const a = indexedDBAdapter('counter', 0, { factory })
    // Synchronously after construction, load hasn't resolved yet.
    expect(a.load()).toBe(0)
  })

  test('save / reload round-trip across separate adapter instances', async () => {
    const factory = new IDBFactory()
    const a = indexedDBAdapter('notes', { count: 0 }, { factory })
    a.save({ count: 42 })
    await settle()

    // A fresh adapter on the same db+key sees the persisted value
    // after its async load resolves.
    const b = indexedDBAdapter('notes', { count: 0 }, { factory })
    let observed = 0
    b.observe?.(() => {
      observed++
    })
    await settle()
    expect(observed).toBe(1)
    expect(b.load()).toEqual({ count: 42 })
  })

  test('observe fires only when load resolves with a real value', async () => {
    const factory = new IDBFactory()
    // Key absent — load resolves to undefined; cached stays at default;
    // observers should NOT fire.
    const a = indexedDBAdapter('missing', 'default', { factory })
    let observed = 0
    a.observe?.(() => {
      observed++
    })
    await settle()
    expect(observed).toBe(0)
    expect(a.load()).toBe('default')
  })

  test('end-to-end with persistedState', async () => {
    const factory = new IDBFactory()
    const a = indexedDBAdapter('todos', [] as string[], { factory })
    a.save(['initial'])
    await settle()

    const b = indexedDBAdapter('todos', [] as string[], { factory })
    const session = persistedState(b)
    expect(session.state.read()).toEqual([])
    await settle()
    // Once the async load resolves, persistedState's observer fires
    // and the local state catches up.
    expect(session.state.read()).toEqual(['initial'])
    session.dispose()
  })

  test('falls back to default when no factory is available', () => {
    // Pass undefined for factory in an environment that has no
    // globalThis.indexedDB — adapter should still return defaultValue
    // and not throw on save.
    const a = indexedDBAdapter('x', 'default', { factory: undefined as never })
    expect(a.load()).toBe('default')
    expect(() => a.save('y')).not.toThrow()
  })

  test('observe disposer removes the listener', async () => {
    const factory = new IDBFactory()
    const writer = indexedDBAdapter('shared', 0, { factory })
    writer.save(1)
    await settle()

    const reader = indexedDBAdapter('shared', 0, { factory })
    let count = 0
    const stop = reader.observe?.(() => {
      count++
    })
    await settle()
    expect(count).toBe(1)

    stop?.()
    // No way to fire a second time without refresh; this just confirms
    // dispose doesn't throw and the unsubscribe path runs.
    expect(stop).toBeTypeOf('function')
  })

  test('composes with crossTabAdapter for tab sync over IDB', async () => {
    const factory = new IDBFactory()
    const channel = `xtab:idb:${Date.now()}`
    const a = crossTabAdapter(indexedDBAdapter('shared:v1', 0, { factory }), channel)
    const b = crossTabAdapter(indexedDBAdapter('shared:v1', 0, { factory }), channel)
    // Wait for both adapters to settle their initial async loads
    // (returns undefined — key absent).
    await settle()

    let bObserved = 0
    b.observe?.(() => {
      bObserved++
    })

    a.save(99)
    await settle()
    // The cross-tab broadcast triggers b's observer; b reloads via its
    // inner IDB adapter, which has the freshly written value.
    expect(bObserved).toBeGreaterThanOrEqual(1)
    expect(b.load()).toBe(99)
  })

  test('custom serialize that throws does NOT desync cache from storage', async () => {
    const factory = new IDBFactory()
    let allow = true
    const a = indexedDBAdapter<{ n: number }>(
      'desync',
      { n: 0 },
      {
        factory,
        // serialize throws on a specific value; the adapter must NOT
        // update its cache for that save (otherwise cache says n=99
        // but IDB stays at n=0, and a reload from another instance
        // would see the divergence).
        serialize: (v) => {
          if (!allow) throw new Error('refused')
          return v.n
        },
        deserialize: (raw) => ({ n: raw as number }),
      },
    )
    a.save({ n: 5 })
    await settle()
    expect(a.load()).toEqual({ n: 5 })

    allow = false
    a.save({ n: 99 }) // serialize throws — cache must stay at 5
    await settle()
    expect(a.load()).toEqual({ n: 5 })

    // Confirm the underlying IDB also stayed at 5 by opening a fresh
    // adapter that loads from the same key.
    allow = true
    const b = indexedDBAdapter<{ n: number }>(
      'desync',
      { n: 0 },
      {
        factory,
        serialize: (v) => v.n,
        deserialize: (raw) => ({ n: raw as number }),
      },
    )
    await settle()
    expect(b.load()).toEqual({ n: 5 })
  })

  test('custom serialize / deserialize hooks', async () => {
    const factory = new IDBFactory()
    const a = indexedDBAdapter<Date>('when', new Date(0), {
      factory,
      serialize: (d) => d.getTime(),
      deserialize: (raw) => new Date(raw as number),
    })
    const t = new Date('2026-05-02T12:34:56Z')
    a.save(t)
    await settle()

    const b = indexedDBAdapter<Date>('when', new Date(0), {
      factory,
      serialize: (d) => d.getTime(),
      deserialize: (raw) => new Date(raw as number),
    })
    await settle()
    expect(b.load().getTime()).toBe(t.getTime())
  })
})

describe('serverAdapter', () => {
  // Tiny in-test "server": holds key→value, mocks fetch, mocks a
  // WebSocket that dispatches messages on demand. Cleaner than spinning
  // up a real Bun.serve in a vitest worker (different runtime).
  function makeFakeServer() {
    const store = new Map<string, unknown>()
    const sockets = new Set<FakeSocket>()

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const m = url.match(/\/kv\/(.+)$/)
      const key = m ? decodeURIComponent(m[1] as string) : ''
      const method = init?.method ?? 'GET'
      if (method === 'GET') {
        const value = store.has(key) ? store.get(key) : null
        return new Response(JSON.stringify({ value }), { status: 200 })
      }
      if (method === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { value: unknown }
        store.set(key, body.value)
        // Broadcast to all sockets.
        const msg = JSON.stringify({ type: 'change', key })
        for (const s of sockets) s._receive(msg)
        return new Response(null, { status: 204 })
      }
      return new Response(null, { status: 405 })
    }) as typeof fetch

    class FakeSocket extends EventTarget {
      static readonly OPEN = 1
      readonly url: string
      readyState = 1
      constructor(url: string) {
        super()
        this.url = url
        sockets.add(this)
      }
      _receive(data: string): void {
        this.dispatchEvent(new MessageEvent('message', { data }))
      }
      close(): void {
        sockets.delete(this)
      }
      // Required for the TS WebSocket shape — never used in tests.
      send(): void {}
      get bufferedAmount(): number {
        return 0
      }
      readonly extensions = ''
      readonly protocol = ''
      readonly binaryType = 'blob' as BinaryType
      readonly CONNECTING = 0
      readonly OPEN = 1
      readonly CLOSING = 2
      readonly CLOSED = 3
      onclose: ((this: WebSocket, ev: CloseEvent) => void) | null = null
      onerror: ((this: WebSocket, ev: Event) => void) | null = null
      onmessage: ((this: WebSocket, ev: MessageEvent) => void) | null = null
      onopen: ((this: WebSocket, ev: Event) => void) | null = null
    }

    return { store, fetchImpl, WebSocketImpl: FakeSocket as unknown as typeof WebSocket }
  }

  test('initial GET populates the cache and fires observers', async () => {
    const { store, fetchImpl, WebSocketImpl } = makeFakeServer()
    store.set('counter', 42)

    const a = serverAdapter<number>({
      baseUrl: 'http://t',
      key: 'counter',
      defaultValue: 0,
      fetchImpl,
      webSocketImpl: WebSocketImpl,
    })
    let observed = 0
    a.observe?.(() => {
      observed++
    })
    await waitFor(() => a.load() === 42)
    expect(a.load()).toBe(42)
    expect(observed).toBe(1)
  })

  test('save PUTs and the broadcast wakes other clients', async () => {
    const { fetchImpl, WebSocketImpl } = makeFakeServer()
    const a = serverAdapter<number>({
      baseUrl: 'http://t',
      key: 'shared',
      defaultValue: 0,
      fetchImpl,
      webSocketImpl: WebSocketImpl,
    })
    const b = serverAdapter<number>({
      baseUrl: 'http://t',
      key: 'shared',
      defaultValue: 0,
      fetchImpl,
      webSocketImpl: WebSocketImpl,
    })
    let bObserved = 0
    b.observe?.(() => {
      bObserved++
    })

    a.save(99)
    await waitFor(() => b.load() === 99)
    expect(b.load()).toBe(99)
    expect(bObserved).toBeGreaterThanOrEqual(1)
  })

  test('end-to-end with persistedState', async () => {
    const { fetchImpl, WebSocketImpl } = makeFakeServer()
    const aAdapter = serverAdapter<number>({
      baseUrl: 'http://t',
      key: 'shared:e2e',
      defaultValue: 0,
      fetchImpl,
      webSocketImpl: WebSocketImpl,
    })
    const bAdapter = serverAdapter<number>({
      baseUrl: 'http://t',
      key: 'shared:e2e',
      defaultValue: 0,
      fetchImpl,
      webSocketImpl: WebSocketImpl,
    })
    const aSession = persistedState(aAdapter)
    const bSession = persistedState(bAdapter)

    aSession.state.write(7)
    await waitFor(() => bSession.state.read() === 7)
    expect(bSession.state.read()).toBe(7)

    aSession.dispose()
    bSession.dispose()
  })

  test('falls back gracefully when fetch is undefined', () => {
    const a = serverAdapter<number>({
      baseUrl: 'http://t',
      key: 'k',
      defaultValue: 0,
      fetchImpl: undefined as never,
      webSocketImpl: undefined as never,
    })
    expect(a.load()).toBe(0)
    expect(() => a.save(1)).not.toThrow()
  })

  test('custom serialize that throws does NOT update cache', () => {
    const { fetchImpl, WebSocketImpl } = makeFakeServer()
    const a = serverAdapter<{ n: number }>({
      baseUrl: 'http://t',
      key: 'desync',
      defaultValue: { n: 0 },
      fetchImpl,
      webSocketImpl: WebSocketImpl,
      serialize: (v) => {
        if (v.n === 99) throw new Error('refused')
        return v.n
      },
      deserialize: (raw) => ({ n: raw as number }),
    })
    a.save({ n: 5 })
    expect(a.load()).toEqual({ n: 5 })
    a.save({ n: 99 })
    expect(a.load()).toEqual({ n: 5 }) // serialize threw — cache unchanged
  })

  test('composes with crossTabAdapter for tab + server sync', async () => {
    const { fetchImpl, WebSocketImpl } = makeFakeServer()
    const channel = `xtab:server:${Date.now()}`
    const a = crossTabAdapter(
      serverAdapter<number>({
        baseUrl: 'http://t',
        key: 'shared:compose',
        defaultValue: 0,
        fetchImpl,
        webSocketImpl: WebSocketImpl,
      }),
      channel,
    )
    const b = crossTabAdapter(
      serverAdapter<number>({
        baseUrl: 'http://t',
        key: 'shared:compose',
        defaultValue: 0,
        fetchImpl,
        webSocketImpl: WebSocketImpl,
      }),
      channel,
    )
    let bObserved = 0
    b.observe?.(() => {
      bObserved++
    })

    a.save(123)
    await waitFor(() => b.load() === 123)
    expect(bObserved).toBeGreaterThanOrEqual(1)
    expect(b.load()).toBe(123)
  })
})
