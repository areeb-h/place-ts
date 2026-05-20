// `<Menu>` — popup with keyboard-navigable items.
//
// Native-first design:
//   - `popover="auto"` provides light-dismiss (click outside / Esc /
//     focus loss closes the menu), top-layer rendering, and one-popover-
//     at-a-time semantics. Universal browser support since mid-2024.
//   - Triggers wire to the menu declaratively via the browser's native
//     invoker attributes — the framework supports BOTH:
//       - `<Button popovertarget="…">` — universal popover invoker
//         since mid-2024.
//       - `<Button commandfor="…" command="toggle-popover">` — the
//         newer Invoker Commands API (Chrome 134+, Firefox 145+,
//         Oct 2025). Same effect with richer command semantics
//         (`show-popover`, `hide-popover`, `toggle-popover` and
//         dialog `show-modal`/`close` all without JS).
//   - The framework adds: keyboard navigation (arrow keys, Home/End),
//     item activation (Enter/Space), proper ARIA roles, anchor
//     positioning via CSS anchor-positioning (no JS positioner).
//
// Usage:
//
//   const MENU = 'actions-menu'
//   // Either of these triggers works; pick by browser baseline.
//   <Button popovertarget={MENU}>Actions</Button>
//   <Button commandfor={MENU} command="toggle-popover">Actions</Button>
//   <Menu id={MENU} items={[
//     { label: 'Edit', onSelect: edit },
//     { label: 'Delete', destructive: true, onSelect: del },
//   ]} />
//
// The `id` prop is what `popovertarget` / `commandfor` references. If
// omitted, the menu auto-generates one (apps can read it back via the
// `id` field on the rendered element, but for cleanest call sites,
// pass an explicit id).

import type { View } from '@place/component'
import { cls, onMount } from '@place/component'
import { state } from '@place/reactivity'
import { closePopover, nextAnchorName, popoverStyle } from './_popover.ts'

let _menuIdCounter = 0
const nextMenuId = (): string => `place-menu-${++_menuIdCounter}`

/**
 * Item shape for `<Menu items=...>`.
 *
 * **Kinds** (Tier 17-E v2):
 *   - `'item'` (default) — a regular selectable menuitem button.
 *   - `'separator'` — a horizontal divider. No label / no select.
 *     Rendered as `role="separator"`.
 *   - `'group'` — a non-interactive section header for grouping
 *     related items below it. Rendered as `role="presentation"`
 *     with the label as a small uppercase caption.
 */
export interface MenuItemBase {
  /** Display label (or section header for `'group'`). Required for
   *  `'item'` and `'group'`; ignored for `'separator'`. */
  readonly label?: string
  /** Discriminator for non-button kinds. Default: `'item'`. */
  readonly kind?: 'item' | 'separator' | 'group'
}

export interface MenuItem extends MenuItemBase {
  /** Click handler — only fires for `kind: 'item'` (default). */
  readonly onSelect?: () => void
  /** Disabled state — item is rendered but unselectable. */
  readonly disabled?: boolean
  /** Optional secondary text (right-aligned, e.g. shortcut). */
  readonly hint?: string
  /** Optional leading icon. */
  readonly icon?: View
  /**
   * Mark as destructive — applies a different skin. Use for "Delete",
   * "Sign out", etc.
   */
  readonly destructive?: boolean
}

export type MenuPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'

/**
 * Part anatomy for `<Menu>` (Tier 17-D / ADR 0050).
 *   - `item` — each individual `<button role="menuitem">`.
 * Root (the popover) uses the standalone `class` prop.
 */
export type MenuPart = 'item'

export interface MenuProps {
  /**
   * Menu's HTML id. Required for the trigger button to wire via
   * `popovertarget`. Auto-generated if omitted.
   */
  readonly id?: string
  /** The menu items. */
  readonly items: readonly MenuItem[]
  /** Placement relative to the trigger. Default: `'bottom-start'`. */
  readonly placement?: MenuPlacement
  /** Additive classes on the menu popover. */
  readonly class?: string
  /** Typed per-subpart class overrides (Tier 17-D / ADR 0050). */
  readonly classNames?: Partial<Record<MenuPart, string>>
  /** Accessible label for screen readers describing the menu. */
  readonly 'aria-label'?: string
}

export const Menu = (props: MenuProps): View => {
  const menuId = props.id ?? nextMenuId()
  const placement: MenuPlacement = props.placement ?? 'bottom-start'
  let menuEl: HTMLElement | null = null
  const isOpen = state(false)
  // Index of the visually-highlighted item (for keyboard nav). -1 = none.
  const activeIndex = state(-1)
  // Unique anchor name — applied to the trigger element on mount so
  // CSS anchor positioning can pin the menu without JS measuring.
  const anchorName = nextAnchorName()

  const onToggle = (e: Event): void => {
    // `toggle` event fires from the popover API on every open/close.
    const evt = e as Event & { newState?: 'open' | 'closed' }
    const next = evt.newState === 'open'
    isOpen.set(next)
    if (next) {
      // No JS positioning — CSS anchor positioning handles it. The
      // browser keeps the menu pinned to the trigger across scroll
      // + resize automatically.
      activeIndex.set(-1)
    }
  }

  // **Selectable = kind 'item' (default) AND not disabled.** Tier
  // 17-E v2 added `separator` / `group` kinds — neither receives
  // keyboard focus, so the nav helpers skip them along with the
  // disabled items.
  const isSelectable = (i: number): boolean => {
    const item = props.items[i]
    if (!item) return false
    if (item.kind === 'separator' || item.kind === 'group') return false
    return !item.disabled
  }
  const firstEnabledIndex = (): number => {
    for (let i = 0; i < props.items.length; i++) {
      if (isSelectable(i)) return i
    }
    return -1
  }
  const lastEnabledIndex = (): number => {
    for (let i = props.items.length - 1; i >= 0; i--) {
      if (isSelectable(i)) return i
    }
    return -1
  }
  const nextEnabled = (from: number, dir: 1 | -1): number => {
    const n = props.items.length
    if (n === 0) return -1
    let i = from
    for (let step = 0; step < n; step++) {
      i = (i + dir + n) % n
      if (isSelectable(i)) return i
    }
    return -1
  }

  const select = (i: number): void => {
    if (!isSelectable(i)) return
    const item = props.items[i]
    if (!item) return
    item.onSelect?.()
    closePopover(menuEl)
  }

  const onKey = (e: KeyboardEvent): void => {
    if (!isOpen()) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        activeIndex.set(activeIndex() < 0 ? firstEnabledIndex() : nextEnabled(activeIndex(), 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        activeIndex.set(activeIndex() < 0 ? lastEnabledIndex() : nextEnabled(activeIndex(), -1))
        break
      case 'Home':
        e.preventDefault()
        activeIndex.set(firstEnabledIndex())
        break
      case 'End':
        e.preventDefault()
        activeIndex.set(lastEnabledIndex())
        break
      case 'Enter':
      case ' ': {
        const i = activeIndex()
        if (i >= 0) {
          e.preventDefault()
          select(i)
        }
        break
      }
      // Esc is handled natively by popover="auto".
    }
  }

  onMount(() => {
    if (typeof document === 'undefined') return
    // Find the trigger element. Two declarative shapes are supported
    // (both ship in browser baselines we target):
    //   - `popovertarget="<menuId>"` — universal popover invoker.
    //   - `commandfor="<menuId>"` (any command) — Invoker Commands
    //     API (Chrome 134+, Firefox 145+).
    // The OR selector matches whichever the consumer chose; no JS
    // toggle wiring beyond the anchor-name plumbing.
    const trigger = document.querySelector(
      `[popovertarget="${menuId}"], [commandfor="${menuId}"]`,
    ) as HTMLElement | null
    if (trigger) {
      trigger.style.setProperty('anchor-name', `--${anchorName}`)
    }
    return () => {
      // Clean up on dispose (e.g. SPA-nav swap removed this Menu
      // but the trigger lives on in a layout). Removing the anchor
      // name avoids orphan anchor references for the new mount.
      if (trigger) trigger.style.removeProperty('anchor-name')
    }
  })

  // `min-w-[10rem]` + `max-h-[60vh]` are menu-specific layout
  // constraints (popover must be readable but not overflow the
  // viewport) — allowed per NN#6 clarification, Tier 15-D.
  // Positioning lives in the inline `style` (CSS anchor positioning
  // via `popoverStyle()`); the class only carries chrome.
  const menuClass = cls(
    'p-1 rounded-lg bg-card border border-border shadow-2xl shadow-bg/40',
    'min-w-[10rem] max-h-[60vh] overflow-y-auto',
    '[&]:bg-card',
    props.class ?? '',
  )

  const menuPositionStyle = popoverStyle({
    anchor: anchorName,
    placement,
    offset: 4,
  })

  return (
    <div
      id={menuId}
      role="menu"
      popover="auto"
      aria-label={props['aria-label']}
      class={menuClass}
      style={menuPositionStyle}
      onToggle={onToggle as unknown as (e: Event) => void}
      onKeyDown={onKey as unknown as (e: Event) => void}
      ref={(el: HTMLElement) => {
        menuEl = el
      }}
    >
      {props.items.map((item, i) => {
        // **Separator** — native <hr> has implicit role="separator";
        // no need for the ARIA-prop overrides.
        if (item.kind === 'separator') {
          return <hr class="my-1 h-px bg-border/60 border-0" />
        }
        // **Group** — non-interactive section header. Small caps
        // styling; readable as a labelling cue without keyboard
        // focus.
        if (item.kind === 'group') {
          return (
            <div
              role="presentation"
              class="px-2.5 pt-2 pb-1 text-xs font-medium text-muted uppercase tracking-wide"
            >
              {item.label}
            </div>
          )
        }
        // **Item** (default) — selectable menuitem button.
        return (
          <button
            type="button"
            role="menuitem"
            class={() =>
              cls(
                'w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded text-sm text-left',
                'transition-colors duration-150 cursor-pointer',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                item.destructive ? 'text-destructive' : 'text-fg',
                activeIndex() === i
                  ? item.destructive
                    ? 'bg-destructive/10'
                    : 'bg-accent/12'
                  : 'hover:bg-fg/5',
                props.classNames?.item ?? '',
              )
            }
            disabled={item.disabled === true || undefined}
            onMouseEnter={() => activeIndex.set(i)}
            onClick={() => select(i)}
          >
            {item.icon ? <span class="shrink-0 inline-flex items-center">{item.icon}</span> : null}
            <span class="flex-1">{item.label}</span>
            {item.hint ? <span class="text-xs font-mono text-muted">{item.hint}</span> : null}
          </button>
        )
      })}
    </div>
  )
}
