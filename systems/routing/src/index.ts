// @place-ts/routing — minimal client-side routing on top of @place-ts/reactivity.
//
// Ships:
//   - Router          the contract (path / segments / query / navigate /
//                      replace / updateQuery / link / url / back / forward)
//   - Link            spreadable+callable nav value (href, onClick,
//                      aria-current, active, go) — see buildLink
//   - hashRouter      hash-based — works on any static host (no server config)
//   - pathRouter      History API — clean URLs, requires server fallback
//   - memoryRouter    no global side effects — for tests and SSR
//   - RouterCap       capability slot
//   - RouterHandle    the value all three return: Router & Provision &
//                      { dispose() } — pass straight to mount({ provide:[…] })
//   - parsePath       free utility for off-router parsing
//   - route(pattern)  typed paths — build, match, introspect; param shape
//                      inferred at compile time via TS template literals.
//                      No codegen, no plugin (cf. TanStack).
//   - searchParams    typed query-param schemas with inline parse fns.
//                      No Zod dependency.
//
// Deferred — only build when a concrete trigger emerges:
//   - Scroll restoration. Requires history.state coordination + per-route
//     scroll capture. Defer until concrete trigger.
//   - Nested route trees / route guards / lazy bundles. Compile-time
//     concerns; punt until the build system has shape.
//   - Route loaders. `@place-ts/reactivity`'s `resource()` already covers
//     async data — framework integration would just be glue.
//   - File-based routing. Build-tool concern, contradicts our minimal-
//     surface charter.
//
// Design notes:
//   - The router is just another capability. Tests use memoryRouter; apps
//     use hashRouter. No global singleton.
//   - `path()` is reactive. Any consumer that reads it inside a watch /
//     derived / reactive child re-runs on navigation.
//   - `navigate(p)` updates the reactive path SYNCHRONOUSLY so that
//     `navigate(p); router.path() === p` holds. The hashchange listener
//     still fires for external sources (browser back/forward, manual hash
//     edits); state.write dedupes the second write.

import { type Capability, defineCapability, type Provision } from '@place-ts/capability'
import { type Disposer, state, untrack } from '@place-ts/reactivity'

export interface Router {
  /** Reactive current path. For hash routing, the part after `#`. */
  path(): string
  /**
   * Reactive path segments — URL-decoded, leading/trailing slashes
   * stripped, query string excluded. `'/users/42'` → `['users', '42']`,
   * `'/'` → `[]`, `''` → `[]`.
   *
   * Cached via derived state: re-parses only when the path actually
   * changes, no matter how often callers read. Treat the returned array
   * as readonly — mutating it has no effect on the router.
   */
  segments(): readonly string[]
  /**
   * Reactive single-segment read. `segment(0)` on `/notes/42` returns
   * `'notes'`; on `/` it returns `null`. The common single-resource case.
   */
  segment(index: number): string | null
  /**
   * Reactive query parameters of the current path. Cached. The returned
   * `URLSearchParams` is a snapshot — mutating it does not update the
   * URL; use `navigate`/`replace` with a fresh path for that.
   */
  query(): URLSearchParams
  /**
   * Reactive single-param read. `param('tag')` returns the value of `?tag=…`
   * or `null` when absent. Use for the common one-key filter case;
   * reach for `query()` to enumerate.
   */
  param(key: string): string | null
  /**
   * Push a new path. Adds a history entry by default.
   *
   * Options:
   * - `replace: true` — replace instead of push (no history entry)
   * - `preserveQuery: true` — keep the current query string. If `path`
   *   already contains a `?`, that query takes precedence and merges
   *   with the preserved one (your keys win).
   *
   * The two options compose: `navigate('/foo', { replace: true,
   *   preserveQuery: true })` is the "swap path, keep filter, no
   *   history" form used by sidebar selection in the commonplace book.
   */
  navigate(path: string, options?: { replace?: boolean; preserveQuery?: boolean }): void
  /** Replace the current path. Does not add a history entry. */
  replace(path: string): void
  /**
   * Merge `changes` into the current query string and navigate. The path
   * is preserved. Pass `null` for a key to delete it; absent keys are
   * left alone (existing values pass through).
   *
   *   router.updateQuery({ tag: 'react' })       // set/overwrite tag
   *   router.updateQuery({ tag: null })          // clear tag, keep others
   *   router.updateQuery({}, { replace: true })  // no-op navigation
   *
   * The default is `navigate` (adds history); pass `replace: true` to
   * use `replace` instead — appropriate for filter UI where every click
   * shouldn't grow the back stack.
   */
  updateQuery(changes: Record<string, string | null>, options?: { replace?: boolean }): void
  /**
   * Build a `Link` for `to` — a reactive value that doubles as JSX props
   * (spread on any `<a>`), a programmatic navigator (`link.go()`), and an
   * active-state accessor (`link.active()`, plus an `aria-current` prop
   * that lets you style active links with pure CSS).
   *
   * Modifier-clicks (Cmd/Ctrl/Shift/Alt) and middle-clicks pass through to
   * the browser, so "open in new tab" works out of the box. The `href` is
   * already hash-prefixed for `hashRouter`, so right-click → copy link
   * gives a working URL.
   *
   * Active match: exact path equality, ignoring the query string. So a
   * `/notes` link is active on `/notes?tag=react` but not on `/notes/42`.
   */
  link(to: string, options?: { replace?: boolean; preserveQuery?: boolean }): Link
  /**
   * Build a shareable absolute URL for `to` (or for the current path if
   * `to` is omitted). For `hashRouter` the URL includes the `#` prefix;
   * for `pathRouter` it's the clean path. For `memoryRouter` (no real
   * URL) it returns the path as-is. Useful for "copy share link" UI.
   */
  url(to?: string): string
  /** Go back in history (delegates to history.back). */
  back(): void
  /** Go forward in history (delegates to history.forward). */
  forward(): void
}

/**
 * A reactive navigation value. Spread onto an `<a>` for JSX, call
 * `.go()` for programmatic navigation, read `.active()` to react to
 * whether the current route matches.
 */
export interface Link {
  /** href to use on `<a>` — hash-prefixed for hash routers. */
  readonly href: string
  /**
   * Click handler. Skips on modifier keys (Cmd/Ctrl/Shift/Alt) and
   * middle/right-clicks so the browser keeps native "open in new tab"
   * behavior. Plain left-clicks call `preventDefault` + `go()`.
   */
  readonly onClick: (event: MouseEvent) => void
  /**
   * Reactive `aria-current` — `'page'` when this link points at the
   * current route, `undefined` otherwise. Style active links with pure
   * CSS: `a[aria-current="page"] { … }`.
   */
  readonly 'aria-current': () => 'page' | undefined
  /** Reactive active flag — `true` when the link points at the current route. */
  readonly active: () => boolean
  /** Navigate to the link's target. Same as clicking the link. */
  go(): void
}

export interface ParsedPath {
  readonly segments: readonly string[]
  readonly query: URLSearchParams
}

/**
 * Parse a path string into segments and query params. URL-decodes each
 * segment; preserves the original on a malformed escape rather than
 * throwing.
 *
 * Free function — works on any path, not tied to a router. Useful for
 * tests, comparing arbitrary paths, or any logic that needs to inspect
 * a path that isn't the current one.
 */
export function parsePath(path: string): ParsedPath {
  const qIdx = path.indexOf('?')
  const pathPart = qIdx >= 0 ? path.slice(0, qIdx) : path
  const queryPart = qIdx >= 0 ? path.slice(qIdx + 1) : ''
  const segments = pathPart
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      try {
        return decodeURIComponent(seg)
      } catch {
        return seg
      }
    })
  return { segments, query: new URLSearchParams(queryPart) }
}

// ===== Typed routes =====
//
// `route('/users/:id/posts/:postId')` returns a value that's:
//   - callable: build a path from typed params → string
//   - matchable: extract typed params from a path or null
//   - introspectable: read its `pattern` for debugging
//
// Param shape is inferred at compile time from the pattern string via
// TS template-literal types. No codegen, no plugin, no CLI — just `tsc`.
//
//   const r = route('/users/:id')
//   r({ id: 'abc' })            // '/users/abc'
//   r({ wrong: 'x' })           // ❌ TS error
//   r.match('/users/abc')       // { id: 'abc' }
//   r.match('/other')           // null
//
// Routes return strings, so they compose with the existing API:
//   router.navigate(r({ id: 'abc' }))
//   router.link(r({ id: 'abc' }))
// No new method overloads, no new component.

// Extract the union of param names from a pattern like '/a/:x/b/:y' → 'x' | 'y'.
// Recurses left-to-right via template-literal split-on-`:`.
export type ExtractParamNames<S extends string> = S extends `${string}:${infer P}/${infer Rest}`
  ? P | ExtractParamNames<`/${Rest}`>
  : S extends `${string}:${infer P}`
    ? P
    : never

// Map the union of names to a `Record<name, string>` (or `{}` for no params).
//
// Exported because `page(path, def)` in @place-ts/component reuses it to
// infer URL params from path strings — single source of truth.
export type ParamsOf<S extends string> = [ExtractParamNames<S>] extends [never]
  ? Record<string, never>
  : Record<ExtractParamNames<S>, string>

/**
 * A typed route value. Build paths via `route(params)`, extract params
 * via `route.match(path)`. The `pattern` is exposed for debugging.
 */
export interface Route<P extends Record<string, string>> {
  (params: P): string
  readonly pattern: string
  match(path: string): P | null
}

export function route<S extends string>(pattern: S): Route<ParamsOf<S>> {
  const segs = pattern.split('/').filter(Boolean)

  const build = (params: Record<string, string>): string => {
    const out = segs.map((seg) => {
      if (seg.startsWith(':')) {
        const key = seg.slice(1)
        const value = params[key]
        // Empty / missing params used to silently produce a malformed
        // URL (`route('/users/:id')({})` → `/users/`) that hits the
        // pattern's own match path matched a different route entirely.
        // Fail loud at the call site so missing wiring is impossible
        // to miss in development.
        if (value === undefined || value === null || value === '') {
          throw new Error(
            `route: missing required param '${key}' for pattern ${JSON.stringify(pattern)}`,
          )
        }
        return encodeURIComponent(value)
      }
      return seg
    })
    return `/${out.join('/')}`
  }

  const matchPath = (path: string): Record<string, string> | null => {
    const q = path.indexOf('?')
    // Reject pathologic inputs (`//`, `/foo//bar`) up-front. Filter(
    // Boolean) used to silently drop empty segments and match a
    // pattern with fewer slashes — a malformed URL would resolve to
    // a legitimate route with the wrong params.
    const raw = q >= 0 ? path.slice(0, q) : path
    if (raw.includes('//')) return null
    const pathSegs = raw.split('/').filter(Boolean)
    if (pathSegs.length !== segs.length) return null
    const result: Record<string, string> = {}
    for (let i = 0; i < segs.length; i++) {
      const pat = segs[i] as string
      const got = pathSegs[i] as string
      if (pat.startsWith(':')) {
        try {
          result[pat.slice(1)] = decodeURIComponent(got)
        } catch {
          result[pat.slice(1)] = got
        }
      } else if (pat !== got) {
        return null
      }
    }
    return result
  }

  // Make `build` callable AND attach pattern + match. They're enumerable
  // here (unlike Link's hidden methods) because nobody spreads a route
  // onto a DOM element — routes are values you call or match against.
  // Cast through `unknown` because TS can't narrow a function with
  // dynamically-added properties.
  const fn = Object.assign(build, { pattern, match: matchPath })
  return fn as unknown as Route<ParamsOf<S>>
}

// ===== Typed search params =====
//
// Inline-parse-function schema: each key gets a function that turns the
// raw query value (`string | null`) into the typed result. The return
// type is inferred — no codec abstraction, no Zod dependency.
//
//   const filters = searchParams({
//     tag:  (raw) => raw ?? null,
//     page: (raw) => raw ? Number(raw) : 1,
//     sort: (raw) => raw === 'desc' ? 'desc' : 'asc',
//   })
//
//   const { tag, page, sort } = filters.read(router)
//   // tag: string | null, page: number, sort: 'asc' | 'desc'
//
//   filters.update(router, { tag: 'react' })   // typed
//   filters.update(router, { tag: null })      // remove (null → delete)
//   filters.update(router, { typo: 'x' })      // ❌ TS error
//
// On update: `null`/`undefined` deletes the key; everything else is
// `String()`-coerced before going through `router.updateQuery`.

export interface SearchParamsSchema {
  readonly [key: string]: (raw: string | null) => unknown
}

export interface SearchParams<S extends SearchParamsSchema> {
  /** Reactive read of all params under this schema. Re-runs on path change. */
  read(router: Router): { [K in keyof S]: ReturnType<S[K]> }
  /**
   * Set or delete params. `null`/`undefined` deletes the key; everything
   * else is `String()`-coerced. Pass `{ replace: true }` to avoid
   * growing the back stack (filter UI etc).
   */
  update(
    router: Router,
    changes: Partial<{ [K in keyof S]: ReturnType<S[K]> | null }>,
    options?: { replace?: boolean },
  ): void
}

export function searchParams<S extends SearchParamsSchema>(schema: S): SearchParams<S> {
  return {
    read(router) {
      const out: Record<string, unknown> = {}
      for (const key in schema) {
        out[key] = schema[key]?.(router.param(key))
      }
      return out as { [K in keyof S]: ReturnType<S[K]> }
    },
    update(router, changes, options) {
      const queryChanges: Record<string, string | null> = {}
      for (const [key, value] of Object.entries(changes)) {
        queryChanges[key] = value === null || value === undefined ? null : String(value)
      }
      router.updateQuery(queryChanges, options)
    },
  }
}

// Universal capability — installed on the SERVER by `renderPage()` with
// a read-only impl built from the current request URL (path/segments/
// query/param work; navigation methods throw because there's no history
// to mutate). On the CLIENT, `app({ caps: [[RouterCap, pathRouter]] })`
// installs the full client-side router that drives `window.history`.
//
// Why universal: components reading `RouterCap.use()` no longer skip SSR
// via `ClientOnlyAbort`. `<Link>` can mark itself active during SSR
// because the current path is known. Sidebar nav, header nav, breadcrumbs
// — all of these get their active state from the first paint without
// waiting for hydration to re-walk the DOM and stamp classes. Smooth
// hard refresh.
export const RouterCap = defineCapability<Router>('Router')

/**
 * Read the current Router from the active capability scope.
 *
 * The polished public-facing reader, parallel to `useTheme()`. Returns
 * the installed `Router` so islands / page bodies / layouts can read
 * the path, query, and call navigate / replace without reaching
 * directly into `RouterCap.tryUse()`.
 *
 * Where the cap gets installed:
 *   - SSR: `renderPage` installs a server-side router from the request
 *     URL. Reads (path, segments, query, param) work; navigate /
 *     replace throw with a helpful "use a redirect() instead" message.
 *   - Client: `app({ router: pathRouter | hashRouter })` installs the
 *     active client router at boot. All methods work.
 *   - Tests: install your own via `RouterCap.provide(memoryRouter(), …)`.
 *
 * If no Router is installed, this throws with an actionable message
 * pointing at the most common fix (configure `router:` on `app({...})`).
 * Use `RouterCap.tryUse()` directly if you want the nullable form for
 * a code path that may legitimately run without a router.
 *
 * ```ts
 * const Counter = island(() => {
 *   const router = useRouter()
 *   return (
 *     <button onClick={() => router.navigate('/other')}>
 *       Currently on {router.path()} — go elsewhere
 *     </button>
 *   )
 * })
 * ```
 */
export function useRouter(): Router {
  const r = RouterCap.tryUse()
  if (r === null) {
    throw new Error(
      "useRouter(): no Router is installed in this scope. Configure one via " +
        "app({ router: pathRouter }) (or hashRouter), or wrap the calling code in " +
        "RouterCap.provide(router, () => …). Use RouterCap.tryUse() directly if " +
        "you want a nullable fallback for a code path that may run without a router.",
    )
  }
  return r
}

function readHash(): string {
  const hash = globalThis.location?.hash ?? ''
  return hash.startsWith('#') ? hash.slice(1) : hash
}

// Read pathname + search for the History API router. Defaults to '/'
// when there's no `location` (SSR / non-browser).
function readPath(): string {
  const loc = globalThis.location
  if (!loc) return '/'
  return (loc.pathname || '/') + (loc.search || '')
}

// Compose origin + a path-fragment into an absolute URL. Falls back to
// the path itself when no `location` exists (SSR, tests without a host).
function absoluteUrl(pathFragment: string): string {
  const origin = globalThis.location?.origin
  return origin ? origin + pathFragment : pathFragment
}

// Build the new path string for `updateQuery`: keep the path part of
// `current` intact, merge `changes` into the query (null deletes).
// Shared between hashRouter and memoryRouter — operating on the path
// string directly avoids re-encoding the path segments.
function applyQueryChanges(current: string, changes: Record<string, string | null>): string {
  const qIdx = current.indexOf('?')
  const pathPart = qIdx >= 0 ? current.slice(0, qIdx) : current
  const queryPart = qIdx >= 0 ? current.slice(qIdx + 1) : ''
  const params = new URLSearchParams(queryPart)
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }
  const q = params.toString()
  return q ? `${pathPart}?${q}` : pathPart
}

// Resolve the path to navigate to given preserveQuery semantics: keep
// the current query, let the new path's query override per-key, and
// prefer the new path's value when both supply the same key.
function withPreservedQuery(currentPath: string, newPath: string): string {
  const curQ = currentPath.indexOf('?')
  if (curQ < 0) return newPath
  const currentQuery = currentPath.slice(curQ + 1)
  const newQ = newPath.indexOf('?')
  const newPathPart = newQ >= 0 ? newPath.slice(0, newQ) : newPath
  const newQuery = newQ >= 0 ? newPath.slice(newQ + 1) : ''
  const merged = new URLSearchParams(currentQuery)
  if (newQuery) {
    for (const [k, v] of new URLSearchParams(newQuery)) merged.set(k, v)
  }
  const q = merged.toString()
  return q ? `${newPathPart}?${q}` : newPathPart
}

function stripHash(p: string): string {
  return p.startsWith('#') ? p.slice(1) : p
}

// Path part of `p`, stripping the query — used for active-state matching
// where `?tag=foo` should not change identity.
function pathOnly(p: string): string {
  const q = p.indexOf('?')
  return q < 0 ? p : p.slice(0, q)
}

function buildLink(
  to: string,
  href: string,
  router: Router,
  options: { replace?: boolean; preserveQuery?: boolean } | undefined,
): Link {
  const replace = options?.replace === true
  const preserveQuery = options?.preserveQuery === true
  const go = (): void => {
    if (replace) router.replace(to)
    else if (preserveQuery) router.navigate(to, { preserveQuery: true })
    else router.navigate(to)
  }
  const active = (): boolean => pathOnly(router.path()) === pathOnly(to)
  // Only `href`, `onClick`, and `aria-current` are enumerable. `<a {...link}>`
  // spreads via Object.assign-style enumeration, so anything we DON'T want
  // landing on the DOM (e.g. `go` would be invoked as a reactive prop and
  // *navigate during mount* — see hard-refresh bug) must be hidden here.
  // Direct access (`link.go()`, `link.active()`) still works because the
  // properties exist; they're just not enumerable.
  const link = {
    href,
    onClick: (event: MouseEvent) => {
      // Defer to the browser for modifier-clicks (open in new tab/window)
      // and non-left mouse buttons (middle-click new tab, right-click menu).
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      if (event.button !== 0) return
      event.preventDefault()
      go()
    },
    'aria-current': () => (active() ? 'page' : undefined),
  } as Link
  Object.defineProperty(link, 'active', { value: active, enumerable: false })
  Object.defineProperty(link, 'go', { value: go, enumerable: false })
  return link
}

/**
 * The single value an app gets back from `hashRouter()` or
 * `memoryRouter()` — does triple duty:
 *
 *   1. It's a `Router` — call `.segment(0)`, `.navigate('/x')`, etc.
 *   2. It satisfies `Provision` — pass it straight to
 *      `mount(view, '#app', { provide: [router] })`. No need for
 *      an explicit `provide(RouterCap, router)` wrap.
 *   3. It has `.dispose()` — apps ignore it; tests call it for cleanup.
 *
 * The `capability`/`impl`/`dispose` properties are non-enumerable so
 * `<a {...router}>` (don't do this, but if you did) wouldn't pollute
 * the DOM with router methods.
 */
export interface RouterHandle extends Router, Provision {
  /** @internal — exposes RouterCap for `provide` lists. Don't read directly. */
  readonly capability: Capability<Router>
  /** @internal — the router itself, surfaced for `Provision`. */
  readonly impl: Router
  /** Dispose any global listeners. Apps keep the router alive; tests dispose. */
  dispose(): void
}

// Normalize the empty / hash-only forms to '/' so `path() === '/'` is
// the reliable home-page check. Without this, `''` (no hash) and `'/'`
// (explicit root) would diverge at the API surface even though they
// produce identical parsed segments.
function normalizePath(p: string): string {
  return p === '' || p === '#' ? '/' : p
}

// Per-mode hooks for navigate/replace — `path` is the reactive state the
// router exposes via `path()`, `segments()`, etc. The hooks can read it
// and side-effect on it (and the URL bar in hash / history mode).
interface RouterMode {
  hrefForLink: (to: string) => string
  pushPath: (path: ReturnType<typeof state<string>>, target: string) => void
  replacePath: (path: ReturnType<typeof state<string>>, target: string) => void
  /** Build a shareable absolute URL for `to`. Used by `router.url()`. */
  urlFor: (to: string) => string
  back: () => void
  forward: () => void
}

// Shared Router-method-bag construction — both modes share the same
// dispatch shape so the contract can't drift. Returns the router AND
// its underlying path state so the wiring code can hook listeners
// without touching internals via cast.
function buildRouter(
  initial: string,
  mode: RouterMode,
): { router: Router; path: ReturnType<typeof state<string>> } {
  const path = state(normalizePath(initial))
  // Derived parse — recomputes only when `path` actually changes.
  // Multiple readers of segments()/query() share the same cached parse.
  const parsed = state<ParsedPath>(() => parsePath(path.read()))

  // Per-key derived states for `segment(i)` and `param(key)`. Why:
  // raw `parsed.read().segments[i]` would subscribe consumers to ALL
  // path changes (since every path change creates a new `parsed`
  // result). A consumer that cares only about segment(0) shouldn't
  // re-fire when segment(1) changes — and definitely shouldn't re-fire
  // when only the query string changes. Each per-key derived state
  // dedupes via Object.is on its own value, so the consumer only sees
  // a real change. Caches are unbounded but indexed by primitive keys
  // (a number for segments, a string for params) so footprint scales
  // with how many distinct keys an app actually reads, not with how
  // many times it reads them.
  const segmentCache = new Map<number, ReturnType<typeof state<string | null>>>()
  const segmentAt = (i: number) => {
    let s = segmentCache.get(i)
    if (s === undefined) {
      s = state<string | null>(() => parsed.read().segments[i] ?? null)
      // Pre-compute outside any caller's watch context. Without this,
      // the first .read() inside a watch transitions the derived state
      // from "no value" → "value", which propagates a change and
      // re-fires the calling watch. Pre-computing under `untrack` makes
      // the state CLEAN before any caller can subscribe, so the first
      // subscribed read sees a settled value with no propagation.
      untrack(() => s?.read())
      segmentCache.set(i, s)
    }
    return s
  }
  const paramCache = new Map<string, ReturnType<typeof state<string | null>>>()
  const paramAt = (k: string) => {
    let s = paramCache.get(k)
    if (s === undefined) {
      s = state<string | null>(() => parsed.read().query.get(k))
      untrack(() => s?.read())
      paramCache.set(k, s)
    }
    return s
  }

  const router: Router = {
    path: () => path.read(),
    segments: () => parsed.read().segments,
    segment: (i) => segmentAt(i).read(),
    // Defensive clone: the cached URLSearchParams is shared by the
    // derived state across reads, so we can't hand it out raw — a caller
    // mutating it would leak to other readers.
    query: () => new URLSearchParams(parsed.read().query),
    param: (k) => paramAt(k).read(),
    updateQuery(changes, options) {
      const next = applyQueryChanges(path.read(), changes)
      if (options?.replace) router.replace(next)
      else router.navigate(next)
    },
    link(to, options) {
      return buildLink(to, mode.hrefForLink(to), router, options)
    },
    url(to) {
      return mode.urlFor(to ?? path.read())
    },
    navigate(p, options) {
      const raw = options?.preserveQuery ? withPreservedQuery(path.read(), p) : p
      const target = normalizePath(raw)
      if (options?.replace) {
        router.replace(target)
        return
      }
      mode.pushPath(path, target)
    },
    replace(p) {
      mode.replacePath(path, normalizePath(p))
    },
    back: mode.back,
    forward: mode.forward,
  }
  return { router, path }
}

// Decorate a plain Router with the non-enumerable Provision shape +
// `dispose`. The result satisfies `RouterHandle`: same value can be
// .navigate'd, spread into `provide:[]`, or `.dispose()`d.
function attachHandle(router: Router, dispose: () => void): RouterHandle {
  Object.defineProperty(router, 'capability', { value: RouterCap, enumerable: false })
  Object.defineProperty(router, 'impl', { value: router, enumerable: false })
  Object.defineProperty(router, 'dispose', { value: dispose, enumerable: false })
  return router as RouterHandle
}

/**
 * Hash-based router. Subscribes to `hashchange` so browser back/forward
 * stays in sync with the reactive path.
 *
 * **When to use**: any-static-host deployments (S3, GitHub Pages,
 * `file://`). No server-side fallback configuration required — the
 * server only ever sees the path before `#`. Reach for `pathRouter()`
 * when you control the server and want clean URLs.
 *
 * The returned `RouterHandle` is itself a `Provision` for `RouterCap`,
 * so the app boot collapses to:
 *
 *   const router = hashRouter()
 *   mount(view, '#app', { provide: [router] })
 */
export function hashRouter(): RouterHandle {
  const { router, path } = buildRouter(readHash(), {
    hrefForLink: (to) => `#${to}`,
    urlFor: (to) => absoluteUrl(`${globalThis.location?.pathname ?? '/'}#${to}`),
    pushPath: (path, target) => {
      // Setting location.hash fires hashchange (often async). Update the
      // reactive state synchronously so callers see the new value
      // immediately; the listener may double-fire later — state.write
      // dedupes equal values.
      if (globalThis.location) globalThis.location.hash = target
      path.write(normalizePath(stripHash(target)))
    },
    replacePath: (path, p) => {
      // history.replaceState does NOT fire hashchange, so the manual
      // path.write below is required.
      if (globalThis.location && globalThis.history) {
        const url = new URL(globalThis.location.href)
        url.hash = p
        globalThis.history.replaceState(null, '', url.toString())
      }
      path.write(normalizePath(stripHash(p)))
    },
    back: () => globalThis.history?.back(),
    forward: () => globalThis.history?.forward(),
  })
  const onChange: Disposer = (): void => path.write(normalizePath(readHash()))
  globalThis.addEventListener?.('hashchange', onChange)
  return attachHandle(router, () => globalThis.removeEventListener?.('hashchange', onChange))
}
;(hashRouter as unknown as { __placeClientImport?: ClientCapImport }).__placeClientImport = {
  module: '@place-ts/routing',
  name: 'hashRouter',
  capName: 'RouterCap',
}

/**
 * History API router with clean URLs (`/about`, not `/#/about`).
 * Subscribes to `popstate` for browser back/forward.
 *
 * **Deployment requirement**: the server must serve `index.html` for
 * any route that the SPA owns (otherwise `/about` 404s on hard refresh).
 * Vite handles this in dev automatically. For production, configure
 * your host (Netlify/Vercel rewrites, nginx `try_files`, etc.).
 *
 * The link `href` is the bare path so right-click "copy URL" gives the
 * correct address. Cmd+click opens it in a new tab and the server
 * round-trips through the SPA shell.
 */
/**
 * **Metadata convention** (T5-D phase 2 auto cap-install): the marker
 * `__placeClientImport` lets the framework's island bundler emit a
 * correct `import` statement when generating client-side cap install
 * code. Without this, the bundler can't reconstruct how to re-import a
 * function the user passed by value to `app({ router: ... })`.
 *
 * The shape: `{ module, name, capName }`. The bundler emits
 * `import { ${name}, ${capName} } from "${module}"` plus
 * `${capName}.install(${name}())`. Both module name and exported
 * symbol are framework-controlled (you can't pass an arbitrary
 * factory and expect auto-install to work — `placeClientImport` is
 * the opt-in contract).
 */
export interface ClientCapImport {
  readonly module: string
  readonly name: string
  readonly capName: string
}

export function pathRouter(): RouterHandle {
  // Detect whether the framework's inline SPA-nav runtime is active.
  // When it is, programmatic `router.navigate('/x')` must trigger a
  // *content* fetch + `<main>` swap — the same path a `<Link>` click
  // takes. The previous design only did `history.pushState` + signal
  // write, which updated the URL bar and the reactive `path()` cell
  // but left the page's DOM showing the old route's content. The
  // visible-but-wrong-content bug surfaced first when the search
  // palette called `router.navigate(entry.to)`: the URL flipped to
  // `/api/state` while the user kept staring at the landing page.
  //
  // The SPA-nav runtime (see `systems/component/src/__spa_nav.ts`)
  // listens for a `place:navigate` CustomEvent and runs its
  // fetch-shell-then-swap pipeline against the detail.url. When the
  // runtime is present, we delegate. When it isn't (apps with no
  // islands → no SPA runtime), we fall back to the legacy pushState
  // + signal write, which is correct for static apps where every
  // route is a fresh document load anyway.
  const spaNavActive = (): boolean =>
    typeof window !== 'undefined' && (window as Window & { __place_spa?: number }).__place_spa === 1
  const { router, path } = buildRouter(readPath(), {
    hrefForLink: (to) => to,
    urlFor: (to) => absoluteUrl(to),
    pushPath: (path, target) => {
      // Update the reactive `path` SYNCHRONOUSLY in BOTH branches so
      // the documented `navigate(p); router.path() === p` invariant
      // (see header comment) holds during the SPA fetch+swap window.
      // Without this, every consumer of `path()` (sidebar active-
      // link, breadcrumbs, `<Link>` active-state) sees the OLD path
      // for the duration of the SPA roundtrip — a visible flicker on
      // every nav.
      //
      // Safety: the SPA runtime owns pushState + fetch + swap. On
      // success it later dispatches `place:nav`; the listener below
      // writes the same path (state.write dedupes — no second fire).
      // On failure the runtime calls `location.href = url` (hard
      // reload) — the optimistic state is wiped with the page; no
      // lasting desync.
      path.write(normalizePath(target))
      if (spaNavActive()) {
        globalThis.dispatchEvent?.(
          new CustomEvent('place:navigate', { detail: { url: target, replace: false } }),
        )
        return
      }
      // No SPA runtime → static-app fallback. The signal write
      // already landed above; just commit the URL change.
      globalThis.history?.pushState(null, '', target)
    },
    replacePath: (path, p) => {
      path.write(normalizePath(p))
      if (spaNavActive()) {
        globalThis.dispatchEvent?.(
          new CustomEvent('place:navigate', { detail: { url: p, replace: true } }),
        )
        return
      }
      globalThis.history?.replaceState(null, '', p)
    },
    back: () => globalThis.history?.back(),
    forward: () => globalThis.history?.forward(),
  })
  const onPopState: Disposer = (): void => path.write(normalizePath(readPath()))
  globalThis.addEventListener?.('popstate', onPopState)
  // T5-D phase 2: the islands SPA runtime (PLACE_SPA_NAV) dispatches
  // `place:nav` after fetching + swapping content via pushState. We
  // listen for it so RouterCap.path() updates without a real popstate
  // fire (which would otherwise require us to dispatch a synthetic
  // PopStateEvent — fragile because our own click handler would catch
  // it too). The listener just re-reads location, so subscribed
  // islands see the new path immediately.
  const onPlaceNav: Disposer = (): void => path.write(normalizePath(readPath()))
  globalThis.addEventListener?.('place:nav', onPlaceNav as EventListener)
  return attachHandle(router, () => {
    globalThis.removeEventListener?.('popstate', onPopState)
    globalThis.removeEventListener?.('place:nav', onPlaceNav as EventListener)
  })
}
// Tag the factory so the islands bundler can auto-install RouterCap
// on the client without the user writing an `_init.ts` side-effect
// module per app. See `ClientCapImport` above.
;(pathRouter as unknown as { __placeClientImport?: ClientCapImport }).__placeClientImport = {
  module: '@place-ts/routing',
  name: 'pathRouter',
  capName: 'RouterCap',
}

/**
 * In-memory router. No global side effects — safe for tests, SSR, or
 * any environment without `window`.
 *
 * `back` / `forward` are no-ops in v0.1; add a history simulation when a
 * test actually needs it, not before. `dispose()` is a no-op (no
 * listeners to clean up) — provided for parity with `hashRouter()`.
 */
export function memoryRouter(initial = '/'): RouterHandle {
  const { router } = buildRouter(initial, {
    hrefForLink: (to) => to,
    urlFor: (to) => to,
    pushPath: (path, target) => path.write(target),
    replacePath: (path, p) => path.write(p),
    back: () => {},
    forward: () => {},
  })
  return attachHandle(router, () => {})
}

/**
 * Build a read-only Router from a `Request`. Used by the SSR render
 * path to install `RouterCap` with a server-side impl, so components
 * reading `RouterCap.use().path()` work on both runtimes.
 *
 * `path()` / `segments()` / `segment()` / `query()` / `param()` / `link()`
 * / `url()` all work. Navigation methods (`navigate`, `replace`,
 * `updateQuery`, `back`, `forward`) throw — the server has no history
 * to mutate, and any code that tries to call them on SSR is a bug.
 *
 * Internal: not exported. Used by `@place-ts/component`'s `renderPage`.
 */
export function serverRouter(req: Request): Router {
  const url = new URL(req.url)
  const initial = url.pathname + url.search
  const { router } = buildRouter(initial, {
    hrefForLink: (to) => to,
    urlFor: (to) => to,
    pushPath: () => {
      throw new Error(
        'router.navigate() / .replace() / .updateQuery() / .back() / .forward() — ' +
          'navigation is not available during SSR. These methods can only be ' +
          'called from client-side event handlers (which never run on the server).',
      )
    },
    replacePath: () => {
      throw new Error('router.replace() is not available during SSR.')
    },
    back: () => {
      throw new Error('router.back() is not available during SSR.')
    },
    forward: () => {
      throw new Error('router.forward() is not available during SSR.')
    },
  })
  return router
}
