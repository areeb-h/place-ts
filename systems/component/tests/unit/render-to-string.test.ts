// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { state } from '../../../reactivity/src/index.ts'
import { component, div, el, renderToString, span } from '../../src/index.ts'

// renderToString output now includes `data-h="<seq>"` hydration markers
// on every element (DFS order, reset per-render). The marker is a
// stable contract — tests assert on full output WITH markers so the
// emitter shape is locked in.

describe('renderToString — SSR foundation', () => {
  test('renders a static element to HTML with hydration marker', () => {
    expect(renderToString(div({ class: 'hello' }, ['world']))).toBe(
      '<div data-h="0" class="hello">world</div>',
    )
  })

  test('hydration markers are sequential and DFS-ordered', () => {
    expect(
      renderToString(
        div({ class: 'outer' }, [span({ class: 'inner' }, ['nested']), span({}, ['second'])]),
      ),
    ).toBe(
      '<div data-h="0" class="outer"><span data-h="1" class="inner">nested</span><span data-h="2">second</span></div>',
    )
  })

  test('hydration counter resets per renderToString call', () => {
    const a = renderToString(span({}, ['a']))
    const b = renderToString(span({}, ['b']))
    expect(a).toBe('<span data-h="0">a</span>')
    expect(b).toBe('<span data-h="0">b</span>')
  })

  test('renders the current value of a reactive binding (snapshot at render time)', () => {
    const count = state(42)
    const view = div({ class: 'count' }, [() => String(count())])
    expect(renderToString(view)).toBe('<div data-h="0" class="count">42</div>')
  })

  test('renders a component', () => {
    const Greeting = component<{ name: string }>((p) => span({ class: 'g' }, [`hi, ${p.name}`]))
    expect(renderToString(Greeting({ name: 'alice' }))).toBe(
      '<span data-h="0" class="g">hi, alice</span>',
    )
  })

  test('renders attributes including booleans correctly', () => {
    const view = el('input', { type: 'text', disabled: true, name: 'x' })
    const html = renderToString(view)
    expect(html).toContain(' disabled')
    expect(html).toContain(' type="text"')
    expect(html).toContain(' name="x"')
    // Void element — no closing tag
    expect(html).not.toContain('</input>')
  })

  test('escapes HTML in text children to prevent injection', () => {
    const html = renderToString(div({}, ['<script>alert("xss")</script>']))
    expect(html).toBe('<div data-h="0">&lt;script&gt;alert("xss")&lt;/script&gt;</div>')
  })

  test('escapes attribute values', () => {
    const html = renderToString(div({ title: 'a "b" & <c>' }, ['x']))
    expect(html).toBe('<div data-h="0" title="a &quot;b&quot; &amp; <c>">x</div>')
  })

  test('skips event listeners (they have no HTML representation)', () => {
    const html = renderToString(div({ class: 'btn', onClick: () => {} }, ['click']))
    expect(html).toBe('<div data-h="0" class="btn">click</div>')
    expect(html).not.toContain('onClick')
  })

  test('renderToString works WITHOUT a DOM (toHtml is the fast path)', () => {
    const realDoc = globalThis.document
    // biome-ignore lint/suspicious/noExplicitAny: deliberately stripping document
    ;(globalThis as any).document = undefined
    try {
      // Views from el() / Fragment / component() implement toHtml, so
      // they render with no DOM. This is the Bun-direct SSR path.
      expect(renderToString(div({ class: 'a' }, ['x']))).toBe('<div data-h="0" class="a">x</div>')
    } finally {
      globalThis.document = realDoc
    }
  })

  test('renderToString throws clearly when a custom view has no toHtml AND no document', () => {
    const realDoc = globalThis.document
    // A custom View with only `mount`, no toHtml.
    const customView = {
      mount: () => () => {},
    }
    // biome-ignore lint/suspicious/noExplicitAny: deliberately stripping document
    ;(globalThis as any).document = undefined
    try {
      expect(() => renderToString(customView)).toThrow(/happy-dom/)
    } finally {
      globalThis.document = realDoc
    }
  })

  test('round-trip: renderToString output parses back to identical DOM structure', () => {
    const view = div({ class: 'a' }, [span({}, ['hello']), span({ id: 'x' }, ['world'])])
    const html = renderToString(view)
    const parser = document.createElement('div')
    parser.innerHTML = html
    expect(parser.children.length).toBe(1)
    const outer = parser.children[0] as HTMLDivElement
    expect(outer.className).toBe('a')
    expect(outer.children.length).toBe(2)
    expect(outer.children[0]?.textContent).toBe('hello')
    expect(outer.children[1]?.id).toBe('x')
    expect(outer.children[1]?.textContent).toBe('world')
  })
})
