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

import type { Derived } from '../index.ts'
import { derived, untrack } from '../index.ts'
import { _retainClock, clock } from './clock.ts'

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
  // Clock retainer — held while waiting for a deadline, released once
  // the delay window has elapsed (deadline === null). Keeps the rAF
  // loop idle when no delays are pending (0.2.0).
  let _retain: (() => void) | null = null
  const _release = (): void => {
    if (_retain !== null) {
      _retain()
      _retain = null
    }
  }

  return derived(() => {
    const next = source()
    if (next !== pending) {
      // Subscribe to clock + retain only when there's something to wait for.
      const t = tickClock()
      pending = next
      deadline = t + ms
      if (_retain === null) _retain = _retainClock()
      return emitted
    }
    // No source change — only subscribe to clock if we're still waiting.
    if (deadline !== null) {
      const t = tickClock()
      if (t >= deadline) {
        emitted = pending
        deadline = null
        _release()
      }
    } else {
      // Settled — make sure we're not retaining.
      _release()
    }
    return emitted
  })
}
