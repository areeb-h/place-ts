// @vitest-environment happy-dom

import { mount } from '@place/component'
import { state } from '@place/reactivity'
import { describe, expect, test, vi } from 'vitest'
import { Dialog } from '../../src/Dialog.tsx'

// happy-dom doesn't implement <dialog>.showModal() out of the box —
// it stubs `.show()`/`.close()` but `.showModal()` is missing in
// older versions. Patch it with a minimal stub before each test so
// the open/close state can be tracked.
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

describe('Dialog — native <dialog> wrapper', () => {
  test('renders a <dialog> element', () => {
    patchDialog()
    const open = state(false)
    const root = document.createElement('div')
    mount(Dialog({ open: () => open(), 'aria-label': 'Test', children: 'Hello' }), root)
    expect(root.querySelector('dialog')).not.toBeNull()
  })

  test('opens via showModal() when open state flips true', () => {
    patchDialog()
    const open = state(false)
    const root = document.createElement('div')
    document.body.appendChild(root)
    mount(Dialog({ open: () => open(), 'aria-label': 'Test', children: 'Hi' }), root)
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    const showModalSpy = vi.spyOn(dialog, 'showModal')
    open.set(true)
    expect(showModalSpy).toHaveBeenCalled()
  })

  test('closes via close() when open state flips false', () => {
    patchDialog()
    const open = state(true)
    const root = document.createElement('div')
    document.body.appendChild(root)
    mount(Dialog({ open: () => open(), 'aria-label': 'Test', children: 'Hi' }), root)
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    const closeSpy = vi.spyOn(dialog, 'close')
    open.set(false)
    expect(closeSpy).toHaveBeenCalled()
  })

  test('onClose fires when the native close event dispatches', () => {
    patchDialog()
    const open = state(true)
    const onClose = vi.fn()
    const root = document.createElement('div')
    document.body.appendChild(root)
    mount(
      Dialog({ open: () => open(), 'aria-label': 'Test', onClose, children: 'Hi' }),
      root,
    )
    open.set(false)
    expect(onClose).toHaveBeenCalled()
  })

  test('aria-label forwards to the dialog element', () => {
    patchDialog()
    const root = document.createElement('div')
    mount(
      Dialog({ open: () => false, 'aria-label': 'Sign in', children: 'x' }),
      root,
    )
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    expect(dialog.getAttribute('aria-label')).toBe('Sign in')
  })

  test('size variant changes max-width class', () => {
    patchDialog()
    const root = document.createElement('div')
    mount(
      Dialog({ open: () => false, 'aria-label': 'X', size: 'lg', children: 'x' }),
      root,
    )
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    expect(dialog.className).toContain('max-w-[min(720px,92vw)]')
  })

  test('semantic .place-dialog class always present (for global @starting-style rules)', () => {
    patchDialog()
    const root = document.createElement('div')
    mount(Dialog({ open: () => false, 'aria-label': 'X', children: 'x' }), root)
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    expect(dialog.className).toContain('place-dialog')
  })

  // ===== Tier 17-D — `class` (root) + `classNames` (sub-parts) =====
  // Contract: `class` is the additive root channel; `classNames` is
  // the typed map of sub-parts (excludes `root` by type). One
  // spelling per concept.

  test('`class` prop adds onto the dialog element', () => {
    patchDialog()
    const root = document.createElement('div')
    mount(
      Dialog({
        open: () => false,
        'aria-label': 'X',
        class: 'my-dialog',
        children: 'x',
      }),
      root,
    )
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    expect(dialog.className).toContain('my-dialog')
    // Recipe defaults still present.
    expect(dialog.className).toContain('place-dialog')
  })

  test('classNames.backdrop maps each token to [&::backdrop]: variant', () => {
    patchDialog()
    const root = document.createElement('div')
    mount(
      Dialog({
        open: () => false,
        'aria-label': 'X',
        classNames: { backdrop: 'bg-red-500/40 backdrop-blur-lg' },
        children: 'x',
      }),
      root,
    )
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    expect(dialog.className).toContain('[&::backdrop]:bg-red-500/40')
    expect(dialog.className).toContain('[&::backdrop]:backdrop-blur-lg')
  })

  test('`class` + classNames.backdrop compose together', () => {
    patchDialog()
    const root = document.createElement('div')
    mount(
      Dialog({
        open: () => false,
        'aria-label': 'X',
        class: 'rounded-2xl',
        classNames: { backdrop: 'bg-black/80' },
        children: 'x',
      }),
      root,
    )
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    expect(dialog.className).toContain('rounded-2xl')
    expect(dialog.className).toContain('[&::backdrop]:bg-black/80')
  })

  // ===== Tier 17-E — mousedown+mouseup backdrop tracking + onOpen =====

  test('backdrop close requires mousedown AND mouseup on the dialog (no drag-out-close bug)', () => {
    patchDialog()
    const open = state(true)
    const root = document.createElement('div')
    document.body.appendChild(root)
    mount(Dialog({ open: () => open(), 'aria-label': 'x', children: 'body' }), root)
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    const closeSpy = vi.spyOn(dialog, 'close')

    // Simulate: user mousedowns INSIDE the dialog body, then drags
    // out to the backdrop and releases — the click target is the
    // backdrop (= the dialog element) but the mousedown was on a
    // child. Should NOT close.
    const child = document.createElement('div')
    dialog.appendChild(child)
    const downEv = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(downEv, 'target', { value: child })
    dialog.dispatchEvent(downEv)
    const clickEv = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(clickEv, 'target', { value: dialog })
    dialog.dispatchEvent(clickEv)
    expect(closeSpy).not.toHaveBeenCalled()
  })

  test('backdrop click DOES close when both mousedown + click are on the dialog (true backdrop click)', () => {
    patchDialog()
    const open = state(true)
    const root = document.createElement('div')
    document.body.appendChild(root)
    mount(Dialog({ open: () => open(), 'aria-label': 'x', children: 'body' }), root)
    const dialog = root.querySelector('dialog') as HTMLDialogElement
    const closeSpy = vi.spyOn(dialog, 'close')

    const downEv = new MouseEvent('mousedown', { bubbles: true })
    Object.defineProperty(downEv, 'target', { value: dialog })
    dialog.dispatchEvent(downEv)
    const clickEv = new MouseEvent('click', { bubbles: true })
    Object.defineProperty(clickEv, 'target', { value: dialog })
    dialog.dispatchEvent(clickEv)
    expect(closeSpy).toHaveBeenCalled()
  })

  test('onOpen fires after showModal() succeeds', () => {
    patchDialog()
    const open = state(false)
    const onOpen = vi.fn()
    const root = document.createElement('div')
    document.body.appendChild(root)
    mount(
      Dialog({ open: () => open(), onOpen, 'aria-label': 'x', children: 'body' }),
      root,
    )
    expect(onOpen).not.toHaveBeenCalled()
    open.set(true)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  test('named children: Header / Body / Footer render with their classes', () => {
    patchDialog()
    const root = document.createElement('div')
    mount(
      Dialog({
        open: () => false,
        'aria-label': 'X',
        children: [
          Dialog.Header({ children: 'Header' }),
          Dialog.Body({ children: 'Body' }),
          Dialog.Footer({ children: 'Footer' }),
        ],
      }),
      root,
    )
    expect(root.querySelector('header')?.textContent).toBe('Header')
    expect(root.querySelector('header')?.className).toContain('border-b')
    // Body wraps in a <div> (not semantic — body is an inner content
    // area, not a landmark).
    const body = root.querySelector('dialog > div')
    expect(body?.textContent).toBe('Body')
    expect(root.querySelector('footer')?.textContent).toBe('Footer')
  })
})
