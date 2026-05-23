// Motion clock — the single time signal every animation derives from.
//
// One clock per process. Animations subscribe to it via `derived()`;
// the framework's scheduler runs them whenever the clock ticks.
//
// Runtime split:
//   - Browser: `requestAnimationFrame` drives the tick. The clock
//     state holds `performance.now()` of the latest frame.
//   - Server (and any non-browser runtime): clock is frozen at 0.
//     Reading it returns 0; animations resolve to their rest (target)
//     value without consuming any frames. This is what makes SSR of
//     animated views cost zero animation work — `__PLACE_BROWSER__`
//     dead-code-eliminates the rAF driver from the server bundle.
//
// **Lazy + reference-counted (0.2.0).** The rAF loop does NOT run at
// module-init. It runs only while at least one motion primitive has
// called `_retainClock()` and not yet released. When the active count
// drops to 0, the loop's tick function stops scheduling its next
// frame. Result: an idle page that imports `@place-ts/reactivity/motion`
// (transitively, via `@place-ts/design`'s Button/Toast imports) costs
// ZERO rAF cycles. Only running animations pay.
//
// Pre-0.2.0 the loop was unconditional at module-init — every page
// that imported any component from `@place-ts/design` boot a perpetual
// 60 Hz tick + state-write cycle, visible as a forever-rising number
// in the devtools graph panel even with no animations on screen.
//
// The clock is a `State<number>` (mutable from the rAF driver) exposed
// publicly as a `Derived<number>` so app code can read but not write.

import type { Derived, State } from '../index.ts'
import { derived, state } from '../index.ts'

// Build-time define injected by `Bun.build` on browser builds. On the
// server runtime the symbol is undefined; `typeof __PLACE_BROWSER__`
// returns `"undefined"` and the bundler can DCE the entire rAF branch.
declare const __PLACE_BROWSER__: boolean | undefined

// Local DOM-lib declaration. The reactivity package is runtime-agnostic
// (server-side use is supported), so its tsconfig doesn't include the
// DOM `lib`. Declaring rAF locally keeps the file typecheck-clean
// without dragging the rest of the DOM API into the type surface.
declare const requestAnimationFrame: ((cb: (t: number) => void) => number) | undefined

// Internal writable holding the latest rAF timestamp (ms). Initial 0
// covers both the server (frozen) case and the pre-first-frame
// browser case — animations resolve to their target at t=0.
const _clock: State<number> = state(0)

// Public read-only view. Animations subscribe to this; they cannot
// rewrite the clock. Calling `clock()` while the loop is idle returns
// the last known value (0 if the loop has never run) — that's the
// SSR-frozen behaviour, preserved.
export const clock: Derived<number> = derived(() => _clock())

// ===== Reference-counted lazy driver =====
//
// `_active` counts retainers (active animations). The tick function
// keeps scheduling itself for as long as `_active > 0`; on the next
// frame after the count reaches 0, the tick chain stops and the loop
// is fully idle (zero CPU, zero state writes).
//
// `_ticking` guards against double-starts when `_retainClock()` is
// called concurrently or while the tick chain is unwinding.

let _active = 0
let _ticking = false

// On the server the rAF driver is dead code (gated by
// `__PLACE_BROWSER__`). `_ensureTicking` returns a no-op there.
const _ensureTicking = (): void => {
  if (_ticking) return
  if (typeof __PLACE_BROWSER__ === 'undefined' || !__PLACE_BROWSER__) return
  if (typeof requestAnimationFrame !== 'function') return
  _ticking = true
  const tick = (t: number): void => {
    _clock.set(t)
    if (_active > 0) {
      requestAnimationFrame(tick)
    } else {
      // No active retainers — let the loop terminate. The next
      // `_retainClock()` call will kick off a fresh chain.
      _ticking = false
    }
  }
  requestAnimationFrame(tick)
}

/**
 * **INTERNAL.** Called by motion primitives (`animate`, `tween`,
 * `sequence`, `flip`, `delay`) when they're actively interpolating.
 * Returns a disposer the primitive MUST call when the animation
 * settles to rest. While the disposer is unreleased, the rAF loop
 * keeps ticking; once every retainer has released, the loop self-stops
 * on its next frame.
 *
 * Idempotent on the disposer side — calling the returned function more
 * than once is a no-op (the second call doesn't double-decrement). This
 * matters because motion primitives may "release on rest" inside their
 * own derived body AND fire an `onCleanup` release on view dispose;
 * one of those releases is redundant and we don't want to underflow
 * the counter into negative.
 */
export function _retainClock(): () => void {
  _active++
  _ensureTicking()
  let released = false
  return () => {
    if (released) return
    released = true
    _active--
    // Sanity guard — should never go negative, but defensively cap.
    if (_active < 0) _active = 0
  }
}

/**
 * **INTERNAL.** Returns the current retainer count. Test-only — lets
 * the unit-test pin "import does not retain", "first retain bumps to
 * 1", "release drops back to 0".
 */
export function _retainCountForTest(): number {
  return _active
}

/**
 * **INTERNAL.** Returns whether the rAF chain is currently scheduled.
 * Test-only — pins "no ticking until first retain", "ticking after
 * retain", "still ticking until the NEXT frame after release"
 * (the tick that observes `_active === 0` is what stops the chain).
 */
export function _isTickingForTest(): boolean {
  return _ticking
}

// ===== Test helpers =====
//
// Property tests and unit tests advance the clock deterministically.
// These are NOT part of the public surface — internal-only.

/** Internal: set the clock to a specific time. Test-only. */
export const _setClockForTest = (t: number): void => {
  _clock.set(t)
}

/** Internal: advance the clock by `dt` ms. Test-only. */
export const _advanceClockForTest = (dt: number): void => {
  _clock.set(_clock() + dt)
}

/** Internal: forcibly reset retainer state. Test-only — used between
 *  tests so one suite's leftover animation doesn't pollute the next. */
export const _resetClockForTest = (): void => {
  _active = 0
  _ticking = false
  _clock.set(0)
}
