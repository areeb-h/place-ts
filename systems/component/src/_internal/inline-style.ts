// Per-request inline-style-attribute hash collector.
//
// Extracted from index.ts (Tier 20 decomposition, cut 5b). T6-B: a
// per-render collection of inline `style="…"` attribute VALUES. Each
// unique value is hashed (SHA-256) by the dispatcher and added to the
// response's CSP `style-src` directive along with `'unsafe-hashes'`,
// so strict CSP allows the specific inline styles SSR emitted without
// resorting to `'unsafe-inline'`. This preserves the ADR 0014 contract
// for the client path (style:* directives still write via
// `setProperty` at runtime) while letting the SSR pass keep emitting
// first-paint inline styles that the CSP authoritatively whitelists.
//
// Why a per-request collector, not a build-time list: the values are
// reactive — `style={() => …}` resolves per-render. The hash set is
// per-response.
//
// Lives in `_internal/` so the SSR emitter (`element.ts`) and the
// renderPage / dispatch path (`index.ts`) share one live binding
// without importing through the index barrel.

// The SSR emitter collects style hashes into this set. A live binding —
// `_begin/_endInlineStyleCollection` reassign it; `element.ts` only
// reads + `.add()`s, never reassigns.
export let currentInlineStyleSet: Set<string> | null = null

/** Internal: start a fresh inline-style-attr collection scope. */
export function _beginInlineStyleCollection(): Set<string> {
  const set = new Set<string>()
  currentInlineStyleSet = set
  return set
}

/** Internal: end the inline-style-attr collection scope. */
export function _endInlineStyleCollection(): void {
  currentInlineStyleSet = null
}
