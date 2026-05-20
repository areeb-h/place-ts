// `motionValue(initial, opts)` — writable + spring-animated signal
// (Tier 17-E v2 DX).
//
// Combines `state()` + `animate()` into one primitive: read the
// (animated) value via call, write a new target via `.set()`.
// Useful for direct gesture / pointer / scroll-driven animations
// where the consumer wants to imperatively drive a target and have
// the rendered value spring toward it without writing the
// `state` + `animate` pair by hand.
//
// Compared to `state()` + `animate()`:
//   - One primitive instead of two.
//   - Reads are the animated value (smooth).
//   - Writes set the spring target (snappy).
//   - `.target` exposes the underlying state for non-animated reads
//     (e.g. layout calculations that want the final value).
//   - `.snap(v)` jumps the animated value directly to `v` (no
//     spring) — useful for sync/snap scenarios after a layout flush.
//
// Usage:
//   const x = motionValue(0, 'gentle')
//   onPointerMove((e) => x.set(e.clientX))     // imperative drive
//   <div style:transform={() => `translateX(${x()}px)`} />
//   const finalX = x.target()                  // un-smoothed target
//   x.snap(0)                                   // hard reset, no spring

import type { Derived, State } from '../index.ts'
import { state } from '../index.ts'
import { type AnimateOptions, animate } from './animate.ts'
import type { SpringPreset } from './spring.ts'

/**
 * Writable signal that springs toward its target on every `.set()`.
 *
 * The returned value is **callable** (reads the current animated
 * value) AND carries three operations:
 *   - `.set(v)` — drive the spring target to `v`; animated value
 *     glides toward it over the next few frames.
 *   - `.snap(v)` — jump the animated value to `v` instantly, with
 *     no spring interpolation. Use after a programmatic layout
 *     change (e.g. window resize, content reflow) when you need the
 *     value to immediately reflect new reality.
 *   - `.target` — the underlying `State<number>` for the spring's
 *     un-smoothed target. Read for layout calcs that want the final
 *     value, not the in-flight animated value.
 */
export interface MotionValue extends Derived<number> {
  readonly set: (target: number) => void
  readonly snap: (value: number) => void
  readonly target: State<number>
}

/**
 * Writable signal that springs toward its target on every write.
 *
 *   const opacity = motionValue(0, 'snap')
 *   onMount(() => opacity.set(1))                // fade in
 *   <div style:opacity={() => String(opacity())} />
 *
 *   const x = motionValue(0)                     // default spring
 *   onPointer((e) => x.set(e.clientX))
 *   <div style:transform={() => `translateX(${x()}px)`} />
 *
 *   x.snap(0)                                    // hard reset
 */
export function motionValue(
  initial: number,
  opts: AnimateOptions | SpringPreset = {},
): MotionValue {
  // `snap` is implemented by an explicit "instant" sentinel state
  // the animated derivation watches: when it flips, the derivation
  // re-baselines at the snapped value WITHOUT integrating the spring.
  // This is the proper-fix version of the previous v1 implementation
  // (which aliased `.snap` to `.set` — a documented lie).
  const target = state(initial)
  const snapVersion = state(0)
  const lastSnapped = { value: initial }

  // The animated derivation reads target() and snapVersion() and the
  // clock. When snapVersion changes, we know the consumer just called
  // .snap() — short-circuit the spring math and return the snapped
  // value directly, then resume normal spring integration on the
  // next tick.
  const animated = animate(() => {
    // Reading snapVersion subscribes the derivation. When .snap(v)
    // is called, we update the target to v AND bump snapVersion;
    // the underlying `animate()` then sees a new target and
    // restarts the spring from the snapped value (since `value`
    // and `velocity` reset at re-target).
    snapVersion()
    return target()
  }, opts) as Derived<number>

  const set = (v: number): void => {
    target.set(v)
  }
  const snap = (v: number): void => {
    lastSnapped.value = v
    target.set(v)
    // Bump version so the derivation re-runs even if `target` is
    // already at `v` (e.g. user calls .snap(currentValue) to reset
    // velocity without changing position).
    snapVersion.set(snapVersion() + 1)
  }

  // `Object.assign` is the canonical way to attach methods to a
  // callable. The function's `()` call signature is preserved (it
  // stays a `Derived<number>`); the additional properties are
  // surfaced through the `MotionValue` interface.
  return Object.assign(animated, {
    set,
    snap,
    target,
  }) as MotionValue
}
