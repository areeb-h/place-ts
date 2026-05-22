// @vitest-environment node
//
// <Img> markup helper + imageRoute handler. Phase 4.7.

import { describe, expect, test, vi } from 'vitest'
import {
  contentHashedOptimizer,
  type ImageBackend,
  type ImageOptimizer,
  imageRoute,
  imgHtml,
  memoryStore,
  type OptimizedImage,
  passthroughOptimizer,
  sharpBackend,
} from '../../src/index.ts'

describe('imgHtml — markup generation', () => {
  test('default: emits <picture> with webp source + original fallback', () => {
    const html = imgHtml({ src: '/cover.jpg', alt: 'A cover' })
    expect(html).toContain('<picture>')
    expect(html).toContain('<source type="image/webp"')
    expect(html.match(/<img/g)?.length).toBe(1) // one <img> inside <picture>
  })

  test('default widths produce three srcset entries', () => {
    const html = imgHtml({ src: '/cover.jpg', alt: 'x' })
    // Three widths × two formats (webp source + original fallback img),
    // each with `Nw` annotation in srcset.
    expect(html).toContain(' 400w')
    expect(html).toContain(' 800w')
    expect(html).toContain(' 1600w')
  })

  test('custom widths flow into srcset', () => {
    const html = imgHtml({
      src: '/cover.jpg',
      alt: 'x',
      widths: [320, 640, 1024],
      format: 'jpeg', // skip <picture> wrapper
    })
    expect(html).toContain(' 320w')
    expect(html).toContain(' 640w')
    expect(html).toContain(' 1024w')
    expect(html).not.toContain(' 400w')
  })

  test('format !== auto skips the <picture> wrapper', () => {
    const html = imgHtml({ src: '/cover.jpg', alt: 'x', format: 'webp' })
    expect(html).not.toContain('<picture>')
    expect(html).toContain('<img')
  })

  test('lazy + async are on by default; opt-out via false', () => {
    const lazyHtml = imgHtml({ src: '/x.jpg', alt: 'x' })
    expect(lazyHtml).toContain('loading="lazy"')
    expect(lazyHtml).toContain('decoding="async"')
    const eagerHtml = imgHtml({ src: '/x.jpg', alt: 'x', lazy: false, async: false })
    expect(eagerHtml).not.toContain('loading="lazy"')
    expect(eagerHtml).not.toContain('decoding="async"')
  })

  test('width/height attributes prevent layout shift', () => {
    const html = imgHtml({ src: '/x.jpg', alt: 'x', width: 800, height: 600 })
    expect(html).toContain('width="800"')
    expect(html).toContain('height="600"')
  })

  test('escapes alt + class for XSS safety', () => {
    const html = imgHtml({
      src: '/x.jpg',
      alt: '<script>alert(1)</script>',
      class: 'a"b<c',
    })
    expect(html).toContain('alt="&lt;script&gt;alert(1)&lt;/script&gt;"')
    expect(html).toContain('class="a&quot;b&lt;c"')
    expect(html).not.toMatch(/alt="<script>/)
  })

  test('source URL is encoded into the variant URL', () => {
    const html = imgHtml({ src: '/img with space.jpg?v=2', alt: 'x', format: 'jpeg' })
    expect(html).toContain('%2Fimg%20with%20space.jpg%3Fv%3D2')
  })

  test('sizes attribute renders on img + picture source', () => {
    const html = imgHtml({
      src: '/x.jpg',
      alt: 'x',
      sizes: '(max-width: 768px) 100vw, 50vw',
    })
    // Both the picture source and the img should carry sizes (when picture)
    const sizesCount = (html.match(/sizes=/g) ?? []).length
    expect(sizesCount).toBe(2)
  })
})

describe('imageRoute — request handler', () => {
  test('serves the optimized image bytes with the right Content-Type', async () => {
    const opt: ImageOptimizer = {
      async optimize() {
        return {
          body: new Uint8Array([0xff, 0xd8, 0xff]), // JPEG magic bytes
          contentType: 'image/jpeg',
        }
      },
    }
    const route = imageRoute({ optimizer: opt })
    const res = await route.handler(
      new Request(`http://x${'/_place/img/800/jpeg/'}${encodeURIComponent('/source.jpg')}`),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0xd8)
    expect(bytes[2]).toBe(0xff)
  })

  test('rejects malformed URLs with 400', async () => {
    const route = imageRoute({ optimizer: passthroughOptimizer })
    const res = await route.handler(new Request('http://x/_place/img/notwidth/jpeg'))
    expect(res.status).toBe(400)
  })

  test('rejects invalid widths (non-numeric, too large)', async () => {
    const route = imageRoute({ optimizer: passthroughOptimizer })
    const tooLarge = await route.handler(
      new Request(`http://x/_place/img/99999/jpeg/${encodeURIComponent('/x.jpg')}`),
    )
    expect(tooLarge.status).toBe(400)
  })

  test('rejects invalid format', async () => {
    const route = imageRoute({ optimizer: passthroughOptimizer })
    const res = await route.handler(
      new Request(`http://x/_place/img/800/gif/${encodeURIComponent('/x.jpg')}`),
    )
    expect(res.status).toBe(400)
  })

  test('cache hit: returns cached body without invoking optimizer', async () => {
    const cache = memoryStore()
    let callCount = 0
    const opt: ImageOptimizer = {
      async optimize(): Promise<OptimizedImage> {
        callCount++
        return { body: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' }
      },
    }
    const route = imageRoute({ optimizer: opt, cache })
    const url = `http://x/_place/img/400/jpeg/${encodeURIComponent('/x.jpg')}`
    // First request: cache miss → optimizer runs.
    const res1 = await route.handler(new Request(url))
    expect(res1.status).toBe(200)
    expect(callCount).toBe(1)
    // Second request: cache hit → optimizer not called.
    const res2 = await route.handler(new Request(url))
    expect(res2.status).toBe(200)
    expect(callCount).toBe(1)
  })

  test('optimizer error surfaces as 500', async () => {
    const opt: ImageOptimizer = {
      async optimize() {
        throw new Error('source not found')
      },
    }
    const route = imageRoute({ optimizer: opt })
    const res = await route.handler(
      new Request(`http://x/_place/img/400/jpeg/${encodeURIComponent('/missing.jpg')}`),
    )
    expect(res.status).toBe(500)
    expect(await res.text()).toContain('source not found')
  })

  test('emits long-cache headers (immutable variants)', async () => {
    const opt: ImageOptimizer = {
      async optimize() {
        return { body: new Uint8Array([1]), contentType: 'image/jpeg' }
      },
    }
    const route = imageRoute({ optimizer: opt })
    const res = await route.handler(
      new Request(`http://x/_place/img/400/jpeg/${encodeURIComponent('/x.jpg')}`),
    )
    expect(res.headers.get('Cache-Control')).toContain('immutable')
  })
})

describe('passthroughOptimizer — default no-op backend', () => {
  test('fetches the source URL and returns its bytes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'image/jpeg' },
        }),
    )
    try {
      const result = await passthroughOptimizer.optimize({
        src: 'https://cdn.example/cover.jpg',
        width: 400,
        format: 'jpeg',
      })
      expect(result.contentType).toBe('image/jpeg')
      expect(result.body.length).toBe(3)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test('reads relative paths from disk — fetch() rejects relative URLs', async () => {
    // The optimizer treats `<Img src="/cover.jpg">` as site-root-
    // relative — it strips the leading `/` and reads cwd-relative
    // (matches a `public/` layout or any static dir mounted at /).
    // Pre-fix this threw `TypeError: fetch() URL is invalid` because
    // the optimizer called `fetch('/cover.jpg')` which Bun rejects.
    //
    // Use node:fs for the test setup so the test works regardless
    // of whether vitest's env injects Bun globals — the optimizer
    // itself prefers Bun.file but falls back to node:fs/promises.
    const { writeFile, unlink } = await import('node:fs/promises')
    // Write into cwd so the optimizer's leading-slash strip lands
    // here (`/place-passthrough-test.jpg` → cwd-relative path).
    const filename = `_place-passthrough-${Date.now()}.jpg`
    const bytes = new Uint8Array([0x10, 0x20, 0x30, 0x40])
    await writeFile(filename, bytes)
    try {
      const result = await passthroughOptimizer.optimize({
        src: `/${filename}`, // leading slash → site-root → cwd-relative after strip
        width: 400,
        format: 'jpeg',
      })
      expect(Array.from(result.body)).toEqual(Array.from(bytes))
      expect(result.contentType).toMatch(/jpe?g/i)
    } finally {
      await unlink(filename).catch(() => {})
    }
  })

  test('throws a clear error when the relative file is missing', async () => {
    await expect(
      passthroughOptimizer.optimize({
        src: '/this-file-definitely-does-not-exist-123abc.jpg',
        width: 400,
        format: 'jpeg',
      }),
    ).rejects.toThrow(/file not found/i)
  })
})

describe('ImageBackend + contentHashedOptimizer — resize-only contract with content-addressed cache', () => {
  // The narrow ImageBackend interface lets resize libraries (sharp,
  // image-rs WASM, future Bun.image()) plug in with one method.
  // contentHashedOptimizer adapts ImageBackend → ImageOptimizer with
  // a SHA-256-of-source cache key so cache entries auto-invalidate
  // when the source bytes change — fixes Next.js's documented
  // image-cache invalidation footgun (vercel/next.js #35276).

  function fakeBackend(): ImageBackend & { calls: number } {
    let calls = 0
    return {
      get calls() {
        return calls
      },
      async resize(input: Uint8Array, opts) {
        calls++
        // Output is a deterministic transform of input + opts so we
        // can verify the cache reuses the right entry.
        const tag = new TextEncoder().encode(`${opts.format}@${opts.width}/`)
        const out = new Uint8Array(tag.length + input.length)
        out.set(tag, 0)
        out.set(input, tag.length)
        return out
      },
    } as ImageBackend & { calls: number }
  }

  function fakeFetch(bytes: Uint8Array, contentType = 'image/jpeg'): typeof fetch {
    return (async () =>
      new Response(bytes as unknown as BodyInit, {
        headers: { 'Content-Type': contentType },
      })) as unknown as typeof fetch
  }

  test('resize is called once; second call hits cache', async () => {
    const sourceBytes = new TextEncoder().encode('source-v1')
    const backend = fakeBackend()
    const opt = contentHashedOptimizer(backend, {
      cache: memoryStore(),
      fetch: fakeFetch(sourceBytes),
    })
    const r1 = await opt.optimize({ src: '/x.jpg', width: 400, format: 'webp' })
    const r2 = await opt.optimize({ src: '/x.jpg', width: 400, format: 'webp' })
    expect(backend.calls).toBe(1)
    expect(r1.body).toEqual(r2.body)
    expect(r1.contentType).toBe('image/webp')
  })

  test('source bytes change → cache key changes → resize re-runs', async () => {
    const cache = memoryStore()
    const backend = fakeBackend()
    // First "deploy": source-v1.
    const opt1 = contentHashedOptimizer(backend, {
      cache,
      fetch: fakeFetch(new TextEncoder().encode('source-v1')),
    })
    await opt1.optimize({ src: '/x.jpg', width: 400, format: 'webp' })
    expect(backend.calls).toBe(1)
    // Second "deploy": source bytes are different. Same URL, same opts,
    // but the content-hash differs — the cache miss triggers a fresh
    // resize, no manual invalidation needed.
    const opt2 = contentHashedOptimizer(backend, {
      cache,
      fetch: fakeFetch(new TextEncoder().encode('source-v2')),
    })
    await opt2.optimize({ src: '/x.jpg', width: 400, format: 'webp' })
    expect(backend.calls).toBe(2)
  })

  test('different widths or formats key separately', async () => {
    const cache = memoryStore()
    const backend = fakeBackend()
    const opt = contentHashedOptimizer(backend, {
      cache,
      fetch: fakeFetch(new TextEncoder().encode('source')),
    })
    await opt.optimize({ src: '/x.jpg', width: 400, format: 'webp' })
    await opt.optimize({ src: '/x.jpg', width: 800, format: 'webp' })
    await opt.optimize({ src: '/x.jpg', width: 400, format: 'avif' })
    // Three distinct cache entries — three resize calls.
    expect(backend.calls).toBe(3)
  })

  test("format='original' bypasses backend; returns source bytes + source content-type", async () => {
    const sourceBytes = new TextEncoder().encode('the-original')
    const backend = fakeBackend()
    const opt = contentHashedOptimizer(backend, {
      cache: memoryStore(),
      fetch: fakeFetch(sourceBytes, 'image/jpeg'),
    })
    const r = await opt.optimize({ src: '/x.jpg', width: 400, format: 'original' })
    expect(backend.calls).toBe(0)
    expect(r.contentType).toBe('image/jpeg')
    expect(r.body).toEqual(sourceBytes)
  })

  test('without a cache, resize runs every call', async () => {
    const backend = fakeBackend()
    const opt = contentHashedOptimizer(backend, {
      fetch: fakeFetch(new TextEncoder().encode('source')),
    })
    await opt.optimize({ src: '/x.jpg', width: 400, format: 'webp' })
    await opt.optimize({ src: '/x.jpg', width: 400, format: 'webp' })
    expect(backend.calls).toBe(2)
  })

  test('fetch failure → optimizer rejects with the status', async () => {
    const failingFetch = (async () =>
      new Response('not found', { status: 404 })) as unknown as typeof fetch
    const opt = contentHashedOptimizer(fakeBackend(), { fetch: failingFetch })
    await expect(opt.optimize({ src: '/missing.jpg', width: 400, format: 'webp' })).rejects.toThrow(
      /contentHashedOptimizer.*404/,
    )
  })
})

describe('sharpBackend — real impl (0.9.0)', () => {
  test('throws a clear "install sharp" error when the dep is missing', async () => {
    // The framework declares `sharp` as an optional peer dep. When
    // it's not installed (e.g. in this monorepo's test environment),
    // sharpBackend() should fail fast with an actionable message that
    // points at `bun add sharp` — not an opaque module-not-found.
    const backend = sharpBackend()
    await expect(backend.resize(new Uint8Array(), { width: 400, format: 'webp' })).rejects.toThrow(
      /sharpBackend\(\): can't load 'sharp'/,
    )
  })

  test('error message includes the install command', async () => {
    const backend = sharpBackend()
    await expect(backend.resize(new Uint8Array(), { width: 400, format: 'webp' })).rejects.toThrow(
      /bun add sharp/,
    )
  })
})
