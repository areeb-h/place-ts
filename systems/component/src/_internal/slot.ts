// Hydration-slot cursor — internal helper shared between the element
// factory's `hydrate` method (in `index.ts`) and the public
// `hydrate()` entry (in `_client-mount.ts`). Lifted out of `index.ts`
// so the public client-mount leaf can construct slots without pulling
// the full framework barrel through Bun's static-import graph.
//
// A HydrationSlot is a stateful cursor over a parent element's child
// nodes. It walks element nodes in order, skipping whitespace text +
// comments. `nextElement()` returns the element at the cursor's
// current position and advances; `peekElement()` returns the same
// element without advancing. The cursor exhausts when no more
// elements are reachable.

import type { HydrationSlot } from '../types.ts'

export function makeSlot(parent: ParentNode): HydrationSlot {
  let i = 0
  // Skip non-element nodes (whitespace text, comments) from the
  // cursor's current position. Returns the element node at that
  // position WITHOUT advancing `i`. Used by both `nextElement`
  // (which advances after) and `peekElement` (which doesn't).
  const advanceToNextElement = (): Element | null => {
    while (i < parent.childNodes.length) {
      const n = parent.childNodes[i]
      if (n && n.nodeType === 1) return n as Element
      i++
    }
    return null
  }
  return {
    nextElement: () => {
      const el = advanceToNextElement()
      if (el !== null) i++
      return el
    },
    peekElement: () => advanceToNextElement(),
    parent: () => parent,
  }
}
