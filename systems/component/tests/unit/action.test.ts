// @vitest-environment node

import { describe, expect, test, vi } from 'vitest'
import { ActionError, action, resolveActionUrl, shape } from '../../src/index.ts'

// Hand-rolled validator helpers (the framework is schema-agnostic — any
// `(raw) => T` that throws on invalid input works).
const stringId = (raw: unknown): { id: string } => {
  if (typeof raw !== 'object' || raw === null || typeof (raw as { id?: unknown }).id !== 'string') {
    throw new Error('expected { id: string }')
  }
  return raw as { id: string }
}

describe('action() — typed RPC', () => {
  test('produces { handler, call, path }', () => {
    const a = action({
      path: 'POST /api/test',
      input: stringId,
      fn: ({ id }) => ({ ok: true, id }),
    })
    expect(a.path).toBe('/api/test')
    expect(typeof a.call).toBe('function')
    expect(Object.keys(a.handler)).toEqual(['POST /api/test'])
  })

  test('default method is POST when no method prefix is given', () => {
    const a = action({
      path: '/api/foo',
      input: stringId,
      fn: () => ({ ok: true }),
    })
    expect(Object.keys(a.handler)).toEqual(['POST /api/foo'])
  })

  test('handler validates input and 400s on invalid', async () => {
    const a = action({
      path: 'POST /x',
      input: stringId,
      fn: ({ id }) => ({ id }),
    })
    const handler = a.handler['POST /x']
    if (!handler) throw new Error('test: handler not found')
    const res = await handler(
      new Request('http://x/x', {
        method: 'POST',
        body: JSON.stringify({ id: 42 }), // wrong type
        headers: { 'Content-Type': 'application/json' },
      }),
      {},
    )
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('expected { id: string }')
  })

  test('handler 400s on malformed JSON', async () => {
    const a = action({
      path: 'POST /x',
      input: stringId,
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /x']
    if (!handler) throw new Error('test: handler not found')
    const res = await handler(
      new Request('http://x/x', {
        method: 'POST',
        body: 'not json',
        headers: { 'Content-Type': 'application/json' },
      }),
      {},
    )
    expect(res.status).toBe(400)
    // Wording widened from "invalid JSON" to "invalid request body" when
    // the handler grew form-encoded support; the assertion checks the
    // common-fragment.
    expect(await res.text()).toContain('invalid request body')
  })

  test('same-origin: rejects POST with foreign Origin header (CSRF guard)', async () => {
    type Likes = { id: string }
    const validator = shape({ id: 'string' })
    const a = action({
      path: 'POST /api/like',
      input: validator,
      fn: ({ id }: Likes) => ({ liked: id }),
    })
    const handler = a.handler['POST /api/like']
    if (!handler) throw new Error('handler not found')
    const res = await handler(
      new Request('http://my-app.com/api/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://evil.com' },
        body: JSON.stringify({ id: 'a' }),
      }),
      {},
    )
    expect(res.status).toBe(403)
  })

  test('same-origin: ALLOWS POST with matching Origin', async () => {
    type Likes = { id: string }
    const validator = shape({ id: 'string' })
    const a = action({
      path: 'POST /api/like',
      input: validator,
      fn: ({ id }: Likes) => ({ liked: id }),
    })
    const handler = a.handler['POST /api/like']
    if (!handler) throw new Error('handler not found')
    const res = await handler(
      new Request('http://my-app.com/api/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://my-app.com' },
        body: JSON.stringify({ id: 'a' }),
      }),
      {},
    )
    expect(res.status).toBe(200)
  })

  test('same-origin: opt-out via sameOrigin=false (e.g. webhook receiver)', async () => {
    type Hook = { event: string }
    const validator = shape({ event: 'string' })
    const a = action({
      path: 'POST /api/webhook',
      input: validator,
      sameOrigin: false,
      fn: ({ event }: Hook) => ({ received: event }),
    })
    const handler = a.handler['POST /api/webhook']
    if (!handler) throw new Error('handler not found')
    const res = await handler(
      new Request('http://my-app.com/api/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://stripe.com' },
        body: JSON.stringify({ event: 'payment.succeeded' }),
      }),
      {},
    )
    expect(res.status).toBe(200)
  })

  test('body size: rejects request with Content-Length over the cap', async () => {
    type Likes = { id: string }
    const validator = shape({ id: 'string' })
    const a = action({
      path: 'POST /api/like',
      input: validator,
      maxBodyBytes: 100,
      fn: ({ id }: Likes) => ({ liked: id }),
    })
    const handler = a.handler['POST /api/like']
    if (!handler) throw new Error('handler not found')
    const big = JSON.stringify({ id: 'x'.repeat(500) })
    const res = await handler(
      new Request('http://x/api/like', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(big.length),
        },
        body: big,
      }),
      {},
    )
    expect(res.status).toBe(413)
    expect(await res.text()).toContain('too large')
  })

  test('proto-pollution guard: rejects bodies with __proto__ key', async () => {
    type Likes = { id: string }
    const validator = shape({ id: 'string' })
    const a = action({
      path: 'POST /api/like',
      input: validator,
      fn: ({ id }: Likes) => ({ liked: id }),
    })
    const handler = a.handler['POST /api/like']
    if (!handler) throw new Error('handler not found')
    const res = await handler(
      new Request('http://x/api/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"id":"a","__proto__":{"polluted":true}}',
      }),
      {},
    )
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('suspicious')
  })

  test('proto-pollution guard: rejects nested __proto__ in arrays/objects', async () => {
    const passthrough = (raw: unknown): { items: unknown[] } => raw as { items: unknown[] }
    const a = action({
      path: 'POST /api/items',
      input: passthrough,
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /api/items']
    if (!handler) throw new Error('handler not found')
    const res = await handler(
      new Request('http://x/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"items":[{"nested":{"__proto__":{"x":1}}}]}',
      }),
      {},
    )
    expect(res.status).toBe(400)
  })

  test('csrf token: rejects request without token when csrf option set', async () => {
    type Likes = { id: string }
    const validator = shape({ id: 'string' })
    const a = action({
      path: 'POST /api/like',
      input: validator,
      csrf: {
        verify: () => true, // accept any token (we test the missing-token path)
        audience: () => 'user-123',
      },
      fn: ({ id }: Likes) => ({ liked: id }),
    })
    const handler = a.handler['POST /api/like']
    if (!handler) throw new Error('handler not found')
    const res = await handler(
      new Request('http://x/api/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'a' }),
      }),
      {},
    )
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('CSRF')
  })

  test('csrf token: rejects invalid token', async () => {
    type Likes = { id: string }
    const validator = shape({ id: 'string' })
    const a = action({
      path: 'POST /api/like',
      input: validator,
      csrf: {
        verify: (tok) => tok === 'valid-token',
        audience: () => 'user-123',
      },
      fn: ({ id }: Likes) => ({ liked: id }),
    })
    const handler = a.handler['POST /api/like']
    if (!handler) throw new Error('handler not found')
    const res = await handler(
      new Request('http://x/api/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'WRONG' },
        body: JSON.stringify({ id: 'a' }),
      }),
      {},
    )
    expect(res.status).toBe(403)
  })

  test('csrf token: accepts valid token', async () => {
    type Likes = { id: string }
    const validator = shape({ id: 'string' })
    const a = action({
      path: 'POST /api/like',
      input: validator,
      csrf: {
        verify: (tok) => tok === 'valid-token',
        audience: () => 'user-123',
      },
      fn: ({ id }: Likes) => ({ liked: id }),
    })
    const handler = a.handler['POST /api/like']
    if (!handler) throw new Error('handler not found')
    const res = await handler(
      new Request('http://x/api/like', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'valid-token' },
        body: JSON.stringify({ id: 'a' }),
      }),
      {},
    )
    expect(res.status).toBe(200)
  })

  test('handler returns the function result as JSON 200', async () => {
    const a = action({
      path: 'POST /api/like',
      input: stringId,
      fn: ({ id }) => ({ liked: true, id }),
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
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(await res.json()).toEqual({ liked: true, id: 'abc' })
  })

  test('handler awaits async fn', async () => {
    const a = action({
      path: 'POST /slow',
      input: stringId,
      fn: async ({ id }) => {
        await new Promise((r) => setTimeout(r, 5))
        return { id }
      },
    })
    const handler = a.handler['POST /slow']
    if (!handler) throw new Error('test: handler not found')
    const res = await handler(
      new Request('http://x/slow', {
        method: 'POST',
        body: JSON.stringify({ id: 'x' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      {},
    )
    expect(await res.json()).toEqual({ id: 'x' })
  })

  test('handler 500s on unexpected throw', async () => {
    const a = action({
      path: 'POST /broken',
      input: stringId,
      fn: () => {
        throw new Error('db connection lost')
      },
    })
    const handler = a.handler['POST /broken']
    if (!handler) throw new Error('test: handler not found')
    const res = await handler(
      new Request('http://x/broken', {
        method: 'POST',
        body: JSON.stringify({ id: 'x' }),
      }),
      {},
    )
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('db connection lost')
  })

  test('handler honors ActionError status + payload (structured server errors)', async () => {
    const a = action({
      path: 'POST /restricted',
      input: stringId,
      fn: () => {
        throw new ActionError(403, 'forbidden', { reason: 'auth' })
      },
    })
    const handler = a.handler['POST /restricted']
    if (!handler) throw new Error('test: handler not found')
    const res = await handler(
      new Request('http://x/restricted', {
        method: 'POST',
        body: JSON.stringify({ id: 'x' }),
      }),
      {},
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden', payload: { reason: 'auth' } })
  })

  test('call() POSTs to path and returns server JSON typed', async () => {
    // Mock fetch to capture the call shape.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
        expect(input).toBe('/api/like')
        expect(init?.method).toBe('POST')
        expect(init?.body).toBe(JSON.stringify({ id: 'abc' }))
        return new Response(JSON.stringify({ liked: true, id: 'abc' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    try {
      const a = action({
        path: 'POST /api/like',
        input: stringId,
        fn: ({ id }) => ({ liked: true, id }),
      })
      const result = await a.call({ id: 'abc' })
      expect(result).toEqual({ liked: true, id: 'abc' })
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('call() throws ActionError on non-2xx (with structured payload)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ error: 'forbidden', payload: { reason: 'auth' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    try {
      const a = action({
        path: 'POST /x',
        input: stringId,
        fn: () => ({ ok: true }),
      })
      await expect(a.call({ id: 'abc' })).rejects.toThrow(ActionError)
      try {
        await a.call({ id: 'abc' })
      } catch (e) {
        const err = e as ActionError
        expect(err.status).toBe(403)
        expect(err.message).toBe('forbidden')
        expect(err.payload).toEqual({ reason: 'auth' })
      }
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('call() validates input client-side before fetching (fast-fail)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const a = action({
        path: 'POST /x',
        input: stringId,
        fn: () => ({ ok: true }),
      })
      await expect(a.call({ id: 42 } as unknown as { id: string })).rejects.toThrow(
        'expected { id: string }',
      )
      // No fetch should have happened.
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('resolveActionUrl — parameterized action URLs', () => {
  test('static template passes through unchanged', () => {
    expect(resolveActionUrl('/api/like', '/anywhere')).toBe('/api/like')
  })

  test('single :param resolves from the matching segment position', () => {
    expect(resolveActionUrl('/notes/:id/edit/_action/save', '/notes/abc/edit')).toBe(
      '/notes/abc/edit/_action/save',
    )
  })

  test('multiple :params resolve positionally', () => {
    expect(resolveActionUrl('/orgs/:org/repos/:repo/_action/star', '/orgs/place/repos/ts')).toBe(
      '/orgs/place/repos/ts/_action/star',
    )
  })

  test('throws ActionError when current path lacks the segment', () => {
    expect(() => resolveActionUrl('/notes/:id/edit/_action/save', '/notes')).toThrow(/URL param/)
  })

  test('preserves leading slash + does not produce double slashes', () => {
    expect(resolveActionUrl('/notes/:id', '/notes/x')).toBe('/notes/x')
  })
})

describe('action.call — URL parameter resolution before fetch', () => {
  test('POSTs to the resolved URL, not the literal template', async () => {
    const validator = shape({ title: 'string' })
    const a = action({
      path: 'POST /notes/:id/edit/_action/save',
      input: validator,
      fn: ({ title }: { title: string }) => ({ title }),
    })
    // Mock window.location and fetch for this scope
    const originalWindow = (globalThis as { window?: unknown }).window
    const originalFetch = globalThis.fetch
    const fetchSpy = vi.fn(
      async (_input: unknown, _init?: unknown) =>
        new Response(JSON.stringify({ title: 'echoed' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    )
    // biome-ignore lint/suspicious/noExplicitAny: test-time window shim — minimal shape, real DOM not needed
    ;(globalThis as any).window = { location: { pathname: '/notes/abc/edit' } }
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    try {
      const result = await a.call({ title: 'hi' })
      expect(result).toEqual({ title: 'echoed' })
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const calledUrl = fetchSpy.mock.calls[0]?.[0]
      expect(calledUrl).toBe('/notes/abc/edit/_action/save')
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: test-time window cleanup
      ;(globalThis as any).window = originalWindow
      globalThis.fetch = originalFetch
    }
  })
})
