// @vitest-environment node
//
// DX helpers added in the polish round:
//   - <Img> as a real View factory (not just a string emitter)
//   - <Suspense> JSX wrapper around suspense()
//   - css`...` template tag → StyleSrc
//   - cssMedia('print', `...`) → media-scoped StyleSrc
//   - shape({...}) input validator for action()
//   - renderToHtml(page, opts) test helper
//
// Each helper is small and orthogonal; tests verify the contract.

import { describe, expect, test } from 'vitest'
import { resource } from '../../../reactivity/src/index.ts'
import {
  action,
  css,
  cssMedia,
  div,
  Img,
  page,
  renderToHtml,
  renderToString,
  Suspense,
  shape,
  span,
} from '../../src/index.ts'

describe('Img — JSX-friendly image View', () => {
  test('returns a View whose toHtml() produces <picture> + <source> + <img>', () => {
    const view = Img({ src: '/cover.jpg', alt: 'Cover', widths: [400, 800] })
    const html = renderToString(view)
    expect(html).toContain('<picture')
    expect(html).toContain('<source')
    expect(html).toContain('<img')
    expect(html).toContain('alt="Cover"')
  })

  test('format !== "auto" skips the <picture> wrapper', () => {
    const view = Img({ src: '/x.jpg', alt: 'x', format: 'jpeg' })
    const html = renderToString(view)
    expect(html).not.toContain('<picture')
    expect(html).toContain('<img')
  })

  test('lazy + async are on by default; opt out via false', () => {
    const eager = Img({ src: '/x.jpg', alt: 'x', format: 'jpeg', lazy: false, async: false })
    const html = renderToString(eager)
    expect(html).not.toContain('loading="lazy"')
    expect(html).not.toContain('decoding="async"')
  })

  test('width/height attributes ride along to prevent layout shift', () => {
    const view = Img({
      src: '/x.jpg',
      alt: 'x',
      format: 'jpeg',
      width: 800,
      height: 600,
    })
    const html = renderToString(view)
    expect(html).toContain('width="800"')
    expect(html).toContain('height="600"')
  })

  test('escapes attribute-breaking chars in alt (XSS safety)', () => {
    // The real attribute-escape risks: a literal `"` would close the
    // alt attribute early and let the attacker inject a new attribute.
    // `&` ambiguity is also escaped. `<` / `>` inside a quoted attribute
    // value are NOT executed by browsers — they're treated as literal
    // text — so escaping them isn't required for safety.
    const view = Img({
      src: '/x.jpg',
      alt: 'evil" onerror=alert(1) "',
      format: 'jpeg',
    })
    const html = renderToString(view)
    // Quote escaped → no early closure of alt="..." attribute.
    expect(html).toContain('alt="evil&quot; onerror=alert(1) &quot;"')
    expect(html).not.toContain('alt="evil"')
  })

  test('the View can be composed into other JSX (parent + Img)', () => {
    const view = div({ class: 'gallery' }, [
      Img({ src: '/a.jpg', alt: 'A', format: 'jpeg' }),
      Img({ src: '/b.jpg', alt: 'B', format: 'jpeg' }),
    ])
    const html = renderToString(view)
    expect(html).toContain('class="gallery"')
    // Two img tags inside.
    const imgCount = (html.match(/<img/g) ?? []).length
    expect(imgCount).toBe(2)
  })
})

describe('Suspense — JSX wrapper around suspense()', () => {
  test('static View children work without function-as-children dance', () => {
    // Resource is already ready, so children render directly.
    const r = resource(async () => 'value')
    return r.refresh().then(() => {
      const view = Suspense({
        fallback: span({}, ['loading']),
        on: [r],
        children: span({ class: 'real' }, ['content']),
      })
      const html = renderToString(view)
      expect(html).toContain('class="real"')
      expect(html).toContain('content')
    })
  })

  test('function children work for reactive re-evaluation', async () => {
    const r = resource(async () => 'v')
    await r.refresh()
    const view = Suspense({
      fallback: span({}, ['fb']),
      on: [r],
      children: () => span({}, [`got: ${r()}`]),
    })
    const html = renderToString(view)
    expect(html).toContain('got: v')
  })

  test('pending resource: fallback rendered (sync render path)', () => {
    // Never-resolving resource keeps status='loading'.
    const r = resource(() => new Promise<string>(() => {}))
    const view = Suspense({
      fallback: span({ class: 'fb' }, ['loading']),
      on: [r],
      children: span({}, ['real']),
    })
    const html = renderToString(view)
    expect(html).toContain('class="fb"')
    expect(html).not.toContain('>real<')
  })
})

describe('css — tagged-template StyleSrc helper', () => {
  test('plain CSS round-trips through css`...` to { inline }', () => {
    const s = css`
      body { margin: 0; }
    `
    expect(s).toEqual({
      inline: '\n      body { margin: 0; }\n    ',
    })
  })

  test('interpolation: primitive values are stringified', () => {
    const color = '#fafafa'
    const radius = 4
    const s = css`
      .card { background: ${color}; border-radius: ${radius}px; }
    ` as { inline: string }
    expect(s.inline).toContain('background: #fafafa')
    expect(s.inline).toContain('border-radius: 4px')
  })

  test('null/undefined interpolations become empty string (no "null" literal)', () => {
    const missing = null
    const undef = undefined
    const s = css`a { color: ${missing}; b { x: ${undef}; }` as { inline: string }
    expect(s.inline).not.toContain('null')
    expect(s.inline).not.toContain('undefined')
  })

  test('cssMedia attaches the media attribute (curried tagged template)', () => {
    const s = cssMedia('print')`body { color: black; }` as {
      inline: string
      media: string
    }
    expect(s.media).toBe('print')
    expect(s.inline).toContain('color: black')
  })

  test('css drops directly into page({ styles })', async () => {
    const home = page({
      styles: css`
        h1 { font-size: 2rem; }
      `,
      view: () => div({}, [span({}, ['x'])]),
    })
    const html = await renderToHtml(home)
    expect(html).toContain('h1 { font-size: 2rem')
    // Wrapped in a <style> block (not <link>).
    expect(html).toMatch(/<style[^>]*>[\s\S]*?h1/)
  })
})

describe('shape() — built-in object validator for action()', () => {
  test('validates the common case: object with string/number/boolean fields', () => {
    const v = shape({ id: 'string', count: 'number', active: 'boolean' })
    expect(v({ id: 'x', count: 7, active: true })).toEqual({
      id: 'x',
      count: 7,
      active: true,
    })
  })

  test('throws on missing required field with the field name', () => {
    const v = shape({ id: 'string' })
    expect(() => v({})).toThrow(/missing required field 'id'/)
  })

  test('throws on un-coercible string for a number field', () => {
    // shape() auto-coerces strings → number for declared 'number' fields
    // (FormData values are always strings; coercion closes the no-JS gap).
    // Strings that fail coercion still throw — but with a sharper message.
    const v = shape({ count: 'number' })
    expect(() => v({ count: 'seven' })).toThrow(/cannot coerce 'seven' to number/)
  })

  test('coerces numeric strings to numbers (FormData input path)', () => {
    const v = shape({ count: 'number', active: 'boolean' })
    // Numbers and booleans coerced from FormData strings.
    expect(v({ count: '42', active: 'true' })).toEqual({ count: 42, active: true })
    expect(v({ count: '3.14', active: 'on' })).toEqual({ count: 3.14, active: true })
    // Pre-typed values still pass through.
    expect(v({ count: 7, active: false })).toEqual({ count: 7, active: false })
  })

  test('rejects type-mismatch when coercion does not apply (e.g. object for number)', () => {
    const v = shape({ count: 'number' })
    expect(() => v({ count: { foo: 'bar' } })).toThrow(/expected number, got object/)
  })

  test('optional fields (suffix `?`) accept undefined/null', () => {
    const v = shape({ id: 'string', count: 'number?' })
    expect(v({ id: 'x' })).toEqual({ id: 'x', count: undefined })
    expect(v({ id: 'x', count: 5 })).toEqual({ id: 'x', count: 5 })
  })

  test('rejects non-object inputs', () => {
    const v = shape({ id: 'string' })
    expect(() => v(null)).toThrow(/expected an object/)
    expect(() => v([])).toThrow(/expected an object/)
    expect(() => v('string')).toThrow(/expected an object/)
  })

  test('plugs into action() — runtime validation works', async () => {
    // TS inference from `input` to `fn`'s param: when both fields are
    // declared together, TS sometimes binds the destructured `fn` param
    // type before `input`'s ActionSchema<I> resolves. Pre-binding the
    // validator to a typed const flows the inference through cleanly.
    type Likes = { id: string; count: number | undefined }
    const validator = shape({ id: 'string', count: 'number?' })
    const a = action({
      path: 'POST /api/like',
      input: validator,
      fn: (input: Likes) => ({ id: input.id, count: input.count ?? 0 }),
    })
    const handler = a.handler['POST /api/like']
    if (!handler) throw new Error('test: handler not found')
    const res = await handler(
      new Request('http://x/api/like', {
        method: 'POST',
        body: JSON.stringify({ id: 'abc' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      {},
    )
    expect(await res.json()).toEqual({ id: 'abc', count: 0 })
  })
})

describe('renderToHtml — page test helper', () => {
  test('renders a Page to its HTML string with sensible defaults', async () => {
    const home = page({
      view: () => div({ class: 'h' }, ['hello']),
      meta: { title: 'home' },
    })
    const html = await renderToHtml(home)
    expect(html).toContain('<title>home</title>')
    expect(html).toContain('class="h"')
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })

  test('url option flows into the page url() function', async () => {
    const greet = page({
      url: (u) => ({ name: u.searchParams.get('name') ?? 'visitor' }),
      view: ({ name }) => span({}, [`hi, ${name}`]),
    })
    const html = await renderToHtml(greet, { url: 'http://x/?name=alice' })
    expect(html).toContain('hi, alice')
  })

  test('params option flows into page url()/load() ctx', async () => {
    const user = page({
      url: (_u, params) => ({ id: params['id'] ?? 'none' }),
      view: ({ id }) => span({}, [`user:${id}`]),
    })
    const html = await renderToHtml(user, { params: { id: '42' } })
    expect(html).toContain('user:42')
  })
})
