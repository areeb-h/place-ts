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
// rewrite the clock.
export const clock: Derived<number> = derived(() => _clock())

// ===== Browser-only driver =====
//
// Starts on first import. Runs forever — there's only one clock per
// process and animations subscribe/unsubscribe via the reactive
// graph's normal dependency tracking. No reference counting needed.
//
// On the server, the entire block dead-code-eliminates: `typeof
// __PLACE_BROWSER__` becomes `"true"` on browser builds (the bundler
// constant-folds the typeof), and `false` on the server (where the
// define isn't present). Result: zero server-side bundle weight for
// the driver.

if (typeof __PLACE_BROWSER__ !== 'undefined' && __PLACE_BROWSER__) {
  // `requestAnimationFrame` IS defined in browsers. The `typeof`
  // guard lets a stripped/incomplete browser environment fall through
  // gracefully without throwing at module-init time.
  if (typeof requestAnimationFrame === 'function') {
    const tick = (t: number): void => {
      _clock.set(t)
      requestAnimationFrame(tick)
    }
    // Kick off the first frame. The clock will then auto-tick forever.
    requestAnimationFrame(tick)
  }
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
