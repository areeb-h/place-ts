// `tween(target, opts)` — duration + easing.
//
// Like `animate()` but with explicit duration semantics: the value
// reaches `target` exactly at `duration` ms after the most recent
// target change. The easing function shapes the curve.
//
// When `target` changes mid-tween, the tween restarts from the current
// value with a fresh duration. (This is the standard "re-target during
// animation" behavior; it can produce slightly faster overall settle
// when the target moves closer mid-flight, slightly slower when it
// moves further. Apps wanting strict from-to bounds should snapshot
// the value before re-targeting.)

import { derived, untrack } from '../index.ts'
import type { Derived } from '../index.ts'
import { clock } from './clock.ts'
import { type EasingFn, type EasingPreset, resolveEasing } from './easing.ts'

export interface TweenOptions {
  /** Total duration in milliseconds. */
  duration: number
  /** Easing function or named preset. Default: `'ease-out-cubic'`. */
  easing?: EasingFn | EasingPreset
  /** Override the clock (test only). */
  clock?: () => number
}

/**
 * Tween a numeric signal toward a target over `duration` ms with the
 * given easing. The returned `Derived<number>` re-evaluates on every
 * clock tick during the tween and settles at `target` after `duration`.
 *
 * **Duration shorthand** (Tier 17-E v2 DX): pass a bare number for
 * duration instead of the full options object. Easing defaults to
 * `'ease-out-cubic'`.
 *
 *   const x = tween(target, 300)                                  // shorthand
 *   const y = tween(target, { duration: 300, easing: 'easeInOut' }) // explicit
 */
export function tweenImpl(target: () => number, opts: TweenOptions | number): Derived<number> {
  // Normalize shorthand: a bare number becomes `{ duration: <ms> }`.
  const normalized: TweenOptions = typeof opts === 'number' ? { duration: opts } : opts
  const easing = resolveEasing(normalized.easing)
  const duration = Math.max(0, normalized.duration)
  const tickClock = normalized.clock ?? clock

  // Per-tween state. `startV` is the value at the moment the current
  // target was set; `startT` is the clock time then; `endV` is the
  // target. When `endV` changes, we re-snap `startV / startT`.
  let startV = untrack(target)
  let endV = startV
  let startT: number | null = null
  let currentV = startV

  return derived(() => {
    const t = tickClock()
    const goal = target()
    if (startT === null) {
      // First evaluation: no animation yet, sit at the goal.
      startT = t
      startV = goal
      endV = goal
      currentV = goal
      return currentV
    }
    if (goal !== endV) {
      // Re-target: snapshot from our current value over a fresh duration.
      startV = currentV
      endV = goal
      startT = t
    }
    if (duration === 0) {
      currentV = endV
      return currentV
    }
    const elapsed = t - startT
    if (elapsed <= 0) {
      currentV = startV
      return currentV
    }
    if (elapsed >= duration) {
      currentV = endV
      return currentV
    }
    const k = easing(elapsed / duration)
    currentV = startV + (endV - startV) * k
    return currentV
  })
}

/**
 * Tween a record of named values in one call. Same shape returned
 * with each value as `Derived<number>`. All values share the same
 * duration + easing — for mixed timing use individual `tween()` calls.
 *
 *   const dims = tween.values({ w: tw, h: th }, 200)
 *   <div style:width={() => `${dims.w()}px`}
 *        style:height={() => `${dims.h()}px`} />
 */
export function tweenValues<T extends Readonly<Record<string, () => number>>>(
  targets: T,
  opts: TweenOptions | number,
): { readonly [K in keyof T]: Derived<number> } {
  const out: Record<string, Derived<number>> = {}
  for (const [k, fn] of Object.entries(targets)) {
    out[k] = tweenImpl(fn, opts)
  }
  return out as { readonly [K in keyof T]: Derived<number> }
}

/**
 * Composite export — `tween` is callable AND has `.values` for
 * multi-property tweens.
 */
export const tween: typeof tweenImpl & {
  readonly values: typeof tweenValues
} = Object.assign(tweenImpl, { values: tweenValues })
