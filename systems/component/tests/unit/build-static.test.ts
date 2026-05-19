// @vitest-environment node
//
// Phase 5.3: Build-time static rendering. Walks a routes map, renders
// each Page (resolving dynamic routes via getStaticPaths), and writes
// HTML files to disk. Tests against a tmp dir so we can verify the
// actual filesystem output.

import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { div, page, span } from '../../src/index.ts'
import { buildStatic } from '../../src/server.ts'

describe('buildStatic — pre-render Pages to disk', () => {
  let outDir = ''

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'place-static-'))
  })

  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true })
  })

  test('renders a static "/" page to <outDir>/index.html', async () => {
    const home = page({
      view: () => div({ class: 'h' }, ['hi']),
      meta: { title: 'home' },
    })
    const result = await buildStatic({
      outDir,
      routes: { '/': home },
    })
    expect(result.pages).toEqual([{ path: '/', bytes: expect.any(Number) as unknown as number }])
    const html = await readFile(join(outDir, 'index.html'), 'utf-8')
    expect(html).toContain('<title>home</title>')
    expect(html).toContain('class="h"')
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })

  test('static "/about" lands at <outDir>/about/index.html (clean URLs)', async () => {
    const about = page({
      view: () => span({}, ['about us']),
    })
    await buildStatic({ outDir, routes: { '/about': about } })
    const html = await readFile(join(outDir, 'about', 'index.html'), 'utf-8')
    expect(html).toContain('about us')
  })

  test('multiple routes render in parallel-ish order', async () => {
    const home = page({ view: () => span({}, ['home']) })
    const about = page({ view: () => span({}, ['about']) })
    const result = await buildStatic({
      outDir,
      routes: { '/': home, '/about': about },
    })
    expect(result.pages.map((p) => p.path).sort()).toEqual(['/', '/about'])
  })

  test('dynamic route uses getStaticPaths to enumerate variants', async () => {
    const post = page({
      getStaticPaths: () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      url: (_u, params) => ({ id: params['id'] ?? '' }),
      view: ({ id }) => span({ class: 'post' }, [`post: ${id}`]),
    })
    const result = await buildStatic({
      outDir,
      routes: { '/posts/:id': post },
    })
    expect(result.pages.map((p) => p.path).sort()).toEqual(['/posts/a', '/posts/b', '/posts/c'])
    const a = await readFile(join(outDir, 'posts', 'a', 'index.html'), 'utf-8')
    expect(a).toContain('post: a')
    const b = await readFile(join(outDir, 'posts', 'b', 'index.html'), 'utf-8')
    expect(b).toContain('post: b')
  })

  test('async getStaticPaths is awaited', async () => {
    const post = page({
      getStaticPaths: async () => {
        await new Promise((r) => setTimeout(r, 5))
        return [{ id: 'lazy' }]
      },
      url: (_u, params) => ({ id: params['id'] ?? '' }),
      view: ({ id }) => span({}, [id]),
    })
    const result = await buildStatic({ outDir, routes: { '/posts/:id': post } })
    expect(result.pages).toEqual([{ path: '/posts/lazy', bytes: expect.any(Number) }])
  })

  test('throws when dynamic pattern lacks getStaticPaths', async () => {
    const post = page({
      view: () => span({}, ['x']),
    })
    await expect(buildStatic({ outDir, routes: { '/posts/:id': post } })).rejects.toThrow(
      /getStaticPaths/,
    )
  })

  test("non-page handlers in the routes map are skipped (can't be static)", async () => {
    const home = page({ view: () => span({}, ['home']) })
    const result = await buildStatic({
      outDir,
      routes: {
        '/': home,
        'GET /api/ping': () => new Response('pong'), // skipped
        'POST /submit': () => new Response('thanks'), // skipped
      },
    })
    // Only home was rendered.
    expect(result.pages).toEqual([{ path: '/', bytes: expect.any(Number) }])
  })

  test('non-GET routes are skipped (static can only represent GETs)', async () => {
    const home = page({ view: () => span({}, ['home']) })
    const result = await buildStatic({
      outDir,
      routes: {
        '/': home,
        // hypothetical POST page (silly, but tests the skip logic)
        'POST /submit': home,
      },
    })
    expect(result.pages.map((p) => p.path)).toEqual(['/'])
  })

  test('clientJs is written to <outDir>/client.js when provided', async () => {
    const home = page({ view: () => span({}, ['x']) })
    await buildStatic({
      outDir,
      routes: { '/': home },
      clientJs: 'console.log("hydrate")',
    })
    const js = await readFile(join(outDir, 'client.js'), 'utf-8')
    expect(js).toBe('console.log("hydrate")')
    // The HTML has the bootstrap <script src="/client.js">.
    const html = await readFile(join(outDir, 'index.html'), 'utf-8')
    expect(html).toContain('<script type="module" src="/client.js">')
  })

  test('custom clientPath is honored', async () => {
    const home = page({ view: () => span({}, ['x']) })
    await buildStatic({
      outDir,
      routes: { '/': home },
      clientJs: 'x',
      clientPath: '/static/app.js',
    })
    const js = await readFile(join(outDir, 'static', 'app.js'), 'utf-8')
    expect(js).toBe('x')
  })

  test('without clientJs, no <script> bootstrap is emitted', async () => {
    const home = page({ view: () => span({}, ['x']) })
    await buildStatic({ outDir, routes: { '/': home } })
    const html = await readFile(join(outDir, 'index.html'), 'utf-8')
    expect(html).not.toContain('<script type="module" src="/client.js">')
  })

  test('onPage hook fires once per built file', async () => {
    const home = page({ view: () => span({}, ['x']) })
    const post = page({
      getStaticPaths: () => [{ id: 'a' }, { id: 'b' }],
      url: (_u, params) => ({ id: params['id'] ?? '' }),
      view: ({ id }) => span({}, [id]),
    })
    const seen: Array<{ path: string; bytes: number }> = []
    await buildStatic({
      outDir,
      routes: { '/': home, '/posts/:id': post },
      onPage: (info) => seen.push(info),
    })
    expect(seen.map((s) => s.path).sort()).toEqual(['/', '/posts/a', '/posts/b'])
    expect(seen.every((s) => s.bytes > 0)).toBe(true)
  })

  test('page.load() data is rendered into the static HTML', async () => {
    const home = page({
      load: () => ({ greeting: 'hello from load' }),
      view: ({ greeting }) => span({}, [greeting]),
    })
    await buildStatic({ outDir, routes: { '/': home } })
    const html = await readFile(join(outDir, 'index.html'), 'utf-8')
    expect(html).toContain('hello from load')
    // The hydration payload script is also embedded so client-side
    // hydration could pick it up.
    expect(html).toContain('__place_load__')
  })

  test("out-dir is created if it doesn't exist (recursive mkdir)", async () => {
    const nested = join(outDir, 'deep', 'nested', 'out')
    const home = page({ view: () => span({}, ['x']) })
    await buildStatic({ outDir: nested, routes: { '/': home } })
    const html = await readFile(join(nested, 'index.html'), 'utf-8')
    expect(html).toBeTruthy()
  })

  test('no Bun.serve / Bun.build invocations (Node-runnable)', async () => {
    // Run buildStatic and verify we land HTML files on disk in vitest
    // (Node, no Bun globals at the runtime touchpoints we use). If this
    // test passes, the SSG path is genuinely runtime-portable.
    const home = page({
      url: () => ({ x: 'static' }),
      view: ({ x }) => div({}, [`x=${x}`]),
    })
    const result = await buildStatic({ outDir, routes: { '/': home } })
    expect(result.pages.length).toBe(1)
    const files = await readdir(outDir)
    expect(files).toContain('index.html')
  })
})
