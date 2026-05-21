# 00 — Routing System Charter

**Status:** shipped. Public surface stable in v0.1; loader-coupling
and capability-typed route guards remain on the horizon (Tier 16+).

## Thesis

**Routes are values, paths are typed at the call site, and the URL
is a reactive state cell.** No file-system routing. No `+page.svelte`
filename convention. No `app/page.tsx` directory magic. Every route's
URL pattern is a string literal in the page value:

```tsx
page('/posts/:id', { view: ({ params }) => <Post id={params.id} /> })
```

`ParamsOf<'/posts/:id'>` inferred from the literal type, propagates to
`params`, `load()` ctx, `meta()`, `view()`. The route key, the params
shape, and the call site all line up in one place.

Routing is the framework's structural response to the "file-system
routing produces brittleness" charter clause (07-prior-art-failures,
§Magic conventions). Move a file, your route doesn't change. Two
pages claim the same path, the framework throws at `app()` time
with a list of offenders.

## What this system owns

### `Router` (the reactive shell) + `RouterCap` (the slot)

`Router` is the runtime value — a typed `{ path, search, hash,
navigate, replace, back, forward }`. `RouterCap = defineCapability<Router>(
'Router', { clientOnly: true })` is the capability slot. Apps configure
which router fills it via `app({ router })`; the framework
auto-installs via `_auto-init.ts` (ADR 0024).

### Router factories: `pathRouter()` / `hashRouter()` / `memoryRouter()`

Three runtime strategies:
- `pathRouter()` — `pushState` / `popstate` (default for SSR-able apps)
- `hashRouter()` — `location.hash` (deploy-target-friendly when
  server-side routing isn't available; e.g. GitHub Pages)
- `memoryRouter(initial?)` — in-memory only (tests, embedded UIs)

Each returns a `RouterHandle` triple-duty value (Router + Provision +
Disposer) — drop into `app({ router })` directly.

### `serverRouter(req)` — SSR-side router

A read-only `Router` constructed from a Bun `Request`. Installed by
`renderPage` for the duration of a single SSR pass. Throws on
navigation methods (server can't `push`). The component-system's
`<Link>` uses this to auto-mark `aria-current="page"` for SSR.

### `<Link>` component

Typed-prop wrapper around `<a>` that intercepts clicks (when SPA-nav
is enabled), preserves modifier-click semantics, and adds
`data-place-link` markers that `__spa_nav.ts` re-scans after each
navigation to keep `aria-current` coherent.

### `route()` and `searchParams()` (typed primitives)

`route('/posts/:id')` returns `{ pattern, build({ id }) }` for typed
URL construction. Hardcoded patterns work too; `route()` is the
schema-style variant used by typed nav menus / sitemaps.

`searchParams(parser)` is the typed query-param accessor —
`searchParams(shape({ page: 'number', tag: 'string?' }))` returns a
typed `() => { page: number; tag?: string }`.

### `parsePath(url)` and `routes('/prefix', [pages])`

Pure helpers: `parsePath` extracts `{ pathname, search, hash }`;
`routes('/prefix', [pages])` returns an array of pages whose paths
are prefixed by `/prefix`. The latter is the canonical URL-hierarchy
composition primitive — used by every `pages/api/index.ts`-style
barrel.

### Cross-system event: `place:nav`

After each SPA navigation the `__spa_nav.ts` runtime dispatches a
`place:nav` CustomEvent on `window`. Subscribers include the deferred-
islands runtime (re-scan markers), the sidebar `aria-current`
updater, the SPA-nav `<main>` swap. **Documented contract** —
external code can listen for it. (Currently absent from
`04-interfaces.md`; carried to Tier 15-C.)

## What this system does NOT own

- HTTP / SSR transport — `@place-ts/component`'s `serve()` does that.
- Component lifecycle — `@place-ts/component` owns mount/hydrate.
- Data fetching — loaders are `page({ load })`; this system just
  hands the params off.
- Scroll restoration — `__spa_nav.ts` (in `@place-ts/component`) handles
  scroll; routing only signals the navigation.

## Architectural commitments

1. **Routes are values, not file paths.** `page('/posts/:id', def)` is
   the source of truth. File location is meaningless.
2. **Params are typed from the path string.** `ParamsOf<'/posts/:id'>`
   = `{ id: string }`. Zero runtime cost; pure TS inference.
3. **One router cap per page lifecycle.** Apps pick `pathRouter` /
   `hashRouter` / `memoryRouter` once; can't switch at runtime.
4. **The URL is reactive state.** `Router.path()` returns a `State`-
   shaped accessor — components subscribe directly.
5. **SSR is read-only.** `serverRouter()` throws on `.navigate()` etc.
   The Router contract narrows server-side.

## Depends on

- `@place-ts/capability` — `RouterCap` install/use machinery
- `@place-ts/reactivity` — `Router.path()` is `Derived<string>`; `state()`
  cells back the path / search / hash internally
- `@place-ts/component` — Link uses the cap, SPA-nav runtime listens
  for navigation

## Public surface (v0.1)

```
RouterCap                                  Capability<Router>
type Router                                { path, search, hash, navigate, ... }
type RouterHandle                          Router + Provision + Disposer
type ClientCapImport                       __placeClientImport metadata shape

pathRouter()                               RouterHandle
hashRouter()                               RouterHandle
memoryRouter(initial?)                     RouterHandle
serverRouter(req)                          Router  (read-only, SSR)

route(pattern)                             { pattern, build(params) }
type ParamsOf<P extends string>            inferred map

searchParams(parser)                       () => parsed schema
parsePath(url)                             { pathname, search, hash }
routes(prefix, [pages])                    AnyPage[]   (prefix-composed)

<Link to={'/x'} />                         JSX component
```

## What's NOT shipped yet (open questions for Tier 16+)

- **Loader coupling** — pages declare which queries they need; the
  routing system pre-fetches them on navigation hover. Currently the
  page's `load()` runs after navigation lands. The hover-prefetch
  pattern is sketched but not implemented.
- **Capability-typed route guards** — `<Can do="…">` exists in the
  audit's Tier 16 list; routing should compose with it for guarded
  routes.
- **Transition coordination** — render-next-while-current-stays-visible
  (Solid-style suspense routing) is on the horizon.

## Phase

**v0.1** (shipped, stable for the listed surface). Loader coupling +
route guards = **v0.2** (Tier 16).
