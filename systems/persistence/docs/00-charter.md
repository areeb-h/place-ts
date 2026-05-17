# 00 — Persistence System Charter

**Status:** stub. The adapter contract is specified now (in reactivity's interfaces); the system is designed in v0.3.

## Scope (provisional)

- Adapters: in-memory, IndexedDB, server-synced (last-write-wins, CRDT, OT).
- Conflict resolution policies — pluggable.
- Durability guarantees per adapter.
- Migration support across schema changes.
- Sync state visibility (online/offline, lag, queued mutations) as `State`s.

## What this system does not own

- Reactivity primitives (reactivity owns `State<T>`; persistence backs it).
- Schema definition (data system owns schemas).
- Capability scoping (capability system; persistence consumes capabilities for permission).

## Depends on

- reactivity (implements `PersistenceAdapter<T>`)
- capability (read/write permissions enforced via handlers)
- (optional) build — for migration codegen

## The adapter contract (specified now)

```ts
export interface PersistenceAdapter<T> {
  initial(): Promise<T> | T
  observe(onChange: (next: T) => void): Disposer
  write(next: T): Promise<void> | void
  conflict?(local: T, remote: T): T
}
```

Reactivity consumes this; persistence implements it. The contract is specified before persistence is designed precisely because reactivity needs to design around it from Phase 1.

## Open questions for design phase

- CRDT library choice (Automerge, Yjs, custom)?
- IndexedDB wrapper (Dexie, idb, raw)?
- Server-sync protocol — Replicache-shaped, ElectricSQL, custom?
- How are partial / lazy fetches expressed when the data is too large to materialize?

## Phase

Deferred to **v0.3**.
