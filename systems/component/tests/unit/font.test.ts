// @vitest-environment node
//
// font() / fonts() — @font-face + preload generators. Pure string
// transformations; tests verify CSS shape, format auto-detection,
// preload links, and combination via fonts().

import { describe, expect, test } from 'vitest'
import { font, fonts } from '../../src/index.ts'

describe('font() — single font definition', () => {
  test('emits @font-face with required fields', () => {
    const r = font({
      family: 'Inter',
      src: '/fonts/Inter-Regular.woff2',
      weight: 400,
    })
    expect(r.css).toContain('@font-face {')
    expect(r.css).toContain('font-family: "Inter"')
    expect(r.css).toContain('src: url("/fonts/Inter-Regular.woff2") format("woff2")')
    expect(r.css).toContain('font-weight: 400')
    expect(r.css).toContain('font-style: normal')
    expect(r.css).toContain('font-display: swap')
  })

  test('format auto-detected from extension (.woff2/.woff/.ttf/.otf)', () => {
    const cases: Array<[string, string]> = [
      ['/x.woff2', 'woff2'],
      ['/x.woff', 'woff'],
      ['/x.ttf', 'truetype'],
      ['/x.otf', 'opentype'],
      ['/x.eot', 'embedded-opentype'],
    ]
    for (const [url, expected] of cases) {
      const r = font({ family: 'F', src: url })
      expect(r.css).toContain(`format("${expected}")`)
    }
  })

  test('unknown extension: src emitted without format()', () => {
    const r = font({ family: 'F', src: '/fonts/weird.xyz' })
    expect(r.css).toContain('url("/fonts/weird.xyz")')
    expect(r.css).not.toMatch(/url\("\/fonts\/weird\.xyz"\)\s+format/)
  })

  test('multiple src URLs render as one src: list', () => {
    const r = font({
      family: 'Legacy',
      src: ['/fonts/x.woff2', '/fonts/x.woff'],
    })
    expect(r.css).toContain(
      'url("/fonts/x.woff2") format("woff2"), url("/fonts/x.woff") format("woff")',
    )
  })

  test('weight accepts string for variable fonts', () => {
    const r = font({ family: 'V', src: '/x.woff2', weight: '100 900' })
    expect(r.css).toContain('font-weight: 100 900')
  })

  test('style: italic + custom font-display', () => {
    const r = font({
      family: 'F',
      src: '/x.woff2',
      style: 'italic',
      display: 'optional',
    })
    expect(r.css).toContain('font-style: italic')
    expect(r.css).toContain('font-display: optional')
  })

  test('unicode-range emitted when set', () => {
    const r = font({
      family: 'F',
      src: '/x.woff2',
      unicodeRange: 'U+0000-00FF, U+0131',
    })
    expect(r.css).toContain('unicode-range: U+0000-00FF, U+0131;')
  })

  test('preload: false (default) emits no head entries', () => {
    const r = font({ family: 'F', src: '/x.woff2' })
    expect(r.head).toEqual([])
  })

  test('preload: true emits one <link rel="preload" as="font" crossorigin>', () => {
    const r = font({
      family: 'F',
      src: '/fonts/Inter.woff2',
      preload: true,
    })
    expect(r.head).toHaveLength(1)
    expect(r.head[0]).toEqual({
      tag: 'link',
      rel: 'preload',
      href: '/fonts/Inter.woff2',
      as: 'font',
      crossorigin: 'anonymous',
      type: 'font/woff2',
    })
  })

  test('preload uses the FIRST src URL when multiple are given', () => {
    const r = font({
      family: 'F',
      src: ['/x.woff2', '/x.woff'],
      preload: true,
    })
    expect(r.head[0]).toMatchObject({ href: '/x.woff2' })
  })

  test('escapes quotes / backslashes in family name (CSS injection safety)', () => {
    const r = font({
      family: 'Evil"; @import "x.css',
      src: '/x.woff2',
    })
    expect(r.css).toContain(String.raw`font-family: "Evil\"; @import \"x.css";`)
    // No raw `";` that would close font-family early.
    expect(r.css).not.toContain(`Evil";`)
  })

  test('escapes quotes in src URL (defense in depth)', () => {
    const r = font({ family: 'F', src: '/fonts/odd"name.woff2' })
    expect(r.css).toContain(String.raw`url("/fonts/odd\"name.woff2")`)
  })

  test('throws on empty src array', () => {
    expect(() => font({ family: 'F', src: [] })).toThrow(/at least one src/)
  })

  test('format detection ignores query strings + hashes', () => {
    const r = font({ family: 'F', src: '/x.woff2?v=2#frag' })
    expect(r.css).toContain('format("woff2")')
  })
})

describe('fonts() — combine multiple font definitions', () => {
  test('combines two fonts into one styles + head bundle', () => {
    const f = fonts(
      {
        family: 'Inter',
        src: '/fonts/Inter-400.woff2',
        weight: 400,
        preload: true,
      },
      {
        family: 'Inter',
        src: '/fonts/Inter-700.woff2',
        weight: 700,
      },
    )
    // Both @font-face rules are in the inline CSS.
    expect(typeof f.styles).toBe('object')
    expect((f.styles as { inline: string }).inline).toContain('font-weight: 400')
    expect((f.styles as { inline: string }).inline).toContain('font-weight: 700')
    // Only the first opted into preload, so one head entry.
    expect(f.head).toHaveLength(1)
    expect(f.head[0]).toMatchObject({ href: '/fonts/Inter-400.woff2' })
  })

  test('empty fonts() call returns empty bundle', () => {
    const f = fonts()
    expect((f.styles as { inline: string }).inline).toBe('')
    expect(f.head).toEqual([])
  })

  test('@font-face rules separated by blank line for readability', () => {
    const f = fonts({ family: 'A', src: '/a.woff2' }, { family: 'B', src: '/b.woff2' })
    const css = (f.styles as { inline: string }).inline
    expect(css).toMatch(/}\n\n@font-face/)
  })
})
