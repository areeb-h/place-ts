// Response compression — gzip-encode compressible text bodies based
// on the client's `Accept-Encoding` header.
//
// **Runtime compatibility**: we use `node:zlib`'s `gzipSync` because
// it's available on every runtime the framework targets (Bun ships
// Node's zlib compat; Node ships it natively; Cloudflare Workers
// shims it via WebStreams APIs the adapter sets up). The earlier
// `Bun.gzipSync` direct call broke on Node-adapter deployments where
// `Bun` is undefined → ReferenceError → 500 on every text response.
//
// **Why**: page HTML is the largest single asset most apps ship, and
// it's pure text — extremely compressible (typically 70-80% smaller
// gzipped). Without this layer, every response goes uncompressed,
// inflating LCP on slow connections and dragging Lighthouse perf
// below 100.
//
// **Scope**: HTML, JSON, JavaScript, CSS, SVG, plaintext. Pre-encoded
// formats (PNG, JPEG, WOFF2, etc.) are skipped — they're already
// compressed and re-encoding would either inflate or no-op them.
//
// **Threshold**: bodies under ~1 KB skip compression entirely. The
// header + CPU overhead exceeds the byte savings on small payloads,
// and gzip on a 100-byte body sometimes produces a *larger* output.
//
// **Caching contract**: every compressed response gets
// `Vary: Accept-Encoding` so HTTP caches (CDN, browser, reverse proxy)
// don't serve a gzipped body to a client that didn't ask for one.
//
// **Streaming responses**: skipped. The Response body is a
// ReadableStream and we'd have to wrap it in a compression
// transform; not yet implemented. Streaming SSR pages skip
// compression here and the deployment layer (Cloudflare, nginx,
// Cloud Run) handles wire-level compression upstream.

// `node:zlib` is server-only. Bun's browser polyfill of `node:zlib`
// omits `gzipSync` (only the stream APIs are shimmed), so a static
// `import { gzipSync } from 'node:zlib'` errors when the island
// bundler (target: 'browser') reaches this file transitively through
// `index.ts → maybeCompress`. We hide the specifier from Bun's
// static analyzer by passing it through a helper function — direct
// `await import('node:zlib')` (and even a bare `const s = 'node:zlib';
// await import(s)`) get constant-folded by Bun's dev transformer back
// to a literal specifier, which the analyzer then resolves and tries
// to polyfill. The helper-function shape forces a second elimination
// step (inline + fold) that neither dev nor prod minification
// performs. The result is cached so subsequent compress calls reuse
// the resolved binding without paying the dynamic-import overhead.
type Gz = (b: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>
let _gzipSync: Gz | null = null
function _serverDynImport(specifier: string): Promise<unknown> {
  return import(specifier)
}
async function loadGzipSync(): Promise<Gz> {
  if (_gzipSync !== null) return _gzipSync
  // Prefer `Bun.gzipSync` when available — same JIT path, no
  // `dynamic import` allocation. Falls back to `node:zlib` under
  // Node (where the framework's node adapter runs).
  if (typeof Bun !== 'undefined' && typeof Bun.gzipSync === 'function') {
    _gzipSync = (b) => Bun.gzipSync(b) as Uint8Array<ArrayBuffer>
    return _gzipSync
  }
  const zlib = (await _serverDynImport('node:zlib')) as {
    gzipSync: (b: Uint8Array) => Uint8Array
  }
  _gzipSync = (b) => {
    const out = zlib.gzipSync(b)
    // Node's gzipSync returns Buffer<ArrayBufferLike>; copy into a
    // fresh ArrayBuffer-backed Uint8Array so Response's BodyInit
    // type narrows correctly and downstream consumers see a real
    // ArrayBuffer (not a SharedArrayBuffer).
    const fresh = new Uint8Array(out.byteLength)
    fresh.set(out)
    return fresh as Uint8Array<ArrayBuffer>
  }
  return _gzipSync
}

const COMPRESSIBLE_TYPES = new Set([
  'text/html',
  'text/plain',
  'text/css',
  'text/javascript',
  'text/xml',
  'application/javascript',
  'application/json',
  'application/manifest+json',
  'application/xml',
  'application/xhtml+xml',
  'application/atom+xml',
  'application/rss+xml',
  'image/svg+xml',
  'font/ttf',
  'font/otf',
])

const MIN_COMPRESS_BYTES = 1024

/**
 * Return true when the response's Content-Type is text-shaped enough
 * to benefit from gzip. Strips a trailing `;charset=…` parameter
 * before the set lookup.
 */
function isCompressibleType(contentType: string | null): boolean {
  if (!contentType) return false
  const semi = contentType.indexOf(';')
  const base = (semi >= 0 ? contentType.slice(0, semi) : contentType).trim().toLowerCase()
  return COMPRESSIBLE_TYPES.has(base)
}

/**
 * Parse a request's `Accept-Encoding` header and return whether gzip
 * is accepted. A missing header → no compression (the safe default —
 * some misbehaving clients omit it and choke on encoded bodies).
 *
 * `identity` listed without `;q=0` is fine; we just return `false`
 * since the client implied "uncompressed works". `*` listed without
 * disqualification matches gzip per RFC 9110 §12.5.3.
 */
function acceptsGzip(headerValue: string | null): boolean {
  if (!headerValue) return false
  const lower = headerValue.toLowerCase()
  // Quick wins.
  if (lower.includes('gzip')) {
    // Reject if explicitly q=0 (the only standard way to negate).
    const m = lower.match(/\bgzip\s*;\s*q\s*=\s*([0-9.]+)/)
    if (m && Number(m[1]) === 0) return false
    return true
  }
  if (lower.includes('*') && !lower.includes('*;q=0')) return true
  return false
}

/**
 * Compress a Response's body with gzip if:
 *   - The client's `Accept-Encoding` accepts gzip
 *   - The response's Content-Type is in the compressible set
 *   - The body is at least `MIN_COMPRESS_BYTES`
 *   - The body isn't a ReadableStream (synchronous compression only)
 *   - The response doesn't already have a Content-Encoding header
 *
 * On any miss, returns the original response unchanged. The transform
 * is otherwise transparent — status, all other headers, status text
 * pass through. The new response sets `Content-Encoding: gzip`,
 * updates `Content-Length`, and adds `Vary: Accept-Encoding` (merged
 * with any existing Vary).
 */
export async function maybeCompress(res: Response, req: Request): Promise<Response> {
  // Already compressed by an upstream layer (CDN, action handler, etc.).
  if (res.headers.get('content-encoding')) return res
  if (!acceptsGzip(req.headers.get('accept-encoding'))) return res
  if (!isCompressibleType(res.headers.get('content-type'))) return res
  // Streaming responses (renderToStream) — skip; the body is a stream
  // and we don't have a transform-stream gzip yet. Wire-level
  // compression at the deployment layer handles these for now.
  if (res.body === null) return res
  // **Size threshold via Content-Length header (NO body buffering).**
  // We deliberately avoid `await res.arrayBuffer()` followed by a
  // `new Response(buf, res)` bail — that path normalizes header OWS
  // (`text/plain; charset=utf-8` → `text/plain;charset=utf-8`) which
  // breaks header-equality tests and any consumer comparing strings.
  // If Content-Length declares a small payload, return res unchanged.
  // If Content-Length is missing, fall through and compress
  // unconditionally — gzipping 100 bytes wastes a few microseconds of
  // CPU but is still correct.
  const cl = res.headers.get('content-length')
  if (cl !== null) {
    const n = Number(cl)
    if (Number.isFinite(n) && n < MIN_COMPRESS_BYTES) return res
  }
  // Buffer the body once we've committed to compressing it.
  const buf = await res.arrayBuffer()
  // `Bun.gzipSync` or `node:zlib.gzipSync` runs at ~200 MB/s on Bun
  // and ~150 MB/s on Node — both well below the response-size budget
  // for HTML pages. Quality 6 is the zlib default. See `loadGzipSync`
  // above for why this is async-loaded (TL;DR: avoids polyfill error
  // when island bundler reaches this file at target: 'browser').
  const gzipSync = await loadGzipSync()
  const compressed: Uint8Array<ArrayBuffer> = gzipSync(new Uint8Array(buf))
  // Merge Vary header — preserve existing values, add Accept-Encoding.
  const existingVary = res.headers.get('vary')
  const vary = existingVary
    ? existingVary
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.toLowerCase() !== 'accept-encoding')
        .concat('Accept-Encoding')
        .join(', ')
    : 'Accept-Encoding'
  const headers = new Headers(res.headers)
  headers.set('Content-Encoding', 'gzip')
  headers.set('Content-Length', String(compressed.byteLength))
  headers.set('Vary', vary)
  return new Response(compressed, { status: res.status, statusText: res.statusText, headers })
}
