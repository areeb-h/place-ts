// `<Tooltip>` — hover/focus-triggered help text anchored to a trigger.
//
// Native-first design:
//   - `popover="manual"` puts the bubble in the browser's top layer —
//     escapes `overflow:hidden` / `transform` / z-index parents that
//     break every framework's tooltip positioning. Universal browser
//     support since mid-2024.
//   - The framework adds: hover + focus listeners with a 250ms delay
//     (matches the OS-native tooltip cadence), keyboard accessibility
//     (focus shows the tooltip + Esc hides it), and a tiny positioner
//     that places the bubble adjacent to its trigger using
//     `getBoundingClientRect()`. Anchor-positioning CSS (FF, Safari
//     in progress) would replace the positioner — drop-in when it's
//     universal.
//   - The trigger is a child slot — `<Tooltip content="…">` wraps any
//     element. The wrapper attaches `aria-describedby` so screen
//     readers announce the tooltip content.
//
// **Popover stack** (Tier 17-E v2): we use `popover="hint"` where
// supported (Chrome 133+, Jan 2025) — hint popovers live on a
// separate stack from `auto`, so opening a tooltip while a menu is
// open does not light-dismiss the menu. Browsers without `hint`
// fall back to `popover="manual"` (we own dismiss via the trigger's
// onMouseLeave/onFocusOut handlers). Feature-detect happens once at
// module load — see `POPOVER_KIND` below.

import { cls, onMount } from '@place/component'
import type { Children, View } from '@place/component'
import { state } from '@place/reactivity'
import {
  closePopover,
  nextAnchorName,
  openPopover,
  popoverStyle,
} from './_popover.ts'

// **`popover="hint"` feature detect** (Tier 17-E v2 fix). The hint
// stack (Chrome 133+ / Jan 2025) is the popover spec's answer to
// "tooltips shouldn't close menus" — hint popovers exist on a
// SEPARATE stack from `auto` popovers, so opening a tooltip while
// a menu is open does not light-dismiss the menu. Browsers that
// don't support `hint` default to `auto` for unknown values
// (per HTML spec) — which is WRONG for us (we want manual dismiss
// behaviour on the fallback). We feature-detect once at module
// load + pick the right attribute value.
//
// happy-dom doesn't implement the popover IDL — the detect returns
// false there, so tests exercise the `manual` fallback path.
const POPOVER_KIND: 'hint' | 'manual' = (() => {
  if (typeof document === 'undefined' || typeof HTMLElement === 'undefined') {
    return 'manual'
  }
  try {
    const el = document.createElement('div')
    el.setAttribute('popover', 'hint')
    // The `popover` IDL attribute reflects the set value if the value
    // is valid; otherwise it defaults to 'auto'. So if reading back
    // gives us 'hint', the browser knows the value.
    const reflected = (el as HTMLElement & { popover?: string }).popover
    return reflected === 'hint' ? 'hint' : 'manual'
  } catch {
    return 'manual'
  }
})()

let _tooltipIdCounter = 0
const nextTooltipId = (): string => `place-tooltip-${++_tooltipIdCounter}`

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right'

export interface TooltipProps {
  /** The text shown in the tooltip bubble. */
  readonly content: string
  /** Side of the trigger the bubble sits on. Default: `'top'`. */
  readonly placement?: TooltipPlacement
  /** Show/hide delay in ms. Default: `250`. */
  readonly delay?: number
  /**
   * Trigger element(s). The wrapper passes hover/focus listeners +
   * `aria-describedby` to a single root element. If you pass multiple
   * children, the listeners attach to a wrapping `<span class="contents">`.
   */
  readonly children: Children
}

/**
 * Render a tooltip anchored to its child trigger. The tooltip shows on
 * hover or focus, hides on blur/mouseleave/Esc. Content lives in the
 * browser's top layer (no z-index hell, no portal).
 */
export const Tooltip = (props: TooltipProps): View => {
  const tooltipId = nextTooltipId()
  const delay = props.delay ?? 250
  const placement: TooltipPlacement = props.placement ?? 'top'
  // Anchor name applied to the trigger wrapper at mount time.
  const anchorName = nextAnchorName()

  // Refs.
  let bubbleEl: HTMLElement | null = null
  let triggerWrapEl: HTMLElement | null = null

  const isOpen = state(false)
  let showTimer: ReturnType<typeof setTimeout> | null = null
  let hideTimer: ReturnType<typeof setTimeout> | null = null

  const clearTimers = (): void => {
    if (showTimer) {
      clearTimeout(showTimer)
      showTimer = null
    }
    if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  const open = (): void => {
    clearTimers()
    showTimer = setTimeout(() => {
      isOpen.set(true)
      // No JS positioning — CSS anchor positioning pins the bubble
      // to the trigger element. See `_popover.ts` and ADR 0048.
      openPopover(bubbleEl)
    }, delay)
  }

  const close = (): void => {
    clearTimers()
    hideTimer = setTimeout(() => {
      isOpen.set(false)
      closePopover(bubbleEl)
    }, 80)
  }

  // Esc closes when focused.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && isOpen()) close()
  }

  // Pre-compute the bubble's positioning style — anchor + placement
  // are static for the Tooltip's lifetime. The browser pins the
  // bubble to the trigger via `position-anchor: --<name>`.
  const bubblePositionStyle = popoverStyle({
    anchor: anchorName,
    placement,
    offset: 8,
  })

  onMount(() => {
    // Apply the anchor name to the trigger wrapper as soon as it's
    // mounted. Removed on dispose (SPA-nav cleanup, etc.).
    if (triggerWrapEl) {
      triggerWrapEl.style.setProperty('anchor-name', `--${anchorName}`)
    }
    return () => {
      if (triggerWrapEl) triggerWrapEl.style.removeProperty('anchor-name')
      clearTimers()
    }
  })

  return (
    <>
      <span
        class="contents"
        ref={(el: HTMLElement) => {
          triggerWrapEl = el
        }}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocusIn={open}
        onFocusOut={close}
        onKeyDown={onKey as unknown as (e: Event) => void}
        aria-describedby={tooltipId}
      >
        {props.children}
      </span>
      <div
        id={tooltipId}
        role="tooltip"
        popover={POPOVER_KIND}
        class={cls(
          'px-2 py-1 rounded-md',
          'text-xs leading-tight text-fg bg-card border border-border shadow-lg',
          // **Mouse-into-bubble keeps it open** (Tier 17-E). Previously
          // `pointer-events-none` made the bubble itself invisible to
          // hover, so the user moving their cursor onto the bubble (e.g.
          // to read a long tooltip in detail) would actually be hovering
          // the page behind it — `onMouseLeave` on the trigger fired,
          // closing the tooltip mid-read. With pointer-events on, the
          // bubble's own `onMouseEnter`/`onMouseLeave` keep it alive
          // while the cursor's over it. `select-none max-w-xs` retained.
          'select-none max-w-xs',
          '[&]:bg-card',
        )}
        style={bubblePositionStyle}
        onMouseEnter={open}
        onMouseLeave={close}
        ref={(el: HTMLElement) => {
          bubbleEl = el
        }}
      >
        {props.content}
      </div>
    </>
  )
}
