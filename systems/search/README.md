# Search System

Reactive search primitives over `@place/reactivity` collections. v0.1 ships one function and earns its keep by getting search OUT of every store interface.

**Status:** v0.1 shipping. 11 tests green.

- [docs/00-charter.md](docs/00-charter.md) — scope and dependencies
- [src/index.ts](src/index.ts) — runtime (entire surface fits in ~30 LOC)

## Shipping API

```ts
import { searchable } from '@place/search'

const find = searchable(() => store.all(), {
  fields: (note) => [note.title, note.content, ...note.tags],
})
const filtered = find(() => query.read())
// filtered() returns the matching notes; reactive on both items and query.
```

### `searchable(items, options)`

```ts
function searchable<T>(
  items: () => readonly T[],
  options: {
    fields: (item: T) => readonly string[]
    caseSensitive?: boolean   // default false
  },
): (query: () => string) => () => readonly T[]
```

Returns a function that takes a reactive query getter and yields a reactive filtered list. **Substring match, AND-of-whitespace-tokens.** An item matches when *every* non-empty token in the query appears in *some* field. Empty / whitespace-only query returns the unfiltered list.

The returned filter is reactive on **both** the items collection and the query — wire either to a `state` and the filter recomputes when it changes.

### Why so small

A "search" method baked into the storage interface is a category error. Storage is storage; retrieval is retrieval. Coupling them locks every future store into re-implementing the same filter, blocks search-strategy swaps (substring → fuzzy → indexed → external), and bloats the storage contract.

The commonplace book makes this concrete. Before v0.1 of `@place/search`, `NoteStore` had a `search(query)` method. After: `NoteStore` is back to its actual job — `all/get/create/update/remove`. The Note-specific search is a 3-line helper composed at the call site:

```ts
export const searchNotes = (store: NoteStore) =>
  searchable(store.all, { fields: (n) => [n.title, n.content, ...n.tags] })
```

## What's deferred

Each of these has been considered. None has a concrete trigger in the current workload (3 notes; commonplace book at `<10` typically). Build them when there's an actual workload, not before.

- **Ranking / scoring** — currently filter is unsorted beyond input order.
- **Stemming, fuzzy match, edit distance.**
- **Inverted indexes** for sub-linear search — needs a workload that's actually slow.
- **Capability slot for swappable backends** — add when a second impl (e.g., remote search) exists.
- **Semantic search / embeddings.**
