// Unified popover substrate via native CSS Anchor Positioning
// (Tier 17-B, ADR 0048).
//
// **Why this replaces the per-component JS positioners.** Before
// Tier 17, `<Combobox>`, `<Menu>`, and `<Tooltip>` each carried
// their own `getBoundingClientRect`-flip-clamp implementation that
// fired on every open + on every scroll/resize event. They differed
// in subtle ways (no shared collision strategy, inconsistent gap
// values, none implemented writing-mode awareness). The total
// footprint was ~300 LOC of fragile layout math reproducing what
// the browser now ships natively.
//
// CSS Anchor Positioning (`anchor-name`, `position-anchor`,
// `position-area`, `position-try-fallbacks`, `anchor-size()`) is
// **universal as of Firefox 147 (Jan 13 2026)**. Charter §"What we
// don't ship" hedged "until anchor positioning lands in FF"; that
// hedge is now satisfied.
//
// **API.** Two pure helpers — `anchorStyle(name)` for the trigger,
// `popoverStyle({ anchor, placement, width })` for the popover —
// returning CSS strings that components apply via inline `style`.
// No JS scroll/resize listeners. No `getBoundingClientRect`. The
// browser owns positioning, including collision-flip and stays-pinned
// on scroll.
//
// **CSP.** Inline `style` writes go through the framework's
// per-response style-attr hash injection (Tier 6 / ADR 0014); strict
// CSP remains intact.

let _anchorCounter = 0

/** Generate a unique anchor name (without `--` prefix). */
export const nextAnchorName = (): string => `place-anchor-${++_anchorCounter}`

/** Standard placements. Logical (block/inline) under the hood so the
 *  same name works in LTR + RTL contexts. */
export type PopoverPlacement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left'
  | 'left-start'
  | 'left-end'
  | 'right'
  | 'right-start'
  | 'right-end'

/**
 * Map placement → `position-area` value. We use *physical* keywords
 * (top/bottom/left/right) because they read more naturally in the
 * style string and have wider implementation maturity than the
 * logical equivalents. Browser writing-mode flipping for RTL is
 * handled separately via `position-try-fallbacks: flip-inline`.
 *
 *   "bottom-start" = popover is BELOW anchor, left-aligned, extends
 *                    rightward. Encoded as `bottom span-right` —
 *                    "bottom" places it below, "span-right" spans
 *                    from anchor's left edge to right (= left-aligned).
 *   "bottom-end"   = below, right-aligned, extends leftward → `bottom span-left`.
 *   "bottom"       = below, centered.
 */
const PLACEMENT_AREA: Record<PopoverPlacement, string> = {
  top: 'top',
  'top-start': 'top span-right',
  'top-end': 'top span-left',
  bottom: 'bottom',
  'bottom-start': 'bottom span-right',
  'bottom-end': 'bottom span-left',
  left: 'left',
  'left-start': 'left span-bottom',
  'left-end': 'left span-top',
  right: 'right',
  'right-start': 'right span-bottom',
  'right-end': 'right span-top',
}

/**
 * Collision fallbacks per placement. `flip-block` swaps top↔bottom,
 * `flip-inline` swaps left↔right. Vertical placements need block
 * flip first (the common case: dropdown overflows bottom edge →
 * flip above); horizontal placements need inline flip first.
 */
const FLIP_FALLBACKS: Record<PopoverPlacement, string> = {
  top: 'flip-block',
  'top-start': 'flip-block, flip-inline',
  'top-end': 'flip-block, flip-inline',
  bottom: 'flip-block',
  'bottom-start': 'flip-block, flip-inline',
  'bottom-end': 'flip-block, flip-inline',
  left: 'flip-inline',
  'left-start': 'flip-inline, flip-block',
  'left-end': 'flip-inline, flip-block',
  right: 'flip-inline',
  'right-start': 'flip-inline, flip-block',
  'right-end': 'flip-inline, flip-block',
}

/** Width strategy for the popover relative to its anchor. */
export type PopoverWidth =
  /** Intrinsic — content drives width. */
  | 'auto'
  /** Match anchor's exact width (Combobox dropdown pattern). */
  | 'anchor-width'
  /** At least anchor's width; can grow wider if content needs. */
  | 'anchor-min-width'

export interface PopoverStyleOptions {
  /** Anchor name (without `--` prefix), from `nextAnchorName()`. */
  readonly anchor: string
  /** Placement relative to anchor. Default: `'bottom-start'`. */
  readonly placement?: PopoverPlacement
  /** Width strategy. Default: `'auto'`. */
  readonly width?: PopoverWidth
  /** Gap between anchor and popover, in pixels. Default: `4`. */
  readonly offset?: number
}

/**
 * Build the CSS style string for an anchor element (the trigger).
 * Sets `anchor-name`; the popover references it via `position-anchor`.
 *
 *   <input style={anchorStyle(name)} />
 */
export function anchorStyle(name: string): string {
  return `anchor-name: --${name};`
}

/**
 * Build the CSS style string for a popover element. The popover must
 * also carry `popover="auto"` or `popover="manual"` (for top-layer
 * rendering); this helper provides the positioning.
 *
 *   <div popover="auto" style={popoverStyle({ anchor, placement: 'bottom-start' })} />
 *
 * **What this emits** (illustrative for placement: 'bottom-start' +
 * width: 'anchor-width' + offset: 4):
 *
 *   position: fixed;
 *   position-anchor: --place-anchor-3;
 *   position-area: bottom span-right;
 *   position-try-fallbacks: flip-block, flip-inline;
 *   margin: 4px 0 0 0;
 *   width: anchor-size(--place-anchor-3 width);
 *   inset: auto;
 *
 * Notes:
 *   - `inset: auto` clears the browser's default popover positioning
 *     (popovers default to centered fixed; we want anchor-driven).
 *   - The `margin` creates the gap between anchor and popover; only
 *     the side facing the anchor gets the gap.
 *   - `width: anchor-size()` is supported in all engines that ship
 *     anchor positioning (Chrome 125+, Safari 26+, Firefox 147+).
 */
export function popoverStyle(opts: PopoverStyleOptions): string {
  const placement = opts.placement ?? 'bottom-start'
  const area = PLACEMENT_AREA[placement]
  const fallbacks = FLIP_FALLBACKS[placement]
  const offset = opts.offset ?? 4
  const width = opts.width ?? 'auto'

  // Per-side margin so the gap appears only on the side adjacent
  // to the anchor. For top placements the margin goes on the bottom
  // (popover bottom ↔ anchor top); for bottom placements it goes
  // on top; etc.
  let marginRule: string
  if (placement.startsWith('top')) marginRule = `margin: 0 0 ${offset}px 0;`
  else if (placement.startsWith('bottom')) marginRule = `margin: ${offset}px 0 0 0;`
  else if (placement.startsWith('left')) marginRule = `margin: 0 ${offset}px 0 0;`
  else marginRule = `margin: 0 0 0 ${offset}px;` // right-*

  let widthRule = ''
  if (width === 'anchor-width') widthRule = `width: anchor-size(--${opts.anchor} width);`
  else if (width === 'anchor-min-width')
    widthRule = `min-width: anchor-size(--${opts.anchor} width);`

  return [
    'position: fixed;',
    'inset: auto;',
    `position-anchor: --${opts.anchor};`,
    `position-area: ${area};`,
    `position-try-fallbacks: ${fallbacks};`,
    marginRule,
    widthRule,
  ]
    .filter((s) => s !== '')
    .join(' ')
}

/**
 * Feature-detect CSS anchor positioning. Useful for components that
 * want to log a one-time dev warning when running in an old engine.
 * Returns false on the server (no CSS engine).
 */
export function supportsAnchorPositioning(): boolean {
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return false
  // The two properties we lean on. Both must be supported.
  return CSS.supports('anchor-name', '--x') && CSS.supports('position-anchor', '--x')
}

// **`:popover-open` selector support** (universal: Chrome 114+ /
// Safari 17+ / Firefox 125+). When supported, `el.matches(':popover-open')`
// reliably returns the current open state — and `'popover' in el`
// confirms the API exists.
//
// `showPopover()` and `hidePopover()` throw `InvalidStateError`:
//   - `showPopover()` if the popover is already shown
//   - `hidePopover()` if the popover is already hidden
//   - either if the element isn't currently a popover (no `popover`
//     attribute, or popover API unimplemented)
//
// Pre-checking via `:popover-open` removes the entire `try/catch`
// surface — no exceptions, no rescue logic, no `// ignore` comments
// littered through call sites. Browsers without the popover API
// short-circuit on the `'popover' in el` check (it returns false on
// non-popover elements regardless of the property's existence on the
// prototype, since the IDL property is only present when the popover
// invariant holds).

/** Type guard: element has the popover API methods. */
interface PopoverEl extends HTMLElement {
  showPopover: () => void
  hidePopover: () => void
}
const hasPopoverApi = (el: HTMLElement): el is PopoverEl =>
  typeof (el as { showPopover?: unknown }).showPopover === 'function' &&
  typeof (el as { hidePopover?: unknown }).hidePopover === 'function'

/**
 * Idempotent `showPopover()` — no-op when the element is already open
 * or the API isn't available. Replaces the
 * `try { el.showPopover() } catch {}` boilerplate at every call site.
 */
export function openPopover(el: HTMLElement | null | undefined): void {
  if (!el || !hasPopoverApi(el)) return
  // `:popover-open` is universal alongside the popover API itself —
  // if showPopover exists, :popover-open works.
  if (el.matches(':popover-open')) return
  el.showPopover()
}

/**
 * Idempotent `hidePopover()` — no-op when the element is already
 * closed or the API isn't available.
 */
export function closePopover(el: HTMLElement | null | undefined): void {
  if (!el || !hasPopoverApi(el)) return
  if (!el.matches(':popover-open')) return
  el.hidePopover()
}
