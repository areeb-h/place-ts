// `curve(source, fn)` — arbitrary signal-to-signal interpolation,
// no time axis.
//
// Reads a source signal; passes its value through a pure curve
// function; returns the result as a derived signal.
//
// Useful for cases where you have a continuous input (a slider, a
// scroll position, a derived value) and want to shape its mapping to
// some output — e.g., applying an easing curve to a scroll percentage
// to make the resulting opacity feel less linear.
//
// The curve function is pure: same input, same output. No internal
// state. This is just `derived(() => fn(source()))` with a clearer
// name for the use case.

import type { Derived } from '../index.ts'
import { derived } from '../index.ts'

/**
 * Map a source signal through a pure curve function.
 *
 *   const opacity = curve(() => scroll() / max, easeOutCubic)
 *   // opacity(0) = 0, opacity(0.5) = 0.875, opacity(1) = 1
 */
export function curve(source: () => number, fn: (raw: number) => number): Derived<number> {
  return derived(() => fn(source()))
}
