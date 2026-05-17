# ADR 0009: Commonplace as flagship — what the demo proves

**Status:** accepted
**Date:** 2026-05-12
**Affects:** `examples/commonplace` (rebuilt in Round 6)

## Context

The platform has shipped six rounds of DX work and a real-app deferral has accumulated:
- Round 5's `app()`, `page(path, def)`, `routes(prefix)`, `on:`, `search:`, `onError`/`onNotFound`
- Round 4's `<ClientOnly>` / `<Deferred>` correctors
- Round 4's content-hashed bundle + dev error overlay + path-typed `<Link>`
- Round 3's auth-bleed-proof `cache(fn)` (sync-server only)
- Round 6's `virtualList` primitive
- Theme tokens with no-flash SSR
- Strict CSP + Permissions-Policy + auto-CSRF for actions

Most of these are visible in tests and ADRs but not in any one running app at once. Sync-server demonstrates the action() + security pipeline; sandbox demonstrates reactivity demos; commonplace was a single-route SPA that demonstrated the capability-swap pattern but didn't exercise the modern routing/layout/search/onNotFound surface.

The Round 6 plan transformed commonplace into the flagship: a real, browseable multi-route app that exercises every shipping Round 5/6 feature plus the original capability-swap demonstration.

## Decisions

### 1. Commonplace is the structural-wins demo

When a developer asks "is this real?", the answer is commonplace running. Not sync-server (which is an API demo), not sandbox (which is a primitive playground).

That means commonplace gets to use the latest Round-N features eagerly. The migration documented here is the first such pass.

### 2. Routing model: path-based, not hash-based

Round 6 commonplace switched from `hashRouter()` to `pathRouter()`. URLs are now `/`, `/notes/:id`, `/notes/:id/edit`, `/tags`, `/tags/:tag` — standard web URLs, shareable, browser-back-button friendly, bookmarkable.

**Implication for SSR:** each path needs a registered page on the server so a fresh `GET /notes/abc` doesn't return 404. The Round 5 `app([pages]).serve()` derives the routes table from the pages array; each page declares its `path` and the server registers it. The actual data (notes) is client-only, so the SSR'd HTML for any note URL is the same layout chrome + an empty `<ClientOnly>` placeholder; hydration mounts the real content.

**Rejected alternative:** keep hash routing. Hash routing avoids the SSR-needs-to-respond-to-every-path issue but produces ugly URLs (`/#/notes/abc`) and breaks server-side route matching for things like analytics + crawler indexing. Path routing is the standard. Round 5 made it cheap; commonplace now uses it.

### 3. Notes storage stays client-only

The notes data lives in the user's browser (`localStorage` / `IndexedDB` / `crossTab` broadcast / remote sync server via `?backend=server`). The server runtime doesn't install `NoteStoreCap`. SSR for any note-bearing page renders the layout chrome only; the actual content fills in post-hydrate via `<ClientOnly>`.

This is a deliberate design choice: commonplace is the "personal app" reference. The data lives where the user lives — their device. Sync-server demonstrates the server-data path; commonplace demonstrates client-data + capability-swap.

**Implication for the action() demo:** the `/notes/:id/edit` page uses `on: { save }` — but the handler is an *echo*. The action exists to demonstrate the security pipeline (auto-CSRF + same-origin + body-limit + proto-pollution); the client takes the action's return value and writes to local storage. A production app would persist server-side here; commonplace stays consistent with its "data lives client-side" stance.

### 4. Single isomorphic entry (Round 5 `app()`)

`examples/commonplace/src/app.tsx` replaces the previous `server.tsx` + `client.tsx` + `App.tsx` triangle. The file is bundled for both runtimes; a `typeof window === 'undefined'` branch dispatches to `.serve()` or `.boot()`. Client-only capability installs (`RouterCap`, `NoteStoreCap`) live in the browser branch only.

This collapses ~120 LOC of duplication (route table mirrored in server.tsx and client.tsx, mount setup in client.tsx, page declaration in page.tsx) into a single ~50-line entry.

### 5. `virtualList` for the notes list

The home page and tag page both render the notes list as a virtualized window. Each row is ~108px; the list scales to thousands of notes without UI lag. The first concrete consumer of Round 6's `virtualList` primitive, validating the "ship the insight, drop the React shape" doctrine (ADR 0008) on a real codebase.

### 6. ClientOnly for cap-dependent content

Each page that consumes `NoteStoreCap` wraps its content in `<ClientOnly>{() => ...}</ClientOnly>`. SSR renders the layout chrome + an empty `<span data-place-client-only>` placeholder; the client mounts the real content after hydration. No hydration mismatch; no SSR-time `Cap.use()` failures.

## What the demo proves, axis by axis

| Axis | Shown by | Round shipped |
|---|---|---|
| `app([pages]).serve() / .boot()` | `app.tsx` | 5 |
| `page(path, def)` co-location | Every `pages/*.page.tsx` | 5 |
| `search: shape()` URL-driven state | `pages/home.page.tsx` | 5 |
| `on: {}` co-located actions + auto-CSRF | `pages/note-edit.page.tsx` | 5 |
| `onNotFound` per-page 404 | `pages/note.page.tsx` | 5 |
| `notFound()` typed signal | `pages/note.page.tsx` | 5 |
| `<ClientOnly>` SSR/client gating | Every page | 4 |
| `<Link to>` typed client nav | Throughout | 4 |
| Theme tokens + cookie-driven theming | `theme.ts` + `rootLayout` | 3 |
| Layout composition (single root layout today; nested examples in ADR 0007) | `layouts/root.layout.tsx` | 5 |
| `virtualList` windowed render | `views/NotesListClient.tsx` | 6 |
| `keyed()` list reconciliation | `views/NotesListClient.tsx` | 2 |
| `wire()` two-way input binding | `views/NoteEditClient.tsx` | 2 |
| Capability-swap storage (memory / localStorage / crossTab / IndexedDB / server) | `store.ts` + `BackendSwitcher.tsx` | 1 |
| `state` + `derived` + `watch` reactivity | Throughout | 1 |
| Strict CSP by default | `serve({security: 'standard'})` | 3 |
| Content-hashed `/client.<sha>.js` in prod | Round 4's `Bun.build` integration | 4 |
| Dev error overlay with source-map frames | Dev mode | 4 |
| View Transitions for cross-page nav | `serve({viewTransitions: true})` | 4 |

## Sync-server complements commonplace

The two demos cover orthogonal surfaces:

| Surface | sync-server | commonplace |
|---|---|---|
| Action() security pipeline | ✅ four-layer demo with curl verification | ✅ on: action with auto-CSRF |
| Server data via DB | ✅ bun:sqlite | ❌ client-side storage |
| Capability-swap storage | ❌ | ✅ memory / localStorage / IndexedDB / crossTab / server |
| Multi-page routing | ✅ four routes | ✅ five routes |
| Streaming SSR + suspense | ✅ `/ssr/slow` | ❌ no slow data |
| Theming + theme toggle | ❌ | ✅ |
| Virtualized list | ❌ | ✅ |
| Sessions + signed cookies + CSRF tokens | ✅ | ❌ |
| Real-time WebSocket sync | ✅ optional `?backend=server` | ✅ optional `?backend=server` |

Together they cover every shipped feature. A future demo could combine them (commonplace consuming sync-server's data backend) but each works independently.

## What's deliberately NOT in the flagship

- **Real backend persistence by default.** The default backend is `crossTab` (localStorage + cross-tab broadcast). `?backend=server` swaps in the Bun sync server. Real apps deploying commonplace's shape would write their own `on: { save }` handler that persists to a DB. The flagship doesn't because the data lives client-side by design.
- **Auth.** No login flow. The commonplace book is single-user-per-browser. Adding auth would conflict with the "your device, your data" framing.
- **Real-time editing collaboration.** Demonstrated by sync-server; commonplace doesn't include it.
- **A full-text search index.** The `searchable()` from `@place/search` does substring search; FTS isn't needed for ~hundreds of notes. If a user hits the scale where it matters, plug in `@place/persistence`'s server adapter + a real FTS backend.

## Consequences

### Positive

- One running app demonstrates every structural win from Rounds 1–6.
- A real user can clone the repo, run `bun run commonplace`, and use the app: create notes, search, tag, navigate to detail, edit. The result is shareable URLs that work after a refresh.
- The transformation validates Round 5 + Round 6 on a non-trivial codebase. Round 5's `app()` factory + `on:` dict + `search:` + `onError`/`onNotFound` all see real usage. Round 6's `virtualList` runs in production-shaped code.

### Required follow-up

- **Browser-verify** is manual today. The dev-cycle benchmark from Round 4 could be re-purposed to exercise commonplace under bun --watch and measure end-to-end edit-to-render time.
- **Bundle size measurement** — the flagship is the natural place to track Lighthouse + bundle-size budgets. Future cut: ship a `docs/benchmarks/commonplace-bundle.md` with measured numbers.
- **A `<Link>` `PlaceRoutes` augmentation** would catch route typos at compile time. Commonplace doesn't augment today (`<a href>` works for static paths; we use `<Link>` only); future cut.

## Migration metric

| Metric | Before Round 6 | After Round 6 |
|---|---|---|
| Files | 10 (App.tsx + page.tsx + server.tsx + client.tsx + store.ts + theme.ts + 4 components) | 13 (1 entry + 1 layout + 5 pages + 3 views + store.ts + theme.ts + 3 components) |
| Routes (server-side) | 1 (`/`) | 5 (`/`, `/notes/:id`, `/notes/:id/edit`, `/tags`, `/tags/:tag`) |
| Routes (client-side) | hash-based via App.tsx logic | path-based via `app([pages])` + `pathRouter()` |
| Entry files | 2 (server.tsx + client.tsx) | 1 (app.tsx) |
| Path duplications | each route in App.tsx routing + URL string literals | 1 per page (the `page('/path', ...)` first arg) |
| Hydration mismatches | possible (client-only `<App />` mount with no SSR'd structure to adopt) | impossible (every page has a corresponding server-render path) |
| Virtualized list | no | yes (Round 6) |
| 404 handling | manual via App.tsx route-not-found check | per-page `onNotFound` + `notFound()` signal |
| Search-param parsing | manual via `urlState()` | typed via `search: shape()` |

The LOC increased slightly (added explicit pages + ClientOnly wrappers) but the conceptual surface shrunk: every concern has one named place. The path is co-located. The actions are co-located. The 404 is co-located.

## How to extend

If a future feature wants to be in the flagship:

1. Pick a page or layout to be its host. New surfaces (e.g. a real-time-collaboration banner) typically slot into the root layout; new flows (e.g. "share this note via short URL") slot into a new page.
2. Use the latest framework features eagerly. If a feature was shipped in a Round but isn't visible in commonplace, that's an oversight; add it.
3. Update this ADR's "axis by axis" table.
4. Browser-verify before merging.
