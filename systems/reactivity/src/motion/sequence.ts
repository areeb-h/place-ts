// `sequence(keyframes, opts)` — chained keyframes over a timeline.
//
// Reads the current clock; returns a derived value that interpolates
// between consecutive keyframes based on the clock time.
//
// Keyframes are anchored to absolute times measured from the clock
// value at sequence-construction (the first read locks the baseline).
// If you need a sequence that restarts on a state change, wrap it in
// a parent derivation that reconstructs it.

import { derived } from '../index.ts'
import type { Derived } from '../index.ts'
import { clock } from './clock.ts'
import { type EasingFn, resolveEasing } from './easing.ts'

export interface Keyframe {
  /** Time offset (ms) from the sequence baseline. */
  at: number
  /** Target value at this time. */
  value: number
  /**
   * Easing for the segment ENDING at this keyframe (i.e. how to
   * interpolate from the prior keyframe's value to this one). Default
   * for non-first frames: `'ease-out-cubic'`. Ignored on the first
   * keyframe (no segment to ease).
   */
  easing?: EasingFn
}

export interface SequenceOptions {
  /** Override the clock (test only). */
  clock?: () => number
}

/**
 * Run a sequence of keyframes over a timeline. Returns a derived signal
 * that holds the interpolated value at the current clock time.
 *
 * Behavior at edges:
 *   - Before the first keyframe's `at`: value is the first keyframe's value.
 *   - After the last keyframe's `at`: value is the last keyframe's value.
 *   - Between keyframes N and N+1: linear-time-mapping with N+1's easing.
 *
 * Keyframes must be sorted by `at` ascending; out-of-order input throws.
 */
export function sequence(
  keyframes: readonly Keyframe[],
  opts: SequenceOptions = {},
): Derived<number> {
  if (keyframes.length === 0) {
    throw new Error('sequence: at least one keyframe required')
  }
  for (let i = 1; i < keyframes.length; i++) {
    const prev = keyframes[i - 1] as Keyframe
    const curr = keyframes[i] as Keyframe
    if (curr.at < prev.at) {
      throw new Error(
        `sequence: keyframes must be sorted by \`at\` ascending; index ${i} (at=${curr.at}) < index ${i - 1} (at=${prev.at})`,
      )
    }
  }
  const tickClock = opts.clock ?? clock
  let baseT: number | null = null

  return derived(() => {
    const now = tickClock()
    if (baseT === null) baseT = now
    const t = now - baseT
    const first = keyframes[0] as Keyframe
    if (t <= first.at) return first.value
    const last = keyframes[keyframes.length - 1] as Keyframe
    if (t >= last.at) return last.value
    // Linear scan: animations rarely have >10 keyframes; bisection is
    // overkill. Find the segment (prev, next) such that prev.at < t < next.at.
    for (let i = 1; i < keyframes.length; i++) {
      const prev = keyframes[i - 1] as Keyframe
      const next = keyframes[i] as Keyframe
      if (t < next.at) {
        const span = next.at - prev.at
        if (span <= 0) return next.value // co-located keyframes — jump
        const k = resolveEasing(next.easing)((t - prev.at) / span)
        return prev.value + (next.value - prev.value) * k
      }
    }
    // Unreachable given the early-return on `t >= last.at`.
    return last.value
  })
}
