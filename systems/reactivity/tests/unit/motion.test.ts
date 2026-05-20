// Motion primitive tests. Uses the test-only clock helpers to advance
// time deterministically — no rAF, no `setTimeout`, no flake.

import { describe, expect, test } from 'vitest'
import { state } from '../../src/index.ts'
import {
  _advanceClockForTest,
  _setClockForTest,
  animate,
  clock,
  colorMix,
  cubicBezier,
  curve,
  delay,
  easeInOutCubic,
  easeOutCubic,
  flip,
  linear,
  motion as motionLifecycle,
  motionValue,
  type SPRING_PRESETS,
  sequence,
  tween,
} from '../../src/motion/index.ts'

// Reset the global clock to a known baseline before each test. Without
// this, animations carry state across tests via the shared clock.
function resetClock(): void {
  _setClockForTest(0)
}

describe('motion / clock', () => {
  test('reads as 0 initially (server-frozen / pre-first-frame)', () => {
    resetClock()
    expect(clock()).toBe(0)
  })

  test('advanceClock moves the time forward', () => {
    resetClock()
    _advanceClockForTest(100)
    expect(clock()).toBe(100)
    _advanceClockForTest(50)
    expect(clock()).toBe(150)
  })
})

describe('motion / easing', () => {
  test('linear: input == output across the range', () => {
    expect(linear(0)).toBe(0)
    expect(linear(0.5)).toBe(0.5)
    expect(linear(1)).toBe(1)
  })

  test('easeOutCubic: monotonic, endpoints fixed', () => {
    expect(easeOutCubic(0)).toBeCloseTo(0, 6)
    expect(easeOutCubic(1)).toBeCloseTo(1, 6)
    // Mid-range value is above linear (the curve eases out — moves
    // faster at the start, slower near the end).
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })

  test('easeInOutCubic: symmetric around 0.5', () => {
    expect(easeInOutCubic(0)).toBeCloseTo(0, 6)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6)
    expect(easeInOutCubic(1)).toBeCloseTo(1, 6)
  })

  test('cubicBezier(0.42, 0, 0.58, 1) matches ease-in-out shape', () => {
    const e = cubicBezier(0.42, 0, 0.58, 1)
    expect(e(0)).toBeCloseTo(0, 5)
    expect(e(0.5)).toBeCloseTo(0.5, 4)
    expect(e(1)).toBeCloseTo(1, 5)
  })

  test('cubicBezier clamps t outside [0, 1]', () => {
    const e = cubicBezier(0.25, 0.1, 0.25, 1)
    expect(e(-0.1)).toBe(0)
    expect(e(1.1)).toBe(1)
  })
})

describe('motion / tween', () => {
  test('tween: linear easing reaches target exactly at duration', () => {
    resetClock()
    const target = state(100)
    const t = tween(() => target(), { duration: 1000, easing: 'linear' })
    // First read records the baseline; value snaps to current target.
    expect(t()).toBe(100)
    // Move target — re-evaluate at t=0 still: tween restarts.
    target.set(200)
    _advanceClockForTest(0) // no clock change yet, but clock() will tick
    expect(t()).toBe(100)
    _advanceClockForTest(500)
    expect(t()).toBeCloseTo(150, 2) // 50% through linear from 100 to 200
    _advanceClockForTest(500)
    expect(t()).toBe(200) // arrived
  })

  test('tween: clamps at the endpoint after duration elapses', () => {
    resetClock()
    const target = state(0)
    const t = tween(() => target(), { duration: 100, easing: 'linear' })
    t() // initialize
    target.set(50)
    t() // re-target snapshot
    _advanceClockForTest(500) // way past duration
    expect(t()).toBe(50)
  })

  test('tween: re-targeting mid-flight snapshots from current value', () => {
    resetClock()
    const target = state(0)
    const t = tween(() => target(), { duration: 1000, easing: 'linear' })
    t() // init
    target.set(100)
    t() // snapshot
    _advanceClockForTest(500)
    expect(t()).toBeCloseTo(50, 2) // halfway
    // Re-target while in flight — should resume from ~50, not from 0.
    target.set(150)
    expect(t()).toBeCloseTo(50, 2) // first read after re-target snapshots
    _advanceClockForTest(500)
    expect(t()).toBeCloseTo(100, 2) // halfway from 50 to 150
    _advanceClockForTest(500)
    expect(t()).toBe(150)
  })

  test('tween: duration=0 snaps instantly', () => {
    resetClock()
    const target = state(0)
    const t = tween(() => target(), { duration: 0 })
    t()
    target.set(99)
    expect(t()).toBe(99)
  })
})

describe('motion / animate (spring)', () => {
  test('animate: starts at target, no jump on first read', () => {
    resetClock()
    const target = state(50)
    const a = animate(() => target())
    expect(a()).toBe(50)
  })

  // Helper: advance the clock by `dtMs` and READ the animation each
  // tick. Reading is what drives the derived re-evaluation (signals
  // are lazy — they only recompute when something reads them). The
  // animate primitive's per-frame integration relies on the clock
  // advancing in small steps; if we advance the clock by N*dt and
  // only read once at the end, the spring sees one giant step and
  // its dt-clamp (32ms) kicks in. Per-frame reads match what the
  // browser's render loop does: rAF tick → reactive watch fires → DOM
  // prop reads value → spring steps.
  function step(frames: number, dtMs: number, read: () => number): number {
    let last = read()
    for (let i = 0; i < frames; i++) {
      _advanceClockForTest(dtMs)
      last = read()
    }
    return last
  }

  test('animate: converges to a new target after enough time', () => {
    resetClock()
    const target = state(0)
    const a = animate(() => target(), { spring: 'snap' })
    a() // initialize
    target.set(100)
    const finalV = step(200, 16, a) // ~3s at rAF cadence
    expect(finalV).toBeCloseTo(100, 1)
  })

  test('animate: gentle preset overshoots before settling', () => {
    resetClock()
    const target = state(0)
    const a = animate(() => target(), { spring: 'gentle' })
    a()
    target.set(100)
    let maxSeen = -Infinity
    for (let i = 0; i < 200; i++) {
      _advanceClockForTest(16)
      const v = a()
      if (v > maxSeen) maxSeen = v
    }
    expect(maxSeen).toBeGreaterThan(100) // underdamped → overshoots
    expect(a()).toBeCloseTo(100, 1)
  })

  test('animate: molasses (overdamped) does NOT overshoot', () => {
    resetClock()
    const target = state(0)
    const a = animate(() => target(), { spring: 'molasses' })
    a()
    target.set(100)
    let maxSeen = -Infinity
    for (let i = 0; i < 300; i++) {
      _advanceClockForTest(16)
      const v = a()
      if (v > maxSeen) maxSeen = v
    }
    expect(maxSeen).toBeLessThanOrEqual(100 + 0.01)
  })

  test('animate: spring presets all converge within ~5 seconds', () => {
    // The slowest preset (gentle, low-friction underdamped) takes the
    // longest to settle; 5s at 16ms cadence (313 frames) is enough for
    // all five presets to get within 0.5 of target. Stricter
    // tolerances per preset live in the dedicated overshoot/molasses
    // tests above.
    const presets: (keyof typeof SPRING_PRESETS)[] = ['gentle', 'wobbly', 'stiff', 'molasses', 'snap']
    for (const preset of presets) {
      resetClock()
      const target = state(0)
      const a = animate(() => target(), { spring: preset })
      a()
      target.set(100)
      const finalV = step(313, 16, a)
      expect(finalV).toBeCloseTo(100, 0)
    }
  })
})

describe('motion / sequence', () => {
  test('before first keyframe time: holds first value', () => {
    resetClock()
    const s = sequence([
      { at: 100, value: 10 },
      { at: 200, value: 20 },
    ])
    expect(s()).toBe(10)
    _advanceClockForTest(50)
    expect(s()).toBe(10)
  })

  test('past last keyframe time: holds last value', () => {
    resetClock()
    const s = sequence([
      { at: 0, value: 0 },
      { at: 100, value: 100 },
    ])
    s() // init baseline
    _advanceClockForTest(200)
    expect(s()).toBe(100)
  })

  test('mid-segment: interpolates linearly with default easing', () => {
    resetClock()
    const s = sequence([
      { at: 0, value: 0 },
      { at: 100, value: 100, easing: linear },
    ])
    s() // init
    _advanceClockForTest(50)
    expect(s()).toBeCloseTo(50, 2)
  })

  test('three keyframes: visits each at the declared time', () => {
    resetClock()
    const s = sequence([
      { at: 0, value: 0 },
      { at: 100, value: 50, easing: linear },
      { at: 200, value: 0, easing: linear },
    ])
    s()
    _advanceClockForTest(100)
    expect(s()).toBe(50)
    _advanceClockForTest(100)
    expect(s()).toBe(0)
  })

  test('throws on empty keyframes', () => {
    expect(() => sequence([])).toThrow(/at least one keyframe/i)
  })

  test('throws on out-of-order keyframes', () => {
    expect(() => sequence([
      { at: 100, value: 0 },
      { at: 50, value: 1 },
    ])).toThrow(/sorted/i)
  })
})

describe('motion / curve', () => {
  test('passes source through the curve function', () => {
    const src = state(0)
    const c = curve(() => src(), (x) => x * x)
    expect(c()).toBe(0)
    src.set(3)
    expect(c()).toBe(9)
    src.set(-2)
    expect(c()).toBe(4)
  })

  test('composes with easing as a curve function', () => {
    const pct = state(0)
    const eased = curve(() => pct(), easeOutCubic)
    expect(eased()).toBeCloseTo(0, 6)
    pct.set(1)
    expect(eased()).toBeCloseTo(1, 6)
    pct.set(0.5)
    expect(eased()).toBeCloseTo(easeOutCubic(0.5), 6)
  })
})

// ===== Tier 17-E v2 DX additions =====
//
// `step()` helper: advance the clock in small frames AND read each
// tick. Necessary because the spring solver clamps dt to 32ms per
// step (long pauses don't fly past target), and derivations are
// lazy (time only "flows" between reads).
function stepAndRead(frames: number, dtMs: number, read: () => number): number {
  let last = read()
  for (let i = 0; i < frames; i++) {
    _advanceClockForTest(dtMs)
    last = read()
  }
  return last
}

describe('motion / animate — shorthand presets + .values', () => {
  test('shorthand preset: animate(target, "gentle") works as animate(target, { spring: "gentle" })', () => {
    resetClock()
    const target = state(0)
    const a = animate(target, 'gentle')
    a() // initialize
    target.set(100)
    const finalV = stepAndRead(200, 16, a) // ~3.2s at rAF cadence
    expect(finalV).toBeCloseTo(100, 1)
  })

  test('shorthand and explicit forms produce identical results', () => {
    resetClock()
    const t1 = state(0)
    const t2 = state(0)
    const a1 = animate(t1, 'snap')
    const a2 = animate(t2, { spring: 'snap' })
    a1()
    a2()
    t1.set(50)
    t2.set(50)
    // Step both in lockstep.
    for (let i = 0; i < 30; i++) {
      _advanceClockForTest(16)
      a1()
      a2()
    }
    expect(a1()).toBeCloseTo(a2(), 6)
  })

  test('animate.values returns a record of derived signals — one per key', () => {
    resetClock()
    const tx = state(0)
    const ty = state(0)
    const pos = animate.values({ x: tx, y: ty }, 'snap')
    pos.x()
    pos.y()
    tx.set(100)
    ty.set(200)
    for (let i = 0; i < 200; i++) {
      _advanceClockForTest(16)
      pos.x()
      pos.y()
    }
    expect(pos.x()).toBeCloseTo(100, 1)
    expect(pos.y()).toBeCloseTo(200, 1)
  })

  test('animate.values keys are typed (compile-time)', () => {
    resetClock()
    const pos = animate.values({ x: state(0), y: state(0), opacity: state(0) }, 'snap')
    // TS: pos has exactly { x: Derived<number>; y: Derived<number>; opacity: Derived<number> }
    const x: number = pos.x()
    const y: number = pos.y()
    const o: number = pos.opacity()
    expect([x, y, o]).toEqual([0, 0, 0])
  })
})

describe('motion / tween — shorthand duration + .values', () => {
  test('shorthand duration: tween(target, 300) works as tween(target, { duration: 300 })', () => {
    resetClock()
    const target = state(0)
    const a = tween(target, 300)
    a() // initialize startT
    target.set(100)
    a() // re-target snapshot at t=0
    // Step through the tween, reading each frame.
    for (let i = 0; i < 25; i++) {
      _advanceClockForTest(16)
      a()
    }
    // After ~400ms (> 300ms duration) the tween has settled.
    expect(a()).toBeCloseTo(100, 6)
  })

  test('tween.values returns a record of derived signals', () => {
    resetClock()
    const w = state(0)
    const h = state(0)
    const dims = tween.values({ w, h }, 200)
    dims.w()
    dims.h()
    w.set(400)
    h.set(300)
    dims.w()
    dims.h()
    for (let i = 0; i < 20; i++) {
      _advanceClockForTest(16)
      dims.w()
      dims.h()
    }
    expect(dims.w()).toBeCloseTo(400, 6)
    expect(dims.h()).toBeCloseTo(300, 6)
  })
})

describe('motion / delay', () => {
  test('lags the source by ms', () => {
    resetClock()
    const src = state('a')
    const d = delay(() => src(), 200)
    expect(d()).toBe('a')
    src.set('b')
    // Immediately after change, still 'a'.
    expect(d()).toBe('a')
    // Half-way: still 'a'.
    _advanceClockForTest(100)
    expect(d()).toBe('a')
    // After full delay: 'b'.
    _advanceClockForTest(100)
    expect(d()).toBe('b')
  })

  test('rapid changes — only the most recent value emits after delay', () => {
    resetClock()
    const src = state(0)
    const d = delay(() => src(), 100)
    d() // initialize
    src.set(1)
    d() // sees the change, schedules deadline at t+100
    _advanceClockForTest(50)
    src.set(2)
    d() // sees second change, re-schedules deadline at t+100 (now 50+100=150)
    _advanceClockForTest(50) // t=100, still before deadline of 150
    expect(d()).toBe(0)
    _advanceClockForTest(50) // t=150, deadline hit
    expect(d()).toBe(2)
  })
})

describe('motion / motionValue', () => {
  test('callable returns the (animated) current value', () => {
    resetClock()
    const x = motionValue(0, 'snap')
    expect(x()).toBe(0)
  })

  test('.set drives the spring toward a new target', () => {
    resetClock()
    const x = motionValue(0, 'snap')
    x()
    x.set(100)
    const finalV = stepAndRead(50, 16, x)
    expect(finalV).toBeCloseTo(100, 1)
  })

  test('.target exposes the un-smoothed target signal', () => {
    resetClock()
    const x = motionValue(50, 'gentle')
    expect(x.target()).toBe(50)
    x.set(200)
    // .target() updates immediately even though x() lags through the spring.
    expect(x.target()).toBe(200)
  })

  test('.snap sets the target (same semantic as .set for now)', () => {
    resetClock()
    const x = motionValue(0, 'snap')
    x()
    x.snap(999)
    const finalV = stepAndRead(50, 16, x)
    expect(finalV).toBeCloseTo(999, 1)
  })
})

describe('motion / colorMix', () => {
  test('t=0 short-circuits to endpoint a (identical string)', () => {
    expect(colorMix('red', 'blue', 0)).toBe('red')
    expect(colorMix('var(--bg)', 'var(--accent)', 0)).toBe('var(--bg)')
  })

  test('t=1 short-circuits to endpoint b (identical string)', () => {
    expect(colorMix('red', 'blue', 1)).toBe('blue')
    expect(colorMix('var(--bg)', 'var(--accent)', 1)).toBe('var(--accent)')
  })

  test('t=0.5 emits a balanced color-mix() in oklch by default', () => {
    expect(colorMix('red', 'blue', 0.5)).toBe(
      'color-mix(in oklch, red 50%, blue 50%)',
    )
  })

  test('arbitrary t emits the right percent split', () => {
    expect(colorMix('red', 'blue', 0.25)).toBe(
      'color-mix(in oklch, red 75%, blue 25%)',
    )
    expect(colorMix('red', 'blue', 0.75)).toBe(
      'color-mix(in oklch, red 25%, blue 75%)',
    )
  })

  test('out-of-range t clamps to [0,1]', () => {
    expect(colorMix('red', 'blue', -1)).toBe('red')
    expect(colorMix('red', 'blue', 2)).toBe('blue')
    expect(colorMix('red', 'blue', Number.POSITIVE_INFINITY)).toBe('blue')
    expect(colorMix('red', 'blue', Number.NEGATIVE_INFINITY)).toBe('red')
  })

  test('NaN clamps to 0', () => {
    expect(colorMix('red', 'blue', Number.NaN)).toBe('red')
  })

  test('t quantization keeps output stable across sub-millis flicker', () => {
    // 0.5001 → 0.5 (3-decimal quantization)
    expect(colorMix('red', 'blue', 0.5001)).toBe(
      'color-mix(in oklch, red 50%, blue 50%)',
    )
    expect(colorMix('red', 'blue', 0.4999)).toBe(
      'color-mix(in oklch, red 50%, blue 50%)',
    )
  })

  test('explicit space arg flows through to the CSS string', () => {
    expect(colorMix('red', 'blue', 0.5, 'srgb')).toBe(
      'color-mix(in srgb, red 50%, blue 50%)',
    )
    expect(colorMix('red', 'blue', 0.5, 'oklab')).toBe(
      'color-mix(in oklab, red 50%, blue 50%)',
    )
  })

  test('accepts var(...) + currentColor + transparent + oklch literals', () => {
    expect(colorMix('var(--a)', 'var(--b)', 0.5)).toBe(
      'color-mix(in oklch, var(--a) 50%, var(--b) 50%)',
    )
    expect(colorMix('currentColor', 'transparent', 0.5)).toBe(
      'color-mix(in oklch, currentColor 50%, transparent 50%)',
    )
    expect(colorMix('oklch(0.7 0.2 30)', 'oklch(0.4 0.1 200)', 0.3)).toBe(
      'color-mix(in oklch, oklch(0.7 0.2 30) 70%, oklch(0.4 0.1 200) 30%)',
    )
  })
})

describe('motion / lifecycle (motion())', () => {
  // Polyfill rAF for the JSDOM-less Node environment of this suite.
  // The framework's real call sites run in a browser where rAF exists;
  // here we shim it to setTimeout(0) for the timing arithmetic only.
  const origRaf = (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame
  const origCaf = (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame
  type RafShim = (cb: () => void) => ReturnType<typeof setTimeout>
  const shimRaf = ((cb: () => void) => setTimeout(cb, 0)) as unknown as RafShim
  const shimCaf = ((h: number) => clearTimeout(h)) as unknown as (handle: number) => void
  ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
    shimRaf
  ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame =
    shimCaf

  test('initial phase = "entered" when when()=true at creation', () => {
    const open = state(true)
    const m = motionLifecycle(() => open(), { duration: 100 })
    expect(m.phase()).toBe('entered')
    expect(m.shouldRender()).toBe(true)
  })

  test('initial phase = "exited" when when()=false at creation', () => {
    const open = state(false)
    const m = motionLifecycle(() => open(), { duration: 100 })
    expect(m.phase()).toBe('exited')
    expect(m.shouldRender()).toBe(false)
  })

  test('false → true emits enter then entered on next rAF', async () => {
    const open = state(false)
    const m = motionLifecycle(() => open(), { duration: 100 })
    open.set(true)
    expect(m.phase()).toBe('enter')
    expect(m.shouldRender()).toBe(true)
    // After rAF (shim = setTimeout 0): flips to entered.
    await new Promise<void>((resolve) => setTimeout(resolve, 4))
    expect(m.phase()).toBe('entered')
  })

  test('true → false emits exit; shouldRender stays true until duration elapses', async () => {
    const open = state(true)
    const m = motionLifecycle(() => open(), { duration: 50 })
    open.set(false)
    expect(m.phase()).toBe('exit')
    expect(m.shouldRender()).toBe(true) // still mounted during exit
    await new Promise<void>((resolve) => setTimeout(resolve, 80))
    expect(m.phase()).toBe('exited')
    expect(m.shouldRender()).toBe(false)
  })

  test('re-entering during exit cancels the unmount timer', async () => {
    const open = state(true)
    const m = motionLifecycle(() => open(), { duration: 100 })
    open.set(false)
    expect(m.phase()).toBe('exit')
    // Flip back to true mid-exit.
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    open.set(true)
    expect(m.phase()).toBe('enter')
    // Wait past the original exit deadline — should NOT be exited.
    await new Promise<void>((resolve) => setTimeout(resolve, 150))
    expect(m.phase()).toBe('entered')
    expect(m.shouldRender()).toBe(true)
  })

  // Restore real rAF if it existed.
  if (origRaf !== undefined) {
    ;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
      origRaf
  }
  if (origCaf !== undefined) {
    ;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame =
      origCaf
  }
})

describe('motion / flip', () => {
  test('flip() is a no-op on the server (no MutationObserver)', () => {
    // In Node test environment there's no real DOM. The primitive
    // must return a no-op disposer instead of throwing.
    const dispose = flip(null)
    expect(typeof dispose).toBe('function')
    dispose()
  })

  test('flip() with undefined container returns no-op disposer', () => {
    const dispose = flip(undefined)
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
  })
})
