// @place/component buildStatic — pre-render Pages to HTML at build time.
//
// Walks a `routes` map (same shape `serve()` accepts), invokes
// `renderPage()` for each page, writes the resulting HTML to
// `dist/static/<path>/index.html`. Dynamic routes (`/posts/:id`) opt in
// via the page's `getStaticPaths()` factory which yields the concrete
// param maps to pre-render.
//
//   import { buildStatic } from '@place/component'
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
import { type Route as RouteMatcher, route as routeFactory } from '../../routing/src/index.ts'
import type { AnyPage, ServeRoutes } from './index.ts'
import { isPage, renderPage } from './index.ts'

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
