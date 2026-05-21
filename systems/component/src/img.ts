// @place-ts/component <Img> helper. Phase 4.7.
//
// A typed image component that emits semantic `<img srcset>` markup.
// Variant generation (resize / format negotiation) is delegated to a
// pluggable `ImageOptimizer` — the framework provides the URL-shape
// contract and lazy-cached request handling; the optimizer plugs in
// the actual resize backend (sharp, Bun's image API when it lands,
// libvips, an external service like imgproxy, etc.).
//
// Better than Next's `<Image>`:
//   - Lazy variant generation, not eager build-time. The first request
//     for `/_place/img/cover.jpg?w=800` builds and caches; subsequent
//     requests serve from the same `CacheStore` ISR uses.
//   - No `images.domains` allowlist boilerplate in config — the
//     optimizer decides what URLs it accepts.
//   - No magic blur-placeholder generation; if you want one, the
//     optimizer can produce it.
//   - The component just emits markup; opinionated about srcset shape,
//     not about backend.
//
// Phase 4.7 status: SCAFFOLD. The default optimizer is `passthrough`
// (returns the source unchanged). Real resize backends ship in Phase 5
// when a workload demands it. The markup contract + URL routing +
// caching are all in place so swapping optimizers is one line.

import type { CacheStore } from './cache.ts'
import { type ElementProps, el, type View } from './index.ts'

export interface ImgProps {
  /** Source URL — relative to site root or absolute. */
  src: string
  /** Required for accessibility. */
  alt: string
  /**
   * Render at these widths. Generates `srcset="… Nw"` entries. Pick
   * widths that match your layout breakpoints; the browser picks the
   * smallest that's >= the device's CSS pixel width.
   * Default: `[400, 800, 1600]` for typical layouts.
   */
  widths?: number[]
  /**
   * Output format. `'auto'` (default) emits `<picture>` with a webp
   * source first, falling back to the original. Passing a single format
   * skips the `<picture>` wrapper.
   */
  format?: 'auto' | 'webp' | 'avif' | 'jpeg' | 'png' | 'original'
  /** Lazy-load via `loading="lazy"`. Default: `true`. */
  lazy?: boolean
  /** Async-decode hint. Default: `true`. */
  async?: boolean
  /**
   * Inline width / height to prevent layout shift. Strongly recommended.
   * If known, set both — the browser reserves the right aspect ratio.
   */
  width?: number
  height?: number
  /** Pass-through class. */
  class?: string
  /**
   * `sizes` attribute — describes the image's CSS layout to the browser
   * so it picks the right srcset entry. Example:
   *   `(max-width: 768px) 100vw, 50vw`
   */
  sizes?: string
}

export interface ImageRequest {
  /** Source URL the user passed to `<Img src>`. */
  src: string
  /** Target width. */
  width: number
  /** Target format. */
  format: 'webp' | 'avif' | 'jpeg' | 'png' | 'original'
}

export interface OptimizedImage {
  /** The bytes of the optimized image. */
  body: Uint8Array
  /** MIME type of the output. */
  contentType: string
}

export interface ImageOptimizer {
  /** Optimize a source image for a given (width, format). Returns the
   *  bytes + content type. Throws on failure (e.g. source not found). */
  optimize(req: ImageRequest): Promise<OptimizedImage>
}

// Content-type lookup for the common static-asset extensions. The
// passthrough optimizer reads from disk for relative `src` paths;
// the resulting `Uint8Array` has no MIME info, so we derive one from
// the extension. Unknown extensions fall back to a generic binary
// type — the browser will refuse to render an `<img>` that lands
// here, which is the right failure mode.
const IMG_MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function mimeFromPath(path: string): string {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  const ext = path.slice(dot).toLowerCase()
  return IMG_MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/**
 * Default optimizer: returns the source unchanged. A no-op so the
 * component works out of the box; production deployments swap in a
 * real backend (e.g. `sharpOptimizer()` from a future Phase 5 helper).
 *
 * Dual source handling:
 *   - Absolute URLs (`https://…`, `data:`, etc.): `fetch()` works.
 *   - Relative paths (`/cover.jpg`): Bun's `fetch()` rejects these
 *     with `TypeError: fetch() URL is invalid`. We instead read
 *     directly from the filesystem, treating the path as relative
 *     to the current working directory (the standard place app
 *     layout: `bun src/app.ts` from the project root puts static
 *     files under `./public` or wherever the user's `static:`
 *     config points). The MIME type is inferred from the
 *     extension since `Bun.file()` doesn't expose one.
 */
export const passthroughOptimizer: ImageOptimizer = {
  async optimize(req) {
    const src = req.src
    // Absolute (scheme://) or data: URL — use fetch.
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
      const res = await fetch(src)
      if (!res.ok) {
        throw new Error(`passthroughOptimizer: ${src} → ${res.status}`)
      }
      return {
        body: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get('Content-Type') ?? mimeFromPath(src),
      }
    }
    // Relative path — read from disk. Bun runtime uses `Bun.file()`
    // (zero-copy, type-tagged); Node + node-adapter deployments
    // fall back to `node:fs/promises`. Apps that serve out of a
    // `public/` dir typically configure `static:` mounts in
    // serve() options; passthroughOptimizer is the "works out of
    // the box" default and the cwd-relative read matches what
    // `bun src/app.ts` (or `node …`) does anyway.
    //
    // Drop a single leading `/` so `/cover.jpg` reads `./cover.jpg`
    // relative to cwd. Apps wanting a different layout supply
    // their own optimizer.
    const path = src.startsWith('/') ? src.slice(1) : src
    if (typeof Bun !== 'undefined' && typeof Bun.file === 'function') {
      const f = Bun.file(path)
      if (!(await f.exists())) {
        throw new Error(
          `passthroughOptimizer: file not found at '${path}' (resolved from src '${src}')`,
        )
      }
      return {
        body: new Uint8Array(await f.arrayBuffer()),
        contentType: f.type || mimeFromPath(path),
      }
    }
    // Node fallback. Dynamic-imported so the Bun-only build path
    // doesn't pull `node:fs/promises` into the closure.
    try {
      const { readFile } = await import('node:fs/promises')
      const buf = await readFile(path)
      return { body: new Uint8Array(buf), contentType: mimeFromPath(path) }
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'ENOENT') {
        throw new Error(
          `passthroughOptimizer: file not found at '${path}' (resolved from src '${src}')`,
        )
      }
      throw e
    }
  },
}

const DEFAULT_WIDTHS: readonly number[] = [400, 800, 1600] as const
const DEFAULT_BASE_PATH = '/_place/img'

const escapeAttr = (s: string): string =>
  s.replace(/[&"<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '"' ? '&quot;' : c === '<' ? '&lt;' : '&gt;',
  )

/**
 * Build the URL the framework's image route serves from. Encodes the
 * request as `/_place/img/{w}/{format}/{src}` so each variant has a
 * stable cache key.
 */
function buildVariantUrl(src: string, width: number, format: string, basePath: string): string {
  // Encode src so query strings or special chars in the source URL
  // don't collide with the framework's URL shape.
  return `${basePath}/${width}/${format}/${encodeURIComponent(src)}`
}

// Build the JSX-shaped props bag for an <img> tag from ImgProps. Shared
// between the View factory and the string emitter.
function buildImgAttrs(
  props: ImgProps,
  format: string,
  widths: readonly number[],
  basePath: string,
): ElementProps {
  const srcset = widths
    .map((w) => `${buildVariantUrl(props.src, w, format, basePath)} ${w}w`)
    .join(', ')
  const fallbackSrc = buildVariantUrl(
    props.src,
    widths[widths.length - 1] as number,
    format,
    basePath,
  )
  // ElementProps' index signature requires bracket access for non-
  // first-class keys; build via object literals to keep readable.
  const attrs: ElementProps = {
    src: fallbackSrc,
    srcset,
    alt: props.alt,
    ...(props.lazy !== false ? { loading: 'lazy' } : {}),
    ...(props.async !== false ? { decoding: 'async' } : {}),
    ...(props.width ? { width: props.width } : {}),
    ...(props.height ? { height: props.height } : {}),
    ...(props.class ? { class: props.class } : {}),
    ...(props.sizes ? { sizes: props.sizes } : {}),
  }
  return attrs
}

/**
 * JSX-friendly image factory. Returns a `View` you can drop directly
 * into JSX:
 *
 * ```tsx
 * <Img src="/cover.jpg" alt="Cover" widths={[400, 800, 1600]} lazy />
 * ```
 *
 * Default `format: 'auto'` emits `<picture>` with a webp source first
 * and the original as a fallback `<img>`. Set `format: 'webp'`/`'jpeg'`/
 * etc. to skip the `<picture>` wrapper.
 *
 * The variant URLs all point at `/_place/img/{w}/{format}/{encoded-src}`
 * — register `imageRoute()` on `serve({ routes })` to actually serve
 * them, with a `CacheStore` for lazy build-and-cache semantics.
 */
export function Img(props: ImgProps): View {
  const widths = props.widths ?? DEFAULT_WIDTHS
  const format = props.format ?? 'auto'
  const basePath = DEFAULT_BASE_PATH

  if (format === 'auto') {
    const webpSrcset = widths
      .map((w) => `${buildVariantUrl(props.src, w, 'webp', basePath)} ${w}w`)
      .join(', ')
    const sourceAttrs: ElementProps = {
      type: 'image/webp',
      srcset: webpSrcset,
      ...(props.sizes ? { sizes: props.sizes } : {}),
    }
    return el('picture', {}, [
      el('source', sourceAttrs),
      el('img', buildImgAttrs(props, 'original', widths, basePath)),
    ])
  }

  return el('img', buildImgAttrs(props, format, widths, basePath))
}

/**
 * String-form of `Img` for callers that need raw HTML (build scripts,
 * markdown renderers, etc.). Equivalent to `Img(props).toHtml?.() ?? ''`.
 */
export function imgHtml(props: ImgProps, basePath = DEFAULT_BASE_PATH): string {
  const widths = props.widths ?? DEFAULT_WIDTHS
  const format = props.format ?? 'auto'
  const lazy = props.lazy !== false
  const asyncDecode = props.async !== false
  const sizes = props.sizes

  const baseAttrs: string[] = []
  baseAttrs.push(`alt="${escapeAttr(props.alt)}"`)
  if (lazy) baseAttrs.push('loading="lazy"')
  if (asyncDecode) baseAttrs.push('decoding="async"')
  if (props.width) baseAttrs.push(`width="${props.width}"`)
  if (props.height) baseAttrs.push(`height="${props.height}"`)
  if (props.class) baseAttrs.push(`class="${escapeAttr(props.class)}"`)
  if (sizes) baseAttrs.push(`sizes="${escapeAttr(sizes)}"`)

  const renderImg = (fmt: string): string => {
    const srcset = widths
      .map((w) => `${buildVariantUrl(props.src, w, fmt, basePath)} ${w}w`)
      .join(', ')
    const fallbackSrc = buildVariantUrl(
      props.src,
      widths[widths.length - 1] as number,
      fmt,
      basePath,
    )
    return `<img src="${escapeAttr(fallbackSrc)}" srcset="${escapeAttr(srcset)}" ${baseAttrs.join(' ')}>`
  }

  if (format === 'auto') {
    // <picture> with webp source first, fallback to the original src
    // (using the browser's heuristic — modern browsers all support webp;
    // those that don't get the original).
    const webpSrcset = widths
      .map((w) => `${buildVariantUrl(props.src, w, 'webp', basePath)} ${w}w`)
      .join(', ')
    return (
      `<picture>` +
      `<source type="image/webp" srcset="${escapeAttr(webpSrcset)}"${sizes ? ` sizes="${escapeAttr(sizes)}"` : ''}>` +
      renderImg('original') +
      `</picture>`
    )
  }

  return renderImg(format)
}

/**
 * Build the `/_place/img/*` route handler. Plug into `serve({ routes })`.
 * The handler:
 *   1. Parses width + format + src from the URL.
 *   2. Looks up the cache (if provided) — serves cached on hit.
 *   3. Calls the optimizer to build the variant.
 *   4. Stores in cache, serves the bytes.
 *
 * The cache key is the request URL itself; tags can be added later for
 * bulk invalidation when source images change.
 */
export function imageRoute(options: {
  optimizer: ImageOptimizer
  cache?: CacheStore
  basePath?: string
}): {
  pattern: string
  handler: (req: Request) => Promise<Response>
} {
  const basePath = options.basePath ?? DEFAULT_BASE_PATH
  const pattern = `${basePath}/:width/:format/:src`

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const path = url.pathname
    if (!path.startsWith(`${basePath}/`)) {
      return new Response('Not Found', { status: 404 })
    }
    const rest = path.slice(basePath.length + 1) // drop the leading "/img/"
    const slash1 = rest.indexOf('/')
    const slash2 = rest.indexOf('/', slash1 + 1)
    if (slash1 < 0 || slash2 < 0) {
      return new Response('imageRoute: malformed URL', { status: 400 })
    }
    const widthStr = rest.slice(0, slash1)
    const format = rest.slice(slash1 + 1, slash2) as ImageRequest['format']
    const src = decodeURIComponent(rest.slice(slash2 + 1))
    const width = Number.parseInt(widthStr, 10)
    if (!Number.isFinite(width) || width <= 0 || width > 8192) {
      return new Response('imageRoute: invalid width', { status: 400 })
    }
    if (!['webp', 'avif', 'jpeg', 'png', 'original'].includes(format)) {
      return new Response('imageRoute: invalid format', { status: 400 })
    }

    const cacheKey = url.pathname

    // Cache lookup.
    if (options.cache) {
      const cached = await options.cache.get(cacheKey)
      if (cached) {
        return new Response(cached.body as string | Uint8Array<ArrayBuffer>, {
          headers: cached.headers,
        })
      }
    }

    // Run the optimizer.
    let result: OptimizedImage
    try {
      result = await options.optimizer.optimize({ src, width, format })
    } catch (e) {
      return new Response(e instanceof Error ? e.message : String(e), {
        status: 500,
      })
    }

    const headers = {
      'Content-Type': result.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    }
    if (options.cache) {
      await options.cache.set(cacheKey, {
        body: result.body,
        headers,
        builtAt: Date.now(),
      })
    }
    return new Response(result.body as Uint8Array<ArrayBuffer>, { headers })
  }

  return { pattern, handler }
}

// ===== Image backend (resize-only) + content-hashed optimizer =====
//
// `ImageOptimizer` (above) is the framework's outer contract — given a
// (src, width, format) request, return optimized bytes. Useful for
// pluggable end-to-end backends (an external imgproxy service, etc.).
//
// `ImageBackend` is a NARROWER inner contract: given source bytes +
// resize options, return resized bytes. One method, no source fetching,
// no content negotiation. This is the right shape for libraries
// (sharp, image-rs, photon-wasm) that just resize.
//
// `contentHashedOptimizer(backend)` adapts `ImageBackend` → `ImageOptimizer`
// while solving Next.js's documented image-cache invalidation footgun
// (vercel/next.js #35276): it content-hashes the source bytes into the
// cache key, so cache entries auto-invalidate when the source changes.
// Old entries age out via `CacheStore.delete` policies; cache-control
// headers can be `immutable, max-age=31536000` because keys are content-
// addressed by construction.

export interface ResizeOpts {
  width: number
  format: 'webp' | 'avif' | 'jpeg' | 'png' | 'original'
  /**
   * JPEG/WebP quality 1-100. Default 75. Optimizers may ignore for
   * lossless formats. AVIF encode is 5-10x slower than WebP — generate
   * AVIF only for build-time / pre-warmed assets, not on the request
   * path. The default `<Img>` markup emits `<source type=image/avif>`
   * first; if you don't want that, set `format` explicitly.
   */
  quality?: number
}

/**
 * Narrow resize-only contract. Implementations: sharp (default for
 * Node/Bun servers), image-rs / photon (WASM, edge runtimes), Bun's
 * future native `Bun.image()` when it lands.
 *
 * One method, on purpose. Every additional method is a portability tax
 * on alternate backends (e.g. `metadata()` would force every backend to
 * implement EXIF parsing). Add new methods only when a concrete
 * consumer needs them.
 */
export interface ImageBackend {
  /**
   * Resize `input` (source image bytes) to the given `opts`. Returns
   * the resized bytes. Throws on decode/encode failure (the optimizer
   * wrapper turns this into a 500 to the caller).
   */
  resize(input: Uint8Array, opts: ResizeOpts): Promise<Uint8Array>
}

/**
 * Stub backend that throws on first use with a "install sharp" message.
 * Ship this as the named-export `sharpBackend` so apps can write
 * `optimizer: contentHashedOptimizer(sharpBackend())` and discover at
 * startup that they need to add the dep — better than a runtime 500.
 *
 * Real sharp wiring is deferred (see roadmap: image optimizer backend).
 * The interface above ships now so consumers can wire their own.
 */
export function sharpBackend(): ImageBackend {
  return {
    async resize() {
      throw new Error(
        'sharpBackend(): the sharp-backed image resize implementation has not yet shipped. ' +
          'Track the roadmap entry "Image optimizer backend (sharp)" or supply your own ' +
          'ImageBackend ({ resize(input, opts) }) and pass it through ' +
          'contentHashedOptimizer().',
      )
    },
  }
}

/**
 * Content-MIME map. Keep in sync with `ImageRequest['format']`.
 * `original` is intentionally absent — when the format is `original`,
 * the optimizer passes through the source's content type from the
 * fetch response.
 */
const FORMAT_MIME: Record<Exclude<ResizeOpts['format'], 'original'>, string> = {
  webp: 'image/webp',
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

/**
 * Adapt an `ImageBackend` to the framework's `ImageOptimizer` contract,
 * with content-hashed cache keys layered on top of the supplied
 * `CacheStore`. The cache invalidates automatically when the source
 * bytes change — the key includes a SHA-256 prefix of the source.
 *
 * Without `cache`, every request fetches + resizes; useful for tests
 * but not for production. With `cache`, the second request for any
 * (src, width, format) tuple short-circuits to the stored bytes.
 *
 * Source fetching: relative `src` resolves against `globalThis.fetch`
 * (so works under Bun where same-origin static assets are reachable)
 * unless `fetch` is overridden.
 */
export interface ContentHashedOptimizerOptions {
  /** Optional cache store. Without it, every request re-resizes. */
  cache?: CacheStore
  /** Override the source fetcher (defaults to `globalThis.fetch`). */
  fetch?: typeof fetch
}

export function contentHashedOptimizer(
  backend: ImageBackend,
  options: ContentHashedOptimizerOptions = {},
): ImageOptimizer {
  const fetchFn = options.fetch ?? fetch
  return {
    async optimize(req) {
      // 1. Fetch source bytes. Required to compute the content hash.
      const res = await fetchFn(req.src)
      if (!res.ok) {
        throw new Error(`contentHashedOptimizer: ${req.src} → ${res.status}`)
      }
      const sourceBytes = new Uint8Array(await res.arrayBuffer())
      const sourceContentType = res.headers.get('Content-Type') ?? 'application/octet-stream'

      // 2. Compute content-addressed cache key. SHA-256 of source bytes
      //    + the resize parameters. Hex-encoded; 16 hex chars (64 bits)
      //    is enough to avoid collisions for realistic asset counts.
      const sourceHash = await sha256Hex(sourceBytes, 16)
      const cacheKey = `img:${sourceHash}:${req.width}:${req.format}`

      // 3. Cache lookup.
      if (options.cache) {
        const cached = await options.cache.get(cacheKey)
        if (cached) {
          return {
            body: cached.body as Uint8Array,
            contentType: (cached.headers['Content-Type'] ?? sourceContentType) as string,
          }
        }
      }

      // 4. Resize via backend. `original` skips the resize entirely —
      //    just returns the source bytes with the original content type.
      let outBytes: Uint8Array
      let outContentType: string
      if (req.format === 'original') {
        outBytes = sourceBytes
        outContentType = sourceContentType
      } else {
        outBytes = await backend.resize(sourceBytes, {
          width: req.width,
          format: req.format,
        })
        outContentType = FORMAT_MIME[req.format]
      }

      // 5. Cache write. We re-use the inner `Content-Type` for the
      //    stored entry; the framework's outer `imageRoute` adds
      //    `Cache-Control: immutable` for the served response.
      if (options.cache) {
        await options.cache.set(cacheKey, {
          body: outBytes,
          headers: { 'Content-Type': outContentType },
          builtAt: Date.now(),
        })
      }

      return { body: outBytes, contentType: outContentType }
    },
  }
}

/**
 * SHA-256 hex digest of `bytes`, truncated to `chars` hex characters.
 * Uses Web Crypto (available under Bun + browsers + Node 19+).
 * Exported for unit tests; not part of the public surface.
 */
export async function _sha256Hex(bytes: Uint8Array, chars = 16): Promise<string> {
  return sha256Hex(bytes, chars)
}

async function sha256Hex(bytes: Uint8Array, chars: number): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  const view = new Uint8Array(digest)
  const byteCount = Math.ceil(chars / 2)
  let hex = ''
  for (let i = 0; i < byteCount; i++) {
    const b = view[i] ?? 0
    hex += b.toString(16).padStart(2, '0')
  }
  return hex.slice(0, chars)
}
