// @vitest-environment happy-dom

import { mount, renderToString } from '@place/component'
import { state } from '@place/reactivity'
import { describe, expect, test } from 'vitest'
import { Field, Input, Textarea } from '../../src/Field.tsx'

describe('Input — native-first form control', () => {
  test('renders a native <input> with type=text by default', () => {
    const html = renderToString(Input({}))
    expect(html).toMatch(/^<input/)
    expect(html).toContain('type="text"')
  })

  test('type variants forward to native attribute', () => {
    expect(renderToString(Input({ type: 'email' }))).toContain('type="email"')
    expect(renderToString(Input({ type: 'password' }))).toContain('type="password"')
    expect(renderToString(Input({ type: 'url' }))).toContain('type="url"')
    expect(renderToString(Input({ type: 'date' }))).toContain('type="date"')
  })

  test('required attribute forwards natively (drives :user-invalid)', () => {
    const html = renderToString(Input({ required: true }))
    expect(html).toContain('required')
  })

  test('pattern, minlength, maxlength forward', () => {
    const html = renderToString(Input({ pattern: '\\d{4}', minLength: 4, maxLength: 8 }))
    expect(html).toContain('pattern="\\d{4}"')
    expect(html).toContain('minlength="4"')
    expect(html).toContain('maxlength="8"')
  })

  test('reactive value binds and updates the native element', () => {
    const v = state('initial')
    const root = document.createElement('div')
    mount(Input({ value: () => v() }), root)
    const input = root.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('initial')
    v.set('updated')
    expect(input.value).toBe('updated')
  })

  test('onInput fires with the native event', () => {
    const captured: { event: Event | null } = { event: null }
    const root = document.createElement('div')
    mount(Input({ onInput: (e) => (captured.event = e) }), root)
    const input = root.querySelector('input') as HTMLInputElement
    input.dispatchEvent(new Event('input'))
    expect(captured.event).not.toBeNull()
    expect(captured.event?.type).toBe('input')
  })

  test('recipe size variant changes padding/text classes', () => {
    expect(renderToString(Input({ size: 'sm' }))).toContain('px-2')
    expect(renderToString(Input({ size: 'lg' }))).toContain('px-3.5')
  })

  test('class prop appends to recipe output', () => {
    const html = renderToString(Input({ class: 'mt-4 w-1/2' }))
    expect(html).toContain('mt-4')
    expect(html).toContain('w-1/2')
    expect(html).toContain('bg-bg') // recipe base class still present
  })
})

describe('Textarea', () => {
  test('renders a native <textarea>', () => {
    const html = renderToString(Textarea({}))
    expect(html).toMatch(/^<textarea/)
  })

  test('default rows=4', () => {
    const html = renderToString(Textarea({}))
    expect(html).toContain('rows="4"')
  })

  test('rows prop forwards', () => {
    const html = renderToString(Textarea({ rows: 10 }))
    expect(html).toContain('rows="10"')
  })

  test('includes resize-y + min-h utilities in class', () => {
    const html = renderToString(Textarea({}))
    expect(html).toContain('resize-y')
    expect(html).toContain('min-h-[5rem]')
  })
})

describe('Field — labeled wrapper', () => {
  test('renders <label> + children with the for/id linkage', () => {
    const root = document.createElement('div')
    mount(
      Field({ id: 'email', label: 'Email', children: Input({ id: 'email', type: 'email' }) }),
      root,
    )
    const label = root.querySelector('label') as HTMLLabelElement
    const input = root.querySelector('input') as HTMLInputElement
    expect(label.getAttribute('for')).toBe('email')
    expect(input.id).toBe('email')
    expect(label.textContent).toBe('Email')
  })

  test('shows hint text below the input when no error', () => {
    const root = document.createElement('div')
    mount(
      Field({
        id: 'name',
        label: 'Name',
        hint: 'As it appears on your ID',
        children: Input({ id: 'name' }),
      }),
      root,
    )
    expect(root.textContent).toContain('As it appears on your ID')
  })

  test('reactive error message replaces hint when set', () => {
    const err = state<string | null>(null)
    const root = document.createElement('div')
    mount(
      Field({
        id: 'email',
        label: 'Email',
        hint: 'We will never share it',
        error: () => err(),
        children: Input({ id: 'email', type: 'email' }),
      }),
      root,
    )
    // No error initially: shows the hint.
    expect(root.textContent).toContain('We will never share it')
    expect(root.querySelector('[role="alert"]')).toBeNull()

    // Set error: shows the error, hides the hint.
    err.set('Invalid email format')
    expect(root.textContent).not.toContain('We will never share it')
    const alert = root.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toBe('Invalid email format')
    expect(alert?.classList.contains('text-destructive')).toBe(true)

    // Clear error: hint returns.
    err.set(null)
    expect(root.textContent).toContain('We will never share it')
    expect(root.querySelector('[role="alert"]')).toBeNull()
  })

  test('static error string also works (non-reactive)', () => {
    const root = document.createElement('div')
    mount(
      Field({
        label: 'Name',
        error: 'Required',
        children: Input({}),
      }),
      root,
    )
    const alert = root.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe('Required')
  })

  test('auto-generates an id when none is provided', () => {
    const root = document.createElement('div')
    mount(Field({ label: 'X', children: Input({}) }), root)
    const label = root.querySelector('label') as HTMLLabelElement
    expect(label.getAttribute('for')).toMatch(/^place-field-\d+$/)
  })

  // ===== Tier 17-A.5 — :has()-driven auto-validity =====
  //
  // The component's contract here is just structural: the wrapper
  // carries `place-field` + the hint paragraph carries
  // `place-field-hint`. The CSS rules in `styles.ts` then handle
  // the destructive styling via `:has(:user-invalid)`. We can't
  // exercise `:has()` matching in happy-dom (it doesn't run the CSS
  // selector engine the way real browsers do), but we CAN verify
  // the structural hooks are present so the CSS has something to
  // target.

  test('wrapper has the place-field semantic class for :has() targeting', () => {
    const root = document.createElement('div')
    mount(Field({ label: 'X', children: Input({}) }), root)
    const wrapper = root.querySelector('.place-field')
    expect(wrapper).not.toBeNull()
  })

  test('hint paragraph has place-field-hint class', () => {
    const root = document.createElement('div')
    mount(Field({ label: 'X', hint: 'help', children: Input({}) }), root)
    const hint = root.querySelector('.place-field-hint')
    expect(hint).not.toBeNull()
    expect(hint?.textContent).toBe('help')
  })

  test('error paragraph also carries place-field-hint class (same slot)', () => {
    const root = document.createElement('div')
    mount(
      Field({
        label: 'Email',
        error: 'Required',
        children: Input({ type: 'email', required: true }),
      }),
      root,
    )
    const hint = root.querySelector('.place-field-hint')
    expect(hint).not.toBeNull()
    expect(hint?.getAttribute('role')).toBe('alert')
  })

  // ===== Tier 17-D — typed per-subpart classNames =====
  test('classNames.label adds onto the label element', () => {
    const root = document.createElement('div')
    mount(
      Field({
        label: 'Email',
        classNames: { label: 'uppercase tracking-wide' },
        children: Input({}),
      }),
      root,
    )
    const label = root.querySelector('label') as HTMLLabelElement
    expect(label.className).toContain('uppercase')
    expect(label.className).toContain('tracking-wide')
  })

  test('classNames.hint adds onto the hint paragraph', () => {
    const root = document.createElement('div')
    mount(
      Field({
        label: 'Email',
        hint: 'Help text',
        classNames: { hint: 'italic font-bold' },
        children: Input({}),
      }),
      root,
    )
    const hint = root.querySelector('.place-field-hint')
    expect(hint?.className).toContain('italic')
    expect(hint?.className).toContain('font-bold')
  })

  // ===== Tier 17-E — auto-thread id + aria-describedby =====
  // The wiring runs in a microtask so we await one before asserting.

  test('auto-threads the field id onto a child input that has no id', async () => {
    const root = document.createElement('div')
    mount(Field({ id: 'email', label: 'Email', children: Input({ type: 'email' }) }), root)
    await Promise.resolve() // let the queued microtask run
    const input = root.querySelector('input') as HTMLInputElement
    // The Field's `id` becomes the input's `id` so the label's `for`
    // resolves to the input (HTML4 form-control association).
    expect(input.id).toBe('email')
  })

  test('preserves an explicit id on the child input (no overwrite)', async () => {
    const root = document.createElement('div')
    mount(
      Field({
        id: 'field-id',
        label: 'Email',
        children: Input({ id: 'explicit-id', type: 'email' }),
      }),
      root,
    )
    await Promise.resolve()
    const input = root.querySelector('input') as HTMLInputElement
    expect(input.id).toBe('explicit-id')
  })

  test('auto-wires aria-describedby pointing at both hint + error ids', async () => {
    const root = document.createElement('div')
    mount(
      Field({
        id: 'email',
        label: 'Email',
        hint: 'Help text',
        children: Input({ type: 'email' }),
      }),
      root,
    )
    await Promise.resolve()
    const input = root.querySelector('input') as HTMLInputElement
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toContain('email-hint')
    expect(describedBy).toContain('email-error')
  })

  test('reactive hint — pass a function for live updates', () => {
    const root = document.createElement('div')
    const hint = state('initial')
    mount(Field({ label: 'X', hint: () => hint(), children: Input({}) }), root)
    expect(root.querySelector('.place-field-hint')?.textContent).toBe('initial')
    hint.set('changed')
    expect(root.querySelector('.place-field-hint')?.textContent).toBe('changed')
  })
})
