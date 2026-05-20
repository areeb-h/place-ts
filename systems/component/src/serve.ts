// @place/component — the serve() orchestrator.
//
// Extracted from index.ts (Tier 20 decomposition, cut 9) — the
// server entrypoint and everything it threads together:
//   - serve()        — the Bun.serve wrapper (bundles islands,
//                       compiles Tailwind, dispatches routes)
//   - _serveImpl      — the server-gated implementation body
//   - the security-header presets + Tailwind integration
//   - the runtime-aware static-file primitive
//   - the deployment-adapter scaffold + per-route bundle compilation
//
// This is the largest leaf on the import graph: it composes the
// element / mount / ssr / islands / page / component modules but
// nothing imports back into it except the index barrel's re-export.
// `index.ts` re-exports `serve` + the public security / static-file /
// adapter surface; `_serveImpl` calls `renderPage` (still in the
// barrel) per-request — a benign function-level cycle.

// Build-time defines injected by Bun.build. `__PLACE_BROWSER__` is
// `true` in client bundles / undefined on the server runtime — the
// `serve` ternary export uses it to dead-branch-eliminate the
// server-only `_serveImpl` body (and its Bun.serve / Bun.build /
// fs closure) from client bundles. `__PLACE_DEV__` gates HMR code.
declare const __PLACE_BROWSER__: boolean | undefined
declare const __PLACE_DEV__: boolean | undefined

import { runWithCapabilityScope } from '@place/capability'
import { route } from '@place/routing'
import { bunCryptoProvider, rotatingKey } from '@place/security'

import { HMR_WS_PATH } from './__hmr.ts'
import { placeAutoImport } from './auto-import-plugin.ts'
import type {
  buildIslandBundles as BuildIslandBundlesFn,
  renderViewManifestReport as BuildRenderViewManifestReportFn,
  ClientCapInstall,
} from './build/island-bundler.ts'
import type { buildRouteSplitBundles as BuildRouteSplitBundlesFn } from './build/route-splitter.ts'
import type { CacheEntry, CacheStore } from './cache.ts'
import { _registeredCaches } from './component.ts'
import { maybeCompress } from './compress.ts'
import { setActionRootKey } from './critical-action.ts'
import { isProductionRuntime } from './error-overlay.ts'
import { INLINE_STYLE_HASHES_HEADER } from './index.ts'
import {
  _setIslandBundleUrls,
  _setIslandRegistry,
  _setSharedChunkUrls,
  type IslandComponent,
  type IslandRegistration,
  type IslandSsrPropsResolver,
} from './islands.ts'
import { _setTrailingSlash } from './link.ts'
import { formatRequestLogLine, formatStartupBanner } from './logging.ts'
import type { StyleSrc } from './meta.ts'
import { type AnyLayout, type AnyPage, isPage, type Page } from './page.ts'
// `renderPage` lives in ./render-page.ts; the private inline-style-
// hashes header constant lives in index.ts. Both touched only inside
// runtime functions, so the serve cycles stay benign.
import { renderPage } from './render-page.ts'
import type { RouteHandler } from './server-router.ts'
import { readThemeFromRequest, themeEarlyScript } from './theme.ts'

export type { ClientCapInstall }

// ===== serve — Bun.serve wrapper that bundles islands + dispatches routes =====
//
// One call to stand up an SSR-with-islands server:
//
//   await serve({
//     port: 5180,
//     islandsDir: './src/islands',
//     routes: {
//       '/':            home,                          // a Page
//       'GET /kv/:key': (_req, p) => json(...),        // a raw handler
//       'PUT /kv/:key': async (req, p) => { ... },
//     },
//   })
//
// What it does:
//   1. Bundles each registered island once at startup (per ADR 0019 /
//      0023) and serves the bundles at content-hashed `/islands/*` URLs
//   2. Emits one `<script>` per island a page actually uses — a page
//      with no island ships zero framework JavaScript
//   3. Dispatches each request: pages render via `renderPage()`, raw
//      handlers run as `(req, params) => Response`
//   4. WebSocket / pre-router hooks via `fetch` and `websocket` options
//   5. 404 fallback, customizable via `notFound`
//
// What it doesn't do:
//   - No middleware chain (compose handlers with plain function wrapping)
//   - No automatic CORS / CSP (set via `headers` if needed)
//   - No file-system routing (routes are explicit data)

// `AnyPage` (the variance-erased page shape) lives in ./page.ts next
// to `Page`; imported above.

export interface ServeRoutes {
  [key: string]: AnyPage | RouteHandler
}

// ===== Security headers — typed CSP + presets =====
// Extracted to ./security-headers.ts (audit Phase 2.1, Cut 1e).
// Re-exported below for public consumers; the renderer + nonce
// generator + sha256 helper are imported back for serve()'s pipeline.

export {
  type CrossOriginEmbedderPolicy,
  type CrossOriginOpenerPolicy,
  type CrossOriginResourcePolicy,
  type CSPConfig,
  type CSPDirective,
  type CSPSource,
  generateScriptNonce,
  type HSTSConfig,
  type PermissionsPolicyConfig,
  type ReferrerPolicy,
  type RenderSecurityOptions,
  renderSecurityHeaders,
  type Security,
  type SecurityOptions,
  type SecurityPreset,
} from './security-headers.ts'

import {
  generateScriptNonce,
  type RenderSecurityOptions,
  renderSecurityHeaders,
  type Security,
  sha256Base64,
} from './security-headers.ts'

// ===== Tailwind integration in serve() =====
//
// `tailwind: true | { ... }` on serve() compiles Tailwind CSS once at
// startup (via the lazy-imported `@place/component/tailwind` helper)
// and auto-injects it into every page's <head>. Two delivery modes:
//
//   - inline (default): `<style>…</style>` in the document. Faster
//     first paint (no extra HTTP roundtrip). When `security` is set,
//     the SHA-256 of the CSS is automatically added to `style-src`,
//     so strict CSP keeps working without `'unsafe-inline'`.
//   - file: served at `/_place/tw.css` (override via `path`), injected
//     as `<link rel="stylesheet">`. Cacheable across navigations,
//     allows the strictest CSP without any hash gymnastics.
//
// Lazy import: the `@tailwindcss/node` module pulls in Node-only deps
// (lightningcss + native scanners). It's only loaded if you set the
// `tailwind` field on serve(); apps that don't use Tailwind don't pay
// the import cost.

/**
 * Resolve the effective `tailwind` option from `serve()`'s `theme` and
 * `tailwind` inputs. When `theme.base` is present and Tailwind is
 * already enabled (truthy) AND no explicit `tailwind.base` was supplied,
 * fills `tailwind.base` from `theme.base`. Otherwise returns the input
 * unchanged.
 *
 * Critical guard: NEVER turns Tailwind on for users who opted out
 * (`tailwind: undefined` or `tailwind: false`). Theme-only users get
 * CSS-variable theming without paying the Tailwind compile cost.
 *
 * Exported for unit testing. Real consumers don't call this.
 */
export function resolveTailwindFromTheme(
  theme: { base?: string } | undefined,
  tailwind: boolean | ServeTailwindOptions | undefined,
): boolean | ServeTailwindOptions | undefined {
  if (theme === undefined || theme.base === undefined) return tailwind
  if (tailwind === undefined || tailwind === false) return tailwind
  const tw = tailwind === true ? {} : tailwind
  if (tw.base !== undefined) return tailwind
  return { ...tw, base: theme.base }
}

export interface ServeTailwindOptions {
  /**
   * Glob patterns to scan for class candidates. **Optional.** When
   * omitted, defaults to scanning the project working directory for
   * `.{ts,tsx,js,jsx,html}`.
   *
   * Pass an explicit list when scanning needs to span extra trees
   * (component libraries, content directories, etc.).
   */
  content?: string[]
  /**
   * Custom base CSS. Default: `@import "tailwindcss";`.
   *
   * Shorthand: pass a `themeTokens()` result directly (the framework
   * uses `.base` automatically). Avoids the boilerplate
   * `base: tokens.base` line at every call site.
   */
  base?: string | { base: string }
  /**
   * Inline the CSS into every page's <style> (default: true). When
   * false, serve as a file at `path` and inject a `<link>` instead.
   */
  inline?: boolean
  /** URL path for the file when `inline: false`. Default: '/_place/tw.css'. */
  path?: string
}

// ===== Runtime-aware static file primitive =====
//
// `Bun.file(path)` is the fastest path on Bun (zero-copy, lazy reads,
// MIME detection). On Node, fall back to `fs` + a file ReadableStream.
// Cloudflare Workers / browsers don't have filesystem access; static
// assets there must be bundled or served from a CDN — adapters handle
// those cases by intercepting before this primitive runs.
//
// Returns a Response when the file exists; null when missing. Caller
// merges the result with their own headers.

interface FileHandle {
  exists: boolean
  body: ReadableStream<Uint8Array> | null
  contentType: string | null
  size: number | null
}

async function readStaticFile(filePath: string): Promise<FileHandle> {
  // Bun: native zero-copy path.
  if (typeof Bun !== 'undefined' && typeof Bun.file === 'function') {
    const file = Bun.file(filePath)
    if (!(await file.exists())) return { exists: false, body: null, contentType: null, size: null }
    return {
      exists: true,
      // BunFile is acceptable as Response body directly; expose the
      // stream form so the wrapper can consume uniformly.
      body: file.stream(),
      contentType: file.type || null,
      size: file.size,
    }
  }
  // Node fallback: fs.stat + fs.createReadStream wrapped in a Web stream.
  // We avoid `import 'node:fs'` at module scope so browsers don't try
  // to resolve it; lazy-import inside the function so bundlers can
  // tree-shake it out for browser builds.
  const { stat, createReadStream } = await import('node:fs')
  return new Promise<FileHandle>((resolve) => {
    stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        resolve({ exists: false, body: null, contentType: null, size: null })
        return
      }
      // node:stream Readable → Web ReadableStream. Node 17+ has
      // Readable.toWeb but not in all environments; build manually.
      const nodeStream = createReadStream(filePath)
      const webStream = new ReadableStream<Uint8Array>({
        start(controller) {
          nodeStream.on('data', (chunk) => {
            controller.enqueue(
              chunk instanceof Uint8Array ? chunk : new Uint8Array(Buffer.from(chunk)),
            )
          })
          nodeStream.on('end', () => controller.close())
          nodeStream.on('error', (e) => controller.error(e))
        },
        cancel() {
          nodeStream.destroy()
        },
      })
      resolve({
        exists: true,
        body: webStream,
        contentType: contentTypeFromExt(filePath),
        size: stats.size,
      })
    })
  })
}

// Tiny MIME map for the common static-asset extensions. Bun's Bun.file
// type detection is more thorough; this matches "good enough" defaults
// for the Node fallback. Apps with exotic types should set Content-Type
// in their own handler.
function contentTypeFromExt(path: string): string | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return null
  const ext = path.slice(dot + 1).toLowerCase()
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    mjs: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
  }
  return map[ext] ?? null
}

// ===== Deployment adapters — interface scaffold =====
//
// Phase 4.6: define the shape future adapters will conform to.
// Concrete adapters (Vercel / Cloudflare Workers / Node http) ship in
// Phase 5 when a real workload demands deployment. The interface lives
// now so apps that DO want to deploy aren't blocked on a redesign — and
// so the scaffold exists for community adapters.
//
// Shape borrowed from SvelteKit (`Adapter { name, adapt(builder) }` +
// `Builder` inverted-control object), which is the cleanest of the
// adapter-shapes we surveyed. Vinxi punts to Nitro (adopting unjs is
// off-thesis for our anti-bloat directive); Astro's hook bus is more
// diffuse.
//
// **Status: scaffold only.** `serve({ adapter })` calls `adapter.adapt`
// during startup but the default behavior (Bun.serve directly) is
// unchanged. Adapters are expected to call `builder.dispatch` to
// register their request handler; the framework is otherwise transparent.

export interface Builder {
  /** Server name for diagnostics. Set by `serve()` from package.json
   *  if available; otherwise 'place-app'. */
  name: string
  /** The compiled route handler — adapters wire this into their host.
   *  For Bun.serve, this is what `fetch` calls. The `srv` param is the
   *  Bun server instance for WebSocket upgrade; adapters running on
   *  non-Bun hosts pass a stub or omit (the dispatch then skips
   *  WebSocket-dependent paths). */
  // biome-ignore lint/suspicious/noExplicitAny: adapter compatibility shim
  dispatch: (req: Request, srv?: any) => Promise<Response>
  /** Where to write static asset output. Adapters that generate files
   *  (Vercel build output, prerendered HTML) honor this. */
  outDir: string
  /** The compiled routes table — adapters can introspect to generate
   *  manifests (Vercel functions, Cloudflare route bindings). */
  routes: ReadonlyArray<{ method: string; pattern: string; isPage: boolean }>
}

export interface Adapter {
  /** Identifier for diagnostics ('vercel', 'cloudflare', 'node', etc.). */
  name: string
  /** Called once at server startup. Adapters typically:
   *   - Generate a deployment manifest (Vercel Build Output API,
   *     Cloudflare wrangler.toml, etc.)
   *   - Register `builder.dispatch` with their host runtime
   *   - Translate Bun globals (Bun.file → fs.readFile, etc.)
   *
   *  The default Bun.serve path is taken when no adapter is provided —
   *  i.e., this is opt-in for production hosts that aren't Bun-native. */
  adapt(builder: Builder): Promise<void> | void
}

export interface ServeOptions {
  port?: number
  routes: ServeRoutes
  /**
   * Per-route bundle splitting (T5-B-1, ADR 0018). Maps route path →
   * source file. When set, `serve()` runs ONE `Bun.build` with
   * `splitting: true` over all entries so Bun extracts shared chunks.
   * Each route's HTML emits a `<script src>` pointing to its own
   * bundle.
   *
   * Example:
   *
   *   clientEntries: {
   *     '/': './pages/index.page.tsx',
   *     '/about': './pages/about.page.tsx',
   *   }
   *
   * Why opt-in: the framework can't introspect "where on disk is this
   * page's source?" from a `Page` object. Apps already type the path
   * once when importing the page module; declaring it again here is
   * mechanical. See ADR 0018.
   *
   * The islands model (`islands` / `islandsDir`) is the recommended
   * client-bundling path — a page with no island ships zero JS.
   */
  clientEntries?: Readonly<Record<string, string>>
  /**
   * **T5-C, ADR 0019.** Islands registry — typed sub-tree opt-in to client
   * interactivity. Each entry pairs a NAME (used in `<Island name="...">`
   * at render time) with `{ component, src }`:
   *
   *   - `component`: the server-side component used to SSR the island
   *     (eagerly imported at app init).
   *   - `src`: the source-file path used to BUNDLE the island as its
   *     own client-side mount script.
   *
   * Pages without any `<Island>` element ship ZERO `<script>` tags
   * → 0 KB JS floor on content pages. Pages with islands emit one
   * `<script>` per used island (deduped automatically).
   *
   * Example:
   *
   *   import counter from './islands/counter.tsx'
   *   import themeToggle from './islands/theme-toggle.tsx'
   *
   *   app({
   *     islands: {
   *       Counter:     { component: counter,     src: './islands/counter.tsx' },
   *       ThemeToggle: { component: themeToggle, src: './islands/theme-toggle.tsx' },
   *     },
   *   })
   *
   *   // In a page:
   *   <Island name="ThemeToggle" props={{ initial: 'dark' }} />
   *
   * **Recommended DX (array form):**
   *
   *   // counter.tsx
   *   const Counter = island(import.meta.url, ({ start = 0 }) => { ... })
   *   export default Counter
   *
   *   // app.ts
   *   import Counter from './islands/counter.tsx'
   *   app({ islands: [Counter] })
   *
   *   // page.tsx
   *   import Counter from './islands/counter.tsx'
   *   <Counter start={5} />   // direct JSX, typed props, no string name
   *
   * The array form auto-discovers `{ name, src }` from each island's
   * metadata (set by the `island()` factory), so there's no need to
   * repeat the path or name.
   */
  islands?: Readonly<Record<string, IslandRegistration>> | readonly IslandComponent<never>[]
  /**
   * **T5-D phase 2 DX (2026-05-15).** Auto-discover islands by scanning
   * a directory. Each `.tsx` (or `.ts`/`.jsx`/`.js`) file's default
   * export should be an `island(...)`-wrapped component; the framework
   * imports each, derives the name from the filename (via the same
   * `island()` factory rules), and builds the registry automatically.
   *
   * Removes the per-island `import` + `islands: [...]` boilerplate from
   * `app.ts`. Use ONE OR THE OTHER (not both) of `islands` and
   * `islandsDir` — explicit list wins if both are set.
   *
   * The path is resolved relative to `process.cwd()`. Files prefixed
   * with `_` are skipped (treat as private modules — shared state,
   * helpers, etc.).
   *
   *   app({
   *     islandsDir: './src/islands',
   *   })
   */
  islandsDir?: string
  /**
   * **T5-D phase 2 (ADR 0024)** auto cap-install. When set, the islands
   * bundler generates a side-effect-only `_auto-init.ts` module that
   * each island's auto-mount wrapper imports. The module installs each
   * listed cap on the client BEFORE any island body runs. ES module
   * semantics + `splitting: true` evaluate it ONCE per page.
   *
   * Set automatically by `app()` from `router:` and `caps:` config —
   * apps don't normally write this directly. Provided as a ServeOption
   * for advanced use cases (hand-rolled `serve()` calls).
   *
   * Each entry is `{ module, factoryName, capName }` matching the
   * factory's `__placeClientImport` metadata. Framework factories
   * (`pathRouter`, `hashRouter`, `memoryRouter`) carry this metadata;
   * user-defined factories opt in by setting `__placeClientImport` on
   * the function.
   */
  clientCaps?: readonly ClientCapInstall[]
  /** URL-path base for the route splitter's default bundle. Default:
   *  `/client.js`. Only relevant when `clientEntries` is set. */
  clientPath?: string
  /** Default headers applied to all responses (CORS, CSP, etc.). */
  headers?: HeadersInit
  /**
   * Pre-router hook. Return a Response to short-circuit (e.g. CORS
   * preflight); return null to fall through to the router. Receives the
   * Bun server so WebSocket upgrade is possible: `srv.upgrade(req)`.
   */
  fetch?: (req: Request, srv: Bun.Server<unknown>) => Response | null | Promise<Response | null>
  /** Bun.serve websocket config. */
  websocket?: Bun.WebSocketHandler<unknown>
  /** Custom 404. Default: `text/plain "Not Found"` with serve's headers. */
  notFound?: (req: Request) => Response | Promise<Response>
  /**
   * Static asset serving. Maps URL prefix → filesystem directory. The
   * URL path *after* the prefix is appended to the directory:
   *
   *   static: { '/': './public' }
   *     // GET /favicon.ico → ./public/favicon.ico
   *
   *   static: { '/assets': './build/assets' }
   *     // GET /assets/main.css → ./build/assets/main.css
   *
   * Path-traversal (`..`) is rejected. Content-Type comes from Bun.file's
   * MIME detection. Returns 404 if the file doesn't exist. Static asset
   * routes are checked AFTER the client bundle but BEFORE the route
   * table, so a static file shadows a Page at the same path.
   */
  static?: Record<string, string>
  /**
   * Security headers (CSP, HSTS, Referrer-Policy, etc.). Pass a preset
   * string (`'strict' | 'standard' | 'none'`) for sensible defaults, or
   * a typed object for full control. Headers are applied to every
   * response the server returns.
   *
   *   security: 'strict'  // recommended baseline
   *   security: { csp: { scriptSrc: ['self', 'https://cdn.example'] } }
   *
   * If `tailwind` is also set with the default inline delivery, the
   * SHA-256 of the compiled CSS is automatically added to `style-src`
   * so strict CSP works without `'unsafe-inline'`.
   */
  security?: Security
  /**
   * Auto-Tailwind. Compile Tailwind CSS once at startup (via the
   * lazy-imported `@place/component/tailwind` helper) and inject it
   * into every page's <head>. `true` uses sensible defaults; pass an
   * object for explicit control. Lazy import — projects that don't
   * use Tailwind pay zero dependency cost.
   */
  tailwind?: boolean | ServeTailwindOptions
  /**
   * Theme tokens to install at the server level. When set:
   *
   *   1. Every request has its `place-theme` cookie read; the active
   *      theme class is auto-prefixed onto every page's
   *      `meta.htmlClass` — pages don't need to declare a `load()` or
   *      pass `htmlClass: tokens.htmlClass(theme)` themselves.
   *   2. ISR cache keys include the theme name so light + dark visitors
   *      don't share entries.
   *
   * Pass the result of `themeTokens()`. Use the `tailwind.base: tokens`
   * shorthand alongside this so the same value drives both the CSS
   * compilation and the per-request theme selection.
   */
  theme?: {
    default: string
    names: ReadonlyArray<string>
    // Parameter is `never` so any narrower `htmlClass(theme: 'a' | 'b')` —
    // which is what `themeTokens()` returns — is assignable here. serve()
    // only ever calls this with values from `names`, so the `never` cast
    // is a TS-level adapter, not a runtime hazard.
    htmlClass: (theme: never) => string
    /**
     * Tailwind base CSS — present on `themeTokens()` results. When set,
     * `serve()` auto-fills `tailwind.base` from this if Tailwind is
     * already enabled and no explicit base was provided. Lets you write
     * `serve({ theme: tokens })` instead of `serve({ tailwind: { base: tokens }, theme: tokens })`.
     */
    base?: string
  }
  /**
   * Cache backend for ISR (`page({ revalidate })`). Pass `memoryStore()`
   * for in-process caching, or any `CacheStore` (e.g. a persistence-
   * backed one for multi-replica). Without this option, `page.revalidate`
   * is a silent no-op.
   */
  cache?: CacheStore
  /**
   * Deployment adapter for non-Bun hosts (Vercel, Cloudflare Workers,
   * Node). Without this option, `serve()` runs Bun.serve directly. With
   * an adapter, it builds the dispatch + routes table and calls
   * `adapter.adapt(builder)` — the adapter is responsible for hooking
   * the dispatch into its host runtime.
   *
   * **Phase 4.6: scaffold only.** No concrete adapters ship yet; this
   * exists so apps planning to deploy can write against the interface,
   * and so community adapters have a stable target. Concrete adapters
   * (`vercelAdapter()`, `cloudflareAdapter()`, `nodeAdapter()`) are
   * Phase 5 candidates.
   */
  adapter?: Adapter
  /**
   * Default layout applied to every page in the route table. Pages can
   * still declare their own `layout` chain — this serves as the
   * outermost wrapper, prepended to whatever the page specifies.
   *
   * Common pattern: a `RootLayout` with `<html><body><Header />{children}</body></html>`
   * shared across all pages, declared once on `serve()` instead of
   * repeating on every page.
   */
  layout?: AnyLayout | AnyLayout[]
  /** Display name for diagnostics. Default: 'place-app'. */
  name?: string
  /** Where adapter-generated files go. Default: './dist'. */
  outDir?: string
  /**
   * Observability: startup banner + per-request log lines.
   *
   * Default behavior: both default-ON when `NODE_ENV !== 'production'`
   * and default-OFF in production (production deployments use their
   * own log shippers and don't want the noise). Override either
   * independently via `log: { banner: false, requests: true }`.
   *
   * The banner is one-shot (printed once after `Bun.serve` binds the
   * port); per-request log is one line per request with timing.
   */
  log?: { banner?: boolean; requests?: boolean }
  /**
   * Cross-document View Transitions. When `true`, the framework injects
   * `@view-transition { navigation: auto; }` (gated under
   * `prefers-reduced-motion: no-preference`) into every page's `<head>`.
   * Browsers that support cross-document VT (Chrome 126+, Safari 18+,
   * Firefox 144+) animate same-origin navigations automatically; older
   * browsers ignore the at-rule and behave as before.
   *
   * No JS, no per-element API, no `<ClientRouter>` wrapper — apps style
   * their own animations via CSS `::view-transition-*` pseudo-elements.
   * Per the research, the standards path is the stable answer; the
   * heavier wrappers (Astro's ClientRouter shape) are the cautionary
   * tale. See [docs/decisions/0006-view-transitions.md](docs/decisions/0006-view-transitions.md).
   *
   * Default: `false` (opt-in, since not every app wants navigation
   * animation).
   */
  viewTransitions?: boolean
  /**
   * Hover/focus **prefetch** in the SPA-nav runtime. When `true`
   * (default), hovering or focusing a `<Link>` warms a per-URL HTML
   * cache so the click resolves with zero network wait.
   *
   * Prefetch requests carry an `X-Place-Prefetch: 1` header; server
   * `load()` reads `ctx.prefetch` and skips side effects (analytics,
   * counters) on the speculative load. Cached entries expire after
   * 30 s; redirected responses (e.g. auth-expiry → `/login`) are not
   * cached. Individual links opt out with `data-no-prefetch`.
   *
   * Set `false` to disable prefetch app-wide — for an app whose GET
   * routes cannot be made speculation-safe even with `ctx.prefetch`.
   * Default: `true`.
   */
  prefetch?: boolean
  /**
   * Trailing-slash policy for internal `<Link>` hrefs.
   *
   *   - `'preserve'` (default): emit hrefs verbatim, whatever the
   *     author wrote in `<Link to=…>`.
   *   - `'always'`: append a trailing slash to non-root internal paths
   *     that don't already have one. Matches the canonical URL form
   *     static hosts like Cloudflare Pages serve `/path/index.html` at
   *     — eliminates the auto `/path` → `/path/` 301 that costs ~40 ms
   *     on every nav and breaks prefetch warm-hits on the live site.
   *
   * Lighthouse reports the redirect as a real performance hit even
   * for a single hop: a +37 ms penalty plus a critical-path delay
   * to LCP. Setting `trailingSlash: 'always'` makes every framework-
   * emitted href canonical, so the host serves directly with no
   * redirect.
   *
   * The runtime router still matches both forms (segments are
   * leading/trailing-slash-stripped on parse), so apps can opt in
   * without changing how routes are registered, and existing
   * bookmarks to `/path` still work (Cloudflare's auto 301 catches
   * them on the way in — only outgoing framework links are normalised).
   *
   * Default: `'preserve'`.
   */
  trailingSlash?: 'preserve' | 'always'
  /**
   * Root secret for `criticalAction()`'s per-session HMAC key
   * derivation. MUST be at least 32 bytes (256 bits). MUST be the
   * SAME on every node in a multi-node deployment, or envelopes
   * signed on one node won't verify on another.
   *
   * Source it from a deployment-secret manager (Cloudflare Pages
   * env, AWS Secrets Manager, etc.); never commit it. Generate
   * with `openssl rand -base64 32` or
   * `node -e 'console.log(crypto.randomBytes(32).toString("base64url"))'`.
   *
   * **Required iff any `criticalAction()` is registered.** The
   * framework throws at app-boot time when a critical action exists
   * but `secret` is unset. Apps without critical actions can omit it.
   *
   * The framework runs `rotatingKey(HKDF(secret, "place-action-root-v1"))`
   * so the daily-rotation primitive's blast-radius bound applies.
   */
  secret?: string | Uint8Array
  /**
   * Auto-attach the place devtools panel.
   *
   *   - `'auto'`: enabled when `NODE_ENV !== 'production'` (the
   *     default). Off in prod with zero leftover bytes — the devtools
   *     island isn't registered, isn't bundled, and the marker isn't
   *     emitted.
   *   - `true`: always on.
   *   - `false`: always off.
   *
   * When enabled the framework lazy-imports `@place/devtools/island`,
   * adds it to the island registry, and emits a
   * `<div data-view="island" data-view-id="place-devtools" data-view-strategy="idle">`
   * marker at the end of `<body>` on every page. The devtools bundle
   * mounts on idle so the panel doesn't compete with first paint.
   *
   * `@place/devtools` must be on the consuming app's dependency list
   * for the auto-attach path to resolve; if it isn't installed and
   * `devtools` is truthy, the framework emits a one-line warning and
   * continues (the rest of the app boots fine).
   *
   * Default: `'auto'`.
   */
  devtools?: 'auto' | boolean
  /**
   * Extra early-paint inline-JS statements. Each entry runs in
   * `<head>` BEFORE the body parses, AFTER the framework's built-in
   * platform + motion hints. Use for app-specific first-paint hints:
   * analytics consent state, feature-flag bucketing, RTL/LTR locale,
   * scrollbar-width detection, etc.
   *
   * Each entry is a raw JS statement (NOT wrapped in `<script>`).
   * Idempotent, no-throw, must complete in sub-millisecond budget.
   * Writes should target `document.documentElement` (its descendants
   * aren't parsed yet).
   *
   * Example:
   *
   * ```ts
   * serve({
   *   earlyHead: [
   *     // Locale direction from cookie — feeds Tailwind's `rtl:` modifier
   *     // before first paint, no flicker.
   *     `var m=document.cookie.match(/place-lang=([a-z]{2,3})/);` +
   *     `if(m&&['ar','he','fa'].includes(m[1]))` +
   *     `document.documentElement.dir='rtl'`,
   *   ],
   * })
   * ```
   */
  earlyHead?: readonly string[]
  /**
   * Post-render transform hook. Runs synchronously after the page body
   * is rendered to HTML and BEFORE the document is wrapped (head,
   * scripts, preloads). Returns the transformed body HTML; throw to
   * abort the response (caught by the route error handler).
   *
   * Use cases the framework intentionally doesn't bake in:
   *   - **Auto-populating a table-of-contents island**. Scan h2/h3 in
   *     `<main>` (via `extractMainHeadings`), then `patchIslandMarker`
   *     to replace the empty toc with the populated list AND update
   *     the island's `data-view-props` so client hydration agrees with
   *     SSR. Eliminates the "On this page → empty → filled" blip.
   *   - **Server-side syntax highlighting** post-processing — replace
   *     `<pre data-lang="ts">…</pre>` with highlighted HTML after the
   *     page rendered with raw source.
   *   - **Footnote / anchor backref injection** — find every
   *     `[^N]` reference, link to the corresponding `<li id="fn-N">`.
   *
   * **Sync only.** Async hooks would force every page render to await,
   * even when the hook does no work. Stay synchronous; if you need
   * async I/O, do it in `load()` instead.
   *
   * **Body, not document.** This hook sees the rendered body only —
   * no `<head>`, no `<script>` tags yet. The framework wraps the
   * document AFTER the hook runs, so head/script content can't
   * accidentally bleed into the transform.
   *
   * Example:
   * ```ts
   * import { extractMainHeadings, patchIslandMarker } from '@place/component'
   *
   * app({
   *   transformBody: (body) => {
   *     const { html, headings } = extractMainHeadings(body)
   *     if (headings.length === 0) return html
   *     const list = renderTocList(headings) // app-supplied
   *     return patchIslandMarker(html, 'toc', list, { initialHeadings: headings })
   *   }
   * })
   * ```
   */
  transformBody?: (body: string, ctx: { req: Request; url: URL }) => string
  /**
   * `/robots.txt` and `/sitemap.xml` defaults. Lighthouse flags
   * missing robots.txt as a Crawling-and-Indexing issue under SEO;
   * a default-allow policy is the right answer for most apps. Pass
   * a string to override the body or `false` to disable the default
   * (caller serves their own from a route or static dir).
   *
   * Default for robots: `'User-agent: *\nAllow: /\n'` — allows
   * crawling of everything, no sitemap declaration. Add a sitemap
   * by either setting `sitemap: '/sitemap.xml'` (auto-references
   * the URL in robots.txt) OR passing an explicit `robots` body.
   *
   * The default-serve only fires when no other route matches
   * `/robots.txt`. App-provided handlers always win.
   */
  robots?: string | false
  /**
   * **Static-export mode (T19-A / ADR 0051).** When set, `serve()`
   * does its FULL setup (Tailwind compile, island discovery +
   * bundling, theme resolution) exactly as for a live server — then,
   * instead of binding `Bun.serve`, it pre-renders every GET page
   * route to HTML and writes a complete static site to
   * `static.outDir`:
   *
   *   <outDir>/index.html
   *   <outDir>/about/index.html
   *   <outDir>/islands/<name>-<hash>.js   (+ shared chunks)
   *   <outDir>/_headers                   (Cloudflare strict CSP)
   *
   * The exported site is fully interactive — island bundles ship,
   * SPA-nav works (static hosts serve `/path/index.html` for
   * `/path`). Dynamic routes (`/posts/:id`) opt in via the page's
   * `getStaticPaths()`.
   *
   * Static renders carry NO per-request CSP nonce; the strict CSP
   * is delivered out-of-band via the generated `_headers` file
   * (hashes of every inline script + style). Designed for CDN
   * static hosts (Cloudflare Pages, etc.).
   *
   * Prefer `app({...}).build({ outDir })` — it wires this for you.
   */
  staticExport?: { outDir: string }
}

interface CompiledRoute {
  method: string
  matcher: ReturnType<typeof route>
  page: AnyPage | null
  fn: RouteHandler | null
}

function compileServeRoutes(routes: ServeRoutes, clientPath: string): CompiledRoute[] {
  const out: CompiledRoute[] = []
  for (const [key, val] of Object.entries(routes)) {
    const space = key.indexOf(' ')
    // Implicit GET when no method prefix — pages typically don't need
    // a method declared, raw handlers do.
    const method = space >= 0 ? key.slice(0, space).toUpperCase() : 'GET'
    const pattern = space >= 0 ? key.slice(space + 1).trim() : key
    if (!pattern.startsWith('/')) {
      throw new Error(`serve: pattern '${pattern}' must start with '/'`)
    }
    if (pattern === clientPath) {
      throw new Error(
        `serve: route '${pattern}' collides with clientPath '${clientPath}'. ` +
          'Set `clientPath` to a different URL or rename the route.',
      )
    }
    const matcher = route(pattern)
    if (isPage(val)) {
      out.push({ method, matcher, page: val, fn: null })
      // Round 5 (5.3): if the page has co-located `on:` actions, spread
      // the auto-generated handlers into the compiled routes table.
      // Each handler was already keyed `METHOD /path/_action/{key}` by
      // page() — we just compile those keys here.
      const onHandlers = (val as Page)._onHandlers
      if (onHandlers !== undefined) {
        for (const [handlerKey, handlerFn] of Object.entries(onHandlers)) {
          const handlerSpace = handlerKey.indexOf(' ')
          const hMethod =
            handlerSpace >= 0 ? handlerKey.slice(0, handlerSpace).toUpperCase() : 'GET'
          const hPattern =
            handlerSpace >= 0 ? handlerKey.slice(handlerSpace + 1).trim() : handlerKey
          if (hPattern === clientPath) {
            throw new Error(
              `serve: on-action path '${hPattern}' collides with clientPath '${clientPath}'.`,
            )
          }
          out.push({
            method: hMethod,
            matcher: route(hPattern),
            page: null,
            fn: handlerFn,
          })
        }
      }
    } else {
      out.push({ method, matcher, page: null, fn: val as RouteHandler })
    }
  }
  return out
}

/**
 * Modules to mark `external` for every browser-targeted `Bun.build`
 * the framework runs (the route splitter and the per-island bundler).
 *
 * Two categories rolled into one list:
 *
 *   - **Server-only deps that the static-import graph can transitively
 *     reach.** `@tailwindcss/*`, `tailwindcss`, `lightningcss` are
 *     pulled in by `tailwind.ts` (server-only Tailwind integration).
 *     `bun:sqlite`, `bun:test`, `bun:ffi` are app-side server helpers.
 *     The browser never executes those paths, but Bun's bundler tries
 *     to resolve them eagerly unless they're marked external.
 *
 *   - **TypeScript.** The view classifier (`build/view-classifier-types.ts`)
 *     imports the full `typescript` module (~4.2 MB raw, ~1.2 MB
 *     gzipped). Per-island wrappers don't reach this file anymore
 *     (they import from `./_client-mount.ts` after the leaf
 *     extraction) — so for the islands path this is dead defense.
 *     But the `clientEntries` route-splitter path still reaches
 *     `_serveImpl`'s dynamic imports of `./build/*` through the
 *     framework barrel; without this entry, that path would ship the
 *     full TS compiler in every visitor's bundle. Keep until the
 *     split-entry refactor lands (`@place/component/server` subpath),
 *     at which point this is redundant.
 */
const BROWSER_BUILD_EXTERNAL: readonly string[] = [
  '@tailwindcss/node',
  '@tailwindcss/oxide',
  'tailwindcss',
  'lightningcss',
  'bun:sqlite',
  'bun:test',
  'bun:ffi',
  'typescript',
]

/**
 * Minify shape for browser-targeted builds.
 *
 * **Prod**: full minification (whitespace + identifiers + syntax).
 * **Dev**: whitespace + syntax only. Strips comments and dead code
 * AND does cheap syntax folds (`() => { return x }` → `() => x`) BUT
 * preserves identifier names so devtools shows readable source.
 * Lighthouse's "minify JavaScript" diagnostic passes on the resulting
 * bytes (matches prod within ~5%), and a developer who opens devtools
 * still sees meaningful symbol names.
 */
function browserMinify(
  isProduction: boolean,
): boolean | { whitespace?: boolean; syntax?: boolean; identifiers?: boolean } {
  return isProduction ? true : { whitespace: true, syntax: true, identifiers: false }
}

/**
 * Source-map shape for browser-targeted builds.
 *
 * `'linked'` (sibling `.js.map` files + `//# sourceMappingURL=…`
 * comment) in dev — the previous `'inline'` setting put 50 kB base64
 * data-URLs at the end of every island bundle, inflating shipped
 * bytes ~4×. The map files load on demand only when DevTools opens;
 * first-paint bytes match production. We explicitly want the
 * `sourceMappingURL` comment (not Bun's `'external'` mode, which only
 * emits the Sentry-style `debugId` that DevTools won't follow without
 * a debug-id resolver server route). Off entirely in prod.
 */
function browserSourcemap(isProduction: boolean): 'linked' | 'none' {
  return isProduction ? 'none' : 'linked'
}

/**
 * Server-only dynamic import. Wraps `import()` in a helper the bundler
 * is unlikely to inline; the specifier becomes statically unresolvable
 * to the chunk-graph walker in both dev (`minify.identifiers: false`)
 * and prod (`minify: true`) bundler passes. The result is that no
 * `./build/*` module — and no transitively-static-imported peer like
 * `view-classifier-types.ts → typescript` or `tailwind.ts →
 * @tailwindcss/node` — leaks into any client bundle's chunk graph.
 *
 * **Why the helper-function shape (vs a bare variable)**: Bun's dev
 * transformer constant-folds the trivial pattern `const p = '...';
 * await import(p)` back to a literal `await import('...')` before the
 * analyzer runs (verified empirically — switching to this form
 * eliminated two dev leak chunks: tailwind integration + view
 * classifier). Wrapping the import inside a function call adds a
 * second elimination step (inline + fold) that neither dev nor prod
 * minification performs.
 *
 * **Runtime behavior**: Bun's resolver loads the specifier at the
 * call site exactly as it would for `await import('./build/foo.ts')`.
 * The path is relative to **this file**, not to the helper's
 * (irrelevant) location — `import()` honors the importing module
 * regardless of which function the call sits inside. Type-narrowing
 * happens via the explicit cast at each call site.
 *
 * The split-entry refactor (`@place/component/server` subpath) makes
 * this helper unnecessary by removing `_serveImpl` from any chunk
 * graph that browser builds can reach; this is the transitional shape.
 */
function _serverDynImport(specifier: string): Promise<unknown> {
  return import(specifier)
}

// Server-only implementation. Renamed from `serve` so we can wrap the
// public export in a build-time conditional that DCE-strips this body
// (and its entire transitive closure — security headers, devalue
// stringify, Bun.serve, Bun.build, fs/promises, tailwindcss) from the
// client bundle. See `export const serve = …` near the bottom of this
// file for the gating pattern.
async function _serveImpl(options: ServeOptions): Promise<Bun.Server<unknown>> {
  // **Dev-mode self-supervisor.** In dev, `serve()` runs as a long-
  // lived supervisor that spawns the actual server in a subprocess.
  // The subprocess (`__PLACE_DEV_CHILD=1`) hosts Bun.serve + the file
  // watcher; on a source change the watcher exits the subprocess with
  // code 0, and this loop respawns it. The browser's HMR client
  // detects the WS gap and reloads.
  //
  // **Why a supervisor instead of `bun --watch` or a shell wrapper.**
  //
  //   1. `bun --watch` (and `--hot`) BOTH deadlock `Bun.build` — the
  //      framework's island bundler hangs the moment a watch flag is
  //      set on the parent. Verified across Bun 1.3.x on Linux/macOS.
  //   2. A shell wrapper (`while bun src/app.ts; do ...; done`) works
  //      but requires the user to remember `bun run dev` instead of
  //      `bun src/app.ts`. Forgetting it means the server dies on
  //      first edit and the user thinks "HMR is broken."
  //   3. Putting the supervisor inside `serve()` means there is no
  //      "remember to use the right command" trap — `bun src/app.ts`
  //      just works, and `bun run dev` works too (the inner supervisor
  //      handles restarts; the outer `while` loop becomes a no-op
  //      because the child always exits 0 only on framework-triggered
  //      restart, which the supervisor handles).
  //
  // Production (`NODE_ENV=production`) skips this entirely — no
  // supervision, no subprocess overhead, normal Bun.serve in-process.
  //
  // Test runners also skip: `process.env.VITEST` is set by vitest;
  // a parallel check for `__PLACE_DEV_CHILD` handles the child path.
  // Tests that need supervisor behavior verify it through unit tests
  // of `runDevSupervisor` directly, not by booting `serve()`.
  // **Static-export mode bypasses the supervisor.** A static export
  // (`app().build()` / `serve({ staticExport })`, ADR 0051) is a
  // one-shot build that writes files and returns — it is never a
  // long-lived server. The dev supervisor must not wrap it: it would
  // spawn a child, the child would write the site and exit 0, and the
  // supervisor would respawn it forever. `staticExport` is the single
  // discriminator, independent of `NODE_ENV`, so a static build is
  // correct whether or not the caller set `NODE_ENV=production`.
  const staticMode = options.staticExport !== undefined
  const isDevMode = process.env['NODE_ENV'] !== 'production'
  const isTest = process.env['VITEST'] === 'true' || process.env['NODE_ENV'] === 'test'
  if (isDevMode && !isTest && !staticMode && !process.env['__PLACE_DEV_CHILD']) {
    await runDevSupervisor()
    // `runDevSupervisor` only returns when the child exits non-zero
    // (an error). In that case it has already called `process.exit`
    // — this throw is unreachable but satisfies the type system.
    throw new Error('unreachable: dev supervisor exited')
  }
  const startupStart = performance.now()
  const port = options.port ?? 3000
  const clientPath = options.clientPath ?? '/client.js'
  const userHeaders: Record<string, string> = { ...(options.headers as Record<string, string>) }
  // Per-app trailing-slash policy. Read by `<Link>` at SSR render
  // time. Default `'preserve'`. Apps deploying to hosts with canonical
  // trailing-slash URLs (Cloudflare Pages, etc.) opt into `'always'` to
  // skip the host's auto 301 — see ServeOptions['trailingSlash'].
  _setTrailingSlash(options.trailingSlash ?? 'preserve')
  // criticalAction() root secret. Required iff any criticalAction()
  // is registered (validated later in route inspection). HKDF the
  // raw secret into a domain-separated root, then rotatingKey wraps
  // it for daily sub-key derivation. The raw secret is held briefly
  // here + wiped after HKDF; the rotating key holds derived bytes.
  if (options.secret !== undefined) {
    const enc = new TextEncoder()
    const raw = typeof options.secret === 'string' ? enc.encode(options.secret) : options.secret
    if (raw.length < 32) {
      throw new Error(
        'serve: `secret` must be at least 32 bytes (256 bits). ' +
          'Generate with `openssl rand -base64 32` or equivalent.',
      )
    }
    const root = await bunCryptoProvider.hkdfSha256(
      raw,
      enc.encode('place-action-root-salt-v1'),
      enc.encode('place-action-root-v1'),
      32,
    )
    setActionRootKey(rotatingKey(root), root)
  }
  // Observability flags. Default-on in dev (banner + per-request log),
  // default-off in production (a single one-line ready message). Apps
  // can override either way via `serve({ log })`.
  // Static-export mode (T19-A / ADR 0051) implies production build
  // semantics: minified island bundles, stable SRI, no HMR, no dev
  // watcher. A static site IS a production artefact. `staticMode` is
  // resolved above — it also gates the dev supervisor.
  const isDev = !staticMode && process.env['NODE_ENV'] !== 'production'
  const wantsBanner = options.log?.banner ?? isDev
  const wantsRequestLog = options.log?.requests ?? isDev
  // Timings captured during startup; emitted by the banner.
  const timings: {
    tailwindMs?: number
    bundleMs?: number
    bundleBytes?: number
    tailwindBytes?: number
  } = {}

  // Cache policy for bundled assets (client.js, tw.css). In dev mode
  // the bundle is rebuilt at every server start; serving with a long
  // max-age means an edit-bounce-reload cycle still gets stale code.
  // Production deploys use a process supervisor (the bundle is fixed
  // for the process lifetime), so a 5-minute cache is harmless and
  // saves CDN hits.
  const isProduction = staticMode || process.env['NODE_ENV'] === 'production'
  const bundleCacheControl = isProduction
    ? 'public, max-age=300'
    : 'no-cache, no-store, must-revalidate'

  // Auto-fill `tailwind.base` from `theme.base` when both could share.
  // Saves the `tailwind: { base: tokens }` boilerplate when `theme: tokens`
  // is also set. Extracted to a pure helper so the resolution can be
  // unit-tested without booting Bun.serve().
  const resolvedTailwind = resolveTailwindFromTheme(options.theme, options.tailwind)

  // Serve()-level default layouts. Threaded into every renderPage call
  // as `extraLayouts`, prepended onto whatever the page's own `layout`
  // chain declares. Apps can declare a root layout once on serve()
  // instead of on every page.
  const serveLevelLayouts: readonly AnyLayout[] = options.layout
    ? Array.isArray(options.layout)
      ? options.layout
      : [options.layout]
    : []

  // **Auto theme early-paint script.** When `theme` is configured the
  // framework prepends a script that reads the theme cookie + applies
  // the matching class to `<html>` BEFORE first paint. Apps no longer
  // hand-write a theme `earlyHead` entry — persistence (incl. on a
  // static export, where there is no per-request SSR cookie read) and
  // no-flash behaviour are framework-owned. App `earlyHead` entries
  // run after it. See `themeEarlyScript()`.
  const effectiveEarlyHead: readonly string[] = [
    ...(options.theme
      ? // `htmlClass` is typed `(theme: never) => string` on the
        // generic `ThemeTokens` (so narrowed callbacks pass elsewhere);
        // at runtime it accepts any theme-name string. Cast the slice.
        [
          themeEarlyScript({
            names: options.theme.names,
            htmlClass: options.theme.htmlClass as (n: string) => string,
          }),
        ]
      : []),
    ...(options.earlyHead ?? []),
  ]

  // Theme choice-name → `<html>` class map, forwarded into the SPA-nav
  // runtime so navigating between pages preserves the user's theme
  // (the destination page's HTML carries the build-time default).
  const spaNavThemeClassMap: Readonly<Record<string, string>> = options.theme
    ? Object.fromEntries(
        options.theme.names.map((n) => [
          n,
          // `htmlClass` is typed `(theme: never) => string` on the
          // generic ThemeTokens; at runtime it takes any name string.
          (options.theme as NonNullable<typeof options.theme>).htmlClass(n as never),
        ]),
      )
    : {}

  // Compile Tailwind once at startup if requested. Lazy import keeps
  // apps without tailwind from pulling the heavy deps. The resulting
  // CSS is injected as a regular inline style on each compiled page
  // below; the post-merge hashing pass picks it up alongside layout
  // and page styles for the CSP `style-src` list.
  let tailwindCss: string | null = null
  let tailwindInline = true
  let tailwindPath = '/_place/tw.css'
  if (resolvedTailwind) {
    const tw = resolvedTailwind === true ? {} : resolvedTailwind
    tailwindInline = tw.inline !== false
    if (tw.path) tailwindPath = tw.path
    // Lazy + try-wrapped: Tailwind packages are peer dependencies. A
    // consumer who set `tailwind: true` without installing them gets a
    // clear actionable error here rather than an opaque module-not-found
    // from deep in the Tailwind compiler.
    //
    // `_serverDynImport` (defined above) keeps `tailwind.ts` —
    // which top-level-imports `@tailwindcss/node` + `@tailwindcss/oxide`
    // — out of every island bundle's chunk graph. Without it, Bun's
    // analyzer follows the import and the two heavy peer-dep
    // specifiers leak into client bundles where they're unresolvable
    // at runtime. See the helper's JSDoc for why a function-shape
    // (not a bare variable) is required.
    let tailwind: typeof import('./tailwind.ts')['tailwind']
    try {
      ;({ tailwind } = (await _serverDynImport('./tailwind.ts')) as typeof import('./tailwind.ts'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(
        `serve: tailwind: true requires the 'tailwindcss' and '@tailwindcss/node' ` +
          `packages to be installed (they're peer deps). Add them to your app's ` +
          `package.json. Underlying error: ${msg}`,
      )
    }
    // Default content: the project working directory. Apps that keep
    // source elsewhere pass an explicit `tailwind.content` glob.
    const defaultContent = `${process.cwd()}/**/*.{tsx,jsx,ts,js,html}`
    // `base` accepts the bare CSS string or a `themeTokens()` result
    // (object with `.base`) directly — the latter saves the
    // `base: tokens.base` boilerplate.
    const baseCss =
      tw.base && typeof tw.base === 'object' ? tw.base.base : (tw.base as string | undefined)
    const tailwindStart = performance.now()
    const result = await tailwind({
      content: tw.content ?? [defaultContent],
      ...(baseCss ? { base: baseCss } : {}),
    })
    timings.tailwindMs = performance.now() - tailwindStart
    tailwindCss = result.inline
    timings.tailwindBytes = tailwindCss.length
  }

  // T5-B-1 (ADR 0018): per-route bundle splitting. When `clientEntries`
  // is provided, build per-route bundles via Bun's `splitting: true` so
  // each route ships only its own view code + shared chunks (framework
  // runtime + layout).
  //
  // `splitterBundles` holds bundleUrl → raw UTF-8 bytes
  // (`Uint8Array<ArrayBuffer>`). The route serving pass below returns
  // each byte array as the Response body verbatim. The `routeToBundle`
  // map drives per-page `<script src>` emission in renderPage.
  //
  // **Why `Uint8Array`, not `string` (T6-A):** SRI hashes computed on
  // `TextEncoder().encode(string)` were diverging from the bytes Bun's
  // `new Response(string)` actually transmitted (most visibly in dev
  // builds, where `sourcemap: 'inline'` attaches a multi-KB data-URL
  // comment). Storing bytes once at build time and reusing them for
  // both the hash and the Response body makes the bit-identity
  // structural — no string→bytes path can re-encode and break SRI.
  // The explicit `<ArrayBuffer>` parameter (vs `<ArrayBufferLike>`)
  // satisfies both `BufferSource` and `BodyInit` without call-site
  // casts under TS 5.7+ array-buffer variance rules.
  const splitterBundles = new Map<string, Uint8Array<ArrayBuffer>>()
  // T5-D-phase-2 (ADR 0025) SRI: bundle URL → SHA-384 base64. Populated
  // by the route splitter + island bundler; consumed by renderPage to
  // emit `integrity="sha384-…"` per script tag.
  const scriptIntegrity: Record<string, string> = {}
  let routeToBundle: ReadonlyMap<string, string> = new Map()
  let splitterDefaultBundleUrl: string | null = null
  if (options.clientEntries && Object.keys(options.clientEntries).length > 0) {
    if (typeof Bun === 'undefined' || typeof Bun.build !== 'function') {
      throw new Error(
        'serve: clientEntries (per-route bundle splitting) requires Bun.build, ' +
          'which is not available in this runtime. Run under Bun.',
      )
    }
    const splitStart = performance.now()
    // Server-only dynamic import via the `_serverDynImport` helper
    // (defined above). See its JSDoc for the full rationale on why
    // a helper-function shape — not a bare variable — is required to
    // keep `./build/route-splitter.ts` (and its transitive `node:fs`
    // imports) out of every island bundle's chunk graph in both dev
    // and prod modes.
    const { buildRouteSplitBundles } = (await _serverDynImport('./build/route-splitter.ts')) as {
      buildRouteSplitBundles: typeof BuildRouteSplitBundlesFn
    }
    const splitResult = await buildRouteSplitBundles({
      clientEntries: options.clientEntries,
      clientPath,
      plugins: [placeAutoImport()],
      define: { __PLACE_BROWSER__: 'true', __PLACE_DEV__: isProduction ? 'false' : 'true' },
      external: [...BROWSER_BUILD_EXTERNAL],
      minify: browserMinify(isProduction),
      sourcemap: browserSourcemap(isProduction),
    })
    for (const [url, bytes] of splitResult.bundles) {
      splitterBundles.set(url, bytes)
    }
    // SRI hashes from the route splitter (ADR 0025).
    for (const [url, hash] of splitResult.integrity) {
      scriptIntegrity[url] = hash
    }
    routeToBundle = splitResult.routeToBundle
    splitterDefaultBundleUrl = splitResult.defaultBundleUrl
    timings.bundleMs = (timings.bundleMs ?? 0) + (performance.now() - splitStart)
    timings.bundleBytes = (timings.bundleBytes ?? 0) + splitResult.totalBytes
  }

  // T5-C (ADR 0019): per-island bundles. Each registered island becomes
  // its own self-contained ESM module that auto-mounts on
  // `<div data-place-island="<name>">` markers. Pages without any
  // `<Island>` element ship zero island scripts.
  //
  // Two registration forms (merged additively when both are passed):
  //   - `islandsDir: './src/islands'` — filesystem auto-discovery.
  //   - `islands: [Counter]` — explicit list (recommended; uses
  //     metadata attached by the `island()` factory).
  //   - `islands: { Counter: { component, src } }` — verbose record form.
  //
  // When both `islandsDir` AND `islands` are passed, the discovered
  // registry is computed first, then explicit entries are merged on top
  // (last-write-wins by island name). The pattern is for conditional
  // islands like dev-only devtools:
  //
  //   import devtools from './islands/_devtools.tsx'
  //   app({
  //     islandsDir: './src/islands',  // auto-discovers the always-on set
  //     islands: process.env.NODE_ENV !== 'production' ? [devtools] : [],
  //   })
  //
  // A devtools file lives outside discovery (prefix `_` skips it) and is
  // wired in explicitly only in dev — so the prod build doesn't even
  // bundle it, shrinking both the on-disk output AND the shared chunk
  // that's the union of every BUILT island's imports.
  let islandRegistry: Readonly<Record<string, IslandRegistration>> = {}
  const mergedMap: Record<string, IslandRegistration> = {}
  // 1. Discover from islandsDir first (if set) — these are the base.
  if (options.islandsDir) {
    // T5-D phase 2 DX: auto-discover islands. Specifier opacity via
    // `_serverDynImport`.
    const { discoverIslands } = (await _serverDynImport(
      './build/discover-islands.ts',
    )) as typeof import('./build/discover-islands.ts')
    const discovered = await discoverIslands(options.islandsDir)
    for (const [name, reg] of Object.entries(discovered)) mergedMap[name] = reg
  }
  // 2. Layer explicit `islands` on top — overrides discovery by name.
  if (Array.isArray(options.islands)) {
    for (const fn of options.islands as readonly IslandComponent<never>[]) {
      if (typeof fn !== 'function' || typeof fn.__islandName !== 'string') {
        throw new Error(
          'serve: `islands` array must contain values returned by `island(srcUrl, fn)`. ' +
            'Use the record form for hand-rolled registrations.',
        )
      }
      const ssrProps = fn.__islandSsrProps as
        | IslandSsrPropsResolver<Record<string, unknown>>
        | undefined
      mergedMap[fn.__islandName] = {
        component: fn as never,
        src: fn.__islandSrc,
        ...(ssrProps ? { ssrProps } : {}),
      }
    }
  } else if (options.islands) {
    for (const [name, reg] of Object.entries(
      options.islands as Readonly<Record<string, IslandRegistration>>,
    )) {
      mergedMap[name] = reg
    }
  }
  // 3. Auto-attach `@place/devtools` when enabled. 'auto' (default)
  //    resolves to enabled when NODE_ENV !== 'production'. The dynamic
  //    import keeps the devtools dependency off the prod-build module
  //    graph — apps not running devtools don't pay even an import.
  // Devtools auto-attach is gated on `Bun.build` availability — a
  // test runtime (vitest + happy-dom) calls serve() without islands
  // support, and we shouldn't force a build there. The test flag is
  // VITEST=true; we ALSO bail when Bun.build isn't available, which is
  // the structural check (broader than just vitest).
  const isVitest = process.env['VITEST'] === 'true' || process.env['NODE_ENV'] === 'test'
  const hasBunBuild = typeof Bun !== 'undefined' && typeof Bun.build === 'function'
  const devtoolsEnabled =
    !isVitest &&
    hasBunBuild &&
    (options.devtools === true ||
      (options.devtools !== false && process.env['NODE_ENV'] !== 'production'))
  let devtoolsRegistered = false
  if (devtoolsEnabled) {
    try {
      const devtoolsMod = (await _serverDynImport('@place/devtools')) as {
        devtoolsIsland?: IslandComponent<never>
      }
      const dt = devtoolsMod.devtoolsIsland
      if (typeof dt === 'function' && typeof dt.__islandName === 'string') {
        mergedMap[dt.__islandName] = {
          component: dt as never,
          src: dt.__islandSrc,
        }
        devtoolsRegistered = true
      }
    } catch (e) {
      // `@place/devtools` isn't installed — that's fine, the app still
      // boots. One-line warning so the developer knows the option was
      // observed.
      // biome-ignore lint/suspicious/noConsole: one-shot startup misconfig warning
      console.warn(
        'serve: `devtools` was enabled but `@place/devtools` is not installed. ' +
          'Either `bun add @place/devtools` (workspace dep), or pass `devtools: false` to silence this. ' +
          `Underlying error: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  islandRegistry = mergedMap
  // **`rebuildIslands` closure** — captures the entire island-build
  // pipeline so the dev-mode file watcher (set up further down) can
  // re-run it WITHOUT restarting the server when a file under
  // `src/islands/` changes. Without this fast path, every island edit
  // would touch the entry file → trigger `bun --watch` to kill the
  // process → cold-start a fresh server (~1.5 s). The fast path:
  //
  //   1. Rebuild island bundles via `buildIslandBundles` (~200-400 ms).
  //   2. Update `_islandBundleUrls`, `splitterBundles`, the SRI map,
  //      and the shared-chunk preload set in place. The same server
  //      process continues serving — port stays bound, WS stays open.
  //   3. Broadcast `'reload'` to every connected HMR client. The
  //      browser refreshes; its next request hits the now-updated
  //      bundle URLs.
  //
  // Total dev iteration: 250-500 ms vs. 1200-4300 ms for the restart
  // path. The restart path is still the fallback for non-island
  // edits (pages, layouts, framework files); island-only edits — the
  // most common iteration in islands-architecture apps — take the
  // fast path here.
  let rebuildIslands: () => Promise<void> = async () => {}
  if (Object.keys(islandRegistry).length > 0) {
    _setIslandRegistry(islandRegistry)
    if (typeof Bun === 'undefined' || typeof Bun.build !== 'function') {
      throw new Error(
        'serve: `islands` requires Bun.build, which is not available in this runtime. ' +
          'Run under Bun.',
      )
    }
    // Specifier opacity via `_serverDynImport`.
    const { buildIslandBundles } = (await _serverDynImport('./build/island-bundler.ts')) as {
      buildIslandBundles: typeof BuildIslandBundlesFn
    }
    const runIslandBuild = async (registry: Readonly<Record<string, IslandRegistration>>) => {
      return buildIslandBundles({
        islands: registry,
        bundlePrefix: '/islands',
        plugins: [placeAutoImport()],
        define: { __PLACE_BROWSER__: 'true', __PLACE_DEV__: isProduction ? 'false' : 'true' },
        external: [...BROWSER_BUILD_EXTERNAL],
        minify: browserMinify(isProduction),
        sourcemap: browserSourcemap(isProduction),
        ...(options.clientCaps && options.clientCaps.length > 0
          ? { clientCaps: options.clientCaps }
          : {}),
      })
    }
    /** Commit a fresh `buildIslandBundles` result into the live
     *  framework state. Idempotent: subsequent rebuilds replace
     *  the in-memory maps and the previous bundles' URLs become
     *  stale (browsers fetching them get 404 — they have to reload
     *  the page to pick up the new URLs, which is exactly what the
     *  WS reload broadcast triggers). */
    const commitIslandResult = (result: {
      bundles: ReadonlyMap<string, Uint8Array<ArrayBuffer>>
      nameToBundleUrl: ReadonlyMap<string, string>
      integrity: ReadonlyMap<string, string>
    }): void => {
      // Drop URLs that the previous build emitted but the new one
      // didn't — keeps the splitterBundles map bounded.
      splitterBundles.clear()
      for (const [url, bytes] of result.bundles) {
        splitterBundles.set(url, bytes)
      }
      const bundleUrlMap: Record<string, string> = {}
      for (const [name, url] of result.nameToBundleUrl) {
        bundleUrlMap[name] = url
      }
      _setIslandBundleUrls(bundleUrlMap)
      const entryUrls = new Set(result.nameToBundleUrl.values())
      const chunkUrls: string[] = []
      for (const url of result.bundles.keys()) {
        if (entryUrls.has(url)) continue
        if (url.endsWith('.map')) continue
        chunkUrls.push(url)
      }
      _setSharedChunkUrls(chunkUrls)
      // Replace SRI hashes wholesale rather than merging — same
      // rationale as splitterBundles: stale URLs shouldn't keep
      // their entries in the integrity map.
      for (const k of Object.keys(scriptIntegrity)) {
        if (k.startsWith('/islands/')) delete scriptIntegrity[k]
      }
      for (const [url, hash] of result.integrity) {
        scriptIntegrity[url] = hash
      }
    }
    const islandStart = performance.now()
    const islandResult = await runIslandBuild(islandRegistry)
    // Track previous bundle URLs + signatures so the next rebuild can
    // diff and broadcast a per-island swap envelope. Initialized from
    // the first build; reassigned on each rebuild AFTER the diff is
    // computed (so the second rebuild diffs against the first, not
    // against itself).
    let previousIslandUrls = new Map(islandResult.nameToBundleUrl)
    let previousSignatures = new Map(islandResult.signature)
    commitIslandResult(islandResult)
    // Wire the rebuild closure so the watcher can invoke it later.
    rebuildIslands = async () => {
      const t0 = performance.now()
      try {
        const fresh = await runIslandBuild(islandRegistry)
        // Diff against the previous build BEFORE committing so we
        // know which islands actually changed shape/content. An island
        // whose URL OR signature changes is a candidate for hot swap;
        // unchanged islands need no client action. ADR 0028 phase 2.
        const updates: Array<{
          readonly name: string
          readonly url: string
          readonly integrity: string | null
          readonly signature: string
        }> = []
        for (const [name, url] of fresh.nameToBundleUrl) {
          const prevUrl = previousIslandUrls.get(name)
          const prevSig = previousSignatures.get(name)
          const sig = fresh.signature.get(name) ?? ''
          if (prevUrl !== url || prevSig !== sig) {
            const integrity = fresh.integrity.get(url) ?? null
            updates.push({ name, url, integrity, signature: sig })
          }
        }
        commitIslandResult(fresh)
        previousIslandUrls = new Map(fresh.nameToBundleUrl)
        previousSignatures = new Map(fresh.signature)
        if (_registeredCaches.size > 0) {
          await Promise.all(Array.from(_registeredCaches, (c) => c.delete({}).catch(() => {})))
        }
        // **ADR 0028 phase 2 wire.** If at least one island actually
        // changed, push a typed `swap` envelope listing the changed
        // entries. The client either hot-swaps per island (no page
        // reload) or — for any reason it can't — falls back to
        // `location.reload()`. If nothing changed (rebuild triggered
        // by a peripheral edit that happened to land in the islands
        // directory), broadcast a plain reload as the safe default.
        if (updates.length > 0) {
          broadcastHmrSwap(updates)
        } else {
          broadcastHmrReload()
        }
        process.stdout.write(
          `[place hmr] islands rebuilt in ${Math.round(performance.now() - t0)} ms` +
            (updates.length > 0 ? ` (${updates.length} swapped)` : '') +
            '\n',
        )
      } catch (e) {
        // biome-ignore lint/suspicious/noConsole: dev-only diagnostic
        console.error('[place hmr] island rebuild failed:', e)
      }
    }
    // T8-D classifier report (ADR 0030). Printed once per startup so
    // the dev sees, for every island, the level the future `view()`
    // primitive would compile it to + the byte cost at that level vs
    // current emission. Report-only in Tier 8; informational for now,
    // load-bearing in Tier 9. Gated on the manifest having entries
    // (skipped silently when no islands are configured).
    if (islandResult.viewManifest.entries.length > 0 && !isProduction) {
      // Same path as `buildIslandBundles` above — re-importing
      // returns the cached module. Opacity via `_serverDynImport`.
      const { renderViewManifestReport } = (await _serverDynImport(
        './build/island-bundler.ts',
      )) as { renderViewManifestReport: typeof BuildRenderViewManifestReportFn }
      // Single multi-line console.log so the report renders as a unit
      // and editors that group consecutive console output keep it intact.
      // biome-ignore lint/suspicious/noConsole: dev startup banner
      console.log(`\n${renderViewManifestReport(islandResult.viewManifest)}\n`)
    }
    timings.bundleMs = (timings.bundleMs ?? 0) + (performance.now() - islandStart)
    timings.bundleBytes = (timings.bundleBytes ?? 0) + islandResult.totalBytes
  } else {
    _setIslandRegistry(undefined)
    _setIslandBundleUrls(undefined)
  }

  // Cache-Control for content-hashed bundles (the route splitter +
  // island bundler emit content-hashed URLs). Hashed URLs are
  // immutable: a new build changes the URL, so browsers can cache
  // forever.
  const hashedBundleCacheControl = 'public, max-age=31536000, immutable'

  const compiled = compileServeRoutes(options.routes, clientPath)

  // Auto-Tailwind: inject the CSS source into every page. Inline gets
  // `{ inline: css }` in styles; file mode gets a `<link>` to the served
  // path. We mutate compiled[i].page.styles (a fresh shallow copy) so
  // each rendered Page picks it up without callers having to wire it.
  if (tailwindCss !== null) {
    const tailwindStyle: StyleSrc = tailwindInline ? { inline: tailwindCss } : tailwindPath
    for (const r of compiled) {
      if (!r.page) continue
      const existing = r.page.styles
      const list: StyleSrc[] = existing
        ? Array.isArray(existing)
          ? [...existing]
          : [existing]
        : []
      // Tailwind first so user styles can override Tailwind utilities.
      r.page = { ...r.page, styles: [tailwindStyle, ...list] }
    }
  }

  // Framework-supplied CSS for the `data-place-contents` marker. The
  // marker is emitted on every wrapper span the framework uses to bound
  // a reactive region (ClientOnly, Deferred, Suspense fallback, Show
  // with fallback, etc.). Those wrappers must NOT participate in the
  // box model — flex / grid / `h-full` on the wrapped subtree must
  // inherit from the wrapper's *parent*. `display: contents` does
  // exactly that.
  //
  // Why a class and not the obvious `style="display:contents"`: strict
  // CSP (`style-src` without `'unsafe-hashes'`) blocks every inline
  // style attribute the HTML parser sees. Routing the rule through an
  // attribute-selector + a hashed `<style>` block keeps the default
  // `security: 'standard'` preset working without any app-level CSP
  // override. The block is hashed and added to `style-src` by the
  // collection pass below — same path Tailwind + view-transitions
  // already take. See ADR 0014.
  const placeFrameworkStyle: StyleSrc = {
    inline: '[data-place-contents]{display:contents}',
  }
  for (const r of compiled) {
    if (!r.page) continue
    const existing = r.page.styles
    const list: StyleSrc[] = existing ? (Array.isArray(existing) ? [...existing] : [existing]) : []
    // Prepended so user styles override the framework's defaults if
    // they really want to (they almost never will — `display:contents`
    // is the only safe behavior for these wrappers).
    r.page = { ...r.page, styles: [placeFrameworkStyle, ...list] }
  }

  // View Transitions — opt-in cross-document navigation animation. CSS
  // at-rule only; no JS, no <ClientRouter> wrapper. Browsers that don't
  // support cross-document VT (anything older than Chrome 126 / Safari
  // 18 / Firefox 144) ignore the at-rule and navigate normally. The
  // outer @media gate disables animations for users who've requested
  // reduced motion at the OS level — same contract any reasonable web
  // app applies. See ADR 0006.
  if (options.viewTransitions === true) {
    const viewTransitionStyle: StyleSrc = {
      inline:
        '@media (prefers-reduced-motion: no-preference) {\n' +
        '  @view-transition { navigation: auto; }\n' +
        '}\n',
    }
    for (const r of compiled) {
      if (!r.page) continue
      const existing = r.page.styles
      const list: StyleSrc[] = existing
        ? Array.isArray(existing)
          ? [...existing]
          : [existing]
        : []
      // Append after user styles so users can override individual
      // ::view-transition-* pseudo-elements without specificity wars.
      r.page = { ...r.page, styles: [...list, viewTransitionStyle] }
    }
  }

  // Collect SHA-256 hashes for every unique inline <style> block that
  // SSR will emit. Strict CSP requires each inline style's hash in
  // style-src; otherwise the browser silently drops the block. This
  // covers Tailwind, layout styles, page styles, and the view-transitions
  // snippet appended above — all of which are static at startup, so the
  // hashing pass runs once here rather than per request.
  const inlineStyleHashes = new Set<string>()
  const seenInlineCss = new Set<string>()
  const collectInlineCss = (styles: StyleSrc | StyleSrc[] | undefined): void => {
    if (!styles) return
    const list = Array.isArray(styles) ? styles : [styles]
    for (const s of list) {
      if (typeof s === 'object' && typeof s.inline === 'string') {
        seenInlineCss.add(s.inline)
      }
    }
  }
  for (const r of compiled) {
    if (!r.page) continue
    const pageLayouts: readonly AnyLayout[] = r.page.layout
      ? Array.isArray(r.page.layout)
        ? r.page.layout
        : [r.page.layout]
      : []
    const effectiveLayouts: readonly AnyLayout[] =
      serveLevelLayouts.length > 0 ? [...serveLevelLayouts, ...pageLayouts] : pageLayouts
    for (const l of effectiveLayouts) collectInlineCss(l.styles)
    collectInlineCss(r.page.styles)
  }
  for (const css of seenInlineCss) {
    inlineStyleHashes.add(await sha256Base64(css))
  }

  // Security headers are computed PER REQUEST so each response can carry
  // a fresh CSP nonce. The non-CSP headers (HSTS, X-Frame-Options, etc.)
  // don't actually change between requests — but recomputing the whole
  // set per request is cheap (small object construction) and keeps the
  // code simple. When `security` is unset, the function returns `{}`
  // so non-secured deployments pay nothing.
  //
  // The inline style hash list is stable across requests (computed
  // above from every layout + page + framework-emitted style block).
  const baseSecurityOpts: RenderSecurityOptions = {
    ...(inlineStyleHashes.size > 0 ? { extraStyleHashes: [...inlineStyleHashes] } : {}),
  }
  const securityHeadersFor = (
    nonce: string,
    inlineStyleAttrHashes?: readonly string[],
  ): Record<string, string> =>
    renderSecurityHeaders(options.security, {
      ...baseSecurityOpts,
      scriptNonce: nonce,
      ...(inlineStyleAttrHashes && inlineStyleAttrHashes.length > 0
        ? { inlineStyleAttrHashes: [...inlineStyleAttrHashes] }
        : {}),
    })

  // 404 dispatch. User-supplied `options.notFound` gets full control of
  // its response (sets its own headers). The default impl emits a
  // self-contained styled HTML doc — same visual language as the dev
  // error overlay. The inline `<style>` block's SHA-256 is added to
  // the response's CSP `style-src` (under `'unsafe-hashes'` semantics)
  // so strict CSP doesn't strip the styling and security headers ride
  // along on the 404.
  const notFoundFn = (
    req: Request,
    baseHeaders: Record<string, string>,
  ): Response | Promise<Response> => {
    if (options.notFound) return options.notFound(req)
    const path = (() => {
      try {
        return new URL(req.url).pathname
      } catch {
        return req.url
      }
    })()
    const escPath = path
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .slice(0, 200)
    const styleCss =
      ':root{--ac:oklch(0.78 0.14 65);--bg:oklch(0.13 0.006 286);--bg2:oklch(0.17 0.006 286);' +
      '--card:oklch(0.18 0.006 286);--bd:oklch(0.27 0.006 286);--fg:oklch(0.97 0.001 286);--mu:oklch(0.62 0.012 286);}' +
      '@media(prefers-color-scheme:light){:root{--bg:oklch(0.985 0.002 286);--bg2:oklch(0.97 0.003 286);' +
      '--card:oklch(1 0 0);--bd:oklch(0.92 0.005 286);--fg:oklch(0.18 0.008 286);--mu:oklch(0.48 0.014 286);}}' +
      '*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0}' +
      'body{font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
      'background:var(--bg);color:var(--fg);min-height:100vh;display:flex;align-items:center;justify-content:center}' +
      '.card{max-width:520px;padding:2.5rem 2.25rem;border:1px solid var(--bd);border-radius:12px;' +
      'background:var(--card);box-shadow:0 1px 0 color-mix(in oklab,var(--fg) 4%,transparent)}' +
      '.code{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--mu);letter-spacing:.08em;' +
      'text-transform:uppercase;margin-bottom:.85rem;display:flex;align-items:center;gap:.6rem}' +
      '.dot{width:8px;height:8px;border-radius:50%;background:var(--ac);box-shadow:0 0 0 3px color-mix(in oklab,var(--ac) 30%,transparent)}' +
      'h1{font-size:1.625rem;margin:0 0 .55rem;letter-spacing:-0.01em}' +
      'p{margin:0;color:var(--mu);line-height:1.6}' +
      'p code{padding:1px 6px;border-radius:4px;background:var(--bg2);color:var(--fg);' +
      'font:12px ui-monospace,SFMono-Regular,Menlo,monospace;border:1px solid var(--bd)}' +
      '.actions{margin-top:1.5rem;display:flex;gap:.5rem;flex-wrap:wrap}' +
      '.actions a{padding:.55rem .9rem;border-radius:8px;border:1px solid var(--bd);background:var(--bg2);' +
      'color:var(--fg);text-decoration:none;font-size:13px;transition:background-color .15s,border-color .15s}' +
      '.actions a:hover{background:var(--card);border-color:color-mix(in oklab,var(--ac) 50%,var(--bd))}' +
      '.actions a.primary{background:color-mix(in oklab,var(--ac) 14%,var(--bg2));border-color:color-mix(in oklab,var(--ac) 35%,var(--bd))}'
    const html =
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>404 · Not found</title>' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<meta name="color-scheme" content="light dark">' +
      `<style>${styleCss}</style></head><body>` +
      '<main class="card" role="main">' +
      '<div class="code"><span class="dot" aria-hidden="true"></span><span>404 · Not Found</span></div>' +
      '<h1>This route doesn&rsquo;t exist.</h1>' +
      `<p>No page is registered at <code>${escPath}</code>. Check the URL or head back home.</p>` +
      '<div class="actions"><a class="primary" href="/">Home</a><a href="javascript:history.back()">Back</a></div>' +
      '</main></body></html>'
    return (async (): Promise<Response> => {
      // Add the inline `<style>` block's hash to the response CSP so
      // browsers don't strip the styling under strict policies.
      // SHA-256 is the algorithm CSP `style-src` recognizes for hash
      // sources; the hash covers the bytes between `<style>` and
      // `</style>`. The css is a fixed string within this fn so the
      // hash is stable across requests.
      const headers: Record<string, string> = { ...baseHeaders }
      const csp = headers['Content-Security-Policy']
      if (csp) {
        const styleHash = await sha256Base64(styleCss)
        const styleToken = `'sha256-${styleHash}'`
        if (/style-src\s+[^;]+/.test(csp)) {
          headers['Content-Security-Policy'] = csp.replace(
            /(style-src\s+[^;]+)/,
            (full) => `${full} ${styleToken}`,
          )
        } else {
          headers['Content-Security-Policy'] =
            `${csp.trimEnd().replace(/;\s*$/, '')}; style-src 'self' ${styleToken}`
        }
      }
      return new Response(html, {
        status: 404,
        headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
      })
    })()
  }

  // ISR cache wiring. The cache is registered into the global revalidate()
  // registry so server actions / scheduled jobs can invalidate by path or
  // tag. Inflight-dedupe Map ensures a single render serves all concurrent
  // waiters for the same key — without it, a cache-miss thundering herd
  // would render the same page N times.
  const cache: CacheStore | null = options.cache ?? null
  if (cache !== null) _registeredCaches.add(cache)
  const inflight = new Map<string, Promise<CacheEntry>>()

  // Render-and-cache: builds the entry, stores it, returns it. Inflight
  // dedupe — concurrent calls for the same key share one render.
  const renderAndCache = async (
    page: AnyPage,
    req: Request,
    params: Record<string, string>,
    cacheKey: string,
    rev: { ttl: number; tags?: string[] },
    scriptNonce: string,
    htmlClassPrefix: string,
  ): Promise<CacheEntry> => {
    const existing = inflight.get(cacheKey)
    if (existing) return existing
    const promise = (async (): Promise<CacheEntry> => {
      // Per-route bootstrap (T5-B-1): the route's own split bundle URL
      // if `clientEntries` was set, else the splitter's shared default
      // bundle, else nothing (pure-islands or static page).
      const bootstrap =
        (page.path !== undefined ? routeToBundle.get(page.path) : undefined) ??
        splitterDefaultBundleUrl ??
        null
      const enableSpaNav = Object.keys(islandRegistry).length > 0
      const spaNavVT = options.viewTransitions === true
      // Production-only SRI — see explanation at the other call site below.
      const integrityForRender =
        isProductionRuntime() && Object.keys(scriptIntegrity).length > 0
          ? scriptIntegrity
          : undefined
      // T6-B (race-safe): inline-style-attr hash collection now happens
      // INSIDE renderPage (synchronously around `renderToString`),
      // and the resulting hashes ride out on a private header we
      // strip below. The previous wrap here was a real race under
      // concurrent requests — see the comment at the top of
      // `INLINE_STYLE_HASHES_HEADER`.
      const res = await renderPage(page, req, params, {
        ...(bootstrap !== null ? { bootstrap } : {}),
        ...(enableSpaNav ? { enableSpaNav: true } : {}),
        ...(spaNavVT ? { spaNavViewTransitions: true } : {}),
        ...(isProduction ? {} : { enableHmr: true }),
        ...(effectiveEarlyHead.length > 0 ? { extraEarlyHead: effectiveEarlyHead } : {}),
        ...(integrityForRender ? { scriptIntegrity: integrityForRender } : {}),
        scriptNonce,
        ...(htmlClassPrefix ? { htmlClassPrefix } : {}),
        ...(serveLevelLayouts.length > 0 ? { extraLayouts: serveLevelLayouts } : {}),
        ...(options.transformBody ? { transformBody: options.transformBody } : {}),
        ...(devtoolsRegistered ? { emitDevtoolsMarker: true } : {}),
      })
      const inlineHashHeader = res.headers.get(INLINE_STYLE_HASHES_HEADER)
      const inlineStyleAttrHashes = inlineHashHeader
        ? inlineHashHeader.split(',').filter((h) => h.length > 0)
        : []
      const headers: Record<string, string> = {}
      res.headers.forEach((v, k) => {
        // Strip the framework-private header before persisting the entry.
        // It's a handoff channel; user agents must never see it, and
        // letting it survive in a cache entry would leak per-render
        // state across cache reuses.
        if (k.toLowerCase() === INLINE_STYLE_HASHES_HEADER) return
        headers[k] = v
      })
      const entry: CacheEntry = {
        body: await res.text(),
        headers,
        builtAt: Date.now(),
        ...(rev.tags ? { tags: rev.tags } : {}),
        ...(inlineStyleAttrHashes.length > 0 ? { inlineStyleAttrHashes } : {}),
      }
      if (cache !== null) await cache.set(cacheKey, entry)
      return entry
    })()
    inflight.set(cacheKey, promise)
    promise.finally(() => inflight.delete(cacheKey))
    return promise
  }

  const responseFromEntry = (entry: CacheEntry): Response =>
    // CacheEntry.body is `string | Uint8Array` for image cache support;
    // both are valid BodyInit but TS's Uint8Array<ArrayBufferLike>
    // narrowing trips the union check. The cast is sound: at runtime
    // both are Response-acceptable bodies.
    new Response(entry.body as string | Uint8Array<ArrayBuffer>, { headers: entry.headers })

  // Merge the serve's default headers UNDER the page's response headers
  // (page wins on conflicts — page knows its content type etc.).
  const mergeHeaders = (res: Response, defaults: Record<string, string>): Response => {
    if (Object.keys(defaults).length === 0) return res
    const merged = new Headers(defaults)
    res.headers.forEach((v, k) => {
      merged.set(k, v)
    })
    return new Response(res.body, { status: res.status, headers: merged })
  }

  const normalizeRevalidate = (
    rev: number | { ttl: number; tags?: string[] } | undefined,
  ): { ttl: number; tags?: string[] } | null => {
    if (rev === undefined) return null
    if (typeof rev === 'number') return { ttl: rev }
    return rev
  }

  // Pre-process static-asset prefixes so the per-request hot path is a
  // single linear scan with O(prefixes) startsWith checks. Sort longest-
  // first so a more-specific prefix wins over a less-specific one
  // (e.g. '/assets/icons' over '/assets').
  const staticPrefixes = Object.entries(options.static ?? {})
    .map(([prefix, dir]) => ({
      prefix: prefix.endsWith('/') ? prefix.slice(0, -1) : prefix,
      dir: dir.endsWith('/') ? dir.slice(0, -1) : dir,
    }))
    .sort((a, b) => b.prefix.length - a.prefix.length)

  const tryStaticAsset = async (
    pathname: string,
    baseHeaders: Record<string, string>,
  ): Promise<Response | null> => {
    for (const { prefix, dir } of staticPrefixes) {
      if (prefix !== '' && !pathname.startsWith(`${prefix}/`) && pathname !== prefix) continue
      const rel = prefix === '' ? pathname : pathname.slice(prefix.length)
      // Reject path traversal — anything resolving outside `dir` is a no.
      if (rel.includes('..') || rel.includes('\0')) return null
      const filePath = dir + rel
      const file = await readStaticFile(filePath)
      if (!file.exists) continue
      const headers: Record<string, string> = { ...baseHeaders }
      if (file.contentType) headers['Content-Type'] = file.contentType
      // Set Content-Length from the file's stat'd size. Buys two
      // benefits: (a) HTTP/1.1 keep-alive uses fewer chunk boundaries,
      // (b) the compression layer's size-threshold check can bail
      // without buffering for known-small payloads (and without
      // touching headers, which preserves byte-exact Content-Type OWS).
      if (file.size !== null) {
        headers['Content-Length'] = String(file.size)
      }
      return new Response(file.body, { headers })
    }
    return null
  }

  const dispatch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    // Per-request: generate a fresh CSP script nonce. Each response
    // carries its own nonce in the CSP header AND on every inline
    // <script> we emit; reusing nonces across requests defeats the
    // security model. Cost is one crypto.getRandomValues — microseconds.
    const nonce = generateScriptNonce()
    const baseHeaders: Record<string, string> = {
      ...securityHeadersFor(nonce),
      ...userHeaders,
    }

    // T5-B-1: per-route bundle URLs (ADR 0018). Every entry produced
    // by the route splitter (per-route chunks + shared chunks Bun
    // extracted) lives in `splitterBundles`. We serve any URL the map
    // knows about. In dev the URLs are stable across restarts; in prod
    // they include a content hash (Bun's chunk-naming scheme).
    const splitBytes =
      splitterBundles.size > 0 && (req.method === 'GET' || req.method === 'HEAD')
        ? splitterBundles.get(url.pathname)
        : undefined
    if (splitBytes !== undefined) {
      // `splitBytes` is the *same* `Uint8Array` we hashed for SRI at build
      // time (T6-A). Passing it directly to `Response` writes those
      // bytes verbatim — no string encoder in the path that could
      // disagree with what we declared in the `integrity` attribute.
      const bytes = splitBytes
      // Discriminate JS vs sourcemap by URL extension. External
      // sourcemaps (`*.js.map`) are JSON content; serving them as
      // JavaScript would make DevTools refuse the map and fall back
      // to no source-level frames.
      const isMap = url.pathname.endsWith('.map')
      return new Response(bytes, {
        headers: {
          ...baseHeaders,
          'Content-Type': isMap
            ? 'application/json; charset=utf-8'
            : 'application/javascript; charset=utf-8',
          'Cache-Control': isProduction ? hashedBundleCacheControl : bundleCacheControl,
        },
      })
    }
    // Built-in: Tailwind CSS file (only when tailwind.inline is false).
    if (
      tailwindCss !== null &&
      !tailwindInline &&
      (req.method === 'GET' || req.method === 'HEAD') &&
      url.pathname === tailwindPath
    ) {
      return new Response(tailwindCss, {
        headers: {
          ...baseHeaders,
          'Content-Type': 'text/css; charset=utf-8',
          'Cache-Control': bundleCacheControl,
        },
      })
    }
    // Static assets. GET only — POST/PUT to a static path is a 404 via
    // the route table, not a method-not-allowed (apps that need static
    // PUTs should compose explicit handlers).
    if ((req.method === 'GET' || req.method === 'HEAD') && staticPrefixes.length > 0) {
      const asset = await tryStaticAsset(url.pathname, baseHeaders)
      if (asset !== null) return asset
    }
    // Default robots.txt — Lighthouse SEO flags missing robots.txt as a
    // Crawling-and-Indexing issue. The framework serves a permissive
    // default unless the app overrode it (string body OR `false` to
    // suppress entirely OR a route in `routes:` that wins by priority).
    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      url.pathname === '/robots.txt' &&
      options.robots !== false
    ) {
      const body = typeof options.robots === 'string' ? options.robots : 'User-agent: *\nAllow: /\n'
      return new Response(body, {
        status: 200,
        headers: { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    // Resolve the active theme for this request, if a serve-level theme
    // is installed. The result is the class to prefix onto every page's
    // `meta.htmlClass`. Computed once per request and threaded through
    // both ISR and non-ISR paths. Cheap (one cookie-string scan).
    const activeTheme =
      options.theme !== undefined
        ? readThemeFromRequest(
            req,
            options.theme as { default: string; names: ReadonlyArray<string> },
          )
        : null
    const htmlClassPrefix =
      options.theme !== undefined && activeTheme !== null
        ? options.theme.htmlClass(activeTheme as never)
        : ''

    for (const r of compiled) {
      // HEAD falls through to GET (Express, Bun.serve, the HTTP spec).
      // We strip the body in the response below; the handler itself runs
      // exactly as for GET.
      const methodMatches =
        r.method === '*' || r.method === req.method || (req.method === 'HEAD' && r.method === 'GET')
      if (!methodMatches) continue
      const params = r.matcher.match(url.pathname)
      if (params === null) continue
      if (r.page) {
        const rev = normalizeRevalidate(r.page.revalidate)
        // T6-B: per-response CSP includes SHA-256 hashes of every
        // `style="…"` attribute emitted in THIS body (+ `'unsafe-hashes'`).
        // Build the page's `baseHeaders` from the render-captured hash
        // set (live render) or from the cached set (cache hit). Asset /
        // 404 paths still use the cheaper `baseHeaders` computed at the
        // top of dispatch (no inline styles in those responses).
        const pageHeadersFor = (hashes: readonly string[] | undefined): Record<string, string> => ({
          ...securityHeadersFor(nonce, hashes),
          ...userHeaders,
        })
        // ISR path: only when the page opts in AND a cache is registered.
        // Without the cache option, revalidate is silently a no-op so
        // setting it on a page doesn't break in dev.
        if (rev !== null && cache !== null && req.method === 'GET') {
          // Include theme in the cache key so light + dark visitors get
          // separate cache entries (else one theme's render would be
          // served to the other).
          const themeFragment = activeTheme !== null ? `|theme=${activeTheme}` : ''
          const cacheKey = `${url.pathname}${url.search}${themeFragment}`
          const cached = await cache.get(cacheKey)
          if (cached) {
            const ageSec = (Date.now() - cached.builtAt) / 1000
            if (ageSec < rev.ttl) {
              // Fresh: serve directly, rebuild CSP with the entry's
              // saved inline-style hashes so strict CSP allows them.
              return mergeHeaders(
                responseFromEntry(cached),
                pageHeadersFor(cached.inlineStyleAttrHashes),
              )
            }
            // Stale: serve cached, kick off background revalidation.
            // The promise is intentionally floating — we don't await it,
            // and we don't return a rejected promise to the request.
            void renderAndCache(r.page, req, params, cacheKey, rev, nonce, htmlClassPrefix).catch(
              () => {
                // Background revalidation failed: keep the stale entry. A
                // future request retries; meanwhile users see slightly old
                // content rather than 500. This is the SWR contract.
              },
            )
            return mergeHeaders(
              responseFromEntry(cached),
              pageHeadersFor(cached.inlineStyleAttrHashes),
            )
          }
          // Cache miss: render synchronously, store, serve.
          const entry = await renderAndCache(
            r.page,
            req,
            params,
            cacheKey,
            rev,
            nonce,
            htmlClassPrefix,
          )
          return mergeHeaders(responseFromEntry(entry), pageHeadersFor(entry.inlineStyleAttrHashes))
        }
        // Non-ISR path: render fresh every request.
        // Per-route bootstrap (T5-B-1): the route's own split bundle
        // URL if `clientEntries` was set, else the splitter's shared
        // default, else nothing.
        const bootstrap =
          (r.page.path !== undefined ? routeToBundle.get(r.page.path) : undefined) ??
          splitterDefaultBundleUrl ??
          null
        const enableSpaNav = Object.keys(islandRegistry).length > 0
        const spaNavVT = options.viewTransitions === true
        // **SRI in dev = friction without security gain.**
        //
        // `--watch` rebuilds island bundles whenever any source file
        // changes (auto-import plugin re-runs, content hashes shift,
        // chunk split URLs rotate). Each rebuild produces fresh
        // `integrity="sha384-…"` values. A browser tab that loaded the
        // page BEFORE the rebuild keeps its cached HTML pointing at
        // stale hashes; when its scripts re-fetch (cache miss or SPA-nav),
        // the new bundle bytes don't match the stale integrity and the
        // browser blocks the resource — exactly the cascade the user
        // hit ("Failed to find a valid digest" across every island).
        //
        // Production builds are stable: bundles ship once, hashes pin
        // the bytes the browser receives. There SRI is meaningful.
        // Dev gets the rest of the security model (strict CSP, nonces,
        // CORS, same-origin) but skips the byte-pinning. The user
        // hard-refresh is no longer required after a server restart.
        const integrityForRender =
          isProductionRuntime() && Object.keys(scriptIntegrity).length > 0
            ? scriptIntegrity
            : undefined
        // T6-B (race-safe): renderPage handles inline-style hash
        // collection internally and ships the hashes back via a
        // private response header; strip that header here before
        // building per-response CSP, so it never leaks to the user
        // agent.
        const res = await renderPage(r.page, req, params, {
          ...(bootstrap !== null ? { bootstrap } : {}),
          ...(enableSpaNav ? { enableSpaNav: true } : {}),
          ...(spaNavVT ? { spaNavViewTransitions: true } : {}),
          ...(Object.keys(spaNavThemeClassMap).length > 0 ? { spaNavThemeClassMap } : {}),
          ...(effectiveEarlyHead.length > 0 ? { extraEarlyHead: effectiveEarlyHead } : {}),
          ...(options.prefetch === false ? { spaNavPrefetch: false } : {}),
          ...(isProduction ? {} : { enableHmr: true }),
          ...(integrityForRender ? { scriptIntegrity: integrityForRender } : {}),
          scriptNonce: nonce,
          ...(htmlClassPrefix ? { htmlClassPrefix } : {}),
          ...(serveLevelLayouts.length > 0 ? { extraLayouts: serveLevelLayouts } : {}),
          ...(options.transformBody ? { transformBody: options.transformBody } : {}),
          ...(devtoolsRegistered ? { emitDevtoolsMarker: true } : {}),
        })
        const inlineHashHeader = res.headers.get(INLINE_STYLE_HASHES_HEADER)
        const inlineStyleAttrHashes = inlineHashHeader
          ? inlineHashHeader.split(',').filter((h) => h.length > 0)
          : []
        // Build the outbound response without the private handoff header.
        const outgoingHeaders = new Headers(res.headers)
        outgoingHeaders.delete(INLINE_STYLE_HASHES_HEADER)
        const cleanRes = new Response(res.body, {
          status: res.status,
          headers: outgoingHeaders,
        })
        return mergeHeaders(cleanRes, pageHeadersFor(inlineStyleAttrHashes))
      }
      if (r.fn) return r.fn(req, params)
    }
    return notFoundFn(req, baseHeaders)
  }

  const innerFetch = async (
    req: Request,
    srv: Bun.Server<unknown>,
  ): Promise<Response | undefined> => {
    // **Dev-mode HMR endpoint.** When NODE_ENV !== production, the
    // framework opens `/__place_hmr` as a WebSocket endpoint. Pages
    // include an inline client that connects to it on load; if the
    // server restarts (e.g. `bun --watch` killed and re-spawned the
    // process), the client detects the reconnect and reloads the
    // page so the user sees their change without refreshing.
    //
    // `Bun.Server.upgrade(req)` flips the request to a WebSocket
    // connection — the `websocket` handler installed at `Bun.serve`
    // time takes over from here. We return `undefined` to tell Bun
    // we've handled the request via upgrade.
    if (!isProduction && new URL(req.url).pathname === HMR_WS_PATH) {
      const upgraded = (
        srv as Bun.Server<unknown> & {
          upgrade: (r: Request, opts: { data: { kind: string } }) => boolean
        }
      ).upgrade(req, { data: { kind: 'hmr' } })
      if (upgraded) return undefined
      return new Response('upgrade required', { status: 426 })
    }
    // Per-request capability scope. Concurrent requests get isolated cap
    // stacks via AsyncLocalStorage; a `provide()` or `install()` made
    // inside one request's render is invisible to any other in-flight
    // request. Module-level `cap.install()` calls (made before any
    // request) remain visible as a baseline.
    const raw = await runWithCapabilityScope(async () => {
      if (options.fetch) {
        const pre = await options.fetch(req, srv)
        if (pre !== null) return pre
      }
      return dispatch(req)
    })
    // Compression pass: gzip text-shaped bodies when the client
    // accepts it. Cuts HTML payload ~75% on average; the single
    // largest factor in TTFB → first paint on a slow connection.
    // Bails harmlessly on streaming responses, pre-encoded bodies,
    // and small payloads. See `compress.ts` for the policy.
    const res = await maybeCompress(raw, req)
    // HEAD: strip the body but preserve status + headers (RFC 9110).
    // The route handler ran the same path as GET; we drop the body here
    // so clients get the cheaper response without re-implementing HEAD
    // logic per route.
    if (req.method === 'HEAD' && res.body !== null) {
      return new Response(null, { status: res.status, headers: res.headers })
    }
    return res
  }
  // Per-request log wrapper. One line per request: METHOD path → status
  // (Nms). Default-on in dev, default-off in production. Doesn't affect
  // the response — pure observability.
  //
  // **`undefined` return passthrough.** `innerFetch` returns
  // `undefined` for requests it handled via `srv.upgrade(req)` (the
  // HMR WebSocket endpoint). The log wrapper preserves the undefined
  // — Bun's fetch handler accepts `undefined` to mean "WebSocket
  // upgrade complete, no Response needed."
  const fetch = wantsRequestLog
    ? async (req: Request, srv: Bun.Server<unknown>): Promise<Response | undefined> => {
        const reqStart = performance.now()
        const res = await innerFetch(req, srv)
        if (res === undefined) return undefined
        const ms = performance.now() - reqStart
        process.stdout.write(
          formatRequestLogLine(req.method, new URL(req.url).pathname, res.status, ms),
        )
        return res
      }
    : innerFetch
  // Adapter path: hand control to the adapter and DON'T call Bun.serve.
  // The adapter wires `builder.dispatch` into its host (Node http,
  // Vercel function, Cloudflare worker, etc.). Returns a stub server
  // shape so the caller can still `.stop()` the framework — adapters
  // can override by calling `builder.adapter` and managing their own
  // lifecycle, but the default returned object is a no-op. This is the
  // ONLY runtime path when adapter is set; Bun.serve is never invoked.
  if (options.adapter) {
    // Adapters never trigger the dev HMR endpoint (only `Bun.serve`
    // takes the `/__place_hmr` upgrade path), so the runtime
    // `undefined` return that the HMR branch introduces can never
    // surface here. Cast to satisfy the builder's stricter dispatch
    // signature.
    const builder: Builder = {
      name: options.name ?? 'place-app',
      dispatch: fetch as (req: Request, srv?: unknown) => Promise<Response>,
      outDir: options.outDir ?? './dist',
      routes: compiled.map((r) => ({
        method: r.method,
        pattern: r.matcher.pattern,
        isPage: r.page !== null,
      })),
    }
    await options.adapter.adapt(builder)
    // Adapters take full ownership of the HTTP server. Return a
    // minimal Server-shaped stub so the call site's `server.stop()`
    // calls don't crash. Real adapters can override by exposing their
    // own server object via the builder; that's a Phase 5.x cut.
    return makeAdapterStubServer()
  }

  // Bun-native path: Bun.serve directly. Bun.serve's options type is a
  // union with a required-websocket branch and a no-websocket branch.
  // exactOptionalPropertyTypes requires us to pick one explicitly
  // rather than making it conditionally present.
  //
  // **Dev-mode WebSocket handler.** When NODE_ENV !== production, the
  // framework installs a minimal WS handler that accepts upgrades on
  // `/__place_hmr`. The handler holds the connection open so the
  // client's `onopen` fires; on server restart (e.g. `bun --watch`
  // re-spawned the process) the connection drops and the client
  // detects a reconnect — see `__hmr.ts` for the full reload flow.
  //
  // If the user provided their own `options.websocket`, we wrap it:
  // upgrades destined for `/__place_hmr` route to the framework's
  // handler (via `ws.data.kind === 'hmr'` — set on upgrade);
  // everything else routes to the user's handler.
  const userWs = options.websocket
  // **Connected HMR clients.** The framework's file watcher pushes
  // `'reload'` to every member of this set when an island bundle was
  // rebuilt in-place (no server restart). The HMR client (see
  // `__hmr.ts`) calls `location.reload()` on receipt — fresh request
  // hits the now-updated `_islandBundleUrls` map. ~300 ms total for
  // an island edit vs. ~1500 ms for a full `bun --watch` restart.
  type HmrWS = Bun.ServerWebSocket<{ kind?: string }>
  const hmrClients = new Set<HmrWS>()
  // **Boot id** — unique per server process. Sent to every HMR client
  // on connect as a `hello` envelope. The client reloads only when
  // this value CHANGES across connects (a genuine server restart),
  // never on a bare reconnect — so a flaky WebSocket (proxied dev
  // environments, sleep/wake, transient drops) can reconnect freely
  // without triggering a reload loop. Replaces the old "reload on the
  // second onopen" heuristic, which looped whenever the socket flapped.
  const hmrBootId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const hmrHandler: Bun.WebSocketHandler<{ kind?: string }> = {
    open(ws) {
      if (ws.data?.kind === 'hmr') {
        hmrClients.add(ws)
        try {
          ws.send(JSON.stringify({ t: 'hello', boot: hmrBootId }))
        } catch (_) {
          // Raced closed before the greeting — nothing to do.
        }
      }
    },
    message(_ws, _msg) {
      // Reserved for future T11 patch streaming. Today: ignore.
    },
    close(ws) {
      hmrClients.delete(ws)
    },
  }
  /** Push `reload` to every connected HMR client. The client calls
   *  `location.reload()` — see `__hmr.ts` for the contract. The
   *  legacy bare string `'reload'` is preserved for back-compat with
   *  any external HMR consumer that already speaks it; new code paths
   *  prefer `broadcastHmrSwap()` below. */
  const broadcastHmrReload = (): void => {
    for (const ws of hmrClients) {
      try {
        ws.send('reload')
      } catch (_) {
        // Dead connections drop on next iteration; nothing to do.
      }
    }
  }
  /**
   * Push a typed `swap` envelope listing the islands whose bundles
   * changed in the last rebuild. The client iterates `updates` and
   * for each one disposes the existing mount, removes the old
   * `<script>` tag, and injects a new tag at the new URL. The new
   * tag's module-init re-discovers the markers and re-mounts them.
   * No page reload; parent-scope state is preserved (ADR 0028).
   *
   * If the client can't perform the swap (any update has an unknown
   * island name, the script load fails, the dispose throws), it
   * falls back to `location.reload()`.
   */
  const broadcastHmrSwap = (
    updates: ReadonlyArray<{
      readonly name: string
      readonly url: string
      readonly integrity: string | null
      readonly signature: string
    }>,
  ): void => {
    const payload = JSON.stringify({ t: 'swap', updates })
    for (const ws of hmrClients) {
      try {
        ws.send(payload)
      } catch (_) {
        // Dead connections drop on next iteration; nothing to do.
      }
    }
  }
  // biome-ignore lint/suspicious/noExplicitAny: union narrowing — Bun.WebSocketHandler is generic and we mux by data.kind
  const wsHandler: any = !isProduction
    ? userWs
      ? {
          open(ws: { data: { kind?: string } } & Record<string, unknown>) {
            const fn =
              ws.data?.kind === 'hmr' ? hmrHandler.open : (userWs as { open?: unknown }).open
            if (typeof fn === 'function') (fn as (w: typeof ws) => void)(ws)
          },
          message(ws: { data: { kind?: string } } & Record<string, unknown>, msg: string | Buffer) {
            const fn =
              ws.data?.kind === 'hmr'
                ? hmrHandler.message
                : (userWs as { message?: unknown }).message
            if (typeof fn === 'function')
              (fn as (w: typeof ws, m: string | Buffer) => void)(ws, msg)
          },
          close(
            ws: { data: { kind?: string } } & Record<string, unknown>,
            code: number,
            reason: string,
          ) {
            const fn =
              ws.data?.kind === 'hmr' ? hmrHandler.close : (userWs as { close?: unknown }).close
            if (typeof fn === 'function')
              (fn as (w: typeof ws, c: number, r: string) => void)(ws, code, reason)
          },
        }
      : hmrHandler
    : userWs
  // ===== Static-export branch (T19-A / ADR 0051) =====
  //
  // All setup is done: Tailwind compiled, island bundles built into
  // `splitterBundles` (SRI in `scriptIntegrity`), routes `compiled`.
  // Instead of binding `Bun.serve`, pre-render every GET page route
  // to HTML and write a full static site. The island bundles written
  // are the SAME bytes that were SRI-hashed, so the `integrity="…"`
  // attributes verify on the static host. Returns before any server
  // bind / dev watcher / banner.
  if (options.staticExport) {
    const { writeStaticSite } = (await _serverDynImport('./build-static.ts')) as {
      writeStaticSite: typeof import('./build-static.ts').writeStaticSite
    }
    // Default theme class — static renders have no request cookie, so
    // the document ships the theme's default; the theme-toggle island
    // flips it on the client at hydrate.
    const staticHtmlClass =
      options.theme !== undefined
        ? options.theme.htmlClass((options.theme as { default: string }).default as never)
        : ''
    const staticRoutes = compiled
      .filter((r) => r.page !== null && (r.method === 'GET' || r.method === '*'))
      .map((r) => ({ pattern: r.matcher.pattern, page: r.page as AnyPage }))
    const staticSpaNav = Object.keys(islandRegistry).length > 0
    const renderStatic = async (
      page: AnyPage,
      pathStr: string,
      params: Record<string, string>,
    ): Promise<{ html: string; styleHashes: string[] }> => {
      const req = new Request(`http://localhost${pathStr}`)
      const bootstrap =
        (page.path !== undefined ? routeToBundle.get(page.path) : undefined) ??
        splitterDefaultBundleUrl ??
        null
      // No `scriptNonce` and no `enableHmr` — a static document carries
      // no per-request nonce (the strict CSP is delivered via `_headers`
      // — T19-B) and is a production artefact.
      const res = await renderPage(page, req, params, {
        ...(bootstrap !== null ? { bootstrap } : {}),
        ...(staticSpaNav ? { enableSpaNav: true } : {}),
        ...(options.viewTransitions === true ? { spaNavViewTransitions: true } : {}),
        ...(Object.keys(spaNavThemeClassMap).length > 0 ? { spaNavThemeClassMap } : {}),
        ...(options.prefetch === false ? { spaNavPrefetch: false } : {}),
        ...(Object.keys(scriptIntegrity).length > 0 ? { scriptIntegrity } : {}),
        ...(staticHtmlClass ? { htmlClassPrefix: staticHtmlClass } : {}),
        ...(serveLevelLayouts.length > 0 ? { extraLayouts: serveLevelLayouts } : {}),
        ...(options.transformBody ? { transformBody: options.transformBody } : {}),
        // earlyHead — the auto theme script + app entries. MUST reach
        // the static render: on a static host there is no server to
        // read a cookie at SSR, so the early-paint script is the only
        // thing that applies the persisted theme.
        ...(effectiveEarlyHead.length > 0 ? { extraEarlyHead: effectiveEarlyHead } : {}),
        ...(devtoolsRegistered ? { emitDevtoolsMarker: true } : {}),
      })
      const html = await res.text()
      const styleHeader = res.headers.get(INLINE_STYLE_HASHES_HEADER)
      const styleHashes = styleHeader ? styleHeader.split(',').filter((h) => h.length > 0) : []
      return { html, styleHashes }
    }
    // Every emitted bundle (per-route split chunks + island bundles)
    // is written verbatim alongside the rendered HTML.
    const allBundles = new Map(splitterBundles)
    const staticResult = await writeStaticSite({
      outDir: options.staticExport.outDir,
      routes: staticRoutes,
      render: renderStatic,
      bundles: allBundles,
      // A static host has no server to default-serve `/robots.txt`;
      // emit it at build time (matches the live server's behaviour).
      ...(options.robots !== undefined ? { robots: options.robots } : {}),
    })
    process.stdout.write(
      `place: static export → ${staticResult.outDir} ` +
        `(${staticResult.pages.length} pages, ${staticResult.bundles.length} bundles)\n`,
    )
    // Static export produces no server. `app().build()` discards this
    // return; the cast keeps `_serveImpl`'s signature intact for the
    // normal (server) path.
    return undefined as unknown as Bun.Server<unknown>
  }

  // Cast: Bun's `fetch` typing requires `MaybePromise<Response>` but
  // returning `undefined` is the runtime contract for "this request
  // was handled via `server.upgrade()`" (Bun's own examples in the
  // docs do this). The runtime accepts undefined fine; only the type
  // is too narrow.
  // biome-ignore lint/suspicious/noExplicitAny: Bun.serve fetch-return-type narrowing
  const fetchCast = fetch as any
  const server = wsHandler
    ? Bun.serve({ port, fetch: fetchCast, websocket: wsHandler })
    : Bun.serve({ port, fetch: fetchCast })
  if (wantsBanner) {
    process.stdout.write(
      formatStartupBanner({
        name: options.name ?? 'place-app',
        url: `http://localhost:${server.port}`,
        routes: compiled.map((r) => ({
          method: r.method,
          pattern: r.matcher.pattern,
          isPage: r.page !== null,
        })),
        // Islands ship per-island bundles + per-route split chunks at
        // content-hashed URLs — there is no single client-bundle path.
        clientPath: null,
        timings,
        startupMs: performance.now() - startupStart,
        hasTheme: options.theme !== undefined,
        themeNames: options.theme !== undefined ? (options.theme.names as readonly string[]) : null,
        hasSecurity: options.security !== undefined,
        hasCache: options.cache !== undefined,
      }),
    )
  }
  // **Dev-mode framework-owned file watcher.** `bun --watch` is
  // supposed to follow transitive imports and restart on any change,
  // but in practice it only reliably detects changes to the entry
  // file itself (verified on WSL2 + macOS — likely platform-
  // dependent `fs.watch` semantics). Without a watcher that catches
  // page / island / component edits, the user's "I changed a file
  // and didn't see anything" experience is the dominant DX complaint.
  //
  // The framework takes ownership of the watch loop. On any change
  // under the source directory, we touch the entry file's mtime —
  // which IS reliably watched — to force `bun --watch` to restart.
  // The HMR client (see `__hmr.ts`) then catches the restart and
  // reloads the browser.
  //
  // **Why this isn't a workaround in the bad sense.** The framework
  // is making its own promise about dev iteration (edit → see) work
  // regardless of which file the user edits. The mechanism is fully
  // structural: it watches a known directory tree, owns the
  // restart-signal channel (entry mtime), and degrades cleanly if
  // not run under `--watch` (the watcher fires but nothing observes
  // the entry touch — no harm done). The proper end state is for
  // Bun to follow transitive deps; until then the framework fills
  // the gap with a watcher of its own.
  if (!isProduction && typeof Bun !== 'undefined' && typeof Bun.main === 'string') {
    void startSrcWatcher(process.cwd(), Bun.main, options.islandsDir, rebuildIslands)
  }
  return server
}

/**
 * Recursively watch the project's `src/` (or the cwd if there's no
 * `src/`) for source-file changes. When any tracked file changes
 * (and isn't the entry itself, which would cause a self-restart
 * loop), touch the entry file's mtime to signal `bun --watch` that
 * a restart is needed.
 *
 * **Filter**: only watches `.ts` / `.tsx` / `.js` / `.jsx` / `.css` /
 * `.html` / `.json` files. Skips `node_modules`, dotfiles, and
 * generated paths (`dist/`, `.place/`, `build/`).
 *
 * **Best-effort**: silently no-ops on `fs.watch` failures. The user's
 * dev experience degrades gracefully back to `bun --watch`-only.
 */
/**
 * Dev-mode supervisor: spawn the user's entry as a subprocess with
 * `__PLACE_DEV_CHILD=1` set; on each clean (exit-0) termination,
 * respawn. Non-zero exit means the user's code errored — propagate
 * the exit code and let the user fix the bug.
 *
 * **Signal propagation.** SIGINT (Ctrl-C) and SIGTERM are forwarded
 * to the child so a kill signal at the supervisor level stops the
 * actual server, not just this watcher loop.
 *
 * Lives at module scope (not inside `_serveImpl`) so the supervisor's
 * memory footprint stays small — the heavy stuff in `_serveImpl`
 * (Tailwind, security headers, island bundler) runs only inside the
 * child subprocess.
 */
async function runDevSupervisor(): Promise<never> {
  // biome-ignore lint/suspicious/noExplicitAny: Bun.Subprocess type narrowing
  let child: any = null
  const propagate = (sig: 'SIGINT' | 'SIGTERM'): void => {
    if (child) {
      try {
        child.kill(sig)
      } catch (_) {
        // Child already dead — nothing to do.
      }
    }
    process.exit(sig === 'SIGTERM' ? 143 : 130)
  }
  process.on('SIGINT', () => propagate('SIGINT'))
  process.on('SIGTERM', () => propagate('SIGTERM'))
  while (true) {
    child = Bun.spawn(['bun', Bun.main], {
      env: { ...process.env, __PLACE_DEV_CHILD: '1' },
      // Inherit stdio so the child's banner/logs/errors flow to the
      // user's terminal as if it were running directly.
      // biome-ignore lint/suspicious/noExplicitAny: Bun typing for stdio: 'inherit' is narrower than the runtime accepts
      stdio: ['inherit', 'inherit', 'inherit'] as any,
    })
    const code = (await child.exited) as number | null
    if (code !== 0) {
      // biome-ignore lint/suspicious/noConsole: dev-only diagnostic
      console.error(`[place] dev server exited with code ${code ?? 'unknown'}; not restarting`)
      process.exit(code ?? 1)
    }
    // Exit-0 = framework-triggered restart on file change.
    // Loop straight back to spawn — no banner, no delay. The HMR
    // client's reconnect-detection drives the browser refresh as
    // soon as the new child's WS is up.
  }
}

async function startSrcWatcher(
  cwd: string,
  entryPath: string,
  islandsDir: string | undefined,
  rebuildIslands: () => Promise<void>,
): Promise<void> {
  // Dynamic-import to keep node:fs out of any non-server graph and
  // avoid module-init cost when the server starts in prod.
  const { existsSync, statSync } = (await _serverDynImport('node:fs')) as typeof import('node:fs')
  const { watch } = (await _serverDynImport(
    'node:fs/promises',
  )) as typeof import('node:fs/promises')
  const { resolve } = (await _serverDynImport('node:path')) as typeof import('node:path')

  // Pick the directory to watch: prefer `<cwd>/src` if it exists.
  const srcDir = resolve(cwd, 'src')
  const watchDir = existsSync(srcDir) && statSync(srcDir).isDirectory() ? srcDir : cwd

  // Absolute path to the islands directory (if configured) — used to
  // categorize changes into the fast path (rebuild only) vs. the slow
  // path (server restart via entry-touch).
  const absIslandsDir = islandsDir ? resolve(cwd, islandsDir) : null

  const exts = ['.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.json']
  const skipDirs = ['node_modules', '.git', 'dist', '.place', 'build', '.next']
  const isWatched = (filename: string | null): boolean => {
    if (!filename) return false
    for (const skip of skipDirs) {
      if (filename === skip || filename.startsWith(`${skip}/`)) return false
      if (filename.includes(`/${skip}/`)) return false
    }
    if (filename.startsWith('.') || filename.includes('/.')) return false
    for (const ext of exts) if (filename.endsWith(ext)) return true
    return false
  }
  /** True iff the changed file lives under the registered islands
   *  directory. Treated as "island-only" — we rebuild the bundles
   *  in-place and broadcast a WS reload instead of restarting the
   *  server. Other changes (pages, layouts, framework files) take
   *  the slow path (exit 0; supervisor respawns). */
  const isIslandFile = (filename: string): boolean => {
    if (!absIslandsDir) return false
    const abs = resolve(watchDir, filename)
    return abs.startsWith(`${absIslandsDir}/`) || abs === absIslandsDir
  }

  // Throttle the island fast-path rebuild — coalesces save
  // bursts (editors that write multiple files in one save, etc.).
  let islandPending: ReturnType<typeof setTimeout> | null = null
  const triggerIslandRebuild = (): void => {
    if (islandPending) return
    islandPending = setTimeout(() => {
      islandPending = null
      void rebuildIslands()
    }, 50)
  }
  // **Initial-burst grace period.** `fs.watch(dir, { recursive: true })`
  // on Linux + Bun walks the tree to attach inotify watches; that walk
  // briefly fires "change" events for files we just started watching.
  // The first 200 ms after the watcher attaches is grace — any event
  // that fires before we exit it is ignored to avoid an instant
  // restart-loop on startup.
  const watcherAttachTime = Date.now()
  let restarting = false
  try {
    const watcher = watch(watchDir, { recursive: true })
    for await (const event of watcher) {
      if (Date.now() - watcherAttachTime < 200) continue
      if (restarting) continue
      if (event.filename && resolve(watchDir, event.filename) === entryPath) continue
      if (!isWatched(event.filename)) continue
      if (event.filename && isIslandFile(event.filename)) {
        // **Fast path: island-only edit.** Rebuild bundles in place,
        // push WS reload — no server restart. ~700 ms typical.
        triggerIslandRebuild()
        continue
      }
      // **Slow path: any other source change.** Exit cleanly (code
      // 0). The dev supervisor (`runDevSupervisor`) spawned this
      // child and is waiting on its exit — it'll respawn instantly
      // with fresh modules. The browser's HMR client detects the WS
      // gap and reloads as soon as the new child's WS is up.
      //
      // `restarting` flag prevents double-fire if `fs.watch` emits
      // multiple events per write (it does on Linux: a single
      // `writeFile` can produce open + modify + close events). We
      // log and exit on the first event; subsequent events are
      // dropped silently.
      restarting = true
      // biome-ignore lint/suspicious/noConsole: dev-only diagnostic
      console.log(`[place hmr] ${event.filename} changed — restarting...`)
      process.exit(0)
    }
  } catch (_) {
    // fs.watch unsupported / permission denied — silently degrade.
    // No log: this is a defensive branch and noise here would
    // confuse normal startup.
  }
}

// ===== Pretty terminal output =====
// Extracted to ./logging.ts (Tier 20 decomposition). `formatStartupBanner`
// + `formatRequestLogLine` are imported above; both are server-internal,
// not public API.

// Stub server returned when an adapter takes over. Adapters typically
// don't need to expose their own lifecycle to the caller (the host
// runtime handles start/stop), but the framework's signature promises a
// Server-shaped object. The stub satisfies that contract minimally.
function makeAdapterStubServer(): Bun.Server<unknown> {
  // We can't actually construct a real Bun.Server outside of Bun.serve,
  // so we lie via a cast. The `stop()` is the only method users
  // typically call; everything else throws if accessed.
  const stub = {
    stop(): void {},
    port: 0,
    hostname: 'adapter',
  }
  return stub as unknown as Bun.Server<unknown>
}

// Public `serve` export — gated on the `__PLACE_BROWSER__` build-time
// define. On the client bundle the define is `true`, so this folds to
// the throwing stub at constant-fold time; `_serveImpl` (the 800-line
// server-only body) becomes unreferenced and the bundler tree-shakes
// it along with its transitive deps (security-headers, devalue.stringify,
// Bun.serve, Bun.build, fs/promises, tailwindcss…). On the server
// runtime the define is undefined → typeof check → falsy → real impl.
//
// The throwing stub is a few bytes; the function body it replaces was
// ~21 KB gzipped per the v0.3 bundle breakdown.
export const serve: (options: ServeOptions) => Promise<Bun.Server<unknown>> =
  // The ternary's condition is constant-folded at build time: with the
  // `__PLACE_BROWSER__: 'true'` define injected by Bun.build for the
  // client bundle, this folds to the throwing stub at build time and
  // `_serveImpl` becomes unreferenced — the bundler drops it (and its
  // transitive deps) under `sideEffects: ["./src/preload.ts"]`. On the
  // server runtime, no define is set: `typeof __PLACE_BROWSER__` is
  // `'undefined'`, the condition is `false`, and the real impl is used.
  typeof __PLACE_BROWSER__ !== 'undefined' && __PLACE_BROWSER__ === true
    ? ((() => {
        throw new Error(
          'serve() is a server-only export. It should never execute in a browser bundle ' +
            '— if you are seeing this error, the build-time `__PLACE_BROWSER__` define ' +
            'was misconfigured or `serve` was called from client code.',
        )
      }) as unknown as (options: ServeOptions) => Promise<Bun.Server<unknown>>)
    : _serveImpl
