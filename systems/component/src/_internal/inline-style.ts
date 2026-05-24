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
// hashes. The CSP misalignment that followed would block legit
// inline styles in the user's browser with no server-side warning.
//
// The capability shape replaces the `let` with a per-request stack
// installed inside `@place-ts/capability`'s `runWithCapabilityScope`
// (which `serve()` opens around every dispatch). Concurrent requests
// get isolated stacks via AsyncLocalStorage; the legacy public API
// (`_beginInlineStyleCollection` / `_endInlineStyleCollection`) keeps
// the same return shape and side-effect semantics for callers.

import { defineCapability } from '@place-ts/capability'

/** Internal: the per-render inline-style hash collector. Installed
 *  by `_beginInlineStyleCollection`, disposed by `_endInlineStyleCollection`.
 *  Read by `element.ts` via `currentInlineStyleSet()`. */
const InlineStyleSetCap = defineCapability<Set<string>>('PlaceInlineStyleSet')

// Stack of disposers, one per active begin scope. The renderPage flow
// only ever has ONE collector active per render — these are stored
// per-request so the disposer ALSO lives per-request. But ALS scopes
// don't survive disposer calls across await boundaries cleanly when
// the caller stores them outside the scope; we keep a per-cap stack
// here as a defensive trampoline. (In practice render-page begins +
// ends in the same async tick, so the stack is always at most 1 deep.)
const _disposers: Array<() => void> = []

/** Internal: read the current inline-style collector. Returns `null`
 *  when no collection scope is active (matches pre-0.10.10 shape).
 *  Callers expect to `.add()` directly when non-null. */
export function currentInlineStyleSet(): Set<string> | null {
  return InlineStyleSetCap.tryUse()
}

/** Internal: start a fresh inline-style-attr collection scope.
 *  Returns the underlying Set so the caller (renderPage) can read
 *  its contents at end time. */
export function _beginInlineStyleCollection(): Set<string> {
  const set = new Set<string>()
  const dispose = InlineStyleSetCap.install(set)
  _disposers.push(dispose)
  return set
}

/** Internal: end the inline-style-attr collection scope. */
export function _endInlineStyleCollection(): void {
  const d = _disposers.pop()
  if (d !== undefined) d()
}
