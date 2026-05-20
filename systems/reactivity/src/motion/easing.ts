// Easing functions for `tween()` and `sequence()`.
//
// An EasingFn is `(t: number) => number` where `t ∈ [0, 1]`. Output
// SHOULD be in `[0, 1]` for monotonic easings (linear, cubic) and MAY
// overshoot for `back` / `elastic` / `bounce`. The interpolator handles
// values outside that range without clamping — the caller's renderer
// decides whether to clamp or let overshoot through (which is what
// makes overshoot animations look natural).

export type EasingFn = (t: number) => number

// Standard CSS / Robert Penner easings. Names chosen to match the
// CSS Animations Level 1 spec where possible (linear, ease, ease-in,
// ease-out, ease-in-out) and the de-facto Penner names for the rest.

export const linear: EasingFn = (t) => t

// Quadratic
export const easeInQuad: EasingFn = (t) => t * t
export const easeOutQuad: EasingFn = (t) => 1 - (1 - t) * (1 - t)
export const easeInOutQuad: EasingFn = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t))

// Cubic
export const easeInCubic: EasingFn = (t) => t * t * t
export const easeOutCubic: EasingFn = (t) => {
  const u = 1 - t
  return 1 - u * u * u
}
export const easeInOutCubic: EasingFn = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

// Quartic
export const easeInQuart: EasingFn = (t) => t * t * t * t
export const easeOutQuart: EasingFn = (t) => {
  const u = 1 - t
  return 1 - u * u * u * u
}

// Sine
export const easeInSine: EasingFn = (t) => 1 - Math.cos((t * Math.PI) / 2)
export const easeOutSine: EasingFn = (t) => Math.sin((t * Math.PI) / 2)
export const easeInOutSine: EasingFn = (t) => -(Math.cos(Math.PI * t) - 1) / 2

// Exponential
export const easeInExpo: EasingFn = (t) => (t === 0 ? 0 : 2 ** (10 * t - 10))
export const easeOutExpo: EasingFn = (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t))

// Back — overshoots before settling. `1.70158` is the canonical Penner
// constant; tuning higher = more overshoot.
const BACK_C1 = 1.70158
const BACK_C3 = BACK_C1 + 1
export const easeInBack: EasingFn = (t) => BACK_C3 * t * t * t - BACK_C1 * t * t
export const easeOutBack: EasingFn = (t) => {
  const u = t - 1
  return 1 + BACK_C3 * u * u * u + BACK_C1 * u * u
}

// Standard CSS aliases.
export const ease = easeInOutCubic
export const easeIn = easeInQuad
export const easeOut = easeOutQuad
export const easeInOut = easeInOutQuad

// Cubic-bezier compatibility — accepts `(x1, y1, x2, y2)` per the CSS
// spec and returns an EasingFn. Implementation uses Newton-Raphson
// iteration to solve `x(t) = target` then evaluates `y(t)`. The same
// algorithm CSS engines use; matches CSS `cubic-bezier()` output to
// within ~1e-6 over the [0,1] range.
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  // Coefficients for `x(t) = ax * t^3 + bx * t^2 + cx * t`
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleCurveX = (t: number): number => ((ax * t + bx) * t + cx) * t
  const sampleCurveY = (t: number): number => ((ay * t + by) * t + cy) * t
  const sampleCurveDerivX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx
  const solveCurveX = (x: number): number => {
    let t = x
    // Newton-Raphson: usually 4-8 iterations is enough.
    for (let i = 0; i < 8; i++) {
      const xt = sampleCurveX(t) - x
      if (Math.abs(xt) < 1e-6) return t
      const dx = sampleCurveDerivX(t)
      if (Math.abs(dx) < 1e-6) break
      t -= xt / dx
    }
    // Fallback: bisection if Newton diverged.
    let lo = 0
    let hi = 1
    while (lo < hi) {
      t = (lo + hi) / 2
      const xt = sampleCurveX(t)
      if (Math.abs(xt - x) < 1e-6) return t
      if (xt < x) lo = t
      else hi = t
    }
    return t
  }
  return (t: number): number => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    return sampleCurveY(solveCurveX(t))
  }
}

// Easing preset names — string-typed for ergonomic call sites.
export type EasingPreset =
  | 'linear'
  | 'ease'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'ease-in-quad'
  | 'ease-out-quad'
  | 'ease-in-out-quad'
  | 'ease-in-cubic'
  | 'ease-out-cubic'
  | 'ease-in-out-cubic'
  | 'ease-in-quart'
  | 'ease-out-quart'
  | 'ease-in-sine'
  | 'ease-out-sine'
  | 'ease-in-out-sine'
  | 'ease-in-expo'
  | 'ease-out-expo'
  | 'ease-in-back'
  | 'ease-out-back'

const EASINGS: Record<EasingPreset, EasingFn> = {
  linear,
  ease,
  'ease-in': easeIn,
  'ease-out': easeOut,
  'ease-in-out': easeInOut,
  'ease-in-quad': easeInQuad,
  'ease-out-quad': easeOutQuad,
  'ease-in-out-quad': easeInOutQuad,
  'ease-in-cubic': easeInCubic,
  'ease-out-cubic': easeOutCubic,
  'ease-in-out-cubic': easeInOutCubic,
  'ease-in-quart': easeInQuart,
  'ease-out-quart': easeOutQuart,
  'ease-in-sine': easeInSine,
  'ease-out-sine': easeOutSine,
  'ease-in-out-sine': easeInOutSine,
  'ease-in-expo': easeInExpo,
  'ease-out-expo': easeOutExpo,
  'ease-in-back': easeInBack,
  'ease-out-back': easeOutBack,
}

/** Resolve an EasingPreset name OR a literal EasingFn to a function. */
export function resolveEasing(e: EasingFn | EasingPreset | undefined): EasingFn {
  if (e === undefined) return easeOutCubic
  if (typeof e === 'function') return e
  const fn = EASINGS[e]
  if (!fn) throw new Error(`motion: unknown easing preset '${e}'`)
  return fn
}
