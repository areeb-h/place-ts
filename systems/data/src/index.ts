// @place-ts/data — data primitives over @place-ts/reactivity.
//
// Ships ONE primitive: `collection<T>(state, options?)`. Keyed CRUD
// over a `State<T[]>` with reactive lookups and optional sorting —
// the boring half of "I need an entity store", which otherwise gets
// hand-rolled per entity.
//
// Design rationale:
//   - Primitive operates on a `State<T[]>`, NOT on an opaque store
//     wrapper. The state stays exposed; consumers can compose with
//     `persistedState`, `history`, `crossTabAdapter`, etc. unchanged.
//   - Domain logic (id generation, timestamps, validation) lives in the
//     consumer, not here. The collection just handles the keyed array
//     manipulation — an entity store becomes a thin wrapper around
//     `collection<Note>(notes)` that adds id + timestamps in `create`.
//   - No internal indexes / Map for v0.1. `get(id)` is O(n) over the
//     array; `all()` is O(n log n) when sorted. For 3-100 items this
//     is faster than maintaining a parallel Map (write amplification).
//     When a real workload needs sub-linear lookups, add an `index`
//     option that builds a Map lazily on read.
//
// What's deferred:
//   - Indexes (`index: 'tag'` building a Map from tag → items[])
//   - Pagination / windowed queries
//   - Joins / cross-collection queries
//   - Schema validation (use Zod / Valibot externally)
//   - Optimistic concurrency / version fields
//   - Soft deletes / trash
//
// Each will land when a workload demands it. Anti-bloat over speculation.

import type { State } from '@place-ts/reactivity'

export interface CollectionOptions<T> {
  /**
   * Extract the key from an item. Defaults to `(item) => item.id`,
   * which assumes `T` has a string `id` property. Pass a function for
   * differently-named keys (`(user) => user.uuid`) or composite keys
   * (`(item) => `${item.org}:${item.slug}``).
   */
  id?: (item: T) => string
  /**
   * Comparator for `all()`. When omitted, items return in insertion
   * order. Standard JS comparator: negative if a sorts before b.
   */
  sortBy?: (a: T, b: T) => number
}

export interface Collection<T> {
  /**
   * Reactive list of all items, sorted via `sortBy` if provided.
   * Returns a fresh array per call — safe to mutate the result without
   * affecting the collection (the underlying state's array is not
   * exposed).
   */
  all(): readonly T[]
  /** Reactive lookup by key. Returns null when no item matches. */
  get(key: string): T | null
  /**
   * Append an item. Caller is responsible for ensuring the key is
   * unique — duplicates are NOT auto-rejected here (consumers may want
   * upsert semantics, validation, etc.; doing it would couple the
   * primitive to a particular policy).
   */
  add(item: T): void
  /**
   * Merge `patch` into the item with the given key. No-op if not
   * found. The merged object replaces the original by identity, so
   * downstream watchers fire (the underlying state's `equals` is
   * `Object.is`).
   */
  update(key: string, patch: Partial<T>): void
  /** Remove the item with the given key. No-op if not found. */
  remove(key: string): void
}

/**
 * Build a keyed CRUD interface over a `State<T[]>`.
 *
 * ```ts
 * interface Note { id: string; title: string; tags: string[] }
 * const notes = state<Note[]>([])
 * const c = collection<Note>(notes, {
 *   sortBy: (a, b) => a.title.localeCompare(b.title),
 * })
 *
 * c.add({ id: 'a', title: 'first', tags: [] })
 * c.get('a')              // → { id: 'a', title: 'first', tags: [] }
 * c.update('a', { title: 'updated' })
 * c.remove('a')
 * c.all()                 // reactive, sorted
 * ```
 *
 * Composition: the underlying `State<T[]>` stays exposed, so wrapping
 * it with `persistedState`, `crossTabAdapter`, `history`, etc. works
 * unchanged. The collection is just the CRUD-shape helper.
 */
export function collection<T>(s: State<T[]>, options?: CollectionOptions<T>): Collection<T> {
  const idOf = options?.id ?? ((item: T) => (item as { id: string }).id)
  const sortBy = options?.sortBy

  return {
    all(): readonly T[] {
      const list = s.read()
      return sortBy === undefined ? list : [...list].sort(sortBy)
    },
    get(key: string): T | null {
      return s.read().find((item) => idOf(item) === key) ?? null
    },
    add(item: T): void {
      const newKey = idOf(item)
      const list = s.read()
      // Refuse duplicates loudly. Two items with the same key would
      // make `get` silently return only the first; `update` and
      // `remove` would touch only one of them. The bugs that produces
      // are the kind that ship to prod and surface six months later.
      if (list.some((existing) => idOf(existing) === newKey)) {
        throw new Error(
          `collection: duplicate key ${JSON.stringify(newKey)}. ` +
            'Each item must have a unique key. Use update() to modify an existing item.',
        )
      }
      s.write([...list, item])
    },
    update(key: string, patch: Partial<T>): void {
      s.write((prev) =>
        prev.map((item) => {
          if (idOf(item) !== key) return item
          const merged = { ...item, ...patch }
          // Renaming via update would break the get / remove contract
          // on either key. Force the user to be explicit (remove + add)
          // for that operation.
          const mergedKey = idOf(merged)
          if (mergedKey !== key) {
            throw new Error(
              `collection: update would change the key from ${JSON.stringify(key)} ` +
                `to ${JSON.stringify(mergedKey)}. Renames are not allowed via update — ` +
                'use remove() + add() instead.',
            )
          }
          return merged
        }),
      )
    },
    remove(key: string): void {
      s.write((prev) => prev.filter((item) => idOf(item) !== key))
    },
  }
}
