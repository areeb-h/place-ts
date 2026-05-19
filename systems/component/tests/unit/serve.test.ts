// @vitest-environment happy-dom

import { afterEach, describe, expect, test } from 'vitest'
import { page, serve, span } from '../../src/index.ts'

// serve() ultimately calls Bun.serve, which isn't available in Vitest's
// Node-based test runtime — its dispatch + island-bundle behavior is
// exercised end-to-end via the docs site (browser-verified).
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

describe.skipIf(!HAS_BUN_BUILD)('serve() — rendered HTML', () => {
  // These tests boot a real serve() and assert on the rendered HTML.
  // They require Bun.build + Bun.serve.
  let server: { stop: () => void; port: number } | null = null

  afterEach(() => {
    server?.stop()
    server = null
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
