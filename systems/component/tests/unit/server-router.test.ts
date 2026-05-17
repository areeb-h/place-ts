// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { serverRouter } from '../../src/index.ts'

describe('serverRouter — METHOD + path → handler dispatch', () => {
  test('dispatches a static route to its handler', async () => {
    const router = serverRouter({
      'GET /hello': () => new Response('hi'),
    })
    const res = await router(new Request('http://x/hello'))
    expect(res?.status).toBe(200)
    expect(await res?.text()).toBe('hi')
  })

  test('returns null when no route matches', async () => {
    const router = serverRouter({ 'GET /a': () => new Response('a') })
    expect(await router(new Request('http://x/b'))).toBeNull()
  })

  test('method-mismatched routes are skipped (caller does 405)', async () => {
    const router = serverRouter({ 'GET /x': () => new Response('a') })
    expect(await router(new Request('http://x/x', { method: 'POST' }))).toBeNull()
  })

  test('extracts typed params from :name segments', async () => {
    const router = serverRouter({
      'GET /users/:id/posts/:postId': (_req, params) =>
        new Response(`u=${params['id']} p=${params['postId']}`),
    })
    const res = await router(new Request('http://x/users/alice/posts/42'))
    expect(await res?.text()).toBe('u=alice p=42')
  })

  test('first matching route wins (order matters)', async () => {
    const router = serverRouter({
      'GET /kv': () => new Response('list'),
      'GET /kv/:key': (_r, p) => new Response(`get:${p['key']}`),
    })
    expect(await (await router(new Request('http://x/kv')))?.text()).toBe('list')
    expect(await (await router(new Request('http://x/kv/foo')))?.text()).toBe('get:foo')
  })

  test('* method matches any method', async () => {
    const router = serverRouter({
      '* /any': () => new Response('any'),
    })
    expect(await (await router(new Request('http://x/any', { method: 'PATCH' })))?.text()).toBe(
      'any',
    )
    expect(await (await router(new Request('http://x/any', { method: 'DELETE' })))?.text()).toBe(
      'any',
    )
  })

  test('async handlers are awaited', async () => {
    const router = serverRouter({
      'GET /slow': async () => {
        await new Promise((r) => setTimeout(r, 5))
        return new Response('slow')
      },
    })
    expect(await (await router(new Request('http://x/slow')))?.text()).toBe('slow')
  })

  test('throws at construction on a malformed key (helpful error)', () => {
    expect(() => serverRouter({ '/no-method': () => new Response() })).toThrow(/METHOD/)
    expect(() => serverRouter({ 'GET no-slash': () => new Response() })).toThrow(/start with '\/'/)
  })

  test('handler receiving the Request can branch on headers', async () => {
    const router = serverRouter({
      'GET /me': (req) => new Response(req.headers.get('x-user') ?? 'anon'),
    })
    const res = await router(new Request('http://x/me', { headers: { 'X-User': 'alice' } }))
    expect(await res?.text()).toBe('alice')
  })
})
