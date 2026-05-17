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

import {
  ClientOnlyAbort,
  defineCapability,
  runWithCapabilityScope,
} from '../../capability/src/index.ts'
import {
  batch,
  type Disposer,
  type EffectBranded,
  type State,
  state,
  untrack,
  watch,
} from '../../reactivity/src/index.ts'
import {
  type ParamsOf,
  RouterCap,
  route,
  serverRouter as createServerRouter,
} from '../../routing/src/index.ts'
import { action } from './action.ts'
import { placeAutoImport } from './auto-import-plugin.ts'
// `validateIslandName` is inlined here (instead of imported from
// `./island-validation.ts`) so Bun's chunk-splitter doesn't hoist
// this small utility into its own ~1.4 KB shared chunk. Pre-inline:
// every page paid an extra roundtrip waiting on a sub-2 KB chunk
// during the critical path. Post-inline: the bytes bundle into the
// framework runtime chunk and the leaf-fetch count drops by one.
// The bundler (`island-bundler.ts`) keeps its own copy server-side.
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
// `buildIslandBundles` + `buildRouteSplitBundles` are dynamic-imported
// inside `_serveImpl` (the server-gated body) so the static import
// graph never pulls them — and their `node:path` dep — into per-route
// or per-island client bundles. Discovered by T5-E audit: a 26 KB
// island bundle was carrying ~4.5 KB of `node:path` polyfill purely
// because the framework barrel statically imported the bundler.
import type {
  buildIslandBundles as BuildIslandBundlesFn,
  ClientCapInstall,
  renderViewManifestReport as BuildRenderViewManifestReportFn,
} from './build/island-bundler.ts'
import type { buildRouteSplitBundles as BuildRouteSplitBundlesFn } from './build/route-splitter.ts'

export type { ClientCapInstall }
import { _invalidateCachesByTag, type CacheEntry, type CacheStore } from './cache.ts'
import { _CookieJarCap, parseCookieHeader } from './cookies.ts'
import { disposeAll, onCleanup, withCleanups } from './_internal/cleanup.ts'
import {
  _auditHydrationFrame,
  _flushHydrationDeltas,
  _isHydratedSignal as _isHydratedState,
  _setHydrated,
} from './_internal/hydration.ts'
import { readThemeFromRequest } from './theme.ts'

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

import { cookieState } from './cookies.ts'
export { cookie, type CookieStateOptions, cookieState, parseCookieHeader } from './cookies.ts'
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
  wire,
  type WiredBoolean,
  type WiredNumber,
  type WiredText,
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
import type { Child, Children, ElementProps, View } from './types.ts'

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

// `makeSlot` lives in `./_internal/slot.ts` so the public `hydrate()`
// entry can live in the client-mount leaf without dragging the
// framework barrel through Bun's static-import graph (see the
// `_client-mount.ts` header for the full rationale on why the leaf
// exists). Internal callers in this file — the element factory's
// `hydrate` method — still need `makeSlot` directly.
import { makeSlot } from './_internal/slot.ts'

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

// ===== Generic element factory =====
//
// Three call forms:
//   el('div')                        — no props, no children
//   el('div', { class: 'x' })        — props only (JSX runtime path)
//   el('div', 'text')                — child only (no props)
//   el('div', { class: 'x' }, 'text', span(), () => count.read())
//                                    — props + variadic children
//
// The first arg after `tag` is treated as props if it's a plain object
// (not null, not an array, no .mount method). Anything else, plus all
// remaining args, are children.

type ElementArg = ElementProps | Child | Child[]

function isProps(x: ElementArg): x is ElementProps {
  return x != null && typeof x === 'object' && !Array.isArray(x) && !('mount' in x)
}

export function el(tag: string, ...args: ElementArg[]): View {
  let props: ElementProps = {}
  let rest: ElementArg[] = args

  if (args.length > 0 && isProps(args[0] as ElementArg)) {
    props = args[0] as ElementProps
    rest = args.slice(1)
  }

  if (rest.length > 0) {
    const existing = props.children
    const existingArr: Child[] =
      existing === undefined ? [] : Array.isArray(existing) ? existing : [existing]
    const flattened: Child[] = []
    for (const arg of rest) {
      if (Array.isArray(arg)) flattened.push(...(arg as Child[]))
      else flattened.push(arg as Child)
    }
    props = { ...props, children: [...existingArr, ...flattened] }
  }

  return makeView(tag, props)
}

// ===== String emitter (SSR + hydration markers) =====
//
// Each `el(tag, props)` View knows how to render itself to an HTML
// string without touching the DOM. The string emitter:
//   - HTML-escapes attribute values and text children (XSS safety)
//   - emits boolean attrs as bare attribute names
//   - skips null/false/undefined attrs entirely
//   - resolves reactive prop functions ONCE for their initial value
//   - recurses into children (string / function / View / array)
//   - emits self-closing tags without a closing pair
//   - tags each element with `data-h="<seq>"` for hydration matching
//
// The seq counter is a process-global (`hydrationSeq`); `renderToString`
// resets it before each call so markers are 0-based per render. Since
// rendering is synchronous and Bun is single-threaded, no isolation
// issue at the runtime level.

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

// Escape helpers extracted to ./utils/escape.ts (audit Phase 2.1, Cut 1d).
// Imported here for the SSR string emitter; meta.ts imports them directly.
import { escapeHtmlAttr, escapeHtmlAttrFull, escapeHtmlText } from './utils/escape.ts'

let hydrationSeq = 0
const resetHydrationSeq = (): void => {
  hydrationSeq = 0
}
const nextHydrationId = (): number => hydrationSeq++

// ============================================================
// Per-render heading collector (auto-anchors h2/h3 in <main>).
// ============================================================
//
// **Why this lives in the element factory, not as a post-render
// regex pass.** `extractMainHeadings()` used to scan rendered HTML
// with regex to find h2/h3 inside `<main>`, slug their text, and
// inject `id="…"` attrs into the output string. That works but it's
// a workaround — parsing the framework's own output instead of
// observing the render. Edge cases (entities in text, nested tags,
// custom main-like containers) need bespoke handling per scanner.
//
// The structural answer is to track headings AS THEY'RE RENDERED.
// `elementToHtml` is the chokepoint where every JSX element gets
// serialized; it already has the tag + props + children in typed
// form. We:
//
//   1. Increment `currentMainDepth` when emitting `<main>`,
//      decrement after its children are rendered.
//   2. When emitting `<h2>` / `<h3>` inside `<main>` while a
//      collector scope is active, extract the heading text from its
//      children (typed-tree walk, not regex), slug it, dedupe, and
//      inject `id="…"` into the element's attrs before serialization.
//      Push `{ id, text, level }` onto the collector.
//   3. Islands declaring `ssrProps` receive `ctx.headings` directly —
//      no string parsing, no second-pass extraction.
//
// **Scope.** The collector is scoped per-render via
// `_beginHeadingCollection()` / `_endHeadingCollection()` (paired
// around `renderToString(view)` in `renderPage`). Concurrent SSR
// renders are serialized through `renderToString`'s synchronous body,
// so the module-level cursor is safe.

/** One heading collected during render. Stable across server + client
 *  (same slug algorithm; the framework's `el()` injects the id at
 *  SSR time so the hydrated DOM matches). */
export interface SsrHeading {
  readonly id: string
  readonly text: string
  readonly level: 2 | 3
}

let currentHeadingCollector: SsrHeading[] | null = null
let currentHeadingIds: Set<string> | null = null
let currentMainDepth = 0
/**
 * Side-channel: text of the first `<h1>` encountered inside `<main>`
 * during a render. Captured separately from `SsrHeading[]` because h1
 * is the article *title* (consumed for auto `<title>`), while h2/h3
 * are TOC navigation entries (consumed by the toc island's `ssrProps`).
 * Mixing them in one array would force every consumer to filter by
 * level — a leakier contract than two single-purpose channels.
 */
let currentFirstH1Text: string | null = null

/**
 * Begin collecting h2/h3 headings inside `<main>` during the next
 * render. The framework calls this immediately before
 * `renderToString(view)` in `renderPage`; islands declaring
 * `ssrProps` receive the populated list via `ctx.headings`.
 *
 * Pure synchronous helper — the collector is module-scoped and the
 * render between begin/end is synchronous, so no concurrent
 * interleaving is possible.
 */
export function _beginHeadingCollection(): SsrHeading[] {
  const arr: SsrHeading[] = []
  currentHeadingCollector = arr
  currentHeadingIds = new Set()
  currentMainDepth = 0
  currentFirstH1Text = null
  return arr
}

/** End the heading collection scope. */
export function _endHeadingCollection(): void {
  currentHeadingCollector = null
  currentHeadingIds = null
  currentMainDepth = 0
  // currentFirstH1Text deliberately NOT cleared here — `renderPage`
  // reads it via `_getFirstH1Text()` AFTER `_endHeadingCollection()`.
  // It's reset on the next `_beginHeadingCollection()`.
}

/**
 * Read the first `<h1>` text captured during the most recent
 * heading-collection scope. Returns `null` when no h1 was rendered
 * inside `<main>`. Used by `renderPage` for auto-title derivation.
 */
export function _getFirstH1Text(): string | null {
  return currentFirstH1Text
}

/**
 * Slugify heading text into a stable `[a-z0-9-]+` id. Same algorithm
 * the toc island uses on the client when re-scanning after SPA-nav,
 * so server + client agree on every anchor href.
 */
function slugifyHeadingText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Extract plain text from a Child tree. Walks the same shapes
 * `childToHtml` walks (strings, numbers, function children, arrays,
 * Views) but returns just the visible text content — no tags, no
 * attributes. Used to derive heading text for slug generation.
 */
function childToText(child: Child): string {
  if (child == null || child === false || child === true) return ''
  if (typeof child === 'string') return child
  if (typeof child === 'number') return String(child)
  if (typeof child === 'function') {
    return childToText(untrack(() => (child as () => Child)()))
  }
  if (Array.isArray(child)) {
    let out = ''
    for (const c of child) out += childToText(c as Child)
    return out
  }
  // Views: render to HTML and strip tags. Cheaper than re-walking
  // the View's children directly (we'd need a typed accessor), and
  // headings rarely contain Views that don't toHtml.
  if (child.toHtml) {
    return child.toHtml().replace(/<[^>]*>/g, '')
  }
  return ''
}

// Render a Child to an HTML string. Recurses through nested arrays and
// resolves function children via `untrack` (so we don't leak watch
// subscriptions into the surrounding scope when this is called from a
// reactive context).
function childToHtml(child: Child): string {
  if (child == null || child === false || child === true) return ''
  if (typeof child === 'string') return escapeHtmlText(child)
  if (typeof child === 'number') return escapeHtmlText(String(child))
  if (typeof child === 'function') {
    const resolved = untrack(() => (child as () => Child)())
    return childToHtml(resolved)
  }
  if (Array.isArray(child)) {
    let out = ''
    for (const c of child) out += childToHtml(c as Child)
    return out
  }
  // Must be a View. Use toHtml if available; fall back to a safety
  // marker so missing implementations are visible during testing.
  if (child.toHtml) return child.toHtml()
  // No string emitter — best we can do is omit the View. Mount-path
  // SSR (the happy-dom fallback in renderToString) will still render
  // it; this branch only fires if someone calls toHtml() directly on
  // a parent containing a View without toHtml.
  return ''
}

function elementToHtml(tag: string, props: ElementProps): string {
  const id = nextHydrationId()
  let attrs = ` data-h="${id}"`
  // Track `<main>` nesting depth so the heading collector below can
  // scope itself to "h2/h3 inside main". Increment BEFORE children
  // are rendered (heading children are processed recursively inside
  // childToHtml below, which fires while we're still on this stack
  // frame). The matching decrement is at function exit via the
  // `try/finally` shape — kept implicit via a guard at the bottom
  // since `elementToHtml` has multiple return points.
  const enteringMain = tag === 'main'
  if (enteringMain) currentMainDepth++
  let childrenHtml = ''
  // Directive props fold into the base `class` / `style` attributes on
  // SSR so the rendered HTML matches what the client would compute on
  // mount. Without this, `class:active={cond}` would emit a literal
  // `class:active` attribute and the active state would only stamp in
  // after hydration — a visible flicker on hard refresh.
  let classFromBase: string | undefined
  const classDirectives: string[] = []
  let styleFromBase: string | undefined
  const styleDirectivePairs: string[] = []
  for (const [key, raw] of Object.entries(props)) {
    if (key === 'children' || key === 'ref') continue
    // Resolve reactive prop fns ONCE for the snapshot at render time.
    // Untrack so we don't accidentally subscribe a parent watch.
    const isReactive = !isEventProp(key) && typeof raw === 'function'
    const value = isReactive ? untrack(() => (raw as () => unknown)()) : raw
    if (isEventProp(key)) continue // event listeners don't render to HTML
    if (key.includes(':')) {
      const colonIdx = key.indexOf(':')
      const prefix = key.slice(0, colonIdx)
      const rest = key.slice(colonIdx + 1)
      // `bind:` and `use:` are runtime-only — no HTML rendering. They
      // attach on the client during hydrate/mount.
      if (prefix === 'bind' || prefix === 'use') continue
      if (prefix === 'class') {
        if (value) classDirectives.push(rest)
        continue
      }
      if (prefix === 'style') {
        if (value === null || value === undefined || value === false) continue
        // Reactive `style:propname={fn}` — skip SSR emission so the
        // CSP-safe runtime path (setProperty) is the sole writer
        // (ADR 0014). Two reasons not to emit the snapshot at SSR:
        //   (1) it forces every page to declare a hash for that
        //       per-request value in style-src, and during SPA-nav the
        //       PREVIOUS page's CSP is still live, so a destination's
        //       fresh inline-style value gets blocked by the source's
        //       CSP that never saw it (T6 user-reported bug).
        //   (2) once the island hydrates, setProperty overwrites the
        //       SSR'd value anyway — so the inline attr is wasted
        //       bytes + a CSP liability rather than a real first-paint
        //       win.
        // Static (string-shape) `style:propname={"value"}` continues
        // to emit normally — those are deterministic per-route and the
        // CSP hash collector covers them.
        if (isReactive) continue
        const kebab = rest.includes('-')
          ? rest
          : rest.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
        styleDirectivePairs.push(`${kebab}:${String(value)};`)
        continue
      }
      // Unknown prefix — fall through to the standard attribute path.
    }
    if (value == null || value === false) continue
    if (value === true) {
      attrs += ` ${key}`
      continue
    }
    if (key === 'class' || key === 'className') {
      classFromBase = String(value)
      continue
    }
    // Reactive `style={() => …}` — same skip rationale as `style:propname`
    // above: the runtime applies via setProperty on hydrate, and
    // skipping the SSR snapshot keeps strict CSP intact under SPA-nav.
    // Authoring guidance: use `style:propname={fn}` for individual
    // custom-property writes — it's the typed/discoverable form and
    // tree-shakes cleanly into a single setProperty call.
    if (key === 'style' && isReactive) continue
    if (key === 'style' && typeof value === 'object') {
      // Serialize style object as inline CSS. Keys are camelCase →
      // kebab-case ('backgroundColor' → 'background-color').
      let css = ''
      for (const [k, v] of Object.entries(value)) {
        if (v == null || v === false) continue
        const kebab = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
        css += `${kebab}:${String(v)};`
      }
      if (css) styleFromBase = css
      continue
    }
    if (key === 'style') {
      styleFromBase = String(value)
      continue
    }
    attrs += ` ${key}="${escapeHtmlAttr(String(value))}"`
  }
  // Emit merged class / style attributes after the directive walk so
  // their final shape reflects every contributor.
  const classMerged = [classFromBase ?? '', ...classDirectives].filter(Boolean).join(' ')
  if (classMerged) attrs += ` class="${escapeHtmlAttr(classMerged)}"`
  const styleMerged = (styleFromBase ?? '') + styleDirectivePairs.join('')
  if (styleMerged) {
    attrs += ` style="${escapeHtmlAttr(styleMerged)}"`
    // T6-B: record the literal style-attribute value so the dispatcher
    // can add `'sha256-<hash>'` to CSP `style-src` (paired with
    // `'unsafe-hashes'`). The browser hashes the *attribute value* —
    // pre-escape — so we collect the raw `styleMerged`, not the HTML-
    // attr-escaped form.
    if (currentInlineStyleSet !== null) currentInlineStyleSet.add(styleMerged)
  }
  // **Heading auto-id (h2/h3 inside main) + auto-title (first h1
  // inside main).** Inject `id="…"` BEFORE children are rendered,
  // then collect after we know the final text. Honors a manually-set
  // `id=` (the regex below probes `attrs` which already absorbed it
  // from the user's props), so author intent wins. Outside main, or
  // with no active collector, this is a no-op.
  const isCollectableHeading =
    currentHeadingCollector !== null &&
    currentMainDepth > 0 &&
    (tag === 'h2' || tag === 'h3')
  const isCollectableH1 =
    currentHeadingCollector !== null &&
    currentMainDepth > 0 &&
    tag === 'h1' &&
    currentFirstH1Text === null
  // Render children first to know the heading text. Headings should
  // be small (a single line of text + optional inline code), so the
  // double-walk (text + html) is O(N) on tiny strings.
  if (props.children !== undefined) {
    childrenHtml = childToHtml(props.children as Child)
  }
  if (isCollectableH1) {
    const text = childToText(props.children as Child).trim()
    if (text) currentFirstH1Text = text
  }
  if (isCollectableHeading) {
    const existingIdMatch = attrs.match(/\sid="([^"]+)"/)
    const text = childToText(props.children as Child).trim()
    if (text) {
      const base = existingIdMatch
        ? (existingIdMatch[1] as string)
        : slugifyHeadingText(text)
      if (base) {
        let finalId = base
        let n = 2
        const seen = currentHeadingIds as Set<string>
        while (seen.has(finalId)) {
          finalId = `${base}-${n}`
          n++
        }
        seen.add(finalId)
        ;(currentHeadingCollector as SsrHeading[]).push({
          id: finalId,
          text,
          level: tag === 'h2' ? 2 : 3,
        })
        // Inject the id if the author didn't set one. If they did,
        // attrs already contains it — leave alone.
        if (!existingIdMatch) {
          attrs += ` id="${escapeHtmlAttr(finalId)}"`
        }
      }
    }
  }
  // Decrement main-depth on exit. Since `elementToHtml` has multiple
  // return points (void elements vs. paired tags), this needs to fire
  // before either branch returns.
  if (enteringMain) currentMainDepth--
  if (VOID_ELEMENTS.has(tag)) {
    return `<${tag}${attrs}>`
  }
  return `<${tag}${attrs}>${childrenHtml}</${tag}>`
}

function makeView(tag: string, props: ElementProps): View {
  return {
    toHtml: () => elementToHtml(tag, props),
    // Adopt an existing element rendered by SSR. The slot points at the
    // parent's child cursor; we consume the next element and require a
    // tag match. Attach props (event listeners + reactive bindings) to
    // the EXISTING node — no DOM creation, no insertion.
    //
    // Children handling:
    //   - If ALL children are hydratable Views (the common nested-element
    //     case), recurse via a child-slot — element identity is preserved
    //     down the tree.
    //   - If any child is text/function/static (mixed content like
    //     `['hi, ', () => name, '!']`), fall back to clear + remount.
    //     Text-node boundaries can't be recovered from the merged
    //     content the browser parsed, so adoption isn't safe; remount is.
    hydrate(slot) {
      const node = slot.nextElement()
      // `<noscript>` is special: browsers with JS enabled parse its
      // content as ONE text node rather than as a real element tree.
      // Walking it the normal way desyncs the hydration cursor against
      // the data-h markers the SSR'd children carry. Consume the slot
      // for the noscript element itself and stop — the children are
      // SSR-only fallback content; they don't participate in hydration
      // and the framework runs nothing inside them once JS is live.
      if (tag === 'noscript') {
        if (node !== null) node.removeAttribute('data-h')
        return () => {}
      }
      if (node === null || node.tagName.toLowerCase() !== tag) {
        // Diagnostic-rich error: list the most common causes in plain
        // language, in priority order. The single most common gotcha
        // (root parameter confusion) is named explicitly because every
        // user hits it at least once.
        const got = node === null ? 'no element' : `<${node.tagName.toLowerCase()}>`
        const remaining =
          node === null
            ? ''
            : (() => {
                const sibs: string[] = []
                let n: Element | null = node
                while (n) {
                  sibs.push(n.tagName.toLowerCase())
                  n = n.nextElementSibling
                }
                return sibs.length > 1 ? ` (followed by <${sibs.slice(1).join('>, <')}>)` : ''
              })()
        throw new Error(
          `hydrate: expected <${tag}> but found ${got}${remaining}.\n\n` +
            'Most common causes:\n' +
            "  1. The `root` argument is the SSR'd element itself, not its parent.\n" +
            "     hydrate(view, root) walks `root.children` looking for the View's\n" +
            '     outermost element — pass the CONTAINER (e.g. document.body), not\n' +
            "     the SSR'd element.\n" +
            '  2. The View on the client differs from what the server rendered.\n' +
            '     Both sides must construct the same JSX with the same props (use\n' +
            '     URL-driven state via urlState() to ensure they converge).\n' +
            '  3. The HTML was modified between SSR and hydrate (a browser\n' +
            '     extension, an inline script before bootstrap, etc.).',
        )
      }
      const cleanups: Disposer[] = []
      // Dev-only hydration audit — compare props (what the client would
      // render) against the SSR'd DOM attributes (what the server
      // emitted) BEFORE applyProp mutates them. Production builds with
      // NODE_ENV='production' dead-code-eliminate this branch.
      if (
        typeof process !== 'undefined' &&
        process.env &&
        process.env['NODE_ENV'] !== 'production'
      ) {
        _auditHydrationFrame(node, props as Record<string, unknown>)
      }
      try {
        withCleanups(cleanups, () => {
          for (const [key, value] of Object.entries(props)) {
            if (key === 'children' || key === 'ref') continue
            applyProp(node as HTMLElement, key, value, cleanups)
          }
          if (props.ref) props.ref(node as HTMLElement)
          if (props.children !== undefined) {
            const list: Child[] = Array.isArray(props.children)
              ? (props.children as Child[])
              : [props.children as Child]
            const allHydratableViews = list.every(
              (c) => c != null && typeof c === 'object' && 'mount' in c && 'hydrate' in c,
            )
            if (allHydratableViews && list.length > 0) {
              // Walk via slot — preserves nested element identity.
              const childSlot = makeSlot(node)
              for (const child of list) {
                cleanups.push((child as View).hydrate?.(childSlot) ?? (() => {}))
              }
            } else {
              // Mixed / text / function children — clear + remount.
              while (node.firstChild) node.removeChild(node.firstChild)
              mountChildren(node, props.children, null, cleanups)
            }
          }
        })
      } catch (e) {
        disposeAll(cleanups)
        const handler = ErrorBoundaryCap.tryUse()
        if (handler === null) throw e
        handler(e)
        return () => {}
      }
      // Strip the SSR marker — page DOM should be clean post-hydration.
      node.removeAttribute('data-h')
      return () => disposeAll(cleanups)
    },
    mount(parent, anchor) {
      const node = document.createElement(tag)
      const cleanups: Disposer[] = []

      // If anything inside throws (a reactive prop's initial run, a
      // ref callback, a child's mount), we MUST run any cleanups that
      // accumulated before the throw — otherwise event listeners +
      // reactive watches we registered leak forever, attached to a
      // node that never made it into the DOM. We also bubble to the
      // nearest errorBoundary so consumers can render a fallback (the
      // same catch-and-route pattern the component HOC uses).
      try {
        withCleanups(cleanups, () => {
          for (const [key, value] of Object.entries(props)) {
            if (key === 'children' || key === 'ref') continue
            applyProp(node, key, value, cleanups)
          }
          if (props.ref) props.ref(node)
          if (props.children !== undefined) {
            mountChildren(node, props.children, null, cleanups)
          }
        })
      } catch (e) {
        disposeAll(cleanups)
        const handler = ErrorBoundaryCap.tryUse()
        if (handler === null) throw e
        handler(e)
        return () => {}
      }

      parent.insertBefore(node, anchor ?? null)

      return () => {
        disposeAll(cleanups)
        node.remove()
      }
    },
  }
}

function applyProp(node: HTMLElement, key: string, value: unknown, cleanups: Disposer[]): void {
  if (isEventProp(key)) {
    const event = key.slice(2).toLowerCase()
    if (typeof value === 'function') {
      const handler = value as EventListener
      // Capture the active error boundary AT MOUNT TIME so that throws
      // from the handler route to the same boundary that wrapped this
      // subtree — not to whichever cap happens to be installed when
      // the event fires (which may be a sibling subtree's cap, or none
      // if mount has fully unwound). When no boundary is installed,
      // skip the wrap entirely so the listener has zero overhead.
      //
      // **Auto-batch synchronous state writes inside the handler.** A
      // single click that writes 5 states would otherwise notify each
      // dependent watch 5 times even if all 5 watches read all 5 states
      // (worst case: 25 fires; expected: 1). Wrapping in `batch()`
      // coalesces the notifications — synchronous writes inside the
      // handler all flush together once the handler returns. Solid
      // does this in `createEffect`; React batches event handlers
      // since React 17. We were the only signal-based framework in
      // the survey making users remember `batch()` by hand.
      const boundary = ErrorBoundaryCap.tryUse()
      const wrapped: EventListener =
        boundary === null
          ? (event_) => {
              batch(() => handler(event_))
            }
          : (event_) => {
              try {
                batch(() => handler(event_))
              } catch (err) {
                boundary(err)
              }
            }
      node.addEventListener(event, wrapped)
      cleanups.push(() => node.removeEventListener(event, wrapped))
    }
    return
  }

  // Directive props: `class:foo`, `style:color`, `bind:value`, `use:action`.
  // Each form has its own dispatch. See ./directives.ts.
  if (key.includes(':')) {
    const colonIdx = key.indexOf(':')
    const prefix = key.slice(0, colonIdx)
    const rest = key.slice(colonIdx + 1)
    if (prefix === 'class') {
      applyClassDirective(node, rest, value, cleanups)
      return
    }
    if (prefix === 'style') {
      applyStyleDirective(node, rest, value, cleanups)
      return
    }
    if (prefix === 'bind') {
      applyBindDirective(node, rest, value, cleanups)
      return
    }
    if (prefix === 'use') {
      applyUseDirective(node, rest, value, cleanups)
      return
    }
    // Unknown prefix — fall through to standard attribute handling.
  }

  if (typeof value === 'function') {
    cleanups.push(
      watch(() => {
        const resolved = (value as () => unknown)()
        setAttr(node, key, resolved)
      }),
    )
    return
  }

  setAttr(node, key, value)
}

// ===== Directives =====
//
// JSX-level shorthand for the four most-common element-level patterns.
// All four are dispatched from `applyProp` based on the `prefix:rest`
// key shape. Type-side: template-literal index signatures on element
// props accept these keys; see types.ts.

function applyClassDirective(
  node: HTMLElement,
  className: string,
  value: unknown,
  cleanups: Disposer[],
): void {
  // `class:foo={cond}` — add `foo` to classList when cond is truthy.
  // cond can be a reactive function/state, or a static value.
  if (typeof value === 'function') {
    cleanups.push(
      watch(() => {
        const truthy = !!(value as () => unknown)()
        if (truthy) node.classList.add(className)
        else node.classList.remove(className)
      }),
    )
    return
  }
  if (value) node.classList.add(className)
}

function applyStyleDirective(
  node: HTMLElement,
  propName: string,
  value: unknown,
  cleanups: Disposer[],
): void {
  // `style:color={value}` — set node.style.color to value (reactively).
  // CSS properties are camelCase on .style; the directive accepts the
  // CSS name (kebab-case or camel-case) and assigns via setProperty for
  // unknown names, otherwise direct assignment for known DOMString props.
  const apply = (resolved: unknown): void => {
    if (resolved === null || resolved === undefined || resolved === false) {
      node.style.removeProperty(propName.includes('-') ? propName : kebabize(propName))
      return
    }
    const str = String(resolved)
    if (propName.includes('-')) {
      node.style.setProperty(propName, str)
    } else {
      // Direct CSSStyleDeclaration assignment; falls through to
      // setProperty for unknown camelCase identifiers.
      ;(node.style as unknown as Record<string, string>)[propName] = str
    }
  }
  if (typeof value === 'function') {
    cleanups.push(
      watch(() => {
        apply((value as () => unknown)())
      }),
    )
    return
  }
  apply(value)
}

function kebabize(camel: string): string {
  return camel.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

function applyBindDirective(
  node: HTMLElement,
  binding: string,
  value: unknown,
  cleanups: Disposer[],
): void {
  // `bind:value={state}` / `bind:checked={state}` / `bind:files={state}`
  // Two-way binding between an input-like element and a State<T>.
  // The state is callable + has .set; bind:value reads/writes .value,
  // bind:checked reads/writes .checked (for checkboxes/radios).
  if (typeof value !== 'function') return // bind: requires a State (callable)
  const s = value as State<unknown>
  const input = node as HTMLInputElement
  if (binding === 'value') {
    cleanups.push(
      watch(() => {
        const v = s()
        const next = v === null || v === undefined ? '' : String(v)
        if (input.value !== next) input.value = next
      }),
    )
    const handler = (): void => {
      const peeked = s.peek()
      if (typeof peeked === 'number') {
        const num = Number.parseFloat(input.value)
        if (!Number.isNaN(num)) s.set(num as never)
      } else {
        s.set(input.value as never)
      }
    }
    input.addEventListener('input', handler)
    cleanups.push(() => input.removeEventListener('input', handler))
    return
  }
  if (binding === 'checked') {
    cleanups.push(
      watch(() => {
        const v = !!s()
        if (input.checked !== v) input.checked = v
      }),
    )
    const handler = (): void => {
      s.set(input.checked as never)
    }
    input.addEventListener('change', handler)
    cleanups.push(() => input.removeEventListener('change', handler))
    return
  }
  if (binding === 'files') {
    const handler = (): void => {
      s.set(input.files as never)
    }
    input.addEventListener('change', handler)
    cleanups.push(() => input.removeEventListener('change', handler))
  }
}

function applyUseDirective(
  node: HTMLElement,
  _actionName: string,
  value: unknown,
  cleanups: Disposer[],
): void {
  // `use:action={payload}` — invoke an action function on mount, with
  // the element + optional payload. The action may return a cleanup
  // function or void. The action itself is passed as the value (a
  // function); the directive name is informational (for readability).
  //
  // Conventionally users write `<input use:autofocus />` where
  // `autofocus` is a top-level function imported into the JSX scope.
  // The JSX runtime resolves the identifier; we receive its value here.
  if (typeof value === 'function') {
    // value is the action function itself (no payload). Call action(el).
    const ret = (value as (el: HTMLElement) => unknown)(node)
    if (typeof ret === 'function') cleanups.push(ret as Disposer)
    return
  }
  // Otherwise value is the payload; we expect the user to use the
  // `use:NAME={payload}` form with NAME bound at the JSX level to the
  // action function. Since we can't resolve identifiers at runtime
  // without a registry, we look for a globally-registered action by
  // name. Default: a no-op so unrecognized use: directives don't crash.
  const action = _useDirectiveRegistry[_actionName]
  if (action) {
    const ret = action(node, value)
    if (typeof ret === 'function') cleanups.push(ret as Disposer)
  }
}

const _useDirectiveRegistry: Record<
  string,
  (el: HTMLElement, payload: unknown) => void | Disposer
> = {}

/**
 * Register a named `use:` directive action so JSX can reference it by
 * string name in the form `<el use:name={payload} />`. Most consumers
 * won't need this — passing the action function directly via
 * `<el use:something={actionFn} />` is the common path.
 */
export function registerDirective(
  name: string,
  fn: (el: HTMLElement, payload: unknown) => void | Disposer,
): void {
  _useDirectiveRegistry[name] = fn
}

function isEventProp(key: string): boolean {
  // onClick, onInput, etc. — must start with 'on' followed by uppercase.
  return (
    key.length > 2 &&
    key.startsWith('on') &&
    key[2] !== undefined &&
    key[2] === key[2].toUpperCase()
  )
}

// Form-input properties that must be set via the DOM property, not the
// HTML attribute. Setting `<input value="x">` via setAttribute changes the
// `defaultValue` only — the displayed value (the `.value` property) does
// not update once the user has interacted with the input. Same for checked
// vs defaultChecked.
//
// We only set these via the property; the attribute is left to the
// browser's default.
const PROPERTY_KEYS = new Set(['value', 'checked', 'selected', 'disabled'])

function setAttr(node: HTMLElement, key: string, value: unknown): void {
  if (key === 'class' || key === 'className') {
    // **Use `setAttribute('class', …)`, not `node.className = …`.** SVG +
    // MathML elements expose `className` as a read-only `SVGAnimatedString`
    // / `DOMTokenList` — assigning to it throws *"Cannot set property
    // className of #<SVGElement> which has only a getter"*, which kills
    // the in-flight hydration of any subtree containing an SVG with a
    // class prop (the reactivity-demo's flow arrows were the first
    // user-visible casualty). `setAttribute` works identically on HTML
    // elements (sets the IDL `class` attribute; the `className`
    // reflection follows) AND on SVG/MathML. There's no hot-path cost.
    if (value == null) node.removeAttribute('class')
    else node.setAttribute('class', String(value))
    return
  }
  if (key === 'style') {
    // CSP-safe style application — strict `style-src` (no `unsafe-inline`)
    // blocks `setAttribute('style', …)` and `style.cssText = …`, but the
    // `CSSStyleDeclaration` API (`.setProperty`, `.removeProperty`,
    // individual property setters) is treated as a programmatic mutation
    // and is NOT blocked. Critical for any app that writes reactive style
    // strings: the framework's whole "reactive prop" promise must work
    // under the same `security: 'standard'` CSP we ship by default.
    if (value == null || value === false) {
      removeAllInlineStyle(node)
      return
    }
    if (typeof value === 'string') {
      applyStyleStringSafe(node, value)
      return
    }
    if (typeof value === 'object') {
      applyStyleObjectSafe(node, value as Record<string, unknown>)
      return
    }
    return
  }
  if (PROPERTY_KEYS.has(key)) {
    // Form-element property assignment (caret-safe — compare-then-set).
    // ONLY applies to real form controls — `value`/`checked`/etc. on a
    // custom element or SVG would silently assign to a property the
    // browser never reads (or worse, shadow a property the element
    // later defines), so we fall through to the standard
    // `setAttribute` path for everything else.
    if (
      node instanceof HTMLInputElement ||
      node instanceof HTMLSelectElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLButtonElement ||
      node instanceof HTMLOptionElement
    ) {
      const target = node as unknown as Record<string, unknown>
      const next = value == null ? '' : value
      if (target[key] !== next) target[key] = next
      return
    }
    // fall through to setAttribute
  }
  if (value == null || value === false) {
    // Namespaced removals (`xlink:href` etc.) go through removeAttributeNS so
    // the IDL match is exact; for non-namespaced names the no-NS form is fine.
    const ns = namespaceForAttr(key)
    if (ns !== null) node.removeAttributeNS(ns, key.slice(key.indexOf(':') + 1))
    else node.removeAttribute(key)
    return
  }
  const raw = value === true ? '' : String(value)
  // Namespaced SVG attrs (`xlink:href` on `<use>`, `xml:lang`) require
  // setAttributeNS; plain setAttribute stores them as opaque names that
  // the browser does not project onto the IDL property and therefore
  // ignores. Detect the known SVG/XML namespaces and route accordingly.
  const ns = namespaceForAttr(key)
  if (ns !== null) {
    node.setAttributeNS(ns, key, raw)
    return
  }
  node.setAttribute(key, raw)
}

/**
 * Map a colon-prefixed attribute name to its IDL namespace, or `null`
 * when no special namespace handling is needed. Covers `xlink:*`
 * (deprecated by SVG2 but still used in the wild — `<use xlink:href>`)
 * and `xml:*` (`xml:lang`, `xml:space`). Unknown prefixes fall back to
 * plain `setAttribute`, which is what authors expect for custom-element
 * data-like attrs that just happen to contain a colon.
 */
function namespaceForAttr(name: string): string | null {
  const colon = name.indexOf(':')
  if (colon <= 0) return null
  const prefix = name.slice(0, colon)
  if (prefix === 'xlink') return 'http://www.w3.org/1999/xlink'
  if (prefix === 'xml') return 'http://www.w3.org/XML/1998/namespace'
  if (prefix === 'xmlns') return 'http://www.w3.org/2000/xmlns/'
  return null
}

// ===== CSP-safe inline-style helpers =====
//
// Strict `style-src` (the default we ship via `security: 'standard'`) blocks
// `setAttribute('style', …)` and `style.cssText = …` — those count as
// "inline" style application, which CSP guards under `style-src-attr` and
// requires either `unsafe-inline`, a per-hash, or a per-nonce to allow.
//
// The `CSSStyleDeclaration` API (`.setProperty(name, value)`,
// `.removeProperty(name)`) is treated as programmatic style mutation, not
// inline style, and is NOT blocked. We route every framework-issued style
// write through it. CSS custom properties (`--flash-age`) pass through
// `.setProperty` cleanly; that's the codepath the reactivity demo hits.

function applyStyleStringSafe(node: HTMLElement, css: string): void {
  // Parse "name: value; name: value" → entries. Tolerates trailing `;`,
  // missing `;` on the last decl, and `:` appearing inside `value`
  // (e.g. `url(data:…)` — split-on-first-colon only).
  const nextProps = new Map<string, { value: string; priority: string }>()
  const decls = css.split(';')
  for (const raw of decls) {
    const decl = raw.trim()
    if (!decl) continue
    const colon = decl.indexOf(':')
    if (colon < 0) continue
    const name = decl.slice(0, colon).trim()
    if (!name) continue
    let value = decl.slice(colon + 1).trim()
    let priority = ''
    // `color: red !important` → strip `!important`, set priority.
    const bangIdx = value.lastIndexOf('!')
    if (bangIdx >= 0 && /^!\s*important$/i.test(value.slice(bangIdx))) {
      priority = 'important'
      value = value.slice(0, bangIdx).trim()
    }
    nextProps.set(name, { value, priority })
  }

  // Remove any previously-set inline property that's no longer present.
  // Iterate by index so we capture custom properties too (style[i] returns
  // the property name, including `--foo`).
  const toRemove: string[] = []
  for (let i = 0; i < node.style.length; i++) {
    const name = node.style.item(i)
    if (!nextProps.has(name)) toRemove.push(name)
  }
  for (const name of toRemove) node.style.removeProperty(name)

  // Apply / update.
  for (const [name, { value, priority }] of nextProps) {
    node.style.setProperty(name, value, priority)
  }
}

function applyStyleObjectSafe(node: HTMLElement, obj: Record<string, unknown>): void {
  // Track desired property names so we can remove dropped ones.
  const next = new Map<string, { value: string; priority: string }>()
  for (const key of Object.keys(obj)) {
    const raw = obj[key]
    if (raw == null || raw === false) continue
    // Custom properties (`--foo`) stay as-is; camelCase → kebab-case for
    // standard CSS property names.
    const cssName = key.startsWith('--')
      ? key
      : key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
    let value = String(raw)
    let priority = ''
    const bangIdx = value.lastIndexOf('!')
    if (bangIdx >= 0 && /^!\s*important$/i.test(value.slice(bangIdx))) {
      priority = 'important'
      value = value.slice(0, bangIdx).trim()
    }
    next.set(cssName, { value, priority })
  }

  const toRemove: string[] = []
  for (let i = 0; i < node.style.length; i++) {
    const name = node.style.item(i)
    if (!next.has(name)) toRemove.push(name)
  }
  for (const name of toRemove) node.style.removeProperty(name)

  for (const [name, { value, priority }] of next) {
    node.style.setProperty(name, value, priority)
  }
}

function removeAllInlineStyle(node: HTMLElement): void {
  // Iterate backwards because `removeProperty` shortens the live list.
  for (let i = node.style.length - 1; i >= 0; i--) {
    const name = node.style.item(i)
    if (name) node.style.removeProperty(name)
  }
}

// ===== Children =====

function mountChildren(
  parent: ParentNode,
  children: Children,
  anchor: Node | null,
  cleanups: Disposer[],
): void {
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    cleanups.push(mountChild(parent, child, anchor))
  }
}

function mountChild(parent: ParentNode, child: Child, anchor: Node | null): Disposer {
  if (child == null || child === false || child === true) {
    return () => {}
  }

  if (typeof child === 'string' || typeof child === 'number') {
    const node = document.createTextNode(String(child))
    parent.insertBefore(node, anchor)
    return () => node.remove()
  }

  if (typeof child === 'function') {
    return mountReactiveChild(parent, child as () => Child, anchor)
  }

  // Arrays of children: mount each in order, return a composite
  // disposer. Required because `Child` is recursive (`Child[]` is
  // itself a Child), so JSX like `<Frag>{items.map(…)}{conditional}</Frag>`
  // produces an array child at this position. The runtime mirrors what
  // `childToHtml` already does for SSR.
  if (Array.isArray(child)) {
    const disposers: Disposer[] = []
    for (const c of child) {
      disposers.push(mountChild(parent, c as Child, anchor))
    }
    return () => {
      for (const d of disposers) d()
    }
  }

  // It's a View
  return (child as View).mount(parent, anchor)
}

// Reactive child binding: function returns text/number/View. We use a
// comment node as a stable anchor and keep track of whatever was last mounted.
//
// Critical: the descendant `mountChild` call is wrapped in `untrack` so that
// component bodies / nested watches mounted inside this child do not subscribe
// THIS watch to their inner state reads. Without it, a `<NoteEditor>` mounted
// here would have its `live().title` reads (etc.) tracked against the outer
// watch — causing the entire subtree to unmount and remount on every keystroke
// the inner editor handled. That manifests as input focus loss and characters
// being dropped. fn() itself remains tracked because its reactivity is the
// whole point — it tells us when to re-mount.
function mountReactiveChild(parent: ParentNode, fn: () => Child, anchor: Node | null): Disposer {
  const slot = document.createComment('')
  parent.insertBefore(slot, anchor)
  let current: Disposer = () => {}

  const watchDispose = watch(() => {
    try {
      current()
      const resolved = fn()
      current = untrack(() => mountChild(parent, resolved, slot))
    } catch (e) {
      // Failed mount: no cleanup to run. Bubble the throw to the
      // nearest error boundary; if none, re-throw so the page surfaces
      // the error loudly instead of silently swallowing.
      current = () => {}
      const handler = ErrorBoundaryCap.tryUse()
      if (handler === null) throw e
      handler(e)
    }
  })

  return () => {
    watchDispose()
    current()
    slot.remove()
  }
}

// ===== Fragment =====
//
// Groups siblings without adding a wrapping DOM element.

// ===== Hydration corrector primitives =====
//
// `<ClientOnly>` and `<Deferred>` give app authors a structural way to
// fix hydration mismatches the auditor detects. SSR emits a stable
// placeholder; client renders the real content after hydration. The
// auditor's `mismatch` warnings point at this fix.
//
// Implementation: a module-level reactive flag flips from false to
// true at the end of `boot()`'s hydration. SSR sees false, never
// evaluates the children function. Client also sees false initially
// (so hydrate sees an empty wrapper, matches), then the flag flips
// and the reactive child re-renders with real content.
//
// One wrapper element per use (`<span>`) — keeps the markup simple
// and lets hydrate find a stable element to adopt. Trade-off accepted:
// inline-text uses get an extra `<span>` boundary. If that becomes a
// problem in practice, revisit with a Fragment-based variant; for now
// the wrapper makes the contract simple and reliable.

// `_isHydratedState`, `_setHydrated`, `_readHydrated` live in
// `./_internal/hydration.ts`; imported at the top of this file under
// the local name `_isHydratedState` for backward-compatible call sites.

export interface ClientOnlyProps {
  /** Function returning the content to render after hydration completes. */
  children: () => Child
}

/**
 * Renders nothing on the server; renders `children()` on the client
 * after hydration completes. Use for content that depends on browser-
 * only state (`window`, `Date.now()`, geolocation, navigator-language)
 * — wrapping it here prevents the SSR/client divergence that would
 * otherwise produce a hydration mismatch warning from the auditor.
 *
 * ```tsx
 * <ClientOnly>{() => <TimeAgo at={Date.now()} />}</ClientOnly>
 * ```
 *
 * One `<span>` wrapper per use so the framework has a stable element
 * to adopt at hydrate. The wrapper sets `display: contents` so it
 * doesn't participate in the box model — flex / grid / `h-full` on
 * the wrapped subtree inherit from the span's *parent*, which is
 * almost always what callers want. Override via the `class` prop only
 * if you need the span as a visible inline container.
 */
export function ClientOnly(props: ClientOnlyProps): View {
  return el('span', { 'data-place-client-only': '', 'data-place-contents': '' }, () =>
    _isHydratedState.read() ? props.children() : null,
  )
}

export interface DeferredProps {
  /** Server-renderable placeholder. Stays in place until hydration completes. */
  fallback: Child
  /** Function returning the real content to swap in after hydration. */
  children: () => Child
}

/**
 * Renders `fallback` on the server (and during the brief pre-hydrate
 * window on the client), then swaps to `children()` after hydration
 * completes. Use when SSR'd structure matters for layout stability —
 * e.g. a date placeholder reserves space so the real timestamp doesn't
 * cause a layout shift on first interaction.
 *
 * ```tsx
 * <Deferred fallback={<span>—</span>}>
 *   {() => <TimeAgo at={Date.now()} />}
 * </Deferred>
 * ```
 *
 * One `<span>` wrapper per use, same `display: contents` default as
 * `<ClientOnly>` — the wrapper is transparent to flex / grid / height
 * inheritance.
 */
export function Deferred(props: DeferredProps): View {
  return el('span', { 'data-place-deferred': '', 'data-place-contents': '' }, () =>
    _isHydratedState.read() ? props.children() : props.fallback,
  )
}

export interface ActivityProps {
  /**
   * Reactive (or static) predicate. Truthy → children visible.
   * Falsy → children stay in the DOM but are hidden (`display:none`).
   */
  when: boolean | (() => boolean)
  children?: Child | Child[]
}

/**
 * Render content that's sometimes hidden — without unmounting it.
 *
 * `<Activity>` is the "render everything, toggle visibility" pattern.
 * Same shape as React 19's `<Activity>`, but powered by the platform:
 * the wrapper uses the browser's `hidden` HTML attribute, which is a
 * UA-stylesheet rule (`display: none`) that strict CSP can't block —
 * no inline style, no nonce, no opt-in. The subtree stays mounted
 * across visibility changes, so any reactive state inside survives
 * — no remount cost, no input focus lost, no scroll reset.
 *
 * Typical use is for tab panels, accordions, wizards — anywhere the
 * UI cycles through alternative views and the work to render them
 * is non-trivial or the state needs to persist.
 *
 * ```tsx
 * {tabs.map(t => (
 *   <Activity when={() => active() === t.label}>
 *     {t.content()}
 *   </Activity>
 * ))}
 * ```
 *
 * Trade-off vs `<Show>`: Activity ships ALL branches in the SSR HTML
 * (so search engines see them; first paint of an inactive tab is
 * instant), whereas Show emits only the active branch. Use Show when
 * the inactive branch is expensive to render or contains side-effects
 * that shouldn't fire when hidden.
 */
export function Activity(props: ActivityProps): View {
  const hidden =
    typeof props.when === 'function'
      ? () => !(props.when as () => boolean)()
      : !props.when
  return el(
    'span',
    {
      'data-place-activity': '',
      hidden,
    },
    props.children as Child,
  )
}

// ===== Tabs =====
//
// Compose-with-`<Tab>` tabs primitive. Author shape:
//
// ```tsx
// <Tabs group="hello">
//   <Tab label="place">    <CodeBlock code={PLACE} /></Tab>
//   <Tab label="Next.js">  <CodeBlock code={NEXT}  /></Tab>
//   <Tab label="Remix">    <CodeBlock code={REMIX} /></Tab>
// </Tabs>
// ```
//
// Why this shape:
//   - Label travels with its panel — no parallel-array bookkeeping,
//     no off-by-one mistakes when adding / reordering tabs.
//   - Active-tab persistence is automatic: when `group` is set, the
//     framework wires a `place-tab-${group}` cookie under the hood.
//     Authors don't write `cookieState(...)` themselves.
//   - The framework owns the trigger row, the panel divs, the active
//     state, and the click delegation — author writes content only.
//
// **Hydration model.** Tabs is a server-rendered component. The
// trigger click handling rides on ONE inline document-level
// delegated listener (`__tabs.ts`), included via `<script nonce>`
// once per page when any Tabs renders. No island bundle ships;
// no per-instance JS runs at load. The runtime toggles `hidden` on
// `[data-tabs-panel]` siblings + writes the cookie on click.

const TAB_BRAND_NAME = '__placeTabBrand'
/** Symbol carried on `<Tab>`'s return so `<Tabs>` can introspect children. */
export const TAB_BRAND: symbol = Symbol.for(TAB_BRAND_NAME)

/**
 * Descriptor returned by `<Tab>`. Implements the `View` interface with
 * no-op methods (Tabs renders the panel itself, reading `children`
 * off this descriptor — Tab never appears in the rendered tree).
 */
interface TabDescriptor extends View {
  readonly __tabBrand: symbol
  readonly label: Child
  readonly value: string
  readonly panelChildren: Child
}

export interface TabProps {
  /** Visible trigger label. If a string, doubles as the stable `value`. */
  readonly label: Child
  /**
   * Stable id for this tab. Used as the DOM marker AND the cookie
   * value. Required when `label` isn't a string (e.g. JSX label).
   * Optional otherwise; defaults to the string label.
   */
  readonly value?: string
  /** Panel content. Renders into `<div role="tabpanel">` server-side. */
  readonly children?: Children
}

/**
 * Tab marker for use as a direct child of `<Tabs>`. Returns a
 * descriptor `<Tabs>` reads — never rendered in place.
 *
 * The function value itself carries the `__tabBrand` so the JSX
 * runtime can detect it via `(type as {...}).__tabBrand === TAB_BRAND`
 * and skip the `component()` auto-wrap. Without the brand on the
 * function, the runtime would wrap Tab in component(), strip the
 * descriptor's metadata, and Tabs's child introspection would fail
 * with "at least one <Tab> child required" at every call site.
 */
function _Tab(props: TabProps): View {
  const value =
    props.value ?? (typeof props.label === 'string' ? props.label : undefined)
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      '<Tab>: pass `value` explicitly when `label` is not a plain string. ' +
        '`value` is the stable id used for the active-tab cookie + DOM markers.',
    )
  }
  const descriptor: TabDescriptor = {
    toHtml: () => '',
    mount: () => () => {},
    hydrate: () => () => {},
    __tabBrand: TAB_BRAND,
    label: props.label,
    value,
    panelChildren: props.children ?? null,
  }
  return descriptor
}
export const Tab: typeof _Tab & { __tabBrand: symbol } = Object.assign(_Tab, {
  __tabBrand: TAB_BRAND,
})

function flattenChildren(children: Child | Children | undefined): Child[] {
  if (children === undefined || children === null) return []
  if (Array.isArray(children)) {
    return children.flatMap((c) => flattenChildren(c as Child))
  }
  return [children as Child]
}

function collectTabs(children: Child | Children | undefined): TabDescriptor[] {
  const flat = flattenChildren(children)
  const out: TabDescriptor[] = []
  for (const c of flat) {
    if (c === null || c === undefined || typeof c !== 'object') continue
    const maybe = c as Partial<TabDescriptor>
    if (maybe.__tabBrand === TAB_BRAND) {
      out.push(maybe as TabDescriptor)
    }
  }
  return out
}

export interface TabsClassNames {
  /** Outer wrapper. */
  readonly root?: string
  /** Trigger list (`role="tablist"`). */
  readonly list?: string
  /** Each trigger button (`role="tab"`). Always applied. */
  readonly trigger?: string
  /** Class added to the active trigger. Concatenated with `trigger`. */
  readonly triggerActive?: string
  /** Each panel wrapper (`role="tabpanel"`). */
  readonly panel?: string
}

/**
 * Quick visual variants. Each picks a different default for the
 * outer chrome + trigger row. `classes` still overrides everything
 * — use `variant` for a one-line theme pick, `classes` for full
 * control.
 *
 *   `'card'`       — bordered rounded box; underline-active triggers (default)
 *   `'underline'`  — no outer border; triggers sit above a bottom rule
 *   `'pill'`       — rounded pill triggers; no outer border
 *   `'ghost'`      — minimal triggers, no chrome
 */
export type TabsVariant = 'card' | 'underline' | 'pill' | 'ghost'

export interface TabsProps {
  /**
   * Stable group id. When set, the framework wires a
   * `place-tab-${group}` cookie for active-tab persistence across
   * reloads. Omit for in-memory (ephemeral) tabs.
   */
  readonly group?: string
  /**
   * `<Tab>` children, in order. The first tab is the default active.
   * Children that aren't `<Tab>` are filtered out with a dev warning.
   */
  readonly children?: Children
  /** Quick visual variant. Default: `'card'`. */
  readonly variant?: TabsVariant
  /** Optional class overrides. Wins over `variant` defaults. */
  readonly classes?: TabsClassNames
}

const TABS_VARIANTS: Readonly<Record<TabsVariant, Required<TabsClassNames>>> = {
  card: {
    root: 'my-4 mb-6 border border-border rounded-[10px] overflow-hidden',
    list: 'flex gap-0 bg-bg/60 border-b border-border/60',
    trigger:
      'bg-transparent border-0 py-2 px-4 text-muted text-[13px] cursor-pointer border-b-2 border-b-transparent transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:text-fg',
    triggerActive: 'text-accent border-b-accent',
    panel: '',
  },
  underline: {
    root: 'my-4 mb-6',
    list: 'flex gap-2 border-b border-border/60 mb-3',
    trigger:
      'bg-transparent border-0 py-2 px-1 text-muted text-[13px] cursor-pointer border-b-2 border-b-transparent transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:text-fg',
    triggerActive: 'text-fg border-b-accent',
    panel: '',
  },
  pill: {
    root: 'my-4 mb-6',
    list: 'inline-flex gap-1 p-1 rounded-lg bg-card/60 border border-border/60 mb-3',
    trigger:
      'bg-transparent border-0 py-1 px-3 text-muted text-[13px] rounded-md cursor-pointer transition-colors duration-150 hover:text-fg focus-visible:outline-none',
    triggerActive: 'text-fg bg-bg/80 shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-border)_70%,transparent)]',
    panel: '',
  },
  ghost: {
    root: 'my-4 mb-6',
    list: 'flex gap-3 mb-3',
    trigger:
      'bg-transparent border-0 py-1 px-0 text-muted text-[13px] cursor-pointer transition-colors duration-150 hover:text-fg focus-visible:outline-none',
    triggerActive: 'text-accent',
    panel: '',
  },
}

// Per-process anonymous-group counter for `<Tabs>` without a `group`
// prop. Used only as a stable DOM id so the inline runtime can scope
// queries. Resets per renderToString cycle.
let anonTabsGroupCounter = 0

/**
 * Render a tabs widget. Triggers + panels SSR; clicks handled by the
 * page's inlined tabs runtime (`__tabs.ts`).
 *
 * **Active state.** Per-request:
 *   - If `group` is set: read `place-tab-${group}` cookie; fall back
 *     to the first tab's `value` when absent. Cookie writes happen
 *     on click via the inline runtime.
 *   - Otherwise (no group): first tab is active for this render.
 */
export function Tabs(props: TabsProps): View {
  const tabs = collectTabs(props.children)
  if (tabs.length === 0) {
    throw new Error(
      '<Tabs>: at least one <Tab> child is required. ' +
        'Use: <Tabs group="…"><Tab label="A">…</Tab><Tab label="B">…</Tab></Tabs>',
    )
  }
  const groupId = props.group ?? `tabs-${++anonTabsGroupCounter}`
  const fallback = tabs[0]!.value
  // SSR-correct active resolution. cookieState reads request cookies
  // on the server, document.cookie on the client.
  const cookieKey = props.group ? `place-tab-${props.group}` : ''
  const active = cookieKey ? cookieState(cookieKey, fallback) : null
  const initial = active ? active() : fallback

  // Signal renderPage that this page needs the tabs runtime. Idempotent
  // across multiple Tabs on the same page.
  if (typeof window === 'undefined') {
    markTabsUsedOnThisRequest()
  }

  const variant = TABS_VARIANTS[props.variant ?? 'card']
  const cls = props.classes ?? {}
  const rootClass = cls.root ?? variant.root
  const listClass = cls.list ?? variant.list
  const triggerBase = cls.trigger ?? variant.trigger
  const triggerActive = cls.triggerActive ?? variant.triggerActive
  const panelClass = cls.panel ?? variant.panel

  return el(
    'div',
    {
      class: rootClass,
      'data-tabs-group': groupId,
      'data-tabs-cookie': cookieKey,
    },
    el(
      'div',
      { class: listClass, role: 'tablist' },
      tabs.map((t) =>
        el(
          'button',
          {
            type: 'button',
            role: 'tab',
            'data-tabs-trigger': t.value,
            'data-tabs-active': t.value === initial ? '' : undefined,
            'aria-selected': t.value === initial ? 'true' : 'false',
            tabindex: t.value === initial ? 0 : -1,
            class: `${triggerBase}${t.value === initial ? ` ${triggerActive}` : ''}`,
          },
          t.label,
        ),
      ),
    ),
    ...tabs.map((t) =>
      el(
        'div',
        {
          role: 'tabpanel',
          'data-tabs-panel': t.value,
          class: panelClass,
          hidden: t.value === initial ? undefined : ('' as unknown as boolean),
        },
        t.panelChildren,
      ),
    ),
  )
}

// Per-request bookkeeping: which pages used <Tabs>? renderPage reads
// the flag and conditionally inlines the tabs runtime. Server-only.
let _tabsUsedFlag = false
export function markTabsUsedOnThisRequest(): void {
  _tabsUsedFlag = true
}
export function _consumeTabsUsedFlag(): boolean {
  const v = _tabsUsedFlag
  _tabsUsedFlag = false
  return v
}

/**
 * Reactive binding to a `<Tabs group="…">` group's active value.
 *
 * Returns a `State<string>` that:
 *   - **On the server**: reads the `place-tab-${group}` cookie (or
 *     falls back to `initial`). Same shape as `cookieState`, so SSR
 *     can use it to render conditional content for the active tab.
 *   - **On the client**: subscribes to the framework's `place:tabs`
 *     CustomEvent (fired by the tabs runtime on every trigger click)
 *     and writes the new value into the State when the event's
 *     `detail.group` matches. Disposer cleans up on unmount.
 *
 * Use case: Tabs as a filter trigger. Author writes ONE LINE in an
 * island instead of a manual `addEventListener` + cast + remove.
 *
 * ```tsx
 * const TodoList = island(() => {
 *   const filter = tabsState('todo-filter', 'all')
 *   return <ul>{() => items.filter(matchesFilter(filter())).map(renderRow)}</ul>
 * })
 * ```
 *
 * The cookie persists the choice across reloads; the State integrates
 * with the rest of the reactivity graph (derived, watch, JSX function
 * children) like any other signal.
 */
export function tabsState(group: string, initial = ''): State<string> {
  const key = `place-tab-${group}`
  const s = cookieState(key, initial)
  // Server: no event subscription possible — just return the cookie-
  // backed state. SSR reads s() and produces the right initial paint.
  if (typeof window === 'undefined') return s
  // Client: bind to the runtime's CustomEvent. The listener fires on
  // every trigger click; we only update when the event's group matches
  // ours so multiple `tabsState` calls on the same page stay isolated.
  // The handler installs via onMount + cleans up via onCleanup so the
  // binding follows the surrounding component's lifecycle (and works
  // both during SSR-pre-hydration and post-hydration mounts).
  onMount(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent).detail as
        | { group?: unknown; value?: unknown }
        | undefined
      if (
        detail &&
        detail.group === group &&
        typeof detail.value === 'string'
      ) {
        s.set(detail.value)
      }
    }
    document.addEventListener('place:tabs', handler)
    return () => document.removeEventListener('place:tabs', handler)
  })
  return s
}

export interface ShowProps {
  /**
   * Reactive predicate. Truthy → render `children`; falsy → render
   * `fallback` (or nothing if absent).
   */
  when: () => unknown
  /** Function returning the content shown when `when()` is truthy. */
  children: () => Child
  /** Optional content shown when `when()` is falsy. */
  fallback?: Child
}

/**
 * Conditional render primitive. Replaces the common `{() => cond ? <X /> : null}`
 * shape with a named component so the intent reads:
 *
 * ```tsx
 * <Show when={() => open.read()} fallback={null}>
 *   {() => <Modal />}
 * </Show>
 * ```
 *
 * Both branches are lazy — only the active branch runs. The `when`
 * function tracks reactively; flipping it toggles which branch mounts
 * without re-running the inactive one. No wrapper element; the children
 * are emitted directly inline.
 */
export function Show(props: ShowProps): View {
  return Fragment({
    children: () => (props.when() ? props.children() : (props.fallback ?? null)),
  })
}

export const Fragment = (props: { children?: Children }): View => ({
  // No wrapping element — emit children directly. No hydration marker
  // either: hydration walks elements, not Fragment boundaries.
  toHtml: () => (props.children === undefined ? '' : childToHtml(props.children as Child)),
  // Hydrate by passing the slot through to each child.
  //
  // Three child shapes need different treatment:
  //   - Static text/number/boolean/null: nothing to walk, nothing to wire.
  //   - View: hand the slot to its hydrate; one element consumed.
  //   - **Reactive function child**: SSR emitted the function's CURRENT
  //     output at this position. On the client we adopt those nodes via
  //     the normal hydrate path AND set up a watch so future changes to
  //     the function's result replace the rendered range in place — same
  //     reactivity contract as `mountReactiveChild` on a fresh mount.
  //
  // The third case is what makes `<Show when={…}>{() => …}</Show>` work
  // across hydration. Without it, the SSR-emitted branch would be
  // adopted once and never re-render when `when()` flipped — every
  // reactive function child inside a Fragment would silently freeze.
  hydrate(slot) {
    const cleanups: Disposer[] = []
    if (props.children !== undefined) {
      const list: Child[] = Array.isArray(props.children) ? props.children : [props.children]
      const hydrateInto = (sink: Disposer[], child: Child): void => {
        if (child == null || typeof child === 'boolean') return
        if (typeof child === 'string' || typeof child === 'number') return
        if (typeof child === 'function') {
          hydrateFunctionChild(sink, child as () => Child)
          return
        }
        if (Array.isArray(child)) {
          for (const c of child) hydrateInto(sink, c as Child)
          return
        }
        if (child.hydrate) sink.push(child.hydrate(slot))
      }
      const hydrateFunctionChild = (sink: Disposer[], fn: () => Child): void => {
        const parent = slot.parent()
        // Bound the function's range with two comment anchors. We insert
        // `startAnchor` BEFORE hydrating fn's output (at the cursor's
        // current element position, which is the next sibling after
        // whatever the previous child consumed); `endAnchor` AFTER
        // hydration walked the cursor past fn's output. The two anchors
        // delimit a region we can clear + re-fill on every state change.
        //
        // Why two anchors and not one: when fn rendered nothing on SSR
        // (empty branch), there's no SSR-emitted node between them to
        // capture — so a single end-anchor + "previous sibling" walk
        // would happily walk into the NEXT Fragment child's region.
        // Two anchors make the range unambiguous even when empty.
        const startAnchor = document.createComment('')
        const endAnchor = document.createComment('')
        const cursorEl = slot.peekElement()
        if (cursorEl !== null) parent.insertBefore(startAnchor, cursorEl)
        else parent.appendChild(startAnchor)
        // Adopt the SSR-rendered initial output. `subCleanups` holds the
        // listeners for THIS render so the watch can dispose the right
        // subtree when fn() changes — separate from the outer Fragment's
        // cleanups which would survive across re-renders.
        let subCleanups: Disposer[] = []
        const initial = untrack(fn)
        hydrateInto(subCleanups, initial)
        const cursorEnd = slot.peekElement()
        if (cursorEnd !== null) parent.insertBefore(endAnchor, cursorEnd)
        else parent.appendChild(endAnchor)
        // Snapshot the DOM nodes that belong to the initial render —
        // everything STRICTLY between the two anchors.
        let currentNodes: Node[] = []
        let cursor: Node | null = startAnchor.nextSibling
        while (cursor !== null && cursor !== endAnchor) {
          currentNodes.push(cursor)
          cursor = cursor.nextSibling
        }
        let firstRun = true
        const watchDispose = watch(() => {
          let resolved: Child
          try {
            resolved = fn()
          } catch (e) {
            const handler = ErrorBoundaryCap.tryUse()
            if (handler === null) throw e
            handler(e)
            return
          }
          if (firstRun) {
            firstRun = false
            return
          }
          // Subsequent fires: tear down the previous render (listeners
          // + DOM) and mount the new value into the bounded region.
          disposeAll(subCleanups)
          subCleanups = []
          for (const n of currentNodes) n.parentNode?.removeChild(n)
          currentNodes = []
          let dispose: Disposer
          try {
            dispose = untrack(() => mountChild(parent, resolved, endAnchor))
          } catch (e) {
            const handler = ErrorBoundaryCap.tryUse()
            if (handler === null) throw e
            handler(e)
            return
          }
          subCleanups.push(dispose)
          // Re-snapshot the freshly-mounted range from startAnchor to
          // endAnchor — same shape as the initial capture.
          let c: Node | null = startAnchor.nextSibling
          while (c !== null && c !== endAnchor) {
            currentNodes.push(c)
            c = c.nextSibling
          }
        })
        sink.push(watchDispose)
        sink.push(() => disposeAll(subCleanups))
      }
      for (const child of list) hydrateInto(cleanups, child)
    }
    return () => disposeAll(cleanups)
  },
  mount(parent, anchor) {
    const cleanups: Disposer[] = []
    try {
      if (props.children !== undefined) {
        mountChildren(parent, props.children, anchor ?? null, cleanups)
      }
    } catch (e) {
      disposeAll(cleanups)
      const handler = ErrorBoundaryCap.tryUse()
      if (handler === null) throw e
      handler(e)
      return () => {}
    }
    return () => disposeAll(cleanups)
  },
})

// ===== Top-level mount =====

// `mount`, `hydrate`, `withCapability`, `withCapabilities` live in
// `./_client-mount.ts` (the leaf the per-island wrappers import
// directly — see that file's header for why the split exists).
// Imported here for the barrel's own internal use (the SPA-nav boot
// path calls `hydrate()` directly) AND re-exported so the public
// surface keeps the same shape: callers writing `import { mount }
// from '@place/component'` see no change. `_setHydrated` is exported
// up top alongside the rest of the hydration internals.
import {
  hydrate,
  mount,
  withCapability,
  withCapabilities,
} from './_client-mount.ts'
export { hydrate, mount, withCapability, withCapabilities }

// ===== renderToString — server-side render =====
//
// Mounts `view` into a fresh detached element, reads its `innerHTML`,
// disposes the mount. Returns the rendered HTML string. The foundational
// piece for SSR — a server hands the HTML to the browser, the client
// hydrates (TBD) and reactivity takes over.
//
// Works anywhere `document` exists:
//   - tests (vitest with `@vitest-environment happy-dom`)
//   - browser (just renders into a detached node — useful for snapshot tests)
//   - Bun / Node servers (install happy-dom's Window globally first)
//
// Why mount-then-serialize instead of a separate string-emitter pipeline:
//   - A single rendering path means SSR + CSR + tests all exercise the
//     same code; no two-implementations-of-everything to keep in sync.
//   - The DOM mount path already handles every JSX construct; a string
//     emitter would have to be re-implemented per element shape.
//   - Performance: a separate emitter would be faster, but happy-dom
//     handles ~10K renders/sec which is plenty for "render a page on
//     request." Optimize if a workload demands it.
//
// Caveats (all addressed in the SSR story but not by this primitive):
//   - Reactive subscriptions are torn down via `dispose()`. Effects with
//     side-channels (analytics fires, etc.) still run during render —
//     handlers should be guarded if they shouldn't fire on the server.
//   - Hydration markers are not emitted. The client's hydrate() (future)
//     will need agreed-upon markers to map server DOM to client mount.
//   - `<script>` and `<style>` content is left as-is; sanitize at the
//     source if rendering untrusted markup.

export function renderToString(view: View): string {
  // Fast path: views built from `el()` / `Fragment` / `component()`
  // implement `toHtml`, which doesn't need a DOM at all. This is the
  // path the Bun-direct sync-server takes; happy-dom isn't required.
  if (view.toHtml) {
    resetHydrationSeq()
    return view.toHtml()
  }
  // Fallback: a custom View without toHtml. Mount into a detached DOM
  // node and serialize. Requires `document` (happy-dom in Bun, real DOM
  // in browser, vitest's @vitest-environment in tests).
  if (typeof document === 'undefined') {
    throw new Error(
      'renderToString: this view has no `toHtml` and no `document` is in scope. ' +
        'Either implement `toHtml()` on the view, or in Bun / Node install happy-dom and ' +
        'register its Window globally — e.g.\n' +
        "  import { Window } from 'happy-dom'\n" +
        '  const w = new Window()\n' +
        '  globalThis.document = w.document as unknown as Document',
    )
  }
  const root = document.createElement('div')
  const dispose = view.mount(root, null)
  try {
    // Strip empty comment nodes — `mountReactiveChild` uses
    // `document.createComment('')` as anchors for swap-in/swap-out,
    // mount-time bookkeeping that shouldn't appear in server output.
    const empties: Comment[] = []
    const walk = (n: Node): void => {
      for (const c of Array.from(n.childNodes)) {
        if (c.nodeType === 8 /* Comment */ && (c as Comment).data === '') {
          empties.push(c as Comment)
        } else {
          walk(c)
        }
      }
    }
    walk(root)
    for (const c of empties) c.remove()
    return root.innerHTML
  } finally {
    dispose()
  }
}

// ===== suspense() — streaming SSR boundary =====
//
// Wraps a subtree that depends on async `resource()` data. While the
// resources are pending, the SSR'd HTML emits a `fallback`; the renderer
// holds the response stream open. Once the resources resolve, the real
// children are rendered and pushed to the stream as a `<template>` swap
// chunk that an inline runtime (`__place.swap(N)`) splices into place.
//
//   import { suspense } from '@place/component'
//   import { resource } from '@place/reactivity'
//
//   const note = resource(
//     (signal) => fetch(`/api/notes/${id}`, { signal }).then(r => r.json()),
//     { hydrationKey: `note:${id}` },  // enables client-side cache lookup
//   )
//
//   <suspense fallback={<Skeleton />} on={[note]}>
//     {() => {
//       const s = note.status()
//       if (s.state === 'ready') return <NoteView note={s.value} />
//       return null
//     }}
//   </suspense>
//
// Wire format (compatible-ish with React Fizz, simpler):
//
//   Initial flush:
//     <!--p:N--><template id="pl-N"></template>${fallback}<!--/p:N-->
//   Later flush, when all `on` resolve:
//     <template id="c-N">${rendered children}</template>
//     <script>__place.r['key1']=…;__place.swap(N)</script>
//
// Why comment markers: `__place.swap(N)` needs to remove a *range* of
// nodes (the fallback subtree). Comments delimit the range; element IDs
// alone don't.
//
// Why plain `<script>` (not `type="module"`): module scripts are
// async/deferred per spec. Plain scripts run synchronously as parsed,
// so the swap fires immediately when the chunk arrives — same order as
// the stream.
//
// Why values are devalue-encoded: devalue handles Date/Map/Set/cycles/
// undefined, is JSON-shaped (CSP-clean — no eval needed; small client
// bundle), and round-trips loudly on unsupported input. Picked over
// seroval (which requires `eval` and would break our `security: 'strict'`).

import { stringify as devalueStringify } from 'devalue'
import type { Resource } from '../../reactivity/src/index.ts'
import { PLACE_RUNTIME } from './__place_runtime.ts'
import { placeDeferredIslands } from './__deferred-islands.ts'
import { placeEarly } from './__early.ts'
import { HMR_WS_PATH, placeHmr } from './__hmr.ts'
import { _consumeCopyUsedFlag, placeCopyRuntime } from './__copy-runtime.ts'
import { placeSpaNav } from './__spa_nav.ts'
import { placeTabs } from './__tabs.ts'
import { placeViewport } from './__viewport-runtime.ts'
import { maybeCompress } from './compress.ts'

export interface SuspenseProps {
  /** Rendered while `on` resources are pending. Should be cheap & static. */
  fallback: View
  /** Rendered once all `on` resources resolve. Function-as-child so the
   *  body re-evaluates with the resolved values. */
  children: () => Child
  /** Resources to wait for. Suspense suspends until ALL resolve. */
  on: Resource<unknown>[]
  /**
   * When `false`, the renderer waits synchronously for resources before
   * flushing — works without JS, slower TTFB. Default: `true` (streaming).
   */
  requireJs?: boolean
}

let suspenseSeq = 0
const resetSuspenseSeq = (): void => {
  suspenseSeq = 0
}
const nextSuspenseId = (): number => suspenseSeq++

/**
 * Streaming render context. The renderer sets a module-level reference
 * before walking the View tree; `suspense()`'s `toHtml` reads this to
 * switch between sync rendering (no streaming) and emit-markers-and-
 * register-continuation (streaming). The reference is cleared after the
 * walk so subsequent non-streaming `renderToString` calls aren't
 * accidentally captured.
 */
interface StreamCtx {
  /** Boundaries pending resolution. Drained before the stream closes. */
  pending: PendingBoundary[]
  /** Resource hydration values to emit alongside swap chunks. */
  hydrate: Map<string, unknown>
}

interface PendingBoundary {
  id: number
  resources: Resource<unknown>[]
  /** Re-renders `children` to a string when resources are ready. */
  render: () => string
}

const makeStreamCtx = (): StreamCtx => ({ pending: [], hydrate: new Map() })

let currentStreamCtx: StreamCtx | null = null

// Suspense factory. The View has both `toHtml` (synchronous: just emits
// the rendered children, blocking on resources) and `toStream` (async:
// emits fallback + marker + queues a continuation).
export function suspense(props: SuspenseProps): View & {
  __isSuspense: true
  toStream(ctx: StreamCtx): string
} {
  const requireJs = props.requireJs !== false

  // Resolve children once into a View by calling the function-as-child.
  // The child function is called fresh on each render attempt — important
  // because resource status changes between attempts.
  const renderChildren = (): View => {
    const child = props.children()
    if (child == null || child === false || child === true) {
      return Fragment({ children: '' })
    }
    if (typeof child === 'string' || typeof child === 'number') {
      return Fragment({ children: String(child) })
    }
    if (typeof child === 'function') {
      return Fragment({ children: child as () => Child })
    }
    if (Array.isArray(child)) {
      return Fragment({ children: child as Child[] })
    }
    return child as View
  }

  const allReady = (): boolean => props.on.every((r) => untrack(() => r.status()).state === 'ready')

  const anyError = (): unknown =>
    props.on.map((r) => untrack(() => r.status())).find((s) => s.state === 'error')

  // Suspense's behavior depends on whether we're in a streaming render.
  // Static SSR (renderToString): just emit fallback or children
  // synchronously. Streaming SSR (renderToStream): emit markers + register
  // a continuation that fires when resources resolve.
  const renderForStream = (ctx: StreamCtx): string => {
    // All resources already ready: emit children directly, no marker.
    if (allReady()) {
      const v = renderChildren()
      return v.toHtml?.() ?? ''
    }
    // requireJs:false — streaming opt-out. The renderer awaits this
    // boundary BEFORE flushing the shell; the inline:N sentinel gets
    // string-replaced by the resolved content.
    if (!requireJs) {
      const id = nextSuspenseId()
      ctx.pending.push({
        id,
        resources: props.on,
        render: () => {
          const e = anyError()
          if (e !== undefined) return props.fallback.toHtml?.() ?? ''
          return renderChildren().toHtml?.() ?? ''
        },
      })
      return `<!--inline:${id}-->`
    }
    // Standard streaming path: fallback + comment-marker boundary.
    const id = nextSuspenseId()
    const fallbackHtml = props.fallback.toHtml?.() ?? ''
    ctx.pending.push({
      id,
      resources: props.on,
      render: () => {
        const e = anyError()
        if (e !== undefined) return props.fallback.toHtml?.() ?? ''
        // After resolve, harvest hydration values from each resource.
        for (const r of props.on) {
          const key = r.hydrationKey()
          if (key === undefined) continue
          const s = untrack(() => r.status())
          if (s.state === 'ready') {
            ctx.hydrate.set(key, s.value)
          }
        }
        return renderChildren().toHtml?.() ?? ''
      },
    })
    return `<!--p:${id}--><template id="pl-${id}"></template>${fallbackHtml}<!--/p:${id}-->`
  }

  return {
    __isSuspense: true,
    toHtml: () => {
      // If a streaming render is active, route to the marker-emitting
      // path; otherwise fall back to synchronous fallback-or-children.
      if (currentStreamCtx !== null) {
        return renderForStream(currentStreamCtx)
      }
      if (anyError()) return props.fallback.toHtml?.() ?? ''
      if (!allReady()) return props.fallback.toHtml?.() ?? ''
      const v = renderChildren()
      return v.toHtml?.() ?? ''
    },
    // Kept for the `viewToStreamHtml` helper's type-narrowing path. Same
    // semantics as toHtml when streaming.
    toStream: (ctx) => renderForStream(ctx),
    mount: (parent, anchor) => {
      // Client-side mount: just delegate to children (suspense is a
      // server-side concept; on the client the resources hydrate-or-fetch
      // and components react via their normal `status()` reads).
      const v = renderChildren()
      return v.mount(parent, anchor)
    },
    hydrate: (slot) => {
      const v = renderChildren()
      return v.hydrate?.(slot) ?? (() => {})
    },
  }
}

// JSX-friendly wrapper around suspense(). The internal `suspense()`
// requires `children: () => Child` (a thunk) because the children
// re-evaluate after resources resolve. JSX naturally produces View or
// View[] children via `children` prop; this wrapper wraps the View
// children in a thunk for you so:
//
//     <Suspense fallback={<Skeleton/>} on={[r]}>
//       <PostBody />
//     </Suspense>
//
// works without the function-as-children dance. If you DO need
// per-render reactivity in children (re-evaluate on resolve to read
// `r.read()`), pass a function explicitly:
//
//     <Suspense fallback={<Skeleton/>} on={[r]}>
//       {() => <span>{r.read()}</span>}
//     </Suspense>
//
// The wrapper handles both: if children is a function, it's used
// as-is; otherwise the children are wrapped in `() => children`.

export interface SuspenseJSXProps {
  /** Rendered while `on` resources are pending. */
  fallback: View
  /** Resources to wait for. Suspense suspends until ALL resolve. */
  on: Resource<unknown>[]
  /** Children to render once resources resolve. Pass a function for
   *  reactive re-evaluation; otherwise a static View works. */
  children: View | (() => Child)
  /** When `false`, the renderer waits synchronously for resources
   *  before flushing. Default: `true` (streaming). */
  requireJs?: boolean
}

function _Suspense(props: SuspenseJSXProps): View {
  const childrenFn: () => Child =
    typeof props.children === 'function' ? props.children : () => props.children
  return suspense({
    fallback: props.fallback,
    on: props.on,
    children: childrenFn,
    ...(props.requireJs !== undefined ? { requireJs: props.requireJs } : {}),
  })
}

/**
 * Carries the `'suspense'` effect brand (T8-A; ADR 0030). A `view()`
 * body that returns JSX containing `<Suspense>` reading an unresolved
 * resource gets promoted to L3 (island+stream) — the L2 island
 * runtime ships AND the per-suspense streaming wiring is attached.
 */
export const Suspense: typeof _Suspense & EffectBranded<'suspense'> = _Suspense

// Walk a view's `toStream` if it has one (suspense), else fall back to
// `toHtml`. Static elements implement only `toHtml`; the wrapping suspense
// is the thing that knows about streaming.
function viewToStreamHtml(view: View, ctx: StreamCtx): string {
  const maybeSuspense = view as Partial<{ __isSuspense: true; toStream(ctx: StreamCtx): string }>
  if (maybeSuspense.__isSuspense && maybeSuspense.toStream) {
    return maybeSuspense.toStream(ctx)
  }
  // For non-suspense views, render via toHtml. Children that contain
  // suspense() are still handled because suspense's toHtml falls back
  // to fallback-or-children synchronously (see toHtml above) — meaning
  // a suspense inside a non-streaming render becomes a no-stream sync
  // render, which is the correct behavior for static-build use cases.
  // For a TRUE in-tree suspense walk inside a streaming render, the
  // user should place suspense() at the level they want streamed; the
  // renderer reaches it via toHtml's recursion through children.
  return view.toHtml?.() ?? ''
}

// ===== renderToStream — streaming SSR with resource() suspension =====

export interface RenderToStreamOptions {
  /** Same shape as handler()'s document option — wraps the body fragment. */
  document?: boolean | ((body: string) => string)
  /**
   * Per-request CSP script nonce. When set, every inline `<script>` the
   * renderer emits (the `__place` runtime + suspense swap chunks) gets
   * `nonce="${nonce}"`. The same nonce must be added to the response's
   * CSP `script-src` (use `generateScriptNonce()` once and pass the
   * value to both `renderToStream` and `renderSecurityHeaders`).
   *
   * Without a nonce, scripts are emitted without the attribute and rely
   * on `'unsafe-inline'` in the CSP — fine for development but rejected
   * by strict-CSP deployments.
   */
  scriptNonce?: string
}

const DEFAULT_DOC_SHELL = (body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${body}</body></html>`

/**
 * Render a View to a streamed Response body. The shell flushes
 * immediately; pending suspense boundaries hold the connection open
 * until their resources resolve, at which point a swap chunk is
 * appended (`<template id="c-N">…</template><script>__place.swap(N)</script>`).
 *
 * If the View tree has no `suspense()` boundaries, this emits one
 * chunk and closes — equivalent to `renderToString` wrapped in a
 * stream.
 */
export function renderToStream(
  view: View,
  options?: RenderToStreamOptions,
): ReadableStream<Uint8Array> {
  const shell =
    options?.document === false
      ? null
      : typeof options?.document === 'function'
        ? options.document
        : DEFAULT_DOC_SHELL
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        resetHydrationSeq()
        resetSuspenseSeq()
        const ctx = makeStreamCtx()
        // Set the module-level streaming context so any `suspense()`
        // anywhere in the View tree (including nested inside elements)
        // routes to the marker-emit path. Cleared in finally so static
        // renders after streaming aren't accidentally captured.
        currentStreamCtx = ctx
        let body: string
        try {
          // Initial render — collects pending boundaries + emits markers.
          // We just call view.toHtml() because all element factories
          // recursively traverse children via toHtml; suspense's toHtml
          // checks currentStreamCtx and switches behavior.
          body = view.toHtml?.() ?? viewToStreamHtml(view, ctx)
        } finally {
          currentStreamCtx = null
        }

        // Resolve any `requireJs:false` boundaries before flushing — they
        // need their content inlined into the shell, not streamed.
        const inlineBoundaries = ctx.pending.filter((b) => body.includes(`<!--inline:${b.id}-->`))
        if (inlineBoundaries.length > 0) {
          for (const b of inlineBoundaries) {
            try {
              await Promise.all(b.resources.map((r) => waitForResource(r)))
            } catch {
              // The boundary's render() handles error → fallback; nothing
              // for us to do here.
            }
            const rendered = b.render()
            body = body.replace(`<!--inline:${b.id}-->`, rendered)
          }
        }

        // Streaming boundaries (the ones we'll swap in later). Compute
        // upfront so we know whether to inject the inline runtime.
        const streaming = ctx.pending.filter((b) => !inlineBoundaries.includes(b))

        // Build the nonce attribute fragment once. Empty string when
        // no nonce is configured — those deployments rely on
        // 'unsafe-inline' or aren't streaming under CSP.
        const nonceAttr = options?.scriptNonce
          ? ` nonce="${escapeHtmlAttrFull(options.scriptNonce)}"`
          : ''

        // Inject the inline runtime at the start of body when there are
        // streaming boundaries to swap. Plain <script> (NOT module) so
        // it runs synchronously as parsed — guarantees __place.swap is
        // defined before any swap chunks arrive.
        if (streaming.length > 0) {
          body = `<script${nonceAttr}>${PLACE_RUNTIME}</script>${body}`
        }

        // Flush the shell. Chunk the initial HTML into ~16KB pieces so
        // the browser sees bytes incrementally — head + opening body
        // tags arrive in the first frame, browser starts parsing
        // CSS/scripts immediately, body content arrives in subsequent
        // frames. Reduces perceived TTFB on larger pages.
        //
        // True per-element streaming (yield per <tag>) would only help
        // if rendering itself were async; ours is synchronous string
        // concat. Chunking captures most of the perceptible benefit
        // without changing the View contract.
        const initialHtml = shell ? shell(body) : body
        const initialBytes = encoder.encode(initialHtml)
        const CHUNK_SIZE = 16 * 1024
        if (initialBytes.byteLength <= CHUNK_SIZE) {
          controller.enqueue(initialBytes)
        } else {
          for (let i = 0; i < initialBytes.byteLength; i += CHUNK_SIZE) {
            const end = Math.min(i + CHUNK_SIZE, initialBytes.byteLength)
            controller.enqueue(initialBytes.subarray(i, end))
          }
        }
        if (streaming.length > 0) {
          await Promise.all(
            streaming.map(async (b) => {
              try {
                await Promise.all(b.resources.map((r) => waitForResource(r)))
              } catch {
                // Render-time will fall back; no extra handling.
              }
              const rendered = b.render()
              const hydrationScript = emitHydrationCache(ctx.hydrate, nonceAttr)
              ctx.hydrate.clear()
              const chunk =
                `<template id="c-${b.id}">${rendered}</template>` +
                `${hydrationScript}<script${nonceAttr}>__place.swap(${b.id})</script>`
              controller.enqueue(encoder.encode(chunk))
            }),
          )
        }
        controller.close()
      } catch (e) {
        controller.error(e)
      }
    },
  })
}

// Emit a `<script>__place.r[key]=…</script>` chunk for the resources
// that have resolved since the last drain. Devalue is CSP-clean and
// handles Date/Map/Set/cycles. The values are escaped so a `</script>`
// in the data can't close the tag prematurely. The `nonceAttr` is the
// pre-built ` nonce="..."` fragment (may be empty string).
function emitHydrationCache(values: Map<string, unknown>, nonceAttr = ''): string {
  if (values.size === 0) return ''
  const parts: string[] = []
  for (const [key, value] of values) {
    const encoded = devalueStringify(value)
    // Escape closing-tag sequences that JSON might contain.
    const safeEncoded = encoded.replace(/<\//g, '<\\/')
    const safeKey = key.replace(/[\\']/g, (c) => `\\${c}`)
    parts.push(`__place.r['${safeKey}']=JSON.parse(${JSON.stringify(safeEncoded)})`)
  }
  return `<script${nonceAttr}>${parts.join(';')};</script>`
}

// Subscribe-and-wait for a resource. Returns when status is 'ready' OR
// 'error'. The renderer awaits these in parallel during the drain phase.
function waitForResource(r: Resource<unknown>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let stop: (() => void) | null = null
    let settled = false
    const dispose = (): void => {
      if (stop) {
        const s = stop
        stop = null
        s()
      }
    }
    // The watch reads `r.status()` reactively (no untrack) so it re-fires
    // when the resource transitions out of 'loading'. Once we resolve or
    // reject, we tear down via queueMicrotask to avoid disposing a watch
    // from inside its own first run.
    stop = watch(() => {
      const s = r.status()
      if (settled) return
      if (s.state === 'ready') {
        settled = true
        resolve()
        queueMicrotask(dispose)
      } else if (s.state === 'error') {
        settled = true
        reject(s.error)
        queueMicrotask(dispose)
      }
    })
  })
}

// ===== Static — opt out of hydration for a subtree =====
//
// Wrap a subtree that's purely visual (no event handlers, no reactive
// bindings) to skip hydration's recursion + listener-attach work. The
// DOM stays exactly as the server rendered it; no event listeners get
// attached, no watches get created.
//
//   <Static>
//     <header>...static page header...</header>
//   </Static>
//   <Counter />  {/* this DOES get hydrated */}
//
// Why this matters:
//   - Faster hydration on mostly-static pages — no per-element walk
//     into the static subtree
//   - Cheaper memory: no event listeners + watches for content that
//     would never use them
//   - Astro-style "islands of interactivity" without a build pipeline
//     or magic file convention. Default-hydrate, opt-out via Static —
//     simpler than React's "everything hydrates by default" + the new
//     `'use client'` magic-string boundary marker.
//
// What `<Static>` does NOT do:
//   - It still emits the children's HTML on the server (SSR works)
//   - It does NOT remove children from the View tree on the client —
//     the View is still constructed; only `hydrate()` skips recursion
//   - It does NOT prevent reactive children inside from re-rendering
//     on `mount` (used in CSR-only contexts) — `Static` is a hydration
//     opt-out, not a "this is static forever" marker

export const Static = (props: { children?: Children }): View => {
  const inner = Fragment(props)
  return {
    // SSR: identical to children. Static is a hydration-only marker.
    toHtml: () => inner.toHtml?.() ?? '',
    // CSR mount: identical to children. Static doesn't change runtime
    // mount behavior; it ONLY changes hydrate.
    mount: (parent, anchor) => inner.mount(parent, anchor),
    // Hydrate: consume one slot per element child but DO NOT recurse.
    // The SSR'd DOM stays exactly as rendered — no listener attach,
    // no watches, no content swap.
    hydrate(slot) {
      if (props.children !== undefined) {
        const list: Child[] = Array.isArray(props.children)
          ? (props.children as Child[])
          : [props.children as Child]
        for (const child of list) {
          if (child != null && typeof child === 'object' && 'mount' in child) {
            // Consume one element from the parent's slot. We don't
            // recurse — the SSR'd subtree stays untouched. Its data-h
            // markers stay too (cosmetic; invisible to users).
            slot.nextElement()
          }
        }
      }
      return () => {}
    },
  }
}

// ===== hydrate — client adoption of server-rendered DOM =====
//
// The companion to `renderToString`/`renderToStream`: on the client,
// instead of rebuilding the DOM via `mount` (which would briefly clear
// the SSR'd content and re-create it), `hydrate` walks the same View
// tree and adopts the existing DOM nodes — attaching event listeners
// and reactive watches without recreating the structure.
//
// Match contract: server's `data-h="<seq>"` markers + DFS order. Client
// walks View tree in the same DFS order; each `el()` View consumes the
// next element from a sibling cursor and verifies the tag matches.
// On mismatch, throws with the offending tag for fast debugging.
//
// State strategy — V0:
//   - URL-driven state (urlState) needs no serialization. Both sides
//     read the URL on mount and arrive at the same value. This is the
//     recommended pattern.
//   - Local component state (`state(0)`) defaulting identically on
//     both sides also matches.
//   - For diverging state (random initial values, post-mutation state),
//     a future cut adds a `<script type="place/state">` payload that
//     the client deserializes before hydrate. Not in V0.
//
// Children handling — V0:
//   - Element children are matched + adopted by their own `hydrate`.
//   - Text / function children are CLEARED and re-mounted fresh inside
//     the adopted parent. Cheap (text nodes only) and avoids the
//     adjacent-text-children boundary problem (the browser merges
//     `'hi, ' + name + '!'` into one text node and we can't recover
//     boundaries without explicit markers).
//   - Trade-off: brief flicker on text content for elements with
//     reactive children. Element structure + listeners are preserved,
//     so layout doesn't shift and clicks during hydration still work.
//   - Future: emit invisible boundary markers between adjacent text
//     children to enable per-child adoption.

// `hydrate` lives in `./_client-mount.ts` and is re-exported next to
// `mount` (see the re-export block above for the rationale).

// ===== serverRouter — METHOD + path pattern → handler dispatch =====
// Extracted to ./server-router.ts (audit Phase 2.1, Cut 1b). Re-exported
// for public consumers. `RouteHandler` is also used internally below
// (in `ServeRoutes` + `compileServeRoutes`) so we import the type.
import type { RouteHandler } from './server-router.ts'

export { type RouteHandler, type ServerRouter, serverRouter } from './server-router.ts'

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
) => IslandSsrResult<P> | null | undefined | void

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
 *
 * The header-based handoff replaced an earlier module-global collector
 * that the dispatcher opened *before* `await renderPage(...)` — a
 * race condition under concurrent requests, since the await let
 * another request overwrite the collector mid-flight (T6-H spam-
 * refresh path). Doing the collection synchronously inside renderPage
 * around `renderToString` (which doesn't await) makes the begin/end
 * span race-free.
 */
const INLINE_STYLE_HASHES_HEADER = 'x-place-inline-style-hashes'

// T6-B: per-render collection of inline `style="…"` attribute VALUES.
// Each unique value is hashed (SHA-256) and added to the response's
// CSP `style-src` directive along with `'unsafe-hashes'`, so strict
// CSP allows the specific inline styles SSR emitted without resorting
// to `'unsafe-inline'`. This preserves the ADR 0014 contract for the
// client path (style:* directives still write via `setProperty` at
// runtime) while letting the SSR pass keep emitting first-paint inline
// styles that the CSP authoritatively whitelists.
//
// Why a per-request collector, not a build-time list: the values are
// reactive — `style={() => …}` resolves per-render. The hash set is
// per-response.
let currentInlineStyleSet: Set<string> | null = null

/** Internal: start a fresh inline-style-attr collection scope. */
export function _beginInlineStyleCollection(): Set<string> {
  const set = new Set<string>()
  currentInlineStyleSet = set
  return set
}

/** Internal: end the inline-style-attr collection scope. */
export function _endInlineStyleCollection(): void {
  currentInlineStyleSet = null
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
export function _setIslandBundleUrls(
  urls: Readonly<Record<string, string>> | undefined,
): void {
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
    throw new TypeError('island: invalid arguments. Pass `island(fn)` or `island(import.meta.url, fn)`.')
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
  const ssrProps = options?.ssrProps as
    | IslandSsrPropsResolver<Record<string, unknown>>
    | undefined
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
    const strategyAttr =
      strategy !== 'load' ? ` data-view-strategy="${strategy}"` : ''
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
          return openTag + innerHtml + '</div>'
        } catch (e) {
          if (e instanceof ClientOnlyAbort || isBrowserGlobalRef(e)) {
            // Emit the marker with empty content. The island's bundle
            // will mount() the impl into the marker on the client (the
            // wrapper's `el.firstChild` check falls back to `mount`
            // when there's no existing content).
            return openTag + '</div>'
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
  // Render the registered component to get its View. Then wrap in
  // a marker div with the props serialized as a JSON attribute.
  const inner = reg.component(props.props as never)
  const strategy = validateClientStrategy(props.client)
  // Track this island + its strategy for the current render so
  // renderPage knows whether to emit an eager `<script>` or the
  // deferred-fetch shape. Lazily-initialized — if no collection scope
  // is active (e.g. island used outside a renderPage call), we still
  // render server-side, just no script emission.
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
      const strategyAttr =
        strategy !== 'load' ? ` data-view-strategy="${strategy}"` : ''
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

// ===== handler — Request → SSR Response =====
//
// Wraps a route function `(req) => View` into a `(req) => Response`,
// rendering the View to HTML via `renderToString`. Collapses the
// boilerplate of:
//
//   const body = renderToString(<Page ... />)
//   const html = `<!doctype html>...${body}...`
//   return new Response(html, { headers: { 'Content-Type': '...' } })
//
// to:
//
//   const ssr = handler((req) => <Page name={req.url} />)
//   return ssr(req)
//
// Capability scope: when invoked through `serve()`, each request runs
// inside a `runWithCapabilityScope()` boundary, so capabilities you
// `provide()` or `install()` during render are isolated from concurrent
// requests. Module-level `cap.install()` calls (e.g. an app-wide
// `Logger`) remain visible to every request as a baseline. If you call
// `handler()` outside `serve()` (custom dispatch), wrap your dispatcher
// in `runWithCapabilityScope` yourself for the same isolation.

export interface HandlerOptions {
  /** Response status code. Defaults to 200. Route fn throws → 500. */
  status?: number
  /** Extra response headers. `Content-Type: text/html; charset=utf-8`
   *  is set automatically; pass it to override. */
  headers?: HeadersInit
  /**
   * Wrap the rendered body in an HTML document shell.
   *
   * - `true` (default) → `<!doctype html><html lang="en"><head>...</head><body>${body}</body></html>`
   *   with a minimal `<head>` containing only `<meta charset="utf-8">`.
   * - `false` → return the body fragment as-is (useful when the view
   *   itself already starts with `<html>`).
   * - `(body) => string` → custom shell. Receives the rendered body,
   *   returns the full document. Use this to inject `<title>`, CSS,
   *   `<meta>` tags, hydration bootstrap script, etc.
   */
  document?: boolean | ((body: string) => string)
  /**
   * Use `renderToStream` and return a streamed `Response.body` instead
   * of buffering the full HTML in memory. Useful for large pages /
   * slow TTFB. The `document` option still applies (wraps the body
   * fragment); the stream emits one chunk in V0 — future cuts will
   * yield per-element chunks for true streaming.
   */
  stream?: boolean
}

export type Handler = (req: Request, params?: Record<string, string>) => Promise<Response>

const DEFAULT_SHELL = (body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${body}</body></html>`

export function handler(
  // Route fn receives `req` AND `params` (route-pattern captures from
  // serverRouter, e.g. `:id`). Direct callers without serverRouter get
  // `params = {}`. Async-await is supported.
  routeFn: (req: Request, params: Record<string, string>) => View | Promise<View>,
  options?: HandlerOptions,
): Handler {
  const shell =
    options?.document === false
      ? null
      : typeof options?.document === 'function'
        ? options.document
        : DEFAULT_SHELL
  const stream = options?.stream === true
  return async (req, params = {}) => {
    let view: View
    try {
      view = await routeFn(req, params)
    } catch (e) {
      // Don't leak stacks. Message-only, plain text — browsers don't
      // auto-execute response text/plain.
      return new Response(e instanceof Error ? e.message : String(e), {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    const baseHeaders = { 'Content-Type': 'text/html; charset=utf-8', ...options?.headers }
    if (stream) {
      // Render path differs but the document wrap stays consistent —
      // pass the same shell function through to renderToStream.
      const body = renderToStream(view, shell ? { document: shell } : { document: false })
      return new Response(body, { status: options?.status ?? 200, headers: baseHeaders })
    }
    const rendered = renderToString(view)
    const body = shell ? shell(rendered) : rendered
    return new Response(body, { status: options?.status ?? 200, headers: baseHeaders })
  }
}

// ===== page — declarative page object (server + client convergence) =====
//
// A `Page` bundles together everything both sides need to render the
// same page: how to derive props from the URL, how to load server-only
// data, what View to render, and how to wrap it in a document shell.
// Both `serve()` (server) and `boot()` (client) consume the same
// `Page` object — no duplication of URL-prop derivation or data
// extraction, no marker-class hacks to ferry server data to the client.
//
// Shape:
//
//   page({
//     url:   (url, params) => ({ name: url.searchParams.get('name') ?? 'visitor' }),
//     load:  async ({ req }) => ({ now: new Date().toISOString() }),
//     view:  ({ name, now }) => <Page name={name} now={now} />,
//     shell: { title: 'demo', css: '...' },
//   })
//
// What runs where:
//   - `url(url, params)`: BOTH server and client. Pure (no IO). Both
//     sides arrive at the same urlProps because both read the same URL.
//   - `load(ctx)`: SERVER ONLY. Result is JSON-serialized into a
//     `<script type="application/json" id="__place_load__">` inside the
//     SSR'd HTML. The client reads it back at boot time. Use for db
//     reads, server-only API calls, secrets-bearing computations.
//   - `view(props)`: BOTH sides. Server renders the View's HTML, client
//     hydrates the same View against that HTML.
//   - `shell`: SERVER ONLY. Document shell config (title, CSS, etc.).
//
// Anti-Next mistakes deliberately avoided:
//   - No file-system routing. Pages are registered explicitly via
//     `serve({ routes: { '/': home } })`. The path is data, not magic.
//   - No `'use client'` boundary marker. Pages render the same on both
//     sides; `<Static>` opts subtrees out of hydration explicitly.
//   - No implicit middleware / nested layouts. Compose with regular
//     functions — `serve({ routes: { '/': withAuth(home) } })`.
//   - No automatic data revalidation, no built-in cache. `load()` runs
//     per request; cache it yourself if you want.
//   - load() data is serialized into a SINGLE visible `<script>` tag,
//     not scattered across magic globals. Inspect it in devtools.

const PLACE_LOAD_SCRIPT_ID = '__place_load__'

/** Marker key on Page objects so serve()/boot() can recognize them. */
const PLACE_PAGE_BRAND = Symbol('place.page')

/**
 * Context passed to a page's `load()` function. `params` defaults to
 * the open `Record<string, string>` shape. The path-inferring `page()`
 * overloads override `params` with a typed record via intersection
 * (`LoadCtx & { params: ParamsOf<Path> }`) so consumers get
 * `ctx.params.id: string` (no `| undefined` under
 * `noUncheckedIndexedAccess`). Keeping `LoadCtx` non-generic avoids
 * inference cycles in the action-handler mapped type — `on:` keys
 * with malformed signatures previously triggered a TS2615 cycle when
 * `LoadCtx` was a generic instantiation.
 */
export interface LoadCtx {
  req: Request
  url: URL
  params: Record<string, string>
}

/** Definition handed to `page()`. Both `url` and `load` are optional. */
/**
 * Round 7: the view props type derived from a page definition's
 * generics. Combines URL-derived props (`U`), load-data (`L`), and the
 * typed search schema return (`S`) into one object. When `S` is `never`
 * (no `search:` declared), the `search` prop is omitted so the
 * destructure shape stays clean.
 *
 * This is the type the page's `view:` and `meta:` callbacks see —
 * `({ search, ...load, ...url })` works first-class, no cast.
 */
export type PageViewProps<U, L, S> = U &
  L &
  ([S] extends [never] ? Record<never, never> : { search: S })

/**
 * Round 7 cut 5 — typed `search` accessor.
 *
 * Pages declare `search: shape({...})`; the framework parses the URL
 * query params and exposes the result on `props.search`. At the type
 * level `PageDef.search` is `(raw: Record<string, string>) => S`, but
 * TypeScript's overload-resolution algorithm couldn't reliably infer
 * `S` through the multi-overload `page()` set we ship (we tried four
 * variations including a dedicated `SearchPageDef` with `S` isolated to
 * a single required field — TS still defaulted `S` to `never`/`unknown`
 * in practice). The honest interim is this one-line accessor:
 *
 * ```tsx
 * view: (props) => {
 *   const { q, tag } = useSearch<{ q?: string; tag?: string }>(props)
 *   return <List query={q} tag={tag} />
 * }
 * ```
 *
 * `useSearch<T>(props)` is just a typed cast over `props.search`. The
 * runtime validation comes from `shape()` (or any other parser the
 * page declares); this helper just surfaces the result type at the
 * call site without `as unknown as`. When TS's inference improves
 * (or our overload pattern is rewritten), the helper can be replaced
 * by `view: ({ search }) => …` mechanically — no API churn.
 *
 * @provisional — honest interim helper around an inference gap. May
 * be removed once `view: ({ search }) => …` infers correctly through
 * the page() overloads. Apps relying on it should be willing to do a
 * mechanical search-and-replace at that point.
 */
export function useSearch<T>(props: object): T {
  return (props as { search?: T }).search as T
}

export interface PageDef<U extends object = object, L extends object = object, S = unknown> {
  /** Derive props from the URL. Pure — runs on both server and client. */
  url?: (url: URL, params: Record<string, string>) => U
  /**
   * Load server-only data. Result is serialized into the SSR'd HTML and
   * read back by the client at boot. Sync or async.
   *
   * Path-inferring overloads of `page(path, def)` narrow `ctx.params`
   * via the overload's `def` argument type, not via a generic on PageDef
   * — keeping PageDef at 3 generics avoids a TS inference cycle in the
   * action-handler mapped type.
   */
  load?: (ctx: LoadCtx) => L | Promise<L>
  /** The View. Receives the merged `{ ...urlProps, ...loadData, search? }`. */
  view: (props: PageViewProps<U, L, S>) => View
  /**
   * Document metadata (title, description, OG, Twitter, etc.). Static
   * value or a function of the merged props for dynamic titles
   * ("My Post — My Site"). Runs server-side only.
   *
   * Three accepted shapes:
   *
   *   meta: 'Why place'                       // string → { title }
   *   meta: { title: 'Why place', og: { … } } // full PageMeta object
   *   meta: ({ post }) => ({ title: post.t }) // function for dynamic values
   *
   * When `meta` is omitted (or its `title` is omitted), the framework
   * auto-promotes the FIRST `<h1>` rendered in the body as the title.
   * Combined with the layout's `titleTemplate`, content pages can drop
   * `meta` entirely — `<h1>Why place</h1>` produces a final
   * `<title>Why place · place docs</title>`.
   */
  meta?:
    | PageMeta
    | string
    | ((props: PageViewProps<U, L, S>) => PageMeta | string)
  /**
   * Stylesheets. URL strings emit `<link rel="stylesheet">`, `{ inline }`
   * emits `<style>`. Pass an array to combine. The `tailwind()` helper
   * from `@place/component/tailwind` returns an `{ inline }` source.
   */
  styles?: StyleSrc | StyleSrc[]
  /** Extra response headers for this page (merged with serve()'s headers). */
  headers?: HeadersInit
  /**
   * Stream the response with `renderToStream`. Required for any page
   * whose view contains a `suspense()` with pending resources — without
   * this flag, the page renders synchronously via `renderToString` and
   * `suspense()` shows the fallback (because the sync renderer can't
   * await resources). Default: `false`.
   *
   * Streaming pages emit the shell + inline `__place` runtime + fallback
   * markers immediately; the response stays open until all pending
   * `suspense()` boundaries resolve, at which point swap chunks
   * (`<template id="c-N">…</template><script>__place.swap(N)</script>`)
   * are pushed to the client.
   */
  streaming?: boolean
  /**
   * Incremental Static Regeneration: cache the rendered HTML, serve it
   * for `ttl` seconds, then re-render in the background on the next
   * request after expiry (lazy stale-while-revalidate). Optional `tags`
   * make the entry invalidatable in bulk via `revalidate.tag('posts')`.
   *
   *   revalidate: 60                              // 60-second TTL
   *   revalidate: { ttl: 60, tags: ['posts'] }   // TTL + tag membership
   *
   * The cache key is `${pathname}${search}` — different query strings
   * cache separately. Headers, status, and Content-Type are preserved
   * across cache hits. ISR requires a `cache` option on `serve()`;
   * without one, this field is silently a no-op.
   *
   * Why no eager revalidation timer: a Bun process serving traffic on a
   * single replica is fine, but the moment you scale past one, eager
   * timers need leader election to avoid each replica re-rendering on
   * its own clock. Lazy SWR avoids this by tying revalidation to
   * incoming requests; coordination is implicit in routing.
   */
  revalidate?: number | { ttl: number; tags?: string[] }
  /**
   * For pages registered at a parameterized route (`/posts/:id`),
   * return the list of concrete `params` maps to pre-render at build
   * time via `buildStatic()`. Static routes (no `:` in the pattern)
   * don't need this — they pre-render once.
   *
   * Example:
   * ```ts
   * page({
   *   getStaticPaths: async () => [
   *     { id: 'a' }, { id: 'b' }, { id: 'c' },
   *   ],
   *   url: (_, params) => ({ id: params['id']! }),
   *   load: async ({ params }) => ({ post: await db.posts.find(params['id']) }),
   *   view: ({ post }) => …,
   * })
   * ```
   *
   * Used ONLY by `buildStatic()`. Has no effect on runtime SSR — the
   * server resolves `:id` per request as usual.
   */
  getStaticPaths?: () => Record<string, string>[] | Promise<Record<string, string>[]>
  /**
   * Layout chain wrapping this page. Layouts compose outside-in:
   * `layout: [rootLayout, userLayout]` means `<rootLayout><userLayout><page /></userLayout></rootLayout>`.
   *
   * Each layout's `load()` runs (in chain order, before page.load()), and
   * the merged loadData flows into all layouts' `view`/`meta` plus the
   * page's. Layout meta merges with page meta (page wins on scalar
   * conflicts); `htmlClass` / `bodyClass` concatenate. Layout styles are
   * emitted in `<head>` BEFORE the page's, so page styles can override.
   *
   * Pass a single layout (`layout: rootLayout`) for the common case.
   */
  layout?: AnyLayout | AnyLayout[]
  /**
   * Slot fills consumed by the page's layout chain. Each entry is a
   * thunk that returns the slot content; layouts in the chain call
   * `slots('name')` to render the fill in place. Slot names are typed
   * against the layout's declared key union when the page references
   * a typed `Layout<L, S>`:
   *
   * ```tsx
   * const dashboard = layout<{}, 'headerActions' | 'sidebar'>({ ... })
   *
   * const usersPage = page('/users', {
   *   layout: dashboard,
   *   slots: {
   *     headerActions: () => <NewUserButton />,
   *     sidebar: () => <UserFilters />,
   *   },
   *   view: () => <UserList />,
   * })
   * ```
   *
   * Unfilled slots resolve to `null`; layouts can also branch on
   * `slots.has('name')` to render fallbacks. No file conventions, no
   * `@`-prefixed parallel routes — just typed values flowing through.
   */
  slots?: SlotFills
  /**
   * Co-located actions (Round 5). Each entry is a server-side handler
   * the framework auto-registers at `POST {page.path}/_action/{key}`
   * with the full security pipeline (CSRF, same-origin, body limit,
   * proto-pollution). The matching typed caller is attached to the
   * page object under the same key:
   *
   * ```ts
   * const postPage = page('/posts/:id', {
   *   on: {
   *     delete: async (_input, { params }) => {
   *       await db.delete(params.id)
   *       return { ok: true }
   *     },
   *   },
   *   view: () => <button onClick={() => postPage.delete()}>Delete</button>,
   * })
   * ```
   *
   * Requires the two-arg `page(path, def)` form — `on:` needs a route
   * path to compose the `_action/{key}` endpoint. For more control
   * (custom paths, explicit input validators, middleware), use the
   * standalone `action()` factory instead.
   *
   * Each handler is `(input, ctx) => result` — same shape as `action()`'s
   * `fn`. `ctx` carries the request / URL / params. Input is unvalidated
   * by default; wrap with `shape()` inside the handler for typed parsing.
   */
  // biome-ignore lint/suspicious/noExplicitAny: user handlers are heterogeneous; `any` lets each declare its own (input, R)
  on?: Record<string, (input: any, ctx: LoadCtx) => any>
  /**
   * Typed search-param validator (Round 5). Receives a flat
   * `Record<string, string>` from `URL.searchParams` and returns the
   * typed parsed result. The parsed value is exposed on the view's
   * props under `search`:
   *
   * ```ts
   * page('/posts', {
   *   search: shape({ page: 'number', tag: 'string?' }),
   *   load: ({ url }) => db.posts(url.searchParams.get('page')),
   *   view: ({ data, search }) => <PostList page={search.page} />,
   * })
   * ```
   *
   * Any parser function works (`shape()` is the convention, but Zod /
   * Valibot / hand-rolled all compose). On parse failure, the page
   * routes to the dev error overlay (or production 500). The return
   * type flows into `view`'s props as `search: S` — `view: ({ search })
   * => …` is typed first-class without a cast.
   */
  search?: (raw: Record<string, string>) => S
  /**
   * Per-page error view (Round 5). When `load()` or `view()` throws,
   * the framework calls this with the error and renders its return
   * value as the response body — using the same security headers
   * + meta as a regular render. Useful for routes that need
   * route-specific error UI (admin's 500 vs public's 500).
   *
   * Falls through to the global dev error overlay (in dev) or the
   * minimal `text/plain` 500 (in production) if absent.
   */
  onError?: (err: Error, ctx: LoadCtx) => View
  /**
   * Per-page not-found view (Round 5). Throw `notFound()` from
   * `load()` to signal — the framework will catch and render this
   * view as a 404 response. Falls through to `serve({ notFound })`
   * (the global handler) if absent.
   */
  onNotFound?: (ctx: LoadCtx) => View
}

/**
 * Round 5 (5.7): symbol that marks an error as a "not found" signal.
 * Throw `notFound()` from `load()` to tell the framework to render
 * the page's `onNotFound` view (or fall through to the global handler).
 */
const NOT_FOUND_MARKER: unique symbol = Symbol.for('@place/component:notFound')

/**
 * Construct a not-found signal for `load()` to throw. The framework
 * catches and renders the page's `onNotFound` view as a 404 response.
 *
 * ```ts
 * page('/posts/:id', {
 *   load: async ({ params }) => {
 *     const p = await db.post(params.id)
 *     if (!p) throw notFound()
 *     return p
 *   },
 *   onNotFound: () => <h1>Post not found</h1>,
 *   view: ({ data }) => <Article post={data} />,
 * })
 * ```
 */
export function notFound(message = 'Not Found'): Error {
  const e = new Error(message)
  ;(e as Error & { [NOT_FOUND_MARKER]?: true })[NOT_FOUND_MARKER] = true
  return e
}

/** Internal: detect a not-found-marked error from `notFound()`. */
function isNotFoundError(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && (e as Record<symbol, unknown>)[NOT_FOUND_MARKER] === true
  )
}

// ===== layout — composable wrappers around pages =====
//
// Closes the gap with Next/Remix/SvelteKit: nested layouts that share
// data fetching, meta, and styles across multiple pages without the
// page having to know about them.
//
// Compared to Next's app/layout.tsx file convention: layouts here are
// typed values, imported and listed explicitly on the page that wants
// them. No magic file-system convention; renaming a file doesn't
// change which layouts apply.
//
// **Named slots** make this strictly better than Next.js parallel
// routes (`@modal/page.tsx` file convention) and Nuxt's single
// `<NuxtPage />` outlet. A layout declares which slots it renders;
// each page that uses the layout can fill those slots with typed
// content. No file conventions, no @-prefixed directories — just
// typed values flowing through.

export const PLACE_LAYOUT_BRAND = Symbol('place.layout')

/**
 * Slot fills the framework collects from a page and passes to its
 * layout chain. Each entry is a thunk that returns the slot content
 * — thunked so layouts can decide whether to render a slot
 * conditionally (skipping evaluation when not used).
 */
export type SlotFills = Readonly<Record<string, () => Child>>

/**
 * The `slots` argument a layout's view receives. A typed accessor:
 *   - `slots('headerActions')` returns the fill's `Child` or `null`.
 *   - `slots.has('sidebar')` for conditional rendering.
 *
 * The layout's own slot-name type parameter narrows autocomplete on
 * `slots(name)` so misspelled slot names are a TS error.
 */
export type LayoutSlots<S extends string = string> = {
  (name: S): Child
  has(name: S): boolean
}

function makeSlots<S extends string>(fills: SlotFills | undefined): LayoutSlots<S> {
  const fn = (name: S): Child => {
    const fill = fills?.[name]
    return fill ? fill() : null
  }
  ;(fn as LayoutSlots<S>).has = (name: S): boolean =>
    fills !== undefined && typeof fills[name] === 'function'
  return fn as LayoutSlots<S>
}

export interface LayoutDef<
  L extends object = Record<string, never>,
  S extends string = string,
> {
  /**
   * Server-only data load. The result merges into the props passed to
   * `view`, `meta`, and the inner page. Run BEFORE the page's `load()`
   * so the page can read layout-loaded data if it needs to.
   */
  load?: (ctx: LoadCtx) => L | Promise<L>
  /**
   * The layout view. Receives merged props from all layouts' loads +
   * the page's load + the page's url(), plus:
   *   - `children: View` — the already-rendered inner content.
   *   - `slots: LayoutSlots<S>` — typed accessor for pages' slot fills.
   *
   * ```tsx
   * layout<{}, 'headerActions' | 'sidebar'>({
   *   view: ({ children, slots }) => (
   *     <div>
   *       <header>{slots('headerActions')}</header>
   *       {slots.has('sidebar') ? <aside>{slots('sidebar')}</aside> : null}
   *       <main>{children}</main>
   *     </div>
   *   ),
   * })
   * ```
   */
  view: (props: L & { children: View; slots: LayoutSlots<S> }) => View
  /**
   * Layout-level metadata. Merged with the page's meta — scalar fields
   * (title, description, etc.) follow last-write-wins (page wins);
   * `htmlClass` and `bodyClass` are concatenated. For `og` / `twitter`
   * objects, the page's value replaces the layout's entirely.
   *
   * Setting `titleTemplate` here ('%s · my site') makes every page's
   * title compose with the template — see `PageMeta.titleTemplate`.
   *
   * Accepts a string shorthand (`'My Site'` → `{ title: 'My Site' }`)
   * for symmetry with `PageDef.meta`.
   */
  meta?: PageMeta | string | ((props: L) => PageMeta | string)
  /**
   * Stylesheets emitted in `<head>` BEFORE the page's styles, so the
   * page's styles can override the layout's.
   */
  styles?: StyleSrc | StyleSrc[]
}

/** Layout object — opaque, branded so isLayout() can detect it. */
export interface Layout<
  L extends object = Record<string, never>,
  S extends string = string,
> extends LayoutDef<L, S> {
  readonly [PLACE_LAYOUT_BRAND]: true
  /** Phantom — layout's declared slot key union, used by Page.slots typing. */
  readonly __slotKeys?: S
}

/**
 * Type-erased layout. Mirrors the AnyPage pattern: explicit `any`
 * props on the view/meta callbacks so a narrowed `Layout<{ user: User }>`
 * is assignable here without function-parameter contravariance grief.
 */
export interface AnyLayout {
  // biome-ignore lint/suspicious/noExplicitAny: variance escape hatch.
  load?: (ctx: LoadCtx) => any
  // biome-ignore lint/suspicious/noExplicitAny: variance escape hatch.
  view: (props: any) => View
  // biome-ignore lint/suspicious/noExplicitAny: variance escape hatch.
  meta?: PageMeta | string | ((props: any) => PageMeta | string)
  styles?: StyleSrc | StyleSrc[]
  readonly [PLACE_LAYOUT_BRAND]: true
}

/**
 * Define a composable layout. Wrap pages with `page({ layout, ... })`.
 *
 * ```ts
 * const rootLayout = layout({
 *   view: ({ children }) => (
 *     <html>
 *       <body>
 *         <Header />
 *         {children}
 *       </body>
 *     </html>
 *   ),
 * })
 *
 * // Layout with typed slots — pages declare which slot fills they
 * // provide; misspelled names are TS errors.
 * const dashboardLayout = layout<{}, 'headerActions' | 'sidebar'>({
 *   view: ({ children, slots }) => (
 *     <div>
 *       <header>{slots('headerActions')}</header>
 *       <aside>{slots('sidebar') ?? <DefaultSidebar />}</aside>
 *       <main>{children}</main>
 *     </div>
 *   ),
 * })
 *
 * const usersPage = page('/users', {
 *   layout: dashboardLayout,
 *   slots: {
 *     headerActions: () => <NewUserButton />,
 *     sidebar: () => <UserFilters />,
 *   },
 *   view: () => <UserList />,
 * })
 * ```
 */
export function layout<
  L extends object = Record<string, never>,
  S extends string = string,
>(def: LayoutDef<L, S>): Layout<L, S> {
  return { ...def, [PLACE_LAYOUT_BRAND]: true } as Layout<L, S>
}

export const isLayout = (x: unknown): x is AnyLayout =>
  x != null && typeof x === 'object' && (x as Record<symbol, unknown>)[PLACE_LAYOUT_BRAND] === true

/** Page object — both sides import the same one. */
export interface Page<U extends object = object, L extends object = object, S = never>
  extends PageDef<U, L, S> {
  readonly [PLACE_PAGE_BRAND]: true
  /**
   * Route path the page is mounted at. Set by the two-arg `page(path, def)`
   * overload (Round 5 — co-locates path with its page module). The legacy
   * `page(def)` form leaves this `undefined`; `serve({routes})` carries
   * the path externally there.
   */
  readonly path?: string
  /**
   * Internal — handlers registered from the `on:` dict, keyed by the
   * derived path (`{page.path}/_action/{key}`). `serve()` reads this
   * field and spreads each handler into its routes table so the
   * actions are reachable as POST endpoints.
   *
   * Underscore-prefixed → out of the stability covenant's public
   * surface. Internal to the framework.
   */
  readonly _onHandlers?: Record<string, RouteHandler>
}

/**
 * `page()`'s return type when the page declares `on:` — intersected
 * with typed callers, one per key. Each caller takes the same input
 * the handler expects and returns a `Promise<R>` where R is the
 * handler's return type.
 *
 * Exported for callers who want to type a page reference precisely.
 */
export type PageWithOn<
  U extends object,
  L extends object,
  // biome-ignore lint/suspicious/noExplicitAny: variance — user handlers are heterogeneous; input/output per handler are independent
  On extends Record<string, (input: any, ctx: LoadCtx) => any>,
> = Page<U, L> & {
  readonly [K in keyof On]: On[K] extends (input: infer I, ctx: LoadCtx) => infer R
    ? (input?: I) => Promise<Awaited<R>>
    : never
}

/**
 * Construct a Page. Two forms:
 *
 * 1. **`page(def)`** — legacy shape. Use with `serve({ routes: { '/path': page } })`
 *    where the routes object owns the path.
 *
 * 2. **`page(path, def)`** — Round 5. Co-locates the route path with the
 *    page module:
 *
 *    ```ts
 *    export default page('/posts/:id', {
 *      load: ({ params }) => db.post(params.id),
 *      view: ({ data }) => <h1>{data.title}</h1>,
 *    })
 *    ```
 *
 *    Use with `app([home, post]).serve()` (the `app()` factory reads each
 *    page's `path` and builds the routes object automatically). The path
 *    appears exactly once in the codebase — where the page is defined.
 */
// Most specific overload first (TS picks the first matching). When
// `on:` is present on the def, the return type intersects typed
// callers (`pageRef.{actionKey}(input?)`) so consumers can invoke
// actions without casting. The other overloads (without On) fire when
// `on:` is absent.
// Implementation-signature widening types. Every overload narrows
// these at the call site. Declared BEFORE the overload set so TS sees
// them as adjacent to the implementation (overload declarations must
// be contiguous with the implementation).
//
// `any` (not `object`/`unknown`) for the generic positions because
// PageDef's `view: (props: …) => View` puts U/L/S in a contravariant
// position. Narrower overloads (e.g. `PageDef<ParamsOf<Path>, …>`)
// aren't assignable to `PageDef<object, object, unknown>` since
// `(x: ParamsOf<Path>) => View` cannot be called as `(x: object) =>
// View`. `any` neutralizes the variance check at this internal
// boundary; public-facing overloads keep their precise generics.
// biome-ignore lint/suspicious/noExplicitAny: implementation-signature widener
type AnyPageDef = PageDef<any, any, any>
// biome-ignore lint/suspicious/noExplicitAny: implementation-signature widener
type AnyPageResult = Page<any, any, any>

// Overload set: order matters (TS picks the first match). Param
// inference from the path string comes BEFORE the explicit-generic
// overloads so the common path (`page('/posts/:id', { load, view })`)
// gets `params: { id: string }` typed without the caller writing a
// generic. Explicit-generic callers (`page<{ id: number }>('/posts/:id', …)`)
// still land on the explicit overloads since `{id: number}` cannot
// satisfy `Path extends string`.
//
// `S` is captured via a separate inference site (`search: (...) => S`)
// so the search function's return type flows into the view's props
// before TS tries to bind `S` from anywhere else. Without the explicit
// search-typed overloads, the default `S = never` wins and downstream
// destructure like `view: ({ search }) => …` lands on `never`.

// (1a) Inferred params + on:. Fires when the caller writes a literal
//      path string and does not pre-specify generics. `Path extends string`
//      narrows to the literal so `ParamsOf<Path>` evaluates to the
//      typed-record shape (`/posts/:id` → `{ id: string }`). The
//      shape flows into `load(ctx).params` via the inline intersection
//      `LoadCtx & { params: ParamsOf<Path> }`. Action handlers in
//      `on:` keep the open `Record<string, string>` ctx.params
//      (handlers needing typed params can annotate locally).
export function page<
  Path extends string,
  L extends object,
  // biome-ignore lint/suspicious/noExplicitAny: handler input/output types per-key are heterogeneous
  On extends Record<string, (input: any, ctx: LoadCtx) => any>,
>(
  path: Path,
  def: Omit<PageDef<ParamsOf<Path>, L>, 'on' | 'load'> & {
    on: On
    load?: (ctx: LoadCtx & { params: ParamsOf<Path> }) => L | Promise<L>
  },
): Page<ParamsOf<Path>, L> & {
  readonly [K in keyof On]: On[K] extends (input: infer I, ctx: LoadCtx) => infer R
    ? (input?: I) => Promise<Awaited<R>>
    : never
}
// (1b) Inferred params, no on:.
export function page<
  Path extends string,
  L extends object = Record<string, never>,
  S = unknown,
>(
  path: Path,
  def: Omit<PageDef<ParamsOf<Path>, L, S>, 'load'> & {
    load?: (ctx: LoadCtx & { params: ParamsOf<Path> }) => L | Promise<L>
  },
): Page<ParamsOf<Path>, L, S>
// (1c) View-fn shorthand: `page(path, () => <X />)` ≡
//      `page(path, { view: () => <X /> })`. Lands AFTER (1a)/(1b) so
//      on:-form and def-form calls resolve before TS considers this
//      function-form path — important because letting TS explore (0)
//      before (1a) triggers a TS2615 inference cycle on the on: mapped
//      type when handlers have malformed signatures.
export function page<Path extends string>(
  path: Path,
  viewFn: () => View,
): AnyPageResult
// (2) Explicit-generic path + def with on: → typed actions intersected
//     with caller. Kept for back-compat with callers that pre-specify U
//     (e.g. `page<{ id: number }>` when params need parsing into a
//     non-string shape) — TS still defaults to inference (1a/1b) when no
//     generic is supplied.
export function page<
  U extends object,
  L extends object,
  // biome-ignore lint/suspicious/noExplicitAny: handler input/output types per-key are heterogeneous
  On extends Record<string, (input: any, ctx: LoadCtx) => any>,
>(
  path: string,
  def: Omit<PageDef<U, L>, 'on'> & { on: On },
): Page<U, L> & {
  readonly [K in keyof On]: On[K] extends (input: infer I, ctx: LoadCtx) => infer R
    ? (input?: I) => Promise<Awaited<R>>
    : never
}
// (3) Explicit-generic def-only fallback.
export function page<
  U extends object = Record<string, never>,
  L extends object = Record<string, never>,
  S = unknown,
>(def: PageDef<U, L, S>): Page<U, L, S>
// (4) Explicit-generic path + def fallback.
export function page<
  U extends object = Record<string, never>,
  L extends object = Record<string, never>,
  S = unknown,
>(path: string, def: PageDef<U, L, S>): Page<U, L, S>
// Implementation — uses the widened types declared above. Must
// immediately follow the overload declarations.
//
// Both params typed as `any` because the overload set is heterogeneous
// (paths as literal-typed strings, view-fn shorthand, on:-typed defs
// that intersect with caller types) — TS's overload-vs-impl variance
// check can't simultaneously satisfy every overload's signature
// against any precisely-typed impl. The public surface stays typed
// via the overloads above; runtime safety lives in the `typeof`
// discrimination below.
// biome-ignore lint/suspicious/noExplicitAny: implementation-signature widener
export function page(pathOrDef: any, maybeDef?: any): AnyPageResult {
  if (typeof pathOrDef === 'string') {
    if (maybeDef === undefined) {
      throw new Error('page(path, def): the second argument (definition) is required')
    }
    if (pathOrDef.length === 0 || !pathOrDef.startsWith('/')) {
      throw new Error(`page(): path must start with '/' (got '${pathOrDef}')`)
    }
    // View-fn shorthand: wrap into `{ view: fn }` and delegate to the
    // standard buildPage path. The runtime shape stays identical.
    const def: AnyPageDef =
      typeof maybeDef === 'function'
        ? ({ view: maybeDef } as AnyPageDef)
        : (maybeDef as AnyPageDef)
    return buildPage(pathOrDef, def)
  }
  if (pathOrDef.on !== undefined && Object.keys(pathOrDef.on).length > 0) {
    throw new Error(
      'page(def): the `on:` action dict requires the two-arg form page(path, def) — ' +
        'on:-actions register at `{page.path}/_action/{key}` and need a path to compose with.',
    )
  }
  return buildPage(undefined, pathOrDef)
}

/**
 * Internal: builds the runtime Page object. When `on:` is set, each
 * entry becomes:
 *
 *   1. An `action()` registered at `{path}/_action/{key}` with the
 *      same security pipeline (CSRF, same-origin, body limit, proto
 *      pollution) as a hand-written `action()`.
 *   2. A typed caller exposed as a property of the returned page
 *      object — `pagePage.{key}(input?)` invokes the action.
 *   3. A handler entry stashed under `_onHandlers` for `serve()` to
 *      spread into its routes table.
 */
function buildPage<U extends object, L extends object, S>(
  path: string | undefined,
  def: PageDef<U, L, S>,
): Page<U, L, S> {
  // Wrap the user's view in `component()`. This routes the view body
  // through the component-factory's toHtml / hydrate / mount paths so
  // any `ClientOnlyAbort` (thrown by `cap.use()` for a clientOnly cap
  // during SSR) is caught at the boundary and substituted with the
  // auto-placeholder span. Apps never have to mark pages client-only
  // — the signaling is structural, originating at the cap's call.
  //
  // We capture `def.view` (the user's function) and produce a
  // `(props) => View` that the rest of the framework treats identically
  // to the original page view. The component wrapper is purely additive:
  // for pages that DON'T touch clientOnly caps, the body executes
  // normally on both runtimes.
  const wrappedView = component(def.view as (props: object) => View)
  const base = {
    ...def,
    view: wrappedView,
    [PLACE_PAGE_BRAND]: true,
  } as Record<string, unknown>
  if (path !== undefined) base['path'] = path
  const onDict = def.on
  if (onDict !== undefined && Object.keys(onDict).length > 0) {
    if (path === undefined) {
      // Defensive — the single-arg overload guard above already caught
      // this, but the internal builder is the safest place to re-check.
      throw new Error("page(): `on:` requires a path; use page('/path', def)")
    }
    const handlers: Record<string, RouteHandler> = {}
    for (const [key, fn] of Object.entries(onDict)) {
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        throw new Error(
          `page(): on-action key '${key}' must be a valid JS identifier ` +
            '([a-zA-Z_][a-zA-Z0-9_]*) — it becomes a method on the page object.',
        )
      }
      if (key in base) {
        throw new Error(
          `page(): on-action key '${key}' collides with an existing page field. ` +
            "Rename the action (e.g. '{key}Action') or remove the conflicting field.",
        )
      }
      const actionPath = `${path}/_action/${key}`
      const a = action<unknown, unknown>({
        path: `POST ${actionPath}`,
        // Identity validator — users wrap with `shape()` inside fn if
        // they want typed input parsing. Keeps `on:` shape uniform.
        input: (raw: unknown) => raw,
        fn: fn as (input: unknown, ctx: LoadCtx) => unknown | Promise<unknown>,
      })
      // Expose the typed caller as a method on the page object.
      base[key] = a.call
      // Stash the route handler. `serve()` spreads these in.
      Object.assign(handlers, a.handler)
    }
    base['_onHandlers'] = handlers
  }
  return base as unknown as Page<U, L, S>
}

/** Type predicate: `true` if `x` is a `Page` (constructed via `page()`).
 *  Used internally by `serve()`'s route compilation and by `buildStatic`
 *  to distinguish Pages from raw `(req, params) => Response` handlers
 *  in the same routes map. Public so adapters / tooling can use it too. */
export const isPage = (x: unknown): x is Page =>
  x != null && typeof x === 'object' && (x as Record<symbol, unknown>)[PLACE_PAGE_BRAND] === true

// Escape JSON for safe embedding inside a `<script>` tag. The standard
// gotcha: a literal `</script>` in the JSON would close the tag. Also
// escape `<!--` (HTML comment open) for paranoia. The escaped output is
// still valid JSON (\uXXXX is JSON-legal everywhere).
// JS line terminators. Not in source as literals (some toolchains
// stumble on them); built from char codes to keep this file plain ASCII.
const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)

function escapeForJsonScript(json: string): string {
  // Escape characters that would otherwise break out of a <script> tag,
  // and JS line terminators that pre-ES2019 string-literal parsers
  // cannot handle (relevant if the JSON gets inlined into a script).
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(LS)
    .join('\\u2028')
    .split(PS)
    .join('\\u2029')
}

/** Options for `renderPage` — primarily the bootstrap script src that
 *  serve() injects (so individual pages don't repeat `/client.js`). */
export interface RenderPageOptions {
  /** URL of the hydration bootstrap module. Emitted as
   *  `<script type="module" src="…">` at the bottom of <body>. */
  bootstrap?: string
  /**
   * Inject the inline SPA-navigation runtime (T5-D phase 2). Set by
   * `serve()` when the app has `islands:` configured. The runtime
   * intercepts `<Link>` clicks, fetches the destination HTML,
   * swaps `<main>`, and dispatches `place:nav` so the router + each
   * island's auto-mount wrapper update without a full page reload.
   * Adds ~600 B gzipped to every page that's part of an islands app.
   */
  enableSpaNav?: boolean
  /**
   * Inject the dev-mode live-reload client script. Set by `serve()`
   * when `NODE_ENV !== 'production'` so every dev-mode page opens a
   * WebSocket back to the server; on reconnect (server restarted)
   * the client calls `location.reload()`. ~250 bytes gzipped inline.
   * See `./__hmr.ts` for the full client + server contract.
   */
  enableHmr?: boolean
  /**
   * App-supplied early-paint inline-JS statements. Each entry is a
   * raw JS statement (NOT wrapped in `<script>`); the framework wraps
   * with a nonced `<script>` and emits at the top of `<head>`, AFTER
   * the framework's built-in `placeEarly()` hints (platform, motion).
   *
   * Use for app-specific hints that need to feed the very first paint
   * — analytics consent, feature-flag bucketing, RTL/LTR locale class,
   * etc. Discipline rules in `__early.ts` apply (idempotent, no throw,
   * sub-millisecond, write to `document.documentElement` only).
   */
  extraEarlyHead?: readonly string[]
  /**
   * When `enableSpaNav` is on, wrap each `<main>` swap in
   * `document.startViewTransition()` for a ~250 ms cross-fade.
   *
   * **Default is `false` (instant nav).** The fade defeats the
   * framework's actual sub-5 ms swap perf and was the leading source
   * of "page transitions feel slow" feedback once SRI unblocked the
   * islands. `serve()` reads this from `ServeOptions.viewTransitions`
   * so the app-level config flows in.
   */
  spaNavViewTransitions?: boolean
  /**
   * SRI hashes for the emitted scripts (T5-D phase 2 / ADR 0025). The
   * framework computes SHA-384 of each bundle at build time; renderPage
   * emits `integrity="sha384-…" crossorigin="anonymous"` on each
   * `<script>` tag whose `src` matches a key here. Browsers verify the
   * fetched bytes before executing — closes CDN-tampering / MITM.
   */
  scriptIntegrity?: Readonly<Record<string, string>>
  /**
   * Per-request CSP script nonce. Applied to:
   *   - The `__place_load__` data script (page's serialized load data)
   *   - The streaming runtime + suspense swap chunks (when `streaming: true`)
   *
   * The same nonce must appear in the response's CSP `script-src`. Use
   * `generateScriptNonce()` once per request and pass to both `renderPage`
   * and `renderSecurityHeaders`.
   */
  scriptNonce?: string
  /**
   * Class to merge into `<html class="…">` after the page's own
   * `meta.htmlClass`. Used by serve()-level concerns that want to
   * influence the document root without touching every page (e.g.
   * `serve({ theme })` injecting the active theme class). Empty string
   * is treated as "no merge".
   */
  htmlClassPrefix?: string
  /**
   * Layouts to wrap OUTSIDE the page's own `layout` chain. Used by
   * serve()-level defaults — e.g. `serve({ layout: rootLayout })`
   * applies `rootLayout` to every page without each page redeclaring
   * it. The outermost layout in this list is the outermost wrapper
   * overall.
   */
  extraLayouts?: readonly AnyLayout[]
  /**
   * Post-render body transform hook. Mirrors `ServeOptions.transformBody`
   * (see that JSDoc for the full design rationale). `serve()` threads
   * its own option here so layouts + per-page renders both apply the
   * same transformation.
   *
   * Sync only. Runs after `renderToString(view)`, before document
   * wrapping. Throwing aborts the render with a 500 (routed through
   * the standard error overlay).
   */
  transformBody?: (body: string, ctx: { req: Request; url: URL }) => string
}

/**
 * Round 5 (5.7): render a Page's `onError` / `onNotFound` view with the
 * same layout/meta/styles pipeline as a regular render. Used by
 * `renderPage()` when the page declares its own error or not-found
 * handler — keeps the response shape consistent (same head, same
 * layouts, same security headers).
 */
async function renderPageWithCustomView(
  p: AnyPage,
  view: View,
  _ctx: LoadCtx,
  layouts: readonly AnyLayout[],
  options: RenderPageOptions | undefined,
  status: number,
): Promise<Response> {
  // Wrap view in layouts inside-out (same composition as renderPage).
  // Error views have no slot fills (the page that errored may have
  // declared slots but its render failed) — slot accessors all
  // return null. Layouts must gracefully handle empty slots.
  const emptySlots = makeSlots<string>(undefined)
  let wrapped: View = view
  try {
    for (let i = layouts.length - 1; i >= 0; i--) {
      const l = layouts[i] as AnyLayout
      wrapped = l.view({
        children: wrapped,
        slots: emptySlots,
      } as Parameters<typeof l.view>[0])
    }
  } catch {
    // If a layout itself throws here, fall back to plain body — better
    // to render a no-layout error page than to crash the error path.
  }
  const metas: PageMeta[] = []
  for (const l of layouts) {
    const lMeta = resolveMeta(l.meta, {})
    if (lMeta) metas.push(lMeta)
  }
  const pageMeta = resolveMeta(p.meta, {})
  if (pageMeta) metas.push(pageMeta)
  const meta = metas.length === 0 ? undefined : mergeMeta(metas)
  // Render view to HTML (sync path — error/notFound views shouldn't suspend).
  const body = wrapped.toHtml?.() ?? ''
  const docHtml = renderDocument(body, {
    ...(meta ? { meta } : {}),
    ...(options?.bootstrap ? { bootstrap: options.bootstrap } : {}),
  })
  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' })
  if (p.headers) {
    new Headers(p.headers).forEach((v, k) => {
      headers.set(k, v)
    })
  }
  return new Response(docHtml, { status, headers })
}

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
  const ctx: LoadCtx = { req, url, params }
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
      const streamEarlyHead = options?.enableSpaNav
        ? [placeEarly(), ...(options.extraEarlyHead ?? [])]
        : []
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
    const onlyInteraction =
      strategies.size === 1 && strategies.has('interaction')
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
    ? `<script${nonceAttr}>${placeSpaNav({ viewTransitions: options?.spaNavViewTransitions === true })}</script>`
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
  const tabsScript = options?.enableSpaNav
    ? `<script${nonceAttr}>${placeTabs()}</script>`
    : ''
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
    const markerRe = new RegExp(
      `<div data-view="island" data-view-id="${name}"`,
      'g',
    )
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
  const hmrScript = options?.enableHmr
    ? `<script${nonceAttr}>${placeHmr()}</script>`
    : ''
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
  const earlyHead = options?.enableSpaNav
    ? [placeEarly(), ...(options.extraEarlyHead ?? [])]
    : []
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
    deferredBody + spaNavScript + tabsScript + viewportScript + copyScript + deferredScript + hmrScript + dataScript,
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
function resolveMeta(
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

function mergeMeta(metas: PageMeta[]): PageMeta {
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
//
// When `view()` or `load()` throws during render, dev mode returns an
// HTML page with the stack trace + offending URL. Production returns a
// minimal `text/plain` 500 (no stack leakage) — same shape as the
// pre-overlay default. Switch via `NODE_ENV`.
//
// Why this matters: every framework I checked (Vite, Next, SvelteKit,
// SolidStart) ships an error overlay. Without one, a render-time throw
// produces a blank 500 page and the dev hits the terminal/log to find
// the problem. The browser overlay is where dev attention already is.

const isProductionRuntime = (): boolean =>
  typeof process !== 'undefined' && process.env && process.env['NODE_ENV'] === 'production'

async function renderRouteError(
  error: unknown,
  req: Request,
  phase: 'load' | 'render',
): Promise<Response> {
  const err = error instanceof Error ? error : new Error(String(error))
  if (isProductionRuntime()) {
    // Production: minimal-info 500. Don't leak the stack to the browser.
    return new Response(`Internal Server Error: ${err.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
  // Dev: pretty HTML overlay with stack + request URL.
  //
  // **Set the overlay's own CSP.** The overlay contains a large inline
  // `<style>` block + a tiny inline copy-to-clipboard `<script>`. The
  // dispatcher's `mergeHeaders` merges the request's baseHeaders CSP
  // onto every response (page-wins-on-conflict). If the overlay's
  // response leaves CSP unset, baseHeaders' CSP — which has a tight
  // `style-src 'self' 'sha256-...'` whose hashes were computed for
  // the FAILED render's inline-style attrs (probably none) — wins
  // and blocks the overlay's own styling. Result: an unstyled error
  // page in dev, exactly the bug the user reported.
  //
  // We set `'unsafe-inline'` on `style-src` + `script-src` here
  // because the overlay is FRAMEWORK-CONTROLLED HTML in DEV ONLY
  // (prod returns text/plain). No user-input renders unsafely (every
  // error field is escaped via `escapeHtmlAttrFull`), so the relaxed
  // policy is safe AND keeps the overlay readable. Other security
  // headers (frame-ancestors, X-Content-Type-Options, etc.) stay
  // tight via the merged baseHeaders.
  const body = await formatDevErrorOverlay(err, req, phase)
  return new Response(body, {
    status: 500,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "font-src 'self' data:; " +
        "frame-ancestors 'none'; base-uri 'self'",
    },
  })
}

/**
 * Parsed stack frame. Source paths come from the runtime's source-map
 * resolution (Bun maps bundled positions back to original source via
 * the inline source maps emitted by A1's `sourcemap: 'inline'` build
 * option) — this function only converts the stack-string format into
 * structured data, not source-map positions.
 *
 * `scope`:
 *   - `user` — path under cwd, not in node_modules
 *   - `framework` — under node_modules or a `systems/` sibling
 *   - `unknown` — couldn't classify (no path, native frame, etc.)
 *
 * Exported for unit testing. Real consumers don't import this directly.
 */
export interface StackFrame {
  fn: string | null
  file: string
  line: number
  col: number
  raw: string
  scope: 'user' | 'framework' | 'unknown'
}

/**
 * Parse a V8/Firefox-shaped stack into structured frames.
 *
 * V8 (Node, Bun, Chromium): `    at fn (file:///path:line:col)` and
 * the anonymous form `    at file:///path:line:col`.
 * Firefox: `fn@file:///path:line:col`.
 *
 * Both formats have been stable for years; the contract is the
 * format itself, not heuristic matching. Returns `[]` if the stack
 * is null/empty or contains no recognizable frames (callers fall
 * through to the raw stack as a `<details>` block).
 *
 * Exported for unit testing.
 */
export function parseStackFrames(stack: string | undefined, cwd: string): StackFrame[] {
  if (!stack) return []
  const lines = stack.split('\n')
  const out: StackFrame[] = []
  // V8 with fn name: "    at fnName (file:///path:line:col)"
  const v8Named = /^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)\s*$/
  // V8 anonymous: "    at file:///path:line:col"
  const v8Anon = /^\s*at\s+(.+):(\d+):(\d+)\s*$/
  // Firefox: "fnName@file:///path:line:col"  (or "@file:..." for anon)
  const firefox = /^(.*?)@(.+):(\d+):(\d+)\s*$/
  for (const line of lines) {
    let m = line.match(v8Named)
    if (m) {
      out.push(makeFrame(m[1] ?? null, m[2] ?? '', toNum(m[3]), toNum(m[4]), line, cwd))
      continue
    }
    m = line.match(v8Anon)
    if (m) {
      out.push(makeFrame(null, m[1] ?? '', toNum(m[2]), toNum(m[3]), line, cwd))
      continue
    }
    m = line.match(firefox)
    if (m) {
      const fn = m[1] ?? ''
      out.push(makeFrame(fn === '' ? null : fn, m[2] ?? '', toNum(m[3]), toNum(m[4]), line, cwd))
    }
    // Lines that don't match (the leading "Error: msg" line, native
    // frames, etc.) are skipped — the raw stack <details> still
    // shows them verbatim.
  }
  return out
}

function toNum(s: string | undefined): number {
  return s === undefined ? 0 : Number.parseInt(s, 10)
}

function makeFrame(
  fn: string | null,
  file: string,
  line: number,
  col: number,
  raw: string,
  cwd: string,
): StackFrame {
  // Strip file:// prefix for path classification + display.
  const cleaned = file.replace(/^file:\/\//, '')
  return { fn, file: cleaned, line, col, raw, scope: classifyScope(cleaned, cwd) }
}

function classifyScope(file: string, cwd: string): 'user' | 'framework' | 'unknown' {
  if (!file) return 'unknown'
  // node:* and native frames are framework.
  if (file.startsWith('node:')) return 'framework'
  // Anything under node_modules is framework regardless of its location.
  if (file.includes('/node_modules/')) return 'framework'
  // The platform's own systems/ tree is framework noise for app devs.
  if (file.includes('/systems/')) return 'framework'
  // Under cwd → user code. We don't require a strict match because cwd
  // can have symlinks; checking the suffix is good enough for grouping.
  if (file.startsWith(cwd) || file.includes(cwd)) return 'user'
  return 'unknown'
}

/**
 * Build the editor-link href for a frame (vscode:// for VSCode, falls
 * back to a plain path otherwise). Browsers without a vscode:// handler
 * just show it as a non-functional link — the file path is still
 * visible. Exported for tests.
 */
export function frameEditorHref(frame: StackFrame): string {
  if (!frame.file) return ''
  // VSCode protocol — Cursor/Codium honor the same scheme.
  return `vscode://file/${frame.file}:${frame.line}:${frame.col}`
}

/**
 * Categorize an error so the overlay can pick an accent color, icon, and
 * a tailored "how to fix" hint. Default category is `runtime` (red) which
 * matches the previous overlay's vibe.
 */
interface ErrorCategory {
  /** Display label shown in the overlay status strip. */
  label: string
  /** Accent color (oklch) used by the hero + tag + caret. */
  accent: string
  /** Inline SVG path data (24x24 viewBox) for the category icon. */
  iconPath: string
}

function categorizeError(err: Error): ErrorCategory {
  const msg = err.message
  const name = err.name
  // Capability errors are common in dev; pull them out specifically.
  if (/capability ['"][^'"]+['"] (?:not provided|required but not installed)/.test(msg)) {
    return {
      label: 'Capability missing',
      // Amber — capability errors are usually config gaps, not bugs.
      accent: 'oklch(0.78 0.16 65)',
      iconPath:
        // Plug icon outline
        'M9 2v6M15 2v6M5 8h14v3a7 7 0 0 1-14 0V8zM12 18v4',
    }
  }
  if (name === 'TypeError') {
    return {
      label: 'Type error',
      accent: 'oklch(0.71 0.19 13)',
      iconPath:
        'M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
    }
  }
  if (name === 'ReferenceError') {
    return {
      label: 'Reference error',
      accent: 'oklch(0.71 0.19 13)',
      iconPath: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0zM9 9h6v6H9z',
    }
  }
  if (name === 'SyntaxError') {
    return {
      label: 'Syntax error',
      accent: 'oklch(0.78 0.16 65)',
      iconPath: 'm16 18 6-6-6-6M8 6l-6 6 6 6',
    }
  }
  if (/notFound|404/i.test(msg) || /^NotFound/.test(name)) {
    return {
      label: 'Not found',
      accent: 'oklch(0.72 0.14 240)',
      iconPath: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.35-4.35',
    }
  }
  if (/timeout|timed out|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return {
      label: 'Network',
      accent: 'oklch(0.72 0.14 240)',
      iconPath: 'M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93 4.93 19.07',
    }
  }
  // Default: red runtime error.
  return {
    label: `${name} thrown`,
    accent: 'oklch(0.71 0.19 13)',
    iconPath:
      'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  }
}

/**
 * Extract a "Try this" structured hint from a capability error message.
 * Returns null for any other error shape (the overlay falls back to its
 * default copy in that case). Capability errors compose three concrete
 * fixes — surfacing them as a checklist beats burying them in prose.
 */
function extractCapabilityHint(
  err: Error,
): { name: string; suggestions: { code: string; note: string }[] } | null {
  const m = /capability ['"]([^'"]+)['"]/.exec(err.message)
  if (!m) return null
  const capName = m[1] ?? 'Cap'
  return {
    name: capName,
    suggestions: [
      {
        code: `${capName}.provide(impl, () => …)`,
        note: 'Scoped install — disposes when the inner block returns. Right answer inside request handlers.',
      },
      {
        code: `${capName}.install(impl)`,
        note: 'Module-level install — keep the returned disposer alive. Right answer for browser-only app entries.',
      },
      {
        code: `${capName}.tryUse()`,
        note: 'Returns null when the cap is absent — lets render-time code degrade gracefully (e.g. SSR shells).',
      },
    ],
  }
}

/**
 * Read a window of source lines around the failing line. Returns null
 * if the file isn't readable (path missing, bundled-only file, etc.) so
 * the overlay can skip the source-preview card cleanly.
 */
async function readSourceWindow(
  filePath: string,
  centerLine: number,
  context: number,
): Promise<{ start: number; lines: string[] } | null> {
  if (!filePath || centerLine < 1) return null
  try {
    let text: string | null = null
    if (typeof Bun !== 'undefined' && typeof Bun.file === 'function') {
      const f = Bun.file(filePath)
      if (!(await f.exists())) return null
      text = await f.text()
    } else {
      const { readFile } = await import('node:fs/promises')
      text = await readFile(filePath, 'utf8')
    }
    if (text === null) return null
    const all = text.split('\n')
    const start = Math.max(1, centerLine - context)
    const end = Math.min(all.length, centerLine + context)
    const lines = all.slice(start - 1, end)
    return { start, lines }
  } catch {
    return null
  }
}

/** Tiny syntax-aware highlighter for the source preview. */
function highlightTsSource(src: string, esc: (s: string) => string): string {
  // Strategy: tokenize comments + strings first (so keywords inside them
  // are not re-styled), then mark keywords + literals on the remainder.
  // Tokens are emitted as <span class="t-…"> wrapping HTML-escaped text.
  const KEYWORDS = new Set([
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'new',
    'class',
    'extends',
    'implements',
    'interface',
    'type',
    'enum',
    'namespace',
    'import',
    'export',
    'from',
    'as',
    'default',
    'async',
    'await',
    'try',
    'catch',
    'finally',
    'throw',
    'typeof',
    'instanceof',
    'in',
    'of',
    'void',
    'delete',
    'this',
    'super',
    'public',
    'private',
    'protected',
    'readonly',
    'static',
    'yield',
  ])
  const LITERALS = new Set(['true', 'false', 'null', 'undefined'])
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i] ?? ''
    const next = src[i + 1] ?? ''
    // Line comment
    if (c === '/' && next === '/') {
      let j = i
      while (j < n && src[j] !== '\n') j++
      out += `<span class="t-c">${esc(src.slice(i, j))}</span>`
      i = j
      continue
    }
    // Block comment
    if (c === '/' && next === '*') {
      let j = i + 2
      while (j < n - 1 && !(src[j] === '*' && src[j + 1] === '/')) j++
      const end = Math.min(j + 2, n)
      out += `<span class="t-c">${esc(src.slice(i, end))}</span>`
      i = end
      continue
    }
    // String — '…' or "…" or `…` (template literals collapsed to one span
    // for simplicity; interpolations aren't re-highlighted).
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === quote) {
          j++
          break
        }
        j++
      }
      out += `<span class="t-s">${esc(src.slice(i, j))}</span>`
      i = j
      continue
    }
    // Number
    if (c >= '0' && c <= '9') {
      let j = i
      while (j < n && /[0-9_.xXeEn]/.test(src[j] ?? '')) j++
      out += `<span class="t-n">${esc(src.slice(i, j))}</span>`
      i = j
      continue
    }
    // Identifier-ish (keywords, literals, others)
    if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (j < n && /[A-Za-z0-9_$]/.test(src[j] ?? '')) j++
      const word = src.slice(i, j)
      if (KEYWORDS.has(word)) out += `<span class="t-k">${esc(word)}</span>`
      else if (LITERALS.has(word)) out += `<span class="t-l">${esc(word)}</span>`
      else out += esc(word)
      i = j
      continue
    }
    out += esc(c)
    i++
  }
  return out
}

/** Render the source-frame preview card (when a user frame's file is readable). */
function renderSourcePreview(
  frame: StackFrame,
  window: { start: number; lines: string[] },
  esc: (s: string) => string,
): string {
  const fileName = frame.file.split('/').pop() ?? frame.file
  const rows = window.lines.map((rawLine, idx) => {
    const lineNo = window.start + idx
    const isErr = lineNo === frame.line
    const cls = isErr ? 'src-line src-line-err' : 'src-line'
    const gutter = isErr ? '▸' : ' '
    const codeHtml = highlightTsSource(rawLine, esc)
    let row = `<div class="${cls}"><span class="src-gutter">${gutter}</span><span class="src-lineno">${lineNo}</span><span class="src-code">${codeHtml || '&nbsp;'}</span></div>`
    if (isErr) {
      // Caret line — points at the failing column. Pad with non-breaking
      // spaces so the marker aligns under the column character.
      const pad = '&nbsp;'.repeat(Math.max(0, frame.col - 1))
      row += `<div class="src-caret"><span class="src-gutter">&nbsp;</span><span class="src-lineno">&nbsp;</span><span class="src-code">${pad}<span class="src-caret-mark">^</span></span></div>`
    }
    return row
  })
  const editorHref = esc(frameEditorHref(frame))
  const fnLabel = esc(frame.fn ?? '(anonymous)')
  return [
    '<section class="card src">',
    '<header class="src-head">',
    '<div class="src-head-l">',
    '<span class="src-fn">',
    fnLabel,
    '</span>',
    '<span class="src-sep">in</span>',
    `<a class="src-path" href="${editorHref}" title="Open in editor">`,
    esc(fileName),
    `<span class="src-pos">:${frame.line}:${frame.col}</span>`,
    '</a>',
    '</div>',
    `<button type="button" class="copy-btn" data-copy="${esc(`${frame.file}:${frame.line}:${frame.col}`)}" title="Copy path">`,
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    '</button>',
    '</header>',
    '<pre class="src-body">',
    rows.join(''),
    '</pre>',
    '</section>',
  ].join('')
}

function renderFrameRowPretty(frame: StackFrame, esc: (s: string) => string): string {
  const fn = esc(frame.fn ?? '(anonymous)')
  const file = esc(frame.file || '(unknown)')
  const fileName = (frame.file || '').split('/').pop() ?? ''
  const dir = file.slice(0, Math.max(0, file.length - fileName.length))
  const href = esc(frameEditorHref(frame))
  return [
    '<li class="frame">',
    `<div class="frame-fn">${fn}</div>`,
    `<a class="frame-file" href="${href}">`,
    dir ? `<span class="frame-dir">${dir}</span>` : '',
    `<span class="frame-base">${esc(fileName) || file}</span>`,
    `<span class="frame-pos">:${frame.line}:${frame.col}</span>`,
    '</a>',
    '</li>',
  ].join('')
}

async function formatDevErrorOverlay(
  err: Error,
  req: Request,
  phase: 'load' | 'render',
): Promise<string> {
  const url = new URL(req.url)
  const esc = escapeHtmlAttrFull
  const name = esc(err.name)
  const message = esc(err.message)
  const rawStack = err.stack ?? '(no stack)'
  const path = esc(url.pathname + url.search)
  const method = esc(req.method)
  const time = new Date().toLocaleTimeString([], { hour12: false })

  const cwd = typeof process !== 'undefined' ? process.cwd() : ''
  const frames = parseStackFrames(err.stack, cwd)
  const userFrames = frames.filter((f) => f.scope === 'user')
  const frameworkFrames = frames.filter((f) => f.scope !== 'user')

  const cat = categorizeError(err)
  const capHint = extractCapabilityHint(err)

  // Source preview: read a small window around the first user frame.
  // Falls back gracefully when the file isn't readable (e.g. bundled-only
  // frames, sandboxed environments, file outside cwd).
  const firstUserFrame = userFrames[0]
  const window = firstUserFrame
    ? await readSourceWindow(firstUserFrame.file, firstUserFrame.line, 4)
    : null
  const sourceCard =
    firstUserFrame && window ? renderSourcePreview(firstUserFrame, window, esc) : ''

  const userStack = userFrames.length
    ? `<ul class="frames">${userFrames.map((f) => renderFrameRowPretty(f, esc)).join('')}</ul>`
    : '<p class="frames-empty">No user frames in this stack — see raw stack below.</p>'

  const frameworkBlock = frameworkFrames.length
    ? [
        '<details class="card collapsible">',
        '<summary>',
        '<span class="sum-label">Framework / runtime</span>',
        `<span class="sum-count">${frameworkFrames.length}</span>`,
        '</summary>',
        '<ul class="frames">',
        ...frameworkFrames.map((f) => renderFrameRowPretty(f, esc)),
        '</ul>',
        '</details>',
      ].join('')
    : ''

  const rawBlock = [
    '<details class="card collapsible">',
    '<summary>',
    '<span class="sum-label">Raw stack</span>',
    `<button type="button" class="copy-btn copy-stack" data-copy="${esc(rawStack)}" title="Copy stack" onclick="event.stopPropagation()">`,
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
    '</button>',
    '</summary>',
    `<pre class="raw">${esc(rawStack)}</pre>`,
    '</details>',
  ].join('')

  const hintCard = capHint
    ? [
        '<section class="card hint-card">',
        '<header class="hint-head">',
        '<svg class="hint-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"></path></svg>',
        `<span>Try one of these to install <code>${esc(capHint.name)}</code></span>`,
        '</header>',
        '<ol class="hint-list">',
        ...capHint.suggestions.map(
          (s) =>
            `<li><code>${esc(s.code)}</code><span class="hint-note">${esc(s.note)}</span></li>`,
        ),
        '</ol>',
        '</section>',
      ].join('')
    : ''

  // Tiny inline script: copy-to-clipboard buttons. CSP in dev is relaxed;
  // production never emits this overlay. The script is self-contained and
  // uses event delegation so collapsibles re-rendered later still work.
  const copyScript = `
document.addEventListener('click', function(e){
  const t = e.target.closest('.copy-btn');
  if (!t) return;
  e.preventDefault();
  const v = t.getAttribute('data-copy') || '';
  navigator.clipboard.writeText(v).then(function(){
    const orig = t.getAttribute('aria-label') || '';
    t.classList.add('copied');
    setTimeout(function(){ t.classList.remove('copied'); }, 1200);
  }).catch(function(){});
});
`

  // All inline — strict CSP doesn't apply in dev where this overlay
  // emits. The visual language is built on a small accent system so the
  // category color flows through the hero band, caret, and tag pill.
  // `--ac` is the accent oklch chosen by `categorizeError(err)`.
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    `<meta charset="utf-8">`,
    `<title>${esc(cat.label)} · ${name}</title>`,
    `<meta name="viewport" content="width=device-width,initial-scale=1">`,
    `<meta name="color-scheme" content="light dark">`,
    '<style>',
    `:root{--ac:${cat.accent};--bg:oklch(0.13 0.006 286);--bg2:oklch(0.17 0.006 286);--card:oklch(0.18 0.006 286);--bd:oklch(0.27 0.006 286);--fg:oklch(0.97 0.001 286);--mu:oklch(0.62 0.012 286);--mu2:oklch(0.46 0.012 286);--str:oklch(0.78 0.14 145);--num:oklch(0.78 0.14 65);--key:oklch(0.74 0.16 295);--cmt:oklch(0.5 0.01 286);}`,
    `@media (prefers-color-scheme: light){:root{--bg:oklch(0.985 0.002 286);--bg2:oklch(0.97 0.003 286);--card:oklch(1 0 0);--bd:oklch(0.92 0.005 286);--fg:oklch(0.18 0.008 286);--mu:oklch(0.48 0.014 286);--mu2:oklch(0.62 0.012 286);--str:oklch(0.5 0.16 145);--num:oklch(0.55 0.16 65);--key:oklch(0.5 0.18 295);--cmt:oklch(0.7 0.008 286);}}`,
    `*,*::before,*::after{box-sizing:border-box;}`,
    `html,body{margin:0;padding:0;}`,
    `body{font:14px/1.55 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--fg);min-height:100vh;}`,
    `.wrap{max-width:920px;margin:0 auto;padding:0 1.5rem 4rem;}`,
    /* Top status strip */
    `.strip{display:flex;align-items:center;gap:.75rem;padding:.65rem 1rem;font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--mu);background:color-mix(in oklab,var(--ac) 10%,var(--bg2));border-bottom:1px solid color-mix(in oklab,var(--ac) 25%,var(--bd));position:sticky;top:0;z-index:10;backdrop-filter:blur(8px);}`,
    `.strip .dot{width:8px;height:8px;border-radius:50%;background:var(--ac);box-shadow:0 0 0 3px color-mix(in oklab,var(--ac) 30%,transparent);animation:pulse 2.5s ease-in-out infinite;}`,
    `@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.55;}}`,
    `.strip .method{padding:1px 6px;border-radius:3px;background:var(--card);color:var(--fg);font-weight:600;}`,
    `.strip .req{color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}`,
    `.strip .meta{color:var(--mu2);}`,
    /* Hero */
    `.hero{padding:2.5rem 0 1.5rem;display:flex;gap:1.25rem;align-items:flex-start;}`,
    `.hero-icon{flex-shrink:0;width:48px;height:48px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:color-mix(in oklab,var(--ac) 18%,var(--card));color:var(--ac);box-shadow:0 0 0 1px color-mix(in oklab,var(--ac) 30%,transparent),0 6px 24px -8px color-mix(in oklab,var(--ac) 60%,transparent);}`,
    `.hero-text{min-width:0;flex:1;}`,
    `.cat{display:inline-block;font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.05em;text-transform:uppercase;padding:4px 8px;border-radius:999px;background:color-mix(in oklab,var(--ac) 14%,var(--card));color:var(--ac);border:1px solid color-mix(in oklab,var(--ac) 30%,transparent);margin-bottom:.55rem;}`,
    `.hero h1{margin:0 0 .35rem;font-size:22px;font-weight:600;letter-spacing:-.01em;color:var(--fg);}`,
    `.hero .msg{margin:0;font-size:15px;color:var(--fg);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg2);padding:.65rem .9rem;border-radius:8px;border:1px solid var(--bd);white-space:pre-wrap;word-break:break-word;}`,
    /* Card */
    `.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;margin:1rem 0;overflow:hidden;}`,
    /* Hint card */
    `.hint-card{border-color:color-mix(in oklab,var(--ac) 35%,var(--bd));}`,
    `.hint-head{display:flex;align-items:center;gap:.55rem;padding:.85rem 1rem;border-bottom:1px solid var(--bd);background:color-mix(in oklab,var(--ac) 8%,var(--card));color:var(--ac);font-size:13px;font-weight:500;}`,
    `.hint-head code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:color-mix(in oklab,var(--ac) 15%,var(--card));padding:1px 5px;border-radius:3px;color:var(--ac);}`,
    `.hint-icon{flex-shrink:0;}`,
    `.hint-list{margin:0;padding:.5rem 0;list-style:none;counter-reset:s;}`,
    `.hint-list li{padding:.55rem 1rem .55rem 2.6rem;position:relative;counter-increment:s;border-top:1px solid var(--bd);}`,
    `.hint-list li:first-child{border-top:0;}`,
    `.hint-list li::before{content:counter(s);position:absolute;left:1rem;top:.65rem;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace;background:color-mix(in oklab,var(--ac) 18%,var(--card));color:var(--ac);}`,
    `.hint-list code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg);background:var(--bg2);padding:1px 6px;border-radius:4px;border:1px solid var(--bd);display:inline-block;margin-bottom:.2rem;}`,
    `.hint-note{display:block;color:var(--mu);font-size:12.5px;}`,
    /* Source preview */
    `.src .src-head{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.6rem 1rem;border-bottom:1px solid var(--bd);background:var(--bg2);font:12px ui-monospace,SFMono-Regular,Menlo,monospace;}`,
    `.src-head-l{display:flex;align-items:center;gap:.55rem;min-width:0;flex:1;}`,
    `.src-fn{color:var(--fg);font-weight:600;}`,
    `.src-sep{color:var(--mu2);}`,
    `.src-path{color:var(--mu);text-decoration:none;display:inline-flex;align-items:baseline;gap:.15rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}`,
    `.src-path:hover{color:var(--fg);}`,
    `.src-pos{color:color-mix(in oklab,var(--ac) 60%,var(--mu));}`,
    `.src-body{margin:0;padding:.6rem 0;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--card);overflow-x:auto;}`,
    `.src-line{display:grid;grid-template-columns:24px 48px 1fr;gap:0;padding:0 1rem;color:var(--fg);white-space:pre;}`,
    `.src-line-err{background:color-mix(in oklab,var(--ac) 14%,transparent);}`,
    `.src-line-err .src-gutter{color:var(--ac);font-weight:700;}`,
    `.src-gutter{user-select:none;color:transparent;}`,
    `.src-lineno{user-select:none;color:var(--mu2);text-align:right;padding-right:.85rem;}`,
    `.src-code{color:var(--fg);}`,
    `.src-caret{display:grid;grid-template-columns:24px 48px 1fr;gap:0;padding:0 1rem;color:var(--ac);font-weight:700;white-space:pre;line-height:1;background:color-mix(in oklab,var(--ac) 14%,transparent);}`,
    `.src-caret-mark{color:var(--ac);}`,
    /* Syntax tokens */
    `.t-k{color:var(--key);}`,
    `.t-s{color:var(--str);}`,
    `.t-n{color:var(--num);}`,
    `.t-l{color:var(--num);}`,
    `.t-c{color:var(--cmt);font-style:italic;}`,
    /* Frames lists */
    `h2.section{margin:1.8rem 0 .55rem;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--mu);}`,
    `ul.frames{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--bd);border-radius:12px;overflow:hidden;}`,
    `ul.frames .frame{display:flex;flex-direction:column;gap:.15rem;padding:.7rem 1rem;border-bottom:1px solid var(--bd);font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;}`,
    `ul.frames .frame:last-child{border-bottom:0;}`,
    `ul.frames .frame:hover{background:var(--bg2);}`,
    `.frame-fn{color:var(--fg);font-weight:500;}`,
    `.frame-file{display:flex;align-items:baseline;flex-wrap:wrap;text-decoration:none;color:var(--mu);font-size:11.5px;}`,
    `.frame-file:hover .frame-base{color:var(--ac);}`,
    `.frame-dir{color:var(--mu2);}`,
    `.frame-base{color:var(--fg);font-weight:500;}`,
    `.frame-pos{color:var(--mu2);}`,
    `.frames-empty{margin:.5rem 0;padding:1rem;background:var(--card);border:1px dashed var(--bd);border-radius:12px;color:var(--mu);font-size:13px;text-align:center;}`,
    /* Collapsibles */
    `.collapsible summary{cursor:pointer;list-style:none;display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.85rem 1rem;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mu);transition:background .12s ease;}`,
    `.collapsible summary::-webkit-details-marker{display:none;}`,
    `.collapsible summary:hover{background:var(--bg2);color:var(--fg);}`,
    `.collapsible[open] summary{border-bottom:1px solid var(--bd);background:var(--bg2);color:var(--fg);}`,
    `.sum-label{display:flex;align-items:center;gap:.55rem;}`,
    `.sum-label::before{content:'';display:inline-block;width:0;height:0;border-left:5px solid currentColor;border-top:4px solid transparent;border-bottom:4px solid transparent;transition:transform .15s ease;}`,
    `.collapsible[open] .sum-label::before{transform:rotate(90deg);}`,
    `.sum-count{font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg2);padding:1px 7px;border-radius:999px;border:1px solid var(--bd);color:var(--mu);}`,
    `.collapsible[open] .sum-count{background:var(--card);}`,
    `pre.raw{margin:0;padding:1rem;font:11.5px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg);white-space:pre-wrap;word-break:break-word;background:var(--card);overflow-x:auto;}`,
    /* Copy button */
    `.copy-btn{background:transparent;border:1px solid var(--bd);color:var(--mu);width:26px;height:26px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:all .12s ease;flex-shrink:0;}`,
    `.copy-btn:hover{border-color:var(--ac);color:var(--ac);background:color-mix(in oklab,var(--ac) 8%,var(--card));}`,
    `.copy-btn.copied{border-color:var(--str);color:var(--str);background:color-mix(in oklab,var(--str) 12%,var(--card));}`,
    /* Footer */
    `.foot{margin-top:2rem;padding:1rem 1.1rem;font-size:12px;color:var(--mu);background:var(--card);border:1px solid var(--bd);border-radius:12px;display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap;}`,
    `.foot code{font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg2);padding:1px 5px;border-radius:3px;color:var(--fg);}`,
    `.foot a{color:var(--ac);text-decoration:none;}`,
    `.foot a:hover{text-decoration:underline;}`,
    '</style>',
    '</head>',
    '<body>',
    '<div class="strip">',
    '<span class="dot" aria-hidden="true"></span>',
    `<span class="method">${method}</span>`,
    `<span class="req">${path}</span>`,
    `<span class="meta">place / ${esc(phase)} threw · ${esc(time)}</span>`,
    '</div>',
    '<div class="wrap">',
    '<header class="hero">',
    `<div class="hero-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${cat.iconPath}"></path></svg></div>`,
    '<div class="hero-text">',
    `<span class="cat">${esc(cat.label)}</span>`,
    `<h1>${name}</h1>`,
    `<pre class="msg">${message}</pre>`,
    '</div>',
    '</header>',
    hintCard,
    sourceCard,
    '<h2 class="section">Stack — your code</h2>',
    userStack,
    frameworkBlock,
    rawBlock,
    '<footer class="foot">',
    `<span>Dev overlay — emitted when <code>NODE_ENV</code> is not <code>production</code>.</span>`,
    '<span>Save a file to retry — the watcher will reload this page.</span>',
    '</footer>',
    '</div>',
    `<script>${copyScript}</script>`,
    '</body>',
    '</html>',
  ].join('')
}

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

// ===== serve — Bun.serve wrapper that bundles client + dispatches routes =====
//
// One call to stand up an SSR-with-hydration server:
//
//   await serve({
//     port: 5180,
//     clientEntry: './client.tsx',
//     routes: {
//       '/':            home,                          // a Page
//       'GET /kv/:key': (_req, p) => json(...),        // a raw handler
//       'PUT /kv/:key': async (req, p) => { ... },
//     },
//   })
//
// What it does:
//   1. Bun.build's the `clientEntry` once at startup, serves the bundle
//      at `/client.js` (configurable via `clientPath`)
//   2. Auto-injects `bootstrap: '/client.js'` into every Page's shell
//      (so each Page hydrates without restating the script src)
//   3. Dispatches each request: pages render via `renderPage()`, raw
//      handlers run as `(req, params) => Response`
//   4. WebSocket / pre-router hooks via `fetch` and `websocket` options
//   5. 404 fallback, customizable via `notFound`
//
// What it doesn't do:
//   - No middleware chain (compose handlers with plain function wrapping)
//   - No automatic CORS / CSP (set via `headers` if needed)
//   - No file-system routing (routes are explicit data)

// Type erasure for routes maps: each entry can have its own
// `{ name }` / `{ id }` props, but the map type can't carry per-entry
// generics. Using `any` in the function PARAM positions sidesteps
// strict-function-types contravariance (a `(props: {}) => View`
// doesn't assign to `(props: never) => View` and vice versa). This
// type is only used at the boundary between specific Pages and
// generic dispatchers — handlers always see their typed Page.
export interface AnyPage {
  /** Route path the page is mounted at. Set by `page(path, def)` (Round 5).
   *  Optional because the legacy `page(def)` form leaves it undefined. */
  path?: string
  // biome-ignore lint/suspicious/noExplicitAny: variance escape hatch.
  url?: (url: URL, params: Record<string, string>) => any
  // biome-ignore lint/suspicious/noExplicitAny: variance escape hatch.
  load?: (ctx: LoadCtx) => any
  // biome-ignore lint/suspicious/noExplicitAny: variance escape hatch.
  view: (props: any) => View
  // biome-ignore lint/suspicious/noExplicitAny: variance escape hatch.
  meta?: PageMeta | string | ((props: any) => PageMeta | string)
  styles?: StyleSrc | StyleSrc[]
  headers?: HeadersInit
  streaming?: boolean
  revalidate?: number | { ttl: number; tags?: string[] }
  getStaticPaths?: () => Record<string, string>[] | Promise<Record<string, string>[]>
  layout?: AnyLayout | AnyLayout[]
  /** Slot fills consumed by the page's layout chain. */
  slots?: SlotFills
  /** Round 5 (5.3): server-only handlers for co-located actions. */
  // biome-ignore lint/suspicious/noExplicitAny: variance escape hatch.
  on?: Record<string, (input: any, ctx: LoadCtx) => any>
  /** Round 5 (5.5): search-param validator. */
  search?: (raw: Record<string, string>) => unknown
  /** Round 5 (5.3): internal — handlers extracted by `serve()`. */
  _onHandlers?: Record<string, RouteHandler>
  /** Round 5 (5.7): per-page error view (rendered on load() throw). */
  onError?: (err: Error, ctx: LoadCtx) => View
  /** Round 5 (5.7): per-page not-found view (rendered on notFound()). */
  onNotFound?: (ctx: LoadCtx) => View
  readonly [PLACE_PAGE_BRAND]: true
}

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
   * omitted, defaults to scanning the directory of `clientEntry` (or
   * `cwd` if `clientEntry` is unset) for `.{ts,tsx,js,jsx,html}`. That
   * covers the typical case: app source lives next to its `server.tsx`.
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
   * Path to the client entry module. Bundled via Bun.build at startup,
   * served at `clientPath`. Omit for static-only sites (no hydration).
   */
  clientEntry?: string
  /**
   * Per-route bundle splitting (T5-B-1, ADR 0018). Maps route path →
   * source file. When set, `serve()` runs ONE `Bun.build` with
   * `splitting: true` over all entries (+ `clientEntry` as the shared
   * seed) so Bun extracts shared chunks. Each route's HTML emits a
   * `<script src>` pointing to its own bundle, not the shared one.
   *
   * Routes NOT in this map fall back to `clientEntry` — so this is
   * additive / opt-in. Apps that previously had `clientEntry` work
   * unchanged.
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
  islands?:
    | Readonly<Record<string, IslandRegistration>>
    | readonly IslandComponent<never>[]
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
  /**
   * Pre-built client bundle as a string, served verbatim at `clientPath`.
   * Use this on non-Bun runtimes (Node, Cloudflare Workers, etc.) where
   * `Bun.build` isn't available — pre-build with esbuild/Vite/Rollup and
   * pass the result here. Takes priority over `clientEntry` if both are
   * set.
   */
  clientJs?: string
  /** URL path to serve the client bundle at. Default: `/client.js`. */
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
 * the framework runs (legacy single `clientEntry`, the route splitter,
 * and the per-island bundler).
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
 *     But the **legacy `clientEntry` and the `clientEntries`
 *     route-splitter paths** still reach `_serveImpl`'s dynamic
 *     imports of `./build/*` through the framework barrel; without
 *     this entry, those paths would ship the full TS compiler in every
 *     visitor's bundle. Keep until the split-entry refactor lands
 *     (`@place/component/server` subpath), at which point this is
 *     redundant.
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
  return isProduction
    ? true
    : { whitespace: true, syntax: true, identifiers: false }
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
  const isDevMode = process.env['NODE_ENV'] !== 'production'
  const isTest = process.env['VITEST'] === 'true' || process.env['NODE_ENV'] === 'test'
  if (isDevMode && !isTest && !process.env['__PLACE_DEV_CHILD']) {
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
  // Observability flags. Default-on in dev (banner + per-request log),
  // default-off in production (a single one-line ready message). Apps
  // can override either way via `serve({ log })`.
  const isDev = process.env['NODE_ENV'] !== 'production'
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
  const isProduction = process.env['NODE_ENV'] === 'production'
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
      ;({ tailwind } = (await _serverDynImport(
        './tailwind.ts',
      )) as typeof import('./tailwind.ts'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(
        `serve: tailwind: true requires the 'tailwindcss' and '@tailwindcss/node' ` +
          `packages to be installed (they're peer deps). Add them to your app's ` +
          `package.json. Underlying error: ${msg}`,
      )
    }
    // Default content: the directory containing `clientEntry`, since
    // app source typically lives next to its server entry. Falls back
    // to cwd for static-only sites with no clientEntry.
    let defaultContent: string
    if (options.clientEntry) {
      const lastSlash = options.clientEntry.lastIndexOf('/')
      const dir = lastSlash >= 0 ? options.clientEntry.slice(0, lastSlash) : options.clientEntry
      defaultContent = `${dir}/**/*.{tsx,jsx,ts,js,html}`
    } else {
      defaultContent = `${process.cwd()}/**/*.{tsx,jsx,ts,js,html}`
    }
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

  // Client bundle: three sources, in priority order.
  //   1. `options.clientJs` — caller passes pre-built bundle as a string.
  //      This is what non-Bun runtimes (Node, Cloudflare Workers via
  //      adapters) use, since Bun.build isn't available there.
  //   2. `options.clientEntry` + Bun runtime — Bun.build at startup.
  //   3. `options.clientEntry` + non-Bun runtime — error: tell the caller
  //      to pre-build with esbuild/Vite/etc. and pass `clientJs`.
  let clientJs: string | null = null
  if (options.clientJs !== undefined) {
    clientJs = options.clientJs
  } else if (options.clientEntry) {
    if (typeof Bun === 'undefined' || typeof Bun.build !== 'function') {
      throw new Error(
        'serve: clientEntry requires Bun.build, which is not available in this runtime. ' +
          'Pre-build the client bundle with esbuild/Vite/Rollup and pass `clientJs: <string>` ' +
          'instead. Or run under Bun.',
      )
    }
    const bundleStart = performance.now()
    // Legacy single-bundle path: `clientEntry: 'src/client.ts'`. One
    // entrypoint, no `splitting: true`, no per-route emission. The
    // route-splitter + island-bundler paths below replace this for
    // every modern config — `clientEntry` survives for migration and
    // for non-Bun adapters that need a single pre-built JS string.
    // Shared options come from `BROWSER_BUILD_EXTERNAL` +
    // `browserMinify` + `browserSourcemap`; see their definitions for
    // the rationale on each value.
    //
    // **`__PLACE_BROWSER__: 'true'`** is a build-time constant the
    // bundler folds into a literal `true`, so `if (typeof
    // __PLACE_BROWSER__ !== 'undefined' && __PLACE_BROWSER__) { … }
    // else { …server… }` branches DCE on browser builds. The server
    // runtime (Bun loading the entry directly) leaves the define
    // unset; `typeof` returns `'undefined'`, the server branch runs.
    const build = await Bun.build({
      entrypoints: [options.clientEntry],
      target: 'browser',
      format: 'esm',
      // **Minify off** in the legacy path: source maps are inline (see
      // the comment on `browserSourcemap` for why we use `'linked'`
      // elsewhere), and the legacy path predates the
      // sourcemap-stripping observation; users on this path get raw
      // dev output. Modernized paths use `browserMinify(isProduction)`.
      minify: false,
      plugins: [placeAutoImport()],
      sourcemap: browserSourcemap(isProduction),
      // `__PLACE_DEV__` (ADR 0028): inverse of production. Gates the
      // HMR runtime + the `island()` accept wrapper so prod ships zero
      // bytes of HMR code via Bun's dead-branch elimination.
      define: { __PLACE_BROWSER__: 'true', __PLACE_DEV__: isProduction ? 'false' : 'true' },
      external: [...BROWSER_BUILD_EXTERNAL],
    })
    if (!build.success) {
      throw new Error(`serve: client bundle failed:\n${build.logs.join('\n')}`)
    }
    const out = build.outputs[0]
    if (!out) throw new Error('serve: client bundle produced no outputs')
    clientJs = await out.text()
    timings.bundleMs = performance.now() - bundleStart
    timings.bundleBytes = clientJs.length
  }

  // T5-B-1 (ADR 0018): per-route bundle splitting. When `clientEntries`
  // is provided, build per-route bundles via Bun's `splitting: true` so
  // each route ships only its own view code + shared chunks (framework
  // runtime + layout). The fallback `clientEntry` bundle above stays
  // available for routes NOT in `clientEntries` (gradual adoption).
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
        'serve: clientEntries requires Bun.build. Use a single clientEntry on non-Bun runtimes.',
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
      ...(options.clientEntry ? { clientEntry: options.clientEntry } : {}),
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
  // Two registration forms:
  //   - Record: `islands: { Counter: { component, src } }` (verbose)
  //   - Array:  `islands: [Counter]` (recommended; uses metadata
  //             attached by the `island()` factory)
  let islandRegistry: Readonly<Record<string, IslandRegistration>> = {}
  if (Array.isArray(options.islands)) {
    const map: Record<string, IslandRegistration> = {}
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
      map[fn.__islandName] = {
        component: fn as never,
        src: fn.__islandSrc,
        ...(ssrProps ? { ssrProps } : {}),
      }
    }
    islandRegistry = map
  } else if (options.islands) {
    islandRegistry = options.islands as Readonly<Record<string, IslandRegistration>>
  } else if (options.islandsDir) {
    // T5-D phase 2 DX: auto-discover islands. Skipped if explicit
    // `islands` is set above. Specifier opacity via `_serverDynImport`.
    const { discoverIslands } = (await _serverDynImport(
      './build/discover-islands.ts',
    )) as typeof import('./build/discover-islands.ts')
    islandRegistry = await discoverIslands(options.islandsDir)
  }
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
        'serve: `islands` requires Bun.build. Use a single clientEntry on non-Bun runtimes.',
      )
    }
    // Specifier opacity via `_serverDynImport`.
    const { buildIslandBundles } = (await _serverDynImport(
      './build/island-bundler.ts',
    )) as { buildIslandBundles: typeof BuildIslandBundlesFn }
    const runIslandBuild = async (
      registry: Readonly<Record<string, IslandRegistration>>,
    ) => {
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
          await Promise.all(
            Array.from(_registeredCaches, (c) => c.delete({}).catch(() => {})),
          )
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
        // biome-ignore lint/suspicious/noConsole: dev iteration feedback
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
      console.log('\n' + renderViewManifestReport(islandResult.viewManifest) + '\n')
    }
    timings.bundleMs = (timings.bundleMs ?? 0) + (performance.now() - islandStart)
    timings.bundleBytes = (timings.bundleBytes ?? 0) + islandResult.totalBytes
  } else {
    _setIslandRegistry(undefined)
    _setIslandBundleUrls(undefined)
  }

  // Content-hash the bundle in prod so it can be served with
  // `immutable, max-age=31536000`. Browsers cache forever; deploys with
  // a new bundle get a new path. The original `clientPath` becomes a
  // 308 redirect for back-compat (any hardcoded `<script src="/client.js">`
  // anywhere keeps working).
  //
  // Dev keeps `clientPath` as the served path (no hash) — bundles change
  // on every server restart; long max-age would just stale-bomb edits.
  let clientHash: string | null = null
  if (clientJs !== null && isProduction) {
    const data = new TextEncoder().encode(clientJs)
    const digest = await crypto.subtle.digest('SHA-256', data)
    const bytes = new Uint8Array(digest)
    let hex = ''
    for (let i = 0; i < 4; i++) {
      const b = bytes[i] ?? 0
      hex += b.toString(16).padStart(2, '0')
    }
    clientHash = hex // 8 hex chars = 32 bits, ample for collision avoidance
  }
  const effectiveClientPath =
    clientHash !== null ? clientPath.replace(/\.js$/, `.${clientHash}.js`) : clientPath
  const isHashedClientPath = effectiveClientPath !== clientPath
  const hashedBundleCacheControl = 'public, max-age=31536000, immutable'

  // T5-D-phase-2 (ADR 0025) SRI: hash the legacy single-bundle clientJs
  // so the bootstrap `<script>` tag emits `integrity="sha384-…"`.
  //
  // T6-A: encode once into a stable `Uint8Array` and serve the SAME
  // bytes from the `/client.js` handler. Same rationale as the
  // splitterBundles map — guarantees the bytes hashed match the bytes
  // the browser receives.
  let clientJsBytes: Uint8Array<ArrayBuffer> | null = null
  if (clientJs !== null) {
    clientJsBytes = new TextEncoder().encode(clientJs) as Uint8Array<ArrayBuffer>
    const sriDigest = await crypto.subtle.digest('SHA-384', clientJsBytes)
    const sriB64 = btoa(String.fromCharCode(...new Uint8Array(sriDigest)))
    scriptIntegrity[effectiveClientPath] = sriB64
    if (isHashedClientPath) {
      // Legacy `clientPath` returns 308 → effectiveClientPath in prod;
      // tagging it too means the framework keeps integrity working if
      // an app hardcodes the legacy URL.
      scriptIntegrity[clientPath] = sriB64
    }
  }

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
    const list: StyleSrc[] = existing
      ? Array.isArray(existing)
        ? [...existing]
        : [existing]
      : []
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
          headers['Content-Security-Policy'] = `${csp.trimEnd().replace(/;\s*$/, '')}; style-src 'self' ${styleToken}`
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
      // Per-route bootstrap (T5-B-1): if the route has a dedicated bundle
      // via `clientEntries`, use that URL. Else fall back to the shared
      // `effectiveClientPath` (legacy single-bundle behavior).
      const perRouteBootstrap =
        (page.path !== undefined ? routeToBundle.get(page.path) : undefined) ??
        splitterDefaultBundleUrl ??
        null
      const bootstrap =
        perRouteBootstrap ?? (clientJs !== null ? effectiveClientPath : null)
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
        ...(options.earlyHead && options.earlyHead.length > 0
          ? { extraEarlyHead: options.earlyHead }
          : {}),
        ...(integrityForRender ? { scriptIntegrity: integrityForRender } : {}),
        scriptNonce,
        ...(htmlClassPrefix ? { htmlClassPrefix } : {}),
        ...(serveLevelLayouts.length > 0 ? { extraLayouts: serveLevelLayouts } : {}),
        ...(options.transformBody ? { transformBody: options.transformBody } : {}),
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

    // Built-in: client bundle. Served only if clientEntry was given.
    // GET + HEAD both accepted (HEAD strip happens in innerFetch).
    //
    // In prod the canonical asset path is the content-hashed
    // `effectiveClientPath` (e.g. `/client.<sha8>.js`) served with
    // `immutable, max-age=31536000`. The legacy `clientPath`
    // (e.g. `/client.js`) returns 308 to the hashed path so any
    // hardcoded references still resolve.
    if (
      clientJsBytes !== null &&
      (req.method === 'GET' || req.method === 'HEAD') &&
      url.pathname === effectiveClientPath
    ) {
      return new Response(clientJsBytes, {
        headers: {
          ...baseHeaders,
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': isHashedClientPath ? hashedBundleCacheControl : bundleCacheControl,
        },
      })
    }
    // T5-B-1: per-route bundle URLs (ADR 0018). Every entry produced
    // by the route splitter (per-route chunks + shared chunks Bun
    // extracted) lives in `splitterBundles`. We serve any URL the map
    // knows about. In dev the URLs are stable across restarts; in prod
    // they include a content hash (Bun's chunk-naming scheme).
    if (
      splitterBundles.size > 0 &&
      (req.method === 'GET' || req.method === 'HEAD') &&
      splitterBundles.has(url.pathname)
    ) {
      // `bytes` is the *same* `Uint8Array` we hashed for SRI at build
      // time (T6-A). Passing it directly to `Response` writes those
      // bytes verbatim — no string encoder in the path that could
      // disagree with what we declared in the `integrity` attribute.
      const bytes = splitterBundles.get(url.pathname)!
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
    // Legacy `clientPath` redirect → effective hashed path. Only fires
    // in prod (when the two paths differ); dev's effectiveClientPath
    // === clientPath, so the GET above handles it directly.
    if (
      clientJs !== null &&
      isHashedClientPath &&
      (req.method === 'GET' || req.method === 'HEAD') &&
      url.pathname === clientPath
    ) {
      return new Response(null, {
        status: 308,
        headers: {
          ...baseHeaders,
          Location: effectiveClientPath,
          'Cache-Control': bundleCacheControl,
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
          return mergeHeaders(
            responseFromEntry(entry),
            pageHeadersFor(entry.inlineStyleAttrHashes),
          )
        }
        // Non-ISR path: render fresh every request.
        // Per-route bootstrap (T5-B-1): the route's per-route bundle URL
        // if `clientEntries` was set; else the shared `effectiveClientPath`.
        const perRouteBootstrap =
          (r.page.path !== undefined ? routeToBundle.get(r.page.path) : undefined) ??
          splitterDefaultBundleUrl ??
          null
        const bootstrap =
          perRouteBootstrap ?? (clientJs !== null ? effectiveClientPath : null)
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
          ...(isProduction ? {} : { enableHmr: true }),
          ...(integrityForRender ? { scriptIntegrity: integrityForRender } : {}),
          scriptNonce: nonce,
          ...(htmlClassPrefix ? { htmlClassPrefix } : {}),
          ...(serveLevelLayouts.length > 0 ? { extraLayouts: serveLevelLayouts } : {}),
          ...(options.transformBody ? { transformBody: options.transformBody } : {}),
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

  const innerFetch = async (req: Request, srv: Bun.Server<unknown>): Promise<Response | undefined> => {
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
      const upgraded = (srv as Bun.Server<unknown> & {
        upgrade: (r: Request, opts: { data: { kind: string } }) => boolean
      }).upgrade(req, { data: { kind: 'hmr' } })
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
    ? async (
        req: Request,
        srv: Bun.Server<unknown>,
      ): Promise<Response | undefined> => {
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
  const hmrHandler: Bun.WebSocketHandler<{ kind?: string }> = {
    open(ws) {
      if (ws.data?.kind === 'hmr') hmrClients.add(ws)
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
          message(
            ws: { data: { kind?: string } } & Record<string, unknown>,
            msg: string | Buffer,
          ) {
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
              ws.data?.kind === 'hmr'
                ? hmrHandler.close
                : (userWs as { close?: unknown }).close
            if (typeof fn === 'function')
              (fn as (w: typeof ws, c: number, r: string) => void)(ws, code, reason)
          },
        }
      : hmrHandler
    : userWs
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
        clientPath: clientJs !== null ? clientPath : null,
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
  const { existsSync, statSync } = await _serverDynImport(
    'node:fs',
  ) as typeof import('node:fs')
  const { watch } = await _serverDynImport(
    'node:fs/promises',
  ) as typeof import('node:fs/promises')
  const { resolve } = await _serverDynImport(
    'node:path',
  ) as typeof import('node:path')

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
      if (filename === skip || filename.startsWith(skip + '/')) return false
      if (filename.includes('/' + skip + '/')) return false
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
    return abs.startsWith(absIslandsDir + '/') || abs === absIslandsDir
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
//
// Default-on in dev, off in production. The banner runs once after the
// port is bound. The per-request log fires per request, formatted as a
// single tab-aligned line. Uses ANSI color when stdout is a TTY; bare
// text otherwise (so log shippers don't see escape sequences).

// Guard the TTY check — `process` is undefined in browser bundles and
// the entire framework lives in one file, so a bare `process.stdout`
// reference at module scope would crash the client. The check is
// deferred to first use; in browsers we always get the no-color shape.
const ansi = (() => {
  const isTTY = typeof process !== 'undefined' && process.stdout && process.stdout.isTTY
  return isTTY
    ? {
        reset: '\x1b[0m',
        bold: '\x1b[1m',
        dim: '\x1b[2m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        red: '\x1b[31m',
        cyan: '\x1b[36m',
        magenta: '\x1b[35m',
        gray: '\x1b[90m',
      }
    : {
        reset: '',
        bold: '',
        dim: '',
        green: '',
        yellow: '',
        red: '',
        cyan: '',
        magenta: '',
        gray: '',
      }
})()

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(2)}MB`
}

function formatMs(n: number): string {
  if (n < 1) return '<1ms'
  if (n < 1000) return `${Math.round(n)}ms`
  return `${(n / 1000).toFixed(2)}s`
}

interface StartupBannerInput {
  name: string
  url: string
  routes: Array<{ method: string; pattern: string; isPage: boolean }>
  clientPath: string | null
  timings: { tailwindMs?: number; bundleMs?: number; bundleBytes?: number; tailwindBytes?: number }
  startupMs: number
  hasTheme: boolean
  themeNames: readonly string[] | null
  hasSecurity: boolean
  hasCache: boolean
}

function formatStartupBanner(input: StartupBannerInput): string {
  const { bold, dim, cyan, green, magenta, gray, reset } = ansi
  const lines: string[] = []
  lines.push('')
  lines.push(`  ${bold}${magenta}▲${reset}  ${bold}${input.name}${reset}`)
  lines.push('')
  lines.push(`  ${green}→${reset}  ${cyan}${input.url}${reset}`)
  lines.push('')
  // Routes: pad method, then pattern, then a tag.
  if (input.routes.length > 0) {
    lines.push(`  ${dim}Routes${reset}`)
    for (const r of input.routes) {
      const method = r.method.padEnd(5)
      const pattern = r.pattern.padEnd(28)
      const tag = r.isPage ? `${gray}page${reset}` : `${gray}handler${reset}`
      lines.push(`    ${dim}${method}${reset} ${pattern} ${tag}`)
    }
    lines.push('')
  }
  // Bundle + Tailwind timings.
  const built: string[] = []
  if (input.clientPath !== null && input.timings.bundleMs !== undefined) {
    const size = input.timings.bundleBytes
      ? ` ${gray}(${formatBytes(input.timings.bundleBytes)})${reset}`
      : ''
    built.push(
      `    ${dim}bundle${reset}     ${input.clientPath.padEnd(14)} ${formatMs(input.timings.bundleMs).padEnd(7)}${size}`,
    )
  }
  if (input.timings.tailwindMs !== undefined) {
    const size = input.timings.tailwindBytes
      ? ` ${gray}(${formatBytes(input.timings.tailwindBytes)})${reset}`
      : ''
    built.push(
      `    ${dim}tailwind${reset}   ${'inline'.padEnd(14)} ${formatMs(input.timings.tailwindMs).padEnd(7)}${size}`,
    )
  }
  if (built.length > 0) {
    lines.push(`  ${dim}Built${reset}`)
    for (const b of built) lines.push(b)
    lines.push('')
  }
  // Active features.
  const features: string[] = []
  if (input.hasSecurity) features.push(`${green}security${reset}`)
  if (input.hasCache) features.push(`${green}isr${reset}`)
  if (input.hasTheme && input.themeNames !== null) {
    features.push(`${green}theme${reset}${gray}(${input.themeNames.join('/')})${reset}`)
  }
  if (features.length > 0) {
    lines.push(`  ${dim}Active${reset}     ${features.join('  ')}`)
    lines.push('')
  }
  lines.push(`  ${dim}Ready in ${reset}${bold}${formatMs(input.startupMs)}${reset}`)
  lines.push('')
  return `${lines.join('\n')}\n`
}

function formatRequestLogLine(method: string, path: string, status: number, ms: number): string {
  const { dim, green, yellow, red, gray, reset } = ansi
  const statusColor = status >= 500 ? red : status >= 400 ? yellow : green
  const m = method.padEnd(5)
  const p = path.length > 50 ? `${path.slice(0, 47)}...` : path.padEnd(50)
  const s = `${statusColor}${status}${reset}`
  const t = formatMs(ms)
  return `  ${dim}${m}${reset} ${p} ${s}  ${gray}${t}${reset}\n`
}

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

// ===== boot — client-side hydration entry =====
//
// Counterpart of `serve()`. Match the current `location.pathname` to
// one of the registered Pages, derive URL props the same way the
// server did, read load data out of the SSR'd `<script>` tag, then
// hydrate against `document.body`.
//
//   import { boot } from '@place/component'
//   import home from './pages/home'
//   boot({ '/': home })
//
// Returns a Disposer that tears down hydration (rarely useful — pages
// usually live for the page session — but consistent with the rest of
// the API).

export interface BootRoutes {
  [pattern: string]: AnyPage
}

export interface BootOptions {
  /**
   * Layouts that wrap every page on the client side. MUST match the
   * `serve({ layout })` declaration on the server side — otherwise the
   * SSR'd HTML structure won't match the client's reconstructed view
   * tree, and hydration silently fails (event handlers don't attach).
   *
   * For per-page layouts declared via `page({ layout })`, no extra
   * config is needed here — boot() reads `page.layout` automatically.
   */
  layout?: AnyLayout | AnyLayout[]
}

export function boot(routes: BootRoutes, options?: BootOptions): Disposer {
  const compiled = Object.entries(routes).map(([key, val]) => {
    const space = key.indexOf(' ')
    const pattern = space >= 0 ? key.slice(space + 1).trim() : key
    return { matcher: route(pattern), page: val }
  })
  // Boot()-level layouts wrap outside the page's own chain — same
  // outside-in composition as renderPage's `extraLayouts`.
  const bootLayouts: AnyLayout[] = options?.layout
    ? Array.isArray(options.layout)
      ? options.layout
      : [options.layout]
    : []

  /**
   * Match a URL to a page + collect its props, layout chain, and the
   * inner (un-wrapped) page view. Pure — no DOM side effects. Returns
   * null if no route matches.
   *
   * The layout chain is returned UN-applied so the caller can decide:
   * on initial boot we wrap with reactive children and hydrate; on SPA
   * nav we compare to the previous chain and either swap the inner
   * page view (chain unchanged → cheap, layouts stay mounted) or
   * unmount+remount the whole tree (chain changed → fall back).
   */
  interface PageMatch {
    pageView: View
    layouts: AnyLayout[]
    layoutProps: object
    matched: { params: Record<string, string>; page: AnyPage }
  }
  const matchUrl = (url: URL): PageMatch | null => {
    for (const r of compiled) {
      const params = r.matcher.match(url.pathname)
      if (params === null) continue
      const urlProps = r.page.url ? r.page.url(url, params) : ({} as object)
      const loadEl = document.getElementById(PLACE_LOAD_SCRIPT_ID)
      let loadData: object = {}
      if (loadEl?.textContent) {
        try {
          loadData = JSON.parse(loadEl.textContent)
        } catch {
          throw new Error(
            'boot: failed to parse __place_load__ script tag — server emitted invalid JSON',
          )
        }
      }
      let parsedSearch: unknown
      if (r.page.search) {
        const raw: Record<string, string> = {}
        url.searchParams.forEach((v, k) => {
          raw[k] = v
        })
        try {
          parsedSearch = r.page.search(raw)
        } catch (e) {
          throw e instanceof Error ? e : new Error(String(e))
        }
      }
      const props = (
        parsedSearch !== undefined
          ? { ...urlProps, ...loadData, search: parsedSearch }
          : { ...urlProps, ...loadData }
      ) as object
      const matchedParams = params
      const buildClientCtx = (): LoadCtx => ({
        req: new Request(location.href),
        url: new URL(location.href),
        params: matchedParams,
      })
      let pageView: View
      try {
        pageView = r.page.view(props as Parameters<typeof r.page.view>[0])
      } catch (e) {
        if (isNotFoundError(e) && r.page.onNotFound) {
          pageView = r.page.onNotFound(buildClientCtx())
        } else if (!isNotFoundError(e) && r.page.onError) {
          const err = e instanceof Error ? e : new Error(String(e))
          pageView = r.page.onError(err, buildClientCtx())
        } else {
          throw e
        }
      }
      const pageLayouts: AnyLayout[] = r.page.layout
        ? Array.isArray(r.page.layout)
          ? r.page.layout
          : [r.page.layout]
        : []
      const allLayouts = [...bootLayouts, ...pageLayouts]
      return {
        pageView,
        layouts: allLayouts,
        layoutProps: props,
        matched: { params, page: r.page },
      }
    }
    return null
  }

  /**
   * True when two layout chains are reference-equal — same layout
   * values in the same order. When this holds, navigation can swap
   * just the innermost page view through a reactive children slot;
   * the layout DOM stays mounted (sidebar, header, ToC, theme toggle
   * keep their reactive state, no flash, no scrollbar jump).
   */
  const sameLayoutChain = (a: AnyLayout[], b: AnyLayout[]): boolean => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }

  /**
   * Wrap an inner page-view function (`() => Child`) in the given
   * layout chain. The innermost slot is always a reactive function
   * so layout-persistence navigation can swap the page view through
   * the framework's reactive-children machinery. When the chain is
   * empty (no layouts at all), the function is wrapped in a Fragment
   * so the return is always a proper hydratable View.
   */
  const wrapInLayouts = (
    layouts: AnyLayout[],
    layoutProps: object,
    innermost: () => Child,
    slots?: SlotFills,
  ): View => {
    let children: View | (() => Child) = innermost
    const slotsAccessor = makeSlots<string>(slots)
    for (let i = layouts.length - 1; i >= 0; i--) {
      const l = layouts[i] as AnyLayout
      children = l.view({
        ...layoutProps,
        children,
        slots: slotsAccessor,
      } as Parameters<typeof l.view>[0])
    }
    // No layouts at all: the innermost is still a function. Wrap in a
    // Fragment so callers receive a uniform View interface (Fragment's
    // hydrate handles reactive function children — the same path the
    // wider hydration fix uses).
    if (typeof children === 'function') {
      return Fragment({ children: children as () => Child })
    }
    return children
  }

  // ----- Initial render -----
  // Match the current URL, build the layout chain, and hydrate the
  // SSR'd DOM. The innermost slot is a reactive state so future
  // navigations can swap pages without remounting the layout.
  const initialUrl = new URL(location.href)
  const initial = matchUrl(initialUrl)
  if (initial === null) {
    throw new Error(
      `boot: no route matched '${initialUrl.pathname}'. ` +
        `Registered patterns: ${Object.keys(routes).join(', ')}`,
    )
  }
  const pageSlot = state<View | null>(initial.pageView)
  let currentLayouts = initial.layouts
  const initialWrapped = wrapInLayouts(
    currentLayouts,
    initial.layoutProps,
    () => pageSlot() as Child,
    initial.matched.page.slots,
  )
  let currentDispose: Disposer = hydrate(initialWrapped, document.body)
  if (typeof process !== 'undefined' && process.env && process.env['NODE_ENV'] !== 'production') {
    _flushHydrationDeltas()
  }
  _setHydrated(true)
  const place = (globalThis as { __place?: { replay?: () => void } }).__place
  place?.replay?.()

  // ----- SPA navigation -----
  //
  // Subscribe to `RouterCap.path()` and react to URL changes:
  //
  //   - Same layout chain → cheap path: update `pageSlot` so the
  //     innermost reactive children swap the page view in place. The
  //     layout DOM persists; sidebar/header/footer/ToC keep their
  //     state, hidden Activity panels stay mounted, no flash, no
  //     scroll-position recapture cost.
  //
  //   - Different layout chain → fall back: dispose the current
  //     tree, clear body, rebuild with the new layout chain, mount
  //     fresh. Same shape as the pre-persistence behavior.
  //
  // RouterCap is browser-only; if it isn't installed, we silently
  // skip the subscription and the app behaves like an MPA (every
  // nav is a full page load).
  const router = RouterCap.tryUse()
  let lastPath = initialUrl.pathname + initialUrl.search
  let isInitialRun = true
  let routerWatchDispose: Disposer = () => {}
  if (router !== null) {
    routerWatchDispose = watch(() => {
      const nextPath = router.path()
      if (isInitialRun) {
        isInitialRun = false
        return
      }
      if (nextPath === lastPath) return
      lastPath = nextPath
      const newUrl = new URL(location.href)
      const next = matchUrl(newUrl)
      if (next === null) {
        // No matching route. Render a minimal in-app 404 (the
        // serve()-level `notFound` handler only runs on the server).
        // This is the "different layout chain" path applied to the
        // fallback view — full unmount + remount.
        currentDispose()
        while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
        const fallback = el(
          'div',
          { class: 'p-6 text-center text-muted' },
          'no route matched ',
          newUrl.pathname,
        )
        currentDispose = fallback.mount(document.body, null)
        currentLayouts = []
        return
      }
      if (sameLayoutChain(next.layouts, currentLayouts)) {
        // Cheap path: swap the inner page view through the reactive
        // children slot. The layout DOM stays mounted; only the
        // pageSlot consumer re-renders.
        pageSlot.set(next.pageView)
        globalThis.scrollTo?.(0, 0)
        return
      }
      // Different layout chain: full unmount + remount. Rare in
      // practice — most apps share one layout across pages — but
      // necessary when a page declares a different `page({ layout })`.
      currentDispose()
      while (document.body.firstChild) document.body.removeChild(document.body.firstChild)
      currentLayouts = next.layouts
      pageSlot.set(next.pageView)
      const wrapped = wrapInLayouts(
        next.layouts,
        next.layoutProps,
        () => pageSlot() as Child,
        next.matched.page.slots,
      )
      currentDispose = wrapped.mount(document.body, null)
      globalThis.scrollTo?.(0, 0)
    })
  }

  return () => {
    routerWatchDispose()
    currentDispose()
  }
}

// ===== keyed — keyed list reconciliation =====
// Extracted to `./keyed.ts` (Tier 1-A continuation, 2026-05-14). Re-
// exported from this barrel so existing public API + per-system gating
// keeps working. The local import lets other code in this barrel
// (e.g. `boot()`'s reactive list rendering) reference `keyed` directly.
// See the extracted module for the implementation + design notes.
import { keyed } from './keyed.ts'
export { keyed }


// ===== Component HOC =====
//
// Wraps a component function so that its body runs inside a cleanup scope at
// *mount time*, not at construction time. This is what makes `onCleanup`
// work for hand-authored callers:
//
//   const Counter = component(() => {
//     onCleanup(() => clearInterval(id))
//     return div({}, [() => count.read()])
//   })
//
//   mount(Counter(), root)
//
// JSX consumers do not need to call `component()` explicitly — the JSX
// runtime auto-wraps every component invocation. See jsx-runtime.ts.

// ===== errorBoundary — catch throws from the wrapped subtree =====
//
// Errors that escape (a) component HOC bodies, (b) reactive children's
// watches, (c) keyed render functions are routed through an internal
// capability to the nearest enclosing `errorBoundary`. The boundary
// renders `fallback(error, retry)` instead of the failing subtree.
// `retry()` clears the captured error and re-mounts `children`.
//
// If no boundary is installed in the ancestor chain, throws propagate
// up to the page (preserving the existing behavior — failures surface
// loudly rather than getting silently swallowed).
//
// What this catches:
//   - Throws inside a component's body (`fn(props)`)
//   - Throws when a component's view tries to mount
//   - Throws inside a reactive child's getter
//   - Throws inside a keyed render callback (via the same component HOC)
//
// What this does NOT catch:
//   - Async errors (Promises rejecting after the synchronous body returns).
//     `resource(loader)` already exposes errors via its `error()` /
//     `status({ state: 'error' })` channel — that's the right shape for
//     async errors; an exception thrown across an `await` boundary is
//     out of scope until reactive scopes propagate (Phase 5).
//   - Throws inside event handlers (onClick, etc.). The browser's
//     event-loop runs those outside any reactive context. If you want
//     a handler-throw to flow into a boundary, wrap manually:
//     `onClick={() => { try { ... } catch (e) { throw e } }}` — though
//     since handlers run after mount, you'd typically want to surface
//     the error via state instead.

// ===== <For each key> — JSX-idiomatic keyed list =====
//
// Thin wrapper over `keyed()`. Accepts either a getter `() => T[]`, a
// `State<T[]>` (callable), or a plain array. Renders each item via the
// children render-prop. Falls through to `fallback` (optional) when the
// list is empty.
//
//   <For each={items} key={(i) => i.id} fallback={<Empty />}>
//     {(item, index) => <Row label={item.label} />}
//   </For>

export interface ForProps<T> {
  each: (() => readonly T[]) | readonly T[] | State<readonly T[]>
  key: (item: T, index: number) => string | number
  children: (item: T, index: number) => View
  fallback?: View
}

export function For<T>(props: ForProps<T>): View {
  const getList: () => readonly T[] =
    typeof props.each === 'function'
      ? (props.each as () => readonly T[])
      : () => props.each as readonly T[]
  // If there's a fallback, render it when the list is empty; otherwise
  // delegate to keyed(). The fallback case wraps in a reactive child so
  // it switches on length changes.
  if (props.fallback === undefined) {
    return keyed(getList, props.key, props.children)
  }
  return el('span', { 'data-place-contents': '' }, (): Child => {
    const list = getList()
    if (list.length === 0) return props.fallback as Child
    return keyed(getList, props.key, props.children) as Child
  })
}

const ErrorBoundaryCap = defineCapability<(error: unknown) => void>('ErrorBoundary')

export interface ErrorBoundaryProps {
  /** What to render in place of `children` when a throw is caught. */
  fallback: (error: unknown, retry: () => void) => View
  /**
   * The protected subtree. On `retry`, re-mounted from the same View —
   * if you need fresh local state on retry, wrap with a thunk yourself
   * by re-creating the JSX inside the parent.
   */
  children: View
}

export function errorBoundary(props: ErrorBoundaryProps): View {
  return {
    // SSR: render children's HTML; if rendering throws, render fallback's
    // HTML instead. The retry function is a no-op on the server (there's
    // nothing to re-mount). Same shape as `mount` semantically — boundary
    // catches throws from the wrapped subtree.
    toHtml: () => {
      try {
        return props.children.toHtml ? props.children.toHtml() : ''
      } catch (e) {
        const view = props.fallback(e, () => {})
        return view.toHtml ? view.toHtml() : ''
      }
    },
    // Hydration: try children's hydrate; if it throws, try fallback's
    // hydrate instead. The DOM came from the SSR path which already
    // resolved which branch (children vs fallback) is rendered, so on
    // the client we mirror by trying children first and falling back
    // on throw — same divergence point as mount.
    hydrate(slot) {
      try {
        return props.children.hydrate ? props.children.hydrate(slot) : () => {}
      } catch (e) {
        const view = props.fallback(e, () => {})
        return view.hydrate ? view.hydrate(slot) : () => {}
      }
    },
    mount(parent, anchor) {
      const slot = document.createComment('error-boundary')
      parent.insertBefore(slot, anchor ?? null)

      // Reactive state holding the captured error. `null` is the "no
      // error" sentinel — anything else (including `undefined`) is
      // treated as a captured error. The watch below re-runs on
      // transitions, swapping between mounting `children` and
      // mounting `fallback(error, retry)`.
      //
      // The watch + state shape works because of reactivity's
      // `needsRerun` guarantee: a write to `errorState` from inside a
      // children-mount that's running under this watch (because the
      // watch IS the one mounting them) is correctly re-queued after
      // the current run finishes, instead of being silently dropped
      // by the COMPUTING short-circuit.
      const errorState = state<unknown>(null)
      const handleError = (e: unknown): void => errorState.write(e)
      const retry = (): void => errorState.write(null)

      // Install the boundary cap BEFORE the watch starts so any throw
      // during the initial mount is caught.
      const stopCap = ErrorBoundaryCap.install(handleError)

      let currentDispose: Disposer = () => {}
      const watchStop = watch(() => {
        currentDispose()
        const e = errorState.read()
        const view = e === null ? props.children : props.fallback(e, retry)
        currentDispose = untrack(() => view.mount(parent, slot))
      })

      return () => {
        watchStop()
        currentDispose()
        slot.remove()
        stopCap()
      }
    },
  }
}

// ===== withCapability — install a capability for the wrapped view's lifetime =====
//
// `cap.provide(impl, body)` is synchronous — it pushes, runs body, pops.
// That's not enough for component-system mounting because:
//
//   1. Component HOC bodies run at mount time (deferred from JSX-creation).
//   2. Watches (e.g. inside `keyed`) fire LATER — after the initial mount
//      tree has settled — and may instantiate new component bodies.
//      For example: clicking "+ new" writes to state, which fires the
//      keyed watch, which mounts a new row. That row's component body
//      calls `cap.use()` and would throw if the cap had been popped.
//
// `cap.install(impl)` keeps the impl on the capability stack until the
// returned disposer is called. We hold the disposer across the wrapped
// view's lifetime — installed at mount, uninstalled after innerDispose.
//
// This means new component bodies created at any time during the wrapped
// view's life (keyed-mounted rows, swapped reactive children, etc.) see
// the capability via `cap.use()`.

// `provide(cap, impl)` + `withCapabilities([…], view)` — the multi-cap
// form. The single-cap `withCapability(cap, impl, child)` stays for
// the simple case; the list form is what apps reach for once they're
// installing 3+ capabilities (router + store + auth + csrf etc.).
//
// `Provision` and `provide()` live in @place/capability — they're the
// fundamental "bind a cap to an impl" primitive. We re-export them from
// here so component consumers see a single import surface.
export { cap, type Provision, provide } from '../../capability/src/index.ts'
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
} from '../../reactivity/src/index.ts'
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
  shape,
  type StandardSchemaV1,
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
export { type FontOptions, type FontResult, font, fonts } from './font.ts'
// `<Form action={...}>` JSX helper for typed action() submission. See
// ./form.ts — works with JS (fetch+JSON) and without (form-encoded POST).
export { Form, type FormProps } from './form.ts'
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
  theme,
  type ThemeMap,
  type ThemeOptions,
  type ThemeTokens,
  type ThemeTokensOptions,
  themeCookieHeader,
  themeTokens,
  type TypographyOptions,
  type TypographyRole,
  type TypographyScaleRatio,
} from './theme.ts'
// Copy-to-clipboard runtime — emitted by `renderPage` with the
// per-request CSP nonce so strict-CSP pages get the script
// executable. Components in `@place/design` (`<Copy>`, `<CodeBlock>`)
// just render the button + call `markCopyUsedOnThisRequest()`;
// emission is centralised here.
export { markCopyUsedOnThisRequest } from './__copy-runtime.ts'
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
// `virtualList()` — windowed-render primitive for long lists (Round 6).
// Reactive `totalSize()` + `visible()` + imperative scroll/measure
// helpers. No hook-shape, no React baggage; ADR 0008.
export {
  type VirtualItem,
  type VirtualList,
  type VirtualListOptions,
  virtualList,
} from './virtual-list.ts'
// Viewport reactivity primitive (ADR 0034). One inline runtime, one
// reactive accessor namespace; consumers subscribe instead of each
// component wiring its own matchMedia/ResizeObserver.
export {
  type Breakpoint,
  configureViewport,
  type ViewportConfig,
  viewport,
} from './viewport.ts'

// ===== ISR — `revalidate(path | tag)` global trigger =====
//
// Apps call `revalidate('/posts/42')` from a server action after a
// mutation, or `revalidate.tag('posts')` to invalidate every page tagged
// with 'posts'. Multiple `serve()` instances in one process share a
// global registry; each instance's cache is invalidated. (In practice
// you have one `serve()` per process — but the registry shape supports
// the rare embedded case.)

const _registeredCaches = new Set<CacheStore>()

interface RevalidateFn {
  /** Invalidate cache entries by full URL path (with optional search). */
  (...keys: string[]): Promise<void>
  /** Invalidate every entry tagged with one of the listed tags. */
  tag(...tags: string[]): Promise<void>
}

export const revalidate: RevalidateFn = Object.assign(
  async (...keys: string[]): Promise<void> => {
    if (keys.length === 0) return
    await Promise.all(Array.from(_registeredCaches, (store) => store.delete({ keys })))
  },
  {
    async tag(...tags: string[]): Promise<void> {
      if (tags.length === 0) return
      // Clear ISR-style page-cache stores first, then any in-process
      // `cache(fn)` memoizers that share the same tags.
      await Promise.all(Array.from(_registeredCaches, (store) => store.delete({ tags })))
      _invalidateCachesByTag(tags)
    },
  },
)

// `withCapability` + `withCapabilities` live in `./_client-mount.ts`
// (re-exported via the block above next to `mount` / `hydrate`).

/**
 * Auto-`<ClientOnly>` marker. When a component's `toHtml` catches
 * `ClientOnlyAbort`, it emits a span with this marker so the client's
 * `hydrate` knows to route mounting through the `ClientOnly` machinery
 * (waiting for the hydrate flag to flip) rather than trying to adopt
 * the placeholder structure directly.
 */
const PLACE_AUTO_ATTR = 'data-place-auto'

/**
 * Options for `component()`.
 */
export interface ComponentOptions {
  /**
   * Skip server-side rendering entirely for this component. SSR emits a
   * placeholder span; the body runs on the client after hydration. Use
   * for components whose initial render genuinely cannot match between
   * server and client — e.g. ones that read `localStorage`, branch on
   * `prefers-color-scheme`, or use other browser-only state that isn't
   * available at SSR time.
   *
   * The framework already auto-detects this when a component touches a
   * `clientOnly: true` capability during its body — the cap's `.use()`
   * throws `ClientOnlyAbort`, which the factory catches. This flag is
   * the opt-in for components that DON'T touch such a cap but still
   * want the same behavior.
   *
   * Equivalent to wrapping every call site in `<ClientOnly>`, but
   * declared once at the component definition.
   */
  clientOnly?: boolean
}

const emitAutoPlaceholder = (): string => {
  const id = nextHydrationId()
  return `<span data-h="${id}" data-place-client-only="" ${PLACE_AUTO_ATTR}="" data-place-contents=""></span>`
}

// Browser globals that are undefined on the server. When a component body
// references one of these during SSR without a `typeof` guard, the
// runtime throws `ReferenceError: <name> is not defined`. The framework
// catches that specific shape and converts it to a `ClientOnlyAbort` —
// the same path the explicit `clientOnly(fn)` HOF takes. Net effect:
// components that read browser-only APIs need ZERO opt-in; SSR emits a
// placeholder and the body mounts on hydration.
//
// We only catch `ReferenceError` matching this exact pattern. Any other
// throw (TypeError, custom Error, framework error) propagates normally.
// Stability: the boundary is narrow enough to avoid masking real bugs.
const BROWSER_GLOBALS = new Set([
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'navigator',
  'location',
  'history',
  'self',
])

function isBrowserGlobalRef(e: unknown): boolean {
  if (!(e instanceof ReferenceError)) return false
  const match = /^([A-Za-z_$][\w$]*) is not defined/.exec(e.message)
  if (!match) return false
  return BROWSER_GLOBALS.has(match[1] as string)
}

/**
 * Mark a component as client-only at the definition site. Equivalent to
 * `component(fn, { clientOnly: true })` — shorter to read at call sites
 * and pairs with `deferred()` as the canonical opt-in trio.
 *
 * Use this when a component's body reads browser-only APIs (localStorage,
 * matchMedia, navigator) and can't be evaluated on the server. SSR emits
 * an empty placeholder; the body mounts on hydration.
 *
 *   const Toggle = clientOnly((props: P) => {
 *     const choice = state(readLocalStorage())
 *     return <button onClick={...}>{...}</button>
 *   })
 *
 * For components that touch a `clientOnly: true` capability, no opt-in
 * is needed — the framework auto-detects via `ClientOnlyAbort`. This
 * HOF is for the cases auto-detect can't catch.
 */
export function clientOnly<P>(fn: (props: P) => View): (props: P) => View {
  return component(fn, { clientOnly: true })
}

/**
 * Render `fallback` on the server; mount `fn(props)` on the client after
 * hydration completes. Like `clientOnly()` but keeps SSR'd structure for
 * layout stability — the fallback occupies space until the real body
 * arrives, avoiding a layout shift on first interaction.
 *
 *   const TimeAgo = deferred(<span>—</span>, (props: { at: number }) =>
 *     <span>{formatRelative(props.at, Date.now())}</span>,
 *   )
 */
export function deferred<P>(fallback: Child, fn: (props: P) => View): (props: P) => View {
  return (props: P): View =>
    Deferred({
      fallback,
      children: () => fn(props),
    })
}

export function component<P>(
  fn: (props: P) => View,
  options?: ComponentOptions,
): (props: P) => View {
  const clientOnlyMode = options?.clientOnly === true
  return (props: P): View => ({
    // SSR path — run the body to get the inner View, then delegate. We
    // discard cleanups (no DOM was created, no event listeners or
    // watches to live past this call). If the body throws
    // `ClientOnlyAbort`, or if `clientOnly: true` is set at the
    // definition site, the framework substitutes an auto-placeholder
    // span instead — the client mounts the real body after hydrate.
    // This makes per-page `clientOnly: true` flags unnecessary: the
    // signaling is structural, originating at the cap's `use()` call
    // OR the explicit definition-site opt-in.
    toHtml: () => {
      if (clientOnlyMode) return emitAutoPlaceholder()
      try {
        const inner = withCleanups([], () => untrack(() => fn(props)))
        return inner.toHtml ? inner.toHtml() : ''
      } catch (e) {
        // Three paths to the placeholder:
        //   1. Explicit `ClientOnlyAbort` from a clientOnly cap.
        //   2. Definition-site `clientOnly: true` (handled above).
        //   3. The body referenced a browser global (window, localStorage,
        //      etc.) without a guard. Auto-detect: emit a placeholder and
        //      mount the body on hydration where the globals exist.
        if (e instanceof ClientOnlyAbort || isBrowserGlobalRef(e)) {
          return emitAutoPlaceholder()
        }
        throw e
      }
    },
    // Hydration mirrors mount: run the body to get the inner View, hand
    // the slot to its hydrate. If the SSR emitted the auto-placeholder
    // span (toHtml caught ClientOnlyAbort), route hydration through the
    // `ClientOnly` primitive — it adopts the empty span and mounts the
    // real body after `_setHydrated(true)` flips. Otherwise: normal
    // path. Cleanups from the body (onCleanup registrations, e.g.
    // globalKey shortcuts) live for the hydrated subtree's lifetime.
    hydrate(slot) {
      // Definition-site `clientOnly: true` — same outcome as the auto
      // path. SSR emitted the placeholder; here we route through
      // ClientOnly without even peeking.
      if (clientOnlyMode) {
        return ClientOnly({ children: () => fn(props) }).hydrate?.(slot) ?? (() => {})
      }
      // Peek at the SSR'd next element first. If it's our auto
      // placeholder, defer to ClientOnly's hydrate (which knows how to
      // adopt the empty span + mount the body reactively on flag flip).
      const peek = slot.peekElement()
      if (peek?.hasAttribute(PLACE_AUTO_ATTR)) {
        return ClientOnly({ children: () => fn(props) }).hydrate?.(slot) ?? (() => {})
      }
      const cleanups: Disposer[] = []
      try {
        const inner = withCleanups(cleanups, () => untrack(() => fn(props)))
        if (!inner.hydrate) {
          throw new Error(
            'hydrate: component returned a view without a hydrate method (custom Views must implement hydrate)',
          )
        }
        const dispose = untrack(() => inner.hydrate?.(slot) ?? (() => {}))
        return () => {
          dispose()
          disposeAll(cleanups)
        }
      } catch (e) {
        disposeAll(cleanups)
        if (e instanceof ClientOnlyAbort) {
          // Client-side a clientOnly cap should be installed; if it
          // isn't, that's a config bug — but still defer to ClientOnly
          // so the user sees the placeholder instead of a crash.
          return ClientOnly({ children: () => fn(props) }).hydrate?.(slot) ?? (() => {})
        }
        const handler = ErrorBoundaryCap.tryUse()
        if (handler === null) throw e
        handler(e)
        return () => {}
      }
    },
    mount(parent, anchor) {
      // Definition-site `clientOnly: true`: on a pure client mount
      // (no SSR'd shell to hydrate) we still want to defer until the
      // hydrate flag flips, in case the consumer is mid-bootstrap. The
      // typical case for `mount` (not `hydrate`) is a CSR-only app, in
      // which `_setHydrated(true)` was already called by `boot()` — so
      // ClientOnly's reactive child fires immediately.
      if (clientOnlyMode) {
        return ClientOnly({ children: () => fn(props) }).mount(parent, anchor)
      }
      const cleanups: Disposer[] = []
      // Untrack the body so that any state reads inside (initial setup,
      // computed defaults, derived helpers) do not subscribe an enclosing
      // watch. Reactive bindings INSIDE the body still create their own
      // independent watches via applyProp / mountReactiveChild, which track
      // correctly per-leaf.
      try {
        const inner = withCleanups(cleanups, () => untrack(() => fn(props)))
        const dispose = untrack(() => inner.mount(parent, anchor))
        return () => {
          dispose()
          disposeAll(cleanups)
        }
      } catch (e) {
        // Run any cleanups registered before the throw, then bubble.
        disposeAll(cleanups)
        if (e instanceof ClientOnlyAbort) {
          // Same auto-fallback as hydrate: a ClientOnly wrapper that
          // defers the body until the hydrate flag is true. On the
          // client this normally doesn't fire (caps are installed
          // before mount), but the guard keeps the failure mode graceful.
          return ClientOnly({ children: () => fn(props) }).mount(parent, anchor)
        }
        const handler = ErrorBoundaryCap.tryUse()
        if (handler === null) throw e
        handler(e)
        return () => {}
      }
    },
  })
}

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
export type { HtmlFactory } from './html-factories.ts'
