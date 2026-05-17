// @vitest-environment node
//
// Round 6 (cut A) — `virtualList()` math + reactive integration + DOM
// cleanup. Most tests verify the windowing math directly via
// `totalSize()` / `visible()` (no DOM dependency). The container-ref
// + measureElement tests use a hand-rolled HTMLElement stub since the
// node env has no real DOM.

import { describe, expect, test, vi } from 'vitest'
import { state } from '../../../reactivity/src/index.ts'
import { virtualList } from '../../src/index.ts'

// ===== Minimal HTMLElement stub for tests =====
//
// virtualList's containerRef calls `getBoundingClientRect`,
// `addEventListener`, `removeEventListener`. The stub captures listeners
// so tests can verify cleanup. Width/height + scroll offsets are
// settable so tests drive scroll behavior synchronously.

interface Listener {
  type: string
  fn: (ev: Event) => void
}

interface FakeElement {
  width: number
  height: number
  scrollLeft: number
  scrollTop: number
  listeners: Listener[]
  getBoundingClientRect: () => { width: number; height: number }
  addEventListener: (type: string, fn: (ev: Event) => void) => void
  removeEventListener: (type: string, fn: (ev: Event) => void) => void
  dispatchScroll: () => void
}

function fakeElement(width = 600, height = 400): FakeElement {
  const listeners: Listener[] = []
  const el: FakeElement = {
    width,
    height,
    scrollLeft: 0,
    scrollTop: 0,
    listeners,
    getBoundingClientRect() {
      return { width: this.width, height: this.height }
    },
    addEventListener(type, fn) {
      listeners.push({ type, fn })
    },
    removeEventListener(type, fn) {
      const idx = listeners.findIndex((l) => l.type === type && l.fn === fn)
      if (idx >= 0) listeners.splice(idx, 1)
    },
    dispatchScroll() {
      for (const l of listeners) {
        if (l.type === 'scroll') l.fn({} as Event)
      }
    },
  }
  return el
}

describe('virtualList — windowing math (no DOM)', () => {
  test('empty list returns no visible items and zero total', () => {
    const list = virtualList({ count: () => 0, estimateSize: () => 40 })
    expect(list.visible()).toEqual([])
    expect(list.totalSize()).toBe(0)
  })

  test('uniform-size: viewport 200 + offset 0 + overscan 5 → visible covers 5 + 5', () => {
    // 100 items @ 40px each → totalSize 4000.
    // Visible (pre-overscan): items 0..4 (start=0 to end=200).
    // With overscan 5: lo = max(0, 0-5) = 0, hi = min(100, 5+5) = 10.
    const list = virtualList({
      count: () => 100,
      estimateSize: () => 40,
      overscan: 5,
      initialViewport: 200,
    })
    const vis = list.visible()
    expect(vis.length).toBe(10)
    expect(vis[0]?.index).toBe(0)
    expect(vis[9]?.index).toBe(9)
    expect(list.totalSize()).toBe(4000)
  })

  test('overscan clamps at the top boundary (no negative indices)', () => {
    const list = virtualList({
      count: () => 100,
      estimateSize: () => 40,
      overscan: 5,
      initialViewport: 200,
    })
    const vis = list.visible()
    expect(vis[0]?.index).toBe(0) // overscan would have wanted -5; clamped to 0
  })

  test('variable estimateSize: total reflects per-item sizes', () => {
    // 10 items: even indices = 60, odd = 40 → total = 5*60 + 5*40 = 500.
    const list = virtualList({
      count: () => 10,
      estimateSize: (i) => (i % 2 === 0 ? 60 : 40),
    })
    expect(list.totalSize()).toBe(500)
    const vis = list.visible()
    // start positions should be cumulative
    expect(vis[0]?.start).toBe(0)
    expect(vis[1]?.start).toBe(60) // first item is 60px
    expect(vis[2]?.start).toBe(100) // 60 + 40
    expect(vis[3]?.start).toBe(160) // 60 + 40 + 60
  })

  test('reactive count: increasing it bumps total and visible', () => {
    const count = state(10)
    const list = virtualList({
      count: () => count(),
      estimateSize: () => 40,
      initialViewport: 400,
    })
    expect(list.totalSize()).toBe(400) // 10 * 40
    count.set(20)
    expect(list.totalSize()).toBe(800)
  })

  test('measureElement: a larger measured size shifts subsequent items', () => {
    const list = virtualList({
      count: () => 5,
      estimateSize: () => 40,
      initialViewport: 1000, // big enough to render all 5
    })
    // Total starts at 5 * 40 = 200.
    expect(list.totalSize()).toBe(200)
    // Item index 2 is actually 100px tall.
    const el = { getBoundingClientRect: () => ({ width: 999, height: 100 }) }
    list.measureElement(2, el as unknown as HTMLElement)
    // Total becomes 40 + 40 + 100 + 40 + 40 = 260.
    expect(list.totalSize()).toBe(260)
    const vis = list.visible()
    // Item 3 should now start at 40 + 40 + 100 = 180, not 120.
    expect(vis[3]?.start).toBe(180)
  })

  test('measureElement: null el is a no-op', () => {
    const list = virtualList({ count: () => 3, estimateSize: () => 40 })
    const before = list.totalSize()
    list.measureElement(0, null)
    expect(list.totalSize()).toBe(before)
  })

  test('measureElement: same size as previous measurement does not bump version', () => {
    // If a size stays the same, the cache hit shouldn't trigger re-derivation.
    // We can't observe the version directly, but we can verify totalSize is
    // stable across redundant calls.
    const list = virtualList({ count: () => 3, estimateSize: () => 40 })
    const el = { getBoundingClientRect: () => ({ width: 999, height: 50 }) }
    list.measureElement(1, el as unknown as HTMLElement)
    const after1 = list.totalSize()
    list.measureElement(1, el as unknown as HTMLElement) // same size
    expect(list.totalSize()).toBe(after1)
  })

  test('scrollToOffset clamps to >= 0 and writes to scrollTop (vertical)', () => {
    const list = virtualList({ count: () => 100, estimateSize: () => 40 })
    const el = fakeElement(600, 400)
    list.containerRef(el as unknown as HTMLElement)
    list.scrollToOffset(800)
    expect(el.scrollTop).toBe(800)
    list.scrollToOffset(-50)
    expect(el.scrollTop).toBe(0) // clamped
  })

  test("scrollToIndex 'start' lands at the item's offset", () => {
    const list = virtualList({ count: () => 100, estimateSize: () => 40 })
    const el = fakeElement(600, 400)
    list.containerRef(el as unknown as HTMLElement)
    list.scrollToIndex(50, { align: 'start' })
    expect(el.scrollTop).toBe(50 * 40)
  })

  test("scrollToIndex 'center' centers the item in the viewport", () => {
    // viewport 400, item 50 at offset 2000, size 40 → target 2000 - (400-40)/2 = 2000 - 180 = 1820
    const list = virtualList({ count: () => 100, estimateSize: () => 40 })
    const el = fakeElement(600, 400)
    list.containerRef(el as unknown as HTMLElement)
    list.scrollToIndex(50, { align: 'center' })
    expect(el.scrollTop).toBe(1820)
  })

  test("scrollToIndex 'auto' is a no-op when item is already visible", () => {
    const list = virtualList({ count: () => 100, estimateSize: () => 40 })
    const el = fakeElement(600, 400) // viewport 400 → items 0..9 fit
    list.containerRef(el as unknown as HTMLElement)
    el.scrollTop = 0
    list.scrollToIndex(5, { align: 'auto' }) // item 5 is at offset 200, already in [0..400]
    expect(el.scrollTop).toBe(0) // not changed
  })

  test('horizontal mode reads width + scrollLeft', () => {
    const list = virtualList({
      count: () => 100,
      estimateSize: () => 40,
      horizontal: true,
    })
    const el = fakeElement(600, 400)
    list.containerRef(el as unknown as HTMLElement)
    list.scrollToIndex(10, { align: 'start' })
    expect(el.scrollLeft).toBe(400)
    expect(el.scrollTop).toBe(0)
  })
})

describe('virtualList — DOM lifecycle', () => {
  test('containerRef(el) attaches scroll listener; containerRef(null) detaches', () => {
    const list = virtualList({ count: () => 100, estimateSize: () => 40 })
    const el = fakeElement(600, 400)
    list.containerRef(el as unknown as HTMLElement)
    expect(el.listeners.filter((l) => l.type === 'scroll').length).toBe(1)
    list.containerRef(null)
    expect(el.listeners.filter((l) => l.type === 'scroll').length).toBe(0)
  })

  test('scroll event updates visible window', () => {
    const list = virtualList({
      count: () => 100,
      estimateSize: () => 40,
      overscan: 0,
    })
    const el = fakeElement(600, 200)
    list.containerRef(el as unknown as HTMLElement)
    // Initial: scroll 0, viewport 200 → items 0..4 visible.
    expect(list.visible()[0]?.index).toBe(0)
    // Scroll down 400px.
    el.scrollTop = 400
    el.dispatchScroll()
    // Now items 10..14 visible (offset 400, size 40 each).
    const vis = list.visible()
    expect(vis[0]?.index).toBe(10)
  })

  test('reattaching to a new element detaches the old listeners first', () => {
    const list = virtualList({ count: () => 100, estimateSize: () => 40 })
    const el1 = fakeElement(600, 400)
    const el2 = fakeElement(600, 400)
    list.containerRef(el1 as unknown as HTMLElement)
    expect(el1.listeners.length).toBeGreaterThan(0)
    list.containerRef(el2 as unknown as HTMLElement)
    // el1's scroll listener removed; el2's attached.
    expect(el1.listeners.filter((l) => l.type === 'scroll').length).toBe(0)
    expect(el2.listeners.filter((l) => l.type === 'scroll').length).toBe(1)
  })

  test('uses ResizeObserver when available (smoke check)', () => {
    // Set up a global ResizeObserver mock; verify .observe is called.
    const observe = vi.fn()
    const disconnect = vi.fn()
    class ResizeObserverMock {
      observe = observe
      disconnect = disconnect
      unobserve = (): void => {}
    }
    const globalAny = globalThis as { ResizeObserver?: typeof ResizeObserver }
    const prev = globalAny.ResizeObserver
    globalAny.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
    try {
      const list = virtualList({ count: () => 10, estimateSize: () => 40 })
      const el = fakeElement(600, 400)
      list.containerRef(el as unknown as HTMLElement)
      expect(observe).toHaveBeenCalledWith(el)
      list.containerRef(null)
      expect(disconnect).toHaveBeenCalled()
    } finally {
      if (prev === undefined) delete globalAny.ResizeObserver
      else globalAny.ResizeObserver = prev
    }
  })
})
