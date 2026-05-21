# 00 — Component System Charter

**Status:** v0.1-stable shipping (post-Tier 13). Public surface
under the stability covenant; Tier 12-13 additions tagged
`@provisional` (theme, viewport, discoverPages, Copy, etc.).

## What this system owns

The component system is the **render layer** plus the **SSR/hydration
layer** plus a small set of **server primitives** plus the **app-level
DX layer** (theme, viewport, discoverPages, dev supervisor, copy
runtime). All ship as one cohesive API because they share a single
rendering primitive (`View`), a single mental model (component =
function from props to View, run once at mount), and one barrel
import (`@place-ts/component`).

### Render layer

- The component model: components are functions returning a `View`. Run once at mount; reactivity flows through bindings, not re-renders.
- Render lifecycle: `mount` returns a disposer. `onCleanup` registers cleanup tied to the enclosing mount. No `useEffect` analogue — derivations run as needed via the reactivity graph.
- Reactive bindings: `string|number|boolean` set once; `() => T` becomes a tracked watch; `onX` is an event listener. Children follow the same rule.
- List reconciliation: `keyed(items, key, render)` preserves per-item state across reorders.
- Composition: `Fragment`, `component()` HOC, `errorBoundary({ fallback, children })`.
- Capability bridge: `withCapability` / `withCapabilities` install impls for the wrapped subtree's lifetime so deferred component bodies see them.
- Form/input ergonomics: `wire(state)` two-way binding (polymorphic on the state's value type), `cls()`, `onKey()`, `globalKey()`, `urlState()`.

### SSR / hydration layer

- `View.toHtml?()` — every built-in factory implements it. Server-side `renderToString(view)` runs in pure Bun (no DOM polyfill required); falls back to happy-dom mount for custom Views without a string emitter.
- Hydration markers: each element emits `data-h="<seq>"` at SSR. Client `hydrate(view, root)` walks the View tree alongside the existing DOM, attaches event listeners and reactive watches without recreating elements, then strips the markers.
- Streaming: `renderToStream(view)` returns a `ReadableStream<Uint8Array>`. V0 emits one chunk; per-element streaming and `resource()` suspension are deferred.
- `<Static>` opts subtrees out of hydration recursion (Astro's "islands of interactivity" inverted: default-hydrate, mark-static).

### Server primitives

- `page({ url, load, view, meta, styles, headers, on, layout })` — declarative page object both server and client import. Single source of truth for URL → props derivation, server-only data loading, view, document metadata, stylesheets, and `on:`-actions. Path is a string literal whose `ParamsOf<P>` type flows into `view`/`load`/`meta`. **String meta** + **titleTemplate** + **h1 auto-title** ergonomics per ADR 0031.
- `layout({ load, view, meta, styles })` — composable layouts with **`titleTemplate: '%s · my site'`** that wraps page titles.
- `app({ pages, layout, theme, styles, router, islandsDir, security, viewTransitions, caps })` — the isomorphic entry. `.run()` dispatches to `.serve()` on server / `.boot()` on client. Defaults: `security: 'standard'`, `viewTransitions: false`. **Accepts `styles: string | readonly string[]`** (ADR 0039).
- `serve({ port, routes, clientEntry?, tailwind?, security?, fetch?, websocket?, static?, notFound? })` — Bun.serve wrapper. Bundles client entry, dispatches via routes table.
- `boot({ '/path': page })` — client entry. Matches `location.pathname`, derives URL props, reads load data from SSR'd `<script>` tag, hydrates the document.
- `renderPage`, `renderToString`, `renderToStream`, `renderToHtml` — render entry points. `renderToHtml` is the unit-testing helper; `renderToStream` powers `streaming: true` pages.
- `discoverPages(dir)` — async helper that walks a directory and imports every `*.page.tsx` plus subdir `index.{ts,tsx}` (ADR 0039). Route paths still live on the page values; file location is irrelevant to routing.
- Typed `meta` config — accepts a string ('My Page'), object, or function-of-props; auto-promotes the first `<h1>` when omitted (ADR 0031).
- Typed `security` config with `'strict' | 'standard' | 'none'` presets covering CSP (per-response nonce + auto-style-hash injection per ADR 0014/0025), HSTS, Referrer-Policy, X-Content-Type-Options, X-Frame-Options, COOP/COEP/CORP, Permissions-Policy.
- First-class Tailwind v4 via `serve({ tailwind: true })` — auto-compile, auto-inject, auto-hash CSP `style-src` so strict CSP works without `'unsafe-inline'`.
- **Per-route bundle splitting** (ADR 0018) — each route's client JS lives at `/client/<route-hash>.js`; framework + layout amortize into a shared chunk.
- **Islands** (ADR 0019/0023) — `island(srcUrl, fn)` factory with `client="load|idle|visible|interaction"` strategy; default + only hydration model. `islandsDir` auto-discovers islands; SRI on every bundle (ADR 0025).
- **Dev supervisor** (ADR 0032) — `bun src/app.ts` auto-spawns a subprocess supervisor; framework owns the file watcher; HMR via WebSocket reconnect.
- **`@place-ts/component`-level runtimes** (all emitted by `renderPage` with the per-request CSP nonce): `placeHmr`, `placeSpaNav`, `placeTabs`, `placeDeferredIslands`, `placeViewport`, `placeCopyRuntime`, `placeEarly`.

### App-level DX layer (Tier 12-13 additions, mostly `@provisional`)

- **`theme()` helper** (ADR 0038) — canonical theme entry. Bare color keys, auto-derived sibling tokens via `color-mix()`. `themeTokens()` remains the low-level primitive.
- **Typography in `themeTokens()`** (ADR 0035) — `typography: { scale, family, weights, leading, tracking, roles }` emits `--font-*` tokens + `.text-{role}` utility classes.
- **`viewport` reactivity primitive** (ADR 0034) — `viewport.width()`, `.height()`, `.breakpoint()`, `.prefersReducedMotion()`, `.prefersDark()`, `.matches(query)` — all `Derived<T>`; one inline runtime emitted per page; SSR mobile-first defaults.
- **`<Tabs>` + `<Tab>` + `cookieState`** — typed tabs with per-group cookie-backed active state, SSR-correct.
- **`<Show>`, `<Activity>`, `<Suspense>`, `Static`, `<Form>`, `<Link>`** — control-flow + form + nav primitives.
- **`renderToHtml(page, opts)`** — test helper, equivalent to `await renderPage(p, new Request(url)).text()` with sane defaults.

## What this system does not own

- Reactivity primitives (`@place-ts/reactivity`).
- Data fetching or compile-time dependency declarations (`@place-ts/data`).
- URL ↔ state mapping or typed routes (`@place-ts/routing`). The `page()` model uses URL as a value but does not own the route DSL.
- Storage adapters (`@place-ts/persistence`).
- General-purpose styling or UI components. We provide the `styles` plumbing and a Tailwind helper; we do not own a component library.

## Depends on

- `@place-ts/reactivity` — primitives, scope, graph
- `@place-ts/capability` — for `withCapability` and the error-boundary cap
- `@place-ts/routing` — `page()` re-uses the `route()` matcher to compile URL patterns
- `@place-ts/security` — only the demo uses it (cookies/CSRF/sessions); the component system itself does not depend on it

Optional peer deps (only loaded if used):
- `@tailwindcss/node` + `@tailwindcss/oxide` + `tailwindcss` — for the Tailwind helper

## Architectural commitments

These are non-negotiable for this system. Anything that conflicts is rejected before being built.

1. **Routes are values, not files.** No file-system routing, no filename conventions (`page.tsx`, `+page.svelte`, `index.ts`-as-route, `.server.ts` suffix, etc.). Pages are JavaScript objects in a `routes` map.
2. **One Page object, both sides.** Server and client import the same `page()` literal. URL → props derivation runs on both sides, so both arrive at the same value.
3. **Server-only code is structural.** No `'use client'` / `'use server'` string-directive markers. Server adornments (Tailwind compile, headers) live in server.ts code that the client bundle never reaches. (Magic via typed JSX is allowed and explicitly preferred — see typed islands in ADR 0019, and the platform-charter "magic with clarity" non-negotiable.)
4. **Hydration data is one inspectable script tag.** `<script type="application/json" id="__place_load__">` — open devtools, see exactly what shipped.
5. **Security is opt-in but trivial.** `security: 'strict'` is one line. The Tailwind hash is auto-merged into CSP so strict CSP stays strict even with inlined styles.
6. **Page-level `revalidate`** (ISR) **lives at the framework boundary, not inside components.** Pages opt in via `revalidate: 60` or `{ ttl, tags }`. Cached responses are per-`(path, search)` keys; apps that need auth-context-aware cache scope it themselves at a different layer. The framework's *internal* `CacheStore` is the implementation; it's not the component-system's mental model — pages just declare TTL and tag membership. (The earlier "no built-in caches" charter clause overstated the case; the practical version is "no cache magic in components — only declarative TTL at the page boundary.")
7. **Codegen is allowed only when it doesn't hide intent** (per ADR 0026 "magic with clarity"). The islands bundler writes `.place/island-entries/_auto-init.ts` as part of the build; the file is inspectable and lives in a predictable location. Generics flow through `page<U, L>()` via TS inference, not codegen. No `.d.ts` regeneration cycle, no stale-generated-file class of bug.

See [docs/01-rendering-anti-patterns.md](01-rendering-anti-patterns.md) for the failure-mode catalog these commitments answer to, and [docs/02-design.md](02-design.md) for the direction and open questions.

## Conventions for view authors

### Named-binding state (`view()` body)

When declaring reactive state inside a `view()` body (Tier 9 primitive; Tier 8's `island()` is its equivalent today), prefer a named binding:

```tsx
view(import.meta.url, () => {
  const count = state(0)         // named — survives HMR swap, classifies cleanly
  return <button onClick={() => count.set(count() + 1)}>{count}</button>
})
```

Anonymous in-body state inside loops/conditionals is a build warning (ADR 0028 §"State preservation"). The binding name is the stable identity HMR uses to preserve the cell across a hot swap; without it, every body edit re-creates the cell and loses live state. The same name is what the view classifier (ADR 0030 / T8-D) uses to attribute promotion reasons in the build report (`Counter → thaw — state-only — \`count\` (3 refs)`).

The classifier itself is documented in `systems/component/src/build/view-classifier.ts` — Tier 8 ships a name-match prototype with explicit limits (cap-method reads + aliased imports missed); Tier 9 promotes the type-based variant per ADR 0030.

## Phase

- v0.2: render layer (mount, el, component, Fragment, keyed, errorBoundary, wire, urlState, etc.). Shipped.
- v0.3: SSR + hydration + server primitives (page, serve, boot, renderPage, renderToString, renderToStream, hydrate, Static, meta, styles, security, tailwind). **Shipping now.**
- v0.4 candidates: per-element streaming + `resource()` suspension; AsyncLocalStorage capability scopes; HMR-aware component identity.
- **Tier 8 (foundation)** — effect-typed primitives + view classifier prototype + unified `data-view-*` wire (ADR 0030). Shipping now. Non-breaking type extension; classifier is report-only.
- **Tier 9 (`view()` + thaw L1)** — promote the classifier; ship `view()` as the public primitive; L1 thaw runtime.
- **Tier 10 (streaming)** — Channel B + request-coalescing per ADR 0029.
- **Tier 11 (HMR)** — typed-island-boundary swap per ADR 0028.
