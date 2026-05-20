// @vitest-environment happy-dom

import { renderToString } from '@place/component'
import { state } from '@place/reactivity'
import { describe, expect, test } from 'vitest'
import { Disclosure } from '../../src/Disclosure.tsx'

describe('Disclosure — render + native <details> shape', () => {
  test('emits <details> + <summary> with the place-disclosure marker', () => {
    const html = renderToString(Disclosure({ summary: 'Q1', children: 'A1' }))
    expect(html).toContain('<details')
    expect(html).toContain('place-disclosure')
    expect(html).toContain('<summary')
    expect(html).toContain('Q1')
    expect(html).toContain('A1')
  })

  test('defaultOpen=true ships the [open] attribute', () => {
    const html = renderToString(Disclosure({ summary: 'x', defaultOpen: true, children: 'y' }))
    // The framework serializes `open={true}` → `open=""` per HTML boolean attrs.
    expect(html).toMatch(/<details[^>]*\sopen(=""|=" "|>|\s)/)
  })

  test('defaultOpen omitted → no [open] attribute (default closed)', () => {
    const html = renderToString(Disclosure({ summary: 'x', children: 'y' }))
    expect(html).not.toMatch(/<details[^>]*\sopen[=>\s]/)
  })

  test('name prop wires the exclusive-accordion attribute', () => {
    const html = renderToString(Disclosure({ summary: 'x', name: 'faq', children: 'y' }))
    expect(html).toContain('name="faq"')
  })

  test('chevron={true} (default) renders the rotating chevron span', () => {
    const html = renderToString(Disclosure({ summary: 'x', children: 'y' }))
    expect(html).toContain('place-disclosure-chevron')
    // Default chevron uses an inline SVG.
    expect(html).toContain('<svg')
  })

  test('chevron={false} omits the chevron span entirely', () => {
    const html = renderToString(Disclosure({ summary: 'x', chevron: false, children: 'y' }))
    expect(html).not.toContain('place-disclosure-chevron')
  })
})

describe('Disclosure — variants', () => {
  test('size variants drive summary + content padding', () => {
    const sm = renderToString(Disclosure({ summary: 'x', size: 'sm', children: 'y' }))
    const lg = renderToString(Disclosure({ summary: 'x', size: 'lg', children: 'y' }))
    expect(sm).toContain('px-3 py-2')
    expect(lg).toContain('px-5 py-4')
  })

  test('intent=accent adds accent border', () => {
    const html = renderToString(Disclosure({ summary: 'x', intent: 'accent', children: 'y' }))
    expect(html).toContain('border-accent/50')
  })
})

describe('Disclosure — customization contract', () => {
  test('class prop adds onto root <details> element', () => {
    const html = renderToString(Disclosure({ summary: 'x', class: 'my-custom', children: 'y' }))
    expect(html).toContain('my-custom')
  })

  test('classNames.summary adds onto the <summary> element', () => {
    const html = renderToString(
      Disclosure({
        summary: 'x',
        classNames: { summary: 'bg-accent/10' },
        children: 'y',
      }),
    )
    expect(html).toContain('bg-accent/10')
  })

  test('classNames.content adds onto the body wrapper', () => {
    const html = renderToString(
      Disclosure({
        summary: 'x',
        classNames: { content: 'space-y-2' },
        children: 'y',
      }),
    )
    expect(html).toContain('space-y-2')
  })

  test('classNames.chevron threads onto the chevron span', () => {
    const html = renderToString(
      Disclosure({
        summary: 'x',
        classNames: { chevron: 'text-accent' },
        children: 'y',
      }),
    )
    expect(html).toContain('text-accent')
  })
})

describe('Disclosure — controlled open + onToggle', () => {
  test('open signal value drives the initial [open] attribute', () => {
    const sig = state(true)
    const html = renderToString(Disclosure({ summary: 'x', open: sig, children: 'y' }))
    expect(html).toMatch(/<details[^>]*\sopen(=""|=" "|>|\s)/)
  })

  test('open signal value=false ships closed', () => {
    const sig = state(false)
    const html = renderToString(Disclosure({ summary: 'x', open: sig, children: 'y' }))
    expect(html).not.toMatch(/<details[^>]*\sopen[=>\s]/)
  })
})

describe('Disclosure.Group', () => {
  test('renders a vertical-stack wrapper around children', () => {
    const html = renderToString(
      Disclosure.Group({
        children: [
          Disclosure({ summary: 'A', name: 'faq', children: 'a' }),
          Disclosure({ summary: 'B', name: 'faq', children: 'b' }),
        ],
      }),
    )
    expect(html).toContain('flex flex-col gap-2')
    expect(html).toContain('>A<')
    expect(html).toContain('>B<')
    expect(html).toContain('name="faq"')
  })
})
