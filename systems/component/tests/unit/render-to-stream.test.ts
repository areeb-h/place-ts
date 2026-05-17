// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { div, handler, renderToStream, span } from '../../src/index.ts'

// Helper: drain a ReadableStream<Uint8Array> into a string. Tests
// don't care about chunk boundaries (V0 emits one chunk); they care
// about cumulative output and that the API contract holds.
async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.length
  }
  return new TextDecoder().decode(merged)
}

describe('renderToStream — streaming SSR', () => {
  test('default doc shell wraps the body', async () => {
    const stream = renderToStream(div({ class: 'hi' }, ['hello']))
    const html = await readAll(stream)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<div data-h="0" class="hi">hello</div>')
    expect(html.endsWith('</body></html>')).toBe(true)
  })

  test('document: false returns the body fragment as a stream', async () => {
    const stream = renderToStream(span({}, ['x']), { document: false })
    expect(await readAll(stream)).toBe('<span data-h="0">x</span>')
  })

  test('document: function lets the caller compose the shell', async () => {
    const stream = renderToStream(span({}, ['y']), {
      document: (b) => `<html><head><title>x</title></head><body>${b}</body></html>`,
    })
    const html = await readAll(stream)
    expect(html).toContain('<title>x</title>')
    expect(html).toContain('<span data-h="0">y</span>')
  })

  test('handler with stream: true returns a Response whose body is the same HTML as buffered mode', async () => {
    const view = () => div({}, ['stream me'])
    const buffered = handler(view)
    const streamed = handler(view, { stream: true })

    const a = await (await buffered(new Request('http://x/'))).text()
    const b = await (await streamed(new Request('http://x/'))).text()
    expect(b).toBe(a)
  })

  test('large initial body is chunked into multiple ~16KB pieces (browser parses incrementally)', async () => {
    // Build a body well over the 16KB chunk size so we can observe the
    // per-chunk delivery. Each chunk should be ≤16KB.
    const big = Array.from({ length: 5000 }, (_, i) => span({}, [`item ${i} `]))
    const view = div({}, big)
    const stream = renderToStream(view, { document: false })

    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    // The total payload is well over 16KB.
    const totalBytes = chunks.reduce((n, c) => n + c.byteLength, 0)
    expect(totalBytes).toBeGreaterThan(16 * 1024)
    // We got at least 2 chunks (the chunking is working). Bun's stream
    // may further coalesce or split, but our enqueue() calls produced
    // multiple chunks.
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    // Each chunk is at most 16KB (our enqueue boundary).
    for (const c of chunks) {
      expect(c.byteLength).toBeLessThanOrEqual(16 * 1024)
    }
    // Concatenated bytes still produce valid HTML — no chunk boundary
    // corrupted the output.
    const decoder = new TextDecoder()
    let out = ''
    for (const c of chunks) out += decoder.decode(c, { stream: true })
    out += decoder.decode()
    expect(out.includes('item 0 ')).toBe(true)
    expect(out.includes('item 4999 ')).toBe(true)
    expect(out.startsWith('<div data-h="0">')).toBe(true)
    expect(out.endsWith('</div>')).toBe(true)
  })

  test('small initial body emits in a single chunk (no over-chunking)', async () => {
    const stream = renderToStream(span({}, ['tiny']), { document: false })
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    // ~25 bytes total — should be one chunk.
    expect(chunks.length).toBe(1)
  })
})
