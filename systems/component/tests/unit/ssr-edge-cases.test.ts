// @vitest-environment happy-dom

// Comprehensive SSR + hydration edge-case tests. Goal: surface every
// bug in the toHtml / handler / renderToStream / hydrate pipeline
// before we ship the DX layer on top. If anything in this file fails,
// the bug is in the SSR foundation, not the test.

import { describe, expect, test } from 'vitest'
import { state } from '../../../reactivity/src/index.ts'
import {
  button,
  type Child,
  component,
  div,
  el,
  errorBoundary,
  Fragment,
  handler,
  hydrate,
  keyed,
  renderToString,
  span,
} from '../../src/index.ts'

const ssrInto = (html: string): HTMLElement => {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

// =====================================================================
// String emitter: void/self-closing elements, empty bodies, escaping
// =====================================================================

describe('SSR string emitter — void elements + empty bodies', () => {
  test('void elements (br, hr, img, input, meta, link) have no closing tag', () => {
    expect(renderToString(el('br'))).toBe('<br data-h="0">')
    expect(renderToString(el('hr'))).toBe('<hr data-h="0">')
    expect(renderToString(el('img', { src: '/x.png', alt: 'x' }))).toBe(
      '<img data-h="0" src="/x.png" alt="x">',
    )
    expect(renderToString(el('input', { type: 'text', value: 'hi' }))).toBe(
      '<input data-h="0" type="text" value="hi">',
    )
  })

  test('empty element renders open + close tags with no body', () => {
    expect(renderToString(div({}))).toBe('<div data-h="0"></div>')
    expect(renderToString(span({ class: 'x' }))).toBe('<span data-h="0" class="x"></span>')
  })

  test('null / undefined / false children render nothing', () => {
    expect(renderToString(div({}, [null, undefined, false, 'visible']))).toBe(
      '<div data-h="0">visible</div>',
    )
  })

  test('nested arrays of children flatten correctly', () => {
    const children: Child[] = ['a', 'b', 'c', span({}, ['d']), span({}, ['e'])]
    expect(renderToString(div({}, children))).toBe(
      '<div data-h="0">abc<span data-h="1">d</span><span data-h="2">e</span></div>',
    )
  })

  test('Fragment renders without a wrapping element and does NOT consume a marker', () => {
    expect(
      renderToString(
        Fragment({ children: [span({ class: 'a' }, ['1']), span({ class: 'b' }, ['2'])] }),
      ),
    ).toBe('<span data-h="0" class="a">1</span><span data-h="1" class="b">2</span>')
  })
})

// =====================================================================
// keyed list — SSR + hydration support
// =====================================================================

describe('SSR string emitter — keyed lists', () => {
  test('keyed() renders each item via its View and concatenates', () => {
    const items = state([
      { id: 'a', label: 'apple' },
      { id: 'b', label: 'banana' },
    ])
    const view = div({ class: 'list' }, [
      keyed(
        items.read,
        (it) => it.id,
        (it) => span({ class: 'item' }, [it.label]),
      ),
    ])
    expect(renderToString(view)).toBe(
      '<div data-h="0" class="list"><span data-h="1" class="item">apple</span><span data-h="2" class="item">banana</span></div>',
    )
  })

  test('keyed() with an empty list renders nothing inside', () => {
    const items = state<Array<{ id: string }>>([])
    const view = div({}, [
      keyed(
        items.read,
        (it) => it.id,
        () => span({}, ['x']),
      ),
    ])
    expect(renderToString(view)).toBe('<div data-h="0"></div>')
  })
})

// =====================================================================
// errorBoundary — SSR + hydration support
// =====================================================================

describe('SSR string emitter — errorBoundary', () => {
  test('errorBoundary renders children when they do not throw', () => {
    const view = errorBoundary({
      fallback: () => span({ class: 'err' }, ['caught']),
      children: span({ class: 'ok' }, ['fine']),
    })
    expect(renderToString(view)).toBe('<span data-h="0" class="ok">fine</span>')
  })

  test('errorBoundary renders fallback when children throw during render', () => {
    const Throwy = component(() => {
      throw new Error('boom')
    })
    const view = errorBoundary({
      fallback: (e) => span({ class: 'err' }, [(e as Error).message]),
      children: Throwy({}),
    })
    expect(renderToString(view)).toBe('<span data-h="0" class="err">boom</span>')
  })
})

// =====================================================================
// HTML escaping — security
// =====================================================================

describe('SSR string emitter — XSS / escaping', () => {
  test('script-injection in text is escaped', () => {
    const html = renderToString(div({}, ['<script>alert("xss")</script>']))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  test('quote-injection in attributes is escaped (cannot break out of attribute value)', () => {
    const html = renderToString(div({ title: '" onmouseover="alert(1)"', class: 'x' }))
    // The injection's `"` characters become `&quot;` so the attr stays
    // closed correctly. The literal string "onmouseover=" appears
    // INSIDE the title value (harmless), but no real onmouseover handler
    // can be created.
    expect(html).toContain('&quot;')
    expect(html).toContain('title="&quot; onmouseover=&quot;alert(1)&quot;"')
    // Sanity: the next attribute (class) is still on this element, not
    // a sibling that would have been injected if the escape failed.
    expect(html.match(/class="x"/g)?.length).toBe(1)
  })

  test('& in text and attrs is escaped to &amp;', () => {
    const html = renderToString(div({ title: 'a & b' }, ['c & d']))
    expect(html).toContain('title="a &amp; b"')
    expect(html).toContain('>c &amp; d<')
  })
})

// =====================================================================
// Streaming: error handling
// =====================================================================

describe('renderToStream — error handling', () => {
  test('a route that throws returns 500 plain text from handler', async () => {
    const ssr = handler(
      () => {
        throw new Error('boom')
      },
      { stream: true },
    )
    const res = await ssr(new Request('http://x/'))
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('boom')
  })

  test('renderToString of a custom view without toHtml in no-DOM env throws cleanly', () => {
    // Simulate the Bun-SSR "no document" case.
    const realDoc = globalThis.document
    // biome-ignore lint/suspicious/noExplicitAny: deliberately strip
    ;(globalThis as any).document = undefined
    try {
      // Custom View with mount but no toHtml — falls through to the
      // happy-dom path, which can't run without `document`.
      expect(() => renderToString({ mount: () => () => {} })).toThrow(/happy-dom/)
    } finally {
      globalThis.document = realDoc
    }
  })
})

// =====================================================================
// Hydration: the gnarly bit
// =====================================================================

describe('hydrate — nested element identity', () => {
  test('nested element children are ADOPTED (V0 may currently clear them)', () => {
    // This is an aspirational test — V0 of hydrate clears + remounts.
    // If/when we improve children-hydration to adopt element children,
    // this will start passing without further changes.
    const view = () =>
      div({ class: 'outer' }, [span({ class: 'a' }, ['1']), span({ class: 'b' }, ['2'])])
    const root = ssrInto(renderToString(view()))
    const outer = root.firstElementChild as HTMLElement
    const innerA = outer.children[0] as HTMLElement
    const innerB = outer.children[1] as HTMLElement
    hydrate(view(), root)
    // Outer adopted (already verified elsewhere); now check inner.
    expect(root.firstElementChild?.children[0]).toBe(innerA)
    expect(root.firstElementChild?.children[1]).toBe(innerB)
  })

  test('hydration of nested view + reactive class binding updates the existing node', () => {
    const isError = state(false)
    const view = () =>
      div({ class: 'outer' }, [
        span({ class: () => (isError() ? 'inner-err' : 'inner-ok') }, ['inner']),
      ])
    const root = ssrInto(renderToString(view()))
    const innerSpan = (root.firstElementChild as HTMLElement).firstElementChild as HTMLElement
    expect(innerSpan.className).toBe('inner-ok')
    hydrate(view(), root)
    isError.set(true)
    expect(innerSpan.className).toBe('inner-err')
    // (innerSpan is the SAME node — proves adoption preserved identity)
  })

  test('hydration of empty <div></div> works', () => {
    const root = ssrInto(renderToString(div({ class: 'empty' })))
    const node = root.firstElementChild as HTMLElement
    hydrate(div({ class: 'empty' }), root)
    expect(root.firstElementChild).toBe(node)
    expect(node.className).toBe('empty')
  })

  test('hydration of self-closing input adopts the input + binds value', () => {
    const root = ssrInto(renderToString(el('input', { type: 'text', name: 'q' })))
    const node = root.firstElementChild as HTMLInputElement
    expect(node.tagName).toBe('INPUT')
    hydrate(el('input', { type: 'text', name: 'q' }), root)
    expect(root.firstElementChild).toBe(node)
  })

  test('hydration of a Fragment containing multiple element children adopts each', () => {
    const root = ssrInto(
      renderToString(Fragment({ children: [span({ class: 'a' }), span({ class: 'b' })] })),
    )
    const a = root.children[0] as HTMLElement
    const b = root.children[1] as HTMLElement
    hydrate(Fragment({ children: [span({ class: 'a' }), span({ class: 'b' })] }), root)
    expect(root.children[0]).toBe(a)
    expect(root.children[1]).toBe(b)
  })
})

// =====================================================================
// End-to-end: SSR → parse → hydrate → click
// =====================================================================

describe('SSR + hydrate end-to-end', () => {
  test('counter app: SSR renders initial state, hydrate makes it interactive', () => {
    const count = state(0)
    const App = () =>
      div({ class: 'counter' }, [
        button({ class: 'inc', onClick: () => count.update((c) => c + 1) }, ['+1']),
        span({ class: 'value' }, [() => String(count())]),
      ])

    // Server renders into HTML (count = 0)
    const html = renderToString(App())
    expect(html).toContain('<span data-h="2" class="value">0</span>')

    // Client receives HTML, hydrates
    const root = ssrInto(html)
    hydrate(App(), root)

    // Click increments + reactive child updates
    const btn = root.querySelector('.inc') as HTMLButtonElement
    btn.click()
    btn.click()
    expect(count()).toBe(2)
    expect(root.querySelector('.value')?.textContent).toBe('2')
  })

  test('full doctype shell + hydrate against parsed body', async () => {
    const view = () => div({ class: 'app' }, ['hello'])
    const ssr = handler(view)
    const res = await ssr(new Request('http://x/'))
    const fullHtml = await res.text()
    expect(fullHtml.startsWith('<!doctype html>')).toBe(true)
    // Extract the body fragment by parsing.
    const doc = new DOMParser().parseFromString(fullHtml, 'text/html')
    const root = doc.body
    hydrate(view(), root)
    expect(root.firstElementChild?.className).toBe('app')
  })
})
