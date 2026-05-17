// Round 5 — `app(pages)` + `routes(prefix, pages)` (audit 5.2, 5.6).
//
// The Round 5 "smaller app" thesis: a place-ts app is one entry file
// (`app.tsx`) that imports pages (each declared with `page(path, def)`)
// and lists them. The framework derives the routes object from the
// pages' `path` fields — the path is written exactly once, where the
// page lives.
//
// `app(pages, opts)` returns an `{ serve, boot }` pair that wraps the
// existing `serve()` / `boot()`. The same `app(...)` value can be
// invoked from either runtime: on the server, call `.serve()`; in the
// browser, call `.boot()`. Same import, no server/client mirror file.
//
// `routes(prefix, pages, opts)` is a pure value transform — for each
// page in `pages`, returns a new Page whose `path` is `prefix + page.path`
// and whose `layout` defaults to `opts.layout` if the page doesn't
// already declare one. Used to group feature folders:
//
//   // admin/index.ts
//   export default routes('/admin', [dashboard, users, settings], { layout: adminLayout })
//
// Composes with `app()`:
//
//   app([home, ...adminRoutes, ...postRoutes]).serve()
//
// This is the deliberate alternative to file-based routing — paths
// stay values, refactors stay TypeScript renames, no codegen, no
// stale `.d.ts`.

import type { Capability } from '@place/capability'
import { RouterCap } from '@place/routing'
import type { AnyLayout, AnyPage, ClientCapInstall, ServeOptions } from './index.ts'
import { boot, serve } from './index.ts'

// Build-time define injected by Bun.build's `define` option in the
// client-bundle path. `true` in the browser bundle (the framework
// passes `define: { __PLACE_BROWSER__: 'true' }` in its Bun.build
// invocation), undefined on the server runtime. Used below to dead-
// code-eliminate the server branch of `run()` from the client bundle.
declare const __PLACE_BROWSER__: boolean | undefined

/**
 * Options accepted by `app(pages, opts)` (the legacy positional form).
 * Everything `serve()` accepts except `routes` (which is derived from
 * the pages array). The `clientEntry` field stays optional — pass it
 * to enable client-side hydration; omit for static-only sites.
 */
export type AppOptions = Omit<ServeOptions, 'routes'>

/**
 * A capability install entry for the `caps` config option. Two forms:
 *
 *   1. **Tuple form** `[Cap, factory]` — browser-only. Equivalent to
 *      `{ client: factory }`. Use for caps that only make sense in the
 *      browser (e.g. a path router that drives `window.history`).
 *   2. **Object form** `[Cap, { client?, server? }]` — per-runtime
 *      factories. The `server` factory is invoked before SSR so pages
 *      can render with real cap data; the `client` factory is invoked
 *      before `.boot()` and replaces the SSR impl in the browser. The
 *      object form is the right shape when an SSR-friendly impl exists
 *      (e.g. an in-memory store seeded with the same data the
 *      client-side store will load on first paint).
 *
 * `Capability<any>` widens the type so heterogeneous caps fit one
 * array; each install call is type-safe at the cap's boundary.
 */
export interface CapPerRuntime {
  /** Browser-side install. Runs once before `boot()` hydrates. */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous caps share one array; factory return is matched per-cap
  client?: () => any
  /**
   * Server-side install. Runs **once at server boot** (NOT per
   * request) — the returned value becomes the cap's process-wide
   * baseline. Every request's capability scope inherits from it.
   *
   * Right uses:
   *   - In-memory dataset seeded from disk at startup (read-only
   *     across requests).
   *   - Config object (logger handle, feature flags, etc.).
   *   - SSR-friendly read-only store mirroring the client's
   *     localStorage layout for first-paint parity.
   *
   * **Wrong** uses:
   *   - Per-request session, request ID, or auth state — these
   *     would leak between requests because every request reads
   *     the same baseline instance. Install those *inside* the
   *     route handler (`load:` or a wrapping middleware) so each
   *     request gets its own scope.
   *
   * The runtime-isolation tier of capabilities (per-request scopes
   * via `runWithCapabilityScope`) lives at the request boundary,
   * not in this factory. See ADR 0005 for the scope discipline.
   */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous caps share one array; factory return is matched per-cap
  server?: () => any
}
// biome-ignore lint/suspicious/noExplicitAny: heterogeneous caps share one array; factory return is matched per-cap inside `.run()`
export type CapInstall = readonly [Capability<any>, (() => any) | CapPerRuntime]

/**
 * Config-object form of `app(...)`. Includes the `pages` list inline
 * + an optional `caps` array for browser-only capability installation
 * + everything `ServeOptions` accepts (minus `routes`). When passed
 * `.run()` dispatches to `.serve()` server-side or installs caps +
 * `.boot()` browser-side — single entry, no manual `if (typeof window)`
 * branching, no manual `RouterCap.install(...)` calls.
 */
export interface AppConfig extends Omit<ServeOptions, 'routes' | 'port'> {
  /** Pages to register. Order doesn't matter; each page's `path` is the
   *  route key. */
  pages: readonly AnyPage[]
  /** TCP port for the server. Defaults to `process.env.PORT` (parsed)
   *  or `5174`. Ignored in the browser. */
  port?: number
  /**
   * Global stylesheet — Tailwind v4 input CSS appended to the theme's
   * generated base (which already imports Tailwind and defines `@theme`
   * tokens). Use for app-wide rules that don't fit as utility classes
   * on elements: `::selection`, `::-webkit-scrollbar`, `.prose`,
   * `@keyframes`, semantic classes consumed by raw-HTML emitters
   * (e.g. a syntax tokenizer), etc.
   *
   * Accepts a single string OR an array of strings. Arrays are
   * concatenated with newline separators — the canonical pattern
   * for layered styles:
   *
   *   import { styles as designStyles } from '@place/design'
   *   import { styles as appStyles } from './styles.ts'
   *
   *   app({ pages, theme, styles: [designStyles, appStyles] }).run()
   *
   * The array form replaces the previous template-literal pattern
   * (`styles: \`${designStyles}\n${appStyles}\``) — readable, typed,
   * easy to extend with more layers.
   *
   * Concatenated to `tailwind.base` automatically — apps don't have
   * to know about that wiring. If the caller already passes
   * `tailwind: { base }` explicitly, `styles` is appended to that base.
   */
  styles?: string | readonly string[]
  /**
   * Router factory. The most common cap install across every app that
   * uses `<Link>` is `[RouterCap, pathRouter]` — naming the slot
   * directly avoids the tuple-of-tuple shape. The framework installs
   * the result on the client side before `.boot()`. Internally
   * equivalent to adding `[RouterCap, router]` to `caps`.
   *
   * Use the general `caps:` array for other capability installs
   * (sessions, stores, request-id propagation, etc.) or for routers
   * that need an SSR-friendly companion (see the per-runtime
   * `CapPerRuntime` shape for that).
   */
  // biome-ignore lint/suspicious/noExplicitAny: router factory return is matched to RouterCap inside `.run()`
  router?: () => any
  /** Browser-only capability installs. The framework calls each
   *  `factory()` once before `.boot()` and discards the disposer. Use
   *  for `[NoteStoreCap, () => seedStore()]`, `[RequestIdCap, () =>
   *  newId()]`, etc. The `router:` first-class slot covers the most
   *  common case. Ignored server-side. */
  caps?: readonly CapInstall[]
}

/**
 * The `app()` return value. Same instance dispatches to both runtimes:
 *
 *   - `.serve()` — call from the Bun server entry. Returns the live
 *     `Bun.Server`. Throws if invoked in a browser.
 *   - `.boot()` — call from the client entry. Hydrates the page tree
 *     against the SSR'd DOM. Throws if invoked outside a browser.
 *   - `.routes` — the derived routes object. Useful for tests, for
 *     adapters, and for users who need the underlying shape.
 */
export interface App {
  /** Start Bun.serve with the derived routes. Server-side only. */
  serve(): Promise<Bun.Server<unknown>>
  /** Hydrate against the SSR'd DOM. Browser-side only. */
  boot(): void
  /**
   * Universal entry: dispatches to `.serve()` on the server runtime
   * (returns the started `Bun.Server` promise) and to caps-install +
   * `.boot()` on the browser runtime (returns `void`). Reads `port`
   * from `process.env.PORT` if not explicitly configured. Lets app
   * entries collapse to a single `export default app({…}).run()`
   * without the `if (typeof window)` branch.
   *
   * The return type is `Promise<Bun.Server<unknown>> | undefined`
   * because the same expression has different shapes per runtime —
   * the caller almost always discards the return (it's an entry-point
   * file).
   */
  run(): Promise<Bun.Server<unknown>> | undefined
  /**
   * Pre-render the app to a static site (T19-A / ADR 0051). Runs the
   * full server setup — Tailwind compile, island discovery + bundling,
   * theme resolution — then, instead of starting a server, writes the
   * complete static site to `outDir`:
   *
   *   <outDir>/index.html, <outDir>/about/index.html, …
   *   <outDir>/islands/<name>-<hash>.js  (+ shared chunks)
   *   <outDir>/_headers                  (Cloudflare strict CSP)
   *
   * The exported site is fully interactive (island bundles ship,
   * SPA-nav works). Server-side only — for CDN static hosts
   * (Cloudflare Pages, etc.).
   */
  build(options: { outDir: string }): Promise<void>
  /** Derived routes object: `{ '/path': page, '/other': page2, ... }`. */
  readonly routes: Record<string, AnyPage>
}

/**
 * Construct an `App` from an explicit list of pages. Each page must
 * have been declared with the two-arg `page(path, def)` form so its
 * `path` is set. Throws if any page lacks a path or if two pages
 * declare the same path.
 *
 * Pages can be combined freely:
 *
 *   // app.tsx
 *   import { app } from '@place/component'
 *   import home from './home.page'
 *   import postRoutes from './posts'   // exports Page[] for /posts/*
 *   import adminRoutes from './admin'  // exports Page[] for /admin/*
 *
 *   export default app(
 *     [home, ...postRoutes, ...adminRoutes],
 *     { security: 'standard', port: 5173 },
 *   ).serve()
 *
 * For browser:
 *
 *   // client.tsx (or share app.tsx and invoke .boot())
 *   import app from './app'
 *   app.boot()
 */
// Two callable forms:
//   1. Config-object form (preferred): `app({ pages: [...], caps: [...], ... }).run()`
//   2. Legacy positional form: `app([...pages], opts).serve()` / `.boot()`
// The runtime detects by whether the first arg is an array.
export function app(config: AppConfig): App
export function app(pages: readonly AnyPage[], opts?: AppOptions): App
export function app(arg1: AppConfig | readonly AnyPage[], arg2: AppOptions = {}): App {
  // Normalize to a single config + pages list.
  const config: AppConfig = Array.isArray(arg1)
    ? { ...(arg2 as AppOptions), pages: arg1 as readonly AnyPage[] }
    : (arg1 as AppConfig)
  const pages = config.pages
  if (!Array.isArray(pages)) {
    throw new TypeError('app(): config.pages must be an array of pages')
  }
  const routes: Record<string, AnyPage> = {}
  for (const p of pages) {
    if (typeof p?.path !== 'string' || p.path.length === 0) {
      throw new Error(
        'app(): every page must have a path. Declare with page(path, def) ' +
          '(two-arg form). The legacy page(def) form has no path and must be ' +
          "registered via serve({ routes: { '/path': page } }) instead.",
      )
    }
    if (Object.hasOwn(routes, p.path)) {
      throw new Error(`app(): duplicate path '${p.path}'. Two pages cannot share the same route.`)
    }
    routes[p.path] = p
  }

  // Strip the config-only fields before passing to `serve()` so the
  // underlying serve options object is clean.
  const { pages: _pages, caps: _caps, styles: globalStylesRaw, ...rest } = config
  const serveOpts = rest as Omit<ServeOptions, 'routes'>

  // Normalize `styles` to a single string. Accept either a string OR
  // an array (DX win — `styles: [designStyles, appStyles]` instead of
  // the brittle template-literal concatenation).
  const globalStyles =
    Array.isArray(globalStylesRaw)
      ? globalStylesRaw.filter((s) => typeof s === 'string' && s.length > 0).join('\n')
      : globalStylesRaw

  // Resolve `styles` into a Tailwind base string. Tailwind base ordering:
  //   1. theme.base (from `themeTokens()` — contains `@import "tailwindcss"`,
  //      `@theme` color tokens, per-theme classes, system-preference media).
  //   2. globalStyles (the user's `styles` option — appended).
  // The user's `styles` therefore lands AFTER the Tailwind import + theme
  // and can reference theme tokens (`var(--color-accent)`, etc.) plus use
  // any Tailwind directive (`@utility`, `@layer`, `@keyframes`).
  //
  // If the caller already passes `tailwind: { base: … }` explicitly, we
  // append `globalStyles` to their base instead of the theme's. Explicit
  // base wins for the prefix; `styles` always lands at the end.
  if (globalStyles !== undefined && globalStyles.length > 0) {
    const tw = serveOpts.tailwind
    if (tw === false) {
      if (typeof console !== 'undefined') {
        console.warn(
          'app(): `styles` is ignored when `tailwind: false`. ' +
            'Set `tailwind: true` (or pass `tailwind: { … }`) or remove `styles`.',
        )
      }
    } else {
      // Pull the base from either an explicit tailwind.base or the
      // theme. The theme's `.base` is the canonical Tailwind starter
      // (with @import + @theme). The caller can override either.
      // biome-ignore lint/suspicious/noExplicitAny: theme shape varies; we only need `.base`.
      const themeBase = (config.theme as { base?: string } | undefined)?.base
      const explicit = tw === true || tw === undefined ? undefined : tw
      const explicitBase = explicit?.base
      // `base` may be a string OR a `{ base: string }` object (callers
      // can pass `themeTokens()` result directly per ServeTailwindOptions).
      const explicitBaseStr =
        typeof explicitBase === 'object' && explicitBase !== null && 'base' in explicitBase
          ? explicitBase.base
          : (explicitBase as string | undefined)
      const prefix = explicitBaseStr ?? themeBase ?? '@import "tailwindcss";'
      const combinedBase = prefix + '\n' + globalStyles
      serveOpts.tailwind = { ...(explicit ?? {}), base: combinedBase }
    }
  }

  // Resolve the port: explicit > env > default. `typeof process` guard
  // lets the same code path compile to dead-code on `target: 'browser'`
  // (Bun.build replaces `typeof process` with `'undefined'`).
  const resolvePort = (): number => {
    if (typeof config.port === 'number') return config.port
    if (typeof process !== 'undefined') {
      const raw = process.env?.['PORT']
      if (typeof raw === 'string') {
        const parsed = Number.parseInt(raw, 10)
        if (Number.isFinite(parsed)) return parsed
      }
    }
    return 5174
  }

  // Per-runtime cap installer. The CapInstall entry can be either a
  // tuple `[Cap, factory]` (client-only, back-compat) or an object form
  // `[Cap, { client?, server? }]`. The runtime parameter picks which
  // factory to invoke; missing factories on a given runtime are a no-op.
  //
  // The first-class `router:` slot is desugared into a client-only
  // RouterCap install. If the user also lists `[RouterCap, …]` in
  // `caps:`, that entry wins (explicit always overrides the sugar) and
  // the `router:` slot is skipped to avoid double-install.
  const installCapsFor = (runtime: 'client' | 'server'): void => {
    const capsList = config.caps ?? []
    const capsHasRouter = capsList.some(([cap]) => cap === RouterCap)
    if (runtime === 'client' && config.router && !capsHasRouter) {
      RouterCap.install(config.router())
    }
    for (const [cap, factoryOrPair] of capsList) {
      const factory =
        typeof factoryOrPair === 'function'
          ? runtime === 'client'
            ? factoryOrPair
            : undefined
          : factoryOrPair[runtime]
      if (factory) cap.install(factory())
    }
  }

  // No `clientEntry` auto-default. The framework's hydration model is
  // islands-only — ADR 0020 retired full-page hydration. Every
  // interactive sub-tree is an island, bundled on its own; a page with
  // no island ships zero framework JavaScript.
  //
  // The old behaviour auto-defaulted `clientEntry` to `Bun.main` unless
  // `islands`/`islandsDir` was set. That regressed every app that
  // simply had no islands yet (or declared its islands a different
  // way): `Bun.main` is the isomorphic `app.ts`, so bundling it for the
  // client dragged the ENTIRE framework onto a plain content page —
  // ~19 KB gzipped — the exact opposite of the islands thesis.
  //
  // `clientEntry` / `clientJs` are still honored when passed explicitly
  // (a legacy / gradual-migration escape hatch); `app()` never
  // synthesizes one.
  const resolveServeOpts = (): ServeOptions => {
    const opts: Partial<ServeOptions> = { ...serveOpts, port: resolvePort(), routes }
    // Auto-defaults — the framework principle is "secure by default."
    // `security: 'standard'` (CSP + auto-CSRF + same-origin +
    // body-limit + proto-pollution guards) is the right default for
    // any app shipping HTML. Apps that need the bare server (e.g.
    // running behind an external security proxy) opt out explicitly.
    if (opts.security === undefined) {
      opts.security = 'standard'
    }
    // T5-D-phase-2 (ADR 0024): auto cap-install. For each cap config
    // the user passed via `router:` or `caps:`, extract the
    // `__placeClientImport` metadata and forward as `clientCaps` so
    // the island bundler can generate `_auto-init.ts` automatically.
    // Eliminates the user-authored `_init.ts` side-effect module
    // pattern entirely. Only relevant when the app has islands — a
    // zero-island app ships no client code, so no client caps either.
    const hasIslands =
      (Array.isArray(config.islands) && config.islands.length > 0) ||
      (config.islands !== undefined &&
        !Array.isArray(config.islands) &&
        Object.keys(config.islands).length > 0) ||
      typeof config.islandsDir === 'string'
    const clientCaps: ClientCapInstall[] = []
    if (hasIslands) {
      // `router:` slot — desugars to RouterCap install with the
      // factory's `__placeClientImport` metadata.
      const router = config.router as
        | undefined
        | (((...args: unknown[]) => unknown) & {
            __placeClientImport?: { module: string; name: string; capName: string }
          })
      if (router && router.__placeClientImport) {
        const meta = router.__placeClientImport
        clientCaps.push({
          module: meta.module,
          factoryName: meta.name,
          capName: meta.capName,
        })
      }
      // `caps:` array — each tuple is `[Cap, factory | { client, server }]`.
      // We only care about CLIENT factories (the cap itself is the same
      // value the user passed; we read `__placeClientImport` off the
      // factory function the user provided).
      for (const [, factoryOrPair] of config.caps ?? []) {
        const clientFactory =
          typeof factoryOrPair === 'function' ? factoryOrPair : factoryOrPair?.client
        const meta = (
          clientFactory as
            | undefined
            | { __placeClientImport?: { module: string; name: string; capName: string } }
        )?.__placeClientImport
        if (meta) {
          clientCaps.push({
            module: meta.module,
            factoryName: meta.name,
            capName: meta.capName,
          })
        }
      }
    }
    if (clientCaps.length > 0) {
      opts.clientCaps = clientCaps
    }
    return opts as ServeOptions
  }

  return {
    routes,
    async serve(): Promise<Bun.Server<unknown>> {
      if (typeof window !== 'undefined') {
        throw new Error(
          'app.serve() was called in a browser context. Call app.boot() from ' +
            'the client entry instead — .serve() starts Bun.serve and only runs server-side.',
        )
      }
      // Install server-side caps before booting. Each factory runs
      // ONCE here — the result is the process-wide baseline that
      // every request's capability scope inherits via ALS. This is
      // the right shape for read-only data (seeded stores, config,
      // logger handles) but NOT for per-request state — see the
      // `CapPerRuntime.server` doc for the discipline.
      installCapsFor('server')
      return serve(resolveServeOpts())
    },
    boot(): void {
      if (typeof window === 'undefined') {
        throw new Error(
          'app.boot() was called outside a browser context. Call app.serve() from ' +
            'the server entry instead — .boot() hydrates against the DOM and only runs client-side.',
        )
      }
      // Install client-side caps before boot. Disposers are
      // intentionally discarded — caps live for the page-session
      // lifetime.
      installCapsFor('client')
      const layout = config.layout
      const bootOpts = layout !== undefined ? { layout } : undefined
      boot(routes, bootOpts)
    },
    run(): Promise<Bun.Server<unknown>> | undefined {
      // `__PLACE_BROWSER__` is a build-time define set to `true` in the
      // client bundle (see Bun.build invocation in `serve()`). On the
      // server runtime the symbol is undefined; we treat that as the
      // "not browser" case. This split is what lets the bundler drop
      // `serve()` and its entire transitive closure on client builds —
      // a runtime `typeof window` check leaves both branches in the
      // bundle, a build-time literal doesn't.
      if (typeof __PLACE_BROWSER__ !== 'undefined' && __PLACE_BROWSER__) {
        // Browser runtime: install client caps, then hydrate.
        installCapsFor('client')
        const layout = config.layout
        const bootOpts = layout !== undefined ? { layout } : undefined
        boot(routes, bootOpts)
        return undefined
      }
      // Server runtime: install server caps, then start Bun.serve.
      installCapsFor('server')
      return serve(resolveServeOpts())
    },
    async build(buildOptions: { outDir: string }): Promise<void> {
      if (typeof window !== 'undefined') {
        throw new Error(
          'app.build() was called in a browser context. Run it from a ' +
            'server / build entry — it pre-renders the site and only runs server-side.',
        )
      }
      // Server caps install for the build the same way they do for a
      // live server — pages' load()s may read them during pre-render.
      installCapsFor('server')
      // `serve({ staticExport })` does the full setup then writes the
      // static site instead of binding a port; its return is the
      // cast-undefined sentinel — discarded here.
      await serve({ ...resolveServeOpts(), staticExport: { outDir: buildOptions.outDir } })
    },
  }
}

/**
 * Options for `routes(prefix, pages, opts)`. Currently only `layout` —
 * used to apply a shared layout to every page in the group when the
 * page didn't already declare one. Existing layouts on individual pages
 * are preserved.
 */
export interface RoutesOptions {
  /** Shared layout for every page in the group. Pages with their own
   *  explicit `layout` keep theirs (last-write-wins is the wrong default
   *  for nesting — the page's intent beats the group's). */
  layout?: AnyLayout
}

/**
 * Prefix a group of pages under a shared path prefix, optionally
 * applying a shared layout. Pure value transform — no registration, no
 * side effects, recursive composition allowed:
 *
 *   const post = page('/:id', { ... })
 *   routes('/posts', [post])
 *   // => [{ path: '/posts/:id', ... }]
 *
 *   routes('/admin', routes('/users', [list, detail]))
 *   // => [{ path: '/admin/users', ... }, { path: '/admin/users/:id', ... }]
 *
 * Prefix is validated: must start with `/`, and a trailing slash is
 * stripped to avoid double-slash bugs (`/admin/` + `/users` → `/admin/users`,
 * not `/admin//users`).
 */
export function routes(
  prefix: string,
  pages: readonly AnyPage[],
  opts: RoutesOptions = {},
): AnyPage[] {
  if (typeof prefix !== 'string' || !prefix.startsWith('/')) {
    throw new Error(`routes(): prefix must start with '/' (got '${prefix}')`)
  }
  // Trailing slash normalize: '/admin/' + '/users' → '/admin/users'.
  // Single '/' stays as-is (the only valid no-op prefix).
  const cleanPrefix = prefix === '/' ? '' : prefix.replace(/\/+$/, '')
  return pages.map((p) => {
    if (typeof p.path !== 'string') {
      throw new Error(
        'routes(): every page must have a path (declared via page(path, def)). ' +
          'Found a page with no path field.',
      )
    }
    // The index of a prefix: a page with path `/` inside a non-root
    // group represents the directory index. Use the prefix itself
    // (no trailing slash) — otherwise `routes('/recipes', [page('/')])`
    // would emit `/recipes/`, which doesn't match `/recipes` requests.
    const composed = p.path === '/' && cleanPrefix !== '' ? cleanPrefix : cleanPrefix + p.path
    // Preserve `layout` if the page already declares one; otherwise
    // adopt the group's layout. Spread preserves the PLACE_PAGE_BRAND.
    const inheritedLayout = p.layout === undefined ? opts.layout : p.layout
    return {
      ...p,
      path: composed,
      ...(inheritedLayout !== undefined ? { layout: inheritedLayout } : {}),
    } as AnyPage
  })
}
