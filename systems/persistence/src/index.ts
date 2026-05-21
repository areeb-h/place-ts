// @place-ts/persistence — storage adapters for @place-ts/reactivity state
//
// A `PersistenceAdapter<T>` is a plain object — `load` / `save`, an
// optional `observe(cb)` external-change hook, an optional `refresh`.
// `persistedState(adapter)` wraps a `State<T>`: it loads on creation
// and saves on every change.
//
// Shipped adapters:
//   - localStorageAdapter      sync, JSON-serializable values
//   - indexedDBAdapter         async load via the resource primitive
//   - serverAdapter            persist through a server endpoint
//   - memoryAdapter            in-memory, for tests / no-op fallbacks
//   - crossTabAdapter(inner)   wraps any adapter with BroadcastChannel
//                              sync between tabs of the same origin
//
// `observe?(cb)` lets `persistedState` re-load on an external change;
// the auto-save loop is broken via an `applyingRemote` flag so a
// remote-driven write doesn't echo back through `save`.
//
// Deferred until a workload demands it: migration support across
// schema changes; CRDT conflict resolution beyond last-write-wins.
//
// Design rationale:
//   - The adapter is a *plain object*, not a class. Easy to test, easy to
//     swap, easy to compose.
//   - Persistence sits ON TOP of reactivity, not inside it. The reactivity
//     primitive (state) doesn't know about persistence — `persistedState`
//     wraps a `state` with a `watch` that calls `adapter.save`.
//   - The save is debounced ZERO ms by default. Per-keystroke writes to
//     localStorage are cheap; if a real workload needs debouncing, the
//     consumer wraps the adapter.

import { type Disposer, type State, state, watch } from '@place-ts/reactivity'

export interface PersistenceAdapter<T> {
  /** Load the persisted value. Returns the default when not present. */
  load(): T
  /** Persist `value`. Errors are the adapter's to handle. */
  save(value: T): void
  /**
   * Optional: subscribe to external changes (cross-tab broadcasts,
   * remote sync, etc.). When the callback fires, `persistedState`
   * re-loads from this adapter. The returned disposer unsubscribes.
   *
   * Adapters without external sources omit this — the absence is
   * meaningful (it tells `persistedState` that nothing else can write
   * to the underlying store).
   */
  observe?(onChange: () => void): Disposer
  /**
   * Optional: re-fetch the backing store and update the value that
   * `load()` returns. Call this from a wrapper (crossTabAdapter, future
   * remote-sync adapter) BEFORE notifying observers, so consumers'
   * `load()` reads see the fresh value.
   *
   * Adapters with no cache (localStorage reads through every time) can
   * omit this — the absence means "load() is always fresh." Adapters
   * with a sync cache over async storage (IndexedDB, future remote
   * sync) implement it.
   *
   * Implementations should NOT fire their own `observe` callbacks from
   * here — the caller is responsible for the notification path.
   */
  refresh?(): void | Promise<void>
  /**
   * Optional: release any retained external resources. Adapters that
   * hold sockets, channels, observers, or open database handles
   * implement this; `persistedState`'s returned `dispose()` forwards
   * to it so the entire stack tears down cleanly. Adapters with
   * nothing to release (`localStorage`, `memoryAdapter`) omit it —
   * the contract is "must be safe to never call."
   *
   * Idempotent. After `dispose()`, subsequent `load`/`save`/`observe`
   * calls are best-effort no-ops; the adapter does NOT throw to keep
   * teardown races forgiving.
   */
  dispose?(): void
}

export interface PersistedStateOptions<T> {
  /**
   * Equality used by the underlying state. Defaults to `Object.is`.
   * Pass a structural comparator for object-shaped state to avoid
   * spurious save calls when the object is replaced with structurally
   * identical content.
   */
  equals?: (a: T, b: T) => boolean
}

/**
 * Wrap a state with persistence. The state is initialized from
 * `adapter.load()`; every change triggers `adapter.save(value)`.
 *
 * Returns the State plus a disposer that stops the auto-save watch.
 * In most cases you'll keep the state alive for the app's lifetime;
 * the disposer is exposed for tests and short-lived components.
 */
export function persistedState<T>(
  adapter: PersistenceAdapter<T>,
  options?: PersistedStateOptions<T>,
): { state: State<T>; dispose: Disposer } {
  const s = state<T>(adapter.load(), options?.equals ? { equals: options.equals } : undefined)

  // Cycle break: when adapter.observe fires, we re-load and write to
  // state. That state-write fires the auto-save watch synchronously.
  // Without this flag, the watch would save → broadcast → other tabs
  // → re-load → save → broadcast forever. The flag is closure-local;
  // reads inside the watch are not tracked (it's a plain variable).
  let applyingRemote = false

  const stopWatch = watch(() => {
    const value = s.read()
    if (applyingRemote) return
    adapter.save(value)
  })

  const stopObserve = adapter.observe?.(() => {
    applyingRemote = true
    try {
      s.write(adapter.load())
    } finally {
      applyingRemote = false
    }
  })

  return {
    state: s,
    dispose: () => {
      stopObserve?.()
      stopWatch()
      // Tear down adapter-owned external resources (sockets,
      // BroadcastChannels, IDB handles). Adapters without external
      // resources omit `dispose`; the optional-call is the contract.
      adapter.dispose?.()
    },
  }
}

// ===== localStorage adapter =====

export interface LocalStorageAdapterOptions<T> {
  serialize?: (value: T) => string
  deserialize?: (raw: string) => T
  /** Custom storage backend. Defaults to globalThis.localStorage. */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}

/**
 * Sync adapter backed by `localStorage` (or any compatible Storage).
 * JSON-serializable values by default; pass custom serialize/deserialize
 * for richer types.
 *
 * Errors during save (e.g. quota exceeded, storage disabled) are
 * swallowed silently in v0.1. A future version will surface them via a
 * capability so the app can react.
 */
export function localStorageAdapter<T>(
  key: string,
  defaultValue: T,
  options?: LocalStorageAdapterOptions<T>,
): PersistenceAdapter<T> {
  const serialize = options?.serialize ?? JSON.stringify
  const deserialize = options?.deserialize ?? JSON.parse
  const storage = options?.storage ?? globalThis.localStorage

  return {
    load(): T {
      if (!storage) return defaultValue
      try {
        const raw = storage.getItem(key)
        if (raw === null) return defaultValue
        return deserialize(raw)
      } catch {
        // Corrupt JSON or schema mismatch — fall back to default.
        return defaultValue
      }
    },
    save(value: T): void {
      if (!storage) return
      try {
        storage.setItem(key, serialize(value))
      } catch {
        // Quota exceeded, security exception, etc. Silent for v0.1.
      }
    },
  }
}

// ===== indexedDBAdapter — async storage, large values =====
//
// Unlike localStorage, IndexedDB is async: open returns a Promise, get
// returns a Promise, put returns a Promise. The PersistenceAdapter
// contract is sync at `load()` though — this is deliberate, so consumer
// code never deals with promises just to read state. The adapter
// reconciles the two by:
//
//   - keeping a sync cached value (initialized to `defaultValue`)
//   - kicking off the async load on construction
//   - firing `observe` callbacks when the async load resolves with a
//     real value, so persistedState re-loads and writes the cached
//     value into its state
//
// Saves are fire-and-forget async puts. Errors (quota, security) are
// swallowed silently in v0.3 — same policy as localStorageAdapter. A
// future cut surfaces them via a capability so apps can react.
//
// Why one shared db + one shared store: avoids creating dozens of tiny
// databases as more keys appear. The default db name is 'place', the
// default store name is 'kv'. The provided `key` is the IDB key inside
// the store.
//
// Composes cleanly with crossTabAdapter: `crossTabAdapter(indexedDB, k)`.
// The cross-tab broadcast tells other tabs "something changed"; they
// re-load via the IDB adapter's load() (which returns the now-updated
// cached value once the IDB get completes).

export interface IndexedDBAdapterOptions<T> {
  /** Database name. Defaults to 'place'. */
  dbName?: string
  /** Object store name. Defaults to 'kv'. */
  storeName?: string
  /** Custom serialize before storing. Default: identity (IDB does structured cloning). */
  serialize?: (value: T) => unknown
  /** Custom deserialize after loading. Default: identity. */
  deserialize?: (raw: unknown) => T
  /**
   * Custom IDBFactory. Defaults to `globalThis.indexedDB`. Pass a fake
   * implementation in tests, or null/undefined to fall back to the
   * default-only behavior in environments without IDB.
   */
  factory?: IDBFactory
}

export function indexedDBAdapter<T>(
  key: string,
  defaultValue: T,
  options: IndexedDBAdapterOptions<T> = {},
): PersistenceAdapter<T> {
  const dbName = options.dbName ?? 'place'
  const storeName = options.storeName ?? 'kv'
  const serialize = options.serialize ?? ((v: T) => v as unknown)
  const deserialize = options.deserialize ?? ((raw: unknown) => raw as T)
  const factory: IDBFactory | undefined = options.factory ?? globalThis.indexedDB

  let cached: T = defaultValue
  const callbacks = new Set<() => void>()

  // Memoize the open call. Subsequent saves reuse the same connection.
  let dbPromise: Promise<IDBDatabase> | null = null
  const getDB = (): Promise<IDBDatabase> | null => {
    if (factory === undefined) return null
    if (dbPromise === null) {
      dbPromise = new Promise((resolve, reject) => {
        const req = factory.open(dbName, 1)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName)
          }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    }
    return dbPromise
  }

  // Re-read the key from IDB and update `cached`. Returns true if the
  // cache changed so the caller can decide whether to fire observers.
  // Errors swallowed silently per v0.3 policy.
  const reload = async (): Promise<boolean> => {
    const dbP = getDB()
    if (dbP === null) return false
    try {
      const db = await dbP
      const raw = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly')
        const req = tx.objectStore(storeName).get(key)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      if (raw === undefined) return false
      cached = deserialize(raw)
      return true
    } catch {
      return false
    }
  }

  // Kick off the initial load. When it resolves with a real value, fire
  // observers so persistedState picks up the persisted state.
  void reload().then((changed) => {
    if (changed) for (const cb of callbacks) cb()
  })

  let disposed = false
  return {
    load: () => cached,
    save(value: T): void {
      if (disposed) return
      // Serialize FIRST — if it throws, neither the cache nor IDB
      // updates, so they stay consistent. Setting `cached` before the
      // serialize attempt would leave a fresh adapter on the same key
      // reading the OLD value while this one's cache says new.
      let serialized: unknown
      try {
        serialized = serialize(value)
      } catch {
        return
      }
      cached = value
      const dbP = getDB()
      if (dbP === null) return
      dbP
        .then((db) => {
          const tx = db.transaction(storeName, 'readwrite')
          tx.objectStore(storeName).put(serialized, key)
        })
        .catch(() => {
          // Silent: quota exceeded, security exception, etc.
        })
    },
    observe(onChange) {
      callbacks.add(onChange)
      return () => callbacks.delete(onChange)
    },
    // refresh is the cache-update primitive used by wrappers (crossTab,
    // future remote sync) that want load() to see fresh data BEFORE
    // they notify their consumers. Does NOT fire observers — the
    // caller's notification path is responsible for that.
    refresh: () => reload().then(() => undefined),
    dispose(): void {
      if (disposed) return
      disposed = true
      callbacks.clear()
      // Close the IDB handle. The Promise stays settled — any in-
      // flight transaction the save path kicked off will run to
      // completion against the closed db (browser semantics: open
      // transactions outlive close), but no NEW transactions can be
      // opened. Reset the memo so a fresh adapter on the same key
      // opens its own connection.
      if (dbPromise !== null) {
        const p = dbPromise
        dbPromise = null
        void p
          .then((db) => {
            try {
              db.close()
            } catch (_) {
              // best-effort close on dispose
            }
          })
          .catch(() => {
            // Open failed before dispose — nothing to close.
          })
      }
    },
  }
}

// ===== serverAdapter — HTTP + WebSocket backed persistence =====
//
// Speaks to a tiny key-value sync server (see examples/sync-server for
// a single-file Bun.serve + bun:sqlite reference). The shape:
//
//   GET  /kv/:key   → { value: T | null }
//   PUT  /kv/:key   body { value: T } → 204 + broadcast { type: 'change', key }
//   WS              server pushes { type: 'change', key } per write
//
// Cache-over-async like indexedDBAdapter: `load()` returns the synced
// cache, the initial fetch happens on construction, and `observe`
// callbacks fire whenever the WebSocket signals a change for our key
// (the server only sends the key, not the value — receivers refetch
// via the same load path through `refresh`). This keeps the protocol
// payload-agnostic and avoids duplicating serialize/deserialize logic
// across HTTP + WS.
//
// Failure modes (silent for v0.1, same policy as the other adapters):
//   - Network down during initial fetch → cache stays at default
//   - Network down during save → write lost, no retry
//   - WebSocket disconnect → no auto-reconnect (add `reconnect: true`
//     when a workload demands it; small additional state machine)
//   - 4xx / 5xx → swallowed; the store returns whatever the cache holds
//
// Composition: like IDB, this exposes `refresh` so wrappers
// (crossTabAdapter on top, e.g.) can re-fetch before notifying their
// own observers. `crossTabAdapter(serverAdapter(...))` is a valid
// stack — server-synced + cross-tab-synced same-origin.

export interface ServerAdapterOptions<T> {
  /** Base URL of the sync server, e.g. 'http://localhost:5180'. */
  baseUrl: string
  /** Key under which this value is stored. */
  key: string
  /** Returned synchronously until the initial fetch resolves. */
  defaultValue: T
  /**
   * WebSocket URL. Defaults to `baseUrl` with the `http(s)` scheme
   * swapped for `ws(s)`. Override if your sync server hosts the
   * WebSocket on a different origin / path.
   */
  wsUrl?: string
  /** Custom serialize before PUT. Default: identity. */
  serialize?: (value: T) => unknown
  /** Custom deserialize after GET. Default: identity. */
  deserialize?: (raw: unknown) => T
  /**
   * Inject a `fetch` for tests or non-browser hosts. Defaults to
   * `globalThis.fetch`.
   */
  fetchImpl?: typeof fetch
  /**
   * Inject a `WebSocket` constructor for tests or non-browser hosts.
   * Defaults to `globalThis.WebSocket`. If unavailable, the adapter
   * works in HTTP-only mode (no observe push, but `refresh` still
   * pulls fresh data on demand).
   */
  webSocketImpl?: typeof WebSocket
}

export function serverAdapter<T>(opts: ServerAdapterOptions<T>): PersistenceAdapter<T> {
  const serialize = opts.serialize ?? ((v: T) => v as unknown)
  const deserialize = opts.deserialize ?? ((raw: unknown) => raw as T)
  const fetcher = opts.fetchImpl ?? globalThis.fetch
  const WS = opts.webSocketImpl ?? globalThis.WebSocket
  const wsUrl = opts.wsUrl ?? opts.baseUrl.replace(/^http(s?):/, 'ws$1:')
  const kvUrl = `${opts.baseUrl}/kv/${encodeURIComponent(opts.key)}`

  let cached: T = opts.defaultValue
  const callbacks = new Set<() => void>()

  const fetchValue = async (): Promise<boolean> => {
    if (typeof fetcher !== 'function') return false
    try {
      const res = await fetcher(kvUrl)
      if (!res.ok) return false
      const body = (await res.json()) as { value: unknown }
      if (body.value === null || body.value === undefined) return false
      cached = deserialize(body.value)
      return true
    } catch {
      return false
    }
  }

  // Initial fetch — fire observers when it resolves with a real value.
  void fetchValue().then((changed) => {
    if (changed) for (const cb of callbacks) cb()
  })

  // Open a WebSocket and listen for change-events on our key. If the
  // browser blocks it, we just don't get push updates — `refresh()`
  // still pulls on demand. We don't reconnect on disconnect in v0.1.
  // Listener is named so `dispose()` can detach it AND close the
  // socket — without that, every SPA nav past a `persistedState`
  // backed by a serverAdapter leaks the socket + its in-flight
  // message dispatch.
  let socket: WebSocket | null = null
  const onSocketMessage = (event: MessageEvent): void => {
    try {
      const msg = JSON.parse(typeof event.data === 'string' ? event.data : '{}') as {
        type?: string
        key?: string
      }
      if (msg.type !== 'change' || msg.key !== opts.key) return
      // Re-fetch and notify callbacks. Errors are silent.
      void fetchValue().then((changed) => {
        if (changed) for (const cb of callbacks) cb()
      })
    } catch {
      // Malformed message — ignore.
    }
  }
  if (typeof WS === 'function') {
    try {
      socket = new WS(wsUrl)
      socket.addEventListener('message', onSocketMessage)
    } catch {
      socket = null
    }
  }

  let disposed = false
  return {
    load: () => cached,
    save(value: T): void {
      if (disposed) return
      // Same fail-closed pattern as IDB: serialize first, only update
      // cache if serialize succeeds. Otherwise the cache and the server
      // could diverge on a custom serialize that throws.
      let serialized: unknown
      try {
        serialized = serialize(value)
      } catch {
        return
      }
      cached = value
      if (typeof fetcher !== 'function') return
      void fetcher(kvUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: serialized }),
      }).catch(() => {
        // Network errors / 4xx / 5xx — silent for v0.1.
      })
    },
    observe(onChange) {
      callbacks.add(onChange)
      return () => callbacks.delete(onChange)
    },
    // Pull fresh data into the cache (used by wrappers like
    // crossTabAdapter that need consumers' next load() to be fresh).
    // Does NOT fire observers — the caller's notification path does.
    refresh: () => fetchValue().then(() => undefined),
    dispose(): void {
      if (disposed) return
      disposed = true
      callbacks.clear()
      if (socket !== null) {
        try {
          socket.removeEventListener('message', onSocketMessage)
        } catch (_) {
          // best-effort detach
        }
        try {
          socket.close()
        } catch (_) {
          // best-effort close
        }
        socket = null
      }
    },
  }
}

/**
 * In-memory adapter — useful for tests and as a no-op fallback.
 */
export function memoryAdapter<T>(initial: T): PersistenceAdapter<T> {
  let stored = initial
  let hasStored = false
  return {
    load(): T {
      return hasStored ? stored : initial
    },
    save(value: T): void {
      stored = value
      hasStored = true
    },
  }
}

// ===== crossTabAdapter — BroadcastChannel sync between same-origin tabs =====
//
// Wraps any adapter so writes propagate to other tabs of the same origin
// in near-realtime. The mechanism is `BroadcastChannel`: on save, post a
// 'changed' signal; on receive, fire the observe callbacks. Consumers
// (`persistedState`) re-load the inner adapter to pick up the new value.
//
// Per spec, a `BroadcastChannel` does NOT receive its own messages, so
// the SENDING tab will not loop on itself. The RECEIVING tab's auto-save
// watch is suppressed by `persistedState`'s `applyingRemote` flag, so it
// won't echo back. The result is one save → one broadcast → other tabs
// reload, full stop.
//
// Conflict policy in v0.2: last-write-wins. Concurrent edits in two tabs
// can lose keystrokes. CRDT / OT integration is the sync-server adapter,
// deferred.
//
// `dispose()` closes the BroadcastChannel + tears down the inner
// adapter's resources too — `persistedState`'s returned `dispose()`
// walks the whole stack.

export function crossTabAdapter<T>(
  inner: PersistenceAdapter<T>,
  channelName: string,
): PersistenceAdapter<T> {
  // BroadcastChannel exists in browsers and Node 18+; happy-dom and
  // jsdom both expose it. Guard for environments without it.
  const Channel: typeof BroadcastChannel | undefined =
    typeof BroadcastChannel === 'undefined' ? undefined : BroadcastChannel
  const channel = Channel ? new Channel(channelName) : null
  const callbacks = new Set<() => void>()

  // On a broadcast: ask the inner adapter to re-fetch BEFORE notifying
  // our consumers, so their subsequent `load()` sees the fresh value.
  // Sync adapters that omit `refresh` get the synchronous fast-path
  // (no Promise scheduling) — important for tests that await a single
  // microtask after a save and expect observers to have fired.
  const fireCallbacks = (): void => {
    for (const cb of callbacks) cb()
  }
  const onChannelMessage = (): void => {
    const refresh = inner.refresh
    if (refresh === undefined) {
      fireCallbacks()
      return
    }
    const result = refresh()
    if (result === undefined) {
      // Sync refresh implementation — no need to schedule.
      fireCallbacks()
    } else {
      void result.then(fireCallbacks)
    }
  }
  channel?.addEventListener('message', onChannelMessage)

  let disposed = false
  return {
    load: () => inner.load(),
    save(value) {
      if (disposed) return
      inner.save(value)
      channel?.postMessage('changed')
    },
    observe(onChange) {
      // Compose with any observe the inner adapter exposes (e.g. a
      // future stack of crossTab over IndexedDB-with-its-own-observe).
      const stopInner = inner.observe?.(onChange)
      callbacks.add(onChange)
      return () => {
        callbacks.delete(onChange)
        stopInner?.()
      }
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      callbacks.clear()
      if (channel !== null) {
        try {
          channel.removeEventListener('message', onChannelMessage)
        } catch (_) {
          // best-effort detach
        }
        try {
          channel.close()
        } catch (_) {
          // best-effort close
        }
      }
      // Forward to inner — a stack like crossTabAdapter(serverAdapter(...))
      // releases both the channel and the socket.
      inner.dispose?.()
    },
  }
}
