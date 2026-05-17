// @vitest-environment happy-dom
//
// Form inputs need DOM property assignment for value/checked/selected/disabled
// — setAttribute only sets the *default*, which doesn't update the displayed
// value once the user has interacted. These tests pin that behavior.

import { describe, expect, test } from 'vitest'
import { state } from '../../../reactivity/src/index.ts'
import { el, mount } from '../../src/index.ts'

describe('form-input bindings — value uses .value property', () => {
  test('static value sets the property', () => {
    const root = document.createElement('div')
    mount(el('input', { type: 'text', value: 'hello' }), root)
    const input = root.firstElementChild as HTMLInputElement
    expect(input.value).toBe('hello')
  })

  test('reactive value updates the property when state changes', () => {
    const root = document.createElement('div')
    const v = state('alpha')
    mount(el('input', { type: 'text', value: () => v() }), root)
    const input = root.firstElementChild as HTMLInputElement
    expect(input.value).toBe('alpha')
    v.set('beta')
    expect(input.value).toBe('beta')
  })

  test('programmatic clear empties the displayed value', () => {
    // The bug we hit in the commonplace tag input: tagInput.set('') after
    // Enter would set the attribute but leave the .value property unchanged.
    const root = document.createElement('div')
    const v = state('typed-text')
    mount(el('input', { type: 'text', value: () => v() }), root)
    const input = root.firstElementChild as HTMLInputElement
    expect(input.value).toBe('typed-text')
    v.set('')
    expect(input.value, 'value should be cleared, not stuck at typed-text').toBe('')
  })

  test('checkbox checked uses the property', () => {
    const root = document.createElement('div')
    const on = state(false)
    mount(el('input', { type: 'checkbox', checked: () => on() }), root)
    const input = root.firstElementChild as HTMLInputElement
    expect(input.checked).toBe(false)
    on.set(true)
    expect(input.checked).toBe(true)
    on.set(false)
    expect(input.checked).toBe(false)
  })

  test('disabled uses the property', () => {
    const root = document.createElement('div')
    const off = state(false)
    mount(el('button', { type: 'button', disabled: () => off() }), root)
    const btn = root.firstElementChild as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    off.set(true)
    expect(btn.disabled).toBe(true)
  })

  test('textarea value uses the property', () => {
    const root = document.createElement('div')
    const v = state('paragraph one')
    mount(el('textarea', { value: () => v() }), root)
    const ta = root.firstElementChild as HTMLTextAreaElement
    expect(ta.value).toBe('paragraph one')
    v.set('paragraph two')
    expect(ta.value).toBe('paragraph two')
  })

  test('non-property attributes still go through setAttribute', () => {
    // Make sure we didn't break attribute-style bindings.
    const root = document.createElement('div')
    const t = state('hello')
    mount(el('input', { type: 'text', placeholder: () => t() }), root)
    const input = root.firstElementChild as HTMLInputElement
    expect(input.getAttribute('placeholder')).toBe('hello')
    t.set('typed something')
    expect(input.getAttribute('placeholder')).toBe('typed something')
  })
})
