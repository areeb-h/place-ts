// @place/component — the islands primitive.
//
// Extracted from index.ts (Tier 20 decomposition, cut 6) — the
// island() author API + the per-app island registry + bundle-URL
// bookkeeping + the <Island> SSR element. ADR 0019 (typed islands,
// not string directives).
//
// `index.ts` re-exports the public surface (`island`, `Island`) and
// the `_`-prefixed registry hooks the build pipeline + serve() need.
// This module touches `index.ts`-resident symbols only inside runtime
// functions, so the islands ⇄ index cycle stays benign — same shape
// as element.ts / mount.ts / ssr.ts.

import { ClientOnlyAbort } from '@place/capability'
import type { SsrHeading } from './element.ts'
// `isBrowserGlobalRef` still lives in index.ts; touched only inside
// runtime functions, so the islands ⇄ index cycle stays benign.
import { isBrowserGlobalRef } from './index.ts'
import type { View } from './types.ts'
import { escapeHtmlAttrFull } from './utils/escape.ts'

// Island-name validation. Inlined in this module (not its own
// `./island-validation.ts`) so Bun's chunk-splitter doesn't hoist
// this small utility into its own ~1.4 KB shared chunk — the bytes
// bundle into the framework runtime chunk instead, dropping the
// leaf-fetch count by one. The bundler (`island-bundler.ts`) keeps
// its own copy server-side.
function validateIslandName(name: string): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`island: name must be a non-empty string (got ${typeof name})`)
  }
  if (name.length > 64) {
    throw new Error(`island: name exceeds 64 chars (got ${name.length})`)
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `island: name '${name}' contains invalid characters. Use only ` +
        `letters, digits, '_', '-'.`,
    )
  }
  if (name === '__proto__' || name === 'constructor' || name === 'prototype') {
    throw new Error(`island: name '${name}' is reserved.`)
  }
}

// ===== T5-C — Islands primitive (ADR 0019) =====
//
// Per-island opt-in to client interactivity. Pages without an
// `<Island>` element ship ZERO `<script>` tags. Pages with islands
// emit one `<script type="module" src="/islands/<name>.js">` per used
// island, deduped automatically. Each island's bundle auto-mounts to
// its `data-place-island="<name>"` marker(s) in the DOM.
//
// Why typed (not string-directive): ADR 0003 explicitly rejected
// `'use client'` / `'use server'` magic strings. `<Island name="x">`
// is a normal JSX element — typed, statically resolvable, no compiler
// magic. ADR 0019 records the directive-vs-typed-marker distinction.

/**
 * Context passed to an island's `ssrProps` resolver. The framework
 * builds this once per request after the page body has been rendered
 * to HTML, and shares the same object across every resolver in the
 * pass (resolvers see each other's body mutations).
 */
export interface IslandSsrContext {
  /** Current rendered body HTML. If the resolver returns a new
   *  `body`, subsequent resolvers see the updated value. */
  readonly body: string
  /**
   * Every `<h2>` / `<h3>` element rendered inside `<main>` during
   * this request, in document order. Each entry carries the id that
   * the framework auto-injected onto the element (so `<a
   * href="#id">` resolves without per-page authoring). This is the
   * primary input for table-of-contents islands; no HTML scanning
   * or regex parsing required.
   */
  readonly headings: ReadonlyArray<SsrHeading>
  /** The incoming request. */
  readonly req: Request
  /** Parsed request URL (cached so resolvers don't reparse). */
  readonly url: URL
}

/**
 * Shape an island's `ssrProps` resolver returns. Both fields are
 * optional; the framework ignores `null` / `undefined` / empty
 * returns and uses defaults.
 */
export interface IslandSsrResult<P> {
  /** Props to re-render the island with. Merged into the SSR'd
   *  `data-view-props` so client hydration agrees with SSR. */
  readonly props?: Partial<P>
  /** Replacement body HTML. Use when the island's resolver also needs
   *  to mutate the rendered page (e.g. a table-of-contents resolver
   *  that injects `id="…"` attrs onto h2/h3 while extracting the
   *  heading list). Subsequent resolvers + the document wrapper see
   *  this value. */
  readonly body?: string
}

/**
 * Resolver that computes an island's initial SSR props (and
 * optionally mutates the rendered body) from the page body. Declared
 * on the island itself via `island(fn, { ssrProps })`. The framework
 * invokes every registered resolver after the page body is rendered
 * and before the document is wrapped — apps don't have to wire
 * anything in `app.ts` for this to work.
 *
 * Sync only. If your resolver needs async I/O, run it in `load()` on
 * a page or layout and pass the data through props the normal way.
 */
export type IslandSsrPropsResolver<P extends Record<string, unknown>> = (
  ctx: IslandSsrContext,
) => IslandSsrResult<P> | null | undefined

/**
 * Island registry entry. `component` is used to SSR the island; `src`
 * is the source file the framework bundles per-island; `ssrProps` is
 * an optional resolver that runs once per request after the body has
 * been rendered (see `IslandSsrPropsResolver` for the contract).
 */
export interface IslandRegistration {
  /** Server-side component used to render the island's initial HTML. */
  readonly component: (...args: never[]) => View
  /**
   * Source-file path of the island's module. Resolved against the
   * project root (relative paths are OK).
   */
  readonly src: string
  /**
   * Optional SSR-time prop resolver. The framework calls this with
   * the rendered body string after every page render; the resolver's
   * return value is merged into the island's marker via
   * `rerenderIsland`. See `IslandSsrPropsResolver`.
   */
  readonly ssrProps?: IslandSsrPropsResolver<Record<string, unknown>>
}

/**
 * Per-render tracker. Map from island name → set of `client`
 * strategies used by every instance of that island on the current
 * page. The set-of-strategies (not just a name) is the input
 * `renderPage` uses to decide HOW to emit the bundle:
 *
 *  - If any instance uses `'load'` / `'idle'` / `'visible'`, the
 *    bundle is emitted as a normal `<script type="module">` — the
 *    JS runs at first paint or shortly after, and the wrapper's
 *    auto-mount handles the strategy.
 *  - If EVERY instance uses `'interaction'`, the bundle gets the
 *    *deferred-fetch* treatment: a `<link rel="modulepreload">`
 *    hint goes into `<head>` (browser fetches at idle, doesn't
 *    execute) and the inline `placeDeferredIslands` runtime
 *    promotes it to a `<script type="module">` on first hover /
 *    focus / click of any matching marker. Browser hits the
 *    preload cache so first interaction is effectively instant.
 *
 * The strategy-vs-name distinction matters because two different
 * pages can use the same island under different strategies, and
 * even one page can use one island multiple times with different
 * client= values. The per-page strategy set covers that case
 * cleanly: the bundle gets eager fetch iff ANY instance needs it
 * eagerly.
 */
let currentIslandSet: Map<string, Set<ClientStrategy>> | null = null

/** Internal: start a fresh island-collection scope. Returns the map. */
export function _beginIslandCollection(): Map<string, Set<ClientStrategy>> {
  const map = new Map<string, Set<ClientStrategy>>()
  currentIslandSet = map
  return map
}

/** Internal: end the island-collection scope. */
export function _endIslandCollection(): void {
  currentIslandSet = null
}

/** Internal: record an island instance's strategy. Idempotent per
 *  (name, strategy) pair — calling twice with the same args is a
 *  no-op, so the multi-instance case works. */
function _addIslandWithStrategy(name: string, strategy: ClientStrategy): void {
  if (!currentIslandSet) return
  const existing = currentIslandSet.get(name)
  if (existing) {
    existing.add(strategy)
  } else {
    currentIslandSet.set(name, new Set([strategy]))
  }
}

/** Per-app registry — populated from `ServeOptions.islands`. */
let _islandRegistry: Readonly<Record<string, IslandRegistration>> = {}

/** Per-app bundle URL map — populated by `serve()` after building islands. */
let _islandBundleUrls: Readonly<Record<string, string>> = {}

/** Internal: set the registry. Called by `serve()` at startup. */
export function _setIslandRegistry(
  registry: Readonly<Record<string, IslandRegistration>> | undefined,
): void {
  _islandRegistry = registry ?? {}
}

/** Internal: read the registry. Used by `rerenderIsland` to look up
 *  an island's component for second-pass SSR rendering. */
export function _getIslandRegistry(): Readonly<Record<string, IslandRegistration>> {
  return _islandRegistry
}

/** Internal: set the bundle URL map. Called by `serve()` after building. */
export function _setIslandBundleUrls(urls: Readonly<Record<string, string>> | undefined): void {
  _islandBundleUrls = urls ?? {}
}

/** Internal: look up the bundle URL for a registered island name. */
export function _getIslandBundleUrl(name: string): string | undefined {
  return _islandBundleUrls[name]
}

/**
 * Shared chunk URLs — the `chunk-<hash>.js` files Bun's `splitting:
 * true` extracts from the per-island entries. Tracked separately
 * from `_islandBundleUrls` because chunks aren't keyed by island
 * name; they're keyed by Bun's content hash. `renderPage` emits a
 * `<link rel="modulepreload">` for each in `<head>` so the browser
 * starts fetching them in PARALLEL with the HTML doc, instead of
 * waiting for an island's `import` statement to be parsed.
 *
 * This cuts the critical-path depth from `HTML → islands → chunks`
 * to `HTML → (islands ∥ chunks)`. On Slow 4G that's typically a
 * 20-30 ms LCP improvement.
 */
let _sharedChunkUrls: readonly string[] = []
export function _setSharedChunkUrls(urls: readonly string[]): void {
  _sharedChunkUrls = urls
}
export function _getSharedChunkUrls(): readonly string[] {
  return _sharedChunkUrls
}

/**
 * Validate + normalize a client strategy. Unknown values throw —
 * defense-in-depth so the SSR attribute can be a closed enum on the
 * client side (no need to re-validate downstream).
 */
function validateClientStrategy(s: ClientStrategy | undefined): ClientStrategy {
  if (s === undefined) return 'load'
  if (s === 'load' || s === 'idle' || s === 'visible' || s === 'interaction') return s
  throw new Error(
    `island: client strategy must be 'load' | 'idle' | 'visible' | 'interaction' (got ${JSON.stringify(s)}).`,
  )
}

/**
 * Serialize island props for embedding in `data-place-island-props`.
 * STRIPS prototype-pollution sentinel keys (`__proto__`, `constructor`,
 * `prototype`) at every level. The client's auto-mount script also
 * strips on receive (defense-in-depth) but stripping at the source is
 * safer — never write what you don't want to read back.
 */
function safeStringifyIslandProps(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const clean: Record<string, unknown> = {}
      for (const k of Object.keys(v as object)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
        clean[k] = (v as Record<string, unknown>)[k]
      }
      return clean
    }
    return v
  })
}

/**
 * Mount strategy for an island — when does the client-side hydration
 * actually run? Defaults to `'load'` (immediately on DOMContentLoaded).
 *
 *   - `'load'`: hydrate as soon as the DOM is ready. Same-frame
 *     interactivity. Fine for islands that are above-the-fold and
 *     used immediately.
 *   - `'idle'`: hydrate during a `requestIdleCallback` (or 200ms
 *     setTimeout fallback). Defers cost away from the critical
 *     rendering path. **The right choice for hidden modals + shared-
 *     state-driven UI** (see `'interaction'` caveat below).
 *   - `'visible'`: hydrate when the island enters the viewport (via
 *     IntersectionObserver). Best for below-the-fold islands that
 *     might never be reached.
 *   - `'interaction'`: hydrate on first hover/focus/click **on the
 *     marker element itself**. Most aggressive deferral; pays nothing
 *     until the user actually interacts with the marker's bounding
 *     box.
 *
 *     **CAUTION** — `'interaction'` only works when the marker
 *     itself has visible bounds users can hover/click. Hidden modals
 *     (e.g. `<Activity when={open}>...</Activity>` wrapping a dialog
 *     that starts closed) render an Activity span with `hidden`
 *     attribute → the marker collapses to `height: 0`, and users
 *     can never trigger the strategy. If your island reacts to a
 *     shared state cell set by a SIBLING button (search palette
 *     opened by a search trigger; mobile drawer opened by a
 *     hamburger), use `'idle'` instead — the bundle is loaded at
 *     browser-idle time so it's a live subscriber by the time the
 *     trigger fires.
 *
 * In all cases the SSR'd HTML inside the marker stays visible
 * immediately — the strategy only delays when reactivity attaches
 * (because we use `hydrate()`, not `mount()`).
 */
export type ClientStrategy = 'load' | 'idle' | 'visible' | 'interaction'

export interface IslandProps {
  /** Registered island name (key in `app({ islands: { … } })`). */
  readonly name: string
  /**
   * Props passed to the island. Must be JSON-serializable — they're
   * embedded into the HTML as `data-place-island-props` and read on
   * the client at mount time.
   */
  readonly props?: Readonly<Record<string, unknown>>
  /** When to hydrate. Default `'load'`. See `ClientStrategy`. */
  readonly client?: ClientStrategy
}

// ----- DX V2: `island()` factory + JSX-usable component -----
//
// The lower-level `<Island name="..." props={...}>` API is still
// supported, but the DX-friendly path is:
//
//   // counter.tsx
//   import { island, state } from '@place/component'
//
//   const Counter = island(import.meta.url, ({ start = 0 }: { start?: number }) => {
//     const count = state(start)
//     return <button onClick={() => count.set(count() + 1)}>{count}</button>
//   })
//   export default Counter
//
//   // app.ts
//   import Counter from './islands/counter.tsx'
//   app({ islands: [Counter] })  // array form
//
//   // page.tsx
//   import Counter from './islands/counter.tsx'
//   <Counter start={5} />     // ← direct JSX, type-safe props
//
// What changed vs the record form:
//   - One source of truth (the .tsx file), no name/path repetition
//   - Type-safe props flow from the component's function signature
//   - No string name lookup; refactor-safe (rename the file → done)
//   - The framework derives `name` from the file basename of the srcUrl

/**
 * Wraps a component as an island. Returns a callable that's directly
 * usable as JSX (`<Counter start={5} />`). Pages without any island
 * call ship ZERO framework JS.
 *
 * **Author shape (recommended).** Pass just the render fn — the
 * framework's Bun plugin rewrites `island(fn)` to
 * `island(import.meta.url, fn)` at load time. The user never types
 * the URL boilerplate:
 *
 * ```tsx
 * const Counter = island((props: { start?: number }) => {
 *   const n = state(props.start ?? 0)
 *   return <button onClick={() => n.set(n() + 1)}>{n}</button>
 * })
 * ```
 *
 * **Explicit form.** Pass the URL yourself if you're not using the
 * plugin (advanced / framework-internal callers):
 *
 * ```tsx
 * island(import.meta.url, fn)
 * ```
 *
 * @deprecated Prefer `view()` ([ADR 0030](docs/decisions/0030-unified-hydration.md)).
 *   `island()` is now an alias for `view()` with no `level` option set —
 *   identical behavior, but `view()` is the canonical name and unlocks
 *   the `level: 'static'` emit path (ships zero JS for pure components).
 *   Migration: rename `island` → `view`; the import + call shape is
 *   otherwise identical.
 */
/**
 * Per-island options. Currently just `ssrProps` — a resolver that
 * computes the island's initial props from the rendered page body.
 * The framework invokes the resolver automatically after every page
 * render; the app doesn't need to wire anything for it to fire.
 *
 * Add more options here as they emerge (eager-vs-lazy bundle hints,
 * per-island CSP overrides, etc.) — keeping the surface explicit
 * rather than letting consumers attach arbitrary metadata to the
 * island callable.
 */
export interface IslandOptions<P extends Record<string, unknown>> {
  /**
   * Compute the island's SSR initial props from the rendered page
   * body. The framework calls this once per request after the body
   * is built; the result is spliced into the island's marker via
   * `rerenderIsland`. See `IslandSsrPropsResolver` for the contract.
   *
   * **Example** — a table-of-contents island declares its own SSR
   * contract once, and the framework wires it up across every page
   * that renders the toc. `ctx.headings` is the heading list the
   * framework collected during the render pass (h2/h3 inside
   * `<main>`, with stable ids auto-injected onto each element):
   *
   * ```tsx
   * import { island } from '@place/component'
   *
   * export default island((props: ToCProps) => { ... }, {
   *   ssrProps: ({ headings }) =>
   *     headings.length === 0
   *       ? null
   *       : { props: { initialHeadings: headings } },
   * })
   * ```
   *
   * The app's `app({...})` config does NOT need to wire anything for
   * this island's SSR contract — the framework discovers `ssrProps`
   * via the registry.
   */
  readonly ssrProps?: IslandSsrPropsResolver<P>
}

export function island<P extends Record<string, unknown>>(
  fn: (props: P) => View,
  options?: IslandOptions<P>,
): IslandComponent<P>
export function island<P extends Record<string, unknown>>(
  srcUrl: string,
  fn: (props: P) => View,
  options?: IslandOptions<P>,
): IslandComponent<P>
export function island<P extends Record<string, unknown>>(
  srcUrlOrFn: string | ((props: P) => View),
  maybeFnOrOptions?: ((props: P) => View) | IslandOptions<P>,
  maybeOptions?: IslandOptions<P>,
): IslandComponent<P> {
  // Normalize the two surfaces. The plugin's transform always produces
  // the two-arg form at load time, so the one-arg form ONLY reaches
  // this point when the plugin didn't run (e.g. a test importing
  // `island` directly from `@place/component` without going through
  // the Bun plugin, or a third-party tooling path). Throw a helpful
  // error in that case rather than silently registering with an empty
  // src that the bundler can't resolve.
  let srcUrl: string
  let fn: (props: P) => View
  let options: IslandOptions<P> | undefined
  if (typeof srcUrlOrFn === 'function') {
    throw new Error(
      'island(fn): single-arg form requires the place auto-import plugin ' +
        '(registered via `preload = ["@place/component/preload"]` in bunfig.toml). ' +
        'The plugin rewrites `island(fn)` → `island(import.meta.url, fn)` so the ' +
        'bundler can locate the source. Either enable the plugin or call ' +
        '`island(import.meta.url, fn)` explicitly.',
    )
  } else if (typeof srcUrlOrFn === 'string' && typeof maybeFnOrOptions === 'function') {
    srcUrl = srcUrlOrFn
    fn = maybeFnOrOptions
    options = maybeOptions
  } else {
    throw new TypeError(
      'island: invalid arguments. Pass `island(fn)` or `island(import.meta.url, fn)`.',
    )
  }
  // Derive a stable name from the source URL's basename. Strip the
  // extension AND any common island suffix (`.island`). Slugify so it
  // survives as an HTML attribute value + bundle URL.
  const decoded = (() => {
    try {
      const u = new URL(srcUrl)
      return u.pathname
    } catch {
      // srcUrl wasn't a real URL — treat as filesystem path
      return srcUrl
    }
  })()
  const basename = decoded
    .replace(/^.*\//, '')
    .replace(/\.[jt]sx?$/, '')
    .replace(/\.island$/, '')
  // Strict: validate the BARE filename (no slugification). If the
  // basename contains anything outside `[a-zA-Z0-9_-]` we throw — the
  // developer must rename the file. Silent slugification would mask
  // genuinely bad inputs (XSS attempts via filename, prototype-
  // pollution sentinels, etc.). Fail loud at island-definition time.
  validateIslandName(basename)
  const name = basename

  // Pull off the URL prefix so the framework's bundler gets a plain
  // filesystem path (Bun's resolver handles `file:` URLs too, but
  // most code expects strings).
  const src = srcUrl.startsWith('file://') ? decoded : srcUrl

  // Register on first invocation. Idempotent — a hot-reloaded module
  // can call `island()` again with the same URL safely. The
  // `ssrProps` resolver (if any) flows into the registry too so
  // `renderPage` can discover it without app-level wiring.
  const ssrProps = options?.ssrProps as IslandSsrPropsResolver<Record<string, unknown>> | undefined
  _registerIslandDef(name, {
    component: fn as never,
    src,
    ...(ssrProps ? { ssrProps } : {}),
  })

  const callable = (props: P & { client?: ClientStrategy }): View => {
    // Strip the framework-reserved `client` prop before it reaches
    // the user's render fn. The strategy lives ONLY in the SSR'd
    // marker attribute; the user's component never sees it.
    const { client: rawStrategy, ...userProps } = (props ?? {}) as P & {
      client?: ClientStrategy
    }
    const strategy = validateClientStrategy(rawStrategy)
    const userKeys = Object.keys(userProps as object)
    // **T8-C wire format (ADR 0030):** unified `data-view-*` attributes.
    // `data-view="island"` is the kind discriminator (thaw + island-stream
    // emitters use the same prefix). `data-view-id` is the registered
    // island name. Replaces the legacy `data-place-island*` set; the
    // rename is mechanical and doesn't change behaviour.
    const propsAttr =
      userKeys.length > 0
        ? ` data-view-props="${escapeHtmlAttrFull(safeStringifyIslandProps(userProps))}"`
        : ''
    const strategyAttr = strategy !== 'load' ? ` data-view-strategy="${strategy}"` : ''
    const openTag = `<div data-view="island" data-view-id="${escapeHtmlAttrFull(name)}"${propsAttr}${strategyAttr}>`

    // **Defer running the impl until toHtml/mount/hydrate time** so the
    // island's own browser-global-throw recovery can fire INSIDE the
    // marker (and the marker is always emitted, even when SSR can't
    // produce content). The bug we're fixing: the JSX runtime auto-
    // wraps every function-typed JSX node in `component()`, whose
    // catch turns a ReferenceError on `document` / `window` /
    // `localStorage` into a generic auto-placeholder span — but that
    // span has no `data-place-island="…"`, so the island bundle's
    // auto-mount wrapper never finds a marker to hydrate. SearchPalette
    // (calls `globalKey('mod+k', …)` which touches `document` synchronously
    // in its body) was a casualty: every page emitted a placeholder
    // instead of the marker, the bundle loaded but never matched, the
    // palette was dead. By running the impl inside `toHtml` and
    // catching ClientOnlyAbort + browser-global ReferenceErrors here,
    // the SSR output is `<div data-place-island="search-palette"></div>` —
    // empty contents (the client will produce them post-hydration) but
    // a real, matchable marker.
    let cachedInner: View | null = null
    const runImpl = (): View => {
      if (cachedInner !== null) return cachedInner
      cachedInner = fn(userProps as unknown as P)
      return cachedInner
    }

    // `currentIslandSet.add(name)` lives in toHtml/mount/hydrate — NOT
    // at callable-invocation time — because the renderPage flow builds
    // the View tree BEFORE `_beginIslandCollection()` opens the
    // collection scope. The previous code added at callable time, which
    // hit a `null` collector and silently no-op'd; the script tag for
    // the island bundle vanished from SSR output. Doing the add
    // lazily, inside the consumer methods, mirrors what
    // `component()`'s wrap used to do for us and ensures every
    // <Island /> in the page lands in the collector before
    // `_endIslandCollection()` snapshots it.
    const register = (): void => {
      _addIslandWithStrategy(name, strategy)
    }

    return {
      toHtml: (): string => {
        register()
        try {
          const inner = runImpl()
          const innerHtml = inner.toHtml?.() ?? ''
          return `${openTag}${innerHtml}</div>`
        } catch (e) {
          if (e instanceof ClientOnlyAbort || isBrowserGlobalRef(e)) {
            // Emit the marker with empty content. The island's bundle
            // will mount() the impl into the marker on the client (the
            // wrapper's `el.firstChild` check falls back to `mount`
            // when there's no existing content).
            return `${openTag}</div>`
          }
          throw e
        }
      },
      mount(container, before) {
        register()
        return runImpl().mount(container, before)
      },
      hydrate(slot) {
        register()
        const inner = runImpl()
        return inner.hydrate ? inner.hydrate(slot) : inner.mount(slot.parent(), null)
      },
    }
  }

  return Object.assign(callable, {
    __islandName: name,
    __islandSrc: src,
    __islandBrand: ISLAND_BRAND,
    ...(ssrProps ? { __islandSsrProps: ssrProps } : {}),
  }) as IslandComponent<P>
}

/**
 * Brand on the value returned by `island()` so the JSX runtime can
 * detect island invocations and **skip** the standard `component()`
 * auto-wrap. Without the skip, JSX's `<MyIsland />` becomes
 * `component(MyIsland)({})`, and `component()`'s ReferenceError catch
 * substitutes a generic auto-placeholder span that doesn't carry the
 * island marker — the bundle loads but never hydrates because its
 * marker is missing. The brand keeps the JSX path delegating to the
 * island's own callable, which handles SSR-throw recovery internally.
 */
export const ISLAND_BRAND: unique symbol = Symbol('place:island')

/** Component-shape returned by `island()`. Callable as JSX. The
 *  `__islandSsrProps` field is present only when `island(...)` was
 *  called with an `ssrProps` resolver in its options — exposed on
 *  the callable so `discoverIslands` (filesystem-based registry
 *  build) can lift it into the registry without re-importing the
 *  module. */
export type IslandComponent<P extends Record<string, unknown>> = ((props: P) => View) & {
  readonly __islandName: string
  readonly __islandSrc: string
  readonly __islandBrand: typeof ISLAND_BRAND
  readonly __islandSsrProps?: IslandSsrPropsResolver<P>
}

/** Internal: append an island to the in-memory registry. */
function _registerIslandDef(name: string, reg: IslandRegistration): void {
  // Don't overwrite an existing registration that hasn't been
  // serve()-installed yet — the user's `app({ islands: [...] })`
  // is the canonical install point.
  _pendingIslands.set(name, reg)
}

/** Auto-registered islands awaiting `serve()` install. */
const _pendingIslands = new Map<string, IslandRegistration>()

/** Internal: drain pending islands into the active registry. */
export function _drainPendingIslands(): Readonly<Record<string, IslandRegistration>> {
  const out: Record<string, IslandRegistration> = {}
  for (const [name, reg] of _pendingIslands) out[name] = reg
  return out
}

/**
 * Render an island. Server-side, renders the registered component
 * inside a `data-place-island` marker. Client-side, the island's
 * per-island bundle finds the marker and mounts the component with
 * the embedded props.
 *
 * ```tsx
 * <Island name="Counter" props={{ start: 5 }} />
 * ```
 *
 * Pages without any `<Island>` element ship ZERO framework JS.
 */
export const Island = (props: IslandProps): View => {
  // Validate the name shape BEFORE any registry lookup. Defense-in-
  // depth: even if a malicious registry got installed, name validation
  // restricts what can flow into the HTML attribute / CSS selector /
  // bundle URL paths.
  validateIslandName(props.name)
  const reg = _islandRegistry[props.name]
  if (!reg) {
    throw new Error(
      `Island: no registration for name '${props.name}'. Add an entry ` +
        `to \`app({ islands: { ${props.name}: { component, src } } })\`.`,
    )
  }
  const strategy = validateClientStrategy(props.client)
  // The registered component is always an `island(import.meta.url, fn)`
  // callable — it already emits its own `<div data-view="island"
  // data-view-id="…">` marker via its `toHtml`. If `<Island name="…" />`
  // wrapped it in ANOTHER marker the SSR'd HTML would be
  //   <div data-view="island" data-view-id="X"><div data-view="island"
  //     data-view-id="X"></div></div>
  // and the client bundle's `[data-view-id="X"]` selector would match
  // BOTH layers; the outer's `el.firstChild` is the inner (empty SSR-
  // throw recovery) marker, so `hydrate(view, outer)` would walk the
  // inner div thinking it's the view's outermost element and crash on
  // the first child mismatch (e.g. devtools view's outermost is `<div
  // class="place-dt">` whose first child is `<button class="place-dt-
  // launch">`, but the inner marker has no children — a real hydration
  // mismatch). The branded fast path delegates straight to the island
  // callable, forwarding the `client` strategy as a reserved prop.
  const islandLike = reg.component as IslandComponent<Record<string, unknown>>
  if (islandLike.__islandBrand === ISLAND_BRAND) {
    _addIslandWithStrategy(props.name, strategy)
    const userProps = (props.props ?? {}) as Record<string, unknown>
    return islandLike({ ...userProps, client: strategy })
  }
  // Legacy / programmatic registration: `reg.component` is a plain
  // `(props) => View` constructor (no marker emission). Wrap it.
  const inner = reg.component(props.props as never)
  _addIslandWithStrategy(props.name, strategy)
  return {
    toHtml: (): string => {
      const innerHtml = inner.toHtml?.() ?? ''
      // T8-C: unified `data-view-*` wire (ADR 0030); see the island()
      // factory above for the same emission pattern.
      const propsAttr =
        props.props !== undefined
          ? ` data-view-props="${escapeHtmlAttrFull(safeStringifyIslandProps(props.props))}"`
          : ''
      const strategyAttr = strategy !== 'load' ? ` data-view-strategy="${strategy}"` : ''
      return (
        `<div data-view="island" data-view-id="${escapeHtmlAttrFull(props.name)}"${propsAttr}${strategyAttr}>` +
        innerHtml +
        `</div>`
      )
    },
    mount(container, before) {
      // Client-side rendering (e.g. via mount() in tests): just render
      // the inner. The island's own bundle handles real client mount
      // on the SSR'd document.
      return inner.mount(container, before)
    },
    hydrate(slot) {
      return inner.hydrate ? inner.hydrate(slot) : inner.mount(slot.parent(), null)
    },
  }
}
