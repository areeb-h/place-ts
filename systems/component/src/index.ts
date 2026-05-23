/// <reference types="bun" />
// biome-ignore-all assist/source/organizeImports: documented re-export groupings (Phase 2.1 cut narrative) must stay in source order; auto-sort would scramble the structure
// @place-ts/component — rendering layer (Phase v0.2 minimum)
//
// Sits on top of @place-ts/reactivity. Components are functions from props to
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

import { type Disposer, type EffectBranded, untrack, watch } from '@place-ts/reactivity'

import { onCleanup } from './_internal/cleanup.ts'
import { _isHydratedSignal as _isHydratedState } from './_internal/hydration.ts'

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
export {
  type CookieStateOptions,
  cookie,
  cookieState,
  parseCookieHeader,
  setCookie,
} from './cookies.ts'
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
function _onMount(fn: () => (() => void) | undefined): void {
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
// rendering core. `index.ts` re-exports the public surface (`el`, the
// heading-collection helpers); see the `export {}` block below.

export type { SsrHeading } from './element.ts'
// Re-export the public element surface so `@place-ts/component` and every
// in-package importer keep seeing these names on the barrel.
export { _beginHeadingCollection, _endHeadingCollection, _getFirstH1Text, el } from './element.ts'

// Dev error overlay — `renderRouteError` is used by `renderPage`'s
// per-route catch. (Terminal logging moved to ./serve.ts.)
// `ErrorBoundaryCap` / `currentInlineStyleSet` are exported from this
// barrel for ./element.ts + ./mount.ts during the decomposition
// (function-level cycles — see those files). Later cuts re-home them
// to their own modules; the exports become internal then.
// ===== Client mount machinery + Fragment + Tabs =====
// Extracted to ./mount.ts (Tier 20 decomposition, cut 4). `index.ts`
// re-exports the public surface so every consumer of
// `@place-ts/component` keeps seeing these names on the barrel.

// Escape helper used by meta + island serialization (the SSR emitter's
// own escaping moved to element.ts).

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
// public surface so `@place-ts/component` consumers are unchanged.

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

// ===== serverRouter — METHOD + path pattern → handler dispatch =====
// Extracted to ./server-router.ts (audit Phase 2.1, Cut 1b). Re-exported
// for public consumers. (`RouteHandler` is consumed internally by
// ./serve.ts, which imports it from server-router.ts directly.)
export { type RouteHandler, type ServerRouter, serverRouter } from './server-router.ts'

// ===== T5-C — Islands primitive (ADR 0019) =====
// Extracted to ./islands.ts (Tier 20 decomposition, cut 6). `index.ts`
// re-exports the public surface (`island`, `Island`) and the
// `_`-prefixed registry hooks the build modules + test-internal
// barrel need.
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
// view() — unified hydration factory (ADR 0030 Phase 1). The public
// successor to island(); same author shape, opt-in `level` option to
// unlock L0 static emit (zero per-island JS for pure components).
// island() remains exported as a deprecated alias.
export { view, type ViewLevel, type ViewOptions } from './view.ts'

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

// ===== page / layout / handler authoring API =====
// Extracted to ./page.ts (Tier 20 decomposition, cut 7). `index.ts`
// imports the symbols `renderPage` (still in this barrel) composes
// with + re-exports the public surface so `@place-ts/component`
// consumers are unchanged.
import type { AnyPage, RenderPageOptions } from './page.ts'

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
  redirect,
  type RenderPageOptions,
  type SlotFills,
  temporaryRedirect,
  useSearch,
} from './page.ts'

// ===== serve() orchestrator — NOT re-exported here =====
// `serve` / `app` / `routes` / `buildStatic` / `discoverPages` + the
// security-header presets live behind `@place-ts/component/server` ONLY
// (Tier 20 entrypoint split — full isolation). The root barrel does
// not re-export them, so a client/island bundle that imports
// `@place-ts/component` never graphs `./serve.ts` and therefore never
// reaches `Bun.serve` / `Bun.build` / `node:*`. The boundary is an
// impossible import graph, not a `__PLACE_BROWSER__` dead-branch.
// `renderPage` / `renderToString` / `handler` / `action` ARE node-free
// and stay on this barrel — see the re-exports above and below.

// ===== renderPage — per-request SSR assembly =====
// Extracted to ./render-page.ts (Tier 20 decomposition, cut 10). The
// barrel imports it for the `renderToHtml` test helper + re-exports
// it for `serve.ts` and external consumers (e.g. `build-static.ts`).
import { renderPage } from './render-page.ts'

// ===== Dev error overlay =====
// Extracted to ./error-overlay.ts. `renderRouteError` + `isProductionRuntime`
// are imported above (used by handler / page / layout / serve); the
// stack-frame parser surface is re-exported here for unit tests.
export { frameEditorHref, parseStackFrames, type StackFrame } from './error-overlay.ts'
export { renderPage } from './render-page.ts'

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
// re-exports the public surface so `@place-ts/component` consumers are
// unchanged. (`ErrorBoundaryCap` is already re-exported from the
// `_internal/` leaf above — not re-exported here, to avoid a double
// export.)

// `Provision` and `provide()` live in @place-ts/capability — they're the
// fundamental "bind a cap to an impl" primitive. We re-export them from
// here so component consumers see a single import surface.
export { type Provision, provide } from '@place-ts/capability'
// Re-export the reactivity primitives so apps don't need a second import
// root for state/watch/derived. Anything you reach for inside a component
// — `state`, `watch`, `derived`, `untrack`, `batch` — is now in the same
// package as `page`, `layout`, `component`, etc. Apps can still import
// directly from `@place-ts/reactivity` if they prefer that scope.
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
} from '@place-ts/reactivity'
// Copy-to-clipboard runtime — emitted by `renderPage` with the
// per-request CSP nonce so strict-CSP pages get the script
// executable. Components in `@place-ts/design` (`<Copy>`, `<CodeBlock>`)
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
// `app` / `routes` / `discoverPages` / `buildStatic` are server-only
// (they reach `Bun.serve` / `Bun.build` / `node:fs`) — re-exported
// from `@place-ts/component/server`, not from this root barrel.
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
// `font` is exported as a namespace: `font(...)` for self-hosted
// @font-face declarations, `font.google(family, opts)` for Google
// Fonts (download-once-at-boot, self-hosted from a framework route).
// `fonts(...)` combines multiple `font(...)` results.
import { font as _fontFace } from './font.ts'
import { googleFont as _googleFont } from './font-google.ts'
export const font = Object.assign(_fontFace, { google: _googleFont })
export { type FontOptions, type FontResult, fonts } from './font.ts'
export {
  combineResolvedFonts,
  type GoogleFontDescriptor,
  type GoogleFontOptions,
  googleFont,
  isGoogleFontDescriptor,
  type ResolvedGoogleFont,
  resolveGoogleFont,
} from './font-google.ts'
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
// `useRouter()` — public hook over the routing system's `RouterCap`.
// Re-exported from `@place-ts/routing` so authors can pull the common
// reactive APIs from one place (parallel to how `useTheme()` is here).
export { useRouter } from '@place-ts/routing'
// Theme tokens — typed CSS-variable-based theming with SSR-safe theme
// selection. See ./theme.ts for the full story.
export {
  type ColorMode,
  type ColorModeMap,
  DEFAULT_THEME_COOKIE,
  type PlaceThemeWindowStash,
  readThemeFromRequest,
  setTheme,
  type ThemeApi,
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
  useTheme,
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
