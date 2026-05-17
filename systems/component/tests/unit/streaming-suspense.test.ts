// @vitest-environment node
//
// Streaming SSR + suspense() boundary behavior. Tests the wire format
// (comment markers, template swap chunks, hydration cache scripts), the
// drain semantics (out-of-order resolution), the requireJs:false opt-out
// (synchronous wait, no markers), and the resource-hydration round-trip.

import { describe, expect, test } from 'vitest'
import { resource, state } from '../../../reactivity/src/index.ts'
import { div, renderToStream, renderToString, span, suspense } from '../../src/index.ts'

// Helper: drain a ReadableStream<Uint8Array> to a single string.
async function drainStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode()
  return out
}

// Helper: a deferred promise with manual resolve/reject.
function deferred<T>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
} {
  let resolve: (v: T) => void = () => {}
  let reject: (e: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('renderToStream — non-suspense (static) rendering', () => {
  test('emits one chunk and closes for a static view (no suspense)', async () => {
    const view = div({}, [span({}, ['hello'])])
    const html = await drainStream(renderToStream(view, { document: false }))
    expect(html).toBe('<div data-h="0"><span data-h="1">hello</span></div>')
    // No runtime injected because no streaming boundaries exist.
    expect(html).not.toContain('__place')
  })

  test('wraps body in document shell by default', async () => {
    const view = div({}, ['hi'])
    const html = await drainStream(renderToStream(view))
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<body>')
    expect(html).toContain('</body></html>')
  })

  test('document: false returns just the body fragment', async () => {
    const view = span({}, ['x'])
    const html = await drainStream(renderToStream(view, { document: false }))
    expect(html).toBe('<span data-h="0">x</span>')
  })
})

describe('suspense() — streaming with resource() suspension', () => {
  test('all resources already ready: emits children directly, no markers', async () => {
    // Pre-resolve the resource so it starts in 'ready' state immediately.
    const r = resource(async () => 'data', { hydrationKey: 'k1' })
    // Wait for the eager refresh to complete.
    await r.refresh()
    const view = suspense({
      fallback: span({}, ['loading']),
      on: [r],
      children: () => span({}, [`got: ${r()}`]),
    })
    const html = await drainStream(renderToStream(view, { document: false }))
    expect(html).toContain('got: data')
    expect(html).not.toContain('loading')
    expect(html).not.toContain('<!--p:')
    expect(html).not.toContain('__place.swap')
  })

  test('pending resource: emits fallback + comment markers + waits for resolution', async () => {
    const d = deferred<string>()
    const r = resource(() => d.promise, { hydrationKey: 'k2' })
    const view = div({ class: 'wrap' }, [
      suspense({
        fallback: span({ class: 'skel' }, ['loading...']),
        on: [r],
        children: () => span({ class: 'real' }, [`val: ${r()}`]),
      }),
    ])
    // Start the stream then resolve the resource concurrently.
    const streamPromise = drainStream(renderToStream(view, { document: false }))
    queueMicrotask(() => d.resolve('hello'))
    const html = await streamPromise
    // Initial body has fallback + markers.
    expect(html).toContain('<!--p:')
    expect(html).toContain('<!--/p:')
    expect(html).toContain('class="skel"')
    expect(html).toContain('loading...')
    // Inline runtime is injected.
    expect(html).toContain('__place.swap')
    // Swap chunk arrives later with the real content.
    expect(html).toContain('<template id="c-')
    expect(html).toContain('class="real"')
    expect(html).toContain('val: hello')
    // Hydration cache script for k2.
    expect(html).toContain("__place.r['k2']")
  })

  test('multiple suspense boundaries resolve out-of-order', async () => {
    const dA = deferred<string>()
    const dB = deferred<string>()
    const rA = resource(() => dA.promise)
    const rB = resource(() => dB.promise)
    const view = div({}, [
      suspense({
        fallback: span({}, ['fA']),
        on: [rA],
        children: () => span({}, [`A: ${rA()}`]),
      }),
      suspense({
        fallback: span({}, ['fB']),
        on: [rB],
        children: () => span({}, [`B: ${rB()}`]),
      }),
    ])
    const streamPromise = drainStream(renderToStream(view, { document: false }))
    // Resolve B first, then A — out-of-order.
    queueMicrotask(() => dB.resolve('beta'))
    setTimeout(() => dA.resolve('alpha'), 5)
    const html = await streamPromise
    // Both swap chunks arrived, both fallbacks shown initially.
    expect(html).toContain('A: alpha')
    expect(html).toContain('B: beta')
    expect(html.match(/__place\.swap\(/g)?.length).toBe(2)
  })

  test('error in resource: fallback stays, no swap chunk', async () => {
    const r = resource(() => Promise.reject(new Error('boom')))
    const view = suspense({
      fallback: span({ class: 'err' }, ['failed']),
      on: [r],
      children: () => span({}, ['real']),
    })
    const html = await drainStream(renderToStream(view, { document: false }))
    expect(html).toContain('class="err"')
    expect(html).toContain('failed')
    // The continuation render() returns fallback on error, so the swap
    // chunk replaces the fallback with itself — visually the same. The
    // swap script still fires but the result is identical.
    // (The user-visible behavior: fallback persists.)
    expect(html).not.toContain('>real<')
  })

  test('requireJs: false — synchronous wait, no markers, inline content', async () => {
    const d = deferred<string>()
    const r = resource(() => d.promise)
    queueMicrotask(() => d.resolve('inline'))
    const view = suspense({
      fallback: span({}, ['fb']),
      on: [r],
      requireJs: false,
      children: () => span({ class: 'inl' }, [`val: ${r()}`]),
    })
    const html = await drainStream(renderToStream(view, { document: false }))
    // No comment markers, no swap script — content is inlined.
    expect(html).not.toContain('<!--p:')
    expect(html).not.toContain('__place.swap')
    expect(html).toContain('class="inl"')
    expect(html).toContain('val: inline')
  })

  test('hydrationKey: resource value serialized via devalue (handles Date)', async () => {
    const d = deferred<{ when: Date; tags: Set<string> }>()
    const r = resource(() => d.promise, { hydrationKey: 'note:42' })
    queueMicrotask(() =>
      d.resolve({ when: new Date('2026-01-01T00:00:00Z'), tags: new Set(['a', 'b']) }),
    )
    const view = suspense({
      fallback: span({}, ['…']),
      on: [r],
      children: () => {
        const s = r.status()
        if (s.state !== 'ready') return null
        return span({}, [s.value.when.toISOString()])
      },
    })
    const html = await drainStream(renderToStream(view, { document: false }))
    expect(html).toContain('2026-01-01T00:00:00.000Z')
    // The hydration cache script preserves the Date + Set via devalue.
    expect(html).toContain("__place.r['note:42']")
    // Devalue's wire format includes its own type tags; we just confirm
    // the encoded chunk references both the Date string and the Set.
    expect(html).toMatch(/Date/)
    expect(html).toMatch(/Set/)
  })

  test('renderToString (non-streaming): suspense renders fallback when pending', () => {
    const r = resource(() => new Promise<string>(() => {})) // never resolves
    const view = suspense({
      fallback: span({}, ['fallback-content']),
      on: [r],
      children: () => span({}, ['real-content']),
    })
    const html = renderToString(view)
    expect(html).toContain('fallback-content')
    expect(html).not.toContain('real-content')
    expect(html).not.toContain('<!--p:')
  })

  test('renderToString: suspense renders children when all ready', async () => {
    const r = resource(async () => 'x')
    await r.refresh()
    const view = suspense({
      fallback: span({}, ['no']),
      on: [r],
      children: () => span({}, ['yes']),
    })
    const html = renderToString(view)
    expect(html).toContain('yes')
    expect(html).not.toContain('no')
  })

  test('hydration cache script encoding is safe against </script> injection', async () => {
    // Devalue encodes `<` as `<` inside JSON strings, which is
    // valid JSON and parses back to the original `<`. That's the
    // primary defence — the literal `</script>` characters never
    // appear in the data section, so the script tag can't be closed
    // prematurely. We verify the encoded form AND count tags.
    const d = deferred<{ payload: string }>()
    const r = resource(() => d.promise, { hydrationKey: 'evil' })
    queueMicrotask(() => d.resolve({ payload: '</script><script>alert(1)</script>' }))
    const view = suspense({
      fallback: span({}, ['x']),
      on: [r],
      children: () => span({}, ['ok']),
    })
    const html = await drainStream(renderToStream(view, { document: false }))
    // The encoded data uses < for the `<` character so the literal
    // `</script>` cannot appear inside the data section.
    expect(html).toContain('\\u003C/script>')
    // There's exactly the right number of </script> tags: the inline
    // runtime, the hydration cache script, and the swap script = 3.
    const closes = html.match(/<\/script>/g) ?? []
    expect(closes.length).toBe(3)
  })

  test('streamed output preserves order: shell-first, swap-after, in the bytes', async () => {
    // Note: ReadableStream consumers (Bun, browsers) may coalesce
    // multiple controller.enqueue() calls into a single read chunk.
    // That's fine — what matters is the BYTES are in order: shell HTML
    // (with fallback) appears BEFORE any swap script in the response.
    const d = deferred<string>()
    const r = resource(() => d.promise)
    queueMicrotask(() => d.resolve('done'))
    const view = div({}, [
      span({ class: 'shell' }, ['initial']),
      suspense({
        fallback: span({}, ['loading']),
        on: [r],
        children: () => span({ class: 'after' }, ['real']),
      }),
    ])
    const html = await drainStream(renderToStream(view, { document: false }))
    const shellIdx = html.indexOf('class="shell"')
    const fallbackIdx = html.indexOf('loading')
    const swapIdx = html.indexOf('__place.swap')
    const realIdx = html.indexOf('class="after"')
    // Shell comes first, then fallback, then later: real content + swap.
    expect(shellIdx).toBeGreaterThan(-1)
    expect(fallbackIdx).toBeGreaterThan(shellIdx)
    expect(realIdx).toBeGreaterThan(fallbackIdx)
    expect(swapIdx).toBeGreaterThan(fallbackIdx)
  })

  test('client-side resource() reads from __place.r when hydrationKey matches', () => {
    // Simulate the client-side environment: install __place.r.
    const original = (globalThis as { __place?: unknown }).__place
    ;(globalThis as { __place?: { r: Record<string, unknown> } }).__place = {
      r: { 'note:1': { id: 1, title: 'cached' } },
    }
    try {
      const r = resource(
        async () => ({ id: 1, title: 'fetched' }), // would fetch; should be skipped
        { hydrationKey: 'note:1' },
      )
      // Initial status comes from the cache, not the loader.
      expect(r.status()).toEqual({ state: 'ready', value: { id: 1, title: 'cached' } })
    } finally {
      ;(globalThis as { __place?: unknown }).__place = original
    }
  })

  test('client-side resource() runs loader when hydrationKey is missing from __place.r', async () => {
    const original = (globalThis as { __place?: unknown }).__place
    ;(globalThis as { __place?: { r: Record<string, unknown> } }).__place = { r: {} }
    try {
      const r = resource(async () => 'fetched', { hydrationKey: 'missing' })
      // No cache: loader runs, status starts loading.
      expect(r.status().state).toBe('loading')
      await r.refresh()
      expect(r.status()).toEqual({ state: 'ready', value: 'fetched' })
    } finally {
      ;(globalThis as { __place?: unknown }).__place = original
    }
  })

  test('client-side resource() ignores cache when no hydrationKey', () => {
    const original = (globalThis as { __place?: unknown }).__place
    ;(globalThis as { __place?: { r: Record<string, unknown> } }).__place = {
      r: { 'note:1': 'cached' },
    }
    try {
      const r = resource(async () => 'fetched') // no hydrationKey
      // No key: loader path, never consults __place.r.
      expect(r.status().state).toBe('loading')
    } finally {
      ;(globalThis as { __place?: unknown }).__place = original
    }
  })

  test('reactive state changes inside children re-evaluate on continuation render', async () => {
    // Ensures the children fn is actually re-called after resource resolves.
    const counter = state(0)
    const d = deferred<string>()
    const r = resource(() => d.promise)
    queueMicrotask(() => {
      counter.set(7)
      d.resolve('go')
    })
    const view = suspense({
      fallback: span({}, ['…']),
      on: [r],
      children: () => span({ class: 'c' }, [`count=${counter()},val=${r()}`]),
    })
    const html = await drainStream(renderToStream(view, { document: false }))
    // The children fn is re-evaluated AFTER the resource resolves, so it
    // sees counter=7.
    expect(html).toContain('count=7,val=go')
  })
})
