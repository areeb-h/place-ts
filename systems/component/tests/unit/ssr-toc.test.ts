// SSR-side heading extraction + island-marker patch — string-surgery
// helpers that the framework runs after a page body is rendered. The
// tests anchor on the contract documented in `ssr-toc.ts`:
//   - h2/h3 in `<main>` get scanned, slugged, id-injected
//   - duplicate slugs get numeric suffixes
//   - existing ids are preserved
//   - h2/h3 outside `<main>` (e.g. in `<aside>`) are ignored
//   - patchIslandMarker rewrites inner HTML + merges props

import { describe, expect, test } from 'vitest'
import { extractMainHeadings, patchIslandMarker, slugifyHeading } from '../../src/ssr-toc.ts'

describe('slugifyHeading', () => {
  test('lowercases + replaces non-alphanumerics with single dashes', () => {
    expect(slugifyHeading('Hello, World!')).toBe('hello-world')
  })
  test('strips leading + trailing dashes', () => {
    expect(slugifyHeading('  --foo bar  ')).toBe('foo-bar')
  })
  test('collapses adjacent non-alphanumerics', () => {
    expect(slugifyHeading('a—b/c__d')).toBe('a-b-c-d')
  })
  test('returns empty string when no alphanumerics', () => {
    expect(slugifyHeading('!@#$%^&*()')).toBe('')
  })
})

describe('extractMainHeadings', () => {
  test('returns empty when no <main>', () => {
    const html = '<div><h2>Inside aside</h2></div>'
    const { html: out, headings } = extractMainHeadings(html)
    expect(out).toBe(html)
    expect(headings).toEqual([])
  })

  test('extracts h2 + h3 inside <main>, injects ids, preserves order', () => {
    const html = '<main><h2>Intro</h2><p>x</p><h3>Detail</h3></main>'
    const { html: out, headings } = extractMainHeadings(html)
    expect(headings).toEqual([
      { id: 'intro', text: 'Intro', level: 2 },
      { id: 'detail', text: 'Detail', level: 3 },
    ])
    expect(out).toContain('<h2 id="intro">Intro</h2>')
    expect(out).toContain('<h3 id="detail">Detail</h3>')
  })

  test('ignores h2/h3 outside <main>', () => {
    const html = '<aside><h2>Sidebar Title</h2></aside><main><h2>Real Title</h2></main>'
    const { headings } = extractMainHeadings(html)
    expect(headings.map((h) => h.text)).toEqual(['Real Title'])
  })

  test('preserves an existing id without rewriting', () => {
    const html = '<main><h2 id="custom-anchor">Heading</h2></main>'
    const { html: out, headings } = extractMainHeadings(html)
    expect(headings).toEqual([{ id: 'custom-anchor', text: 'Heading', level: 2 }])
    // The tag is written through unchanged — id="custom-anchor" stays
    // exactly where the page put it.
    expect(out).toContain('<h2 id="custom-anchor">Heading</h2>')
  })

  test('disambiguates duplicate slugs with numeric suffix', () => {
    const html = '<main><h2>Setup</h2><h2>Setup</h2><h2>Setup</h2></main>'
    const { headings } = extractMainHeadings(html)
    expect(headings.map((h) => h.id)).toEqual(['setup', 'setup-2', 'setup-3'])
  })

  test('strips inner tags from text but keeps them in id-injected HTML', () => {
    const html = '<main><h2>Hello <code>world</code></h2></main>'
    const { html: out, headings } = extractMainHeadings(html)
    expect(headings).toEqual([{ id: 'hello-world', text: 'Hello world', level: 2 }])
    // Inner HTML preserved verbatim.
    expect(out).toContain('<h2 id="hello-world">Hello <code>world</code></h2>')
  })

  test('decodes basic entities in extracted text', () => {
    const html = '<main><h2>Foo &amp; Bar</h2></main>'
    const { headings } = extractMainHeadings(html)
    expect(headings[0]?.text).toBe('Foo & Bar')
    expect(headings[0]?.id).toBe('foo-bar')
  })

  test('skips empty headings', () => {
    const html = '<main><h2></h2><h2>Real</h2></main>'
    const { headings } = extractMainHeadings(html)
    expect(headings.map((h) => h.text)).toEqual(['Real'])
  })

  test('preserves existing attributes when injecting id', () => {
    const html = '<main><h2 class="big">Title</h2></main>'
    const { html: out } = extractMainHeadings(html)
    expect(out).toContain('<h2 id="title" class="big">Title</h2>')
  })

  test('handles <main> with attributes', () => {
    const html = '<main class="prose" role="main"><h2>Section</h2></main>'
    const { headings } = extractMainHeadings(html)
    expect(headings).toEqual([{ id: 'section', text: 'Section', level: 2 }])
  })
})

describe('patchIslandMarker', () => {
  test('replaces inner HTML by data-view-id', () => {
    const html = 'before<div data-view="island" data-view-id="toc"><ul></ul></div>after'
    const out = patchIslandMarker(html, 'toc', '<ul><li>x</li></ul>')
    expect(out).toBe(
      'before<div data-view="island" data-view-id="toc"><ul><li>x</li></ul></div>after',
    )
  })

  test('returns input unchanged when marker not present', () => {
    const html = '<div data-view-id="other">x</div>'
    const out = patchIslandMarker(html, 'toc', '<ul></ul>')
    expect(out).toBe(html)
  })

  test('merges propPatch into existing data-view-props', () => {
    const html = `<div data-view="island" data-view-id="toc" data-view-props='{"foo":1}'></div>`
    const out = patchIslandMarker(html, 'toc', '<span/>', {
      bar: 2,
    })
    // The attribute is single-quote-wrapped, so embedded `"` stays
    // literal (the encoder only escapes `'`, `&`, `<`). The merged
    // JSON contains both old + new keys.
    expect(out).toContain(`data-view-props='{"foo":1,"bar":2}'`)
  })

  test('adds data-view-props when previously absent', () => {
    const html = `<div data-view="island" data-view-id="toc"><x/></div>`
    const out = patchIslandMarker(html, 'toc', '<y/>', { a: 'b' })
    expect(out).toContain('data-view-props=')
  })

  test('handles nested <div> inside marker correctly', () => {
    // Marker contains a nested div — depth tracking must skip past it.
    const html = '<div data-view-id="toc"><div class="inner"><span>x</span></div></div>tail'
    const out = patchIslandMarker(html, 'toc', '<replaced/>')
    expect(out).toBe('<div data-view-id="toc"><replaced/></div>tail')
  })
})
