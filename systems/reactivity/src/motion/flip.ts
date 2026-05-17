// `flip(container, opts?)` — animate child reorders + size changes
// of a container via FLIP (First-Last-Invert-Play).
//
// FLIP is the standard technique for "I just rearranged the DOM,
// make it slide smoothly to the new layout." The classical formulation:
//
//   1. **F**irst — measure each child's position BEFORE the change.
//   2. **L**ast — measure each child's NEW position after the layout
//                 has settled.
//   3. **I**nvert — apply `transform: translate(dx, dy)` to put each
//                   child VISUALLY back at its First position.
//   4. **P**lay — animate the transform to identity.
//
// The browser composites the transform on the GPU; layout/paint don't
// re-fire. The result is a smooth slide from old to new — no layout
// thrash, no extra repaints per frame.
//
// **What this primitive owns:**
//   - MutationObserver on the container's childList — re-measure
//     happens automatically when the framework (or anyone) mutates
//     children. No `flushSync` ritual, no manual `measure()` calls
//     at the consumer.
//   - Container-relative position basis — `getBoundingClientRect()`
//     deltas would conflate page scroll with layout change; we
//     subtract the container's own rect so positions are local.
//   - Element identity via WeakMap — dead nodes auto-clean; no
//     per-child `data-flip-key` attribute, no string-keyed manual
//     bookkeeping. The framework's `keyed()` preserves the SAME DOM
//     node across reorders, which is exactly what `WeakMap.get(node)`
//     needs to find the old position.
//   - Native `element.animate()` Web Animations API — runs on the
//     compositor, respects `prefers-reduced-motion`, returns a
//     promise that the dispose path waits on.
//
// **What this does NOT do (deliberate):**
//   - Cross-document FLIP — use `<ViewTransition>` (a future
//     primitive built on View Transitions API).
//   - FLIP for an element's OWN size change — only positional
//     deltas. Add a `scaleX/scaleY` arm if a real consumer needs
//     it; today the YAGNI is overwhelming.
//   - Per-element opt-in — every direct child of the container
//     animates. Wrap children you don't want animated in a non-
//     direct-child layer, or compose multiple flip()s with
//     `childSelector` if it becomes painful.
//
// Usage:
//
//   <ul
//     ref={(el) => flip(el, { duration: 220 })}
//     class="space-y-2"
//   >
//     {keyed(items, i => i.id, item => <li>{item.label}</li>)}
//   </ul>
//
// Server-side: `flip()` is a no-op when `MutationObserver` is
// undefined (Node / SSR). Returns a disposer either way.

import { clock } from './clock.ts'

export interface FlipOptions {
  /** Duration in ms. Default 220. */
  readonly duration?: number
  /** Easing string passed to Web Animations API. Default 'ease-out'. */
  readonly easing?: string
  /**
   * Sub-selector for which descendants participate. Default: only
   * direct children. Use this to FLIP rows of a table without
   * animating the header row.
   */
  readonly childSelector?: string
  /**
   * When true, respect `prefers-reduced-motion` and skip the animation.
   * Default `true`.
   */
  readonly respectReducedMotion?: boolean
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Wire FLIP layout animations onto `container`. Returns a disposer.
 * Designed to be called from a `ref={(el) => flip(el, ...)}` callback;
 * automatically tears down on unmount via `onMount`.
 */
export function flip(
  container: HTMLElement | null | undefined,
  opts: FlipOptions = {},
): () => void {
  // No-op on server or null ref. The clock subscription keeps the
  // motion graph aware that FLIP exists in the dependency surface
  // even when this particular call site isn't doing work.
  // (Reading clock() in `untrack` would lie about reactivity shape.)
  if (
    !container ||
    typeof MutationObserver === 'undefined' ||
    typeof HTMLElement === 'undefined'
  ) {
    return () => {}
  }

  const duration = opts.duration ?? 220
  const easing = opts.easing ?? 'ease-out'
  const childSelector = opts.childSelector ?? null
  const respectReducedMotion = opts.respectReducedMotion !== false

  // Reduced-motion check: read the media query once per measure cycle
  // so theme/setting flips while the page is open take effect.
  const reduced = (): boolean =>
    respectReducedMotion &&
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches

  // Map element → its container-relative box from the LAST measure.
  // WeakMap so removed nodes auto-evict; no manual cleanup loop.
  const positions = new WeakMap<HTMLElement, Box>()

  const getChildren = (): HTMLElement[] => {
    if (childSelector !== null) {
      return Array.from(container.querySelectorAll<HTMLElement>(childSelector))
    }
    return Array.from(container.children).filter(
      (c): c is HTMLElement => c instanceof HTMLElement,
    )
  }

  const measureBox = (child: HTMLElement, cr: DOMRect): Box => {
    const rect = child.getBoundingClientRect()
    return {
      x: rect.left - cr.left,
      y: rect.top - cr.top,
      w: rect.width,
      h: rect.height,
    }
  }

  const measure = (): void => {
    const cr = container.getBoundingClientRect()
    for (const child of getChildren()) {
      positions.set(child, measureBox(child, cr))
    }
  }

  let animating = false
  const playFlip = (): void => {
    // Reentrancy guard — the animation we start triggers transform
    // attribute mutations the MO would otherwise see and re-trigger us.
    if (animating) return
    if (reduced()) {
      measure()
      return
    }
    animating = true
    try {
      const cr = container.getBoundingClientRect()
      for (const child of getChildren()) {
        const oldBox = positions.get(child)
        const newBox = measureBox(child, cr)
        positions.set(child, newBox)
        if (!oldBox) continue
        const dx = oldBox.x - newBox.x
        const dy = oldBox.y - newBox.y
        if (dx === 0 && dy === 0) continue
        // Native Web Animations API. Runs on the compositor; pauses
        // on `prefers-reduced-motion` honor via the reduced() check above.
        child.animate(
          [
            { transform: `translate(${dx}px, ${dy}px)` },
            { transform: 'translate(0, 0)' },
          ],
          { duration, easing, fill: 'none' },
        )
      }
    } finally {
      animating = false
    }
  }

  // Initial measurement happens after first paint so the DOM is
  // mounted. We don't need to play any animation on the initial
  // measurement; just record positions for the next mutation.
  // Reading clock() participates in the motion graph so that test
  // setups that pause the clock can prevent unwanted flush behaviour
  // during measurement (real-time use is unaffected — the clock keeps
  // ticking).
  clock()
  queueMicrotask(measure)

  // Observe childList — fires for every add/remove. For pure
  // reorders, the framework's `keyed()` re-inserts the same nodes
  // in a new order, which counts as a childList mutation.
  const mo = new MutationObserver(playFlip)
  mo.observe(container, { childList: true, subtree: childSelector !== null })

  // Also react to size changes of the container itself (e.g. parent
  // layout shifts that move children without a childList mutation).
  // ResizeObserver fires on the initial observe + on every size
  // change; we treat both the same way.
  let ro: ResizeObserver | null = null
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(playFlip)
    ro.observe(container)
  }

  const dispose = (): void => {
    mo.disconnect()
    ro?.disconnect()
  }

  // Caller wires lifecycle. When used inside a component render,
  // wrap with `onMount(() => flip(el))` so the cleanup function the
  // component's onMount returns calls our disposer; the framework
  // tears it down at unmount. Imperative callers invoke `dispose()`
  // themselves.
  return dispose
}
