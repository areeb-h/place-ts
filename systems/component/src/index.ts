/// <reference types="bun" />
// @place/component — rendering layer (Phase v0.2 minimum)
//
// Sits on top of @place/reactivity. Components are functions from props to
// views. A `View` knows how to mount itself to a DOM parent and return a
// disposer. Element factories produce views; `mount()` is the top-level entry.
//
// JSX is a thin facade emitting calls to these same factories — see
// jsx-runtime.ts. Per ADR 0002, JSX-shape is opt-in via tsconfig
// jsxImportSource; the factories work standalone for non-JSX users.
//
// What ships at v0.2 (this file):
//   - View type and Disposer
//   - mount(view, parent) — top-level entry
//   - el(tag, props) — generic factory; HTML elements via the typed wrappers below
//   - Reactive bindings for attributes, text children, and view children
//   - Function-as-child form for both reactive text and reactive view-swap
//   - Event handlers via onClick / onInput / etc.
//   - Fragment for grouping siblings without a wrapping element
//   - onCleanup() for component-scoped cleanup
//
// Deferred to v0.2.x:
//   - keyed() list primitive
//   - HMR-aware component identity
//   - Streaming SSR
//   - Animations / transitions
//   - Error boundaries

import { type Disposer, type EffectBranded, untrack, watch } from '@place/reactivity'
import { serverRouter as createServerRouter, RouterCap } from '@place/routing'

import { onCleanup } from './_internal/cleanup.ts'
import {
  _auditHydrationFrame,
  _flushHydrationDeltas,
  _isHydratedSignal as _isHydratedState,
  _setHydrated,
} from './_internal/hydration.ts'
import { _invalidateCachesByTag } from './cache.ts'
import { _CookieJarCap, parseCookieHeader } from './cookies.ts'

// Build-time define injected by Bun.build's `define` option in the
// client-bundle path. `true` in the browser bundle, undefined on the
// server runtime. Used in the `serve` ternary export below to drop the
// server-only `_serveImpl` body (and its transitive closure — Bun.serve,
// Bun.build, security-headers, devalue.stringify, fs/promises, …) from
// the client bundle via dead-branch elimination.
declare const __PLACE_BROWSER__: boolean | undefined
// Build-time dev/prod flag injected by Bun.build. `true` in dev
// builds, `false` in production. Used to gate the HMR client + the
// `island()` accept-call build transform so production ships zero
// bytes of HMR-related code. ADR 0028 phase 4 surface.
declare const __PLACE_DEV__: boolean | undefined

// Hydration internals + flag state, re-exported from `_internal/hydration.ts`.
// Underscore-prefixed names mark them as internal-but-test-accessible.
export {
  _auditHydrationFrame,
  _drainHydrationDeltas,
  _flushHydrationDeltas,
  _readHydrated,
  _readHydrationDeltas,
  _setHydrated,
  type HydrationDelta,
} from './_internal/hydration.ts'
export { type CookieStateOptions, cookie, cookieState, parseCookieHeader } from './cookies.ts'
// SSR post-render helpers: heading extraction + island marker patching.
// The first-paint ToC story uses `extractMainHeadings` to scan h2/h3 in
// the rendered `<main>`, inject ids, and surface the list — and
// `patchIslandMarker` to replace an empty island marker's inner HTML
// with a populated version. Both are pure string ops, safe to call from
// app-level `transformBody` hooks. See `ssr-toc.ts` for the rationale.
export {
  extractMainHeadings,
  patchIslandMarker,
  rerenderIsland,
  slugifyHeading,
} from './ssr-toc.ts'

// `SsrHeading` is declared canonically right above the heading
// collector (search for `interface SsrHeading`); `ssr-toc.ts`
// re-exports it for back-compat.
// Also imported (not just re-exported) for internal use in
// `renderPage` — auto-invoking per-island `ssrProps` resolvers
// during the SSR pass.
import { rerenderIsland } from './ssr-toc.ts'

// Input + keyboard bindings (`wire`, `onKey`, `globalKey`, `urlState`)
// extracted to a focused leaf module.
export {
  type GlobalKeyOptions,
  globalKey,
  type OnKeyOptions,
  onKey,
  type UrlStateOptions,
  urlState,
  type WiredBoolean,
  type WiredNumber,
  type WiredText,
  wire,
} from './input-bindings.ts'
// Tabs primitive — headless, no default classes; caller styles via `classes`.
// `Activity` keeps every panel mounted; the active one's `hidden` flips off.
// See the `Tabs(...)` JSDoc block earlier in this file for the full shape.
export { type Recipe, type RecipeConfig, recipe } from './recipe.ts'
export { twMerge } from './twmerge.ts'
// ===== cls — conditional class composition =====
// Extracted to ./utils/cls.ts (audit Phase 2.1, Cut 1a). Re-exported for
// public consumers; no internal callsites in this file consume it
// directly (component-internal classes are built via raw strings).
export { type ClassValue, cls } from './utils/cls.ts'

// ===== wire — two-way binding for inputs / textareas / checkboxes =====
//
// Collapses this:
//
//   <input
//     value={() => query.read()}
//     onInput={(e) => query.write((e.target as HTMLInputElement).value)}
//   />
//
// to this:
//
//   <input {...wire(query)} />
//
// Forms:
//
//   wire(stringState)              — text input / textarea
//   wire(numberState)              — number input (parses .value, ignores NaN)
//   wire(booleanState)             — checkbox / radio (uses .checked)
//   wire(get, set)                 — derived string field with a custom
//                                    setter (e.g. store.update)
//
// String and derived forms return `{ value, onInput }`. Number form is
// the same shape; onInput parseFloats and silently ignores NaN so a
// number spinner dragged past empty doesn't clobber state with NaN.
// Boolean form returns `{ checked, onChange }` — the right pair for
// HTML checkboxes / radios.
//
// Runtime dispatch on the state's current value type. One name, three
// input shapes; the namespace stays small.

// `wire`, `onKey`, `globalKey`, `urlState` extracted to
// `./input-bindings.ts`. Re-exported below for the public API.

// ===== Public types =====
// Extracted to ./types.ts (audit Phase 2.1, Cut 1c). Re-exported for
// public consumers; only types referenced internally by this file are
// also imported (the supporting interfaces `BaseProps`/`CommonAttrs`/
// `CommonEvents`/`EventHandler`/`Reactive` live in types.ts and are
// composed into `ElementProps` there — this file consumes the
import type { View } from './types.ts'

export type {
  Child,
  Children,
  Component,
  ElementProps,
  EventHandler,
  HydrationSlot,
  RefCallback,
  View,
} from './types.ts'

// `makeSlot` lives in `./_internal/slot.ts`; the element factory's
// `hydrate` method (now in ./element.ts) imports it directly from
// there. No longer referenced in this barrel.

// `onCleanup`, `withCleanups`, `disposeAll` live in `./_internal/cleanup.ts`
// so multiple modules can share the singleton without depending on this
// barrel. Re-exported below for the public API.

/**
 * Register `fn` to run AFTER the component is in the DOM and hydration
 * has completed. Use this for browser-only work that shouldn't run
 * during SSR: starting timers, attaching listeners, reading `localStorage`,
 * touching `window.matchMedia`, etc.
 *
 * If `fn` returns a function, it's auto-registered as a cleanup (runs
 * when the component unmounts).
 *
 *   onMount(() => {
 *     const id = setInterval(() => tick.set(tick() + 1), 1000)
 *     return () => clearInterval(id)
 *   })
 *
 * **Why this matters for hard-refresh:** put browser-only work HERE, and
 * the component's body can render its full DOM structure on SSR (with
 * default state). The HTML reaches the user from the first paint; only
 * specific reactive bindings flip during hydration. No layout shift,
 * no content "popping in." This is how to get a smoother hard-refresh
 * than Next / Svelte / TanStack — which all suffer from this exact blip
 * for client-only components.
 *
 * Lifecycle:
 *   - SSR: never runs (server never sees `_setHydrated(true)`).
 *   - Client hydrate: runs once, after the framework flips the hydrated
 *     flag at the end of `boot()`.
 *   - CSR-only mount: runs once, synchronously after the watch settles.
 */
function _onMount(fn: () => void | (() => void)): void {
  if (typeof window === 'undefined') {
    // SSR — onMount is a no-op. Body finishes; static structure ships.
    return
  }
  // Already hydrated (e.g. mounted post-boot on a CSR app, or via SPA
  // navigation when the global flag is already true): run immediately
  // inside the current cleanup scope.
  if (_isHydratedState()) {
    const ret = untrack(() => fn())
    if (typeof ret === 'function') onCleanup(ret)
    return
  }
  // Pre-hydration: wait for the flag to flip via a one-shot watch.
  // The first invocation of the watch body happens synchronously inside
  // `watch(...)`, BEFORE the returned disposer is bound. Guard with a
  // forward-declared box so the body can dispose itself on a later run.
  let stop: Disposer = (() => {}) as Disposer
  let fired = false
  stop = watch(() => {
    if (fired || !_isHydratedState()) return
    fired = true
    stop()
    untrack(() => {
      const ret = fn()
      if (typeof ret === 'function') onCleanup(ret)
    })
  })
  // Keep the watch's disposer wired into the surrounding cleanup scope
  // so an unmount before hydration tears it down cleanly.
  onCleanup(stop)
}

/**
 * `onMount` carries the `'lifecycle'` effect brand (T8-A; ADR 0030).
 * Phantom — no runtime `__effect` property; the build-time classifier
 * reads the brand off the inferred function type. A `view()` body
 * that calls `onMount` gets promoted from L1 thaw to L2 island
 * because lifecycle effects can't run from an inline action AST.
 *
 * (The const-declaration form below — vs the more usual
 * `export function onMount`— is purely so the brand intersection
 * lives on `typeof onMount`. The runtime is just `_onMount`.)
 */
export const onMount: typeof _onMount & EffectBranded<'lifecycle'> = _onMount

export { onCleanup } from './_internal/cleanup.ts'

// Hydration audit state + flag state extracted to `./_internal/hydration.ts`
// so the auditor, the hydrate path, `<ClientOnly>`, `<Deferred>`, `onMount`,
// and tests can all share the singletons without depending on this barrel.
// Public symbols are re-exported from this file (see the `export {}` block
// near the bottom).

// ===== Element factory + SSR emitter + directives =====
// Extracted to ./element.ts (Tier 20 decomposition, cut 3) — the
// rendering core. `index.ts` imports the symbols it uses + re-exports
// the public surface (`el`, the heading-collection helpers).
import { _beginHeadingCollection, _endHeadingCollection, _getFirstH1Text } from './element.ts'

export type { SsrHeading } from './element.ts'
// Re-export the public element surface so `@place/component` and every
// in-package importer keep seeing these names on the barrel.
export { _beginHeadingCollection, _endHeadingCollection, _getFirstH1Text, el } from './element.ts'

// Dev error overlay — `renderRouteError` is used by `renderPage`'s
// per-route catch. (Terminal logging moved to ./serve.ts.)
import { renderRouteError } from './error-overlay.ts'
// `ErrorBoundaryCap` / `currentInlineStyleSet` are exported from this
// barrel for ./element.ts + ./mount.ts during the decomposition
// (function-level cycles — see those files). Later cuts re-home them
// to their own modules; the exports become internal then.
// ===== Client mount machinery + Fragment + Tabs =====
// Extracted to ./mount.ts (Tier 20 decomposition, cut 4). `index.ts`
// imports `_consumeTabsUsedFlag` (the dispatch path drains it) +
// re-exports the public surface so every consumer of
// `@place/component` keeps seeing these names on the barrel.
import { _consumeTabsUsedFlag } from './mount.ts'
// Escape helper used by meta + island serialization (the SSR emitter's
// own escaping moved to element.ts).
import { escapeHtmlAttrFull } from './utils/escape.ts'

export {
  _consumeTabsUsedFlag,
  Activity,
  type ActivityProps,
  Fragment,
  markTabsUsedOnThisRequest,
  mountChildren,
  Show,
  type ShowProps,
  TAB_BRAND,
  Tab,
  type TabProps,
  Tabs,
  type TabsClassNames,
  type TabsProps,
  type TabsVariant,
  tabsState,
} from './mount.ts'

// ===== Top-level mount + capability scoping =====

// `mount`, `hydrate`, `withCapability`, `withCapabilities` live in
// `./_client-mount.ts` — the leaf the per-island wrappers import
// directly (see that file's header for the split rationale). `mount`
// renders a view into a DOM node; `hydrate` adopts SSR'd markup. The
// island runtime uses both internally; they stay public as the
// lower-level rendering primitives. (The route-walking `boot()`
// full-page client entry was removed with the islands migration —
// islands self-mount via their own bundles.)
import { hydrate, mount, withCapabilities, withCapability } from './_client-mount.ts'

export { hydrate, mount, withCapabilities, withCapability }

// ===== SSR pipeline — renderToString / renderToStream / suspense / Static =====
// Extracted to ./ssr.ts (Tier 20 decomposition, cut 5). `index.ts`
// imports `renderToString` / `renderToStream` for its own use
// (`renderPage`, the `renderToHtml` test helper) + re-exports the
// public surface so `@place/component` consumers are unchanged.
import { renderToStream, renderToString } from './ssr.ts'

export {
  type RenderToStreamOptions,
  renderToStream,
  renderToString,
  Static,
  Suspense,
  type SuspenseJSXProps,
  type SuspenseProps,
  suspense,
} from './ssr.ts'

// Inline runtime scripts + the per-page assembly helpers that
// `renderPage` injects. The SSR block used to import these inline;
// they stay imported here because `renderPage` (still in this barrel)
// is the consumer.
import { _consumeCopyUsedFlag, placeCopyRuntime } from './__copy-runtime.ts'
import { placeDeferredIslands } from './__deferred-islands.ts'
import { placeEarly } from './__early.ts'
import { placeHmr } from './__hmr.ts'
import { placeSpaNav } from './__spa_nav.ts'
import { placeTabs } from './__tabs.ts'
import { placeViewport } from './__viewport-runtime.ts'

// ===== serverRouter — METHOD + path pattern → handler dispatch =====
// Extracted to ./server-router.ts (audit Phase 2.1, Cut 1b). Re-exported
// for public consumers. (`RouteHandler` is consumed internally by
// ./serve.ts, which imports it from server-router.ts directly.)
export { type RouteHandler, type ServerRouter, serverRouter } from './server-router.ts'

// ===== T5-C — Islands primitive (ADR 0019) =====
// Extracted to ./islands.ts (Tier 20 decomposition, cut 6). `index.ts`
// imports the registry hooks the build pipeline + dispatch path use,
// + re-exports the public surface (`island`, `Island`) and the
// `_`-prefixed hooks the build modules + test-internal barrel need.
import {
  _beginIslandCollection,
  _endIslandCollection,
  _getIslandBundleUrl,
  _getIslandRegistry,
  _getSharedChunkUrls,
} from './islands.ts'

export {
  _beginIslandCollection,
  _drainPendingIslands,
  _endIslandCollection,
  _getIslandBundleUrl,
  _getIslandRegistry,
  _getSharedChunkUrls,
  _setIslandBundleUrls,
  _setIslandRegistry,
  _setSharedChunkUrls,
  type ClientStrategy,
  ISLAND_BRAND,
  Island,
  type IslandComponent,
  type IslandOptions,
  type IslandProps,
  type IslandRegistration,
  type IslandSsrContext,
  type IslandSsrPropsResolver,
  type IslandSsrResult,
  island,
} from './islands.ts'

// T6-B inline-style-attr hash collector — extracted to
// `./_internal/inline-style.ts` (cut 5b). The dispatch path uses the
// begin/end helpers + re-exports them for the test-internal barrel;
// `element.ts` reads the live `currentInlineStyleSet` binding directly.
import { _beginInlineStyleCollection, _endInlineStyleCollection } from './_internal/inline-style.ts'

export { _beginInlineStyleCollection, _endInlineStyleCollection }

/**
 * Private response header `renderPage` uses to ship its collected
 * inline-style-attr hashes back to the dispatcher (so the dispatcher
 * can fold them into the response's CSP `style-src` directive with
 * `'unsafe-hashes'`). Stripped from the outgoing response in
 * `_serveImpl` before it leaves the framework boundary — it never
 * shows up to user agents.
 *
 * Comma-separated base64 SHA-256 values. Base64 doesn't contain `,`
 * so the separator is unambiguous.
 */
export const INLINE_STYLE_HASHES_HEADER = 'x-place-inline-style-hashes'

// ===== meta — typed metadata for the document <head> =====
// Extracted to ./meta.ts (audit Phase 2.1, Cut 1d). Re-exported below
// for public consumers; internal renderers (`renderDocument`, etc.) and
// `DocumentParts` are imported back for the SSR pipeline below.

export {
  css,
  cssMedia,
  type HeadEntry,
  type OpenGraphMeta,
  type PageMeta,
  type StyleSrc,
  type TwitterMeta,
} from './meta.ts'

import { type HeadEntry, type PageMeta, renderDocument, type StyleSrc } from './meta.ts'

// ===== page / layout / handler authoring API =====
// Extracted to ./page.ts (Tier 20 decomposition, cut 7). `index.ts`
// imports the symbols `renderPage` (still in this barrel) composes
// with + re-exports the public surface so `@place/component`
// consumers are unchanged.
import {
  type AnyLayout,
  type AnyPage,
  escapeForJsonScript,
  isNotFoundError,
  type LoadCtx,
  makeSlots,
  PLACE_LOAD_SCRIPT_ID,
  type RenderPageOptions,
  renderPageWithCustomView,
} from './page.ts'

export {
  type AnyLayout,
  type AnyPage,
  type Handler,
  type HandlerOptions,
  handler,
  isLayout,
  isPage,
  type Layout,
  type LayoutDef,
  type LayoutSlots,
  type LoadCtx,
  layout,
  notFound,
  type Page,
  type PageDef,
  type PageViewProps,
  type PageWithOn,
  PLACE_LAYOUT_BRAND,
  PLACE_LOAD_SCRIPT_ID,
  PLACE_PAGE_BRAND,
  page,
  type RenderPageOptions,
  type SlotFills,
  useSearch,
} from './page.ts'

// ===== serve() orchestrator =====
// Extracted to ./serve.ts (Tier 20 decomposition, cut 9) — the server
// entrypoint + security headers + Tailwind integration + static-file
// primitive + deployment adapters. Re-exported wholesale so the
// `@place/component` public surface is unchanged; `serve.ts` calls
// `renderPage` (below) per-request — a benign function-level cycle.
export * from './serve.ts'

// `sha256Base64` — used by `renderPage` to hash the Tailwind CSS +
// load-data script for the per-response CSP. (`serve.ts` re-exports
// the rest of the security-headers surface.)
import { sha256Base64 } from './security-headers.ts'

/**
 * Render a Page to an HTML Response. Used by `serve()` per-request, and
 * exported so consumers can hand-wire pages into custom dispatch (e.g.
 * Bun.serve `routes` map, or compose with their own router).
 */
export async function renderPage(
  p: AnyPage,
  req: Request,
  params: Record<string, string> = {},
  options?: RenderPageOptions,
): Promise<Response> {
  const url = new URL(req.url)
  const urlProps = p.url ? p.url(url, params) : ({} as object)
  // Round 5 (5.5): parse search params via the page's `search:` schema,
  // if declared. The result is exposed as `props.search` to the view.
  // Parse failures route to the dev error overlay just like load()
  // throws — same diagnostic experience for typed-input errors.
  let parsedSearch: unknown
  if (p.search) {
    try {
      const raw: Record<string, string> = {}
      url.searchParams.forEach((v, k) => {
        raw[k] = v
      })
      parsedSearch = p.search(raw)
    } catch (e) {
      return renderRouteError(e, req, 'load')
    }
  }
  // Normalize layouts to an array (single layout, array of layouts, or
  // none). Layouts compose outside-in: layouts[0] wraps layouts[1] wraps
  // ... wraps the page. Serve()-level `extraLayouts` (e.g. a default
  // root layout) prepend onto the chain, so they wrap the outermost.
  const pageLayouts: AnyLayout[] = p.layout ? (Array.isArray(p.layout) ? p.layout : [p.layout]) : []
  const layouts: AnyLayout[] =
    options?.extraLayouts && options.extraLayouts.length > 0
      ? [...options.extraLayouts, ...pageLayouts]
      : pageLayouts
  // Run layouts' load()s first (chain order), then page's load(). Merge
  // results into a single loadData. Each layout's load() sees the same
  // ctx — they're peers. Page's load() runs last and can shadow keys.
  const loadData: Record<string, unknown> = {}
  // `X-Place-Prefetch: 1` is set by the SPA-nav runtime on hover/focus
  // prefetch requests. `load()` reads `ctx.prefetch` to skip side
  // effects on speculative loads. (Forbidden `Sec-` prefix rules out
  // `Sec-Purpose`, which only the browser's native speculation sends.)
  const ctx: LoadCtx = {
    req,
    url,
    params,
    prefetch: req.headers.get('x-place-prefetch') === '1',
  }
  for (const l of layouts) {
    if (l.load) {
      try {
        const data = (await l.load(ctx)) ?? {}
        Object.assign(loadData, data)
      } catch (e) {
        return renderRouteError(e, req, 'load')
      }
    }
  }
  if (p.load) {
    try {
      const data = (await p.load(ctx)) ?? {}
      Object.assign(loadData, data)
    } catch (e) {
      // Round 5 (5.7): `notFound()` is a typed signal; render the
      // page's onNotFound view as a 404 (or fall through to the global
      // handler).
      if (isNotFoundError(e) && p.onNotFound) {
        return await renderPageWithCustomView(p, p.onNotFound(ctx), ctx, layouts, options, 404)
      }
      // Per-page onError, if declared. The error is passed in.
      if (!isNotFoundError(e) && p.onError) {
        const err = e instanceof Error ? e : new Error(String(e))
        return await renderPageWithCustomView(p, p.onError(err, ctx), ctx, layouts, options, 500)
      }
      return renderRouteError(e, req, 'load')
    }
  }
  const props = (
    parsedSearch !== undefined
      ? { ...urlProps, ...loadData, search: parsedSearch }
      : { ...urlProps, ...loadData }
  ) as object
  // Install request-scoped server caps for the duration of this render:
  //
  //  - `RouterCap` — read-only router built from the request URL.
  //    `<Link>` uses this to auto-mark `aria-current="page"` during SSR,
  //    so sidebar/navbar active state ships in the first paint instead
  //    of flipping in after hydration. Navigation methods throw.
  //
  //  - `_CookieJarCap` — parsed request cookies. The universal
  //    `cookie(name)` helper reads from here on SSR (and
  //    `document.cookie` on the client), so components that derive
  //    initial state from cookies produce identical HTML on both
  //    runtimes — zero hydration flip.
  const _routerDispose = RouterCap.install(createServerRouter(req))
  const _cookieJarDispose = _CookieJarCap.install(parseCookieHeader(req.headers.get('cookie')))
  let _disposeServerCaps = (): void => {
    _cookieJarDispose()
    _routerDispose()
  }
  try {
    let view: View
    try {
      // Round 7 auto-ClientOnly is now per-component: `component()`'s
      // `toHtml` catches `ClientOnlyAbort` from any nested
      // `cap.use()` and emits a placeholder span. Pages don't need any
      // flag; client-only behavior originates structurally at the cap
      // boundary. The page's `view()` runs normally here — if a child
      // component throws ClientOnlyAbort it's caught at the component
      // boundary, not here.
      view = p.view(props)
      // Wrap in layouts inside-out: the LAST layout in the array is the
      // INNERMOST wrapper (closest to the page). So we iterate from end
      // to start, each layout receiving the previously-wrapped view as
      // its `children`.
      //
      // Slot fills declared on the page reach EVERY layout in the chain —
      // a slot named `headerActions` filled by the page works whether
      // the layout consuming it is the innermost or outermost wrapper.
      // Layouts read slots they care about; unknown slots resolve to
      // null. No file convention, no parallel-route magic.
      const pageSlots = makeSlots<string>(p.slots)
      for (let i = layouts.length - 1; i >= 0; i--) {
        const l = layouts[i] as AnyLayout
        view = l.view({
          ...props,
          children: view,
          slots: pageSlots,
        } as Parameters<typeof l.view>[0])
      }
    } catch (e) {
      return renderRouteError(e, req, 'render')
    }
    let meta: PageMeta | undefined
    try {
      // Collect metas: layouts first (in chain order), page last. Last-
      // write-wins on scalar fields. `htmlClass` and `bodyClass` get
      // CONCATENATED so a root layout can set `h-full` and a page can add
      // `bg-bg text-fg` without losing the parent's classes.
      const metas: PageMeta[] = []
      for (const l of layouts) {
        const lMeta = resolveMeta(l.meta, props)
        if (lMeta) metas.push(lMeta)
      }
      const pageMeta = resolveMeta(p.meta, props)
      if (pageMeta) metas.push(pageMeta)
      meta = metas.length === 0 ? undefined : mergeMeta(metas)
    } catch (e) {
      return renderRouteError(e, req, 'render')
    }
    // Auto-CSRF meta tag injection: when load() returns a `csrf` field,
    // emit `<meta name="csrf-token" content="...">` so action.call() and
    // <Form> can pick it up automatically (no per-page wiring of headers
    // or hidden inputs). The convention is: page mints the token in
    // load(), framework distributes it to the head, client reads from
    // there. Dev never sees the transmission, just the mint.
    const csrfFromLoad = (loadData as { csrf?: unknown }).csrf
    if (typeof csrfFromLoad === 'string' && csrfFromLoad.length > 0) {
      const csrfEntry: HeadEntry = {
        tag: 'meta',
        name: 'csrf-token',
        content: csrfFromLoad,
      }
      const existingExtra = meta?.extra ?? []
      meta = { ...(meta ?? {}), extra: [...existingExtra, csrfEntry] }
    }
    // Concatenate styles: layouts' styles emit BEFORE the page's so the
    // page can override the layout. Layouts in chain order, then page.
    const allStyles: StyleSrc[] = []
    for (const l of layouts) {
      if (l.styles) {
        if (Array.isArray(l.styles)) allStyles.push(...l.styles)
        else allStyles.push(l.styles)
      }
    }
    if (p.styles) {
      if (Array.isArray(p.styles)) allStyles.push(...p.styles)
      else allStyles.push(p.styles)
    }
    const stylesForDoc: StyleSrc | StyleSrc[] | undefined =
      allStyles.length === 0 ? undefined : allStyles.length === 1 ? allStyles[0] : allStyles
    // Merge serve()-level htmlClass prefix (e.g. the active theme class).
    // Prefix wins over user-supplied `meta.htmlClass`'s last-write because
    // it goes first; the page's own classes follow.
    if (options?.htmlClassPrefix) {
      const userClass = meta?.htmlClass ?? ''
      const merged = userClass ? `${options.htmlClassPrefix} ${userClass}` : options.htmlClassPrefix
      meta = { ...(meta ?? {}), htmlClass: merged }
    }
    // Pre-build the nonce attribute fragment once. Empty when no nonce —
    // those deployments rely on `'unsafe-inline'` in the CSP.
    const nonceAttr = options?.scriptNonce
      ? ` nonce="${escapeHtmlAttrFull(options.scriptNonce)}"`
      : ''
    const dataScript = p.load
      ? `<script type="application/json"${nonceAttr} id="${PLACE_LOAD_SCRIPT_ID}">${escapeForJsonScript(JSON.stringify(loadData))}</script>`
      : ''
    // Streaming pages route through renderToStream (handles suspense
    // boundaries and pushes swap chunks as resources resolve). Non-
    // streaming pages render synchronously for the simpler fast path.
    if (p.streaming) {
      const wrapDoc = (body: string): string => {
        // Always-emit (same reason as the sync path): SPA-nav to a page
        // with Tabs needs the runtime pre-attached.
        _consumeTabsUsedFlag()
        const tabsScript = options?.enableSpaNav
          ? `<script${nonceAttr}>${placeTabs()}</script>`
          : ''
        // `placeEarly()` rides with SPA-nav; `extraEarlyHead` (theme
        // early script + app earlyHead entries) ships whenever present,
        // independent of SPA-nav.
        const streamEarlyHead = [
          ...(options?.enableSpaNav ? [placeEarly()] : []),
          ...(options?.extraEarlyHead ?? []),
        ]
        const streamChunks = options?.enableSpaNav ? _getSharedChunkUrls() : []
        return renderDocument(body + tabsScript + dataScript, {
          ...(meta ? { meta } : {}),
          ...(stylesForDoc ? { styles: stylesForDoc } : {}),
          ...(streamEarlyHead.length > 0 ? { earlyHead: streamEarlyHead } : {}),
          ...(options?.bootstrap ? { bootstrap: options.bootstrap } : {}),
          ...(streamChunks.length > 0 ? { chunkPreloads: streamChunks } : {}),
        })
      }
      // Streaming-mode synchronous errors (caught at stream construction)
      // route to the dev overlay. Errors that fire mid-stream after the
      // headers + first chunk have flushed can't be recovered into a 500
      // — they surface in the partial body or terminate the stream.
      let stream: ReadableStream<Uint8Array>
      try {
        stream = renderToStream(view, {
          document: wrapDoc,
          ...(options?.scriptNonce ? { scriptNonce: options.scriptNonce } : {}),
        })
      } catch (e) {
        return renderRouteError(e, req, 'render')
      }
      // Stream consumption happens asynchronously after we return — the
      // outer try/finally would fire too early and dispose the server
      // caps before lazy view children evaluate. Take over disposal here:
      // capture the dispose closure, neutralize the outer finally, and
      // run it when the stream completes/cancels instead.
      const disposeOnStreamEnd = _disposeServerCaps
      _disposeServerCaps = () => {}
      const wrapped = new ReadableStream<Uint8Array>({
        async start(controller) {
          const reader = stream.getReader()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              controller.enqueue(value)
            }
            controller.close()
          } catch (err) {
            controller.error(err)
          } finally {
            disposeOnStreamEnd()
          }
        },
        cancel() {
          disposeOnStreamEnd()
        },
      })
      return new Response(wrapped, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          // Disable downstream buffering so the browser sees chunks as
          // they're emitted, not after the whole response is done.
          'Cache-Control': 'no-store',
          'X-Accel-Buffering': 'no',
          ...p.headers,
        },
      })
    }
    let body: string
    // T5-C + T6-B (race-safe scoping):
    //
    // BOTH the island collector AND the inline-style-attr collector are
    // module-level globals that get filled during `renderToString`.
    // `renderToString` is synchronous, so a single render reads + writes
    // a single global instance without interleaving. But the *previous*
    // architecture put `_beginInlineStyleCollection()` in the dispatch
    // handler — BEFORE `await renderPage(...)`. That await is where
    // concurrent requests interleave: request B can call its own
    // `_beginInlineStyleCollection()` between request A's begin and A's
    // synchronous render, silently overwriting A's collector. When
    // A's render then writes style hashes, they go into B's set; A's
    // response ships with B's CSP hashes (and vice versa).
    //
    // Pull both begin/end pairs HERE, *immediately* around
    // `renderToString` (which doesn't await), so the window between
    // begin and end can never see another request. The inline-style
    // hashes are computed in this function and shipped to the
    // dispatcher via a private response header (stripped before the
    // response leaves the framework boundary) — see the
    // `X-Place-Inline-Style-Hashes` handling in `_serveImpl`.
    const islandSet = _beginIslandCollection()
    const inlineStyles = _beginInlineStyleCollection()
    const collectedHeadings = _beginHeadingCollection()
    try {
      body = renderToString(view)
    } catch (e) {
      _endIslandCollection()
      _endInlineStyleCollection()
      _endHeadingCollection()
      return renderRouteError(e, req, 'render')
    }
    _endIslandCollection()
    _endInlineStyleCollection()
    _endHeadingCollection()
    // **Auto-title from first `<h1>`.** Content pages without an
    // explicit `meta.title` get their rendered `<h1>` text promoted to
    // the document title. The page author writes `<h1>Why place</h1>`
    // once and the framework wires the `<title>` AND any layout-level
    // `titleTemplate` substitution. This is the docs-shape happy path:
    // an article that just contains prose, no `meta:` block at all.
    //
    // Skip rules:
    //   - `meta.title` already set → respect the author's choice.
    //   - `meta.titleAbsolute === true` → the page explicitly wants its
    //     title used verbatim with no auto-derivation OR template
    //     substitution; honor that intent.
    //   - First-h1 text empty after trim → don't emit `<title></title>`.
    //
    // The auto-derived title still flows through `mergeMeta`'s template
    // resolution: a layout's `titleTemplate: '%s · my site'` wraps the
    // harvested h1 the same way it would wrap a hand-written title.
    if (!meta?.titleAbsolute && !meta?.title) {
      const harvested = _getFirstH1Text()
      if (harvested && harvested.length > 0) {
        meta = { ...(meta ?? {}), title: harvested }
      }
    }
    // **Auto-invoke each registered island's `ssrProps` resolver.**
    // Islands declare their own SSR-time contract (see
    // `IslandOptions.ssrProps` JSDoc) — when a resolver is set, the
    // framework calls it here with the rendered body, then merges the
    // result back into the marker via `rerenderIsland`. Apps don't
    // wire anything for this to fire: each island file owns its own
    // dependency on page output, like a typical effect-typed system
    // would. The toc island's heading-extraction is the motivating
    // case; the same primitive handles any island whose initial state
    // is derived from the rendered body (footnote backrefs, syntax-
    // highlight post-processing, comment-count summaries, …).
    //
    // **Ordering**: resolvers run in registry-iteration order, which
    // matches the order `island()` calls fire at module load. If one
    // resolver returns a new `body`, subsequent resolvers see it.
    // Per-island independence is the common case; cross-island body
    // chaining is supported but uncommon.
    //
    // **Errors**: a thrown resolver routes through `renderRouteError`
    // just like a render fault. Resolvers should stay synchronous and
    // pure (no I/O) per the JSDoc contract; failures are bugs.
    const islandRegistry = _getIslandRegistry()
    for (const [name, reg] of Object.entries(islandRegistry)) {
      if (!reg.ssrProps) continue
      try {
        const result = reg.ssrProps({
          body,
          headings: collectedHeadings,
          req,
          url,
        })
        if (result) {
          if (typeof result.body === 'string') {
            body = result.body
          }
          if (result.props && typeof result.props === 'object') {
            body = rerenderIsland(body, name, result.props as Record<string, unknown>)
          }
        }
      } catch (e) {
        return renderRouteError(e, req, 'render')
      }
    }
    // App-level `transformBody` hook — the low-level escape hatch for
    // post-render transforms that don't fit the per-island `ssrProps`
    // primitive above. Runs AFTER the islands' resolvers so resolvers
    // can be the structural primitive and `transformBody` the catch-
    // all. Errors here route through `renderRouteError` like any
    // render fault.
    if (options?.transformBody) {
      try {
        body = options.transformBody(body, { req, url })
      } catch (e) {
        return renderRouteError(e, req, 'render')
      }
    }
    // Resolve each used island's bundle URL via the registry. Per-
    // island fetch strategy depends on which `client=` strategies the
    // page's instances declared (see `_beginIslandCollection` JSDoc
    // for the full rationale):
    //
    //   - ANY strategy != 'interaction' → emit `<script type="module">`
    //     immediately, so the bundle is on the wire by first paint.
    //     This covers `load` (the default), `idle`, and `visible`.
    //
    //   - ALL strategies == 'interaction' → emit `<link rel="modulepreload">`
    //     (browser fetches at idle, doesn't execute) and add the bundle
    //     URL to `deferredIslandUrls`. The inline `placeDeferredIslands`
    //     runtime (emitted further below) attaches event listeners on
    //     matching markers and promotes the modulepreload to an executing
    //     `<script>` on first interaction. Since modulepreload already
    //     populated the cache, the promotion is an instant cache hit —
    //     zero added INP latency even on slow networks.
    //
    // Pages without any `interaction`-only islands behave identically
    // to before this change: every used island ships as a `<script>`.
    const islandScripts: string[] = []
    /** Deferred islands: name → bundle URL pairs. Stored as a tuple so
     *  the post-render marker patch can reference the name directly
     *  rather than parsing it back out of the (hash-suffixed) URL. */
    const deferredIslands: Array<{ readonly name: string; readonly url: string }> = []
    for (const [name, strategies] of islandSet) {
      const url = _getIslandBundleUrl(name)
      if (!url) continue
      const onlyInteraction = strategies.size === 1 && strategies.has('interaction')
      if (onlyInteraction) {
        deferredIslands.push({ name, url })
      } else {
        islandScripts.push(url)
      }
    }
    // T5-D phase 2: inline SPA-navigation runtime. Injected when the
    // app has `islands:` configured (serve() passes `enableSpaNav: true`).
    // The runtime intercepts <Link> clicks, fetches HTML, swaps <main>,
    // and dispatches `place:nav` so the router + every island re-syncs.
    // Adds ~600 B gzipped per page that's part of an islands app.
    //
    // Per-app `viewTransitions` flows in via `spaNavViewTransitions` so
    // the inline runtime can be either instant (default) or view-
    // transition-wrapped (~250 ms cross-fade) — baked into the bytes,
    // no runtime globals to coordinate.
    const spaNavScript = options?.enableSpaNav
      ? `<script${nonceAttr}>${placeSpaNav({
          viewTransitions: options?.spaNavViewTransitions === true,
          ...(options?.spaNavThemeClassMap ? { themeClassMap: options.spaNavThemeClassMap } : {}),
          ...(options?.spaNavPrefetch === false ? { prefetch: false } : {}),
        })}</script>`
      : ''
    // Inline tabs runtime — single delegated click handler shared by
    // every `<Tabs>` on the page.
    //
    // **Always-emit when SPA-nav is on.** The runtime MUST be attached
    // before the user can land on a page with tabs, otherwise:
    //   1. User loads page A (no Tabs) — tabs runtime not emitted
    //   2. SPA-nav to page B (has Tabs) — destination HTML has the
    //      tabs `<script>` inline, but DOMParser-parsed inline scripts
    //      are INERT (browsers don't execute scripts brought in via
    //      `innerHTML`/`replaceWith`/etc.). The tabs handler never
    //      attaches → clicks do nothing.
    //
    // The clean fix is to attach the runtime on EVERY page-with-SPA-nav
    // so it's available regardless of navigation path. The runtime itself
    // is flag-guarded (`window.__placeTabs`) so per-page repetition is a
    // no-op after the first attach. The flag-consume below (which fires
    // for telemetry / future per-route opt-outs) is decoupled from the
    // emit decision: we always emit while in islands-mode.
    _consumeTabsUsedFlag() // drain the flag; emission no longer gated on it
    const tabsScript = options?.enableSpaNav ? `<script${nonceAttr}>${placeTabs()}</script>` : ''
    // **Deferred-island runtime.** When the page contains any island
    // whose every instance uses `client="interaction"`, the bundle for
    // that island isn't emitted as a `<script>`; we emit a
    // `<link rel="modulepreload">` (cache-only, no execute) and let
    // the inline runtime promote it to an executing script on first
    // user trigger. This drops the critical-path fetch count without
    // INP regression: the modulepreload populates the browser's module
    // cache during idle network time, so the post-trigger script
    // append is an instant cache hit.
    //
    // Patch each deferred island's markers in the rendered body to
    // carry `data-place-deferred-url="<url>"` — that's what the inline
    // runtime walks. Island names are validated against
    // `[a-zA-Z0-9_-]+` by `validateIslandName`, so the name is safe to
    // embed in the regex without escaping.
    let deferredBody = body
    for (const { name, url } of deferredIslands) {
      const markerRe = new RegExp(`<div data-view="island" data-view-id="${name}"`, 'g')
      deferredBody = deferredBody.replace(
        markerRe,
        `<div data-view="island" data-view-id="${name}" data-place-deferred-url="${url}"`,
      )
    }
    const deferredScript =
      options?.enableSpaNav && deferredIslands.length > 0
        ? `<script${nonceAttr}>${placeDeferredIslands()}</script>`
        : ''
    // Dev-mode live-reload client. Inlined when `enableHmr` is set
    // (which `serve()` toggles based on NODE_ENV). The script opens a
    // WebSocket back to `/__place_hmr`; on reconnect-after-disconnect
    // it reloads the page so changes appear without manual refresh.
    // See `__hmr.ts` for the JSDoc on contract + lifecycle.
    const hmrScript = options?.enableHmr ? `<script${nonceAttr}>${placeHmr()}</script>` : ''
    // **Viewport reactivity runtime.** Always-emit in islands mode so
    // the `viewport.*` accessors get fresh width/height and prefers-*
    // values into their state cells on hydration. Mirrors the always-
    // emit reasoning for `placeTabs` — if a destination page is reached
    // via SPA-nav, its inline script tag is inert; the runtime needs
    // to be attached before navigation.
    const viewportScript = options?.enableSpaNav
      ? `<script${nonceAttr}>${placeViewport()}</script>`
      : ''
    // **Click-to-copy runtime.** Same always-emit reasoning as the
    // tabs script: if a destination page reached via SPA-nav has copy
    // buttons, its inline `<script>` tag is inert. The runtime is
    // emitted unconditionally in islands mode (regardless of whether
    // THIS render used copy buttons) so it's available on any
    // post-SPA-nav destination. Browser-side `__placeCopy` guard
    // makes per-render repetition a no-op after first install.
    _consumeCopyUsedFlag() // drain; emission no longer gated on it
    const copyScript = options?.enableSpaNav
      ? `<script${nonceAttr}>${placeCopyRuntime()}</script>`
      : ''
    // Early-head inline runtime: always emit in islands mode. Sets
    // `<html data-place-platform>` + `<html data-place-motion>` before
    // paint so platform/motion-conditional UI resolves correctly on
    // first paint without a post-hydration blip. App-supplied extras
    // (analytics consent, feature flags, locale direction, etc.) come
    // after the framework's built-ins so app code can read the
    // framework hints if it wants.
    // `placeEarly()` (platform / reduced-motion hints) rides with the
    // SPA-nav runtime. `extraEarlyHead` — the theme early-paint script
    // and any app `earlyHead` entries — must ship whenever it exists,
    // independent of SPA-nav: theme persistence + the `data-place-theme`
    // attribute a theme picker reads are needed on every page, including
    // pure content pages with no islands.
    const earlyHead = [
      ...(options?.enableSpaNav ? [placeEarly()] : []),
      ...(options?.extraEarlyHead ?? []),
    ]
    // Shared chunks → modulepreload in <head>. Lets the browser fetch
    // them in parallel with the HTML doc + island entries; without
    // this, chunks are discovered only after an island parses its
    // imports (~20-30 ms LCP cost on slow networks). Deferred-island
    // bundles ride the same channel — the browser fetches them at
    // idle priority alongside the chunks. By the time a user hovers /
    // focuses / clicks the matching marker, the bundle is in cache.
    const chunkPreloads = options?.enableSpaNav
      ? [..._getSharedChunkUrls(), ...deferredIslands.map((d) => d.url)]
      : []
    const html = renderDocument(
      deferredBody +
        spaNavScript +
        tabsScript +
        viewportScript +
        copyScript +
        deferredScript +
        hmrScript +
        dataScript,
      {
        ...(meta ? { meta } : {}),
        ...(stylesForDoc ? { styles: stylesForDoc } : {}),
        ...(earlyHead.length > 0 ? { earlyHead } : {}),
        ...(options?.bootstrap ? { bootstrap: options.bootstrap } : {}),
        ...(chunkPreloads.length > 0 ? { chunkPreloads } : {}),
        ...(islandScripts.length > 0 ? { extraScripts: islandScripts } : {}),
        ...(options?.scriptNonce ? { scriptNonce: options.scriptNonce } : {}),
        ...(options?.scriptIntegrity ? { scriptIntegrity: options.scriptIntegrity } : {}),
      },
    )
    // Compute SHA-256 of each unique inline `style="…"` value and ship the
    // hashes to the dispatcher via a *private* response header. The
    // dispatcher folds them into the response's CSP `style-src` (with
    // `'unsafe-hashes'`) and strips the header before the response
    // leaves the framework boundary. Comma-separated for compactness;
    // base64 strings don't contain `,` so the separator is unambiguous.
    // See INLINE_STYLE_HASHES_HEADER below for the constant.
    const inlineStyleHashList =
      inlineStyles.size > 0 ? await Promise.all([...inlineStyles].map(sha256Base64)) : []
    // Normalize `p.headers` (`HeadersInit`: `Headers | string[][] |
    // Record<string,string>`) into a plain object so the private
    // `X-Place-Inline-Style-Hashes` header can be appended uniformly.
    const responseHeaders: Record<string, string> = {
      'Content-Type': 'text/html; charset=utf-8',
    }
    if (p.headers) {
      new Headers(p.headers).forEach((v, k) => {
        responseHeaders[k] = v
      })
    }
    if (inlineStyleHashList.length > 0) {
      responseHeaders[INLINE_STYLE_HASHES_HEADER] = inlineStyleHashList.join(',')
    }
    return new Response(html, {
      status: 200,
      headers: responseHeaders,
    })
  } finally {
    _disposeServerCaps()
  }
}

// ===== Layout meta merging =====
//
// Layouts and the page each contribute a PageMeta. Merging rules:
//   - Scalar fields (title, description, themeColor, etc.) follow
//     last-write-wins — the page's value beats the layout's.
//   - `htmlClass` and `bodyClass` CONCATENATE — a root layout can set
//     `h-full` and a page can add `bg-bg text-fg` without one
//     overwriting the other.
//   - `keywords` (array) and `extra` (HeadEntry[]) CONCATENATE.
//   - `og` and `twitter` (objects) follow last-write-wins — the page
//     replaces the layout's entirely. Deep-merging would surprise more
//     often than help (a layout's og:image set to a default image is
//     usually intended to be REPLACED on a specific page, not retained).
/**
 * Resolve a page or layout's `meta` declaration to a `PageMeta` object.
 *
 * Supports three call-site shapes uniformly:
 *
 *   meta: 'My title'                       // string shorthand → { title }
 *   meta: { title: 'My title', og: { … } } // full object
 *   meta: (props) => '...' | { … }         // function returning either
 *
 * Returns `undefined` when the source is unset, an empty string, or the
 * function returns nullish — callers gate their `metas.push(...)` on
 * truthiness so an unset meta contributes nothing.
 */
export function resolveMeta(
  src: PageMeta | string | ((props: object) => PageMeta | string) | undefined,
  // biome-ignore lint/suspicious/noExplicitAny: meta callbacks receive the merged page/layout props
  props: any,
): PageMeta | undefined {
  if (src == null) return undefined
  const raw = typeof src === 'function' ? (src as (p: object) => PageMeta | string)(props) : src
  if (raw == null) return undefined
  if (typeof raw === 'string') return raw.length > 0 ? { title: raw } : undefined
  return raw
}

export function mergeMeta(metas: PageMeta[]): PageMeta {
  const out: PageMeta = {}
  const htmlClasses: string[] = []
  const bodyClasses: string[] = []
  const keywords: string[] = []
  const extra: NonNullable<PageMeta['extra']> = []
  for (const m of metas) {
    if (m.htmlClass) htmlClasses.push(m.htmlClass)
    if (m.bodyClass) bodyClasses.push(m.bodyClass)
    if (m.keywords) keywords.push(...m.keywords)
    if (m.extra) extra.push(...m.extra)
    // Last-write-wins for the rest. Spread but skip the special-case
    // fields above — we already collected them.
    for (const [key, value] of Object.entries(m)) {
      if (key === 'htmlClass' || key === 'bodyClass' || key === 'keywords' || key === 'extra') {
        continue
      }
      if (value !== undefined) (out as Record<string, unknown>)[key] = value
    }
  }
  if (htmlClasses.length > 0) out.htmlClass = htmlClasses.join(' ')
  if (bodyClasses.length > 0) out.bodyClass = bodyClasses.join(' ')
  if (keywords.length > 0) out.keywords = keywords
  if (extra.length > 0) out.extra = extra
  return out
}

// ===== Dev error overlay =====
// Extracted to ./error-overlay.ts. `renderRouteError` + `isProductionRuntime`
// are imported above (used by handler / page / layout / serve); the
// stack-frame parser surface is re-exported here for unit tests.
export { frameEditorHref, parseStackFrames, type StackFrame } from './error-overlay.ts'

// ===== Testing helpers =====
//
// `renderToHtml(page, opts?)` is the most common shape in unit tests:
// hand a Page, get back the rendered HTML string. Saves the
// `await renderPage(p, new Request(...)).text()` boilerplate.

export interface RenderToHtmlOptions {
  /** URL the synthetic Request should target. Default: `'http://localhost/'`. */
  url?: string
  /** Route params (for pages registered at `/users/:id`). Default: `{}`. */
  params?: Record<string, string>
  /** Per-test bootstrap script src (mostly omitted in tests). */
  bootstrap?: string
  /** Per-test CSP script nonce (only relevant when asserting nonce
   *  attributes appear on emitted scripts). */
  scriptNonce?: string
}

/**
 * Test helper: render a Page to its HTML string. Equivalent to
 * `await renderPage(p, new Request(opts.url), opts.params).text()` but
 * with sensible defaults for unit-testing.
 *
 * ```ts
 * const html = await renderToHtml(homePage, { url: 'http://x/?name=alice' })
 * expect(html).toContain('hello, alice')
 * ```
 */
export async function renderToHtml(p: AnyPage, opts: RenderToHtmlOptions = {}): Promise<string> {
  const req = new Request(opts.url ?? 'http://localhost/')
  const renderOpts: RenderPageOptions = {
    ...(opts.bootstrap !== undefined ? { bootstrap: opts.bootstrap } : {}),
    ...(opts.scriptNonce !== undefined ? { scriptNonce: opts.scriptNonce } : {}),
  }
  const res = await renderPage(p, req, opts.params ?? {}, renderOpts)
  return res.text()
}

// ===== component system — HOC / errorBoundary / keyed / For / ISR =====
// Extracted to ./component.ts (Tier 20 decomposition, cut 8). `index.ts`
// imports the shared `_registeredCaches` registry the serve()/cache
// path mutates + re-exports the public surface so `@place/component`
// consumers are unchanged. (`ErrorBoundaryCap` is already re-exported
// from the `_internal/` leaf above — not re-exported here, to avoid a
// double export.)
import { _registeredCaches } from './component.ts'

// `Provision` and `provide()` live in @place/capability — they're the
// fundamental "bind a cap to an impl" primitive. We re-export them from
// here so component consumers see a single import surface.
export { type Provision, provide } from '@place/capability'
// Re-export the reactivity primitives so apps don't need a second import
// root for state/watch/derived. Anything you reach for inside a component
// — `state`, `watch`, `derived`, `untrack`, `batch` — is now in the same
// package as `page`, `layout`, `component`, etc. Apps can still import
// directly from `@place/reactivity` if they prefer that scope.
export {
  type ArrayState,
  type BaseState,
  type BooleanState,
  batch,
  type Derived,
  type Disposer,
  derived,
  flush,
  type NarrowedMethods,
  type Resource,
  type ResourceOptions,
  type ResourceStatus,
  resource,
  type State,
  type StateOptions,
  state,
  untrack,
  type WatchOptions,
  watch,
} from '@place/reactivity'
// Copy-to-clipboard runtime — emitted by `renderPage` with the
// per-request CSP nonce so strict-CSP pages get the script
// executable. Components in `@place/design` (`<Copy>`, `<CodeBlock>`)
// just render the button + call `markCopyUsedOnThisRequest()`;
// emission is centralised here.
export { markCopyUsedOnThisRequest } from './__copy-runtime.ts'
export {
  type Action,
  type ActionDef,
  ActionError,
  type ActionSchema,
  action,
  fromStandard,
  isValidationFailure,
  resolveActionUrl,
  type ShapeField,
  type ShapeOf,
  type StandardSchemaV1,
  shape,
  type ValidationFailure,
} from './action.ts'
export {
  type App,
  type AppConfig,
  type AppOptions,
  app,
  type CapInstall,
  type RoutesOptions,
  routes,
} from './app.ts'
// `discoverPages(dir)` — async helper to import every `*.page.tsx`
// (plus subdir `index.ts`) under a directory and return a flat list
// of `Page` values. Use with top-level await in your app entry:
//
//   pages: await discoverPages('./src/pages')
//
// Does NOT derive route paths from file paths — each page's
// `page('/path', def)` declaration is the source of truth. See
// `discover-pages.ts` JSDoc for the full contract.
export { discoverPages } from './build/discover-pages.ts'
export {
  type BuildStaticOptions,
  type BuildStaticResult,
  buildStatic,
} from './build-static.ts'
export {
  type CacheEntry,
  type CacheOptions,
  type CacheStore,
  cache,
  memoryStore,
} from './cache.ts'
export {
  type ComponentOptions,
  clientOnly,
  component,
  type ErrorBoundaryProps,
  errorBoundary,
  For,
  type ForProps,
  isBrowserGlobalRef,
  keyed,
  revalidate,
} from './component.ts'
export { type FontOptions, type FontResult, font, fonts } from './font.ts'
// `<Form action={...}>` JSX helper for typed action() submission. See
// ./form.ts — works with JS (fetch+JSON) and without (form-encoded POST).
export { Form, type FormProps } from './form.ts'
export type { HtmlFactory } from './html-factories.ts'
// Tag-name typed factories live in `./html-factories.ts`; re-exported
// here so the public surface stays unchanged.
export {
  a,
  article,
  aside,
  audio,
  br,
  button,
  caption,
  code,
  dd,
  details,
  dialog,
  div,
  dl,
  dt,
  em,
  fieldset,
  footer,
  form,
  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  header,
  hr,
  input,
  label,
  legend,
  li,
  main,
  nav,
  ol,
  option,
  output,
  p,
  picture,
  pre,
  section,
  select,
  small,
  source,
  span,
  strong,
  summary,
  table,
  tbody,
  td,
  textarea,
  tfoot,
  th,
  thead,
  tr,
  ul,
  video,
} from './html-factories.ts'
// (`layout`, `Layout`, `LayoutDef`, `AnyLayout`, `isLayout` are exported
// inline at their definition site near `page()` — listed here only as a
// reminder of what's part of the public surface.)
export {
  type ContentHashedOptimizerOptions,
  contentHashedOptimizer,
  type ImageBackend,
  type ImageOptimizer,
  type ImageRequest,
  Img,
  type ImgProps,
  imageRoute,
  imgHtml,
  type OptimizedImage,
  passthroughOptimizer,
  type ResizeOpts,
  sharpBackend,
} from './img.ts'
// `<Link>` JSX helper for client-navigation through `RouterCap`. See
// ./link.ts — typed, accessible, reactive active-state.
export {
  type ExternalHref,
  Link,
  type LinkProps,
  type PlaceRoutes,
  type RouteKey,
} from './link.ts'
// Theme tokens — typed CSS-variable-based theming with SSR-safe theme
// selection. See ./theme.ts for the full story.
export {
  type ColorMode,
  type ColorModeMap,
  DEFAULT_THEME_COOKIE,
  readThemeFromRequest,
  setTheme,
  type ThemeMap,
  type ThemeOptions,
  type ThemeTokens,
  type ThemeTokensOptions,
  type TypographyOptions,
  type TypographyRole,
  type TypographyScaleRatio,
  theme,
  themeCookieHeader,
  themeEarlyScript,
  themeTokens,
} from './theme.ts'
// Viewport reactivity primitive (ADR 0034). One inline runtime, one
// reactive accessor namespace; consumers subscribe instead of each
// component wiring its own matchMedia/ResizeObserver.
export {
  type Breakpoint,
  configureViewport,
  type ViewportConfig,
  viewport,
} from './viewport.ts'
// `virtualList()` — windowed-render primitive for long lists (Round 6).
// Reactive `totalSize()` + `visible()` + imperative scroll/measure
// helpers. No hook-shape, no React baggage; ADR 0008.
export {
  type VirtualItem,
  type VirtualList,
  type VirtualListOptions,
  virtualList,
} from './virtual-list.ts'
