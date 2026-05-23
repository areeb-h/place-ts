// @place-ts/component — the page / layout / handler authoring API.
//
// Extracted from index.ts (Tier 20 decomposition, cut 7) — the
// declarative surface authors call to build a server-rendered app:
//   - handler()  — wraps a route fn into a Request → Response
//   - page()     — the declarative Page object (server + client)
//   - layout()   — composable wrappers around pages
//   - useSearch / notFound — the page-body helpers
//
// `index.ts` re-exports the public surface. The per-request SSR
// assembly (`renderPage`) stays in the barrel for now; it composes
// these values + the SSR pipeline + the serve() orchestrator, and is
// re-homed when serve() is split. This module touches `index.ts`-
// resident symbols only inside runtime functions, so the page ⇄ index
// cycle stays benign — same shape as element.ts / mount.ts / ssr.ts.

import type { ParamsOf } from '@place-ts/routing'
import { action } from './action.ts'
// `component` still lives in index.ts; `mergeMeta` / `resolveMeta`
// moved to ./render-page.ts with `renderPage`. Both are touched only
// inside runtime functions, so the cycles stay benign.
import { component } from './index.ts'
import { type PageMeta, renderDocument, type StyleSrc } from './meta.ts'
import { mergeDocumentClasses, mergeMeta, resolveMeta } from './render-page.ts'
import type { RouteHandler } from './server-router.ts'
import { renderToStream, renderToString } from './ssr.ts'
import type { Child, View } from './types.ts'

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

export const PLACE_LOAD_SCRIPT_ID = '__place_load__'

/** Marker key on Page objects so serve()/boot() can recognize them. */
export const PLACE_PAGE_BRAND = Symbol('place.page')

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
  /**
   * `true` when this request is a speculative **prefetch** — the
   * SPA-nav runtime warmed the page on link hover/focus, the user has
   * not actually navigated here. A prefetch `load()` MUST render the
   * SAME content it would for a real visit (the prefetched HTML is
   * what gets swapped in on the click) but should SKIP side effects:
   * analytics, view-count increments, audit logging, anything that
   * mutates state. Reads should still run.
   *
   *   load: (ctx) => {
   *     if (!ctx.prefetch) recordVisit(ctx.req)   // effect — skip on prefetch
   *     return { article: getArticle(ctx.params.id) }  // content — always
   *   }
   *
   * Derived from the `X-Place-Prefetch` request header. Always
   * `false` for a normal navigation or hard load.
   */
  prefetch: boolean
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
  meta?: PageMeta | string | ((props: PageViewProps<U, L, S>) => PageMeta | string)
  /**
   * Class attribute on `<html>`. Document-shell styling — sibling of
   * `meta:` (which is for tags that get emitted into `<head>`), not a
   * nested field. Scanned by Tailwind because the value is a string
   * literal in source.
   *
   *   page('/', { htmlClass: 'h-full', view: () => … })
   *
   * Concatenated with the layout chain's `htmlClass`: a root layout can
   * set `h-full` and a page can add classes without losing the parent's.
   */
  htmlClass?: string
  /**
   * Class attribute on `<body>`. Same shape and concatenation rules as
   * `htmlClass`. Common use: page background, text color, font family,
   * antialiasing — things a CSS reset would normally handle.
   *
   *   page('/', {
   *     bodyClass: 'bg-bg text-fg font-sans antialiased',
   *     view: () => …,
   *   })
   */
  bodyClass?: string
  /**
   * Stylesheets. URL strings emit `<link rel="stylesheet">`, `{ inline }`
   * emits `<style>`. Pass an array to combine. The `tailwind()` helper
   * from `@place-ts/component/tailwind` returns an `{ inline }` source.
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
   * conflicts). Top-level `htmlClass` / `bodyClass` (siblings of `meta`)
   * concatenate across the chain. Layout styles are emitted in `<head>`
   * BEFORE the page's, so page styles can override.
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
const NOT_FOUND_MARKER: unique symbol = Symbol.for('@place-ts/component:notFound')

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
export function isNotFoundError(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && (e as Record<symbol, unknown>)[NOT_FOUND_MARKER] === true
  )
}

// ===== redirect — branded error caught by renderPage → Response =====
//
// Parallel shape to `notFound()`. Throw `redirect(url)` from `load()`
// (or any code that runs in the render pipeline) to short-circuit
// rendering and emit a `Response` with a `Location` header.
//
// Pre-0.10.7 authors had to construct a `new Response(null, { status:
// 302, headers: { Location: url } })` and either throw it (works only
// inside route handlers) or branch out of `load()` into a custom
// dispatch path. Neither option is consistent with the `notFound()`
// pattern.

const REDIRECT_MARKER: unique symbol = Symbol.for('@place-ts/component:redirect')

/** Internal: payload attached to a redirect error so renderPage can
 *  build the Response without re-parsing the message. */
interface RedirectPayload {
  readonly url: string
  readonly status: 301 | 302 | 303 | 307 | 308
}

/**
 * Throw `redirect(url)` from `load()` (or anywhere in the render
 * pipeline) to emit a 302 redirect response. The framework catches the
 * branded error and returns a `Response` with `Location: <url>` and the
 * supplied status (default 302).
 *
 * ```ts
 * page('/admin', {
 *   load: ({ req }) => {
 *     const session = readSession(req)
 *     if (!session) throw redirect('/login')
 *     return { admin: session.user }
 *   },
 *   view: ({ admin }) => <h1>Hi {admin.name}</h1>,
 * })
 * ```
 *
 * Use 302 (default) for typical "moved temporarily" cases like
 * auth-gated routes. For permanent moves prefer `temporaryRedirect`'s
 * `status: 308` (preserves method + body for non-GET). Returns `never`
 * so TypeScript narrows correctly at the call site.
 */
export function redirect(url: string): never {
  const e = new Error(`redirect: ${url}`)
  ;(e as Error & { [REDIRECT_MARKER]?: RedirectPayload })[REDIRECT_MARKER] = {
    url,
    status: 302,
  }
  throw e
}

/**
 * Like `redirect(url)` but with an explicit HTTP status. Valid statuses:
 *
 *   - `301` Moved Permanently   — cacheable; UA may rewrite POST→GET
 *   - `302` Found               — default for `redirect()`
 *   - `303` See Other           — always switches POST→GET
 *   - `307` Temporary Redirect  — preserves method + body
 *   - `308` Permanent Redirect  — cacheable; preserves method + body
 *
 * Most apps want 302 (use `redirect()`) or 307 (use this with `307`).
 * Permanent (`301` / `308`) only when the resource has truly moved
 * forever and you want the redirect cached.
 */
export function temporaryRedirect(
  url: string,
  status: 301 | 302 | 303 | 307 | 308 = 307,
): never {
  const e = new Error(`redirect: ${url} (${status})`)
  ;(e as Error & { [REDIRECT_MARKER]?: RedirectPayload })[REDIRECT_MARKER] = {
    url,
    status,
  }
  throw e
}

/** Internal: detect a redirect-marked error. */
export function isRedirectError(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && (e as Record<symbol, unknown>)[REDIRECT_MARKER] !== undefined
  )
}

/** Internal: extract the redirect payload (url + status). */
export function getRedirectPayload(e: unknown): RedirectPayload | null {
  if (typeof e !== 'object' || e === null) return null
  const p = (e as Record<symbol, unknown>)[REDIRECT_MARKER]
  return (p as RedirectPayload | undefined) ?? null
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

export function makeSlots<S extends string>(fills: SlotFills | undefined): LayoutSlots<S> {
  const fn = (name: S): Child => {
    const fill = fills?.[name]
    return fill ? fill() : null
  }
  ;(fn as LayoutSlots<S>).has = (name: S): boolean =>
    fills !== undefined && typeof fills[name] === 'function'
  return fn as LayoutSlots<S>
}

export interface LayoutDef<L extends object = Record<string, never>, S extends string = string> {
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
   * (title, description, etc.) follow last-write-wins (page wins).
   * `og` / `twitter` objects are replaced wholesale by the page's value.
   *
   * Setting `titleTemplate` here ('%s · my site') makes every page's
   * title compose with the template — see `PageMeta.titleTemplate`.
   *
   * Accepts a string shorthand (`'My Site'` → `{ title: 'My Site' }`)
   * for symmetry with `PageDef.meta`.
   */
  meta?: PageMeta | string | ((props: L) => PageMeta | string)
  /**
   * Class attribute on `<html>`. Document-shell styling — sibling of
   * `meta:`. Concatenated with any inner layout's and the page's
   * `htmlClass` (root layout's classes ship first, page's classes last).
   *
   *   layout({ htmlClass: 'h-full', view: ({ children }) => … })
   */
  htmlClass?: string
  /**
   * Class attribute on `<body>`. Same shape and concatenation rules as
   * `htmlClass`. Common use: site-wide background + text color + font.
   *
   *   layout({
   *     bodyClass: 'bg-bg text-fg font-sans antialiased',
   *     view: ({ children }) => …,
   *   })
   */
  bodyClass?: string
  /**
   * Stylesheets emitted in `<head>` BEFORE the page's styles, so the
   * page's styles can override the layout's.
   */
  styles?: StyleSrc | StyleSrc[]
}

/** Layout object — opaque, branded so isLayout() can detect it. */
export interface Layout<L extends object = Record<string, never>, S extends string = string>
  extends LayoutDef<L, S> {
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
  htmlClass?: string
  bodyClass?: string
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
export function layout<L extends object = Record<string, never>, S extends string = string>(
  def: LayoutDef<L, S>,
): Layout<L, S> {
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
export function page<Path extends string, L extends object = Record<string, never>, S = unknown>(
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
export function page<Path extends string>(path: Path, viewFn: () => View): AnyPageResult
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
      typeof maybeDef === 'function' ? ({ view: maybeDef } as AnyPageDef) : (maybeDef as AnyPageDef)
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
  htmlClass?: string
  bodyClass?: string
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

// Escape JSON for safe embedding inside a `<script>` tag. The standard
// gotcha: a literal `</script>` in the JSON would close the tag. Also
// escape `<!--` (HTML comment open) for paranoia. The escaped output is
// still valid JSON (\uXXXX is JSON-legal everywhere).
// JS line terminators. Not in source as literals (some toolchains
// stumble on them); built from char codes to keep this file plain ASCII.
const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)

export function escapeForJsonScript(json: string): string {
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
 *  serve() injects (the route's per-route bundle URL, when one exists). */
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
   * Theme choice-name → `<html>` class map, forwarded into the
   * SPA-nav runtime so it preserves the user's live theme across an
   * `<html class>` swap (the destination page carries the build-time
   * default theme). `serve()` derives this from `options.theme`.
   */
  spaNavThemeClassMap?: Readonly<Record<string, string>>
  /**
   * Enable hover/focus prefetch in the SPA-nav runtime. `serve()`
   * threads this from `ServeOptions.prefetch`. Default `true`.
   */
  spaNavPrefetch?: boolean
  /** Hover-intent delay (ms). Default `65`. */
  spaNavPrefetchHoverDelayMs?: number
  /** LRU cap on cached prefetch entries. Default `24`. */
  spaNavPrefetchMax?: number
  /** TTL (ms) for a cached prefetch entry. Default `30_000`. */
  spaNavPrefetchTtlMs?: number
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
   * Class to merge into `<html class="…">` after the layout/page chain's
   * own `htmlClass`. Used by serve()-level concerns that want to
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
  /**
   * When set, `renderPage` appends a `<div data-view="island"
   * data-view-id="place-devtools" data-view-strategy="idle">` marker at
   * the end of the body. The marker triggers the island runtime to
   * fetch + mount `@place-ts/devtools`'s panel on idle. `serve()` sets
   * this when its own `devtools` option resolves to enabled and the
   * island registration succeeded. Apps should not set this directly.
   */
  emitDevtoolsMarker?: boolean
}

/**
 * Round 5 (5.7): render a Page's `onError` / `onNotFound` view with the
 * same layout/meta/styles pipeline as a regular render. Used by
 * `renderPage()` when the page declares its own error or not-found
 * handler — keeps the response shape consistent (same head, same
 * layouts, same security headers).
 */
export async function renderPageWithCustomView(
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
  // Collect document-shell classes from the layout chain + page. Same
  // concatenation rule as the happy-path renderPage — keep the error/
  // notFound page visually consistent with the rest of the site.
  const docClasses = mergeDocumentClasses(layouts, p)
  // Render view to HTML (sync path — error/notFound views shouldn't suspend).
  const body = wrapped.toHtml?.() ?? ''
  const docHtml = renderDocument(body, {
    ...(meta ? { meta } : {}),
    ...(docClasses.htmlClass ? { htmlClass: docClasses.htmlClass } : {}),
    ...(docClasses.bodyClass ? { bodyClass: docClasses.bodyClass } : {}),
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
