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
// **Per-render isolation via a capability (0.10.10).**
//
// Pre-0.10.10: a module-level `currentInlineStyleSet` `let` was
// reassigned on `_beginInlineStyleCollection()` and nulled on
// `_endInlineStyleCollection()`. Under `renderToString` (synchronous)
// this works — no other request can interleave between begin and
// end. But the begin/end window in `render-page.ts` spans a few
// post-render hooks (`ssrProps`, `transformBody`) which are
// contractually sync but a future async violation of the contract
// would silently corrupt one request's collector with another's
// hashes.
//
// **Pre-computed hashes at insert (0.10.10).**
//
// Pre-0.10.10 the collector was a `Set<string>` of style VALUES and
// renderPage did `Promise.all([...set].map(sha256Base64))` at
// render-end — N async hashes batched at the worst possible spot,
// blocking the response. Now the collector is `Map<style, hash>`;
// `node:crypto`'s synchronous `createHash` runs during the JSX walk
// (microsecond cost per style), and renderPage just reads the
// Map's values at end time. The render-end Promise.all is gone.

import { createHash } from 'node:crypto'

import { defineCapability } from '@place-ts/capability'

/** Internal: the per-render inline-style hash collector. Installed
 *  by `_beginInlineStyleCollection`, disposed by
 *  `_endInlineStyleCollection`. Map keys are the raw inline `style="…"`
 *  values (the browser hashes pre-escape); values are the base64
 *  SHA-256 digests for the CSP `style-src` directive. */
const InlineStyleSetCap = defineCapability<Map<string, string>>('PlaceInlineStyleSet')

// Stack of disposers, one per active begin scope. The renderPage flow
// only ever has ONE collector active per render — defensive trampoline
// for future nested callers.
const _disposers: Array<() => void> = []

/**
 * Sync base64-encoded SHA-256 of a string. Bun ships `node:crypto`,
 * so `createHash` is available without an extension. We use it here
 * because the alternative (`crypto.subtle.digest`) is ASYNC, and we
 * want to compute hashes during the synchronous JSX walk — async
 * would either block render or force us back to batch-at-end with
 * its render-time latency cost.
 */
function syncSha256Base64(input: string): string {
  return createHash('sha256').update(input).digest('base64')
}

/** Internal: read the current inline-style collector. Returns `null`
 *  when no collection scope is active (matches pre-0.10.10 shape).
 *  Callers add a style via `addInlineStyle()` so the hash is computed
 *  on insert. */
export function currentInlineStyleSet(): Map<string, string> | null {
  return InlineStyleSetCap.tryUse()
}

/**
 * Internal: record a style="…" value for CSP whitelisting. Hashes
 * synchronously on insert (Map dedupes by value — second call with
 * the same string is a no-op). Idempotent + sync; safe to call from
 * inside the JSX walk.
 *
 * Returns `true` if a collector was active and the style was
 * recorded, `false` if no collection scope is open (e.g. ad-hoc
 * `renderToString` outside renderPage). Callers don't generally
 * check the return.
 */
export function addInlineStyle(styleValue: string): boolean {
  const map = InlineStyleSetCap.tryUse()
  if (map === null) return false
  // Map dedupes on the key — skip the hash if we've already recorded
  // this exact style value this render.
  if (map.has(styleValue)) return true
  map.set(styleValue, syncSha256Base64(styleValue))
  return true
}

/** Internal: start a fresh inline-style-attr collection scope.
 *  Returns the underlying Map so the caller (renderPage) can read
 *  its hashed values at end time. */
export function _beginInlineStyleCollection(): Map<string, string> {
  const map = new Map<string, string>()
  const dispose = InlineStyleSetCap.install(map)
  _disposers.push(dispose)
  return map
}

/** Internal: end the inline-style-attr collection scope. */
export function _endInlineStyleCollection(): void {
  const d = _disposers.pop()
  if (d !== undefined) d()
}
