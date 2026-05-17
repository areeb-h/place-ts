---
description: Living roadmap. What's shipped, what's in flight, what's queued, what's horizon, what we deliberately don't do. Updated each session as work lands.
---

# Roadmap

The living plan for `place`. Each section: what we're committing to, why, and how we'll know it's done.

> **Last touched:** 2026-05-14 (Tier 3 — motion + design library shipped. `@place/reactivity/motion` adds spring/tween/sequence/curve as derived state over time ([ADR 0015](decisions/0015-motion-as-reactivity-submodule.md)). `@place/design` is the first curated package built on the platform, ships nine primitives — Button, Field/Input/Textarea, Dialog, Toast, Tooltip, Menu, Avatar, Badge, Card — every one native-first ([ADR 0016](decisions/0016-design-library-as-package.md)). Canvas design locked in but deferred until the reactive-graph devtool trigger fires ([ADR 0017](decisions/0017-canvas-deferred-pending-devtool.md)). Docs site migrated to `@place/design` as the first real consumer.)
> **In flight:** Tier 1-A Cut 3 (`element/factory.ts` + `element/ssr.ts` extraction from component/src/index.ts) + `.read()`/`.write()` → callable-form codemod for framework internals (~20 sites)
> **Test totals:** 1078 passing + 14 skipped under vitest = 1092 total across 67 files

---

## Where we are

### Versioning

| Version | What it means | Status |
|---|---|---|
| **v0.1** | Reactivity + build foundation | shipped |
| **v0.2** | Render layer (component system, JSX, keyed lists, error boundaries, DX helpers) | shipped |
| **v0.3** | SSR + hydration + server primitives (page/serve/boot, meta, styles, security, Tailwind) | shipped |
| **v0.4** | **Production-grade SSR primitives — shipped** | **shipped** |
| **v0.5** | Tier-3 deployment + observability (concrete adapters, image opt, font helper) | shipped |
| **v0.6+** | Big-bet items (resumability, full SSG/build-time route discovery) | horizon |
| **v1.0** | API stability commitment, ecosystem entry, production case studies | distant |

### What's currently true

- 1078 passing + 14 skipped under vitest (= 1092 total) across 67 files
- Lint clean (Biome), typecheck clean across all 14 tsconfig projects (added `systems/design` in Tier 3)
- All three example apps browser-verified end-to-end on the framework's own pipeline (sync-server, commonplace, sandbox — all on `serve()` + auto-Tailwind + `security: 'standard'`; no Vite anywhere)
- Four ADRs written ([0001](decisions/0001-stack-bun-typescript.md), [0002](decisions/0002-jsx-shape-via-ts-automatic-runtime.md), [0003](decisions/0003-page-as-data-and-the-server-framework.md), [0004](decisions/0004-theming-and-page-decoration.md))
- Documented anti-pattern catalog ([07-prior-art-failures.md](platform/07-prior-art-failures.md))
- Phase 4 (v0.4) shipped 8 cuts × ~1230 LOC + ~85 tests; closes 5 of 8 honest gaps vs Next/SvelteKit/SolidStart per the comparison
- Phase 5 (v0.5) shipped 4 cuts: Node adapter, font helpers, buildStatic SSG, chunked stream flush
- Post-v0.5 polish round 1: DX helpers (`Img`, `Suspense`, `css\`...\`` template, `shape()`, `renderToHtml`, `htmlClass`/`bodyClass` on PageMeta), full theming system (`themeTokens()`, cookie-based persistence, `serve({ theme })` auto-injection, `RenderPageOptions.htmlClassPrefix`), dev cache headers (`Cache-Control: no-store` for client.js + tw.css when `NODE_ENV !== 'production'`), Tailwind moved to peerDependencies, `tailwind.content` auto-derives from clientEntry, `theme: tokens` shorthand auto-fills `tailwind.base`
- Post-v0.5 polish round 2 (2026-05-06): `cache(fn, opts)` higher-order memoization (closes Cache Components gap, with tag-based invalidation that integrates with `revalidate.tag()`); pretty `serve()` startup banner with route table + bundle/Tailwind timings; per-request log lines with status + ms; `serve({ log })` opt-out flag; `<Link>` typed helper with prefetch + active-state; HEAD requests fall through to GET handlers; dev error overlay with stack frames when render throws
- Post-v0.5 polish round 3 (2026-05-05): `layout()` primitive (composable nested layouts, meta merging, `serve({ layout })` + `boot({ layout })` for shared chrome — closes 7.6); sync-server demo expanded to a four-route reference for action() + security (landing, SSR demo, streaming demo, `/actions/demo`); auto-CSRF (load() returning a `csrf` field auto-injects `<meta name="csrf-token">` which `action.call()` and `<Form>` auto-read — zero developer wiring); shape() auto-coerces FormData strings to declared `number`/`boolean` fields; tightened `security: 'standard'` preset (Permissions-Policy denies camera/mic/geo/USB/etc. by default; COOP same-origin) and `'strict'` (adds COEP require-corp); body-size limit + prototype-pollution guard built into `action()`; same-origin enforcement default-on for state-changing actions
- Post-v0.5 polish round 4 (2026-05-05 → 2026-05-08): DX push (8 cuts across 2 sessions). Source maps in dev (Bun.build `sourcemap: 'inline'`); source-map-aware error overlay frames with V8/Firefox parser + user/framework classification + vscode:// editor links; content-hashed `/client.<sha8>.js` in prod with `Cache-Control: immutable` + 308 fallback; auth-bleed-proof `cache(fn)` via `runWithCapabilityScopeSync` — per-request caps structurally isolated (closes [Next #86538](https://github.com/vercel/next.js/discussions/86538) class of footgun, see [ADR 0005](decisions/0005-cache-no-per-request-state.md)); path-typed `<Link to>` via `PlaceRoutes` module-augmentation interface; dev-mode hydration auditor (attribute-level diff + extension classifier); `<ClientOnly>` + `<Deferred>` corrector primitives; dev-cycle benchmark scaffold; [stability covenant](stability-covenant.md). View Transitions opt-in (closes 7.9, see [ADR 0006](decisions/0006-view-transitions.md)). `ImageBackend` interface + `contentHashedOptimizer` adapter (sharp impl deferred). [`@place/create-app` scaffolder](../tools/create-app/) at `tools/create-app/`. [Production-readiness doc](production-readiness.md)
- Post-v0.5 polish round 5 (2026-05-11 → 2026-05-12) — "the smaller app" arc: `page(path, def)` co-located path declaration; `app([pages]).serve()/.boot()` factory that derives the routes table from page declarations; `routes(prefix, pages)` for grouping; co-located `on: { name: handler }` dict per page with auto-CSRF + auto-typed callers; `search: shape({...})` URL-driven page state with FormData coercion; per-page `onError` / `onNotFound` view handlers; `notFound()` typed signal — see [ADR 0007](decisions/0007-smaller-app-arc.md). Collapses ~120 LOC of route/entry duplication into a single isomorphic `app.tsx` per app.
- Post-v0.5 polish round 6 (2026-05-12) — `virtualList()` primitive (windowed render with reactive `count`, `estimateSize`, `overscan`, dynamic `measureElement`, `scrollToIndex` with `start|center|end|auto` alignment, horizontal mode, ResizeObserver-driven viewport, SSR-safe `initialViewport`); the "ship the insight, drop the React baggage" doctrine ([ADR 0008](decisions/0008-port-the-insight-not-the-shape.md)) pre-records what to keep + what to drop for future ports (Dialog, Table, Form, R3F-inspired three wrapper). Commonplace rebuilt as the flagship demo ([ADR 0009](decisions/0009-commonplace-flagship.md)): path-based multi-route (`/`, `/notes/:id`, `/notes/:id/edit`, `/tags`, `/tags/:tag`), single isomorphic `app.tsx` entry, root layout + per-page composition, virtualized notes list, co-located `on: { save }` action with auto-CSRF, per-page `onNotFound`, `search: shape()` URL state, `<ClientOnly>`-gated client-data caps. 17 new `virtualList` tests; commonplace runs every shipping Round 1–6 feature in one browseable app.
- Tier 3 (2026-05-13 → 2026-05-14) — motion + design library + canvas charter. **Motion** lives at `@place/reactivity/motion` because motion IS interpolated derived state over time — same primitive everything else reactive composes from. Surface: `animate(target, opts)` (spring-driven), `tween(target, opts)` (duration + easing), `sequence(keyframes)` (keyframe interpolation over time), `curve(source, fn)` (signal-to-signal). 5 named spring presets (`gentle | wobbly | stiff | molasses | snap`); SSR resolves animations to rest immediately. No `<motion.div>` factory — read animated signals via the same `() => value` reactive-prop contract every other place reads signals from. ADR [0015](decisions/0015-motion-as-reactivity-submodule.md) documents the failure modes we deliberately avoid (Framer's 34KB floor, React-only, layoutId measure-every-render; GSAP's Webflow license; Motion One's two-runtime split). 24 new tests. **Design library** `@place/design` (`systems/design/`) ships as a curated package, NOT a 10th system — built on the component system's `recipe()` + `themeTokens()` + Tailwind v4 base. Native-first composition is a charter principle: Dialog uses `<dialog>` + `showModal()` + `:modal` pseudo-class + `inert` for focus trap; Tooltip/Menu/Toast sit in `popover="manual"`/`"auto"` top layer (Universal browser support since mid-2024) — no z-index hell, no portal; Field forms use `:user-invalid`/`:user-valid` (validates only after user interaction); Dialog enter/exit transitions use `@starting-style` + `transition-behavior: allow-discrete`. ADR [0016](decisions/0016-design-library-as-package.md) documents the failure modes deliberately avoided (shadcn copy-paste, Radix `asChild`, Mantine v7's Emotion rip-out, `tailwind-merge` 15KB runtime, Style Dictionary codegen, arbitrary Tailwind value escape hatches inside library components). Nine primitives shipped + 75 tests. **Canvas** ([ADR 0017](decisions/0017-canvas-deferred-pending-devtool.md)) — charter written, deferred until the reactive-graph devtool trigger fires. Design: reactive scene graph (`<Canvas><Rect x={state(...)} /></Canvas>`), SVG SSR fallback (real first paint), CPU 2D context on hydrate, WebGL promote at complexity threshold. **Docs site** migrated as the first real `@place/design` consumer: `featureCard` recipe → `<Card intent="flat" interactive>`, `pill` recipe → `<Badge intent="accent">`. Tier 1-A Cuts 1–2 + ADR catch-up (0010–0014) had previously closed; this round adds 0015–0017.

---

## Phase 4 — production-grade SSR & server primitives

The current arc. Closes 5 of 8 honest gaps identified in the framework comparison; 1 reframed; 2 deferred to v0.5. After Phase 4 ships, the SSR story is materially better than Next/SvelteKit/SolidStart on the axes that matter.

### 4.1 — Per-request capability scopes (ALS) ✓ shipped

**What:** `runWithCapabilityScope(fn)` wraps each request boundary; AsyncLocalStorage isolates cap stacks per request; module-level installs remain visible as a baseline; disposers are token-keyed and search both the closure stack and the visible ALS stack.

**Files:** [systems/capability/src/index.ts](../systems/capability/src/index.ts), wired into [systems/component/src/index.ts](../systems/component/src/index.ts) `serve()`'s `fetch` handler.

**Tests:** 10 new (concurrent-isolation, baseline-snapshot, scope-shadowing, async returns, disposer-after-unwind).

**Why this came first:** every other phase (ISR, server actions, streaming) needs request-scoped state. Without ALS, those would either bleed across requests (security gap) or have to plumb context manually through every layer.

### 4.2 — `CacheStore` + `memoryStore` ✓ shipped

**What:** Typed `CacheStore` interface (`get`/`set`/`delete` by keys or tags), in-process `memoryStore()` default. Foundation for ISR and the image optimizer.

**Files:** [systems/component/src/cache.ts](../systems/component/src/cache.ts) (new, ~80 LOC).

**Tests:** 10 new (round-trip, overwrite, key/tag deletion, mixed filters, Uint8Array bodies).

**Why we ship our own:** Next's `unstable_cache` is global+untyped, has caused real auth-context-bleed incidents. SvelteKit/Astro punt to Vercel's Build Output API for ISR storage — only works on Vercel. Ours runs anywhere Bun runs, with a pluggable interface for `@place/persistence`-backed stores later.

### 4.3 — ISR (lazy stale-while-revalidate) ✓ shipped

**What:** `page({ revalidate: 60 | { ttl, tags } })` field. `serve({ cache })` registers the store. Lazy SWR: cache hit → serve fresh if age < ttl; stale → serve cached AND kick off background revalidation; miss → render synchronously, store, serve. Inflight-dedupe via `Map<key, Promise>` so concurrent waiters share one render. Exported `revalidate(path)` and `revalidate.tag(name)` for invalidation triggers.

**Files:** [systems/component/src/index.ts](../systems/component/src/index.ts) `serve()` dispatch + new exports.

**Tests:** 6 new (revalidate registry, tag/key invalidation, TTL math, inflight coalescing).

**Why no eager timers:** scaling past one Bun replica with eager `setInterval` revalidation needs leader election. Lazy SWR ties revalidation to incoming requests; coordination is implicit in routing. Better than Next because no Vercel-specific magic; matches Vercel's behavior with no platform lock-in.

### 4.4 — `action()` typed RPC ✓ shipped

**What:** `action({ path, input, fn }) → { handler, call, path }`. Schema-agnostic (`(raw) => T`); server-side `fn` runs validated input; client-side `call(input)` is type-inferred end-to-end with structured `ActionError` on non-2xx. Spreads into routes via `serve({ routes: { ...like.handler, '/': home } })`.

**Files:** [systems/component/src/action.ts](../systems/component/src/action.ts) (new, ~220 LOC including tests).

**Tests:** 11 new (validation, async, ActionError, fast-fail, structured errors).

**Why better than the alternatives:**
- vs Next Server Actions: no Babel/SWC pass, no encrypted action IDs, no magic. Path is visible.
- vs Remix actions: detached from page route — any client code can call.
- vs tRPC: no router DSL ceremony. Per-function declaration.

### 4.5 — Streaming SSR + `suspense()` ✓ shipped

**What:** Async-iterable rendering. New `suspense({ fallback, children })` primitive. When children contain a pending `resource()`, emit `<!--p:N--><template id="pl-N"></template>${fallback}<!--/p:N-->`, register a continuation, hold the stream open; once the resource resolves, emit `<template id="c-N">${real}</template><script>__place.swap(N)</script>`. Inline `__place` runtime (~30 LOC) does the comment-marker range removal + template content insertion. Devalue handles value serialization.

**Per-route opt-out:** `suspense({ fallback, children, requireJs: false })` waits for resource synchronously (slower TTFB, works without JS). Tunable per-suspense, not framework-wide.

**Wheel-failures avoided:**
- Comment markers (not element IDs alone) for range removal
- Don't serialize Promises themselves — serialize resolved values keyed by resource identity
- Swap scripts are plain `<script>` (not `type="module"`), run synchronously as parsed
- Explicit `controller.enqueue()` flushes between chunks
- Pre-boot event capture (1 KB inline buffer + post-hydration replay)

**Why devalue, not seroval:** seroval's deserializer requires `eval`/`new Function`, breaking our `security: 'strict'` preset. Devalue is JSON-shaped, CSP-clean, half the client bundle, and SvelteKit-tested. Detailed comparison in earlier session.

**Files:** [systems/component/src/index.ts](../systems/component/src/index.ts) — new `suspense()` factory + `toStream` on built-in factories + revised `renderToStream`. New [systems/component/src/__place_runtime.ts](../systems/component/src/__place_runtime.ts) — the inline swap runtime. Add `devalue` peer dep.

**Tests target:** ~15 (sync resolution, async resolution, multiple boundaries, error path, requireJs:false, value serialization round-trip, pre-boot event replay).

**Estimated effort:** ~280 LOC + 15 tests. Single focused cut.

### 4.6 — Adapter interface scaffold ✓ shipped

**What:** Define `Adapter { name, adapt(builder) }` and `Builder` (inverted-control object exposing `buildClient`, `dispatch`, `routes`, `outDir`). Refactor `serve()` to internally use `Builder` (no behavior change). **No concrete adapter ships in this cut** — it's interface-design only, paving the way for Phase 5.1's Vercel/Cloudflare/Node implementations.

**Why now (and only the scaffold):** the SvelteKit research showed `Adapter`+`Builder` is the right shape (Vinxi punts to Nitro = adopting unjs, off-thesis; Astro's hook bus is more diffuse). Designing the interface BEFORE we have a second target prevents the "we shipped Vercel-specific code that's now an adapter wart" trap. Concrete adapters wait until a real deployment need arrives.

**Files:** [systems/component/src/index.ts](../systems/component/src/index.ts) — new `Adapter`/`Builder` types + `serve()` restructure. ~50 LOC.

**Tests:** existing serve tests cover behavior; no new tests for interface scaffolding alone.

### 4.7 — `<Img>` helper + lazy optimizer ✓ shipped

**What:** A typed `<Img src widths formats lazy />` component that emits `<img srcset>` / `<picture>` markup. A `/_place/img/*` route in `serve()` lazy-builds optimized variants on first request, caches via the `CacheStore` from 4.2.

```tsx
<Img src="/cover.jpg" alt="…" widths={[400, 800, 1600]} format="auto" lazy />
// → <img srcset="/_place/img/cover.jpg?w=400 400w, …" loading="lazy" decoding="async" />
```

**Why better than Next's `<Image>`:**
- Lazy variant generation, not eager build-time
- Cache-backed (same `CacheStore` as ISR — one storage layer)
- Pluggable resizer (Bun's image API, sharp-like adapter, etc.)
- No allowlist-of-remote-patterns config block

**Files:** [systems/component/src/img.ts](../systems/component/src/img.ts) (new, ~150 LOC).

**Tests:** 6 (markup correctness, srcset generation, default lazy, cache hit/miss, format negotiation).

### 4.8 — Event capture + replay ✓ shipped (delegated-listener foundation)

**What:** Opt-in listener delegation — one capturing listener per event type at the document level, handler registry populated during hydration, pre-boot event buffer replays after hydrate. Foundation for future Tier-3 resumability (4.x deferred); independently a TTI win because listener attach is centralized.

**Why opt-in initially:** capturing-phase delegation can interfere with `stopPropagation` in vanilla DOM listeners. `serve({ delegateListeners: true })` for now; default once shaken out.

**Why this is good enough:** Qwik's full resumability requires a 1000+ LOC compiler pass, two effect kinds (`useTask$`/`useVisibleTask$`), `$()` closure markers, and per-handler chunk bundling. For our targets (commonplace book, journal, knowledge base — listener-light, content-heavy apps), tier-1+2 alone gets ~90% of the perceived-perf win for ~10% of the architectural cost.

**Files:** [systems/component/src/__place_runtime.ts](../systems/component/src/__place_runtime.ts) (extended) — capturing listener installer + handler registry. [systems/component/src/index.ts](../systems/component/src/index.ts) — opt-in flag + SSR encoding of `data-place-on-click="h_42"`.

**Tests:** 10 (listener attachment, handler dispatch, pre-boot replay, opt-out).

---

## Phase 5 — production polish

After Phase 4 lands, the platform is feature-complete enough to compete with Next/SvelteKit on its own terms. Phase 5 is about ergonomics for shipping to production.

### 5.1 — Concrete deployment adapters

**Status:** Node adapter ✓ shipped (11 tests). Vercel + Cloudflare are queued for when their target workloads arrive.

**What:** `vercelAdapter()`, `cloudflareAdapter()`, `nodeAdapter()`. Each implements the `Adapter` interface from 4.6.

#### nodeAdapter() — shipped

`@place/component/adapters/node` exports `nodeAdapter({ port, hostname, onListen })`. Translates Node's `http.IncomingMessage`/`ServerResponse` to Web `Request`/`Response`. Pre-build constraint: Node has no `Bun.build`, so callers pass `clientJs: '<pre-built bundle string>'` (typically built by esbuild/Vite/Rollup ahead of time). Static assets work via an `fs`-based fallback in the framework's `readStaticFile()` primitive. Per-request CSP nonce + ALS scopes work end-to-end under Node — verified via integration tests that spin up a real http server under vitest.

**Vercel:** emit Build Output API v3 — `.vercel/output/config.json` + per-route function manifests. Static prerendered routes go to `static/`; dynamic routes get a function entry. ISR is native (Vercel's edge cache).

**Cloudflare Workers:** export a `fetch(req, env, ctx) => Promise<Response>` handler. Static assets via R2 binding. Cache via Workers KV or Cache API. Constraint: no Node APIs, no `fs`. Adapter swaps `Bun.file` for R2 fetches and `Bun.build` for pre-bundled output.

**Node:** wrap dispatch in `http.Server`. WebSocket via `ws` package. Static via `fs.readFile`.

**Files:** new sub-packages or files: `systems/component/src/adapters/{vercel,cloudflare,node}.ts`.

**Tests:** smoke tests per adapter (build output shape, request shaping); deeper testing requires actual deploy.

**When to ship:** the moment a real workload needs deployment. Not before.

### 5.2 — Font helper ✓ shipped

**What shipped:** `font(opts)` and `fonts(...defs)` helpers (`@place/component`'s [src/font.ts](../systems/component/src/font.ts)) that emit `@font-face` CSS + `<link rel="preload" as="font" crossorigin>` markup ready to drop into `page({ styles, meta: { extra } })`. Format auto-detected from URL extension (.woff2 / .woff / .ttf / .otf / .eot). CSP-clean: `font-src 'self'` is sufficient — no Google Fonts allowlist needed when self-hosting. CSS-injection-safe: family/URL escapes the `"` and `\` characters.

**17 tests** covering format detection, multi-src, variable-weight ranges, unicode-range, preload semantics, escape safety, and `fonts()` composition.

**Deferred to 5.2.x:** auto-download from Google Fonts (would introduce a server-startup network step + CSP egress concerns). For now the recommended pattern is "download font once, check into `./public/fonts/`, mount via `serve({ static: { '/fonts': … } })`". Phase 5.2.x candidate when a workload demands the build-time download flow.

### 5.3 — Build-time SSG with route discovery ✓ shipped

**What shipped:** `buildStatic({ outDir, routes, clientJs?, clientPath?, origin?, onPage? })` in [src/build-static.ts](../systems/component/src/build-static.ts) walks the routes map, pre-renders every Page (re-using `renderPage()` so meta/styles/load/Tailwind all work identically to runtime SSR), writes `<outDir>/<path>/index.html` files. Dynamic routes opt into pre-rendering via `page({ getStaticPaths: () => [...] })` — async-allowed. Non-Page handlers and non-GET routes are skipped (static can only represent immutable GETs). Optional `clientJs` writes the pre-built bundle to `<outDir>/<clientPath>` and emits the bootstrap `<script>` tag in the HTML — works for hydratable static sites.

**15 tests** covering static + dynamic route output, async getStaticPaths, missing-getStaticPaths error, raw-handler skip, custom clientPath, the onPage hook, load-data round-trip, recursive mkdir.

**Runs under Node** — verified by vitest. The CLI entrypoint (`bunx place build`) is a separate ergonomic cut deferred to v0.6+; for now consumers call `buildStatic()` from their own build script.

### 5.4 — Chunked initial flush ✓ shipped

**What shipped:** `renderToStream` now chunks its initial body emission into ~16KB pieces so the browser sees bytes incrementally — `<head>` + opening body tags arrive first (browser starts loading CSS/scripts immediately), body content arrives in subsequent frames. Reduces perceived TTFB on larger pages without changing the View contract.

**Reframed scope:** the original entry called for "true per-element streaming" (yield per `<tag>`), which only helps if rendering itself is async. Ours is synchronous in-memory string concat — the per-element pattern would add API complexity (View needs `toStream(emit)` async iterator) without commensurate benefit. Chunking captures the perceptible win in ~10 LOC. If a future workload makes rendering async (DB-driven AST walks, etc.), the per-element generator can ship as a Phase 6 cut.

**2 tests** verifying chunks ≤16KB, multiple chunks for large bodies, single chunk for small bodies, content integrity across boundaries.

---

## Phase 6+ — big-bet horizon items

Things we know need to happen eventually but require either substantial architectural work or external pressure (real users hitting the limit).

### 6.1 — Tier-3 resumability (lazy handler chunks)

**Pre-paved by 4.8.** Once delegated listeners ship, lazy-loading per-handler chunks is a focused cut: bundler plugin extracts handlers into separate chunks, modify the inline runtime to dynamic-import on first event, modify hydration to NOT eagerly populate the handler registry.

**Estimated effort:** ~600-800 LOC + bundler integration. Defer until a workload hurts.

### 6.2 — HMR-aware component identity

**What:** Component state survives source edits during dev. Today every Vite/Bun.build reload remounts the root, losing in-progress state.

**Why hard:** identifying "this is the same component as before, even though its source changed" requires either content hashing or stable IDs across reloads. Solid + SvelteKit have working solutions; we'd port the design.

### 6.3 — Web component interop

**What:** `<my-component>` boundary that wraps a `place` component as a custom element, AND consume a custom element from inside `place` JSX.

**Why low priority:** mostly a bridge for legacy/external integration. Targets that need it can punt to vanilla DOM today.

### 6.4 — AsyncLocalStorage for browser?

**What:** ALS is server-side only today. A browser equivalent (e.g., one global stack tied to the current event loop tick) would let `withCapability` work the same way on both sides. Could enable patterns like "this click handler runs in a fresh cap scope."

**Why deferred:** the cap stack already does the right thing in browsers (single-threaded JS = no concurrent contention). The win is mostly conceptual symmetry.

---

## Cross-system status

The component system is the active focus, but other systems have their own roadmaps. Brief status:

### `@place/reactivity`

**v0.1 shipped:** state, watch, computed, effect, batch, untrack, scheduler, derivable-state property tests, history, resource.

**Phase 5 candidates:** time-indexing primitives (Phase 5 of the original 8-phase reactivity plan); reactive integration with capability scopes (subscription + reactive scope coordination).

### `@place/capability`

**v0.3 shipped:** `defineCapability`, `provide`, `install`, `use`, `tryUse`, `withCapability`, `withCapabilities`, `requires` (manual annotation Phase 4 v0.1), `runWithCapabilityScope` (just shipped in 4.1).

**Phase 4 v0.2 candidates:** compile-time effect-scope enforcement via build step. Currently typed `Requires<C>` is documentation only; a build pass would verify cap-availability statically.

### `@place/data`

**v0.x:** Collection primitive (15 tests). Scope is still under-defined; needs a charter rewrite. Real use case: the commonplace book's note collection, but currently that's done via direct reactivity.

**Direction:** typed query layer that compiles to optimal storage backend (in-memory, IndexedDB, server). Phase 5 candidate.

### `@place/cache`

**Status:** charter only. May be subsumed by the `CacheStore` shipped in component/4.2 — TBD whether this is an empty system or its own thing. Resolve before Phase 5 ships.

### `@place/persistence`

**v0.3 shipped:** memory adapter, server adapter via fetch, persistedState. 38 tests.

**Phase 4 candidates:** IndexedDB adapter (the deferred async-as-pending production case); a `CacheStore` impl that wraps a persistence adapter (closes the loop with component/4.2).

### `@place/routing`

**v0.x stable:** path matcher (`route()`), URL parser, hash router, history router, Router cap. 97 tests. `urlState` lives in component but uses RouterCap.

**No active development.** API is settled.

### `@place/search`

**v0.x:** basic substring + ranking. 11 tests.

**Phase 4 candidates:** indexing strategies (n-gram, posting list); semantic search via embedding.

### `@place/security`

**v0.x:** signed tokens, CSRF, cookies, rate limit. 26 tests.

**Stable.** No active changes; CSP rendering moved to component as part of 4.x.

### `@place/build`

**v0.x:** scaffold only. Phase 6+ — custom syntax / compiler passes.

---

## Deliberately not doing

These are the framework anti-features. Listed explicitly so future contributors don't accidentally ship them. Anti-Next, anti-bloat, anti-magic.

1. **File-system routing.** Routes are values: `routes: { '/': home }`. Move a file, route doesn't break.
2. **Magic export conventions** (`metadata`, `loader`, `action`, `meta`, `useHead`, `+page.server.ts`). One `page({...})` object, top-to-bottom readable.
3. **`'use client'` / `'use server'` markers.** Server-only adornments are structural — they live in server files the bundler doesn't reach from client.
4. **Built-in caches that span auth contexts.** `CacheStore` is per-route key + tag; auth context goes in your key.
5. **Implicit nested layouts via folder structure.** Compose with regular function calls.
6. **Codegen for typed routes.** Generics flow natively through `page<U, L>()`.
7. **Auto-RPC magic for Server Actions.** `action({path, input, fn})` is explicit; the path is visible.
8. **A god-object `App` runtime.** Each system has its own runtime contract; no shared bus.
9. **Default config requiring `'unsafe-inline'`.** Tailwind hash auto-merges into CSP `style-src`.
10. **Closure serialization for handlers (Qwik-style).** Two-effects mental model isn't worth the win for our use cases.
11. **Framework rebrand post-1.0.** The name `place` is permanent — see [stability covenant](stability-covenant.md). (Cautionary tale: Remix → React Router v7.)
12. **Auth-context-bleed-prone caching.** `cache(fn)` is structurally isolated from per-request capabilities — see [ADR 0005](decisions/0005-cache-no-per-request-state.md).

---

## Verification strategy

Every cut ships with:

1. **Lint clean.** `bun run lint` (Biome).
2. **Typecheck clean.** `bun run typecheck` (TypeScript across 11 tsconfig projects).
3. **Tests green.** `bun run test` (vitest, currently 922 passing + 14 skipped).
4. **Browser-verified for observable changes.** SSR-affecting cuts get spun up in the sync-server demo via Claude Preview.
5. **CI runs all three.** `bun run ci` is the all-or-nothing gate.

Test count benchmark:
- v0.1 shipped at ~50 reactivity tests
- v0.2 shipped at 256 platform tests
- v0.3 shipped at 554 platform tests
- v0.4 in flight at 591 (will close around 700-720 after Phase 4.5–4.8)

---

## Phase 7 — Next-16-gap closures + DX polish (2026-05-06+)

A focused arc closing the most-requested gaps after the comprehensive Next 16 comparison. Each is a small-to-medium cut that ships independently.

### 7.1 — `cache(fn, opts)` higher-order ✓ shipped
Opt-in function-level memoization. Closes the gap with Next 16's Cache Components without a compiler. Inflight-dedupe, TTL, tag-based invalidation via `revalidate.tag()`. 8 new tests. ~120 LOC.

### 7.2 — Pretty terminal output ✓ shipped
`serve()` prints a startup banner with route table + bundle/Tailwind timings + active features (security, theme, ISR). Per-request log lines with method/path/status/duration. Default-on in dev; opt-out via `serve({ log: { banner: false, requests: false } })`. ANSI color when stdout is a TTY. ~100 LOC.

### 7.3 — `<Link>` typed helper ✓ shipped (this session)
Typed link with prefetch on hover, active-state class, route validation. Replaces raw `<a>` for client-side navigation; works with hashRouter or future path-router. Plays nice with the framework's `route()` matchers.

### 7.4 — HEAD request fallthrough ✓ shipped (this session)
HEAD requests now match GET handlers (Express/Bun.serve standard behavior). Was surfaced by per-request log noise — `HEAD / 404` was a quiet bug.

### 7.5 — Dev error overlay ✓ shipped (this session)
Pretty stack-frame rendering in the browser when render throws in dev mode. Production keeps the existing minimal-info 500 page (no stack leakage). ~80 LOC.

### 7.6 — `layout()` primitive ✓ shipped (2026-05-05)
Composable nested layouts. Enables the Next/SvelteKit/Remix pattern of `RootLayout > UserLayout > UserPage`. Layout meta merges into page meta (htmlClass/bodyClass concat; scalars last-write-wins). `serve({ layout })` + `boot({ layout })` apply a default to every page so chrome (header/footer/nav) lives in one place. 12 new tests. Verified end-to-end in the sync-server demo (header + footer + nav across `/`, `/ssr/demo`, `/ssr/slow`, `/actions/demo`).

### 7.7 — Sharp-backed image optimizer (queued)
Real backend for the `<Img>` markup contract: AVIF/WebP/JPEG variants, responsive srcset, blur placeholder. Lazy-built + cached via existing CacheStore. Sharp added as a peer dep (optional). Targeted ~200 LOC.

### 7.8 — Cloudflare Workers adapter (queued)
Concrete implementation of the adapter scaffold. Static-asset serving via Workers Sites or KV; no fs.readFile. Foundation for "deploy place-ts to the edge."

### 7.9 — View Transitions API integration ✓ shipped (2026-05-08)
Opt-in `serve({ viewTransitions: true })` injects `@view-transition { navigation: auto; }` (gated under `prefers-reduced-motion: no-preference`) into every page's `<head>`. Browsers that support cross-document VT (Chrome 126+, Safari 18+, Firefox 144+) animate same-origin navigations automatically; older browsers ignore the at-rule. No JS, no `<ClientRouter>` wrapper — apps style animations via standard CSS `::view-transition-*` pseudo-elements. ~30 LOC. See [ADR 0006](decisions/0006-view-transitions.md).

### 7.10 — Resumability spike (horizon)
The Qwik-shaped bet: skip hydration entirely; capture handlers at HTML emit time, attach lazily on user interaction. Tier-3 of the deployment matrix. Big-bet item, deferred until a real workload demands the listener-density savings.

### 7.11 — `app([pages]).serve()/.boot()` factory + co-located page authoring ✓ shipped (2026-05-11)
"The smaller app" arc — Round 5. `page('/path', def)` declares path + view + load + meta + `on:` actions + `search:` shape + `onError`/`onNotFound` co-located. `app([pages], opts).serve()` derives the server-side routes table; `.boot()` mounts the client. `routes(prefix, ...)` groups subtrees. `on: { name: handler }` auto-CSRFs + auto-types the client-side caller (`pageRef.name(input)`). `search: shape({...})` types the URL-query state. `onNotFound` + `notFound()` give per-page 404 views. Collapses ~120 LOC of route-mirror + entry duplication per app. See [ADR 0007](decisions/0007-smaller-app-arc.md).

### 7.12 — `virtualList()` primitive ✓ shipped (2026-05-12)
Reactive windowed-render primitive. `virtualList({ count, estimateSize, overscan?, horizontal?, initialViewport? })` → `{ totalSize, visible, containerRef, measureElement, scrollToIndex, scrollToOffset }`. Plain function, plain object return — no hook idioms, no tuple returns, no `useVirtualizer` indirection, no `flexRender` escape hatch. ResizeObserver + scroll listener attach on `containerRef`; `onCleanup`-registered teardown. SSR-safe via `initialViewport` (default 600px). 17 tests covering uniform/variable estimateSize, overscan clamping, measured-size override, reactive count change, scrollToIndex (start/center/auto), horizontal mode, container disposal. First consumer: commonplace's notes list. Validates the [ADR 0008](decisions/0008-port-the-insight-not-the-shape.md) "ship the insight, drop the React baggage" doctrine on a real workload.

### 7.13 — Commonplace flagship transformation ✓ shipped (2026-05-12)
Commonplace rebuilt as the structural-wins demo: every Round 1–6 shipping feature visible in one running app. Path-based multi-route (`/`, `/notes/:id`, `/notes/:id/edit`, `/tags`, `/tags/:tag`); single isomorphic `app.tsx` entry (replaces server.tsx + client.tsx + App.tsx); root layout + per-page `<ClientOnly>` gating; virtualized notes list; co-located `on: { save }` action with auto-CSRF; per-page `onNotFound`; `search: shape()` URL state; capability-swap storage (memory / localStorage / IndexedDB / crossTab / server). When someone asks "is this real?", the answer is `bun run commonplace`. See [ADR 0009](decisions/0009-commonplace-flagship.md) for axis-by-axis demo coverage + migration metrics.

---

## Open architectural questions

These aren't blocking anything but deserve thinking-time before they bite:

1. ✅ **RESOLVED: `@place/cache` vs component's `CacheStore`.** They're different scopes. CacheStore is the operational primitive (typed get/set/delete; powers ISR + image opt) and lives in component because that's where the consumers are. The `@place/cache` charter remains as the design intent for the broader "cache entries as State + invalidation graph" — a v0.6+ idea, not a v0.5 blocker. See [systems/cache/README.md](../systems/cache/README.md).
2. **AsyncLocalStorage for browsers.** Is there a real use case worth the complexity? See 6.4.
3. **The Tier-3 resumability question.** Worth doing? Listener-density of our actual users will tell us. Track real apps.
4. ✅ **RESOLVED: Schema validator stance for `action()`.** Shipped `shape({...})` — a tiny built-in for the common "object with primitive fields" case. Zod / Valibot still slot in via the `ActionSchema<T>` interface for richer shapes.
5. **HMR component identity story.** Solid's approach uses Vite plugin metadata; ours would need similar. When does it become painful enough to fix?
6. **Generalize `RenderPageOptions.htmlClassPrefix` into a `decorateMeta(req)` hook?** One-off field added for the theming `serve({ theme })` shorthand. If a SECOND request-time decoration emerges (locale, A/B cohort, per-route CSP override), promote to a generic hook. Not yet — wait for the second concern.
7. **Split `systems/component/src/index.ts` (4,301 LOC).** Audit-flagged maintainability risk. Outline + sequencing exists in the audit-followup plan; do as a focused session.

---

## How to use this doc

- **At session start:** check "currently shipping" + the in-flight phase to see where to pick up.
- **At phase completion:** mark the phase ✓ shipped, update test count, update "last touched" date.
- **At phase start:** verify the design spec is still right; update if research found new wheel-failures.
- **For new ideas:** put them in "open architectural questions" until they earn a phase slot.
- **For things we'll never do:** add to "deliberately not doing" with a one-liner.
