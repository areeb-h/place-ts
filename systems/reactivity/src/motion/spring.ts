// Spring solver — semi-implicit Euler integration of a damped harmonic
// oscillator. Tuning constants match Motion One's `@motionone/spring`
// presets (settled prior art; saves us from re-deriving the values).
//
// The integration step takes a `(value, velocity, target, dt)` tuple
// and returns the next `(value, velocity)`. Stable for dt up to ~16ms
// (one rAF frame); larger steps would need sub-stepping but rAF
// guarantees we stay under that bound except in tab-throttled cases
// (where the user-perceived animation pause is acceptable).
//
// Why semi-implicit Euler (not RK4 / Verlet): semi-implicit is the
// minimum-arithmetic stable integrator for harmonic oscillators.
// RK4 is overkill for a 1D spring; Verlet stores position twice (more
// state for no observable gain). Motion One uses the same approach;
// we match it.

export interface SpringParams {
  /** Mass of the oscillator. Higher = more inertia. Default: 1. */
  mass?: number
  /** Spring stiffness (k). Higher = snappier. Default: 170. */
  tension?: number
  /** Damping coefficient. Higher = less bounce. Default: 26. */
  friction?: number
  /**
   * Velocity precision: animation is considered "at rest" when both
   * `|target - value| < precision` AND `|velocity| < precision`.
   * Default: 0.01.
   */
  precision?: number
}

// Battle-tested presets. Values from `@motionone/spring`. Each preset
// is a different (tension, friction) point on the spring's response
// curve; mass stays at 1 because tweaking mass and tension together is
// confusing — friction-relative-to-tension is what changes feel.
export const SPRING_PRESETS = {
  /** Soft, gentle — long settle time, minimal overshoot. */
  gentle: { mass: 1, tension: 120, friction: 14 } satisfies SpringParams,
  /** Bouncy — pronounced overshoot before settling. */
  wobbly: { mass: 1, tension: 180, friction: 12 } satisfies SpringParams,
  /** Snappy, controlled — short settle, slight overshoot. */
  stiff: { mass: 1, tension: 210, friction: 20 } satisfies SpringParams,
  /** Slow, viscous — overdamped; no overshoot. */
  molasses: { mass: 1, tension: 280, friction: 120 } satisfies SpringParams,
  /** Fast snap — high tension + high damping; near-critically damped. */
  snap: { mass: 1, tension: 300, friction: 30 } satisfies SpringParams,
}

export type SpringPreset = keyof typeof SPRING_PRESETS

/** Default spring parameters when nothing is specified. */
export const DEFAULT_SPRING = SPRING_PRESETS.gentle

/** Resolve a preset name or raw params into a fully-populated SpringParams. */
export function resolveSpring(s: SpringPreset | SpringParams | undefined): Required<SpringParams> {
  const raw: SpringParams =
    s === undefined ? DEFAULT_SPRING : typeof s === 'string' ? SPRING_PRESETS[s] : s
  return {
    mass: raw.mass ?? 1,
    tension: raw.tension ?? 170,
    friction: raw.friction ?? 26,
    precision: raw.precision ?? 0.01,
  }
}

/**
 * One integration step. Returns the next `(value, velocity)` after `dt`
 * milliseconds, with the spring pulling `value` toward `target`.
 *
 * The integration uses semi-implicit Euler:
 *   force    = -tension * (value - target) - friction * velocity
 *   accel    = force / mass
 *   velocity = velocity + accel * dt
 *   value    = value + velocity * dt
 *
 * `dt` is in seconds (not ms); the caller is responsible for the unit
 * conversion. Use `stepSpringMs` if you have a millisecond delta and
 * don't want to convert.
 */
export function stepSpring(
  value: number,
  velocity: number,
  target: number,
  dt: number,
  params: Required<SpringParams>,
): { value: number; velocity: number } {
  const { mass, tension, friction } = params
  const force = -tension * (value - target) - friction * velocity
  const accel = force / mass
  const nextV = velocity + accel * dt
  const nextX = value + nextV * dt
  return { value: nextX, velocity: nextV }
}

/** Same as `stepSpring` but takes `dt` in milliseconds (the rAF unit). */
export function stepSpringMs(
  value: number,
  velocity: number,
  target: number,
  dtMs: number,
  params: Required<SpringParams>,
): { value: number; velocity: number } {
  return stepSpring(value, velocity, target, dtMs / 1000, params)
}

/** True when the spring is close enough to `target` that we can stop integrating. */
export function isAtRest(
  value: number,
  velocity: number,
  target: number,
  params: Required<SpringParams>,
): boolean {
  return Math.abs(target - value) < params.precision && Math.abs(velocity) < params.precision
}
