// @place-ts/component buildStatic — pre-render Pages to HTML at build time.
//
// Walks a `routes` map (same shape `serve()` accepts), invokes
// `renderPage()` for each page, writes the resulting HTML to
// `dist/static/<path>/index.html`. Dynamic routes (`/posts/:id`) opt in
// via the page's `getStaticPaths()` factory which yields the concrete
// param maps to pre-render.
//
//   import { buildStatic } from '@place-ts/component'
//   import { home, about, post } from './pages'
//
//   await buildStatic({
//     outDir: './dist/static',
//     routes: {
//       '/':         home,
//       '/about':    about,
//       '/posts/:id': post,  // post.getStaticPaths returns [{id: 'a'}, …]
//     },
//   })
//
// Output:
//   dist/static/index.html
//   dist/static/about/index.html
//   dist/static/posts/a/index.html
//   dist/static/posts/b/index.html
//
// What this DOES:
//   - Re-uses the same `renderPage` machinery as runtime SSR — meta,
//     styles, load(), tailwind, all work identically.
//   - Resolves dynamic routes via `getStaticPaths()` per page.
//   - Optionally bundles the client entry too (for hydratable static
//     sites — the static HTML still references `/client.js`).
//
// What this does NOT do:
//   - Stream / suspense. Static builds are synchronous; pages with
//     `streaming: true` get rendered via `renderToString` fallback (the
//     suspense boundary's sync path emits fallback content, NOT the
//     real resource value).
//   - Per-page security headers (CSP nonce, HSTS). Static files are
//     served by your CDN; configure those headers there.
//   - Auto-discover routes from a directory. Routes are still data —
//     pass them explicitly. (No file-system routing — that's the whole
//     point.)

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type Route as RouteMatcher, route as routeFactory } from '@place-ts/routing'
import { isPage, renderPage } from './index.ts'
import type { AnyPage } from './page.ts'
import type { ServeRoutes } from './serve.ts'

export interface BuildStaticOptions {
  /** Same routes map shape `serve()` accepts. Pages are pre-rendered;
   *  raw `(req, params) => Response` handlers are skipped (those need
   *  a live server). */
  routes: ServeRoutes
  /** Where to write the rendered HTML. Created if missing. */
  outDir: string
  /** Pre-built client bundle string. Optional; written to `<outDir>/client.js`
   *  if provided. The static HTML's `<script src="/client.js">` references
   *  this. For SSR-only static sites without hydration, omit. */
  clientJs?: string
  /** URL path the client bundle is served at. Default: `/client.js`. */
  clientPath?: string
  /** Origin used for the synthetic Request passed to `renderPage`.
   *  Default: `http://localhost`. The path part is the route's pattern;
   *  the origin only matters if your `url()` reads from `req.url`. */
  origin?: string
  /** Hook called once per built page. Useful for logging progress. */
  onPage?: (info: { path: string; bytes: number }) => void
}

export interface BuildStaticResult {
  pages: Array<{ path: string; bytes: number }>
}

// Resolve the concrete paths to render for a route key.
//   - Static pattern → one entry: the pattern itself, with empty params.
//   - Dynamic pattern → call page.getStaticPaths(), substitute via the
//     route()-returned matcher.
async function resolvePaths(
  page: AnyPage,
  pattern: string,
): Promise<Array<{ path: string; params: Record<string, string> }>> {
  const isDynamic = pattern.includes(':')
  if (!isDynamic) {
    return [{ path: pattern, params: {} }]
  }
  if (!page.getStaticPaths) {
    throw new Error(
      `buildStatic: route pattern '${pattern}' contains parameters but the page has no ` +
        `getStaticPaths() function. Add one returning the concrete params to pre-render.`,
    )
  }
  const paramSets = await page.getStaticPaths()
  // The runtime pattern is a plain `string`, so `route(pattern)`'s
  // inferred params type is `Record<string, never>` — we know better
  // (the user supplies real string params). Cast via unknown.
  const matcher = routeFactory(pattern) as unknown as RouteMatcher<Record<string, string>>
  return paramSets.map((params) => ({
    path: matcher(params),
    params,
  }))
}

// Map a URL path to an output filename.
//   `/`              → `index.html`
//   `/about`         → `about/index.html`
//   `/posts/a`       → `posts/a/index.html`
//   `/foo.json`      → `foo.json`              (extension preserved)
function fileFor(urlPath: string): string {
  const trimmed = urlPath.replace(/^\/|\/$/g, '')
  if (trimmed === '') return 'index.html'
  // If the path already has an extension, use it as-is. Otherwise wrap
  // in a directory + index.html so the static host can serve clean URLs.
  if (/\.[a-zA-Z0-9]+$/.test(trimmed)) return trimmed
  return `${trimmed}/index.html`
}

/**
 * Walk `routes`, render each Page (recursively for dynamic routes), and
 * write the resulting HTML files to `outDir`. Returns the list of
 * rendered pages.
 */
export async function buildStatic(options: BuildStaticOptions): Promise<BuildStaticResult> {
  const outDir = options.outDir
  const clientPath = options.clientPath ?? '/client.js'
  const origin = options.origin ?? 'http://localhost'
  const pages: Array<{ path: string; bytes: number }> = []

  await mkdir(outDir, { recursive: true })

  // Optional client bundle.
  if (options.clientJs !== undefined) {
    const clientFile = join(outDir, clientPath.replace(/^\//, ''))
    await mkdir(dirname(clientFile), { recursive: true })
    await writeFile(clientFile, options.clientJs, 'utf-8')
  }

  for (const [key, val] of Object.entries(options.routes)) {
    const space = key.indexOf(' ')
    const method = space >= 0 ? key.slice(0, space).toUpperCase() : 'GET'
    const pattern = space >= 0 ? key.slice(space + 1).trim() : key

    // Static can only represent GET. Skip POST/PUT/DELETE handlers and
    // anything that's not a Page.
    if (method !== 'GET' && method !== '*') continue
    if (!isPage(val)) continue

    const paths = await resolvePaths(val, pattern)
    for (const { path, params } of paths) {
      const req = new Request(`${origin}${path}`)
      const res = await renderPage(val, req, params, {
        ...(options.clientJs !== undefined ? { bootstrap: clientPath } : {}),
      })
      const html = await res.text()
      const filePath = join(outDir, fileFor(path))
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, html, 'utf-8')
      const entry = { path, bytes: html.length }
      pages.push(entry)
      options.onPage?.(entry)
    }
  }

  return { pages }
}

// ===== Islands-aware static export (T19-A) =====
//
// `buildStatic()` above predates the islands hydration model — it
// renders page HTML and (optionally) writes ONE legacy `/client.js`.
// `writeStaticSite()` is the islands-era exporter: it takes the
// fully-built island bundle map (the same `Map<url, Uint8Array>`
// `serve()` holds in memory) and a render callback that produces
// island-aware HTML, then writes a complete static site —
// page HTML + every island/chunk bundle — to `outDir`.
//
// It is intentionally framework-internal-agnostic: the CALLER
// (`serve()`'s static-export branch) owns the renderPage wiring
// (layouts, theme class, SRI, SPA-nav runtime); this function only
// resolves dynamic routes, invokes the callback, and writes bytes.
// That keeps `index.ts` from growing and keeps all filesystem I/O
// in one place.

/** One GET page route to pre-render. */
export interface StaticRoute {
  /** URL pattern (`/`, `/about`, `/posts/:id`). */
  readonly pattern: string
  /** The page value — used for `getStaticPaths()` on dynamic patterns. */
  readonly page: AnyPage
}

/** What the caller's render callback returns for one rendered path. */
export interface StaticRenderResult {
  /** The full HTML document. */
  readonly html: string
  /**
   * SHA-256 hashes (bare base64, no `sha256-` prefix) of inline
   * `<style>` blocks + style attributes the framework emitted.
   * Collected into the `_headers` CSP `style-src`.
   */
  readonly styleHashes?: readonly string[]
}

export interface WriteStaticSiteOptions {
  /** Output directory. Created if missing. */
  readonly outDir: string
  /** GET page routes to pre-render. */
  readonly routes: readonly StaticRoute[]
  /**
   * Render one resolved path to HTML. The caller closes over the
   * framework's `renderPage` + all serve()-level options (layouts,
   * theme, SRI, SPA-nav). Static renders carry NO per-request CSP
   * nonce — the CSP is delivered statically via `_headers`.
   */
  readonly render: (
    page: AnyPage,
    path: string,
    params: Record<string, string>,
  ) => Promise<StaticRenderResult>
  /**
   * In-memory client/island/chunk bundles: URL path → bytes. Written
   * verbatim to `<outDir><url>` so the static HTML's
   * `<script src="/islands/…">` references resolve.
   */
  readonly bundles: ReadonlyMap<string, Uint8Array>
  /**
   * `robots.txt` body. A static host has no server to default-serve
   * `/robots.txt`, and Lighthouse flags a missing/invalid one as an
   * SEO Crawling-and-Indexing failure. Written to `<outDir>/robots.txt`
   * unless `false`. Default: `'User-agent: *\nAllow: /\n'`.
   */
  readonly robots?: string | false
  /** Per-page progress hook. */
  readonly onPage?: (info: { path: string; bytes: number }) => void
  /** Per-bundle progress hook. */
  readonly onBundle?: (info: { url: string; bytes: number }) => void
}

export interface WriteStaticSiteResult {
  readonly outDir: string
  readonly pages: Array<{ path: string; bytes: number }>
  readonly bundles: Array<{ url: string; bytes: number }>
  /** Union of every page's inline-style hashes — for the `_headers` CSP. */
  readonly styleHashes: string[]
  /** Union of every page's inline-script SHA-256 hashes (`sha256-…`). */
  readonly scriptHashes: string[]
}

// SHA-256 of a UTF-8 string → bare base64 (no `sha256-` prefix).
// CSP hash sources hash the raw text content of the inline element.
async function sha256Base64(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
}

// Scan a rendered HTML document for EXECUTABLE inline `<script>`
// blocks and return the SHA-256 (bare base64) of each one's text.
//
// `indexOf`-based scan, not a regex — the input is the framework's
// own deterministic output and a framework-emitted inline script
// never contains a literal `</script>` (that would break the HTML
// parser; the framework escapes it). Bounded + verifiable.
//
// Excluded (not governed by CSP `script-src`, or not inline):
//   - `<script src=…>`           — external; covered by `'self'`
//   - `type="application/json"`  — data island, non-executable
//   - any non-JS `type`          — not executed
async function collectInlineScriptHashes(html: string, sink: Set<string>): Promise<void> {
  let i = 0
  while (true) {
    const start = html.indexOf('<script', i)
    if (start < 0) break
    const gt = html.indexOf('>', start)
    if (gt < 0) break
    const openTag = html.slice(start, gt + 1)
    const end = html.indexOf('</script>', gt)
    if (end < 0) break
    const body = html.slice(gt + 1, end)
    i = end + '</script>'.length
    if (/\ssrc\s*=/.test(openTag)) continue
    const typeMatch = openTag.match(/\stype\s*=\s*["']([^"']*)["']/)
    if (typeMatch) {
      const t = typeMatch[1]?.toLowerCase() ?? ''
      // `module` + `text/javascript` are executable; anything else
      // (application/json, importmap, speculationrules, …) is not.
      if (t !== 'module' && t !== 'text/javascript') continue
    }
    if (body.length === 0) continue
    sink.add(await sha256Base64(body))
  }
}

/**
 * Build a Cloudflare Pages `_headers` body delivering a strict,
 * static Content-Security-Policy + security headers for every path.
 *
 * **`script-src` is fully hash-locked** — `'self'` (the same-origin
 * island bundles) + a `'sha256-…'` for each framework inline runtime
 * script. NO `'unsafe-inline'`: an injected `<script>` cannot run.
 * This is the XSS-critical control and it is airtight.
 *
 * **`style-src` is `'self' 'unsafe-inline'`** — a deliberate,
 * documented concession. The docs `<CodeBlock>` emits a per-token
 * `style="color:…"` for syntax highlighting — hundreds of inline
 * style attributes, which would mean a ~20 KB hash list in the CSP
 * header (over common CDN/browser header limits, sent on every
 * response). Inline-*style* injection is a far lower risk than
 * inline-*script* injection (no code execution; CSS-based exfil is
 * exotic + limited) — industry CSP guidance (e.g. Google's CSP
 * Evaluator) treats `style-src 'unsafe-inline'` as acceptable while
 * flagging `script-src 'unsafe-inline'` as critical. The proper
 * end-state — token colors via CSS custom properties instead of
 * inline `style` — is a `<CodeBlock>` refactor tracked separately.
 */
function renderHeadersFile(scriptHashes: string[]): string {
  const scriptSrc = ["'self'", ...scriptHashes.map((h) => `'sha256-${h}'`)].join(' ')
  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; ')
  return [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload',
    '  X-Frame-Options: DENY',
    '  Permissions-Policy: geolocation=(), camera=(), microphone=()',
    '',
  ].join('\n')
}

/**
 * Write a complete islands-aware static site to `outDir`.
 *
 * Output shape:
 *   <outDir>/index.html
 *   <outDir>/about/index.html
 *   <outDir>/islands/<name>-<hash>.js   (+ shared chunks)
 *   …
 *
 * Returns the manifest + the union of inline-style hashes (the
 * caller writes the `_headers` CSP — it also needs script hashes).
 */
export async function writeStaticSite(
  options: WriteStaticSiteOptions,
): Promise<WriteStaticSiteResult> {
  const { outDir, routes, render, bundles } = options
  await mkdir(outDir, { recursive: true })

  const pages: Array<{ path: string; bytes: number }> = []
  const styleHashSet = new Set<string>()
  const scriptHashSet = new Set<string>()

  // 1. Page HTML — resolve dynamic routes via getStaticPaths().
  //    Each page's inline `<script>` hashes are collected for the
  //    strict `script-src` CSP delivered via `_headers`.
  for (const { pattern, page } of routes) {
    const paths = await resolvePaths(page, pattern)
    for (const { path, params } of paths) {
      const { html, styleHashes } = await render(page, path, params)
      const filePath = join(outDir, fileFor(path))
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, html, 'utf-8')
      for (const h of styleHashes ?? []) styleHashSet.add(h)
      await collectInlineScriptHashes(html, scriptHashSet)
      const entry = { path, bytes: html.length }
      pages.push(entry)
      options.onPage?.(entry)
    }
  }

  // 2. Island + chunk bundles — written verbatim from the in-memory
  //    map `serve()` already built (SRI hashes already match these
  //    exact bytes).
  const writtenBundles: Array<{ url: string; bytes: number }> = []
  for (const [url, bytes] of bundles) {
    // `url` is a server path like `/islands/foo-ab12.js`; strip the
    // leading slash to make it relative to outDir.
    const rel = url.replace(/^\//, '')
    const filePath = join(outDir, rel)
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, bytes)
    const entry = { url, bytes: bytes.byteLength }
    writtenBundles.push(entry)
    options.onBundle?.(entry)
  }

  // 3. Cloudflare `_headers` — strict static CSP. `script-src` is
  //    fully hash-locked (no `'unsafe-inline'`); `style-src` uses
  //    per-block hashes + `'unsafe-hashes'`.
  const scriptHashes = [...scriptHashSet].sort()
  const styleHashes = [...styleHashSet].sort()
  await writeFile(join(outDir, '_headers'), renderHeadersFile(scriptHashes), 'utf-8')

  // 4. `robots.txt` — a static host has no server to default-serve it.
  //    Without a valid one Lighthouse SEO flags Crawling-and-Indexing.
  if (options.robots !== false) {
    const robotsBody =
      typeof options.robots === 'string' ? options.robots : 'User-agent: *\nAllow: /\n'
    await writeFile(join(outDir, 'robots.txt'), robotsBody, 'utf-8')
  }

  return {
    outDir,
    pages,
    bundles: writtenBundles,
    styleHashes,
    scriptHashes,
  }
}
