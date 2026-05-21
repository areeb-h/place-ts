// @vitest-environment happy-dom

import { mount } from '@place-ts/component'
import { describe, expect, test } from 'vitest'
import { Tooltip } from '../../src/Tooltip.tsx'

// happy-dom doesn't implement Popover API. Polyfill the methods so
// open/close don't crash. We don't test top-layer placement — only the
// wiring + a11y.
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

describe('Tooltip — render + a11y wiring', () => {
  test('renders the bubble with role=tooltip + popover=manual', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(
      Tooltip({
        content: 'Help text',
        children: 'Trigger',
      }),
      root,
    )
    const bubble = root.querySelector('[role="tooltip"]') as HTMLElement | null
    expect(bubble).not.toBeNull()
    expect(bubble?.getAttribute('popover')).toBe('manual')
    expect(bubble?.textContent).toBe('Help text')
  })

  test('wraps trigger with aria-describedby matching the bubble id', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(
      Tooltip({
        content: 'Help',
        children: 'Trigger',
      }),
      root,
    )
    const bubble = root.querySelector('[role="tooltip"]') as HTMLElement
    const wrapper = root.querySelector('span.contents') as HTMLElement
    expect(wrapper).not.toBeNull()
    expect(bubble.id).toMatch(/^place-tooltip-\d+$/)
    expect(wrapper.getAttribute('aria-describedby')).toBe(bubble.id)
  })

  test('bubble text reflects the content prop verbatim', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(
      Tooltip({
        content: 'Exact words',
        children: 'x',
      }),
      root,
    )
    const bubble = root.querySelector('[role="tooltip"]') as HTMLElement
    expect(bubble.textContent).toBe('Exact words')
  })

  test('different tooltip instances get unique ids', () => {
    patchPopover()
    const root1 = document.createElement('div')
    const root2 = document.createElement('div')
    mount(Tooltip({ content: 'a', children: 'x' }), root1)
    mount(Tooltip({ content: 'b', children: 'y' }), root2)
    const id1 = root1.querySelector('[role="tooltip"]')?.id
    const id2 = root2.querySelector('[role="tooltip"]')?.id
    expect(id1).toBeTruthy()
    expect(id2).toBeTruthy()
    expect(id1).not.toBe(id2)
  })

  test('mouseenter/mouseleave fire without throwing', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(Tooltip({ content: 'Help', children: 'Trigger' }), root)
    const wrapper = root.querySelector('span.contents') as HTMLElement
    // Dispatch events; the open/close handlers set timers — we just verify
    // no throw and the bubble exists.
    wrapper.dispatchEvent(new MouseEvent('mouseenter'))
    wrapper.dispatchEvent(new MouseEvent('mouseleave'))
    expect(root.querySelector('[role="tooltip"]')).not.toBeNull()
  })
})
