// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { renderToString } from '@place/component'
import { Copy } from '../../src/Copy.tsx'

describe('Copy — generic click-to-copy primitive', () => {
  test('renders a button with default labels; runtime is emitted by renderPage', () => {
    const html = renderToString(Copy({ text: 'hello' }))
    expect(html).toContain('<button')
    expect(html).toContain('data-place-copy=""')
    expect(html).toContain('data-state="idle"')
    expect(html).toContain('data-copy-idle')
    expect(html).toContain('data-copy-done')
    expect(html).toContain('copy')
    expect(html).toContain('copied')
    // The inline copy runtime is emitted by `renderPage` (not by
    // `<Copy>` itself) so strict-CSP pages can apply the per-request
    // nonce. Component output is just the button + flag mark.
    expect(html).not.toContain('__placeCopy')
  })

  test('text is URL-encoded into the data attribute', () => {
    const code = `const s = "hello\nworld"`
    const html = renderToString(Copy({ text: code }))
    expect(html).toContain(`data-place-copy-text="${encodeURIComponent(code)}"`)
  })

  test('custom idleLabel / copiedLabel override defaults', () => {
    const html = renderToString(Copy({ text: 'x', idleLabel: '⎘', copiedLabel: '✓' }))
    expect(html).toContain('⎘')
    expect(html).toContain('✓')
    expect(html).not.toContain('>copy<')
  })

  test('children override the idle/copied labels (consumer owns content)', () => {
    const html = renderToString(
      Copy({ text: 'x', children: 'Custom button text' }),
    )
    expect(html).toContain('Custom button text')
    // No default data-copy-idle / done spans when children provided.
    expect(html).not.toContain('data-copy-idle')
    expect(html).not.toContain('data-copy-done')
  })

  test('class prop merges onto the button', () => {
    const html = renderToString(Copy({ text: 'x', class: 'my-btn' }))
    expect(html).toMatch(/<button[^>]*class="my-btn"/)
  })

  test('aria-label has a sensible default and can be overridden', () => {
    const def = renderToString(Copy({ text: 'x' }))
    expect(def).toContain('aria-label="Copy to clipboard"')
    const cust = renderToString(Copy({ text: 'x', 'aria-label': 'Copy install command' }))
    expect(cust).toContain('aria-label="Copy install command"')
  })
})
