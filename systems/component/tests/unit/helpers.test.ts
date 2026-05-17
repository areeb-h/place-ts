// @vitest-environment happy-dom

import { describe, expect, test, vi } from 'vitest'
import { state } from '../../../reactivity/src/index.ts'
import { component, el, globalKey, mount, onKey, wire } from '../../src/index.ts'

describe('wire — two-way string binding', () => {
  test('value is the state read getter (method ref)', () => {
    const s = state('hello')
    const w = wire(s)
    expect(w.value()).toBe('hello')
    s.set('world')
    expect(w.value()).toBe('world')
  })

  test('onInput writes the target.value back to state', () => {
    const s = state('')
    const w = wire(s)
    const input = document.createElement('input')
    input.value = 'typed'
    w.onInput({ target: input } as unknown as Event)
    expect(s()).toBe('typed')
  })

  test('end-to-end: spread on a real <input> drives both directions', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const s = state('initial')
    const view = el('input', { ...wire(s) })
    const dispose = mount(view, root)

    const input = root.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('initial')

    // Reactive direction: state → input
    s.set('changed')
    expect(input.value).toBe('changed')

    // Event direction: input → state
    input.value = 'typed'
    input.dispatchEvent(new Event('input'))
    expect(s()).toBe('typed')

    dispose()
    root.remove()
  })

  test('two-arg form: getter + setter for a derived field', () => {
    let stored = 'one'
    const get = () => stored
    const set = (v: string) => {
      stored = v
    }
    const w = wire(get, set)
    expect(w.value()).toBe('one')

    const input = document.createElement('input')
    input.value = 'two'
    w.onInput({ target: input } as unknown as Event)
    expect(stored).toBe('two')
  })

  test('boolean state binds to checked / onChange', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const flag = state(false)
    const view = el('input', { type: 'checkbox', ...wire(flag) })
    const dispose = mount(view, root)

    const cb = root.querySelector('input') as HTMLInputElement
    expect(cb.checked).toBe(false)

    flag.set(true)
    expect(cb.checked).toBe(true)

    cb.checked = false
    cb.dispatchEvent(new Event('change'))
    expect(flag()).toBe(false)

    dispose()
    root.remove()
  })

  test('number state parses .value and ignores NaN', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const n = state(0)
    const view = el('input', { type: 'number', ...wire(n) })
    const dispose = mount(view, root)

    const input = root.querySelector('input') as HTMLInputElement

    n.set(42)
    expect(Number(input.value)).toBe(42)

    input.value = '7.5'
    input.dispatchEvent(new Event('input'))
    expect(n()).toBe(7.5)

    // Empty / non-numeric input — silently ignored.
    input.value = ''
    input.dispatchEvent(new Event('input'))
    expect(n()).toBe(7.5)

    input.value = 'not-a-number'
    input.dispatchEvent(new Event('input'))
    expect(n()).toBe(7.5)

    dispose()
    root.remove()
  })

  test('also works for <textarea>', () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    const s = state('one\ntwo')
    const view = el('textarea', { ...wire(s) })
    const dispose = mount(view, root)

    const ta = root.querySelector('textarea') as HTMLTextAreaElement
    expect(ta.value).toBe('one\ntwo')

    ta.value = 'edited'
    ta.dispatchEvent(new Event('input'))
    expect(s()).toBe('edited')

    dispose()
    root.remove()
  })
})

describe('onKey — single-key keyboard handler', () => {
  test('invokes handler only for the named key', () => {
    const fn = vi.fn()
    const handler = onKey('Enter', fn)
    handler(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(fn).toHaveBeenCalledTimes(1)

    handler(new KeyboardEvent('keydown', { key: 'a' }))
    handler(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('preventDefault is opt-in', () => {
    const ev = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    const pd = vi.spyOn(ev, 'preventDefault')

    onKey('Enter', () => {})(ev)
    expect(pd).not.toHaveBeenCalled()

    const ev2 = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    const pd2 = vi.spyOn(ev2, 'preventDefault')
    onKey('Enter', () => {}, { preventDefault: true })(ev2)
    expect(pd2).toHaveBeenCalledTimes(1)
  })

  test('stopPropagation is opt-in', () => {
    const ev = new KeyboardEvent('keydown', { key: 'Escape' })
    const sp = vi.spyOn(ev, 'stopPropagation')

    onKey('Escape', () => {})(ev)
    expect(sp).not.toHaveBeenCalled()

    const ev2 = new KeyboardEvent('keydown', { key: 'Escape' })
    const sp2 = vi.spyOn(ev2, 'stopPropagation')
    onKey('Escape', () => {}, { stopPropagation: true })(ev2)
    expect(sp2).toHaveBeenCalledTimes(1)
  })

  test('non-matching keys do not trigger preventDefault', () => {
    const ev = new KeyboardEvent('keydown', { key: 'a', cancelable: true })
    const pd = vi.spyOn(ev, 'preventDefault')
    onKey('Enter', () => {}, { preventDefault: true })(ev)
    expect(pd).not.toHaveBeenCalled()
  })

  test('handler receives the event', () => {
    const ev = new KeyboardEvent('keydown', { key: 'Enter' })
    let received: KeyboardEvent | null = null
    onKey('Enter', (e) => {
      received = e
    })(ev)
    expect(received).toBe(ev)
  })
})

describe('globalKey — document-level keyboard shortcut', () => {
  const press = (init: KeyboardEventInit): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', init))
  }

  test('fires for matching key', () => {
    const fn = vi.fn()
    const stop = globalKey('k', fn)
    press({ key: 'k' })
    expect(fn).toHaveBeenCalledTimes(1)
    stop()
  })

  test('does NOT fire for a different key', () => {
    const fn = vi.fn()
    const stop = globalKey('k', fn)
    press({ key: 'j' })
    press({ key: 'K' })
    expect(fn).not.toHaveBeenCalled()
    stop()
  })

  test('mod chord requires meta or ctrl', () => {
    const fn = vi.fn()
    const stop = globalKey('mod+k', fn)

    // bare 'k' — no fire
    press({ key: 'k' })
    expect(fn).not.toHaveBeenCalled()

    press({ key: 'k', metaKey: true })
    expect(fn).toHaveBeenCalledTimes(1)

    press({ key: 'k', ctrlKey: true })
    expect(fn).toHaveBeenCalledTimes(2)

    stop()
  })

  test('non-mod shortcut does NOT fire when mod is held', () => {
    const fn = vi.fn()
    const stop = globalKey('k', fn)
    press({ key: 'k', metaKey: true })
    press({ key: 'k', ctrlKey: true })
    expect(fn).not.toHaveBeenCalled()
    stop()
  })

  test('shift / alt are matched strictly', () => {
    const fn = vi.fn()
    // Register against the actual event.key the browser produces under
    // shift — uppercase 'K' for the K key with shift held.
    const stop = globalKey('shift+K', fn)

    press({ key: 'k' })
    press({ key: 'K' })
    press({ key: 'k', altKey: true })
    expect(fn).not.toHaveBeenCalled()

    press({ key: 'K', shiftKey: true })
    expect(fn).toHaveBeenCalledTimes(1)

    stop()
  })

  test('preventDefault is opt-in', () => {
    const stopped = vi.fn()
    const stop = globalKey('k', stopped, { preventDefault: true })

    const ev = new KeyboardEvent('keydown', { key: 'k', cancelable: true })
    const pd = vi.spyOn(ev, 'preventDefault')
    document.dispatchEvent(ev)
    expect(stopped).toHaveBeenCalledTimes(1)
    expect(pd).toHaveBeenCalledTimes(1)

    stop()
  })

  test('skipInInput suppresses the handler while an input is focused', () => {
    const fn = vi.fn()
    const stop = globalKey('ArrowDown', fn, { skipInInput: true })

    // Bare keypress with no focused element — fires.
    press({ key: 'ArrowDown' })
    expect(fn).toHaveBeenCalledTimes(1)

    // Focus an input — handler should be suppressed.
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    press({ key: 'ArrowDown' })
    expect(fn).toHaveBeenCalledTimes(1)

    // Blur — fires again.
    input.blur()
    press({ key: 'ArrowDown' })
    expect(fn).toHaveBeenCalledTimes(2)

    input.remove()
    stop()
  })

  test('skipInInput honors textareas and contenteditable', () => {
    const fn = vi.fn()
    const stop = globalKey('Enter', fn, { skipInInput: true })

    const ta = document.createElement('textarea')
    document.body.appendChild(ta)
    ta.focus()
    press({ key: 'Enter' })
    expect(fn).not.toHaveBeenCalled()
    ta.remove()

    const ce = document.createElement('div')
    ce.contentEditable = 'true'
    document.body.appendChild(ce)
    ce.focus()
    press({ key: 'Enter' })
    expect(fn).not.toHaveBeenCalled()
    ce.remove()

    // Default fall-through — no editable focused now.
    press({ key: 'Enter' })
    expect(fn).toHaveBeenCalledTimes(1)
    stop()
  })

  test('without skipInInput, the handler fires regardless of focus', () => {
    const fn = vi.fn()
    const stop = globalKey('mod+k', fn)

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    press({ key: 'k', metaKey: true })
    expect(fn).toHaveBeenCalledTimes(1)

    input.remove()
    stop()
  })

  test('returned disposer removes the listener', () => {
    const fn = vi.fn()
    const stop = globalKey('k', fn)
    press({ key: 'k' })
    expect(fn).toHaveBeenCalledTimes(1)
    stop()
    press({ key: 'k' })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('auto-disposes when the host component unmounts', () => {
    const fn = vi.fn()
    const Inner = component(() => {
      globalKey('q', fn)
      return el('div')
    })
    const root = document.createElement('div')
    document.body.appendChild(root)
    const dispose = mount(Inner({}), root)

    press({ key: 'q' })
    expect(fn).toHaveBeenCalledTimes(1)

    dispose()
    press({ key: 'q' })
    expect(fn).toHaveBeenCalledTimes(1) // unchanged

    root.remove()
  })

  test('chord parsing rejects unknown modifiers and missing key', () => {
    const fn = vi.fn()
    expect(() => globalKey('cmd+k', fn)).toThrow(/unknown modifier 'cmd'/)
    expect(() => globalKey('mod+', fn)).toThrow(/must end with a key name/)
    expect(() => globalKey('', fn)).toThrow(/must end with a key name/)
  })

  test('mod+shift+key fires only with both held', () => {
    const fn = vi.fn()
    const stop = globalKey('mod+shift+z', fn)

    press({ key: 'z', metaKey: true })
    press({ key: 'Z', shiftKey: true })
    expect(fn).not.toHaveBeenCalled()

    press({ key: 'z', metaKey: true, shiftKey: true })
    expect(fn).toHaveBeenCalledTimes(1)

    stop()
  })
})
