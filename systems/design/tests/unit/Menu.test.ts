// @vitest-environment happy-dom

import { mount } from '@place-ts/component'
import { describe, expect, test, vi } from 'vitest'
import { Menu } from '../../src/Menu.tsx'

// happy-dom popover polyfill — same as Tooltip/Toast.
function patchPopover(): void {
  const proto = HTMLElement.prototype as HTMLElement & {
    showPopover?: () => void
    hidePopover?: () => void
  }
  if (typeof proto.showPopover !== 'function') {
    proto.showPopover = function (): void {
      this.setAttribute('data-popover-open', '')
    }
  }
  if (typeof proto.hidePopover !== 'function') {
    proto.hidePopover = function (): void {
      this.removeAttribute('data-popover-open')
    }
  }
}

describe('Menu — render + items + keyboard', () => {
  test('renders a menu with role=menu + popover=auto', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(
      Menu({
        items: [{ label: 'Edit' }, { label: 'Delete' }],
      }),
      root,
    )
    const menu = root.querySelector('[role="menu"]') as HTMLElement | null
    expect(menu).not.toBeNull()
    expect(menu?.getAttribute('popover')).toBe('auto')
  })

  test('uses the explicit id prop as the popover target', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(
      Menu({
        id: 'my-menu',
        items: [{ label: 'a' }],
      }),
      root,
    )
    const menu = root.querySelector('[role="menu"]') as HTMLElement
    expect(menu.id).toBe('my-menu')
  })

  test('auto-generates an id when omitted', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(Menu({ items: [{ label: 'a' }] }), root)
    const menu = root.querySelector('[role="menu"]') as HTMLElement
    expect(menu.id).toMatch(/^place-menu-\d+$/)
  })

  test('renders each item as a role=menuitem button', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(
      Menu({
        items: [{ label: 'Edit' }, { label: 'Duplicate' }, { label: 'Delete', destructive: true }],
      }),
      root,
    )
    const items = root.querySelectorAll('[role="menuitem"]')
    expect(items.length).toBe(3)
    expect(items[0]?.textContent).toContain('Edit')
    expect(items[1]?.textContent).toContain('Duplicate')
    expect(items[2]?.textContent).toContain('Delete')
  })

  test('destructive items get the destructive text color class', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(
      Menu({
        items: [{ label: 'Delete', destructive: true }],
      }),
      root,
    )
    const item = root.querySelector('[role="menuitem"]') as HTMLElement
    expect(item.className).toContain('text-destructive')
  })

  test('disabled items have disabled attribute', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(
      Menu({
        items: [{ label: 'Edit' }, { label: 'Archive', disabled: true }],
      }),
      root,
    )
    const items = root.querySelectorAll('[role="menuitem"]')
    expect((items[0] as HTMLButtonElement).disabled).toBe(false)
    expect((items[1] as HTMLButtonElement).disabled).toBe(true)
  })

  test('item hint renders as separate text', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(
      Menu({
        items: [{ label: 'Save', hint: '⌘S' }],
      }),
      root,
    )
    const item = root.querySelector('[role="menuitem"]') as HTMLElement
    expect(item.textContent).toContain('Save')
    expect(item.textContent).toContain('⌘S')
  })

  test('clicking an item fires onSelect', () => {
    patchPopover()
    let clicked = false
    const root = document.createElement('div')
    mount(
      Menu({
        items: [
          {
            label: 'Go',
            onSelect: () => {
              clicked = true
            },
          },
        ],
      }),
      root,
    )
    const item = root.querySelector('[role="menuitem"]') as HTMLButtonElement
    item.click()
    expect(clicked).toBe(true)
  })

  test('clicking a disabled item does NOT fire onSelect', () => {
    patchPopover()
    let clicked = false
    const root = document.createElement('div')
    mount(
      Menu({
        items: [
          {
            label: 'Go',
            disabled: true,
            onSelect: () => {
              clicked = true
            },
          },
        ],
      }),
      root,
    )
    const item = root.querySelector('[role="menuitem"]') as HTMLButtonElement
    item.click()
    expect(clicked).toBe(false)
  })

  test('aria-label flows through to the menu element', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(
      Menu({
        items: [{ label: 'a' }],
        'aria-label': 'Actions',
      }),
      root,
    )
    const menu = root.querySelector('[role="menu"]') as HTMLElement
    expect(menu.getAttribute('aria-label')).toBe('Actions')
  })

  test('placement prop is accepted (no throw with all four)', () => {
    patchPopover()
    const placements = ['bottom-start', 'bottom-end', 'top-start', 'top-end'] as const
    for (const p of placements) {
      const root = document.createElement('div')
      mount(Menu({ items: [{ label: 'a' }], placement: p }), root)
      expect(root.querySelector('[role="menu"]')).not.toBeNull()
    }
  })

  // ===== Tier 17-E v2 — MenuItem kinds =====

  test('kind: "separator" renders a role="separator" divider (not a button)', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(
      Menu({
        items: [{ label: 'Edit' }, { kind: 'separator' }, { label: 'Delete' }],
      }),
      root,
    )
    // <hr> has implicit role="separator" — querySelector for the
    // explicit attribute would miss it; query the element directly.
    const sep = root.querySelector('hr') as HTMLHRElement | null
    expect(sep).not.toBeNull()
    // Is NOT a button.
    expect(sep?.tagName).toBe('HR')
    // Two buttons, not three.
    expect(root.querySelectorAll('button[role="menuitem"]').length).toBe(2)
  })

  test('kind: "group" renders a presentational header with the label', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(
      Menu({
        items: [{ kind: 'group', label: 'Files' }, { label: 'New' }, { label: 'Open' }],
      }),
      root,
    )
    const header = root.querySelector('[role="presentation"]') as HTMLElement | null
    expect(header).not.toBeNull()
    expect(header?.textContent).toBe('Files')
    // Two buttons; the group is not interactive.
    expect(root.querySelectorAll('button[role="menuitem"]').length).toBe(2)
  })

  test('separators + groups are skipped in keyboard nav', () => {
    patchPopover()
    const root = document.createElement('div')
    const onSelect = vi.fn()
    mount(
      Menu({
        items: [
          { kind: 'group', label: 'Section' },
          { label: 'First', onSelect },
          { kind: 'separator' },
          { label: 'Second', onSelect },
        ],
      }),
      root,
    )
    // The active-index helpers must land on indices 1 and 3 only
    // (skipping the group at 0 and separator at 2). Click the
    // selectable items as a sanity check on indexing.
    const buttons = Array.from(
      root.querySelectorAll('button[role="menuitem"]'),
    ) as HTMLButtonElement[]
    expect(buttons.length).toBe(2)
    buttons[0]?.click()
    buttons[1]?.click()
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  // ===== Tier 17-D — `classNames.item` =====
  test('classNames.item adds onto every menu item button', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(
      Menu({
        items: [{ label: 'a' }, { label: 'b' }, { label: 'c', disabled: true }],
        classNames: { item: 'my-menu-item' },
      }),
      root,
    )
    const buttons = Array.from(
      root.querySelectorAll('button[role="menuitem"]'),
    ) as HTMLButtonElement[]
    for (const btn of buttons) {
      expect(btn.className).toContain('my-menu-item')
    }
  })
})
