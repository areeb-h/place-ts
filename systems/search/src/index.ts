// @place/search — reactive search over @place/reactivity collections.
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
 * Tokenization: the query is split on whitespace; an item matches when
 * EVERY non-empty token appears in some field (substring match). An
 * empty query returns the unfiltered list.
 */
export function searchable<T>(
  items: () => readonly T[],
  options: SearchableOptions<T>,
): (query: () => string) => () => readonly T[] {
  const norm = options.caseSensitive ? (s: string) => s : (s: string) => s.toLowerCase()

  return (query) => () => {
    const tokens = norm(query()).split(/\s+/).filter(Boolean)
    const all = items()
    if (tokens.length === 0) return all
    return all.filter((item) => {
      const haystacks = options.fields(item).map(norm)
      return tokens.every((tok) => haystacks.some((h) => h.includes(tok)))
    })
  }
}
