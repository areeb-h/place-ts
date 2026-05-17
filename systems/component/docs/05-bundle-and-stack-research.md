# Research: bundle floor for place's runtime, and the non-JS stack question

**Date:** 2026-05-13
**Time spent:** ~2 hours
**Depth:** standard

## Sources consulted

See bottom of doc for the full list (grouped by topic). Inline citations are abbreviated by domain.

## Context recap (numbers we start from)

- place prod runtime: **~50 KB gzipped** framework, ~17 KB app, total 67 KB
- Solid baseline: **~7.6 KB gzipped** minified core (`solid-js` npm package, TodoMVC ship size)
- Vue 3.5 vDOM runtime: ~33 KB; Vue Vapor (3.6 beta): ~18 KB now, ~6 KB target once full Vapor strips `@vue/runtime-*`
- Marko 6 client runtime: ~10 KB compressed (production at eBay)
- Brisa: 0 B baseline, 2 KB with server actions, 3 KB with web components
- Qwik: ~1 KB *initial* (the rest lazy-loads on interaction; steady-state JS post-interaction is not 1 KB and is shaped by code-split design choices, not bundle math)
- Rust/WASM frameworks (Leptos, Yew, Sycamore): the Wasm payload alone is typically several hundred KB before the runtime is included; framework authors openly trade bundle size for memory/perf within Wasm
- TinyGo→Wasm: smallest hand-tuned hello-world ~300 KB, realistic frontend ~400 KB–1 MB
- esbuild's whole point in Go: ~10–100x speed via parallelism + native code + compact memory layout; *not* a bundle-size argument

## A. Bundle-reduction techniques (JS-first authoring)

### A1. The "what's in place's 50 KB" question

Solid's 7.6 KB consists almost entirely of (a) the reactivity engine (`createSignal`/`createEffect`/`createMemo`/owner/scope/batching), (b) the *compiled-output runtime helpers* from `dom-expressions` (`template`, `insert`, `setAttribute`, `effect`, `delegateEvents`, `spread`), and (c) hydration glue. There is no router, no SSR primitive, no capability layer, no error boundary inside the 7.6 KB number — those are separate packages users pay for à la carte.

place's 50 KB ships:
- reactivity (signals, derivations, owner, scheduler, capability bridge)
- JSX runtime (`el`, `Fragment`, list reconciliation `keyed`, bindings)
- hydration (`hydrate`, `data-h` walker, `<Static>`, `Fragment.hydrate`)
- component HOC + `errorBoundary` + `withCapability(ies)`
- `wire`, `cls`, `onKey`, `globalKey`, `urlState` ergonomics
- `page`, `boot`, server primitives' *client-facing* portion (hydration data parser, meta apply)
- the routing matcher pulled in by `page()`

Honest estimate (no measurement, structural):
- reactivity: ~6–9 KB
- JSX runtime + list keyed: ~8–12 KB
- hydration walker + Fragment markers: ~6–10 KB
- error boundary + capability + HOC: ~3–5 KB
- form/ergonomics surface (`wire`/`cls`/`onKey`/`globalKey`/`urlState`): ~5–8 KB
- page/boot/meta/route-matcher pulled by `page()`: ~6–10 KB
- shared util (escape, props normalize, types runtime): ~3–5 KB

The gap to Solid is **structural, not waste**. Solid's 7.6 KB does not include hydration walker, error boundary, capability scopes, two-way wire, page/boot, or a route matcher. Once you add those to Solid via `solid-router` + `solid-start` + user code, real Solid apps land in the 25–80 KB range too (Radware report). The "Solid is 7 KB, place is 50 KB" comparison is **apples-to-oranges by category, not by quality**. The honest target is "everything in place's surface, but tighter than today."

### A2. Tree-shaking / `sideEffects: false`

Real verdict: `sideEffects: false` *matters* but is fragile. Svelte issue #16120 — accessing a property of an imported object inside a reactive statement retains the whole object. Rollup tree-shakes only when the bundler can prove no side-effect. place's surface today has at least three known sub-shake-resistant patterns to audit:
- ergonomic re-exports (the `@place/component` barrel)
- `wire()` polymorphism over value types (each branch may pull in helpers regardless of usage)
- `serve({ tailwind: true })` — already correctly tree-shaken because Tailwind helpers are a peer dep, but worth confirming

Impact: probably 3–8 KB gzipped if barrel exports and polymorphism branches are inspected. Worth doing. Won't change the order of magnitude.

### A3. Lazy-loading framework primitives

No production framework with a coherent type story lazy-loads its core primitives behind dynamic imports. Solid's `Suspense`, Vue's `Suspense`, Qwik's resumability — all are tree-shaken statically, not late-loaded. Reasons: (a) async-loading reactivity primitives breaks `createMemo` ergonomics; you can't `await` a fundamental; (b) hydration must be synchronous or you get FOUC/event-drop; (c) types pulled in regardless cancel most of the win.

Where it *does* work: features that already have an async surface, e.g. virtual lists, route-level pages, modal/portal helpers, and *non-reactive* utilities like animation libs. place's `<Static>` is already in this category by design.

Verdict: skip for the runtime core; apply to optional high-cost helpers if any emerge later (none today).

### A4. Route-based code splitting

Real wins, but charged a per-route framework runtime tax. Next.js client overhead per route is well-documented in the 80–100 KB range. Solid Start splits more aggressively, ~3–6 KB per route over baseline. The win for place is *app-level*, not framework-level: route-split user code, not framework code. The framework runtime is already singleton in the entry chunk. Worth doing for the docs app once it grows past 2–3 routes; meaningless today (one-page docs).

### A5. Compile-out reactivity (Svelte model, post-runes)

Status: settled. The 2026-05-12 directive-first research (`04-directive-first-research.md`) already documented Svelte 5's regret pattern and concluded against template-magic compile-out. Vue Vapor — the *one* non-template approach that's working — keeps SFC syntax but drops vDOM by compile-out. Vapor's win is ~15 KB gzipped vs Vue 3.5 by *replacing* the vDOM runtime, not by adding compiler magic. Solid's `babel-plugin-jsx-dom-expressions` already does exactly the move Vapor is doing: it compiles JSX into direct DOM ops + signal effects, and the *runtime helpers* total ~5 KB on top of `solid-js`'s reactivity core.

place's JSX already uses a `bun-plugin-solid`-shaped pipeline (auto-import landed last session). The compile-out path **is the path place is already on**. The improvement is to push more inline at compile time:

- inline static fragments as cloned `<template>` nodes (Solid `template()` style)
- collapse `el('div', { class: 'x' }, ...)` calls with no reactive bindings to native `createElement` + `cloneNode`
- elide `effect()` wraps around statically-known props
- drop `keyed()` overhead when the compiler can prove the children list is static

These are not Svelte-walkback patterns; they are inlined runtime calls with a 1:1 source mapping, fully debuggable, no new variable scopes introduced. Charter-compatible (non-negotiable 7 holds: the compile-out is transparent and inspectable, not magic).

Estimated saving: 5–10 KB gzipped if a Solid-style template hoisting pass lands. This is the **single highest-leverage** size optimization on the table.

### A6. Type-info-driven DCE for server-only branches

Precedent: very thin. tRPC and Hono use type-only tricks for client/server boundaries. No production framework I found uses TypeScript's emitted type info to drive dead-code elimination beyond type-only imports. Reason: Rollup/esbuild can't see types; the type checker doesn't emit DCE hints; integrating tsc as a build step is slow.

place's `page()` already separates server-only (`load`, `headers`) from client-shared (`view`, `meta`, `styles`) at the *value* level. The structural-not-string-marker approach (charter commitment 3) means esbuild already DCEs server-only branches because they're behind module boundaries (`server.ts` vs the client bundle entry). No type-info pass needed. Verdict: settled.

### A7. JSX-to-direct-DOM compiler (Solid model) for place specifically

Solid's `babel-plugin-jsx-dom-expressions` is the *exact* template for what place's compiler should do. Output shape per template: a `template("<div class=foo><!></div>")` clone call, plus `_$insert(_$el$, props.x)` calls for reactive holes. Runtime cost: `template`, `insert`, `effect`, `setAttribute`, `delegateEvents` — sub-5 KB total.

If place adopts the same shape, current `el(tag, props, children)` calls become hoisted template clones + targeted inserts. Bundle implication: most of the JSX-runtime portion (~8–12 KB est) compresses heavily because static markup becomes string literals (Brotli/gzip eat repeated HTML), and the runtime helpers fall to ~3–5 KB.

This is the recommendation centerpiece.

## B. Non-JS runtimes / build tools

### B1. esbuild (Go) — the only honest precedent

Wallace's "10–100x" speedup comes from Go's parallelism-by-default + native code + compact memory layout. Adopted by Vite (deprecated for Rolldown), tsup, Bun (Bun uses Zig for its own bundler), Shopify. Relevant lesson: **non-JS pays off in build tools where parallelism dominates**. The directive-transformer and auto-import plugin are I/O-fast AST passes today; rewriting in Go buys little because Bun's transform pipeline is already Zig-fast at the parse layer, and the work places does on top is small.

Verdict: **skip Go for build tools.** Bun's transformer + a TS-native plugin layer is the right home. If a future stage has heavy AST work (e.g., the template-hoisting compiler from A7), the right answer is to do it in TS for transparency and lean on Bun's native parse output — not to introduce a second language.

### B2. TinyGo → Wasm frontend

Real numbers: hello-world ~300 KB Wasm; importing `fmt` adds ~400 KB. Realistic frontend-shaped app: 800 KB–1.5 MB Wasm. Even compressed (Wasm gzips ~50–60%), that's 400–800 KB on the wire. No production frontend framework ships TinyGo→Wasm.

Verdict: **skip.** Order of magnitude worse than current state. The 50 KB problem doesn't get solved by a 400 KB Wasm runtime.

### B3. Rust → Wasm (Leptos / Yew / Sycamore)

Leptos is the closest-architecturally to Solid (fine-grained signals, no vDOM, run-once components). Authors openly trade bundle size for runtime perf inside Wasm. Realistic Leptos app: 200–500 KB Wasm. Adoption is real (Rust shops) but the audience does not overlap with place's. Charter audience 2 (solo/small-team TS builders) excludes "user must write Rust to use the framework."

Verdict: **skip.** Wrong language for the authoring model.

### B4. AssemblyScript (TS-shaped → Wasm)

Generates smaller binaries than Rust→Wasm (small static-CPU-bound functions can be tens of KB), but JS↔Wasm boundary cost is real: every DOM operation crosses the boundary, every signal read/write crosses the boundary, strings copy linear memory. Surma's "Is Wasm magic pixie dust?" essay (dated, still load-bearing) showed Wasm losing to JS on string-heavy workloads because of marshaling. A reactivity engine is pointer-chasing + small allocations + frequent DOM calls — the *worst* workload for Wasm.

Verdict: **skip for the reactivity engine.** Possibly useful for a hypothetical CPU-bound primitive (e.g. CRDT merge, full-text indexing) — outside this system.

### B5. Zig

Bun uses Zig. No frontend runtime ships Zig→Wasm in production. Same boundary-cost story as B4. Zig's appeal is "tight binary control without GC" — irrelevant when the host (JS VM) already has GC and you have to interop with it.

Verdict: **skip.**

### B6. Wasm for reactivity specifically (Brisa's bet)

Brisa ships a Wasm signals runtime as one of its options. Marketing claim: 3 KB total with web components. Honest size: Brisa's Wasm is small *because* the surface is small (Web Components host most of the rendering). The Wasm carries signal primitives only; render is native DOM via custom elements. This is a structurally different bet than "compile the whole runtime to Wasm." It's "Wasm as a glue tier for a tiny number of cold operations."

Verdict for place: **not now**, but worth keeping a tab open. The blocker is cold-start: parsing/instantiating Wasm has a fixed cost (single-digit ms on desktop, 30–100ms on low-end mobile) that a 6 KB JS reactivity engine doesn't pay. For a graph-observable, time-indexed, capability-routed reactivity layer that wants to be inspectable in dev tools, native JS is also massively easier to introspect. Wasm closes the door on the charter's "graph is observable" non-negotiable unless we re-export every internal as JS.

### Cross-cut verdict for non-JS runtimes

The Wasm cold-start cost defeats the size win **at place's current scale**. A 50 KB JS bundle parses+executes in 5–15ms on a modern phone. A 30 KB Wasm bundle + 10 KB JS shim parses+instantiates in 30–80ms and pays a per-call FFI tax forever. There is no scenario in the 50→20 KB range where Wasm wins. The size win only materializes for *much larger* runtimes (200 KB+), which place is structurally not going to have.

## C. Radical architectural bets

### C1. Qwik resumability

Real verdict (filtered): the "~1 KB initial" is honest *for the initial document*. After meaningful interaction, the lazily-loaded segments aggregate to numbers comparable to other frameworks; Qwik's win is on *first interactive*, not *steady-state JS*. Critics consistently flag the "code-split waterfall" risk: many small JS chunks fetched sequentially can be slower than one medium bundle. Adoption: Builder.io ships it for their drag-and-drop editor. Niche, not mainstream.

Relevant to place: the *resumability mechanism* (serialize the running app, restore on client) is structurally close to the charter's "graph at tick T → serialize → restore." This is **the deepest connection in this entire research**. Whether place wants Qwik-style resumability is a v0.5+ question, but worth a separate research pass before SSR streaming lands.

### C2. Phoenix LiveView / Hotwire / Inertia / Datastar

Server-rendered + minimal client. Real production: LiveView 1.0 (Dec 2024), 1.1 (2025), used at scale for dashboards, admin tools, CRUD. Honest break points (DevBrett, Hanso Group write-ups): patchy connectivity, drag-and-drop, complex canvas, anywhere a sub-100ms response without a WS round-trip matters. Datastar is the most relevant — signals + SSE + DOM patches. Still niche; signals are the wire format, not the authoring model.

place is local-first by charter non-negotiable 6. Server-roundtrip-per-interaction is **structurally incompatible** with local-first. Verdict: skip as the *core* model; the SSR layer place has already shipped is the correct compromise.

### C3. Astro islands

Real bundle savings: 50–70% smaller JS for content-heavy sites (Smashing). Mechanism: each island pulls its own framework runtime, but pages without interaction pull zero. Composes badly with cross-island state (signals shared across islands need explicit wiring).

place's `<Static>` is the inverted version (default-hydrate, mark-static). Same delivery model from the other end. For a docs site where most content is static, `<Static>` should already win the same savings. Verdict: settled — the technique is in place's surface already; just use it more.

### C4. Brisa.build

Covered in B6. Surface: Web Components + Signals + Server Actions. The 3 KB number is real *for the surface they offer*. Lessons for place:
- Web Components as a hydration target is interesting (browser handles a chunk of the lifecycle)
- but place's `el()`/JSX runtime is not Custom-Elements-shaped, and retrofitting would break the component-charter's "components are functions" commitment

Verdict: skip the framework, watch the bundle technique.

### C5. Marko 6

Carniato's "Future of Marko" + the Tags API preview: Marko has been rewritten around composable tags, removing the templating-language-plus-bolted-component-API split. Runtime ~10 KB at production scale (eBay homepage). The most relevant precedent for "compile-time analysis enabling small runtime." Lesson: composability *of the authoring surface* is the precondition for the compiler to strip statics. Marko's gain came from making everything a tag so the compiler sees one shape.

place's authoring surface (JSX + functions returning Views + reactive bindings) is already uniform. The compiler has the same lever available. This *reinforces* A7 as the recommendation.

### C6. HTMX + signals

Theoretically interesting. No production framework combines them. HTMX's own essay ("htmx sucks") and the HN critique flag that out-of-band updates fight with optimistic client state. place's data system + reactivity is the structural answer to the same use case without the wire-format coupling. Verdict: skip.

## Cross-cutting answers (direct)

- **Ceiling vs Solid:** structurally 15–25 KB gzipped is achievable for place's *current surface* with A7 (compile-out templates) + A2 (audit barrel + polymorphism). Below 15 KB requires removing surface (e.g., `wire`, `urlState`, `errorBoundary`) or moving it to opt-in packages. **Not a target by charter — bundle is a constraint, not a goal.**
- **Realistic 50 KB split:** see A1. Largest single bucket is JSX runtime (~8–12 KB) — exactly the bucket A7 attacks.
- **Go-based compiler-for-place:** no. The compiler is small AST work over typed inputs and runs once per build. Bun's TS-native plugin pipeline is the right home. The author/AI-debuggability cost of introducing Go for a few hundred lines of compiler logic exceeds the speed benefit.
- **Wasm reactivity engine:** no. Cold start (30–80ms low-end mobile) defeats the size win at place's scale. Also closes the "graph is observable" door unless re-exported.

## What to avoid (filtered)

- Marketing the savings before A7 actually ships — see the directive-first research's lesson on "selling smaller bundle when actual saving is two-digit bytes."
- Introducing a second build language to chase build speed Bun already gives us. esbuild's win does not transfer to a project Bun-native at the parse layer.
- Reactivity-in-Wasm before there is a measured performance problem in JS reactivity. There isn't one today.
- Lazy-loading core primitives. No coherent framework does this.

## Concrete recommendation, sorted by impact-per-engineering-effort

| Rank | Action | Est. saving | Est. effort | What we'd give up |
|---|---|---|---|---|
| 1 | **Template-hoisting compile-out (A7)** — extend the Bun plugin so JSX with static markup compiles to `template()` clone + targeted `insert()` calls; collapse no-binding `el()` calls to native DOM ops; elide `effect()` around statically-known props. | 5–10 KB gzipped | 1–2 weeks (one focused stretch); reuses `bun-plugin-solid` shape; no new build language | Some debugger fidelity at template-clone sites (mitigatable with source maps). Charter-safe: output is inspectable, no new variables introduced. |
| 2 | **Barrel-export + polymorphism audit (A2)** — split `@place/component` exports so unused ergonomics (`wire`/`urlState`/`globalKey`) tree-shake cleanly. Confirm `sideEffects: false` is honest. | 3–8 KB gzipped | 2–3 days | Slightly less convenient single-import surface. Mitigate with a re-export barrel that is itself marked side-effect-free. |
| 3 | **Route-based code-splitting for user code only (A4)** — leave framework as singleton entry chunk; split per-page user code. | 0 today, 10–30 KB per non-active page once docs grow | 1 day after multi-page docs land | Nothing today (one-page docs). Defer until justified. |
| 4 | **Document the "what's in 50 KB" breakdown** — Make the structural-vs-waste split explicit in component-system docs so future contributors don't chase Solid's 7.6 KB number. | 0 KB; saves rework | half a day | Nothing |
| 5 | **Watch list, do nothing yet:** Vue Vapor 3.6 stable, Marko 6 stable release, Qwik-style resumability for v0.5 SSR work, Brisa's Wasm-signals approach if cold-start tooling improves. | n/a | n/a | n/a |

**What we explicitly do *not* recommend:**
- Go for the build pipeline (esbuild lesson does not apply to place)
- Rust/TinyGo/Zig→Wasm for any runtime layer (cold start defeats size win)
- AssemblyScript for reactivity (JS↔Wasm boundary cost on small-allocation pointer-chasing workloads)
- Compile-out template-magic of the Svelte 4 / proposed-directive variety (see `04-directive-first-research.md`)
- LiveView/Datastar-style server-roundtrip-per-interaction model (violates local-first non-negotiable)

## Open questions raised

- A7's actual saving depends on the static/reactive ratio in real place apps. The commonplace-book demo is the only realistic measurement target. Worth instrumenting before committing the compiler work.
- Qwik-style resumability ↔ "graph at tick T → serialize → restore" deserves a dedicated research pass before v0.4 streaming work. The connection is structural and might change the SSR plan.
- Whether the future "graph is observable" devtool wants the reactivity engine to retain its current introspectable JS form, or whether a dual-mode (JS for dev, compile-out for prod) makes sense. Open.

---

## Sources consulted (grouped)

### Solid / dom-expressions
- [Solid hydration system (DeepWiki)](https://deepwiki.com/solidjs/solid/5.2-hydration-system) — confirms run-once + reactivity-graph-rebuild during hydration
- [babel-plugin-jsx-dom-expressions repo](https://github.com/ryansolid/babel-plugin-jsx-dom-expressions) — the template the recommendation centers on
- [dom-expressions repo](https://github.com/ryansolid/dom-expressions) — runtime helper structure
- [Comparing React, Solid, and Qwik 2025 (c-sharpcorner)](https://www.c-sharpcorner.com/article/comparing-react-solid-and-qwik-performance-in-2025/) — 7 KB number sourced
- [SolidJS pain points (Medium)](https://vladislav-lipatov.medium.com/solidjs-pain-points-and-pitfalls-a693f62fcb4c)

### Vue Vapor
- [vuevapor.watch](https://vuevapor.watch/) — live 10 KB target tracker
- [Vue.js Nation 2025 — Vapor talk recap (Vue School)](https://vueschool.io/articles/news/building-vues-high-performance-future-vapor-mode-insights-from-rizumu-ayakas-vue-js-nation-2025-talk/)
- [Vue 3.6 Vapor mode (jeffbruchado)](https://jeffbruchado.com.br/en/blog/vue-36-vapor-mode-performance-revolution-2026) — 33 KB → 18 KB number sourced

### Marko 6
- [The Future of Marko (eBay Tech)](https://tech.ebayinc.com/engineering/the-future-of-marko/)
- [Introducing the Marko Tags API Preview (Carniato)](https://dev.to/ryansolid/introducing-the-marko-tags-api-preview-37o4)
- [Marko Tags API reference (HackMD)](https://hackmd.io/@markojs/S1gXsc1v3)

### Qwik
- [Qwik resumable concepts](https://qwik.dev/docs/concepts/resumable/)
- [Resumability vs hydration (Builder.io)](https://www.builder.io/blog/resumability-vs-hydration)
- [Resumable JavaScript with Qwik (DEV)](https://dev.to/this-is-learning/resumable-javascript-with-qwik-2i29)
- [JS framework reality check (The New Stack)](https://thenewstack.io/javascript-framework-reality-check-whats-actually-working/) — production-adoption claims filtered

### Astro / partial hydration
- [Astro islands docs](https://docs.astro.build/en/concepts/islands/)
- [Islands architecture (patterns.dev)](https://www.patterns.dev/vanilla/islands-architecture/)
- [Astro island architecture (SoftwareMill)](https://softwaremill.com/astro-island-architecture-demystified/)

### Brisa
- [Brisa.build](https://brisa.build/)
- [Introducing Brisa (DEV)](https://dev.to/aralroca/introducing-brisa-full-stack-web-platform-framework-2lm1)
- [Brisa Show HN](https://news.ycombinator.com/item?id=41749121)

### Phoenix LiveView / hypermedia
- [Phoenix LiveView GitHub](https://github.com/phoenixframework/phoenix_live_view)
- [Choosing Phoenix LiveView (DevBrett)](https://devbrett.com/2025/11/choosing-phoenix-liveview/) — the honest-limits write-up
- [LiveView best practices (Hanso Group)](https://www.hanso.group/weblog/phoenix-liveview-best-practices)
- [Datastar](https://data-star.dev/)
- [Datastar first impressions (Chris Malek)](https://chrismalek.me/posts/data-star-first-impressions/)

### Rust / Wasm frameworks
- [Leptos repo](https://github.com/leptos-rs/leptos)
- [Leptos vs Yew vs Dioxus 2026 (Reintech)](https://reintech.io/blog/leptos-vs-yew-vs-dioxus-rust-frontend-framework-comparison-2026)
- [Rust frontend framework comparison (flosse)](https://github.com/flosse/rust-web-framework-comparison)

### TinyGo / AssemblyScript / Wasm cost
- [TinyGo WebAssembly guide](https://tinygo.org/docs/guides/webassembly/wasm/)
- [Shrink TinyGo Wasm modules (Fermyon)](https://www.fermyon.com/blog/optimizing-tinygo-wasm)
- [TinyGo issue #2641 — Wasm size](https://github.com/tinygo-org/tinygo/issues/2641)
- [Minimizing Go Wasm binary size (Bitolog)](https://dev.bitolog.com/minimizing-go-webassembly-binary-size/)
- [AssemblyScript FAQ](https://www.assemblyscript.org/frequently-asked-questions.html)
- [Is Wasm magic pixie dust? (surma.dev)](https://surma.dev/things/js-to-asc/) — the JS↔Wasm boundary cost study

### Bundler / compiler tools (Go / Rust)
- [esbuild GitHub](https://github.com/evanw/esbuild)
- [esbuild architecture (codedamn)](https://codedamn.com/news/javascript/a-deep-dive-into-esbuild-s-architecture-and-speed)
- [Oxc — JS Oxidation Compiler](https://oxc.rs/)
- [Oxc benchmarks](https://oxc.rs/docs/guide/benchmarks)

### Tree-shaking pitfalls
- [Svelte issue #16120 — tree-shake fails for imported objects in reactive statements](https://github.com/sveltejs/svelte/issues/16120)
- [Smashing — tree-shaking reference guide](https://www.smashingmagazine.com/2021/05/tree-shaking-reference-guide/)
- [Rollup issue #551 — tree-shaking and side-effects](https://github.com/rollup/rollup/issues/551)
