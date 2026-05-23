// Lazy + reference-counted motion clock (0.2.0).
//
// Pre-0.2.0: importing `motion/clock.ts` (transitively via
// `@place-ts/design`'s Button/Toast imports) kicked off
// `requestAnimationFrame` at module-init unconditionally. Every page
// that used any design-system component paid a 60 Hz rAF tax forever,
// with no way to stop the loop short of unloading the page.
//
// 0.2.0: the loop is reference-counted. Motion primitives call
// `_retainClock()` while interpolating and release on rest. With zero
// retainers, the loop's tick function refuses to schedule its next
// frame and the chain unwinds. Importing the module does NOT start
// the loop — the first `_retainClock()` call does.
//
// This test pins:
//   1. Module-init does NOT start the rAF chain. (`_isTickingForTest()
//      stays false until something retains.)
//   2. `_retainClock()` increments the active-count and ensures the
//      chain is ticking (in a browser-shimmed environment).
//   3. The disposer decrements the count. On the next tick that
//      observes count===0, the chain stops scheduling itself.
//   4. The disposer is idempotent — calling it twice doesn't
//      underflow the count.
//   5. `animate()` retains while moving, releases at rest.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { state } from '../../src/index.ts'
import {
  _advanceClockForTest,
  _isTickingForTest,
  _resetClockForTest,
  _retainClock,
  _retainCountForTest,
  animate,
} from '../../src/motion/index.ts'

// rAF shim — we want to MEASURE rAF behaviour, not actually wait for
// the screen refresh. Replace requestAnimationFrame with a controlled
// shim that calls back on next microtask. Real-world clock.ts gates
// on `typeof requestAnimationFrame === 'function'`, so installing
// this shim is enough to make the lazy-start logic run.
type RafCb = (t: number) => void
let _shimQueue: RafCb[] = []
let _shimTime = 0
const _shimRaf = (cb: RafCb): number => {
  _shimQueue.push(cb)
  return _shimQueue.length
}
const _flushShim = (advanceMs = 16.7): void => {
  _shimTime += advanceMs
  const q = _shimQueue
  _shimQueue = []
  for (const cb of q) cb(_shimTime)
}

const _origRaf = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame
const _origBrowserFlag = (globalThis as { __PLACE_BROWSER__?: unknown }).__PLACE_BROWSER__

beforeEach(() => {
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = _shimRaf
  // clock.ts gates the rAF chain on the build-time `__PLACE_BROWSER__`
  // define. In Node tests, the define is absent, so the chain refuses
  // to start. Stub it globally so the lazy-start logic actually runs.
  ;(globalThis as { __PLACE_BROWSER__?: unknown }).__PLACE_BROWSER__ = true
  _shimQueue = []
  _shimTime = 0
  _resetClockForTest()
})

afterEach(() => {
  if (_origRaf !== undefined) {
    ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = _origRaf
  } else {
    delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame
  }
  if (_origBrowserFlag !== undefined) {
    ;(globalThis as { __PLACE_BROWSER__?: unknown }).__PLACE_BROWSER__ = _origBrowserFlag
  } else {
    delete (globalThis as { __PLACE_BROWSER__?: unknown }).__PLACE_BROWSER__
  }
  _shimQueue = []
  _resetClockForTest()
})

describe('motion clock — lazy start (0.2.0)', () => {
  test('module import alone does NOT start the rAF chain', () => {
    // The imports at the top of this file have already evaluated by the
    // time this assertion runs. If clock.ts has any module-init
    // side effect that would kick off rAF, `_isTickingForTest()` would
    // be true here. The whole point of 0.2.0 is that it's NOT.
    expect(_isTickingForTest()).toBe(false)
    expect(_retainCountForTest()).toBe(0)
    expect(_shimQueue.length).toBe(0)
  })

  test('first _retainClock() starts the chain + bumps count to 1', () => {
    expect(_isTickingForTest()).toBe(false)
    const release = _retainClock()
    expect(_retainCountForTest()).toBe(1)
    expect(_isTickingForTest()).toBe(true)
    // The first frame is scheduled.
    expect(_shimQueue.length).toBe(1)
    release()
  })

  test('release drops the count; next tick stops the chain', () => {
    const release = _retainClock()
    expect(_retainCountForTest()).toBe(1)
    // Run one frame — chain reschedules because count is still 1.
    _flushShim()
    expect(_shimQueue.length).toBe(1)
    expect(_isTickingForTest()).toBe(true)

    // Now release. The NEXT tick (with count===0) will refuse to
    // reschedule and clear `_ticking`.
    release()
    expect(_retainCountForTest()).toBe(0)
    // The already-scheduled frame still fires once. After that one
    // fires, the chain stops.
    _flushShim()
    expect(_isTickingForTest()).toBe(false)
    expect(_shimQueue.length).toBe(0)
  })

  test('disposer is idempotent — double-release does not underflow', () => {
    const release = _retainClock()
    expect(_retainCountForTest()).toBe(1)
    release()
    expect(_retainCountForTest()).toBe(0)
    release() // second call — should be a no-op
    expect(_retainCountForTest()).toBe(0)
  })

  test('concurrent retainers — count tracks active retainers', () => {
    const r1 = _retainClock()
    const r2 = _retainClock()
    const r3 = _retainClock()
    expect(_retainCountForTest()).toBe(3)
    r2()
    expect(_retainCountForTest()).toBe(2)
    // Loop should still tick because there are still active retainers.
    _flushShim()
    expect(_isTickingForTest()).toBe(true)
    r1()
    r3()
    expect(_retainCountForTest()).toBe(0)
    _flushShim()
    expect(_isTickingForTest()).toBe(false)
  })

  test('retain after stop — restarts the chain cleanly', () => {
    const r1 = _retainClock()
    r1()
    _flushShim() // observes 0 count, stops
    expect(_isTickingForTest()).toBe(false)
    // Second retain — should restart from scratch.
    const r2 = _retainClock()
    expect(_isTickingForTest()).toBe(true)
    expect(_retainCountForTest()).toBe(1)
    r2()
  })
})

describe('motion clock — animate() integration (0.2.0)', () => {
  test('creating animate() without reading it does NOT retain', () => {
    const target = state(0)
    // Create but don't read — the derived's fn never runs, so no retain.
    animate(target, 'gentle')
    expect(_retainCountForTest()).toBe(0)
    expect(_isTickingForTest()).toBe(false)
  })

  test('reading animate() at rest at target does NOT retain', () => {
    const target = state(0)
    const x = animate(target, 'gentle')
    // First read: snaps to target (no animation needed).
    x()
    // Spring is at rest at target=0. Subsequent reads should not retain.
    x()
    x()
    expect(_retainCountForTest()).toBe(0)
    expect(_isTickingForTest()).toBe(false)
  })

  test('animate() retains the moment target changes (motion starts)', () => {
    const target = state(0)
    const x = animate(target, 'gentle')
    x() // snap to 0
    expect(_retainCountForTest()).toBe(0)
    // Move the target — the next read will see the new goal and start
    // animating, which retains the clock.
    target.set(100)
    x()
    expect(_retainCountForTest()).toBe(1)
  })

  test('animate() releases when the spring settles', () => {
    const target = state(0)
    const x = animate(target, 'gentle')
    x() // snap
    target.set(100)
    x() // start moving — retain
    expect(_retainCountForTest()).toBe(1)
    // Advance the clock until the spring settles.
    for (let i = 0; i < 200; i++) {
      _advanceClockForTest(16.7)
      x()
    }
    // Spring should be at rest at 100 now; retain released.
    expect(x()).toBeCloseTo(100, 1)
    expect(_retainCountForTest()).toBe(0)
  })
})
