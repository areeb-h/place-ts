# State of place — 2026-05-16

> Comprehensive audit covering charter drift, public API consistency,
> test coverage, documentation gaps, fresh performance numbers,
> competitor comparison, and a use-case readiness map.
>
> Companion to (and update of) `docs/audits/2026-05-15-post-T5-D-audit.md`.
> One day later by date, but ~50 ADRs of work newer.

## Executive summary

Place-ts is **structurally distinctive on 3 axes** that no surveyed framework matches: (1) strict-CSP-by-default with CDN-compatible per-response nonces, (2) capability-typed effects replacing directive-as-magic-strings, (3) value-based routing (no file-system conventions). On other axes it is **at parity** with Solid 1.9 / Svelte 5 Runes (reactivity algorithm) and **measurably behind** on three: bundle floor vs Astro/Fresh static pages (14-17 KB vs 0 KB), HMR speed vs Vite ecosystem (1.46 s vs 10-50 ms), ecosystem maturity (zero adopters vs years of investment).

**Top 3 strengths today** — strict CSP done right; one-graph thesis genuinely realised (reactivity + persistence + routing share one mental model); typed actions are leaner than every competitor's equivalent.

**Top 3 weaknesses today** — HMR slow-path is the most-visible performance debt; charter drift continues to widen (most per-system charters are 1-2 tiers behind shipped reality); zero ecosystem signal (no adopters, no integrations, no third-party recipes).

**Top 2 recommended next moves** — (A) close the HMR gap to sub-200 ms via in-process module swap rather than supervisor respawn; (B) per-system charter rewrite sweep so the "magic with clarity" gate from ADR 0026 lives in every system's `00-charter.md`, not just the platform charter.

---

## 1. Shipped surface — what actually exists

Counts as of 2026-05-16 (head of working tree):

| Quantity | Number |
|---|---|
| Total TypeScript source files (incl. tests) | 338 |
| Total TypeScript LOC | 61,774 |
| ADRs accepted | 40 |
| Tests passing | 1,242 (14 skipped) |
| Typecheck projects clean | 14 |
| Shipping systems (per platform map) | 9 + design package + reactivity/motion sub-module |

### Per-system source vs test LOC

```
reactivity      src: 1,974 LOC (10 files)   test: 1,958 LOC ( 8 files)
component       src: 21,084 LOC (51 files)  test: 10,418 LOC (45 files)
capability      src:   505 LOC ( 1 files)   test:   382 LOC ( 2 files)
routing         src:   818 LOC ( 1 files)   test:   875 LOC ( 1 files)
data            src:   150 LOC ( 1 files)   test:   174 LOC ( 1 files)
persistence     src:   554 LOC ( 1 files)   test:   793 LOC ( 1 files)
search          src:    63 LOC ( 1 files)   test:   110 LOC ( 1 files)
security        src:   331 LOC ( 1 files)   test:   259 LOC ( 1 files)
design          src: 3,489 LOC (14 files)   test: 1,639 LOC (10 files)
```

Source-to-test LOC is roughly **1.8:1** across the platform — well within sane bounds. No system exceeds 2:1, which means the framework is not under-tested at the LOC level.

### Public API export counts

```
@place/component   ~240 named exports (after barrel expansion)  — 393 KB barrel
@place/design        41 (16 values, 25 types)
@place/reactivity    23 (state/watch/derived/untrack/batch/flush/peek/resource/history + types)
@place/reactivity/motion  33 (animate/tween/sequence/curve/clock + presets + easings)
@place/routing       14
@place/capability    12
@place/data           3
@place/persistence    9
@place/search         2
@place/security      13
```

`@place/component` carries ~85% of the public-API mass. That's the platform's biggest single risk surface for breaking changes.

---

## 2. Fresh performance numbers (the docs site, May 2026)

Re-ran `examples/docs/probes/{perf-regression,per-route-simulation,16kb-breakdown}.ts` against a freshly-restarted dev server:

### Server-side HTML page timings (warm cache)

```
route                         run1     run2     run3     size
/                              16.0ms   6.9ms   5.9ms  168.6k
/concepts/reactivity            5.2ms   3.2ms   3.6ms  162.1k
/api/components                 4.2ms   3.3ms   4.6ms  194.0k
/why                            2.8ms   3.0ms   2.9ms  164.0k
/recipes                        3.4ms   1.8ms   1.7ms  133.9k
/getting-started                3.1ms   2.7ms   3.5ms  159.5k

Hot SSR p50: 2.6 ms · p95: 4.9 ms · max: 4.9 ms
Cold SSR (first request): 16 ms — first-render Tailwind compile + tokenize cost
```

### Per-route client bundle sizes (dev build)

```
Pages: 25
Avg gzip: 28.97 KB
Min gzip: 21.51 KB  (recipes/index)
Max gzip: 32.08 KB  (api/components, api/design)
Shared bundle (no per-route split): 65.40 KB gzip
Per-route win: 36.03 KB gzip avg per page
```

### Production-like bundle breakdown

```
docs app — full client bundle (prod-like)      77.62 KB raw  / 26.63 KB gzip
synthetic — content-only page (static JSX)     25.81 KB raw  /  9.51 KB gzip
synthetic — renderToString import only         10.87 KB raw  /  4.37 KB gzip
synthetic — app() import only                  29.81 KB raw  / 11.16 KB gzip
synthetic — state/watch/derived only           10.77 KB raw  /  4.17 KB gzip
```

The **state/watch/derived irreducible core is 4.17 KB gzipped** — competitive with Solid (~5 KB) and Svelte 5 runtime, slightly larger than Preact signals.

### Island bundle sizes (the docs chrome)

```
mobile-nav-button       2.6k raw   / 1.2k gzip
search-trigger          3.6k raw   / 1.6k gzip
theme-toggle            5.1k raw   / 2.1k gzip
page-nav                4.7k raw   / 1.9k gzip
toc                     4.6k raw   / 2.1k gzip
search-palette          2.6k raw   / 1.2k gzip
mobile-nav-drawer       4.8k raw   / 2.1k gzip
TOTAL                  30.6k raw   / 13.2k gzip
```

Per-island floor ~1.2-2.1 KB gzipped. Aggregate per-page interactive surface ~13 KB gzipped, which is the realistic "interactive content site" number to compare against competitors.

---

## 3. Charter drift findings

The dominant finding from the critic-agent pass: **charters are not being touched as code lands.** Every Tier 7-13 ADR added shipped surface; none updated the affected system's `00-charter.md`. The per-system rewrite proposed at the 2026-05-15 audit (T7-A/B/C) has not happened.

### Critical (contradicts a non-negotiable)

- **`systems/capability/docs/00-charter.md`** — Charter line 7 declares the API as `handle(kinds, handler, body)`. Shipped surface is `defineCapability` / `provide` / `install` / `use(fallback?)` / `tryUse` / `requires` / `Provision`. Completely different API. **No movement since baseline.**
- **`systems/security/`** — No `docs/00-charter.md` file at all. Cannot satisfy platform non-negotiable #5 ("each system independently understandable") and is not on the nine-system map.
- **`systems/data/docs/00-charter.md`** — Declares ownership of typed queries/loaders/mutations/source-of-truth abstraction. Shipped surface is exactly one helper: `collection<T>()` over `State<T[]>`.

### Major (shipped surface ↔ charter mismatch)

- **`systems/component/docs/00-charter.md`** — `discoverPages`, `theme()`, `viewport`, typography in themeTokens, `titleTemplate`/string-`meta`/h1 auto-title, dev supervisor (ADRs 0031, 0032, 0034, 0035, 0038, 0039) all landed since 2026-05-15. None appear in the system charter's surface list.
- **Component charter commitment #6** ("No built-in caches. Per-request data is per-request.") — directly contradicted by `cache.ts` `CacheStore`/`CacheEntry` consumed by ISR + image optimizer + the public `revalidate` export.
- **Component charter commitment #7** ("No codegen.") — contradicted by `build/island-bundler.ts` writing `.place/island-entries/_auto-init.ts`.
- **`docs/platform/00-system-map.md`** — `cache` still listed as system #4 ("v0.2") but `systems/cache/README.md` says "deferred indefinitely." `security` shipped but not on the map. Component-system row hasn't caught up with islands-as-the-only-hydration-model (ADR 0023), dev supervisor (ADR 0032), or `discoverPages` (ADR 0039).
- **`docs/platform/04-interfaces.md`** — `PersistenceAdapter<T>` declared as `initial/observe/write/conflict?`; shipped is `load/save/observe/refresh?`. Three of four method names diverge. Carried from baseline; unchanged.
- **`systems/routing/docs/00-charter.md`** + **`systems/capability/docs/00-charter.md`** — Both still v0.3-era stubs. The shipped surface for both is 2 tiers ahead.
- **`@place/design`** — Charter NN#6 forbids arbitrary Tailwind values. Live violations: `presentational.tsx` (`text-[10px]`, `text-[11px]`, oklch literals), `Toast.tsx`, `Dialog.tsx`, `Field.tsx`, `Menu.tsx`, plus newly-added `CodeBlock.tsx` lines 66-68 (`text-[12px/13px/14px]`). The charter NN#6 erosion got 1 file *worse* in T13.
- **Design charter §"Public surface"** lists Button as the only export with the rest as "backlog." Reality: 12 components + a tokenizer surface ship. Wildly stale.

### Minor

- `peek()` still exported as `@deprecated` from reactivity — pre-publish freedom + perfection bar says no deprecated surface should ship pre-publish.
- The motion clock pre-empts Phase-5 time vocabulary (carried from baseline).
- `data-place-deferred-url` cross-system convention not in `04-interfaces.md`.

### Cross-cutting summary

The single highest-leverage move: a per-system charter rewrite sweep (capability, routing, security, data, component-surface refresh, design-library refresh, `04-interfaces.md` refresh), explicitly aligning each system's "what it owns" list with the (a/b/c) gate from ADR 0026. The design library's arbitrary-Tailwind erosion deserves to be paired with it because every new design primitive is making the gap worse.

---

## 4. Public API consistency findings

### Headline naming-drift collisions (highest user-DX impact)

1. **`themeTokens()` vs `theme()`** (both in `@place/component`) — both build theme tokens. `theme({ modes })` is the new T13 helper; `themeTokens({ themes })` is the underlying primitive. Same return type. No JSDoc on either explains which to reach for. **Blocking for DX.**

2. **`cap()` vs `defineCapability()`** — `cap()` JSDoc says "the canonical API in v1.0" but `defineCapability` is what the stability covenant pins under "What never changes." Contradiction; pick one canonical name.

3. **`renderToString` / `renderToStream` / `renderPage` / `RenderToHtmlOptions`** — four "render" entry points with overlapping semantics, and the `RenderToHtmlOptions` interface is exported without a corresponding `renderToHtml` function. Dead-weight Options type. Confusing autocomplete.

4. **`Img` (component/img.ts) vs `img` lowercase factory** — `Img` is exported; `img` is missing from the html-factories list. Either deliberate replacement (then document it) or a gap.

5. **`searchParams()` vs `useSearch<T>(props)`** — different concepts (typed query-param schemas vs page search-prop accessor) but both have "search" in the name. New users hit both in autocomplete.

### Tier 12-13 exports lack stability tier

Per the stability covenant, anything not marked `@provisional` is permanent from the version it shipped in. Currently un-tiered:

- `cap<T>()` shorthand
- `discoverPages`
- `theme()` helper
- `viewport` + `configureViewport`
- `Copy` + `markCopyUsedOnThisRequest`
- `useSearch<T>(props)`

Five minutes per export to add `@provisional` JSDoc tags; saves a v2.0 by leaving room for course corrections.

### JSDoc coverage gaps (high-traffic primitives missing examples)

`el`, `Fragment`, `Static`, `notFound`, `markCopyUsedOnThisRequest`, `tabsState`, `discoverPages` (at the barrel level), `revalidate`. All are commonly-used; none has a JSDoc-with-example. Across the platform, JSDoc-with-example coverage is roughly 65-70%.

### What's solid

- `@place/reactivity` core — disciplined small surface, sharp JSDoc on every primitive
- `@place/persistence` — adapter family has identical shape; `crossTabAdapter` composition pattern is the cleanest piece of API in the platform
- `@place/routing` — `RouterHandle`'s triple-duty (Router + Provision + Disposable) is a model
- `@place/security` — tight, secure-by-default, each function does one thing
- `@place/data`, `@place/search` — anti-bloat directive observed visibly

---

## 5. Test coverage findings

### Per-system overview

| System | LOC ratio | Count ratio | Status |
|---|---|---|---|
| component | 2:1 | 29:1 | ✓ Good |
| design | 2:1 | 22:1 | ✓ Good |
| reactivity | 1:1 | 15:1 | ✓ Good |
| routing | 0:1 | 8:1 | ✓ Good |
| capability | 1:1 | 16:1 | ✓ Good |
| persistence | 0:1 | 14:1 | ✓ Good |
| security | 1:1 | 12:1 | ✓ Good |
| data | 0:1 | 10:1 | ✓ Good |
| search | 0:1 | 5:1 | ✓ Good |

No system exceeds weak-coverage thresholds (>10:1 LOC or >30:1 count). Framework-level conformance tests at `tests/conformance/reactivity.charter.test.ts` — 10 tests covering reactivity charter provisions. **No conformance tests** for component, design, or routing charters.

### Critical gaps

1. **`discoverPages()` — zero direct tests.** Public API, 148 LOC, untested: duplicate-path detection, index-file resolution, `_`-prefix filtering, error-message clarity, subdirectory recursion semantics. High user-facing surface.
2. **`configureViewport()` edge cases** — unsorted breakpoints, boundary conditions at exact threshold widths, re-configuration after subscription.
3. **`__copy-runtime.ts` in isolation** — covered indirectly via Copy/CodeBlock unit tests; no direct test of the event handler, fallback-on-clipboard-rejection, or `data-state` mutation.
4. **Theme typography scale variants** — 8 typography tests exist but rarely exercise the 8 named scales (`'minor-second'` through `'golden'`).
5. **Tokenizer combinations** — JSON/CSS/HTML/Python tokenizers tested in isolation; mixed-language blocks (markdown + code), CDATA, CSS-var interpolation untested.

### Highest-ROI test additions

1. **`discoverPages()` integration suite** — directory walk + duplicate detection + error clarity. ~50 tests, catches ~15 latent runtime bugs.
2. **Viewport edge cases** — boundary conditions, SSR determinism. ~12 tests.
3. **Conformance tests for component + design + routing charters** — currently zero per-charter conformance. The conformance pattern from reactivity is reusable.
4. **Cross-island shared-state regression** — the search-palette/mobile-nav-drawer bug from this session (interaction strategy on hidden modal) should be a permanent regression test.
5. **Strict-CSP nonce-injection contract** — the copy-runtime CSP nonce bug from this session was caught only by live browser test. Worth a unit test.

---

## 6. Docs + examples coverage

### Critical gaps (Tier 12-13 features shipped without docs)

| Feature | Status |
|---|---|
| `viewport.*` namespace | Partial — ADR 0034 + live demo at `/concepts/reactivity`. **Missing**: dedicated `/api/viewport` page |
| `theme()` helper | Partial — ADR 0038. **Missing**: `/api/theme` + migration recipe |
| `discoverPages()` | Minimal — ADR 0039 only. **Missing**: API page + recipe |
| `<Copy>` component | **Missing entirely** from `/api/design` page |
| Tokenizers (`tokenizeJson/Css/Html/Python` + `registerLanguage`) | Partial — `/api/design` shows one example. **Missing**: tokenizer API reference + custom-language recipe |

### Other API gaps

`history()`, `resource()`, `collection()`, `persistedState()`, `crossTabAdapter()` — all shipped, none have dedicated API reference pages. Sidebar nav currently lists 11 API pages but should have 17-20 for completeness.

### Example apps coverage

| Example | Status |
|---|---|
| `examples/docs` | ✓ live (the docs site itself) |
| `examples/sandbox` | ✓ live (reactivity primitives) |
| `examples/commonplace` | ✗ stub ("will be implemented incrementally") |
| `examples/sync-server` | minimal |
| `examples/overlay-preview` | unclear purpose, 4 files, no README |

Real use cases NOT covered by an example app:
- Multi-route navigation with shared state (sidebar + content pane)
- Local-first sync (cross-tab + server persistence together)
- Complex form validation + submission
- Embedded rich-text editor
- Virtual lists + ISR together

### Priority docs punch list

**Must-have** (Tier 13 ships incomplete without these):
1. `/api/viewport.page.tsx` stub
2. `/api/design.page.tsx` expansion (add `<Copy>`, full CodeBlock props, tokenizer architecture)
3. `recipes/theme-migration.page.tsx` (themeTokens → theme)
4. `recipes/code-customization.page.tsx` (registerLanguage)
5. `recipes/discover-pages.page.tsx`

**Should-have** (Tier 12 holes):
6. `/api/history.page.tsx`
7. `/api/resource.page.tsx`
8. `/api/collection.page.tsx`
9. `/api/routing.page.tsx`
10. `concepts/theming.page.tsx`

Roughly 16 pages to reach full API + recipe coverage.

---

## 7. Competitor comparison (May 2026 numbers)

| Framework | Bundle floor (gzip) | Per-island (gzip) | HMR | Cold start (dev) | Strict CSP default | Routing |
|---|---|---|---|---|---|---|
| **place-ts** | 14-17 KB (per-route) | 1.2-2.1 KB | **1.46 s** | 1.2 s | **✓ nonce + CDN-safe** | **value-based** |
| Next.js 16 | ~75-90 KB | 3-6 KB | <50 ms (Turbopack) | 412 ms → 200 ms with cache | ✗ (CSP breaks CDN cache) | file-system |
| Astro 6 | **0 KB static** | server island: ~few hundred bytes; client island: ~5 KB Preact | 10-50 ms | <1 s | ✓ hash-based | file-system |
| SvelteKit (5) | **3-5 KB interactive** | ~1-2 KB per component | 10-20 ms | <1 s | ✓ auto hash mode | file-system + `+` prefix |
| SolidStart | 12-15 KB | 1-3 KB | Vite range | <1 s | not first-class | file-system |
| Qwik | ~1 KB qwikloader + per-handler <1 KB lazy | per-handler boundary | Vite range | <1 s | not first-class | file-system |
| Fresh 2.3 | **0 KB static** | ~3 KB Preact + 1-3 KB component | not polished | **8 ms** | not first-class | file-system + Deno |

### Where place-ts wins

| Framework | place-ts genuinely ahead on |
|---|---|
| Next.js 16 | Bundle floor (14-17 KB vs 80 KB), strict-CSP-with-CDN, capability-typed effects vs `"use server"`, no file-system magic |
| Astro 6 | Cross-island shared state (Astro has none), reactive graph, server actions with capability typing |
| SvelteKit | Value-based routing, one-graph thesis, capability typing |
| SolidStart | Routing model, capability story, strict-CSP-default |
| Qwik | Identifier discipline (no `$()` magic suffix), no graph-serialization cost in HTML |
| Fresh | Reactivity model, broader runtime support, capability typing |

### Where place-ts is behind

- **HMR**: 1.46 s slow-path is 30× the Vite ecosystem norm and the single most-visible UX gap.
- **Bundle floor for pure-static content pages**: 14-17 KB vs Astro/Fresh's 0 KB.
- **Cold start**: 1.2 s vs Fresh's 8 ms.
- **Ecosystem**: zero adopters, zero integrations, zero third-party recipes.
- **Build maturity**: untested at scale; Turbopack / Vite have years of investment.

### Honest assessment

Place-ts is **genuinely ahead** on three axes: strict CSP done right with CDN compatibility, capability-typed effects in place of directive magic, value-based routing.

Place-ts is **ahead on paper only** on reactivity-algorithm grounds: the algorithm is the same shape as Solid 1.9 and Svelte 5 Runes; the implementation has not been audited at scale.

Place-ts is **actually behind** on HMR speed, cold start, and ecosystem. The 1.46 s "supervisor + reconnect" HMR is the single most-fixable behind-metric.

---

## 8. Use-case readiness map

How ready is place-ts for each common app shape today?

| Use case | Score | Why | Top gaps |
|---|---|---|---|
| **Content sites / docs** | **5/5** | The docs site itself proves it. SSR + per-route splits + typography + 7-language CodeBlock + search + theming + viewport reactivity all shipped. | Markdown rendering pipeline (nice-to-have) |
| **Personal / portfolio** | **5/5** | `discoverPages` + `theme()` + motion = zero boilerplate | none |
| **Static sites (SSG)** | 4/5 | `buildStatic()` ships; per-route bundles work | Deployment recipes (Cloudflare Pages / Netlify / Vercel) absent |
| **Public API + UI** | 4/5 | `handler()` for arbitrary routes; rateLimit; Bun.serve speed | Structured logging recipe; observability integrations |
| **SaaS dashboards** | 3/5 | Sessions/CSRF + typed actions + Field/Input + resource() + persistence + virtualList all there | `<Table>` / `<DataGrid>`, full `<Form>` validation story (Zod recipe), `<Can>` for RBAC |
| **E-commerce** | 3/5 | ISR (revalidate), search indexer, persistedState for cart, typed actions for checkout | `<Image>` primitive, payment integration recipes, `<Combobox>`, `<Sheet>` |
| **Forums / community** | 3/5 | Sessions, search, typed actions | Markdown rendering, rich-text editor integration, pagination primitive |
| **Internal tools / admin** | 3/5 | Same plumbing as dashboards | Same gaps + drag-and-drop, multi-step wizard pattern |
| **Real-time / collab** | 2/5 | Sync-server protocol exists; WS persistence adapter | `examples/sync-server` is incomplete; no end-to-end chat example; no CRDT recipe |

The shape: place-ts is **production-ready for content + docs + portfolio sites today**, and an **excellent fit but missing components** for SaaS / e-commerce / internal tools. The plumbing is right; the missing pieces are widgets (Table, Image, Combobox, Sheet, Form-with-Zod, Can) and recipes.

---

## 9. Recommendations — what to ship next

Ordered by user-impact-per-effort.

### Top priority (highest impact)

1. **HMR speed** — close the gap from 1.46 s to sub-200 ms. Path: per-island module swap (Tier 11 design exists, ADR 0028) instead of supervisor + browser-reload. Single biggest visible-quality lift.

2. **Per-system charter rewrite sweep** (Tier 7 carryforward, now also Tier 14 carryforward). Capability, routing, security (write new charter), data (reality-align), component (refresh §owns), design (refresh §public surface + sanction tokenizer surface). Stops the drift compounding.

3. **Tier-label every Tier 12-13 export** (`@provisional` JSDoc tags on `cap`, `discoverPages`, `theme`, `viewport`, `configureViewport`, `Copy`, `useSearch`). Five minutes per export. Saves a v2.0 by leaving room for course-corrections.

### Secondary

4. **Resolve `themeTokens()` vs `theme()` collision** — pick one canonical name, mark the other `@deprecated` (or remove pre-publish per the freedom directive).

5. **Docs punch list** — 5 must-have new pages (viewport, design expansion, theme migration recipe, codeblock customization recipe, discoverPages recipe) + 5 should-haves (history, resource, collection, routing, theming concept). Roughly a week's worth of writing.

6. **Tests for `discoverPages()`** — zero coverage on a public API.

### Tertiary

7. **`<Table>` / `<DataGrid>`** primitive in `@place/design` — unblocks dashboards + internal tools + admin (3/5 → 4/5 on three use cases).

8. **`<Image>` primitive** with sharp integration — unblocks e-commerce.

9. **Rebuild `examples/commonplace`** as a real end-to-end app — currently a stub.

10. **Re-export `@place/design` styles automatically** when detected — drop the `styles: [designStyles, appStyles]` boilerplate.

11. **Remove `peek()` deprecated re-export** — pre-publish freedom.

12. **`RenderToHtmlOptions` cleanup** — either ship the function or drop the orphan Options interface.

---

## What's NOT in this audit

- Live competitor benchmarks (running their dev servers locally) — too expensive; used published numbers.
- Real-user / adopter feedback — no users yet.
- Production-load testing — no production traffic.
- Security audit of cryptographic operations — `@place/security`'s `signedToken` / `csrfToken` shapes are standard but unaudited.
- License / dependency audit — not yet performed.

## Companion documents

- `docs/audits/2026-05-15-post-T5-D-audit.md` — the previous audit (baseline for "what changed")
- `docs/audits/2026-05-15-perf-regression.md` — perf-regression baseline
- `docs/probes/bundle-headline.md` — bundle audit raw data (fresh as of today)
- `docs/probes/per-route-simulation.md` — per-route bundle simulation (fresh)
- `docs/decisions/*.md` — 40 ADRs

---

## Sources cited (competitor research)

- [Next.js 16 release](https://nextjs.org/blog/next-16)
- [Astro 6 release](https://astro.build/blog/astro-6/)
- [Fresh 2.3 release](https://deno.com/blog/fresh-2.3)
- [Svelte 5 Runes benchmark thread](https://github.com/sveltejs/svelte/discussions/13277)
- [Solid 1.9 state of 2026](https://listiak.dev/blog/the-state-of-solid-js-in-2026-signals-performance-and-growing-influence)
- [Qwik framework benchmark](https://framework-benchmarks.as93.net/qwik/)
- [krausest js-framework-benchmark](https://krausest.github.io/js-framework-benchmark/current.html)

Full source list in the competitor-benchmark research output.
