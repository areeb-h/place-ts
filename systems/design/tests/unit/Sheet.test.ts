// @vitest-environment happy-dom

import { mount } from '@place/component'
import { state } from '@place/reactivity'
import { describe, expect, test, vi } from 'vitest'
import { Sheet } from '../../src/Sheet.tsx'

// happy-dom doesn't reliably implement <dialog>.showModal() — same
// shim Dialog's tests use.
function patchDialog(): void {
  const proto = (window as unknown as { HTMLDialogElement: { prototype: HTMLDialogElement } })
    .HTMLDialogElement?.prototype
  if (!proto) return
  if (typeof proto.showModal !== 'function') {
    proto.showModal = function (this: HTMLDialogElement): void {
      this.setAttribute('open', '')
      ;(this as unknown as { open: boolean }).open = true
    }
  }
  if (typeof proto.close !== 'function') {
    proto.close = function (this: HTMLDialogElement): void {
      this.removeAttribute('open')
      ;(this as unknown as { open: boolean }).open = false
      this.dispatchEvent(new Event('close'))
    }
  }
}

describe('Sheet — edge-anchored drawer', () => {
  test('renders a <dialog> element', () => {
    patchDialog()
    const open = state(false)
    const root = document.createElement('div')
    mount(Sheet({ open: () => open(), 'aria-label': 'Filters', children: 'body' }), root)
    expect(root.querySelector('dialog')).not.toBeNull()
  })

  test('default side="right" adds right-edge anchor classes', () => {
    patchDialog()
    const open = state(false)
    const root = document.createElement('div')
    mount(Sheet({ open: () => open(), 'aria-label': 'x', children: 'body' }), root)
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    // Right-edge anchor: m-0 ml-auto h-full + rounded-l-xl.
    expect(dialog.className).toContain('ml-auto')
    expect(dialog.className).toContain('rounded-l-xl')
  })

  test('side="left" flips to left-edge anchor', () => {
    patchDialog()
    const open = state(false)
    const root = document.createElement('div')
    mount(Sheet({ open: () => open(), side: 'left', 'aria-label': 'x', children: 'body' }), root)
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    expect(dialog.className).toContain('mr-auto')
    expect(dialog.className).toContain('rounded-r-xl')
  })

  test('side="top" and "bottom" anchor horizontally', () => {
    patchDialog()
    const open = state(false)
    const root = document.createElement('div')
    mount(Sheet({ open: () => open(), side: 'top', 'aria-label': 'x', children: 'body' }), root)
    const top = root.querySelector('dialog') as HTMLDialogElement
    expect(top.className).toContain('mb-auto')
    expect(top.className).toContain('rounded-b-xl')

    const root2 = document.createElement('div')
    mount(Sheet({ open: () => open(), side: 'bottom', 'aria-label': 'x', children: 'body' }), root2)
    const bottom = root2.querySelector('dialog') as HTMLDialogElement
    expect(bottom.className).toContain('mt-auto')
    expect(bottom.className).toContain('rounded-t-xl')
  })

  test('size variants apply per-side compound classes', () => {
    patchDialog()
    const open = state(false)
    // Side=right, size=sm → max-w
    const root1 = document.createElement('div')
    mount(Sheet({ open: () => open(), size: 'sm', 'aria-label': 'x', children: 'b' }), root1)
    expect((root1.querySelector('dialog') as HTMLElement).className).toContain(
      'max-w-[min(320px,92vw)]',
    )
    // Side=top, size=lg → max-h
    const root2 = document.createElement('div')
    mount(
      Sheet({
        open: () => open(),
        side: 'top',
        size: 'lg',
        'aria-label': 'x',
        children: 'b',
      }),
      root2,
    )
    expect((root2.querySelector('dialog') as HTMLElement).className).toContain(
      'max-h-[min(560px,80vh)]',
    )
  })

  test('opens via showModal() + closes via close() on open-state flip', () => {
    patchDialog()
    const open = state(false)
    const root = document.createElement('div')
    document.body.appendChild(root)
    mount(Sheet({ open: () => open(), 'aria-label': 'x', children: 'b' }), root)
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    const showSpy = vi.spyOn(dialog, 'showModal')
    const closeSpy = vi.spyOn(dialog, 'close')
    open.set(true)
    expect(showSpy).toHaveBeenCalled()
    open.set(false)
    expect(closeSpy).toHaveBeenCalled()
  })

  test('onClose fires when the dialog dispatches close', () => {
    patchDialog()
    const open = state(true)
    const onClose = vi.fn()
    const root = document.createElement('div')
    document.body.appendChild(root)
    mount(Sheet({ open: () => open(), onClose, 'aria-label': 'x', children: 'b' }), root)
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    dialog.dispatchEvent(new Event('close'))
    expect(onClose).toHaveBeenCalled()
  })

  test('Sheet.Header / Body / Footer render their children with the expected slot chrome', () => {
    patchDialog()
    const open = state(true)
    const root = document.createElement('div')
    mount(
      Sheet({
        open: () => open(),
        'aria-label': 'x',
        children: [
          Sheet.Header({ children: 'Hdr' }),
          Sheet.Body({ children: 'Body content' }),
          Sheet.Footer({ children: 'Footer content' }),
        ],
      }),
      root,
    )
    expect(root.querySelector('header')?.textContent).toContain('Hdr')
    expect(root.textContent).toContain('Body content')
    expect(root.querySelector('footer')?.textContent).toContain('Footer content')
  })

  test('backdrop click closes when target IS the dialog itself', () => {
    patchDialog()
    const open = state(true)
    const root = document.createElement('div')
    document.body.appendChild(root)
    mount(Sheet({ open: () => open(), 'aria-label': 'x', children: 'b' }), root)
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    const closeSpy = vi.spyOn(dialog, 'close')
    // Synthesize a click whose target IS the dialog (backdrop).
    const ev = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(ev, 'target', { value: dialog })
    dialog.dispatchEvent(ev)
    expect(closeSpy).toHaveBeenCalled()
  })

  test('closeOnBackdrop={false} suppresses backdrop-close', () => {
    patchDialog()
    const open = state(true)
    const root = document.createElement('div')
    document.body.appendChild(root)
    mount(
      Sheet({
        open: () => open(),
        closeOnBackdrop: false,
        'aria-label': 'x',
        children: 'b',
      }),
      root,
    )
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    const closeSpy = vi.spyOn(dialog, 'close')
    const ev = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(ev, 'target', { value: dialog })
    dialog.dispatchEvent(ev)
    expect(closeSpy).not.toHaveBeenCalled()
  })

  // ===== Tier 17-D — `class` (root) + `classNames` (sub-parts) =====
  test('`class` prop adds onto the sheet element', () => {
    patchDialog()
    const open = state(false)
    const root = document.createElement('div')
    mount(
      Sheet({
        open: () => open(),
        'aria-label': 'x',
        class: 'my-sheet',
        children: 'b',
      }),
      root,
    )
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    expect(dialog.className).toContain('my-sheet')
    expect(dialog.className).toContain('place-sheet')
  })

  test('classNames.backdrop maps to [&::backdrop]: tokens', () => {
    patchDialog()
    const open = state(false)
    const root = document.createElement('div')
    mount(
      Sheet({
        open: () => open(),
        'aria-label': 'x',
        classNames: { backdrop: 'bg-blue-500/30' },
        children: 'b',
      }),
      root,
    )
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    expect(dialog.className).toContain('[&::backdrop]:bg-blue-500/30')
  })
})
