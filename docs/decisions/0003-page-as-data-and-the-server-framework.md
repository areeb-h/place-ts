# ADR 0003: Page-as-data and the server framework inside the component system

**Status:** accepted
**Date:** 2026-05-04
**Affects:** component system (v0.3+), platform charter, examples

## Context

The original [system map](../platform/00-system-map.md) called the platform "client-first" and explicitly listed "server framework" under *what's deliberately not on the map*. That stance held through v0.2 (render layer only).

Three things forced a re-evaluation:

1. The sync-server demo needed SSR to demonstrate the persistence + reactivity story end-to-end (commonplace book and similar local-first apps still want a `view-source` to show useful HTML for share-links and indexers).
2. Direct user direction: *"can this whole thing be server-first like Next SSR but better and more secure with the least to no attack surface?"*
3. The render layer's `View` type already had a free `toHtml()` extension point — every built-in factory could implement it with no new mental model. SSR was a small additive cut, not a separate runtime.

Once the SSR layer landed (`renderToString`, `renderToStream`, `hydrate`, `handler`, `serverRouter`, `htmlShell`), the natural follow-up question was: how do users assemble a server? The hand-wired pattern was painfully verbose — Bun.build for the client bundle, manual `/client.js` route, manual handler+htmlShell+serverRouter wiring per page, hand-extracted SSR data via `querySelector` hacks. ~80 lines of glue per page. So the question became: what's the right declarative API for a page, and what owns serving it?

This ADR records the answer.

## Failure modes to avoid

The catalog was assembled from observing Next, Nuxt, Remix/RR7, SvelteKit, Astro, SolidStart, TanStack Start. Every item below is a misfeature one or more frameworks ship and we will not.

1. **File-system routing.** Move a file → broken URL. Requires conventions like `(authenticated)/admin/page.tsx` route groups and magic filename suffixes (`page.tsx`, `+page.svelte`, `index.ts`-as-route, `loading.tsx`, `error.tsx`).
2. **Multiple magic exports per page file.** Next has `metadata` + `generateMetadata` + `default`; Remix has `loader` + `action` + `meta` + `default`; SvelteKit splits into `+page.svelte` + `+page.server.ts` + `+page.ts` + `+layout.*`. Reading a page requires reading several files and knowing which exports the framework consumes.
3. **`'use client'` / `'use server'` magic markers.** RSC's compile-time string scan that decides where code runs. Easy to violate accidentally; lint rules required to enforce hygiene; the boundary is invisible at runtime.
4. **`.server.ts` / `.client.ts` filename suffixes.** Remix's pattern. Same problem as `'use client'` but via filename; the bundler treats two files differently based on naming convention.
5. **Hydration data scattered across magic globals.** `__NEXT_DATA__`, `self.__next_f.push([...])`, `window.__remixContext`, per-route async chunks. Devtools can't easily inspect what shipped from the server.
6. **Built-in caches that span auth contexts.** Next's `fetch` auto-cache and `unstable_cache` famously cause auth-context bleed when the cache key forgets to include the auth token. Multiple high-profile incidents.
7. **Default config requires `'unsafe-inline'`.** Next ships RSC payloads inline; the default CSP cannot be strict. Tailwind's inline styles compound this in many setups.
8. **Codegen step for typed routes.** `react-router typegen`, `next-typed-routes`, `@tanstack/router` codegen. Stale `.d.ts` artifacts; another step in the toolchain.
9. **Server-rendering as a separate component runtime.** RSC's two render modes interleaved. Implementation is two parallel systems; mental model is "is this code RSC or client?"

## Decision

**The component system grows a server framework as a structural extension, not a peer system.** Three new exports, all in `@place/component`:

- `page({ url, load, view, meta, styles, headers })` — declarative page object both server and client import.
- `serve({ port, routes, clientEntry?, tailwind?, security?, fetch?, websocket?, static?, notFound?, headers? })` — Bun.serve wrapper that bundles the client entry once at startup, dispatches Pages and raw `(req, params) => Response` handlers in the same routes map.
- `boot({ '/path': page })` — client entry. Matches `location.pathname`, derives URL props the same way the server did, reads load data from a single inspectable `<script>` tag, hydrates against `document.body`.

Five architectural commitments, each rejecting one or more failure modes above:

### 1. Routes are values, not files

`routes: { '/': home, '/admin': withAuth(admin) }` is a JavaScript object. There is no file-system routing, no magic filename. Refactors are pure JavaScript; you grep for the page name. Higher-order pages are function calls (`withAuth(admin)`), not folder conventions.

Rejects (1). The map carries route → handler/page bindings explicitly.

### 2. One Page object, both sides

A `page()` literal contains everything both server and client need: `url(url, params)` runs on both sides (pure derivation from URL); `load(ctx)` runs server-only; `view(props)` is the JSX both render; `meta` is typed metadata that may be a function of merged props for dynamic titles; `styles` is the per-page stylesheet sources.

Rejects (2). One file, one object, top-to-bottom readable.

### 3. Server-only adornments are structural, not magical

The shared page module (`home.page.tsx`) is pure: `{ url, load, view, meta }`. Server-only enhancements (Tailwind compilation, response headers, custom CSP) live in `server.ts` and are spread onto the page when registering it with `serve()`:

```ts
serve({
  routes: { '/': { ...home, styles: tw, headers: csp } }
})
```

The bundler sees no Tailwind import in the client path because the shared file has no Tailwind import. There is no `'use client'` marker, no `.server.ts` filename, no compile-time string scan.

Rejects (3) and (4). The server/client split is *physical*: server code lives in files only the server runs.

### 4. Hydration data is one inspectable script tag

`load()`'s result is JSON-serialized into `<script type="application/json" id="__place_load__">{ ... }</script>` in the SSR'd HTML. `boot()` reads it back via `document.getElementById('__place_load__').textContent`, parses, merges with URL props, hydrates.

Rejects (5). One tag, one parse, JSON the user can read in devtools.

### 5. Strict security is a one-liner; Tailwind is auto-integrated

`serve({ security: 'strict' })` applies a vetted baseline: CSP locked to `'self'`, HSTS, Referrer-Policy, X-Content-Type-Options, X-Frame-Options, COOP/COEP/CORP. `serve({ tailwind: true })` lazy-imports the Tailwind helper, compiles CSS once at startup, and **automatically computes the SHA-256 of the inlined CSS and adds it to CSP `style-src`** so strict CSP keeps working without `'unsafe-inline'`.

Rejects (6) — there is no built-in cache to leak across auth contexts. Rejects (7) — the default does not require `'unsafe-inline'`.

### 6. Generics flow natively, no codegen

`page<UrlProps, LoadData>()` infers `UrlProps` from `url`'s return type and `LoadData` from `load`'s; `view`'s `props` parameter is `UrlProps & LoadData` automatically. No file watcher, no codegen, no stale `.d.ts` artifacts.

Rejects (8).

### 7. One render mode, one runtime

There is no separate server-component runtime. The same `View` knows how to render itself to a string (`view.toHtml?()` on every built-in factory) and to mount/hydrate against the DOM. Server emits HTML; client adopts it. No interleaving, no two-modes mental model.

Rejects (9).

## Where this lives

The server framework lives **inside `@place/component`**, not as a separate `@place/server` package. Reasons:

- It uses the same `View` type, the same JSX runtime, the same reactivity primitives. Splitting into a separate package would either pull `@place/component` as a dep (just moves the import surface) or duplicate the SSR machinery (worse).
- Tailwind integration via `serve({ tailwind })` is a **lazy** import (`await import('./tailwind.ts')` inside `serve()`), and `Bun.build` for the client entry is given `external: ['@tailwindcss/node', '@tailwindcss/oxide', 'tailwindcss', 'lightningcss']` so server-only deps don't end up in the browser bundle.
- The component system charter ([systems/component/docs/00-charter.md](../../systems/component/docs/00-charter.md)) now explicitly lists the SSR layer as in-scope.

The platform charter's "client-first" stance is preserved in spirit: SSR is the page-load entry, but persistence + reactivity own everything after first paint. Local-first remains the default.

## Consequences

**Easier:**
- A standard SSR page goes from ~80 lines of glue per page to a 50-line shared `*.page.tsx` plus a one-line route registration.
- No file-system convention to learn. New users can read a routes map and know what URLs the app responds to.
- Strict CSP works with Tailwind out of the box. No security-vs-DX tradeoff.
- AI co-authoring is more reliable: one declarative `page({})` object is easier for an LLM to construct correctly than knowing which of N magic exports each framework expects.

**Harder:**
- Server-only adornments require an explicit physical split — the `home.page.tsx` is shared; the server.ts spreads styles + headers onto it when registering. New users have to learn this once. (We considered making the bundler ignore server-only imports in shared files via heuristics; rejected as too magical.)
- No file-system routing means more keystrokes per route. The tradeoff is freedom to refactor and the absence of magic.
- Per-request capability scopes are a known gap (the `@place/capability` stack is module-global). Documented in `handler()`'s doc comment with a safe pattern (derive from `req`, pass via props). Fix is `AsyncLocalStorage`-backed scopes; tracked for v0.4.

**Watch for:**
- If a page needs *streaming* `load()` (yield UI before all data is ready), we'll need per-element streaming + `resource()`-style suspense. The string emitter is the foundation; the per-element flush is deferred.
- If we add SSG/ISR, it should be a separate function (`buildStatic(routes)`), not a `revalidate: 60` field on `page()`. The single-mode commitment is load-bearing.
- If users start hitting the file-split awkwardness frequently (shared `home.page.tsx` + server-only spread in `server.ts`), revisit. Possible alternative: a `pageServer()` helper that takes a base page and returns an augmented one — same physical split, slightly less typing.

## Verification

- 232 component tests including 148 SSR-layer tests across 14 new test files (render-to-string, handler, render-to-stream, hydrate, ssr-edge-cases, server-router, static, page, serve, security, tailwind, meta, plus expansions to existing files).
- The sync-server demo refactored end-to-end. `client.tsx` collapsed to 15 lines. The SSR section of `server.tsx` collapsed from ~60 lines to 3.
- Browser-verified: dynamic title via `meta(props)`, OG/Twitter/theme-color tags rendered correctly, Tailwind CSS computed and applied (`bg-white` → `rgb(255, 255, 255)`; `text-neutral-900` → `oklch(0.205 0 0)`), hydration intact (counter clicks update count post-SSR), CSP `style-src` includes the auto-injected SHA-256 hash, `data-h` markers stripped post-hydration.

## Notes

- This ADR does NOT commit to publishing the page-as-data pattern outside the component system. Other systems (data, persistence, etc.) keep their own primitives.
- Future ADR may revisit the "server framework lives inside component" packaging if a workload demands a standalone `@place/server` package. The current packaging keeps the import surface flat (`import { page, serve, boot } from '@place/component'`) which is the user-facing win.
