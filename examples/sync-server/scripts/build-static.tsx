// Build-time static rendering — pre-renders a list of routes to HTML
// files under `dist/static/`. Same `renderToString` machinery the
// runtime SSR uses, just invoked from a script. For routes that don't
// need request data, this ships zero JavaScript and serves at static
// CDN speeds.
//
// Run via: bun run --filter @place/sync-server build:static
//
// To add a route, add an entry to ROUTES below. The view function is a
// zero-arg `() => View` — same JSX you'd write anywhere. For dynamic
// routes (e.g., per-user pages), call this in a loop with different
// view inputs and build a directory per slug.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

// Set up happy-dom BEFORE importing @place/component, same pattern as
// the runtime server. The render path checks `globalThis.document`.
const _window = new Window()
;(globalThis as { document?: Document }).document = _window.document as unknown as Document

const { renderToString } = await import('@place/component')
const { Page } = await import('../src/Page.tsx')

interface StaticRoute {
  /** URL path. Becomes `dist/static/<path>/index.html` (or `index.html` for `/`). */
  path: string
  /** View factory — zero args, returns the JSX to render. */
  view: () => import('@place/component').View
}

const ROUTES: StaticRoute[] = [
  {
    path: '/',
    view: () => <Page name="visitor" now={new Date().toISOString()} />,
  },
  {
    path: '/about',
    view: () => <Page name="about page" now={new Date().toISOString()} />,
  },
]

// Same shell function the runtime handler uses. Kept inline so the
// static build is self-contained — no shared mutable state across the
// runtime and the build.
const wrapDocument = (body: string): string =>
  `<!doctype html><html lang="en"><head>` +
  `<meta charset="utf-8"><title>place static</title>` +
  `<style>body{font:14px system-ui;margin:2rem;color:#222}` +
  `.muted{color:#888}.meta{color:#aaa;font-size:.85em}` +
  `.ts{font-family:ui-monospace,monospace}</style>` +
  `</head><body>${body}</body></html>`

// Map a URL path to the on-disk file. `/` → `index.html`, `/about` →
// `about/index.html` (so the dev/static host can serve clean URLs).
const fileFor = (urlPath: string): string => {
  const trimmed = urlPath.replace(/^\/|\/$/g, '')
  return trimmed === '' ? 'index.html' : `${trimmed}/index.html`
}

const OUT_DIR = new URL('../dist/static/', import.meta.url).pathname

let _count = 0
for (const route of ROUTES) {
  const body = renderToString(route.view())
  const html = wrapDocument(body)
  const filePath = join(OUT_DIR, fileFor(route.path))
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, html, 'utf-8')

  _count++
}
