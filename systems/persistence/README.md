# Persistence System

Storage adapters for `@place-ts/reactivity` state. The contract is plain (`load`, `save`, optional `observe`, optional `refresh`) so any backend — memory, browser storage, IndexedDB, remote sync — slots into the same shape and consumer code never changes.

**Status:** v0.3 shipping. localStorage + memory + cross-tab via BroadcastChannel + IndexedDB (async, sync surface). 31 tests green.

- [docs/00-charter.md](docs/00-charter.md) — scope and dependencies
- [src/index.ts](src/index.ts) — runtime
- [tests/unit/persistence.test.ts](tests/unit/persistence.test.ts) — full surface coverage

## The claim

The platform's central architectural claim — "swap the impl, consumer code stays unchanged" — is most observable here. The commonplace book started with `inMemoryNoteStore`; switched to `persistedNoteStore(localStorageAdapter(...))`; switched to `persistedNoteStore(crossTabAdapter(localStorageAdapter(...)))` for cross-tab sync. None of: `App.tsx`, `Sidebar`, `Editor`, `searchNotes`, the `keyed` list, the routing wiring — touched.

## Shipping API

```ts
import {
  persistedState,
  localStorageAdapter,
  memoryAdapter,
  crossTabAdapter,
  type PersistenceAdapter,
} from '@place-ts/persistence'

// Sync localStorage round-trip:
const adapter = localStorageAdapter<Note[]>('notes:v1', [])
const { state, dispose } = persistedState(adapter)
state.write([...state.read(), newNote])  // saves automatically

// Cross-tab sync — wraps any adapter:
const synced = crossTabAdapter(localStorageAdapter('notes:v1', []), 'notes:v1')
const { state } = persistedState(synced)
// Edits in tab A propagate to tab B within ~1 frame.
```

### `PersistenceAdapter<T>`

```ts
interface PersistenceAdapter<T> {
  load(): T
  save(value: T): void
  observe?(onChange: () => void): Disposer    // external-change hook
  refresh?(): void | Promise<void>             // re-fetch backing store into cache
}
```

Four things in scope, deliberate:

- **`load`** is sync. Returns the default if nothing's stored. Async backends (IndexedDB) keep a sync cache over async storage; `load` returns the cache.
- **`save`** swallows recoverable errors (quota exceeded, security exception). A future cut surfaces them via a capability so apps can react.
- **`observe`** is optional. Its absence is meaningful — it tells `persistedState` that nothing else can write to this store. memory and localStorage omit it; crossTab, IndexedDB, and (future) remote-sync provide it.
- **`refresh`** is optional. It re-reads the backing store and updates the cache that `load()` returns, but does NOT fire observers — that's the caller's job. Used by wrappers like `crossTabAdapter`: when a broadcast arrives, the wrapper awaits `inner.refresh?.()` so the consumer's subsequent `load()` sees the fresh value, then fires its own observers.

### `persistedState(adapter, options?)`

Wraps a state with auto-save. Returns `{ state, dispose }`. The state is initialized from `adapter.load()`; every change triggers `adapter.save(value)`.

When the adapter has `observe`, `persistedState` subscribes. On external change it re-loads and writes to the local state. The auto-save watch sees the write but skips saving (a closure-local `applyingRemote` flag breaks the cycle); without that, A's save → B's reload → B's save → A's reload would loop forever.

`options.equals` lets you pass a structural comparator for object-shaped state to avoid spurious save calls when the object is replaced with structurally identical content.

### Adapters

- **`localStorageAdapter(key, defaultValue, options?)`** — JSON-serializable values by default; pass `serialize`/`deserialize` for richer types. Falls back to default on corrupt JSON. Custom `storage` backend supported.
- **`memoryAdapter(initial)`** — in-memory, useful for tests and no-op fallbacks.
- **`crossTabAdapter(inner, channelName)`** — BroadcastChannel sync between same-origin tabs. Composes with any inner adapter; merges its `observe` listeners with the inner adapter's (if any). On broadcast, awaits `inner.refresh?.()` before firing observers so consumers' `load()` reads see fresh data. Per spec, `BroadcastChannel` doesn't echo to the sender, so the cycle break in `persistedState` covers the receiver and the loop is fully closed.
- **`indexedDBAdapter(key, defaultValue, options?)`** — async storage with the same sync `load()` surface. Keeps a sync cache; the async load happens on construction and fires observers when it resolves with a real value, so `persistedState` re-runs and the local state catches up. Implements `refresh` for crossTab composition (`crossTabAdapter(indexedDBAdapter(...))` is the cross-tab + async-storage stack). Saves are fire-and-forget. `factory` option lets tests pass a fake IDBFactory (used in our test suite via `fake-indexeddb`). One shared db (`'place'`) and store (`'kv'`) by default; `key` is the IDB key inside the store.

## Conflict policy

**v0.2: last-write-wins.** Concurrent edits in two tabs can lose keystrokes. CRDT or OT integration is the future sync-server adapter; deliberately deferred.

## What's deferred

- **AbortController integration** in `indexedDBAdapter` — cancel the in-flight load on dispose so a stale resolution can't write to a torn-down state. Add when a real workload demonstrates the issue.
- **Remote sync adapter** — last-write-wins or CRDT. The `observe` + `refresh` pattern is already the right shape; the work is the sync protocol itself.
- **Migration support** across schema changes — version field on saved values; user-supplied migration functions per version step.
- **Quota / error surfacing via a capability** — rather than silent swallow.
- **Structured queries on IndexedDB** — currently the IDB adapter uses a single key-value store. Real IDB workloads often benefit from secondary indexes, ranges, cursors. Add when an app needs them.
