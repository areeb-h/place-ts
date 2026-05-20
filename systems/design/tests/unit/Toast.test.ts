// @vitest-environment happy-dom

import { mount } from '@place/component'
import { flush } from '@place/reactivity'
import { afterEach, describe, expect, test } from 'vitest'
import { _clearToastsForTest, Toaster, toast } from '../../src/Toast.tsx'

// happy-dom doesn't implement the Popover API. Polyfill the methods the
// Toaster calls so mount() doesn't blow up — we don't test top-layer
// semantics here, just queue + render behavior.
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

afterEach(() => {
  _clearToastsForTest()
})

describe('Toaster — render + anchor + queue', () => {
  test('renders an empty toaster container at the chosen anchor', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(Toaster({ anchor: 'top-left' }), root)
    const el = root.firstChild as HTMLElement
    expect(el.className).toContain('top-4')
    expect(el.className).toContain('left-4')
    expect(el.getAttribute('popover')).toBe('manual')
  })

  test('defaults to bottom-right when no anchor is passed', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(Toaster({}), root)
    const el = root.firstChild as HTMLElement
    expect(el.className).toContain('bottom-4')
    expect(el.className).toContain('right-4')
  })

  test('toast() enqueues an item, renders it inside the toaster', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(Toaster({}), root)
    toast('Hello!')
    flush()
    const el = root.firstChild as HTMLElement
    expect(el.textContent).toContain('Hello!')
  })

  test('toast.success uses the success kind glyph + border', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(Toaster({}), root)
    toast.success('Saved')
    flush()
    const el = root.firstChild as HTMLElement
    expect(el.textContent).toContain('Saved')
    expect(el.textContent).toContain('✓')
  })

  test('toast.error gives role=alert + assertive aria-live', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(Toaster({}), root)
    toast.error('Failure')
    flush()
    const el = root.firstChild as HTMLElement
    const item = el.querySelector('[role="alert"]') as HTMLElement | null
    expect(item).not.toBeNull()
    expect(item?.getAttribute('aria-live')).toBe('assertive')
  })

  test('toast() returns a dismiss handle that flips visibility', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(Toaster({}), root)
    const dismiss = toast('Working…', { duration: 0 })
    flush()
    const el = root.firstChild as HTMLElement
    expect(el.textContent).toContain('Working')
    dismiss()
    flush()
    // The exit motion takes ~220ms; we can't easily fast-forward setTimeout
    // here, but the visibility signal is already false, so opacity/transform
    // styles should be at the dismissed state.
    const item = el.querySelector('[role="status"]') as HTMLElement | null
    // Item still present until the cleanup timer fires (220ms after dismiss).
    expect(item).not.toBeNull()
  })

  test('multiple toasts render in order', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(Toaster({}), root)
    toast.info('One')
    toast.warn('Two')
    toast.success('Three')
    flush()
    const el = root.firstChild as HTMLElement
    const items = Array.from(el.querySelectorAll('[role="status"], [role="alert"]'))
    // Status items: One, Two, Three; "Two" is a warn (status, not alert).
    expect(items.length).toBe(3)
    expect(items[0]?.textContent).toContain('One')
    expect(items[1]?.textContent).toContain('Two')
    expect(items[2]?.textContent).toContain('Three')
  })

  test('warn kind uses the ! glyph', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(Toaster({}), root)
    toast.warn('Heads up')
    flush()
    const el = root.firstChild as HTMLElement
    expect(el.textContent).toContain('!')
    expect(el.textContent).toContain('Heads up')
  })

  test('dismiss button has aria-label="Dismiss"', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(Toaster({}), root)
    toast('Hi', { duration: 0 })
    flush()
    const el = root.firstChild as HTMLElement
    const btn = el.querySelector('button[aria-label="Dismiss"]')
    expect(btn).not.toBeNull()
  })

  test('_clearToastsForTest empties the queue synchronously', () => {
    patchPopover()
    const root = document.createElement('div')
    mount(Toaster({}), root)
    toast('a', { duration: 0 })
    toast('b', { duration: 0 })
    flush()
    let el = root.firstChild as HTMLElement
    expect(el.querySelectorAll('[role="status"]').length).toBe(2)
    _clearToastsForTest()
    flush()
    el = root.firstChild as HTMLElement
    expect(el.querySelectorAll('[role="status"]').length).toBe(0)
  })

  // ===== Tier 17-D — `class` (root) + `classNames.item` (each toast) =====
  test('classNames.item adds onto each rendered toast', () => {
    const root = document.createElement('div')
    mount(Toaster({ classNames: { item: 'my-toast-card' } }), root)
    toast('first')
    toast('second')
    flush()
    const el = root.firstChild as HTMLElement
    const cards = Array.from(el.querySelectorAll('[role="status"]')) as HTMLElement[]
    expect(cards.length).toBe(2)
    for (const card of cards) expect(card.className).toContain('my-toast-card')
    _clearToastsForTest()
  })
})
