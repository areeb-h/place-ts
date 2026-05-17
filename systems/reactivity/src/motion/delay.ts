// `delay(source, ms)` — debounced reactive read (Tier 17-E v2 DX).
//
// Returns a `Derived<T>` that lags behind `source` by `ms`
// milliseconds. Useful for "show after a beat" patterns without
// reaching for setTimeout + state ceremony.
//
// Usage:
//   const visible = state(false)
//   // Spinner shows only after 200ms of `loading=true` —
//   // sub-100ms work doesn't flash a spinner.
//   const showSpinner = delay(() => visible(), 200)
//
//   const hovered = state(false)
//   // Tooltip appears after 300ms of hover, hides 80ms after
//   // unhover; symmetric delay on both edges.
//   const tooltipOpen = delay(() => hovered(), 300)

import { derived, untrack } from '../index.ts'
import type { Derived } from '../index.ts'
import { clock } from './clock.ts'

export interface DelayOptions {
  /** Override the clock (test only). */
  clock?: () => number
}

/**
 * Reactive value that lags `source` by `ms` milliseconds. The
 * returned derived value updates exactly when the delay window has
 * elapsed since the source last changed — no `setTimeout`, no
 * cleanup ceremony, no race conditions on rapid changes.
 *
 * Both edges (rising AND falling) are delayed symmetrically. For
 * asymmetric behavior (e.g. "show after a beat, hide instantly")
 * compose your own `derived()` over two delayed values.
 *
 * Implementation: subscribes to both `source` AND the clock. On a
 * source change, records the deadline (clock + ms). On every clock
 * tick, checks whether the deadline has passed; if yes, returns the
 * latest source value; if no, returns the previously-emitted value.
 */
export function delay<T>(source: () => T, ms: number, opts: DelayOptions = {}): Derived<T> {
  const tickClock = opts.clock ?? clock
  let emitted = untrack(source)
  let pending: T = emitted
  let deadline: number | null = null

  return derived(() => {
    const next = source()
    const t = tickClock()
    if (next !== pending) {
      pending = next
      deadline = t + ms
    }
    if (deadline !== null && t >= deadline) {
      emitted = pending
      deadline = null
    }
    return emitted
  })
}
