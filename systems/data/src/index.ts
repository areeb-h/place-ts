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

import { state as _state, type State } from '@place-ts/reactivity'

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

/** Options for `all()` and `get()`. */
export interface CollectionReadOptions {
  /**
   * When `true`, include items currently in trash (soft-deleted via
   * `trash(key)`). Default `false` — trashed items are filtered out.
   */
  includeTrash?: boolean
}

/** Options for `cursor()`. */
export interface CollectionCursorOptions {
  /**
   * Return items whose key is strictly AFTER `after`. When omitted,
   * start from the beginning. Pass the `next` value from a previous
   * `cursor()` result to paginate.
   *
   * Ordering: keys are compared with the active `sortBy` ordering
   * (the sorted index of each item is the cursor reference point).
   * Without `sortBy`, insertion order is used.
   */
  after?: string | undefined
  /** Maximum number of items to return. Must be ≥ 1. */
  limit: number
}

/** Page of items returned by `cursor()`. */
export interface CollectionPage<T> {
  /** Items on this page (up to `limit`). */
  readonly items: readonly T[]
  /**
   * Key to pass as `after` on the next `cursor()` call. `null` when
   * this page contains the last items (no more to fetch).
   */
  readonly next: string | null
}

export interface Collection<T> {
  /**
   * Reactive list of all items, sorted via `sortBy` if provided.
   * Returns a fresh array per call — safe to mutate the result without
   * affecting the collection (the underlying state's array is not
   * exposed).
   *
   * Trashed items (soft-deleted via `trash(key)`) are filtered out by
   * default. Pass `{ includeTrash: true }` to include them.
   */
  all(opts?: CollectionReadOptions): readonly T[]
  /**
   * Reactive lookup by key. Returns null when no item matches OR when
   * the item is trashed (unless `{ includeTrash: true }`).
   */
  get(key: string, opts?: CollectionReadOptions): T | null
  /**
   * Cursor-based pagination over the sorted view (0.8.0). Returns up
   * to `limit` items, starting strictly after the key in `opts.after`
   * (or from the beginning when omitted). Trashed items are skipped.
   *
   * Reactive: re-runs when the underlying collection or trash set
   * changes. Use for chunked list rendering, infinite-scroll feeds,
   * "load more" buttons.
   *
   * ```ts
   * let cur: string | null = null
   * const loadMore = () => {
   *   const page = c.cursor({ after: cur ?? undefined, limit: 20 })
   *   shown.write([...shown.read(), ...page.items])
   *   cur = page.next
   * }
   * ```
   */
  cursor(opts: CollectionCursorOptions): CollectionPage<T>
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
  /**
   * Remove the item with the given key from the underlying state.
   * No-op if not found. **Hard delete** — for soft delete that can be
   * undone, use `trash()` + `restore()`.
   */
  remove(key: string): void
  /**
   * Mark an item as trashed (soft delete, 0.8.0). The item stays in
   * the underlying state but is filtered out of `all()` / `get()` by
   * default. Undo via `restore(key)`. Hard-delete via `remove(key)`.
   *
   * Trash state lives in the collection (not the items themselves)
   * so it doesn't pollute the item type. Reactive: a `trash()` call
   * fires downstream watchers on `all()` / `get()`.
   */
  trash(key: string): void
  /** Restore a trashed item to visibility. No-op if not trashed. */
  restore(key: string): void
  /** Reactive list of currently-trashed keys. */
  trashedKeys(): readonly string[]
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
  // **Reactive trash set** (0.8.0). Lives in its own state cell so
  // reads of `all()` / `get()` / `cursor()` track it — when a
  // `trash(key)` call fires, downstream watchers see the change.
  // Stored as a State<readonly string[]> (an array, not a Set) because
  // State's default `equals` is `Object.is`: writing a fresh array
  // reference is what triggers downstream reactivity. Wrapping the
  // array in a Set inside trashedSet() gives O(1) lookups.
  const trashed: State<readonly string[]> = _state<readonly string[]>([])

  /** Read the trashed set as a Set for O(1) lookup. */
  const trashedSet = (): Set<string> => new Set(trashed.read())

  return {
    all(opts?: CollectionReadOptions): readonly T[] {
      const list = s.read()
      const trash = trashedSet()
      const visible =
        opts?.includeTrash || trash.size === 0
          ? list
          : list.filter((item) => !trash.has(idOf(item)))
      return sortBy === undefined ? visible : [...visible].sort(sortBy)
    },
    get(key: string, opts?: CollectionReadOptions): T | null {
      if (!opts?.includeTrash && trashedSet().has(key)) return null
      return s.read().find((item) => idOf(item) === key) ?? null
    },
    cursor(opts: CollectionCursorOptions): CollectionPage<T> {
      if (opts.limit < 1) {
        throw new Error('collection.cursor: limit must be >= 1')
      }
      // Use the same sorted/filtered view `all()` produces — so cursor
      // walks the visible items in the same order users see them.
      const list = s.read()
      const trash = trashedSet()
      const visible = trash.size === 0 ? list : list.filter((item) => !trash.has(idOf(item)))
      const ordered = sortBy === undefined ? visible : [...visible].sort(sortBy)
      let startIdx = 0
      if (opts.after !== undefined) {
        const found = ordered.findIndex((item) => idOf(item) === opts.after)
        // Cursor refers to an item not in the visible set (deleted,
        // trashed, or never existed). Falling back to "start from 0"
        // would silently re-show items the user already saw; instead,
        // return an empty page so callers can detect "your cursor is
        // stale, restart pagination".
        if (found < 0) return { items: [], next: null }
        startIdx = found + 1
      }
      const slice = ordered.slice(startIdx, startIdx + opts.limit)
      const nextItem = ordered[startIdx + opts.limit - 1]
      const hasMore = startIdx + opts.limit < ordered.length
      return {
        items: slice,
        next: hasMore && nextItem !== undefined ? idOf(nextItem) : null,
      }
    },
    trashedKeys(): readonly string[] {
      return trashed.read()
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
      // Clean up trash bookkeeping in case the removed key was trashed.
      // Idempotent — no-op if not present.
      const set = trashedSet()
      if (set.has(key)) {
        set.delete(key)
        trashed.write([...set])
      }
    },
    trash(key: string): void {
      const set = trashedSet()
      if (set.has(key)) return
      set.add(key)
      trashed.write([...set])
    },
    restore(key: string): void {
      const set = trashedSet()
      if (!set.delete(key)) return
      trashed.write([...set])
    },
  }
}
