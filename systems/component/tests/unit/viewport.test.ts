// @vitest-environment happy-dom

import { beforeEach, describe, expect, test } from 'vitest'
import { configureViewport, viewport } from '../../src/index.ts'

// `viewport` is a module-level singleton — tests share state. The
// reset hook is only the configureViewport call; the underlying
// state cells initialize once. To keep tests independent we re-
// configure with known defaults at the start of every test.

describe('viewport — SSR / initial values', () => {
  beforeEach(() => {
    configureViewport({
      breakpoints: { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 },
      defaultBreakpoint: 'sm',
    })
  })

  test('initial width is the default breakpoint width (mobile-first)', () => {
    // Note: in happy-dom the window object exists but the runtime
    // hasn't fired (no <script> in this test context). The state
    // cells hold their initial values.
    const w = viewport.width()
    expect(typeof w).toBe('number')
    expect(w).toBeGreaterThan(0)
  })

  test('breakpoint() returns one of the typed breakpoint names', () => {
    const bp = viewport.breakpoint()
    expect(['sm', 'md', 'lg', 'xl', '2xl']).toContain(bp)
  })

  test('matches(query) is a callable returning a boolean', () => {
    const isMobile = viewport.matches('(max-width: 600px)')
    expect(typeof isMobile()).toBe('boolean')
  })
})

describe('viewport — breakpoint logic via dispatched event', () => {
  test('dispatching place:viewport updates the reactive state', () => {
    // Simulate the runtime by dispatching the same CustomEvent shape.
    const ev = new CustomEvent('place:viewport', {
      detail: { w: 1200, h: 800, rm: false, d: false },
    })
    window.dispatchEvent(ev)

    expect(viewport.width()).toBe(1200)
    expect(viewport.height()).toBe(800)
    // 1200px is >= 1024 (lg) but < 1280 (xl) → lg.
    expect(viewport.breakpoint()).toBe('lg')
  })

  test('breakpoint cascades correctly across the Tailwind ladder', () => {
    const dispatch = (w: number): void => {
      window.dispatchEvent(
        new CustomEvent('place:viewport', { detail: { w, h: 800, rm: false, d: false } }),
      )
    }
    dispatch(300)
    expect(viewport.breakpoint()).toBe('sm')
    dispatch(800) // 800 >= 768 (md threshold) but < 1024 (lg)
    expect(viewport.breakpoint()).toBe('md')
    dispatch(1100) // 1100 >= 1024 (lg)
    expect(viewport.breakpoint()).toBe('lg')
    dispatch(1400) // 1400 >= 1280 (xl)
    expect(viewport.breakpoint()).toBe('xl')
    dispatch(2000) // 2000 >= 1536 (2xl)
    expect(viewport.breakpoint()).toBe('2xl')
  })

  test('prefersReducedMotion + prefersDark track the dispatched payload', () => {
    window.dispatchEvent(
      new CustomEvent('place:viewport', {
        detail: { w: 800, h: 600, rm: true, d: true },
      }),
    )
    expect(viewport.prefersReducedMotion()).toBe(true)
    expect(viewport.prefersDark()).toBe(true)
    window.dispatchEvent(
      new CustomEvent('place:viewport', {
        detail: { w: 800, h: 600, rm: false, d: false },
      }),
    )
    expect(viewport.prefersReducedMotion()).toBe(false)
    expect(viewport.prefersDark()).toBe(false)
  })
})

describe('viewport — configureViewport()', () => {
  test('custom breakpoints reshape the cascade', () => {
    configureViewport({
      breakpoints: { sm: 400, md: 600, lg: 900, xl: 1200, '2xl': 1500 },
      defaultBreakpoint: 'sm',
    })
    const dispatch = (w: number): void => {
      window.dispatchEvent(
        new CustomEvent('place:viewport', { detail: { w, h: 800, rm: false, d: false } }),
      )
    }
    dispatch(500)
    expect(viewport.breakpoint()).toBe('sm') // 500 < 600
    dispatch(700)
    expect(viewport.breakpoint()).toBe('md') // 700 in [600, 900)
    dispatch(1000)
    expect(viewport.breakpoint()).toBe('lg') // 1000 in [900, 1200)
  })
})

describe('viewport — edge cases (Tier 15-F)', () => {
  beforeEach(() => {
    configureViewport({
      breakpoints: { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 },
      defaultBreakpoint: 'sm',
    })
  })

  test('width exactly AT a breakpoint threshold lands in the larger bucket', () => {
    // The cascade is `w >= threshold` (mobile-first, inclusive). Width
    // exactly at 768 should be `md`, not `sm`.
    const dispatch = (w: number): void => {
      window.dispatchEvent(
        new CustomEvent('place:viewport', { detail: { w, h: 800, rm: false, d: false } }),
      )
    }
    dispatch(768)
    expect(viewport.breakpoint()).toBe('md')
    dispatch(1024)
    expect(viewport.breakpoint()).toBe('lg')
    dispatch(1280)
    expect(viewport.breakpoint()).toBe('xl')
    dispatch(1536)
    expect(viewport.breakpoint()).toBe('2xl')
  })

  test('width 1px below a threshold stays in the smaller bucket', () => {
    const dispatch = (w: number): void => {
      window.dispatchEvent(
        new CustomEvent('place:viewport', { detail: { w, h: 800, rm: false, d: false } }),
      )
    }
    dispatch(767) // 1px below md threshold
    expect(viewport.breakpoint()).toBe('sm')
    dispatch(1023) // 1px below lg
    expect(viewport.breakpoint()).toBe('md')
    dispatch(1535) // 1px below 2xl
    expect(viewport.breakpoint()).toBe('xl')
  })

  test('zero / negative widths still resolve to sm (graceful degradation)', () => {
    const dispatch = (w: number): void => {
      window.dispatchEvent(
        new CustomEvent('place:viewport', { detail: { w, h: 800, rm: false, d: false } }),
      )
    }
    dispatch(0)
    expect(viewport.breakpoint()).toBe('sm')
    // Negative is unrealistic but shouldn't crash the cascade.
    dispatch(-100)
    expect(viewport.breakpoint()).toBe('sm')
  })

  test('very large widths cap at 2xl (the topmost named breakpoint)', () => {
    const dispatch = (w: number): void => {
      window.dispatchEvent(
        new CustomEvent('place:viewport', { detail: { w, h: 800, rm: false, d: false } }),
      )
    }
    dispatch(10_000) // ultra-wide displays
    expect(viewport.breakpoint()).toBe('2xl')
    dispatch(Number.MAX_SAFE_INTEGER)
    expect(viewport.breakpoint()).toBe('2xl')
  })

  test('matches(query) returns a stable Derived across repeated calls (cache invariant)', () => {
    // Multiple calls with the same query return the SAME derived
    // instance — important for downstream subscribers that hold the
    // reference across re-renders.
    const a = viewport.matches('(min-width: 800px)')
    const b = viewport.matches('(min-width: 800px)')
    expect(a).toBe(b)
    // Different queries return different deriveds.
    const c = viewport.matches('(min-width: 900px)')
    expect(a).not.toBe(c)
  })

  test('configureViewport called twice — latest config wins', () => {
    configureViewport({
      breakpoints: { sm: 100, md: 200, lg: 300, xl: 400, '2xl': 500 },
      defaultBreakpoint: 'sm',
    })
    configureViewport({
      breakpoints: { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 },
    })
    window.dispatchEvent(
      new CustomEvent('place:viewport', { detail: { w: 800, h: 600, rm: false, d: false } }),
    )
    // The SECOND config wins: 800 < 1024, so breakpoint is 'md'.
    expect(viewport.breakpoint()).toBe('md')
  })
})
