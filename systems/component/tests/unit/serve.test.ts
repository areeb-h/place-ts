// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { page, serve, span } from '../../src/index.ts'

// serve() ultimately calls Bun.serve, which isn't available in Vitest's
// Node-based test runtime — its dispatch + client-bundle behavior is
// exercised end-to-end via the sync-server demo (browser-verified).
//
// What's testable HERE without Bun: the synchronous validation that
// happens BEFORE serve() touches Bun globals — clientPath collisions
// and route-pattern shape checks. These guard against the easiest
// kinds of misconfiguration users hit at startup.
//
// Bun-runtime tests (Bun.build + Bun.serve) live in the same file but
// gate via skipIf so they pass under `bun test` and skip under vitest.

const HAS_BUN_BUILD =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as { Bun?: { build?: unknown } }).Bun?.build === 'function'

describe('serve() — startup-time validation', () => {
  test('throws on a clientPath collision with a route pattern', async () => {
    await expect(
      serve({
        port: 0,
        clientPath: '/static',
        routes: { '/static': page({ view: () => span({}, ['x']) }) },
      }),
    ).rejects.toThrow(/collides with clientPath/)
  })

  test('throws on a route pattern missing a leading slash', async () => {
    await expect(
      serve({
        port: 0,
        routes: { 'GET no-slash': () => new Response() },
      }),
    ).rejects.toThrow(/must start with '\/'/)
  })
})

describe.skipIf(!HAS_BUN_BUILD)('serve() — client bundle shape', () => {
  // These tests boot a real serve(), fetch /client.js, and assert on
  // the served bundle bytes. They require Bun.build + Bun.serve.
  let originalNodeEnv: string | undefined
  let server: { stop: () => void; port: number } | null = null

  beforeEach(() => {
    originalNodeEnv = process.env['NODE_ENV']
  })

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV']
    else process.env['NODE_ENV'] = originalNodeEnv
    server?.stop()
    server = null
  })

  test('dev bundle contains an inline source map (//# sourceMappingURL=data:...)', async () => {
    delete process.env['NODE_ENV']
    server = (await serve({
      port: 0,
      clientEntry: `${import.meta.dir}/../fixtures/empty-client.tsx`,
      routes: { '/': page({ view: () => span({}, ['x']) }) },
      log: { banner: false, requests: false },
    })) as unknown as { stop: () => void; port: number }
    const res = await fetch(`http://localhost:${server.port}/client.js`)
    const body = await res.text()
    expect(body).toContain('//# sourceMappingURL=data:application/json')
  })

  test('prod bundle has no inline source map', async () => {
    process.env['NODE_ENV'] = 'production'
    server = (await serve({
      port: 0,
      clientEntry: `${import.meta.dir}/../fixtures/empty-client.tsx`,
      routes: { '/': page({ view: () => span({}, ['x']) }) },
      log: { banner: false, requests: false },
    })) as unknown as { stop: () => void; port: number }
    const res = await fetch(`http://localhost:${server.port}/client.js`)
    // In prod, /client.js redirects to the hashed path (308) — fetch
    // follows the redirect by default and returns the hashed bundle.
    const body = await res.text()
    expect(body).not.toContain('//# sourceMappingURL=data:application/json')
  })

  test('prod: served HTML <script src> points at content-hashed path', async () => {
    process.env['NODE_ENV'] = 'production'
    server = (await serve({
      port: 0,
      clientEntry: `${import.meta.dir}/../fixtures/empty-client.tsx`,
      routes: { '/': page({ view: () => span({}, ['x']) }) },
      log: { banner: false, requests: false },
    })) as unknown as { stop: () => void; port: number }
    const res = await fetch(`http://localhost:${server.port}/`)
    const html = await res.text()
    expect(html).toMatch(/<script[^>]+src="\/client\.[0-9a-f]{8}\.js"/)
  })

  test('prod: GET on hashed path → Cache-Control immutable', async () => {
    process.env['NODE_ENV'] = 'production'
    server = (await serve({
      port: 0,
      clientEntry: `${import.meta.dir}/../fixtures/empty-client.tsx`,
      routes: { '/': page({ view: () => span({}, ['x']) }) },
      log: { banner: false, requests: false },
    })) as unknown as { stop: () => void; port: number }
    // Discover the hashed path from the served HTML.
    const root = await fetch(`http://localhost:${server.port}/`)
    const html = await root.text()
    const m = html.match(/src="(\/client\.[0-9a-f]{8}\.js)"/)
    expect(m).not.toBeNull()
    const hashedPath = m?.[1] ?? ''
    const res = await fetch(`http://localhost:${server.port}${hashedPath}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  })

  test('prod: GET on legacy /client.js → 308 to hashed path', async () => {
    process.env['NODE_ENV'] = 'production'
    server = (await serve({
      port: 0,
      clientEntry: `${import.meta.dir}/../fixtures/empty-client.tsx`,
      routes: { '/': page({ view: () => span({}, ['x']) }) },
      log: { banner: false, requests: false },
    })) as unknown as { stop: () => void; port: number }
    const res = await fetch(`http://localhost:${server.port}/client.js`, { redirect: 'manual' })
    expect(res.status).toBe(308)
    expect(res.headers.get('location') ?? '').toMatch(/^\/client\.[0-9a-f]{8}\.js$/)
  })

  test('dev: served HTML <script src> is /client.js (no hash)', async () => {
    delete process.env['NODE_ENV']
    server = (await serve({
      port: 0,
      clientEntry: `${import.meta.dir}/../fixtures/empty-client.tsx`,
      routes: { '/': page({ view: () => span({}, ['x']) }) },
      log: { banner: false, requests: false },
    })) as unknown as { stop: () => void; port: number }
    const res = await fetch(`http://localhost:${server.port}/`)
    const html = await res.text()
    expect(html).toMatch(/<script[^>]+src="\/client\.js"/)
    expect(html).not.toMatch(/<script[^>]+src="\/client\.[0-9a-f]{8}\.js"/)
  })

  test('dev: GET /client.js → no-cache, no-store, must-revalidate', async () => {
    delete process.env['NODE_ENV']
    server = (await serve({
      port: 0,
      clientEntry: `${import.meta.dir}/../fixtures/empty-client.tsx`,
      routes: { '/': page({ view: () => span({}, ['x']) }) },
      log: { banner: false, requests: false },
    })) as unknown as { stop: () => void; port: number }
    const res = await fetch(`http://localhost:${server.port}/client.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-cache, no-store, must-revalidate')
  })

  test('viewTransitions: true injects the @view-transition at-rule with reduced-motion gate', async () => {
    server = (await serve({
      port: 0,
      routes: { '/': page({ view: () => span({}, ['x']) }) },
      viewTransitions: true,
      log: { banner: false, requests: false },
    })) as unknown as { stop: () => void; port: number }
    const res = await fetch(`http://localhost:${server.port}/`)
    const html = await res.text()
    expect(html).toContain('@view-transition')
    expect(html).toContain('navigation: auto')
    expect(html).toContain('prefers-reduced-motion: no-preference')
  })

  test('viewTransitions omitted: no @view-transition CSS in served HTML', async () => {
    server = (await serve({
      port: 0,
      routes: { '/': page({ view: () => span({}, ['x']) }) },
      log: { banner: false, requests: false },
    })) as unknown as { stop: () => void; port: number }
    const res = await fetch(`http://localhost:${server.port}/`)
    const html = await res.text()
    expect(html).not.toContain('@view-transition')
  })
})
