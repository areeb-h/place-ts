# Data System

Data primitives over `@place/reactivity`. v0.1 ships ONE primitive — `collection<T>` — that handles the boring half of "I need an entity store" so consumers stop hand-rolling it per entity.

**Status:** v0.1 shipping. 11 tests green.

- [docs/00-charter.md](docs/00-charter.md) — broader scope (compile-time deps, loaders, typed queries) deferred until concrete workloads demand them
- [src/index.ts](src/index.ts) — runtime (entire surface fits in ~30 LOC)

## Shipping API

```ts
import { collection } from '@place/data'
import { state } from '@place/reactivity'

interface Note { id: string; title: string; tags: readonly string[] }

const notes = state<Note[]>([])
const c = collection<Note>(notes, { sortBy: (a, b) => a.title.localeCompare(b.title) })

c.add({ id: 'a', title: 'first', tags: ['x'] })
c.get('a')                          // → { id: 'a', title: 'first', tags: ['x'] }
c.update('a', { title: 'updated' }) // merges patch
c.remove('a')
c.all()                             // reactive, sorted
```

### `collection<T>(state, options?)`

```ts
function collection<T>(s: State<T[]>, options?: {
  id?: (item: T) => string             // default: (item) => item.id
  sortBy?: (a: T, b: T) => number      // default: insertion order
}): Collection<T>

interface Collection<T> {
  all(): readonly T[]                  // reactive, fresh array per call
  get(key: string): T | null           // reactive
  add(item: T): void
  update(key: string, patch: Partial<T>): void
  remove(key: string): void
}
```

**The state stays exposed** — wrapping it with `persistedState`, `crossTabAdapter`, `serverAdapter`, `history`, anything else is unchanged. The collection is just the keyed-array shape.

## What this replaced in the commonplace book

```ts
// Before: ~40 lines of hand-rolled CRUD
function noteStoreFromCell(notes: State<Note[]>): NoteStore {
  const sorted = () => [...notes.read()].sort((a, b) => b.createdAt - a.createdAt)
  return {
    all: sorted,
    get(id) { return notes.read().find((n) => n.id === id) ?? null },
    create(input) {
      const id = newId()
      const now = Date.now()
      const note = { id, ...input, createdAt: now, updatedAt: now }
      notes.write([...notes.read(), note])
      return id
    },
    update(id, patch) {
      notes.write((prev) => prev.map((n) =>
        n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n,
      ))
    },
    remove(id) { notes.write((prev) => prev.filter((n) => n.id !== id)) },
  }
}

// After: ~14 lines. Domain logic (id, timestamps) stays. Plumbing gone.
function noteStoreFromCell(notes: State<Note[]>): NoteStore {
  const c = collection<Note>(notes, { sortBy: (a, b) => b.createdAt - a.createdAt })
  return {
    all: c.all,
    get: c.get,
    remove: c.remove,
    create(input) {
      const id = newId()
      const now = Date.now()
      c.add({ ...input, id, createdAt: now, updatedAt: now })
      return id
    },
    update(id, patch) {
      c.update(id, { ...patch, updatedAt: Date.now() })
    },
  }
}
```

The commonplace store still owns its *domain* logic — id generation, automatic `updatedAt`, the createdAt sort policy. Plumbing (the array manipulation) is delegated. Add a second entity tomorrow, you write the domain wrapper, you don't reinvent CRUD.

## Design rationale

- **The collection wraps a state, not the other way around.** Composes with everything reactive (persistedState, history, crossTab, serverAdapter) without ceremony.
- **Domain stays out.** No auto-id, no auto-timestamp, no validation. Those are policies the consumer picks. The primitive does only what's universal: keyed CRUD over an array.
- **No internal indexes.** `get(id)` is O(n). For 3-100 items this beats maintaining a parallel Map (write amplification, GC churn). When a workload actually needs sub-linear lookups, an opt-in `index` option lazily builds a Map on first read; for now, keep it tiny and predictable.

## What's deferred

Each will land when a concrete workload demands it. Listed in priority of likely future need:

- **Indexes** — `index: 'tag'` builds a `Map<tag, T[]>` lazily on read; updates incrementally. Pays off when `findBy('tag', x)` is called many times per render and the collection is large.
- **Pagination / windowed queries** — for collections that are too large to walk per render.
- **Schema validation** — Zod / Valibot externally. Don't bake in.
- **Optimistic concurrency / version fields** — for the eventual CRDT story atop `serverAdapter`.
- **Soft delete / trash** — easy enough to layer in user code today; primitive when it repeats.
- **Cross-collection joins / queries** — the original "data system" charter scope. Wait for two real entities first.
