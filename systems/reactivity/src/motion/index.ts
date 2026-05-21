// biome-ignore-all assist/source/organizeImports: documented re-export groupings (animate / tween / sequence / curve / spring / easing / clock / lifecycle / motionValue / colorMix / delay / flip) follow the narrative of the docstring above; auto-sort would scramble them
// @place-ts/reactivity/motion — animation primitives composed from
// reactivity + a single shared clock.
//
// One philosophical claim, four functions:
//   "An animation is a derived state over a time signal."
//
//   animate(target, opts)            — spring-driven interpolation
//   tween(target, opts)              — duration + easing
//   sequence(keyframes, opts)        — chained keyframes over time
//   curve(source, fn)                — non-time signal smoothing
//
// All four return `Derived<number>` — the same primitive the rest of
// the framework uses for reactive props. There is no separate motion
// runtime, no `<motion.div>` factory, no parallel component tree. Any
// element that reads `() => value` reactive props can consume the
// result. See ADR 0015 for the design rationale.
//
// SSR behavior: the clock is frozen at 0 on the server (the rAF
// driver is gated behind `__PLACE_BROWSER__`). Every animation
// primitive resolves to its target value at t=0 without consuming
// frames. Server-rendered HTML ships the rest position.

export { animate, animateValues, type AnimateOptions } from './animate.ts'
export { tween, tweenValues, type TweenOptions } from './tween.ts'
export { sequence, type Keyframe, type SequenceOptions } from './sequence.ts'
export { curve } from './curve.ts'
export { delay, type DelayOptions } from './delay.ts'
export { motionValue, type MotionValue } from './motionValue.ts'
export { colorMix, type ColorSpace } from './colorMix.ts'
export {
  motion,
  type Motion,
  type MotionOptions,
  type MotionPhase,
} from './lifecycle.ts'
export { flip, type FlipOptions } from './flip.ts'
export { clock } from './clock.ts'

// Spring shapes (presets + raw params) so callers can type their own
// animation factories without re-importing internals.
export {
  type SpringParams,
  type SpringPreset,
  SPRING_PRESETS,
} from './spring.ts'

// Easing (functions + presets + cubic-bezier helper).
export {
  type EasingFn,
  type EasingPreset,
  cubicBezier,
  linear,
  ease,
  easeIn,
  easeOut,
  easeInOut,
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInQuart,
  easeOutQuart,
  easeInSine,
  easeOutSine,
  easeInOutSine,
  easeInExpo,
  easeOutExpo,
  easeInBack,
  easeOutBack,
} from './easing.ts'

// Test-only helpers — internal underscore prefix; callers should not
// rely on these in production code.
export { _setClockForTest, _advanceClockForTest } from './clock.ts'
