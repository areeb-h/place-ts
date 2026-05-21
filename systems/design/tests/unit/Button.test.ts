// @vitest-environment happy-dom

import { mount, renderToString } from '@place-ts/component'
import { state } from '@place-ts/reactivity'
import { describe, expect, test } from 'vitest'
import { Button } from '../../src/Button.tsx'

describe('Button — variants + base behavior', () => {
  test('renders a <button> with default primary/md classes', () => {
    const html = renderToString(Button({ children: 'Save' }))
    expect(html).toMatch(/^<button/)
    expect(html).toContain('bg-accent')
    expect(html).toContain('text-accent-fg')
    expect(html).toContain('Save')
  })

  test('intent variants change visual classes', () => {
    expect(renderToString(Button({ intent: 'secondary', children: 'x' }))).toContain('bg-card')
    expect(renderToString(Button({ intent: 'ghost', children: 'x' }))).toContain('text-muted')
    expect(renderToString(Button({ intent: 'destructive', children: 'x' }))).toContain(
      'bg-destructive',
    )
  })

  test('size variants change padding/text classes', () => {
    const sm = renderToString(Button({ size: 'sm', children: 'x' }))
    const lg = renderToString(Button({ size: 'lg', children: 'x' }))
    expect(sm).toContain('text-xs')
    expect(lg).toContain('px-5')
  })

  test('SSR + client render produce the same outer markup shape', () => {
    const ssr = renderToString(Button({ children: 'Save' }))
    // Mount onto an empty root; compare innerHTML's first element.
    const root = document.createElement('div')
    mount(Button({ children: 'Save' }), root)
    // Both should start with <button>. Don't compare hydration markers
    // — SSR adds `data-h`, client mount doesn't.
    expect(ssr.startsWith('<button')).toBe(true)
    expect(root.firstChild?.nodeName).toBe('BUTTON')
  })

  test('class prop appends to recipe output via cls()', () => {
    const html = renderToString(Button({ children: 'x', class: 'w-full mt-4' }))
    expect(html).toContain('w-full')
    expect(html).toContain('mt-4')
    // Recipe classes still present (cls is additive, not overriding).
    expect(html).toContain('bg-accent')
  })
})

describe('Button — disabled / loading', () => {
  test('disabled (static): native disabled attr is set, click does not fire', () => {
    let clicks = 0
    const root = document.createElement('div')
    mount(Button({ disabled: true, onClick: () => clicks++, children: 'x' }), root)
    const btn = root.querySelector('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    btn.click()
    expect(clicks).toBe(0)
  })

  test('disabled (reactive): toggling changes native disabled attr', () => {
    const dis = state(false)
    const root = document.createElement('div')
    mount(Button({ disabled: () => dis(), children: 'x' }), root)
    const btn = root.querySelector('button') as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    dis.set(true)
    expect(btn.disabled).toBe(true)
  })

  test('loading: aria-busy="true" set; click blocked', () => {
    let clicks = 0
    const root = document.createElement('div')
    mount(Button({ loading: true, onClick: () => clicks++, children: 'x' }), root)
    const btn = root.querySelector('button') as HTMLButtonElement
    expect(btn.getAttribute('aria-busy')).toBe('true')
    expect(btn.disabled).toBe(true)
    btn.click()
    expect(clicks).toBe(0)
  })

  test('disabled state emits aria-disabled="true"', () => {
    const root = document.createElement('div')
    mount(Button({ disabled: true, children: 'x' }), root)
    const btn = root.querySelector('button') as HTMLButtonElement
    expect(btn.getAttribute('aria-disabled')).toBe('true')
  })

  test('default state: no aria-disabled, no aria-busy attrs', () => {
    const root = document.createElement('div')
    mount(Button({ children: 'x' }), root)
    const btn = root.querySelector('button') as HTMLButtonElement
    expect(btn.hasAttribute('aria-disabled')).toBe(false)
    expect(btn.hasAttribute('aria-busy')).toBe(false)
  })
})

describe('Button — slots + types', () => {
  test('type prop forwards to native button.type', () => {
    const root = document.createElement('div')
    mount(Button({ type: 'submit', children: 'Submit' }), root)
    const btn = root.querySelector('button') as HTMLButtonElement
    expect(btn.type).toBe('submit')
  })

  test('aria-label forwards', () => {
    const root = document.createElement('div')
    mount(Button({ 'aria-label': 'Delete', children: '' }), root)
    const btn = root.querySelector('button') as HTMLButtonElement
    expect(btn.getAttribute('aria-label')).toBe('Delete')
  })
})
