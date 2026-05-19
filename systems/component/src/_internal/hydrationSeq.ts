// Process-global hydration-id counter.
//
// Extracted from index.ts (Tier 20 decomposition). `el()` and the SSR
// string emitter stamp each hydratable element with a sequential
// `data-h` id; `renderToString` / `renderToStream` reset the counter
// at the start of each render so ids are stable per document.
//
// It lives in `_internal/` so the element factory, the SSR emitters,
// and the component HOC can all share one counter without importing
// through the index barrel — which would form an import cycle once
// those modules are themselves extracted.

let hydrationSeq = 0

/** Next hydration id. Monotonic within a render; reset between renders. */
export function nextHydrationId(): number {
  return hydrationSeq++
}

/** Reset the counter — called once at the start of each SSR render. */
export function resetHydrationSeq(): void {
  hydrationSeq = 0
}
