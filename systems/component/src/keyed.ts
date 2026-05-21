// keyed — keyed list reconciliation.
//
// Extracted from index.ts (Tier 1-A continuation, 2026-05-14). The
// keyed primitive is self-contained: it only depends on `View` +
// `Disposer` types and the reactivity primitives `watch` + `untrack`.
//
// Why extract: keyed was a 300-line section of the framework barrel.
// Pulling it into its own module helps tree-shaking and keeps the
// barrel manageable. Per-island bundles that don't use `keyed` no
// longer pay the cost of having it loaded into the same module graph
// as `mount` / `hydrate`.
//
// Renders a reactive list of items. Each item is identified by a key
// (typically a string or number). When the list changes:
//   - items with the same key are reused (their views, including any state
//     inside, are preserved)
//   - new keys are mounted
//   - removed keys are disposed
//   - reorderings move DOM nodes rather than re-rendering
//
// This is the strict improvement over Solid's `<For>` primitive — same
// keyed reconciliation, but exposed as a plain function returning a View
// rather than a special component primitive the compiler treats specially.
//
//   keyed(
//     () => notes.read(),
//     (note) => note.id,
//     (note) => <NoteRow note={note} />,
//   )
//
// **Important:** the render fn's `item` and `index` arguments are captured
// at first-render time for that key. They do *not* reactively update if
// the item moves position or if the underlying item changes. To handle
// these cases:
//   - For position-aware handlers, look up the current index by key at
//     click time (e.g. `items.read().findIndex(it => it.id === item.id)`).
//   - For per-item reactivity, store each item as its own state and read
//     it inside the row.
//
// Phase 2.x candidate: a variant where render receives reactive
// `(() => T, () => number)` getters. Deferred until a real use case demands
// it; the convention above is sufficient for the commonplace book reference
// design.
//
// Implementation notes:
//   - Each item is delimited by a comment marker placed BEFORE its DOM.
//   - Reordering walks the new order in REVERSE, moving each item's range
//     to before the next-already-placed item's marker. The reverse walk
//     means the "anchor" is always already in the right place when we get
//     to the previous item.
//   - getRange is O(n) per call; total per-update is O(n²) in the
//     pathological case. Acceptable for v0.2; lists with thousands of items
//     warrant a future optimization (e.g. precomputed range cache).

import { type Disposer, untrack, watch } from '@place-ts/reactivity'
import type { View } from './types.ts'

export function keyed<T, K>(
  items: () => readonly T[],
  keyFn: (item: T, index: number) => K,
  render: (item: T, index: number) => View,
): View {
  return {
    // SSR: render each item's view to HTML and concat. No marker comments
    // (those are mount-time bookkeeping). Hydration walks the slot in
    // the same order, so the per-item DOM lines up.
    toHtml: () => {
      const list = untrack(() => items())
      let out = ''
      for (let i = 0; i < list.length; i++) {
        const view = render(list[i] as T, i)
        if (view.toHtml) out += view.toHtml()
      }
      return out
    },
    // Hydration: adopt each SSR'd item AND install the same watch-
    // based reconciliation the mount path uses, so post-hydrate
    // mutations to the items list update the DOM correctly.
    //
    // The mount path uses one marker Comment per item plus an
    // endMarker to bound the keyed range; hydrate needs the same
    // shape so subsequent reconciliation can locate per-item DOM
    // ranges. We insert the markers DURING hydrate (the SSR'd HTML
    // has none — `toHtml()` deliberately emits no marker comments)
    // and let the standard watch-based diff handle every change
    // after that.
    hydrate(slot) {
      const parent = slot.parent()
      type Entry = { marker: Comment; dispose: Disposer }
      const byKey = new Map<K, Entry>()
      let currentOrder: K[] = []

      // 1) Adopt the SSR'd per-item subtrees in order. For each
      //    initial item we (a) insert a marker comment at the
      //    current cursor position (so the marker sits BEFORE that
      //    item's DOM), (b) hydrate the item's view which advances
      //    the slot past the item's nodes, and (c) record the
      //    marker + disposer keyed by the item's key.
      const initialList = untrack(() => items())
      const seenKeys = new Set<K>()
      for (let i = 0; i < initialList.length; i++) {
        const k = keyFn(initialList[i] as T, i)
        if (seenKeys.has(k)) {
          throw new Error(
            `keyed: duplicate key ${JSON.stringify(k)} at index ${i}. ` +
              'Each item in a keyed list must have a unique key.',
          )
        }
        seenKeys.add(k)
        // Marker sits at the cursor BEFORE the item's first node so
        // the per-item DOM range is `marker.nextSibling..nextMarker`
        // (the same shape the mount path's getRange() expects).
        const marker = document.createComment('keyed:item')
        const cursor = slot.peekElement()
        if (cursor !== null) parent.insertBefore(marker, cursor)
        else parent.appendChild(marker)
        const view = render(initialList[i] as T, i)
        const dispose = view.hydrate?.(slot) ?? (() => {})
        byKey.set(k, { marker, dispose })
        currentOrder[i] = k
      }

      // 2) End marker bounds the range — placed AFTER the last
      //    item's DOM. peekElement() returns null when the slot
      //    is exhausted within the keyed region.
      const endMarker = document.createComment('keyed:end')
      const cursor = slot.peekElement()
      if (cursor !== null) parent.insertBefore(endMarker, cursor)
      else parent.appendChild(endMarker)

      // 3) Same getRange helper as the mount path — collects DOM
      //    nodes belonging to one entry, between its marker
      //    (inclusive) and the next marker (exclusive).
      const getRange = (entry: Entry): Node[] => {
        const out: Node[] = [entry.marker]
        const others = new Set<Node>([endMarker])
        for (const e of byKey.values()) {
          if (e !== entry) others.add(e.marker)
        }
        let cur: Node | null = entry.marker.nextSibling
        while (cur && !others.has(cur)) {
          out.push(cur)
          cur = cur.nextSibling
        }
        return out
      }

      // 4) Install the watch. The FIRST firing matches `currentOrder`
      //    (no DOM changes; just registers `items()` as a dependency
      //    of this watch). Subsequent firings reconcile via the same
      //    two-phase add/remove/move dance as mount.
      const watchDispose = watch(() => {
        const newItems = items()
        const n = newItems.length
        const newOrder: K[] = new Array(n)
        const newSet = new Set<K>()
        for (let i = 0; i < n; i++) {
          const k = keyFn(newItems[i] as T, i)
          if (newSet.has(k)) {
            throw new Error(
              `keyed: duplicate key ${JSON.stringify(k)} at index ${i}. ` +
                'Each item in a keyed list must have a unique key.',
            )
          }
          newOrder[i] = k
          newSet.add(k)
        }
        // Phase 1: dispose entries no longer present.
        for (const oldKey of currentOrder) {
          if (!newSet.has(oldKey)) {
            const entry = byKey.get(oldKey)
            if (!entry) continue
            for (const node of getRange(entry)) {
              if (node.parentNode) node.parentNode.removeChild(node)
            }
            entry.dispose()
            byKey.delete(oldKey)
          }
        }
        // Phase 2: position items in newOrder, reverse-walking so
        // each anchor is already placed when we need it.
        let nextAnchor: Node = endMarker
        for (let i = n - 1; i >= 0; i--) {
          const k = newOrder[i] as K
          let entry = byKey.get(k)
          if (entry === undefined) {
            const marker = document.createComment('keyed:item')
            parent.insertBefore(marker, nextAnchor)
            const view = untrack(() => render(newItems[i] as T, i))
            const dispose = untrack(() => view.mount(parent, nextAnchor))
            entry = { marker, dispose }
            byKey.set(k, entry)
          } else {
            const range = getRange(entry)
            for (const node of range) {
              parent.insertBefore(node, nextAnchor)
            }
          }
          nextAnchor = entry.marker
        }
        currentOrder = newOrder
      })

      return () => {
        watchDispose()
        for (const entry of byKey.values()) {
          for (const node of getRange(entry)) {
            if (node.parentNode) node.parentNode.removeChild(node)
          }
          entry.dispose()
        }
        byKey.clear()
        if (endMarker.parentNode) endMarker.parentNode.removeChild(endMarker)
      }
    },
    mount(parent, anchor) {
      const endMarker = document.createComment('keyed:end')
      parent.insertBefore(endMarker, anchor ?? null)

      type Entry = { marker: Comment; dispose: Disposer }
      const byKey = new Map<K, Entry>()
      let currentOrder: K[] = []

      // Returns the DOM nodes that belong to `entry`: from its marker
      // (inclusive) until the next marker in our chain or endMarker.
      const getRange = (entry: Entry): Node[] => {
        const out: Node[] = [entry.marker]
        const others = new Set<Node>([endMarker])
        for (const e of byKey.values()) {
          if (e !== entry) others.add(e.marker)
        }
        let cur: Node | null = entry.marker.nextSibling
        while (cur && !others.has(cur)) {
          out.push(cur)
          cur = cur.nextSibling
        }
        return out
      }

      const watchDispose = watch(() => {
        const newItems = items()
        const n = newItems.length
        const newOrder: K[] = new Array(n)
        const newSet = new Set<K>()

        for (let i = 0; i < n; i++) {
          const k = keyFn(newItems[i] as T, i)
          if (newSet.has(k)) {
            // Duplicate keys would map two list positions to the same
            // entry/marker pair — moves would corrupt the DOM range
            // tracked per-key. We refuse loudly instead of producing
            // mysterious visual glitches.
            throw new Error(
              `keyed: duplicate key ${JSON.stringify(k)} at index ${i}. ` +
                'Each item in a keyed list must have a unique key.',
            )
          }
          newOrder[i] = k
          newSet.add(k)
        }

        // Phase 1: dispose entries no longer present.
        for (const oldKey of currentOrder) {
          if (!newSet.has(oldKey)) {
            const entry = byKey.get(oldKey)
            if (!entry) continue
            for (const node of getRange(entry)) {
              if (node.parentNode) node.parentNode.removeChild(node)
            }
            entry.dispose()
            byKey.delete(oldKey)
          }
        }

        // Phase 2: position items in newOrder, walking in reverse so the
        // "anchor" is always already correctly placed.
        let nextAnchor: Node = endMarker
        for (let i = n - 1; i >= 0; i--) {
          const k = newOrder[i] as K
          let entry = byKey.get(k)

          if (entry === undefined) {
            // New key — create marker, render, mount before nextAnchor.
            // Both render() and view.mount() are untracked so that reads
            // inside the rendered subtree do not subscribe THIS keyed
            // watch — otherwise editing any item's reactive content would
            // trigger the keyed list to re-walk on every keystroke.
            const marker = document.createComment('keyed:item')
            parent.insertBefore(marker, nextAnchor)
            const view = untrack(() => render(newItems[i] as T, i))
            const dispose = untrack(() => view.mount(parent, nextAnchor))
            entry = { marker, dispose }
            byKey.set(k, entry)
          } else {
            // Existing entry — move its range to before nextAnchor. The
            // insertBefore calls are no-ops if already in position.
            const range = getRange(entry)
            for (const node of range) {
              parent.insertBefore(node, nextAnchor)
            }
          }

          nextAnchor = entry.marker
        }

        currentOrder = newOrder
      })

      return () => {
        watchDispose()
        for (const entry of byKey.values()) {
          for (const node of getRange(entry)) {
            if (node.parentNode) node.parentNode.removeChild(node)
          }
          entry.dispose()
        }
        byKey.clear()
        if (endMarker.parentNode) endMarker.parentNode.removeChild(endMarker)
      }
    },
  }
}
