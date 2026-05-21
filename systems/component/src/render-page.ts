// @place-ts/component — the per-request SSR assembly: renderPage.
//
// Extracted from index.ts (Tier 20 decomposition, cut 10) — the final
// cut. `renderPage` is the orchestration function that threads every
// other module together per request: it resolves the page's URL +
// load data, runs the SSR pipeline, collects islands + inline-style
// hashes, merges the layout-meta chain, and assembles the HTML
// document Response. The layout-meta merge helpers (`resolveMeta` /
// `mergeMeta`) live here too — they are renderPage's machinery.
//
// `index.ts` re-exports `renderPage`; `serve.ts` calls it per-request.
// This module touches `index.ts`-resident symbols only inside runtime
// functions, so the render-page ⇄ index cycle stays benign — same
// shape as element.ts / mount.ts / ssr.ts / serve.ts.

import { serverRouter as createServerRouter, RouterCap } from '@place-ts/routing'
import { _consumeCopyUsedFlag, placeCopyRuntime } from './__copy-runtime.ts'
import { placeDeferredIslands } from './__deferred-islands.ts'
import { placeEarly } from './__early.ts'
import { placeHmr } from './__hmr.ts'
import { placeSpaNav } from './__spa_nav.ts'
import { placeTabs } from './__tabs.ts'
import { placeViewport } from './__viewport-runtime.ts'
import { _beginInlineStyleCollection, _endInlineStyleCollection } from './_internal/inline-style.ts'
import { _CookieJarCap, parseCookieHeader } from './cookies.ts'
import { _beginHeadingCollection, _endHeadingCollection, _getFirstH1Text } from './element.ts'
import { renderRouteError } from './error-overlay.ts'
// `INLINE_STYLE_HASHES_HEADER` lives in index.ts — a runtime const
// touched only inside `renderPage`, so the cycle stays benign.
import { INLINE_STYLE_HASHES_HEADER } from './index.ts'
import {
  _beginIslandCollection,
  _endIslandCollection,
  _getIslandBundleUrl,
  _getIslandRegistry,
  _getSharedChunkUrls,
  Island,
} from './islands.ts'
import { type HeadEntry, type PageMeta, renderDocument, type StyleSrc } from './meta.ts'
import { _consumeTabsUsedFlag } from './mount.ts'
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
import { sha256Base64 } from './security-headers.ts'
import { renderToStream, renderToString } from './ssr.ts'
import { rerenderIsland } from './ssr-toc.ts'
import type { View } from './types.ts'
import { escapeHtmlAttrFull } from './utils/escape.ts'

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
      // Auto-emit the devtools island marker at the end of body when
      // enabled. Goes inside the island-collection scope so the bundler
      // sees `place-devtools` as "used" and emits its `<script>` tag.
      // The standard `<Island>` JSX path handles validation, prop
      // sanitization, and strategy. Idle strategy: the panel fetches
      // its bundle off the critical path.
      if (options?.emitDevtoolsMarker) {
        const marker = Island({ name: 'place-devtools', client: 'idle' })
        body += marker.toHtml?.() ?? ''
      }
    } catch (e) {
      _endIslandCollection()
      _endInlineStyleCollection()
      _endHeadingCollection()
      return renderRouteError(e, req, 'render')
    }
    _endIslandCollection()
    _endHeadingCollection()
    // NOTE: do NOT end the inline-style collector here. The hooks
    // below (`ssrProps` resolvers + `transformBody`) re-render island
    // markers and run app-level body transforms — both can emit
    // inline `style="…"` attributes through the same JSX path that
    // records them into the collector. Closing the collector here
    // would silently drop those hashes from the response's
    // `style-src 'unsafe-hashes' 'sha256-…'` directive; strict CSP
    // then blocks the style at first paint with no warning at
    // render time. Closed at the end of the SSR write path instead.
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
        _endInlineStyleCollection()
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
        _endInlineStyleCollection()
        return renderRouteError(e, req, 'render')
      }
    }
    // Now safe to close the collector — every code path that can emit
    // inline `style="…"` attributes through the JSX pipeline has run.
    // The collected hash list is read by `renderSecurityHeaders` via
    // the `X-Place-Inline-Style-Hashes` private response header and
    // folded into the `style-src` CSP directive.
    _endInlineStyleCollection()
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
