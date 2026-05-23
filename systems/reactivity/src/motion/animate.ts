// `animate(target, opts)` — spring-driven derived state.
//
// Reads a target signal; returns a derived signal whose value tracks
// the target via the spring solver. Every clock tick advances the
// simulation by `(now - lastTick)` ms. When `|target - value| < precision`
// and `|velocity| < precision`, the simulation rests at `target`.
//
// Why this is just `derived()` + the clock + the spring step:
//   - The clock is a `Derived<number>`. Subscribing to it makes our
//     derivation re-evaluate every frame.
//   - The target is a signal. Subscribing to it makes our derivation
//     re-evaluate when the target changes (which restarts the spring).
//   - The spring solver is pure. We hold (value, velocity, lastT) in
//     closure-scoped vars updated inside the derivation.
//
// No internal scheduler. No `requestAnimationFrame` call here. The
// clock owns the rAF loop (see clock.ts).
//
// SSR safety: on the server `clock` is frozen at 0 (gated via
// `__PLACE_BROWSER__` in clock.ts). The animation runs one tick at
// t=0, sees no time advancing, settles at the initial target. Apps
// can render animated views server-side and ship the rest position.

import type { Derived } from '../index.ts'
import { derived, untrack } from '../index.ts'
import { _retainClock, clock } from './clock.ts'
import {
  isAtRest,
  resolveSpring,
  type SpringParams,
  type SpringPreset,
  stepSpringMs,
} from './spring.ts'

export interface AnimateOptions {
  /** Spring shape — preset name or raw params. Default: `'gentle'`. */
  spring?: SpringPreset | SpringParams
  /**
   * Override the clock. Defaults to the global `clock` signal.
   * Test contexts pass a custom clock for deterministic stepping;
   * apps will rarely set this.
   */
  clock?: () => number
}

/**
 * Animate a numeric signal toward a target via a spring solver. The
 * returned `Derived<number>` reads the current animated value; it
 * subscribes to both `target` AND the clock, so callers that bind it
 * to a DOM property re-paint on every frame the spring is in motion
 * and stop re-painting once it settles.
 *
 * **Spring preset shorthand** (Tier 17-E v2 DX): pass the preset
 * name directly as the second arg instead of wrapping in
 * `{ spring: '...' }`. Both forms work; the shorthand reads cleaner
 * at the call site for the common case.
 *
 * Usage:
 *   const target = state(0)
 *   const x = animate(target, 'gentle')               // shorthand
 *   const y = animate(target, { spring: 'wobbly' })   // explicit
 *   <div style:transform={() => `translateX(${x()}px)`} />
 *   target.set(100)  // x() glides from 0 → 100 over a few frames
 */
export function animateImpl(
  target: () => number,
  opts: AnimateOptions | SpringPreset = {},
): Derived<number> {
  // Normalize shorthand: a bare preset name becomes `{ spring: <name> }`.
  const normalized: AnimateOptions = typeof opts === 'string' ? { spring: opts } : opts
  const params = resolveSpring(normalized.spring)
  const tickClock = normalized.clock ?? clock

  // Per-animation state. Captured in closure; mutated inside the
  // derivation. The derivation itself is pure (returns the new value)
  // but the closure tracks (lastT, velocity) across ticks.
  let value = untrack(target) // start at target — no jump on first read
  let velocity = 0
  let lastT: number | null = null
  // Clock retainer — non-null while the spring is in motion, null
  // while at rest. Retain on first integration step; release the
  // moment `isAtRest` fires. Keeps the global rAF loop idle when
  // no springs are actively moving (0.2.0 lazy-clock).
  let _retain: (() => void) | null = null
  const _release = (): void => {
    if (_retain !== null) {
      _retain()
      _retain = null
    }
  }

  return derived(() => {
    const goal = target()
    // Fast path: already at rest at the current goal. Don't read the
    // clock (so this derived drops its clock subscription), don't
    // retain. The spring is idle; the rAF loop has no reason to fire
    // for our sake.
    if (lastT !== null && goal === value && velocity === 0) {
      _release()
      return value
    }
    // First evaluation: snap to target, record clock baseline. No
    // animation work yet — and crucially, we DON'T retain here. If we
    // did, the first read of a never-animating value would start the
    // rAF loop for one frame, defeating the lazy-start guarantee.
    // We still need to subscribe to the clock (to receive subsequent
    // ticks if the target changes), so we read tickClock() but skip
    // the retain.
    if (lastT === null) {
      lastT = tickClock()
      value = goal
      velocity = 0
      return value
    }
    // Active path: spring is moving. Read clock to subscribe + tick on
    // each frame; retain the rAF loop.
    const t = tickClock()
    if (_retain === null) _retain = _retainClock()
    const dt = t - lastT
    lastT = t
    // No time elapsed (e.g. SSR where clock is frozen at 0): the
    // derivation re-fires because `goal` changed but no integration
    // happens. Snap velocity to 0 and return value-as-is. The next
    // clock tick (if any) will start the integration.
    if (dt <= 0) {
      // If goal changed but we have no time yet, just sit at our
      // current value. The browser will tick next frame.
      return value
    }
    // Step the spring. Clamp dt to one frame max — prevents long
    // pauses (tab backgrounded) from making the spring fly past target.
    const dtClamped = Math.min(dt, 32)
    const next = stepSpringMs(value, velocity, goal, dtClamped, params)
    value = next.value
    velocity = next.velocity
    if (isAtRest(value, velocity, goal, params)) {
      // Lock to target so subsequent reads return exactly `goal` (no
      // sub-precision residue) and skip the spring math.
      value = goal
      velocity = 0
      _release()
    }
    return value
  })
}

/**
 * Animate a record of named values in one call. Returns the same
 * shape with each value replaced by its `Derived<number>` — drop
 * the result into JSX style/transform expressions.
 *
 *   const pos = animate.values({ x: ax, y: ay, opacity: ao }, 'gentle')
 *   <div
 *     style:transform={() => `translate(${pos.x()}px, ${pos.y()}px)`}
 *     style:opacity={() => String(pos.opacity())}
 *   />
 *
 * Each animated value uses the same spring params. For mixed shapes
 * (different springs per axis) call `animate()` per-value.
 */
export function animateValues<T extends Readonly<Record<string, () => number>>>(
  targets: T,
  opts: AnimateOptions | SpringPreset = {},
): { readonly [K in keyof T]: Derived<number> } {
  const out: Record<string, Derived<number>> = {}
  for (const [k, fn] of Object.entries(targets)) {
    out[k] = animateImpl(fn, opts)
  }
  return out as { readonly [K in keyof T]: Derived<number> }
}

/**
 * Composite export — `animate` is callable AND has `.values` for
 * multi-property animations. Object.assign keeps types clean: the
 * function signature is the primary call form; the static method
 * is sugar over a loop.
 */
export const animate: typeof animateImpl & {
  readonly values: typeof animateValues
} = Object.assign(animateImpl, { values: animateValues })
