// @vitest-environment node
//
// Phase 5.1: Node adapter integration. Vitest runs under Node, so we
// can spin up the adapter against a real http.createServer and exercise
// it via fetch(). This validates the dispatch flow + Bun.file fallback
// + Request/Response translation end-to-end.

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { nodeAdapter } from '../../src/adapters/node.ts'
import { div, page, serve, span } from '../../src/index.ts'

// Helper: spin up an adapter on an OS-assigned port, return the port.
function findFreePort(): Promise<number> {
  // Port 0 → OS picks; we read it back from the listen callback.
  // Wrapped here so each test gets a unique port without races.
  return new Promise((resolve) => {
    import('node:net').then(({ createServer }) => {
      const s = createServer()
      s.listen(0, () => {
        const addr = s.address()
        const port = typeof addr === 'object' && addr ? addr.port : 0
        s.close(() => resolve(port))
      })
    })
  })
}

describe('nodeAdapter — Node http server integration', () => {
  let port = 0
  let serverInstance: { stop?(): void } | null = null

  beforeEach(async () => {
    port = await findFreePort()
    serverInstance = null
  })

  afterEach(() => {
    serverInstance?.stop?.()
    serverInstance = null
  })

  test('serves a Page via http.createServer end-to-end', async () => {
    const home = page({
      url: (u) => ({ name: u.searchParams.get('name') ?? 'world' }),
      view: ({ name }) => div({ class: 'h' }, [`hello, ${name}`]),
    })
    serverInstance = await serve({
      adapter: nodeAdapter({ port, hostname: '127.0.0.1' }),
      routes: { '/': home },
    })

    const res = await fetch(`http://127.0.0.1:${port}/?name=opus`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const body = await res.text()
    expect(body).toContain('hello, opus')
    expect(body).toContain('<!doctype html>')
  })

  test('serves a raw handler', async () => {
    serverInstance = await serve({
      adapter: nodeAdapter({ port, hostname: '127.0.0.1' }),
      routes: {
        'GET /api/ping': () => new Response('pong'),
      },
    })

    const res = await fetch(`http://127.0.0.1:${port}/api/ping`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('pong')
  })

  test('extracts route params correctly', async () => {
    serverInstance = await serve({
      adapter: nodeAdapter({ port, hostname: '127.0.0.1' }),
      routes: {
        'GET /users/:id': (_req, params) => new Response(`user:${params['id']}`),
      },
    })

    const res = await fetch(`http://127.0.0.1:${port}/users/42`)
    expect(await res.text()).toBe('user:42')
  })

  test('passes through POST body to the handler', async () => {
    serverInstance = await serve({
      adapter: nodeAdapter({ port, hostname: '127.0.0.1' }),
      routes: {
        'POST /echo': async (req) => new Response(await req.text()),
      },
    })

    const res = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: 'POST',
      body: 'echo me back',
    })
    expect(await res.text()).toBe('echo me back')
  })

  test('serves the pre-built clientJs at clientPath', async () => {
    serverInstance = await serve({
      adapter: nodeAdapter({ port, hostname: '127.0.0.1' }),
      clientJs: 'console.log("pre-built bundle")',
      routes: { 'GET /': () => new Response('home') },
    })

    const res = await fetch(`http://127.0.0.1:${port}/client.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
    expect(await res.text()).toBe('console.log("pre-built bundle")')
  })

  test('static assets via fs fallback (no Bun.file)', async () => {
    // Create a temp dir with a file, mount it as a static prefix.
    const dir = await mkdtemp(join(tmpdir(), 'place-static-'))
    try {
      const filePath = join(dir, 'hello.txt')
      await writeFile(filePath, 'hello from disk')
      serverInstance = await serve({
        adapter: nodeAdapter({ port, hostname: '127.0.0.1' }),
        static: { '/files': dir },
        routes: {},
      })

      const res = await fetch(`http://127.0.0.1:${port}/files/hello.txt`)
      expect(res.status).toBe(200)
      // RFC 7230 §3.2.3: OWS in header field-values is semantically
      // invisible (`text/plain;charset=utf-8` and `text/plain; charset=utf-8`
      // are identical). Bun.serve's per-response compression layer
      // normalizes OWS as it copies headers through; compare without
      // requiring the optional space.
      expect(res.headers.get('content-type')?.replace(/;\s+/g, ';')).toBe(
        'text/plain;charset=utf-8',
      )
      expect(await res.text()).toBe('hello from disk')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('static asset path-traversal attacks are rejected (404 not 200)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'place-static-'))
    try {
      await writeFile(join(dir, 'safe.txt'), 'safe')
      serverInstance = await serve({
        adapter: nodeAdapter({ port, hostname: '127.0.0.1' }),
        static: { '/files': dir },
        routes: {},
      })

      // Try to escape via ../
      const res = await fetch(`http://127.0.0.1:${port}/files/../etc/passwd`)
      expect(res.status).toBe(404)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('404 for unmatched routes carries security headers', async () => {
    serverInstance = await serve({
      adapter: nodeAdapter({ port, hostname: '127.0.0.1' }),
      security: 'standard',
      routes: { 'GET /a': () => new Response('a') },
    })

    const res = await fetch(`http://127.0.0.1:${port}/nope`)
    expect(res.status).toBe(404)
    // Security headers ride along on the 404.
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('per-request CSP nonce is fresh on each Node response', async () => {
    serverInstance = await serve({
      adapter: nodeAdapter({ port, hostname: '127.0.0.1' }),
      security: 'standard',
      routes: {
        '/': page({
          load: () => ({ at: 'now' }),
          view: () => span({}, ['hi']),
        }),
      },
    })

    const r1 = await fetch(`http://127.0.0.1:${port}/`)
    const r2 = await fetch(`http://127.0.0.1:${port}/`)
    const csp1 = r1.headers.get('content-security-policy') ?? ''
    const csp2 = r2.headers.get('content-security-policy') ?? ''
    const nonce1 = csp1.match(/nonce-([A-Za-z0-9+/=]+)/)?.[1]
    const nonce2 = csp2.match(/nonce-([A-Za-z0-9+/=]+)/)?.[1]
    expect(nonce1).toBeTruthy()
    expect(nonce2).toBeTruthy()
    expect(nonce1).not.toBe(nonce2)
  })

  test('clientEntry without clientJs throws on Node (clear error)', async () => {
    await expect(
      serve({
        adapter: nodeAdapter({ port, hostname: '127.0.0.1' }),
        clientEntry: '/some/file.tsx',
        routes: {},
      }),
    ).rejects.toThrow(/Bun\.build, which is not available/)
  })

  test('preserves request method on dispatch (PUT routes through correctly)', async () => {
    // HTTP spec: HEAD responses have no body (fetch() strips it).
    // Use PUT instead so we can assert the body actually round-trips.
    serverInstance = await serve({
      adapter: nodeAdapter({ port, hostname: '127.0.0.1' }),
      routes: {
        'GET /thing': () => new Response('GET body'),
        'PUT /thing': (req) => new Response(`PUT received: ${req.method}`),
      },
    })

    const put = await fetch(`http://127.0.0.1:${port}/thing`, {
      method: 'PUT',
      body: 'payload',
    })
    expect(put.status).toBe(200)
    expect(await put.text()).toBe('PUT received: PUT')
  })
})
