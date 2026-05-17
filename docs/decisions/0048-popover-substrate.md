# ADR 0048: Tier 17-B — unified popover substrate via CSS Anchor Positioning

**Status:** accepted (2026-05-17)
**Date:** 2026-05-17
**Affects:** `systems/design/src/_popover.ts` (new), `systems/design/src/{Combobox,Menu,Tooltip}.tsx` (migrated; delete ~300 LOC of per-component JS positioners).

## Context

`<Combobox>`, `<Menu>`, and `<Tooltip>` each carried their own
`getBoundingClientRect`-flip-clamp positioner that fired on every
open + on every scroll/resize event. The implementations differed in
subtle ways (Menu had per-placement code; Combobox had width-matching
math; Tooltip had a 4-way placement switch). None implemented
collision in both axes. The combined footprint was ~300 LOC of
fragile layout math reproducing what the browser now ships natively.

**CSS Anchor Positioning** (`anchor-name`, `position-anchor`,
`position-area`, `position-try-fallbacks`, `anchor-size()`) is
universal as of **Firefox 147 (Jan 13 2026)**. Charter §"What we
don't ship" hedged "until anchor positioning lands in FF" — that
hedge is now satisfied. We delete the JS positioners.

## Decision

Ship `systems/design/src/_popover.ts` — two pure helpers
(`anchorStyle(name)`, `popoverStyle({ anchor, placement, width,
offset })`) returning CSS strings that components apply via inline
`style`. The browser owns positioning, including collision-flip and
stays-pinned on scroll/resize.

### Public surface

```ts
export const nextAnchorName: () => string

export type PopoverPlacement =
  | 'top' | 'top-start' | 'top-end'
  | 'bottom' | 'bottom-start' | 'bottom-end'
  | 'left' | 'left-start' | 'left-end'
  | 'right' | 'right-start' | 'right-end'

export type PopoverWidth = 'auto' | 'anchor-width' | 'anchor-min-width'

export function anchorStyle(name: string): string
export function popoverStyle(opts: {
  anchor: string
  placement?: PopoverPlacement
  width?: PopoverWidth
  offset?: number
}): string

export function supportsAnchorPositioning(): boolean
```

### What the helpers emit

For `popoverStyle({ anchor: 'a1', placement: 'bottom-start', width:
'anchor-width', offset: 4 })`:

```css
position: fixed;
inset: auto;
position-anchor: --a1;
position-area: bottom span-right;
position-try-fallbacks: flip-block, flip-inline;
margin: 4px 0 0 0;
width: anchor-size(--a1 width);
```

For `anchorStyle('a1')`: `anchor-name: --a1;`.

### Per-component integration

- **Combobox** — shell gets `anchorStyle(name)`; listbox gets
  `popoverStyle({ anchor: name, placement: 'bottom-start', width:
  'anchor-width', offset: 4 })`. The dropdown's width matches the
  input's exact width via `anchor-size()` — no JS measuring. Old
  `positionPopover` + scroll/resize listener pair deleted.
- **Menu** — trigger element (`[popovertarget="${menuId}"]`) gets
  `anchor-name: --<name>` set via JS at mount time (one-shot DOM
  mutation; removed on dispose). Menu's `<div role="menu">` gets
  `popoverStyle({ anchor, placement, offset: 4 })`. Old
  `positionMenu` + scroll/resize listener pair deleted.
- **Tooltip** — trigger wrapper gets `anchor-name` on mount; bubble
  gets `popoverStyle({ anchor, placement, offset: 8 })`. Old
  `position` + scroll/resize listener pair deleted.

### Per-side margin math

The gap-rendering margin is per-side (only the side facing the anchor
gets the offset). For `placement: 'bottom-*'`, `margin: <offset> 0 0
0;` (gap on top). For `top-*`, `margin: 0 0 <offset> 0;` (gap on
bottom). Same logic for `left-*` and `right-*`.

### Collision fallbacks

Vertical placements get `position-try-fallbacks: flip-block,
flip-inline` (flip top↔bottom first, then left↔right). Horizontal
placements get `flip-inline, flip-block` (flip left↔right first).
The browser tries the primary placement, then each fallback in
order, picking the first that fits.

## Consequences

### Deleted

- ~300 LOC of `getBoundingClientRect`-based math across Combobox /
  Menu / Tooltip.
- 3× `scroll` + `resize` event listener pairs (with capture + passive
  flags). Per-page rAF cascade on scroll is gone.
- The "top-left blip on first open" workaround in Combobox
  (`openPopover()` no longer needs to pre-position before
  `showPopover()` — anchor positioning does it).
- The per-component flip math (each component had its own
  almost-but-not-quite-the-same flip logic).

### Added

- 1× `_popover.ts` (~210 LOC including JSDoc + 12 typed placements
  + 4 typed width strategies + a feature-detect helper).
- 12 `_popover.test.ts` tests pinning the emitted CSS shape.

### What the browser now does for us

- Pins popovers to anchors on scroll + resize (no JS listener).
- Flips above when below would overflow viewport.
- Flips left when right would overflow viewport.
- Sizes the Combobox dropdown to match input width via
  `anchor-size()`.
- Handles RTL automatically via the `flip-inline` fallback (we use
  physical placement keywords for readability; the fallback chain
  covers writing-mode flips).

### Performance

- Zero per-scroll JS — the previous implementation re-ran
  `positionPopover()` on every scroll event (debounced with
  `passive: true` but still ~1ms per call). Anchor positioning is
  composited by the browser; effectively free.
- First-paint position is correct without pre-positioning ceremony.
  Old code had to set `top`/`left`/`width` BEFORE calling
  `showPopover()` to avoid the (0,0) browser-default-position
  one-frame flash. Anchor positioning handles this at the layout
  layer.

## Browser support

| Engine | Version | Date |
|---|---|---|
| Chrome / Edge | 125+ | May 2024 |
| Safari | 26.x | (current stable) |
| Firefox | 147+ | Jan 13 2026 |

Universal among latest engines as of January 2026. Per Can I Use
(snapshot 2026-05-17), ~76% global. The charter's "we target
evergreen browsers" stance covers everything that ships anchor
positioning.

### Fallback strategy

`supportsAnchorPositioning()` is provided for dev-mode feature
detection. We deliberately do NOT ship a JS fallback positioner;
old browsers (pre-2024) would see popovers in their default
position. This is consistent with how we treat other 2024-shipping
primitives (`@starting-style`, `<dialog>.showModal()`, popover API
itself).

## What's NOT in this cut

- **Sheet / Dialog don't migrate.** They use native `<dialog>` +
  `showModal()` which has its own viewport-centered positioning;
  anchor positioning doesn't apply.
- **Custom-CSS anchors for app code.** `nextAnchorName()` is
  internal; consumers can't address arbitrary elements. If a use
  case emerges, expose `anchorName` as a prop on Combobox/Menu so
  apps can target the trigger from external CSS.

## References

- [CSS Anchor Positioning — Can I Use](https://caniuse.com/css-anchor-positioning)
- [OddBird — Anchor positioning update Oct 2025](https://www.oddbird.net/2025/10/13/anchor-position-area-update/)
- [MDN — anchor-name](https://developer.mozilla.org/en-US/docs/Web/CSS/anchor-name)
- [MDN — position-anchor](https://developer.mozilla.org/en-US/docs/Web/CSS/position-anchor)
- [MDN — position-try-fallbacks](https://developer.mozilla.org/en-US/docs/Web/CSS/position-try-fallbacks)
- ADR 0026 — "magic with clarity" (lean on browser primitives).
- ADR 0046 — original Combobox + Sheet (the v0.1 JS positioner).
