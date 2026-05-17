# ADR 0007: The "smaller app" arc — path-on-page, one entry, co-located actions

**Status:** accepted
**Date:** 2026-05-12
**Affects:** `@place/component` (`page()`, `app()`, `routes()`, page `on:` / `search:` / `onError:` / `onNotFound:`)

## Context

After Rounds 1–4 of the DX push and the file-split refactor, the framework's bones are stable but the developer-facing surface still has avoidable friction:

1. **Paths appear two-to-three times.** A page registered at `/posts/:id` is named in the file name, then again as a key in `serve({routes})`, and again in `boot()`.
2. **Two entry files mirror each other.** `server.tsx` calls `serve()`; `client.tsx` calls `boot()`. Every route appears in both.
3. **Actions live elsewhere.** `action({path, input, fn})` is its own file. The page that uses an action imports it and wires it through `<Form action={...}>` or `action.call()`.
4. **Search params are unstructured.** Every page hand-parses `URL.searchParams`.
5. **Error views are global.** `serve({notFound})` is one handler for everything; route-specific 500 / 404 UI requires inline conditional rendering.

The TanStack research showed: their answer is file-based routing, codegen (`routeTree.gen.ts`), and three overlapping data primitives (loader / serverFn / useQuery). Each of those is a failure mode we deliberately don't want.

The right answer is to keep routes-as-values and absorb the duplication into the framework — the developer writes one thing, the framework binds it on both sides. Round 5 ships that absorption.

## Decisions

### 1. `page(path, def)` — path co-located with its page

```ts
export default page('/posts/:id', {
  load: ({ params }) => db.post(params.id),
  view: ({ data }) => <h1>{data.title}</h1>,
})
```

The path lives on the page object. `serve()` reads it. `boot()` reads it. The developer writes the path exactly once.

Legacy `page(def)` keeps working — used by `serve({routes: {'/path': page}})` where the routes object owns the path. Two-arg form is the recommended default.

### 2. `app(pages, opts).serve() / .boot()` — one entry

```ts
// app.tsx — replaces both server.tsx and client.tsx
import { app } from '@place/component'
import home from './home.page'
import post from './post.page'

export default app([home, post], { security: 'standard' }).serve()
```

`app()` derives the routes object from each page's `path`. The same `app` instance dispatches both `serve()` (server-side, throws if called in browser) and `boot()` (browser-side, throws if called in server). The two entry files collapse to one.

### 3. `routes(prefix, pages, opts?)` — feature-folder grouping

```ts
// admin/index.ts
export default routes('/admin', [dashboard, users, settings], { layout: adminLayout })

// app.tsx
import adminRoutes from './admin'
import postRoutes from './posts'
export default app([home, ...adminRoutes, ...postRoutes]).serve()
```

Pure value transform: each page's `path` is prefixed, layout inherits (page's own layout wins). Composable — `routes('/admin', routes('/users', [...]))` works. No file-system convention, no codegen.

### 4. `on: {}` on pages — co-located actions

```ts
export default page('/posts/:id', {
  on: {
    delete: async (_input, { params }) => {
      await db.delete(params.id)
      return { redirect: '/' }
    },
  },
  view: ({ data }) => <button onClick={() => postPage.delete()}>Delete</button>,
})
```

Each `on` entry auto-registers at `POST {page.path}/_action/{key}` with the full action() security pipeline (CSRF, same-origin, body limit, proto pollution). The typed caller is attached as a method on the returned page object — `postPage.delete()` works server-side (direct call) and browser-side (fetch with auto-CSRF), with full type inference.

Requires the two-arg `page(path, def)` form (needs a path to compose the endpoint). The standalone `action({path, input, fn, middlewares?})` API remains for advanced cases (different paths, custom middleware, decoupled actions).

### 5. `search: parser` — typed query params

```ts
export default page('/posts', {
  search: shape({ page: 'number', tag: 'string?' }),
  load: ({ url }) => db.posts(url.searchParams.get('page')),
  view: ({ data, search }) => <PostList page={search.page} tag={search.tag} />,
})
```

Any Standard-Schema-compliant parser works (Zod 4, Valibot, hand-rolled, or our `shape()`). Parsed result populates `props.search`. Parse failure routes to the page's `onError` (or the global error overlay). Server-side AND client-side (boot re-parses for hydration parity + post-navigation freshness).

### 6. `onError` / `onNotFound` + `notFound()` helper

```ts
export default page('/posts/:id', {
  load: async ({ params }) => {
    const p = await db.post(params.id)
    if (!p) throw notFound()
    return p
  },
  onError: (err) => <ErrorPage err={err} />,
  onNotFound: () => <h1>Post not found</h1>,
  view: ({ data }) => <Article post={data} />,
})
```

`notFound()` is a typed signal; the framework catches and routes to the page's `onNotFound` (404) or `onError` (500). Falls through to the global `serve({notFound})` handler if absent.

## Why this beats TanStack's shape

| Concern | TanStack Start | place-ts Round 5 |
|---|---|---|
| Routes are values | code-based mode requires hand-wiring `addChildren`; file-based requires codegen | path on page; explicit array passed to `app()` |
| Path locality | file name OR `createFileRoute('/path')` AND the file path must match | `page('/path', def)` — once |
| Server/client mirror | `start.tsx` + `client.tsx` + `routeTree.gen.ts` (codegen) | one `app.tsx` |
| Type safety | full E2E via heavy generics + codegen + module augmentation (`Register`) | E2E via page object types + `app()` returning typed router |
| Co-located actions | `createServerFn` separate file | `on: {}` dict on the page |
| Search params | `validateSearch` (Standard Schema) | `search: shape()` (Standard Schema) |
| Per-route error views | `errorComponent` / `notFoundComponent` | `onError` / `onNotFound` |
| Three data primitives confusion | loader + serverFn + useQuery | one: `load()` + `resource()` |
| Boundary errors | "Import Protection" Vite plugin band-aid (Feb 2026) | physical file split: `*.page.tsx` pure; `*.server.ts` impure |

## Consequences

### Positive

- **Demo app reduction (measured on sync-server):** Phase A alone collapses `server.tsx` + `client.tsx`'s route-registration block + per-page path duplication for a 28% LOC reduction; Phase B projection 38% after `on:` migration.
- **Refactors are TypeScript renames.** No file-watcher, no codegen step, no stale `.d.ts`.
- **Co-located actions get auto-CSRF.** Users who write `on: { delete: fn }` get the full security pipeline without thinking about it. The opt-out (standalone `action()`) is for advanced cases, not the default.
- **Hydration parity is enforced.** `app()` ensures the server's `routes` table and the browser's `boot()` arguments are derived from the same array — they can't drift.
- **Anti-bloat survives.** Today's `serve({routes})` + `boot()` + `action()` keep working. Migration is incremental. No deprecations.

### Required

- **`on:` requires a path.** The two-arg `page(path, def)` form is mandatory if you want co-located actions. Pages registered the legacy way can still use standalone `action()`.
- **`search:` is server + client.** The schema runs on both sides; ensure your parser is deterministic and side-effect-free.
- **`onError` only catches `load()` throws today.** View-render throws still route to `renderRouteError` for the global dev overlay / production 500. Future cuts can extend.

### Open / deferred

- **Meta hoisting from JSX** (Cut 5.4 in the plan) — deferred to a focused session. The walker + reactive title binding + hydration parity is real work that deserves its own care window. Today's `meta:` field stays the only way.
- **Implicit `app([...]).serve()` (no explicit method call)** — considered but rejected for v1. Explicit `.serve()` is greppable and matches the runtime gate. If a workload demands no-magic auto-start, revisit.
- **Per-page nested layouts beyond reference composition** — handled today via `layout: parentLayout` on the layout itself. Deeper nesting (e.g. `layout(layout(layout(...)))`) works structurally; no new primitive needed.

## Alternatives rejected

| Alternative | Why rejected |
|---|---|
| File-based routing (TanStack default mode, Next App Router) | Rename file → break URL; codegen step; stale `.d.ts`; the failure mode the research surfaced |
| `routeTree.gen.ts` codegen | Generated files in source; out-of-sync states; the failure mode |
| `'use server'` / `'use client'` directives | Compiler-pass magic; Babel/SWC dependency; ADR 0003 already commits against this |
| Auto-discovery via module side effect | Breaks tree-shaking; obscures where routes register; the failure mode |
| Implicit `app([...])` auto-start (no `.serve()`) | "Magic" runtime detection; harder to grep; risk of unintended server start in tests |
| Meta hoisting via Babel transform | Compiler magic; not shippable under anti-bloat directive |

## How to adopt

Existing apps don't have to change. Migrate one page at a time:

1. Add the path to `page()`: `page({...})` → `page('/posts/:id', {...})`.
2. Once all pages have paths, replace `serve({routes})` + `boot()` with `app([...]).serve()`/`.boot()`.
3. Move co-located actions into `on: {}` on the relevant page.
4. Add `search: shape({...})` to pages that consume query params.
5. Add `onError` / `onNotFound` to pages that need route-specific error UI.

Each step is independent. The `serve()` + `boot()` + standalone `action()` paths remain available — Round 5 is additive, not a deprecation.
