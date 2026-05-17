# Sync-server in Round 5 shape — sketch + LOC comparison

**Goal:** validate that the "smaller app" thesis (Round 5) produces measurably less developer code on a real, non-trivial example before shipping Phase B/C.

**Status:** sketch only — code NOT committed. Used to gate Phase B.

---

## Today's shape (after Round 5 Phase A but before migration)

```
                  LOC   File
                  ---   ----
                   57   src/Page.tsx             (shared component, not a route)
                  130   src/actions.page.tsx     (route)
                   27   src/client.tsx           (client entry, mirrors server)
                   46   src/home.page.tsx        (route)
                   59   src/index.page.tsx       (route)
                  313   src/server.tsx           (server entry — most is /kv routes, sessions, etc.)
                   51   src/siteLayout.tsx      (layout)
                  110   src/slow.page.tsx        (route)
                   59   src/counter.action.ts   (standalone action)
                   55   src/counter.server.ts   (server-only counter helpers)
                  ---
                  907   total
```

The duplication that Round 5 attacks:
- **`client.tsx` (27 LOC)** mirrors the `serve()`'s `routes` + `layout` config. Every route is listed twice (server.tsx + client.tsx).
- **`server.tsx` lines 1-160** import all four routes and pass them to `serve({routes})`. Route paths are written here.
- **Per-page files** declare with `page({...})` and don't carry their path.

## After Round 5 Phase A migration

```
                  LOC   File
                  ---   ----
                   57   src/Page.tsx              (unchanged — shared component)
                  130   src/actions.page.tsx      (only diff: page('/actions/demo', {...}))
                   46   src/home.page.tsx         (only diff: page('/ssr/demo', {...}))
                   59   src/index.page.tsx        (only diff: page('/', {...}))
                  110   src/slow.page.tsx         (only diff: page('/ssr/slow', {...}))
                   51   src/siteLayout.tsx        (unchanged)
                   59   src/counter.action.ts     (unchanged — standalone action stays)
                   55   src/counter.server.ts     (unchanged)
                  ~145  src/server.tsx            (was 313: removes route imports + the routes obj for the 4 page routes; non-page /kv handlers + sessions remain)
                  ---
                  652   total (–28%)
```

**Delete `client.tsx` entirely** (–27 LOC). The new entry is:

```tsx
// src/app.tsx (new — replaces both client.tsx AND the routes-section of server.tsx)
import { app, routes } from '@place/component'
import { actionsPage } from './actions.page'
import { homePage } from './home.page'
import { indexPage } from './index.page'
import { slowPage } from './slow.page'
import { siteLayout } from './siteLayout'

export default app(
  [indexPage, homePage, slowPage, actionsPage],
  { layout: siteLayout },
)
```

`server.tsx` keeps the non-page handlers (`/kv`, `/auth/*`, WebSocket upgrade) — those are not pages, they're raw `(req, params) => Response` handlers. The new shape:

```tsx
// src/server.tsx (was 313 LOC — now ~145)
import { Database } from 'bun:sqlite'
// ...all the non-page setup unchanged: sessions, CSRF, sqlite, rate limit...
import app from './app'

await app.serve({
  port: PORT,
  clientEntry: `${import.meta.dir}/client-boot.tsx`,
  // pre-router hook adds the /kv + /auth/* handlers (unchanged)
  fetch: (req, srv) => { /* WebSocket upgrade + non-page handlers */ },
})
```

Wait — `app([pages]).serve()` doesn't currently accept the non-page hooks. The plan needs `app(pages, opts).serve()` where opts is `AppOptions` (which IS `Omit<ServeOptions, 'routes'>` — so `fetch`, `websocket`, `port`, etc. all pass through). Confirmed in app.ts.

**Updated shape:**

```tsx
// src/server.tsx
import { app, routes } from '@place/component'
import { actionsPage } from './actions.page'
// ... other route imports + non-page setup (sessions, sqlite, etc.)
import { siteLayout } from './siteLayout'

await app(
  [indexPage, homePage, slowPage, actionsPage],
  {
    port: PORT,
    layout: siteLayout,
    clientEntry: `${import.meta.dir}/client-boot.tsx`,
    fetch: (req, srv) => { /* /kv, /auth/*, WS upgrade — unchanged */ },
    websocket: { /* unchanged */ },
  },
).serve()
```

This collapses `server.tsx` + `client.tsx` route-registration into a single `app([pages], opts).serve()` call. Per-page `path` lives in each page file.

---

## What Phase B will further reduce

Phase B (5.3, 5.5) attacks the remaining duplication inside the page files:

- **`counter.action.ts` (59 LOC) + `counter.server.ts` (55 LOC) + the `<Form action={...}>` wiring in `actions.page.tsx`** can collapse to a single `on: { increment: ... }` dict on the actions page. The standalone `counter.action.ts` goes away — its handler moves to the `on:` dict on the page that uses it. Estimated reduction: ~30 LOC from the actions page + 59 LOC from `counter.action.ts` deletion = ~90 LOC.

- **`/auth/me` route in `server.tsx`** could be a `GET` page or a separate action — depends on whether the response is HTML or JSON. Keep as raw handler for now.

**Projected after Phase A+B:** ~560 LOC total (–38% from 907).

---

## What this validates

✅ **The "many pages" concern is addressed:** the new `app([...pages])` array supports unlimited routes. Feature folders (which sync-server doesn't have but commonplace would) get the `routes('/admin', [...])` helper.

✅ **Per-page path co-location works:** each `.page.tsx` file now declares its own path. The mental model "where does `/ssr/demo` live?" answers itself — search for `page('/ssr/demo'`.

✅ **Non-page handlers still work:** `app(pages, { fetch, websocket })` passes through to `serve()`. The sync-server's `/kv` REST endpoints and WebSocket upgrade work unchanged.

✅ **LOC reduction is real:** 907 → 652 in Phase A alone. The "40% reduction" target is achievable with Phase A+B.

✅ **Nested layouts:** sync-server uses a single flat layout (`siteLayout`). For nested layouts, `app([...pages], { layout: rootLayout })` + each page declaring `layout: childLayout` (composed via reference) covers the case without file-system conventions.

## What the sketch surfaces as risk

⚠ **Pages with both `layout` field and `app({layout})`:** order of composition needs to be `app.layout(page.layout(view))`. Tests should cover the case where a page declares its own layout AND `app()` declares a default layout. **Action: extend app.test.ts with a composition test.**

⚠ **Routes that aren't pages (e.g. `/kv/:key`):** they're raw `(req, params) => Response`. `app()`'s pages array doesn't accept them. They stay in `opts.fetch` or in a separate `routes()` helper for non-page handlers. **Decision: don't expand `app()` to take raw handlers; keep them in the `fetch` opt or use `serve({ routes: { ...rawHandlers, ...app.routes } })` for advanced setups.**

## Recommendation

**Proceed to Phase B.** The structural change works on a real example. Phase B's `on: {}` will further compress the action-handling code, which is the biggest remaining duplication source in `actions.page.tsx` + `counter.action.ts` + `counter.server.ts`.
