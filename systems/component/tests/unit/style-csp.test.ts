// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { state } from '../../../reactivity/src/index.ts'
import { div } from '../../src/index.ts'

// Regression coverage for the strict-CSP inline-style fix. Under the
// default `security: 'standard'` preset, `setAttribute('style', …)` and
// `style.cssText = …` are blocked by `style-src` because the browser
// classifies them as inline-style application. The framework MUST route
// every runtime style write through `CSSStyleDeclaration.setProperty` /
// `.removeProperty`, which CSP treats as programmatic mutation and does
// NOT block.
//
// Two layers of coverage:
//
//   1. Static: grep the framework source — no `setAttribute('style', …)`
//      anywhere. Catches accidental regression to the blocked API.
//      (Real browsers' setProperty does NOT call setAttribute under the
//      hood; happy-dom's does, so behavioral spying is unreliable.)
//
//   2. Behavioral: applying string, object, reactive-fn, and clearing
//      styles all produce the right CSSStyleDeclaration state.

const FRAMEWORK_SRC = resolve(import.meta.dirname, '../../src/index.ts')

describe('CSP-safe style writes (regression: setAttribute style)', () => {
  test('framework source contains no setAttribute("style", …) calls', () => {
    const src = readFileSync(FRAMEWORK_SRC, 'utf8')
    // Strip comments (line + block) before grep so doc-comments mentioning
    // the forbidden pattern don't false-positive.
    const stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(stripped).not.toMatch(/setAttribute\(\s*['"]style['"]/)
    expect(stripped).not.toMatch(/style\.cssText\s*=/)
  })
})

describe('CSP-safe style writes — behavior', () => {
  test('static string style applies via CSSStyleDeclaration (props readable)', () => {
    const root = document.createElement('div')
    const dispose = div({ style: 'color: red; --foo: 7' }, ['x']).mount(root, null)
    try {
      const node = root.firstElementChild as HTMLElement
      expect(node.style.getPropertyValue('color')).toBe('red')
      expect(node.style.getPropertyValue('--foo')).toBe('7')
    } finally {
      dispose()
    }
  })

  test('reactive style fn updates flow through across re-renders', async () => {
    const s = state(0)
    const root = document.createElement('div')
    const dispose = div({ style: () => `--flash-age: ${s()};` }, ['x']).mount(root, null)
    try {
      const node = root.firstElementChild as HTMLElement
      expect(node.style.getPropertyValue('--flash-age')).toBe('0')
      s.set(0.42)
      await Promise.resolve()
      expect(node.style.getPropertyValue('--flash-age')).toBe('0.42')
    } finally {
      dispose()
    }
  })

  test('object style applies camelCase → kebab-case and supports custom props', () => {
    const root = document.createElement('div')
    const dispose = div({ style: { backgroundColor: 'blue', '--ring-color': 'gold' } }, [
      'x',
    ]).mount(root, null)
    try {
      const node = root.firstElementChild as HTMLElement
      expect(node.style.getPropertyValue('background-color')).toBe('blue')
      expect(node.style.getPropertyValue('--ring-color')).toBe('gold')
    } finally {
      dispose()
    }
  })

  test('dropped properties are removed when reactive style swaps', async () => {
    const s = state('color: red; background: blue;')
    const root = document.createElement('div')
    const dispose = div({ style: () => s() }, ['x']).mount(root, null)
    try {
      const node = root.firstElementChild as HTMLElement
      expect(node.style.getPropertyValue('color')).toBe('red')
      expect(node.style.getPropertyValue('background')).toBe('blue')
      s.set('color: green;')
      await Promise.resolve()
      expect(node.style.getPropertyValue('color')).toBe('green')
      // `background` should be cleared — not just shadowed.
      expect(node.style.getPropertyValue('background')).toBe('')
    } finally {
      dispose()
    }
  })

  test('null/false clears every inline property', async () => {
    const s = state<string | null>('color: red; --x: 1;')
    const root = document.createElement('div')
    const dispose = div({ style: () => s() }, ['x']).mount(root, null)
    try {
      const node = root.firstElementChild as HTMLElement
      expect(node.style.length).toBeGreaterThan(0)
      s.set(null)
      await Promise.resolve()
      expect(node.style.length).toBe(0)
    } finally {
      dispose()
    }
  })

  test('!important priority is preserved', () => {
    const root = document.createElement('div')
    const dispose = div({ style: 'color: red !important; padding: 1px' }, ['x']).mount(root, null)
    try {
      const node = root.firstElementChild as HTMLElement
      expect(node.style.getPropertyPriority('color')).toBe('important')
      expect(node.style.getPropertyPriority('padding')).toBe('')
    } finally {
      dispose()
    }
  })
})
