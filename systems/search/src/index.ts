// @place-ts/search — reactive search over @place-ts/reactivity collections.
//
// v0.1 ships ONE primitive: `searchable`. It takes a reactive collection
// plus a field extractor, and returns a function that accepts a reactive
// query and gives back a reactive filtered list. Substring match,
// case-insensitive, AND-of-whitespace-separated-tokens.
//
// Why so small:
//   - Storage interfaces shouldn't have a `search` method baked in.
//     Search is a separate concern; coupling it to one store shape
//     locks every future store into re-implementing the same filter.
//   - Most apps want the same boring substring-on-fields search. Until a
//     real workload demands ranking, fuzzy match, or indexed lookups,
//     don't ship them.
//
// Deferred — only build when a concrete trigger emerges:
//   - Ranking / scoring (currently filter is unsorted beyond input order)
//   - Stemming, fuzzy match, edit distance
//   - Inverted indexes for sub-linear search (needs a workload that's
//     actually slow — current commonplace book runs at <10 notes)
//   - Capability slot for swappable backends. Add when a second impl
//     (e.g., remote search) actually exists.

export interface SearchableOptions<T> {
  /** Returns the strings to search within, for one item. */
  fields: (item: T) => readonly string[]
  /** When true, exact case must match. Default false. */
  caseSensitive?: boolean
}

/**
 * Build a reactive search function over a reactive collection.
 *
 * ```ts
 * const filtered = searchable(store.all, {
 *   fields: (n) => [n.title, n.content, ...n.tags],
 * })(() => query.read())
 * // filtered is () => readonly Note[], reactive on both items and query.
 * ```
 *
 * The returned function takes the query getter (reactive) and yields a
 * getter that recomputes when either the items or the query change.
 *
 * **Tokenization:** the query is split on whitespace; an item matches
 * when EVERY non-empty token appears in some field (substring match,
 * case-insensitive by default). An empty query returns the unfiltered
 * list.
 *
 * **Case folding:** uses `toLocaleLowerCase('en')` rather than the
 * default `toLowerCase()` — the default is locale-dependent and
 * misfolds the Turkish dotted/dotless I (`İ` → `i̇` in tr locale)
 * which silently breaks substring match across runtimes set to those
 * locales. Pinning to `'en'` makes the fold deterministic everywhere.
 * Pass `caseSensitive: true` if you actually want case-strict.
 *
 * **Performance:** per-item lowercased fields are memoised by item
 * identity (`WeakMap<T, string[]>`) so repeated queries against the
 * same item array don't re-lowercase the whole haystack on every
 * keystroke. Items that leave the collection are GC'd from the cache
 * with their objects. The cache is invalidated naturally — a fresh
 * item object (the typical pattern from `collection.update`) is a
 * cache miss and re-lowercases. If you mutate items in place AND want
 * the search to track the mutation, replace the item reference too.
 */
export function searchable<T>(
  items: () => readonly T[],
  options: SearchableOptions<T>,
): (query: () => string) => () => readonly T[] {
  const norm: (s: string) => string = options.caseSensitive
    ? (s: string) => s
    : (s: string) => s.toLocaleLowerCase('en')

  // Per-item lowercased-haystack cache. Object items get a WeakMap
  // entry (auto-GC); non-object items (e.g. plain strings, numbers)
  // can't be WeakMap keys, so they get a separate Map. The cache is
  // never explicitly cleared — orphan WeakMap entries collect with
  // the items they keyed; the Map for primitive keys grows with
  // distinct primitive values, which is bounded by the input domain.
  const objectCache = new WeakMap<object, readonly string[]>()
  const primitiveCache = new Map<unknown, readonly string[]>()
  const haystacksFor = (item: T): readonly string[] => {
    if (item !== null && (typeof item === 'object' || typeof item === 'function')) {
      const cached = objectCache.get(item as object)
      if (cached !== undefined) return cached
      const computed = options.fields(item).map(norm)
      objectCache.set(item as object, computed)
      return computed
    }
    const cached = primitiveCache.get(item)
    if (cached !== undefined) return cached
    const computed = options.fields(item).map(norm)
    primitiveCache.set(item, computed)
    return computed
  }

  return (query) => () => {
    const tokens = norm(query()).split(/\s+/).filter(Boolean)
    const all = items()
    if (tokens.length === 0) return all
    return all.filter((item) => {
      const haystacks = haystacksFor(item)
      return tokens.every((tok) => haystacks.some((h) => h.includes(tok)))
    })
  }
}
