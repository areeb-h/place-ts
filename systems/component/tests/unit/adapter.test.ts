// @vitest-environment node
//
// Adapter interface scaffold. Phase 4.6: just verifies the shape is
// callable and the Builder is constructed correctly. Concrete adapters
// (Vercel/Cloudflare/Node) ship in Phase 5 with their own integration
// tests.
//
// These tests require Bun.serve at startup. Vitest runs under Node, so
// they're gated behind a Bun-available check — they pass through under
// `bun test` (when ports become available there) and skip under vitest.

import { describe, expect, test } from 'vitest'
import { page } from '../../src/index.ts'
import { type Adapter, type Builder, serve } from '../../src/server.ts'

const HAS_BUN_SERVE =
  typeof globalThis !== 'undefined' &&
  typeof (globalThis as { Bun?: { serve?: unknown } }).Bun?.serve === 'function'

describe.skipIf(!HAS_BUN_SERVE)('Adapter interface scaffold', () => {
  test('serve() calls adapter.adapt(builder) when an adapter is provided', async () => {
    let captured: Builder | null = null
    const myAdapter: Adapter = {
      name: 'test-adapter',
      adapt(builder) {
        captured = builder
      },
    }

    const home = page({ view: () => ({ toHtml: () => '<div>home</div>', mount: () => () => {} }) })
    const server = await serve({
      port: 0,
      routes: { '/': home, 'GET /api': () => new Response('api') },
      adapter: myAdapter,
    })
    try {
      // The adapter saw a Builder.
      expect(captured).not.toBeNull()
      const b = captured as unknown as Builder
      expect(b.name).toBe('place-app') // default
      expect(typeof b.dispatch).toBe('function')
      expect(b.outDir).toBe('./dist')
      expect(b.routes.length).toBe(2)
      // The route descriptor exposes method, pattern, and isPage flag.
      const home_r = b.routes.find((r) => r.pattern === '/')
      expect(home_r?.isPage).toBe(true)
      const api_r = b.routes.find((r) => r.pattern === '/api')
      expect(api_r?.isPage).toBe(false)
    } finally {
      server.stop()
    }
  })

  test('adapter.adapt is awaited (async adapters work)', async () => {
    let resolved = false
    const myAdapter: Adapter = {
      name: 'async',
      async adapt() {
        await new Promise((r) => setTimeout(r, 5))
        resolved = true
      },
    }

    const server = await serve({
      port: 0,
      routes: { 'GET /a': () => new Response('a') },
      adapter: myAdapter,
    })
    try {
      // serve() awaited the adapter before returning.
      expect(resolved).toBe(true)
    } finally {
      server.stop()
    }
  })

  test('serve() respects custom name + outDir', async () => {
    let captured: Builder | null = null
    const myAdapter: Adapter = {
      name: 'inspect',
      adapt(builder) {
        captured = builder
      },
    }
    const server = await serve({
      port: 0,
      routes: { 'GET /a': () => new Response('a') },
      adapter: myAdapter,
      name: 'my-app',
      outDir: './build/output',
    })
    try {
      expect((captured as unknown as Builder).name).toBe('my-app')
      expect((captured as unknown as Builder).outDir).toBe('./build/output')
    } finally {
      server.stop()
    }
  })

  test('without an adapter, serve() runs Bun.serve directly (no adapter call)', async () => {
    // No adapter, no captured side-effects from any adapter — just
    // confirm we still get a working Bun.serve.
    const server = await serve({
      port: 0,
      routes: { 'GET /ping': () => new Response('pong') },
    })
    try {
      const res = await fetch(`http://localhost:${server.port}/ping`)
      expect(await res.text()).toBe('pong')
    } finally {
      server.stop()
    }
  })

  test("builder.dispatch is callable and returns the route's response", async () => {
    let captured: Builder | null = null
    const myAdapter: Adapter = {
      name: 'manual',
      adapt(builder) {
        captured = builder
      },
    }
    const server = await serve({
      port: 0,
      routes: { 'GET /api/x': () => new Response('xx', { status: 201 }) },
      adapter: myAdapter,
    })
    try {
      const b = captured as unknown as Builder
      const res = await b.dispatch(new Request('http://x/api/x'))
      expect(res.status).toBe(201)
      expect(await res.text()).toBe('xx')
    } finally {
      server.stop()
    }
  })
})
