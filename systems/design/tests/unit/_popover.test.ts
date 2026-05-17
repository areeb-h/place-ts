// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import {
  anchorStyle,
  nextAnchorName,
  popoverStyle,
  supportsAnchorPositioning,
} from '../../src/_popover.ts'

describe('nextAnchorName', () => {
  test('produces a unique name each call with the place-anchor- prefix', () => {
    const a = nextAnchorName()
    const b = nextAnchorName()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^place-anchor-\d+$/)
    expect(b).toMatch(/^place-anchor-\d+$/)
  })
})

describe('anchorStyle', () => {
  test('emits the anchor-name CSS property with -- prefix', () => {
    expect(anchorStyle('my-anchor')).toBe('anchor-name: --my-anchor;')
  })
})

describe('popoverStyle', () => {
  test('emits the core anchor + area + fallback + inset triplet (default placement bottom-start)', () => {
    const s = popoverStyle({ anchor: 'a1' })
    expect(s).toContain('position: fixed;')
    expect(s).toContain('inset: auto;')
    expect(s).toContain('position-anchor: --a1;')
    expect(s).toContain('position-area: bottom span-right;')
    expect(s).toContain('position-try-fallbacks: flip-block, flip-inline;')
  })

  test('per-placement area + flip mapping', () => {
    // Sample a few representative pairs to confirm the encoding.
    expect(popoverStyle({ anchor: 'x', placement: 'top' })).toContain(
      'position-area: top;',
    )
    expect(popoverStyle({ anchor: 'x', placement: 'top-end' })).toContain(
      'position-area: top span-left;',
    )
    expect(popoverStyle({ anchor: 'x', placement: 'bottom-end' })).toContain(
      'position-area: bottom span-left;',
    )
    expect(popoverStyle({ anchor: 'x', placement: 'left-start' })).toContain(
      'position-area: left span-bottom;',
    )
    expect(popoverStyle({ anchor: 'x', placement: 'right-end' })).toContain(
      'position-area: right span-top;',
    )
  })

  test('flip-block first for vertical placements; flip-inline first for horizontal', () => {
    expect(popoverStyle({ anchor: 'x', placement: 'top' })).toContain(
      'position-try-fallbacks: flip-block;',
    )
    expect(popoverStyle({ anchor: 'x', placement: 'bottom' })).toContain(
      'position-try-fallbacks: flip-block;',
    )
    expect(popoverStyle({ anchor: 'x', placement: 'left' })).toContain(
      'position-try-fallbacks: flip-inline;',
    )
    expect(popoverStyle({ anchor: 'x', placement: 'right' })).toContain(
      'position-try-fallbacks: flip-inline;',
    )
  })

  test('per-side margin reflects the placement axis (gap on the side facing the anchor)', () => {
    // bottom: gap on top
    expect(popoverStyle({ anchor: 'x', placement: 'bottom-start', offset: 8 })).toContain(
      'margin: 8px 0 0 0;',
    )
    // top: gap on bottom
    expect(popoverStyle({ anchor: 'x', placement: 'top-start', offset: 8 })).toContain(
      'margin: 0 0 8px 0;',
    )
    // left: gap on right
    expect(popoverStyle({ anchor: 'x', placement: 'left', offset: 8 })).toContain(
      'margin: 0 8px 0 0;',
    )
    // right: gap on left
    expect(popoverStyle({ anchor: 'x', placement: 'right', offset: 8 })).toContain(
      'margin: 0 0 0 8px;',
    )
  })

  test('default offset is 4 when omitted', () => {
    expect(popoverStyle({ anchor: 'x', placement: 'bottom-start' })).toContain(
      'margin: 4px 0 0 0;',
    )
  })

  test('width: anchor-width emits the anchor-size() rule', () => {
    const s = popoverStyle({ anchor: 'combo-1', width: 'anchor-width' })
    expect(s).toContain('width: anchor-size(--combo-1 width);')
  })

  test('width: anchor-min-width uses min-width', () => {
    const s = popoverStyle({ anchor: 'combo-2', width: 'anchor-min-width' })
    expect(s).toContain('min-width: anchor-size(--combo-2 width);')
    // Should NOT contain a plain `width:` (word-boundary check —
    // `min-width:` ends in `width:` so a substring check would
    // false-positive).
    expect(s).not.toMatch(/(^|\s)width: /)
  })

  test('width: auto (default) omits any anchor-size rule', () => {
    const s = popoverStyle({ anchor: 'x' })
    expect(s).not.toContain('anchor-size')
  })

  test('the anchor name in position-anchor matches the name in anchor-size', () => {
    const name = 'shared-anchor'
    const ax = anchorStyle(name)
    const px = popoverStyle({ anchor: name, width: 'anchor-width' })
    expect(ax).toContain(`--${name}`)
    expect(px).toContain(`position-anchor: --${name};`)
    expect(px).toContain(`anchor-size(--${name} width)`)
  })
})

describe('supportsAnchorPositioning', () => {
  test('does not throw when CSS.supports is unavailable', () => {
    // happy-dom may or may not implement CSS.supports; either way
    // the function should return a boolean without throwing.
    expect(typeof supportsAnchorPositioning()).toBe('boolean')
  })
})
