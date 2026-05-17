// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { div, handler, serverRouter, span } from '../../src/index.ts'

describe('handler — Request → SSR Response', () => {
  test('sync route returns text/html with default doctype shell', async () => {
    const ssr = handler(() => div({ class: 'hi' }, ['hello']))
    const res = await ssr(new Request('http://x/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const body = await res.text()
    expect(body.startsWith('<!doctype html>')).toBe(true)
    expect(body).toContain('<div data-h="0" class="hi">hello</div>')
    expect(body).toContain('<head><meta charset="utf-8">')
  })

  test('async route is awaited before rendering', async () => {
    const ssr = handler(async () => {
      await new Promise((r) => setTimeout(r, 5))
      return span({}, ['async'])
    })
    const body = await (await ssr(new Request('http://x/'))).text()
    expect(body).toContain('<span data-h="0">async</span>')
  })

  test('document: false returns the body fragment as-is', async () => {
    const ssr = handler(() => span({}, ['frag']), { document: false })
    const body = await (await ssr(new Request('http://x/'))).text()
    expect(body).toBe('<span data-h="0">frag</span>')
  })

  test('document: function lets the caller compose a custom shell', async () => {
    const ssr = handler(() => span({}, ['x']), {
      document: (b) =>
        `<!doctype html><html><head><title>custom</title></head><body>${b}</body></html>`,
    })
    const body = await (await ssr(new Request('http://x/'))).text()
    expect(body).toContain('<title>custom</title>')
    expect(body).toContain('<span data-h="0">x</span>')
  })

  test('caller-provided headers extend / override defaults', async () => {
    const ssr = handler(() => div({}, ['x']), {
      status: 201,
      headers: {
        'X-Custom': 'yes',
        'Content-Security-Policy': "default-src 'self'",
      },
    })
    const res = await ssr(new Request('http://x/'))
    expect(res.status).toBe(201)
    expect(res.headers.get('x-custom')).toBe('yes')
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'")
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
  })

  test('throwing route returns 500 text/plain with the message (no stack)', async () => {
    const ssr = handler(() => {
      throw new Error('boom')
    })
    const res = await ssr(new Request('http://x/'))
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await res.text()).toBe('boom')
  })

  test('routeFn receives the Request and can branch on it', async () => {
    const ssr = handler((req) => {
      const u = new URL(req.url)
      return span({}, [`hello ${u.searchParams.get('name') ?? 'stranger'}`])
    })
    const a = await (await ssr(new Request('http://x/?name=alice'))).text()
    const b = await (await ssr(new Request('http://x/'))).text()
    expect(a).toContain('hello alice')
    expect(b).toContain('hello stranger')
  })

  test('routeFn receives params (defaults to {} when called directly)', async () => {
    const ssr = handler((_req, params) => span({}, [`id=${params['id'] ?? 'none'}`]))
    const direct = await (await ssr(new Request('http://x/'))).text()
    expect(direct).toContain('id=none')
    const withParams = await (await ssr(new Request('http://x/'), { id: '42' })).text()
    expect(withParams).toContain('id=42')
  })

  test('composes with serverRouter — :id-style params land typed', async () => {
    // The whole point of (req, params) threading: serverRouter
    // captures :id from the path, the handler renders a View that
    // depends on it, and the response body reflects the captured value.
    const router = serverRouter({
      'GET /users/:id': handler((_req, params) => span({}, [`user:${params['id']}`])),
    })
    const res = await router(new Request('http://x/users/alice'))
    expect(res?.status).toBe(200)
    const body = await res?.text()
    expect(body).toContain('user:alice')
  })
})
