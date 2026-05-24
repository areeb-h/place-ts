// Per-render hydration-id counter.
//
// Extracted from index.ts (Tier 20 decomposition). `el()` and the SSR
// string emitter stamp each hydratable element with a sequential
// `data-h` id; `renderToString` / `renderToStream` reset the counter
// at the start of each render so ids are stable per document.
//
// **Per-render isolation via a capability (0.10.10).**
//
// Pre-0.10.10 this was a `let hydrationSeq = 0` module-level counter.
// Under synchronous `renderToString` no concurrent request could
// interleave between `resetHydrationSeq()` and the final
// `nextHydrationId()` call — Bun's single-threaded runtime served
// the entire body before yielding. But `renderToStream` IS async
// (chunks yield between writes), and two concurrent stream renders
// would clobber each other's counters, producing duplicate `data-h`
// ids across requests and breaking hydration.
//
// The cap-backed counter (below) gives each render its own counter
// instance, scoped by `@place-ts/capability`'s AsyncLocalStorage.
// `resetHydrationSeq()` installs a fresh `{ value: 0 }` box; every
// subsequent `nextHydrationId()` call within the same async chain
// reads + bumps that box. Concurrent renders get isolated boxes.
//
// Falls back to a module-level counter when called outside any
// capability scope (test harnesses, app boot, ad-hoc
// `renderToString`-as-utility) — matches pre-0.10.10 behaviour for
// those paths.

import { defineCapability } from '@place-ts/capability'

/** Per-render hydration-id counter. The cap holds a boxed number so
 *  `nextHydrationId()` can mutate in place; bare `number` would be
 *  copied on every read. */
const HydrationSeqCap = defineCapability<{ value: number }>('PlaceHydrationSeq')

// Module-level fallback for code paths that don't open a cap scope
// (tests, app boot, direct `renderToString` calls without renderPage).
// Preserves the pre-0.10.10 behaviour for those.
let _fallbackSeq = 0

/** Next hydration id. Monotonic within a render; reset between renders. */
export function nextHydrationId(): number {
  const scope = HydrationSeqCap.tryUse()
  if (scope !== null) return scope.value++
  return _fallbackSeq++
}

/** Reset the counter — called once at the start of each SSR render.
 *  Inside a capability scope, installs a fresh counter box. Outside
 *  any scope (e.g. test harness), resets the module-level fallback. */
export function resetHydrationSeq(): void {
  const scope = HydrationSeqCap.tryUse()
  if (scope !== null) {
    scope.value = 0
    return
  }
  _fallbackSeq = 0
}

/** Internal: begin a hydration-counter scope. Returns a disposer.
 *  Called by `renderPage` (and `renderToStream`) so each render gets
 *  its own counter that can't be clobbered by a concurrent request.
 *  Idempotent on disposer side. */
export function _beginHydrationSeq(): () => void {
  return HydrationSeqCap.install({ value: 0 })
}
