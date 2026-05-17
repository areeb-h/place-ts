// Round 6 — `virtualList()` primitive (audit 6.A).
//
// Windowed-render primitive for long lists. Ports the *insight* of
// TanStack Virtual (measure + overscan + scroll-into-view) without
// porting its React baggage (`useVirtualizer` hook tuple, hook-cycle
// lifecycle, ResizeObserver-via-React's-commit-phase, `measureElement`
// passed as a ref-shaped callback). See ADR 0008 for the doctrine.
//
// The API is reactive-first:
//
//   const list = virtualList({
//     count: () => notes().length,
//     estimateSize: () => 80,
//     overscan: 5,
//   })
//
//   view: () => (
//     <div ref={list.containerRef} class="h-[600px] overflow-auto">
//       <div style={() => `position: relative; height: ${list.totalSize()}px`}>
//         {keyed(
//           list.visible,
//           item => notes()[item.index].id,
//           item => (
//             <div style={() => `position: absolute; top: ${item.start}px; height: ${item.size}px`}>
//               <NoteRow note={notes()[item.index]} />
//             </div>
//           ),
//         )}
//       </div>
//     </div>
//   )
//
// `totalSize()` and `visible()` are reactive — they re-derive when count,
// scroll offset, viewport size, or any measured size changes. Pair with
// `keyed()` so the list reconciles efficiently.
//
// SSR: with no DOM, no ResizeObserver, no scroll, the viewport defaults
// to `initialViewport` (600 px) and scroll offset is 0. The server
// renders the first ~600 px worth of items + overscan; the client takes
// over once `containerRef` attaches. The trade-off is documented and
// the initialViewport size is tunable per call.

import { state } from '@place/reactivity'
import { onCleanup } from './index.ts'

/**
 * A single windowed item. Indexed into the user's source list; `start`
 * and `end` are pixel offsets within the virtual scrollable area;
 * `size` is the item's measured-or-estimated pixel size.
 */
export interface VirtualItem {
  readonly index: number
  readonly start: number
  readonly end: number
  readonly size: number
}

export interface VirtualListOptions {
  /**
   * Reactive total item count. Pass as a function so the virtualizer
   * tracks reads via the reactivity system — when the count signal
   * changes, `totalSize()` and `visible()` re-derive automatically.
   */
  count: () => number
  /**
   * Per-index size estimator in pixels. Called for every unmeasured
   * index when computing `totalSize` and visibility. Override per-item
   * by calling `measureElement(index, el)` from a mounted row's `ref`.
   *
   * For uniform-size lists, return a constant: `estimateSize: () => 80`.
   * For variable-size lists you know in advance, branch on index.
   * For dynamic-size lists, return a sensible default and let
   * `measureElement` correct the real value at mount time.
   */
  estimateSize: (index: number) => number
  /**
   * Items to render above + below the visible window. Default 5.
   * Higher values reduce flicker on fast scrolls at the cost of more
   * DOM nodes off-screen.
   */
  overscan?: number
  /**
   * Horizontal list (scroll left/right) instead of vertical. Default
   * false. Affects which dimension is read from the container
   * (`offsetWidth`/`scrollLeft` vs `offsetHeight`/`scrollTop`).
   */
  horizontal?: boolean
  /**
   * Viewport pixel size used during SSR + before `containerRef`
   * attaches. Default 600. Higher values make SSR render more content
   * (slower TTFB, less hydration flash); lower values make SSR cheaper
   * (more content slides in post-hydration). Tune per workload.
   */
  initialViewport?: number
}

export interface VirtualList {
  /** Total scrollable size in pixels — sum of all item sizes. */
  totalSize: () => number
  /** Items currently visible + overscan. Reactive: re-derives on count
   *  change, scroll, viewport resize, or measured-size update. */
  visible: () => readonly VirtualItem[]
  /** Attach to the scrollable container's `ref` prop. The virtualizer
   *  reads the container's size + scroll offset and wires listeners to
   *  keep `visible()` in sync. Pass `null` to detach (the framework's
   *  view-disposal pipeline calls this automatically). */
  containerRef: (el: HTMLElement | null) => void
  /**
   * Report the real DOM size of a rendered item at the given index.
   * Pass the row element's `ref`. Updates the internal measured-size
   * cache; if the size differs from the estimate, the list re-derives.
   *
   * Use only for dynamic-size rows (e.g. variable text length). For
   * uniform-size rows the estimator alone is sufficient.
   */
  measureElement: (index: number, el: HTMLElement | null) => void
  /**
   * Programmatically scroll to an item. `align` controls how the item
   * sits within the viewport:
   *   - 'start' (default): item's top aligns with viewport's top
   *   - 'center': item centers in the viewport
   *   - 'end': item's bottom aligns with viewport's bottom
   *   - 'auto': scroll the minimum amount needed to make the item visible
   */
  scrollToIndex: (index: number, opts?: { align?: 'start' | 'center' | 'end' | 'auto' }) => void
  /** Programmatically scroll to a raw pixel offset. Clamped to >= 0. */
  scrollToOffset: (offset: number) => void
}

/**
 * Create a virtualizer for a long list. Returns reactive `totalSize()`
 * + `visible()` and imperative `containerRef`/`measureElement`/
 * `scrollToIndex`/`scrollToOffset`. See ADR 0008 for the design notes;
 * see the README for the worked example.
 */
export function virtualList(opts: VirtualListOptions): VirtualList {
  const overscan = opts.overscan ?? 5
  const horizontal = opts.horizontal ?? false
  const initialViewport = opts.initialViewport ?? 600

  // Reactive: viewport size (replaced once the real container attaches),
  // scroll offset, and a "measure version" counter that bumps whenever
  // `measureElement` records a changed size. Combining all three into
  // `visible`/`totalSize` lets the reactivity system handle invalidation
  // — no manual subscriber bookkeeping.
  const viewportSize = state(initialViewport)
  const scrollOffset = state(0)
  const measureVersion = state(0)
  // Map<index, measuredPx>. Spread sparse: only indices that have been
  // mounted+measured are present. Reads fall back to `estimateSize`.
  const measuredSizes = new Map<number, number>()

  const sizeOf = (i: number): number => measuredSizes.get(i) ?? opts.estimateSize(i)

  // Prefix-sum cache. `prefix[i]` = sum of sizes for indices 0..i-1.
  // Built lazily from current `count()` + `measureVersion`. Rebuilt
  // when count() changes OR measureVersion increments (i.e., a size
  // changed). This turns offsetOf from O(i) to O(1) and totalSize
  // from O(n) per read to O(1) — the difference that lets virtual-
  // list handle 100k+ items at 60 fps without scroll-handler stalls.
  // Build cost is O(n) at the START of each visible() pass that
  // observed a count/measure change; afterwards every offsetOf inside
  // that same reactive run is a Map.get-free array index.
  let prefixSum: number[] = [0]
  let prefixBuiltForCount = -1
  let prefixBuiltForVersion = -1

  const ensurePrefix = (): void => {
    const n = opts.count()
    const v = measureVersion.read()
    if (prefixBuiltForCount === n && prefixBuiltForVersion === v) return
    const arr = new Array<number>(n + 1)
    arr[0] = 0
    let sum = 0
    for (let i = 0; i < n; i++) {
      sum += sizeOf(i)
      arr[i + 1] = sum
    }
    prefixSum = arr
    prefixBuiltForCount = n
    prefixBuiltForVersion = v
  }

  // O(1) cumulative offset (after the lazy prefix build).
  const offsetOf = (i: number): number => {
    ensurePrefix()
    // Clamp the index so callers asking for `offsetOf(n + k)` get the
    // last sum rather than `undefined` — defensive for `endIdx + overscan`
    // walks that overshoot the array.
    if (i <= 0) return 0
    if (i >= prefixSum.length) return prefixSum[prefixSum.length - 1] ?? 0
    return prefixSum[i] ?? 0
  }

  const totalSize = state((): number => {
    ensurePrefix()
    return prefixSum[prefixSum.length - 1] ?? 0
  })

  // Binary-search helpers on the prefix-sum (O(log n)). Two distinct
  // semantics we care about:
  //
  //  • **first item ENDING after target** — used for `startIdx`. The
  //    first item whose [start, end) range *includes any pixel past
  //    target*; item `i` ends at `prefix[i + 1]`.
  //  • **first item STARTING at or past target** — used for `endIdx`
  //    (exclusive upper bound). Item `i` starts at `prefix[i]`.
  //
  // The two diverge at the viewport-bottom boundary: an item whose
  // START is exactly at `off + view` is not visible (its first pixel
  // is past the visible window) and must be excluded from `endIdx`,
  // but an item whose END is exactly at `off` is similarly off-screen
  // and *not* `startIdx`. Splitting the search resolves both cases
  // cleanly without off-by-one fudging.
  const firstItemEndingAfter = (target: number): number => {
    const arr = prefixSum
    let lo = 0
    let hi = arr.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if ((arr[mid + 1] ?? Number.POSITIVE_INFINITY) > target) hi = mid
      else lo = mid + 1
    }
    return lo
  }
  const firstItemStartingAtOrAfter = (target: number): number => {
    const arr = prefixSum
    let lo = 0
    let hi = arr.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if ((arr[mid] ?? Number.POSITIVE_INFINITY) >= target) hi = mid
      else lo = mid + 1
    }
    return lo
  }

  const visible = state((): readonly VirtualItem[] => {
    ensurePrefix()
    const n = opts.count()
    if (n === 0) return []
    const off = scrollOffset.read()
    const view = viewportSize.read()

    const startIdx = firstItemEndingAfter(off)
    const endIdx = Math.min(n, firstItemStartingAtOrAfter(off + view))

    // Apply overscan, clamped to list bounds.
    const lo = Math.max(0, startIdx - overscan)
    const hi = Math.min(n, endIdx + overscan)

    // Build the windowed item array. `pos` starts at the lo'th item's
    // cumulative offset; we walk forward summing sizes.
    const items: VirtualItem[] = []
    let pos = offsetOf(lo)
    for (let i = lo; i < hi; i++) {
      const sz = sizeOf(i)
      items.push({ index: i, start: pos, end: pos + sz, size: sz })
      pos += sz
    }
    return items
  })

  let containerEl: HTMLElement | null = null
  let resizeObs: ResizeObserver | null = null
  let scrollHandler: ((this: HTMLElement, ev: Event) => void) | null = null

  const detach = (): void => {
    if (containerEl && scrollHandler) {
      containerEl.removeEventListener('scroll', scrollHandler)
    }
    if (resizeObs) {
      resizeObs.disconnect()
      resizeObs = null
    }
    containerEl = null
    scrollHandler = null
  }

  const containerRef = (el: HTMLElement | null): void => {
    detach()
    if (el === null) return
    containerEl = el
    const rect = el.getBoundingClientRect()
    viewportSize.write(horizontal ? rect.width : rect.height)

    scrollHandler = () => {
      const off = horizontal ? el.scrollLeft : el.scrollTop
      scrollOffset.write(off)
    }
    el.addEventListener('scroll', scrollHandler, { passive: true })

    if (typeof ResizeObserver !== 'undefined') {
      resizeObs = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const r = entry.contentRect
          viewportSize.write(horizontal ? r.width : r.height)
        }
      })
      resizeObs.observe(el)
    }
  }

  const measureElement = (index: number, el: HTMLElement | null): void => {
    if (el === null) return
    const r = el.getBoundingClientRect()
    const sz = horizontal ? r.width : r.height
    const prev = measuredSizes.get(index)
    if (prev !== sz) {
      measuredSizes.set(index, sz)
      measureVersion.write(measureVersion.read() + 1)
    }
  }

  const scrollToOffset = (offset: number): void => {
    if (!containerEl) return
    const clamped = Math.max(0, offset)
    if (horizontal) containerEl.scrollLeft = clamped
    else containerEl.scrollTop = clamped
  }

  const scrollToIndex = (
    index: number,
    callOpts: { align?: 'start' | 'center' | 'end' | 'auto' } = {},
  ): void => {
    const align = callOpts.align ?? 'auto'
    const itemStart = offsetOf(index)
    const itemSize = sizeOf(index)
    const view = viewportSize.read()
    let target: number
    if (align === 'center') {
      target = itemStart - (view - itemSize) / 2
    } else if (align === 'end') {
      target = itemStart - view + itemSize
    } else if (align === 'auto') {
      const curr = scrollOffset.read()
      if (itemStart < curr) {
        target = itemStart
      } else if (itemStart + itemSize > curr + view) {
        target = itemStart - view + itemSize
      } else {
        return // already visible — no-op
      }
    } else {
      target = itemStart // 'start' alignment
    }
    scrollToOffset(target)
  }

  // Register `detach` against the enclosing view's disposer chain. When
  // called outside a mount context (e.g. tests that construct a
  // virtualList eagerly), `onCleanup` is a no-op — so this is safe to
  // call unconditionally.
  onCleanup(detach)

  return {
    totalSize: () => totalSize.read(),
    visible: () => visible.read(),
    containerRef,
    measureElement,
    scrollToIndex,
    scrollToOffset,
  }
}
