import { describe, expect, test } from 'vitest'
import { cls } from '../../src/index.ts'

describe('cls — class composition', () => {
  test('joins simple strings', () => {
    expect(cls('a', 'b', 'c')).toBe('a b c')
  })

  test('skips falsy values', () => {
    expect(cls('a', false, null, undefined, 'b')).toBe('a b')
  })

  test('preserves zero', () => {
    expect(cls('item', 0)).toBe('item 0')
  })

  test('object form: includes keys with truthy values', () => {
    expect(cls({ a: true, b: false, c: true, d: undefined })).toBe('a c')
  })

  test('mixed strings and objects', () => {
    expect(cls('base', { active: true, disabled: false })).toBe('base active')
  })

  test('arrays flatten recursively', () => {
    expect(cls(['a', 'b', ['c', ['d', { e: true }]]])).toBe('a b c d e')
  })

  test('empty input returns empty string', () => {
    expect(cls()).toBe('')
    expect(cls(false, null, {})).toBe('')
  })

  test('typical Tailwind use case', () => {
    const isPrimary = true
    const isLoading = false
    const result = cls(
      'px-4 py-2 rounded',
      isPrimary && 'bg-amber-500 text-zinc-900',
      !isPrimary && 'bg-zinc-800 text-zinc-100',
      { 'opacity-50 cursor-wait': isLoading },
    )
    expect(result).toBe('px-4 py-2 rounded bg-amber-500 text-zinc-900')
  })

  // Tailwind utilities that share a prefix can target different CSS
  // properties and COMPOSE rather than override each other. The merge
  // must keep both — collapsing them was the original tailwind-merge
  // bug that broke `<Card intent="raised">`.
  describe('composing utilities that share a prefix', () => {
    test('shadow size + shadow color survive together', () => {
      expect(cls('shadow-lg shadow-bg/30')).toBe('shadow-lg shadow-bg/30')
      expect(cls('shadow-xl shadow-bg/40')).toBe('shadow-xl shadow-bg/40')
      expect(cls('shadow-2xl shadow-bg/40')).toBe('shadow-2xl shadow-bg/40')
    })

    test('shadow size still overrides shadow size', () => {
      expect(cls('shadow-sm shadow-lg')).toBe('shadow-lg')
    })

    test('shadow color still overrides shadow color', () => {
      expect(cls('shadow-red-500/20 shadow-bg/30')).toBe('shadow-bg/30')
    })

    test('border width + border color survive together', () => {
      expect(cls('border border-border')).toBe('border border-border')
      expect(cls('border-2 border-current')).toBe('border-2 border-current')
      expect(cls('border border-border/60')).toBe('border border-border/60')
    })

    test('border width still overrides border width', () => {
      expect(cls('border-2 border-4')).toBe('border-4')
      expect(cls('border border-2')).toBe('border-2')
    })

    test('border color still overrides border color', () => {
      expect(cls('border-border border-accent')).toBe('border-accent')
      expect(cls('border-border/60 border-border/80')).toBe('border-border/80')
    })

    test('border style composes with width and color', () => {
      expect(cls('border border-solid border-red-500')).toBe('border border-solid border-red-500')
    })

    test('text size + text color + text align all survive together', () => {
      expect(cls('text-lg text-zinc-900 text-center')).toBe('text-lg text-zinc-900 text-center')
    })

    test('text align still overrides text align', () => {
      expect(cls('text-left text-center')).toBe('text-center')
    })

    test('bg color + bg gradient direction survive together', () => {
      expect(cls('bg-blue-500 bg-gradient-to-r')).toBe('bg-blue-500 bg-gradient-to-r')
    })

    test('bg color still overrides bg color', () => {
      expect(cls('bg-red-500 bg-blue-500')).toBe('bg-blue-500')
    })

    test('Card raised intent keeps both shadow utilities', () => {
      // Exact repro from the bug report — `<Card intent="raised">`.
      expect(cls('rounded-xl bg-card border border-border text-fg', 'border-border/60 shadow-lg shadow-bg/30', 'p-5'))
        .toBe('rounded-xl bg-card border text-fg border-border/60 shadow-lg shadow-bg/30 p-5')
    })
  })
})
