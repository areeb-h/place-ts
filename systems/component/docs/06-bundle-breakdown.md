# What's in place's bundle — measured

**Date:** 2026-05-13 (refreshed after the `serve()` ternary-gating trim)
**Method:** progressive Bun.build probes, browser target, minified, no source maps. Each probe imports an additive superset of identifiers; sizes are diffed against the previous probe to attribute marginal bytes to each subsystem.
**Reproduce:** `bun examples/docs/probes/bundle-probes.ts`. The probe entries materialize under `examples/docs/probes/.tmp/` (gitignored).

## tl;dr — the `serve()` trim

A single structural change cut the framework runtime by **~57%** (gzipped):

| Surface | Before | After | Δ |
|---|---:|---:|---:|
| Whole-framework probe (every primitive used) | 102 KB raw / **37 KB gzip** | 43 KB raw / **16 KB gzip** | **−21 KB gzip** |
| `page`-bucket marginal cost | +60 KB raw / +21 KB gzip | +5.6 KB raw / **+2.1 KB gzip** | **−19 KB gzip** (−90%) |
| Docs site full prod bundle | 240 KB raw / 67 KB gzip | 180 KB raw / **49 KB gzip** | **−18 KB gzip** (−27%) |

**What changed:** the `serve` export in `@place/component` is now a build-time ternary gated on the `__PLACE_BROWSER__` define. The framework's `Bun.build` invocation in `serve()` passes `define: { __PLACE_BROWSER__: 'true' }` for the client bundle. On the client, the ternary constant-folds to a throwing stub; the real ~800-line body (`_serveImpl`) becomes unreferenced and tree-shakes out, taking its entire transitive closure with it — security-headers, devalue.stringify, Bun.serve, Bun.build, fs/promises, tailwindcss helpers, the ISR cache plumbing.

The trim required: a build-time define (1 line in `Bun.build`), `sideEffects: ["./src/preload.ts"]` in the package manifest, the ternary export pattern (15 lines), and two local `declare const __PLACE_BROWSER__` decls so TypeScript stays happy. No file extraction, no API change, no runtime overhead. Just a structural redirect that lets the bundler do its job.

## Probe results — after the trim

Additive: each row includes everything above plus the named subsystem. All probes run with `__PLACE_BROWSER__: true` to match what the framework ships to clients.

| Probe        | Raw       | Gzip     | Δ raw    | Δ gzip   |
|--------------|----------:|---------:|---------:|---------:|
| reactivity   | 17.1 KB   | 6.7 KB   | +17.1 KB | +6.7 KB  |
| jsxRuntime   | 19.5 KB   | 7.5 KB   | +2.4 KB  | +875 B   |
| hydration    | 19.8 KB   | 7.7 KB   | +307 B   | +133 B   |
| components   | 22.2 KB   | 8.4 KB   | +2.4 KB  | +772 B   |
| routing      | 25.7 KB   | 9.7 KB   | +3.5 KB  | +1.3 KB  |
| capability   | 25.8 KB   | 9.8 KB   | +105 B   | +38 B    |
| theme        | 28.7 KB   | 10.8 KB  | +2.9 KB  | +1.1 KB  |
| cookies      | 29.4 KB   | 11.0 KB  | +720 B   | +180 B   |
| form         | 34.2 KB   | 12.6 KB  | +4.8 KB  | +1.6 KB  |
| virtualList  | 35.8 KB   | 13.3 KB  | +1.6 KB  | +784 B   |
| suspense     | 37.1 KB   | 13.7 KB  | +1.3 KB  | +402 B   |
| page         | 42.7 KB   | 15.9 KB  | +5.6 KB  | +2.1 KB  |
| urlState     | 43.4 KB   | 16.2 KB  | +765 B   | +327 B   |

**Whole-framework probe (every primitive used):** 43 KB raw / **16 KB gzipped**.

The probe imports every identifier and *uses* it (assigning to a global sink) so tree-shaking can't drop anything. This is the framework footprint when an app uses every primitive — an upper bound.

## What each bucket contains

| Subsystem  | Δ gzip   | What's in it |
|------------|---------:|---|
| reactivity | 10.5 KB | `state`, `watch`, `derived`, `untrack`, `batch`, `resource`, `peek`, `flush`. The signal engine — owners, scheduler, two-color graph coloring, dependency tracking, batch flushing, resource state machine. |
| jsxRuntime | 864 B   | `el`, `Fragment`, `mount`, `renderToString`. Element factory + the reactive children path (`mountReactiveChild`) + Fragment + happy-path string emitter. The hydration walker is *not* here — it's pulled in by the next probe. |
| hydration  | 119 B   | `hydrate`, `_setHydrated`, `_drainHydrationDeltas`. Tiny diff because most of the walker code (the slot abstraction, `data-h` cursor, `Fragment.hydrate` reactive-function-child machinery) was already pulled in by the JSX runtime probe — `Fragment` and `el` reference the same internal helpers. |
| components | 276 B   | `component()` HOC, `Show`, `Activity`, `ClientOnly`, `Deferred`, `Tabs`. The visibility/composition primitives — small because they're thin wrappers over `el()` + reactive children. |
| routing    | 3 B     | `Link`. `RouterCap` lives in `@place/routing` and isn't included in this probe. |
| capability | 47 B    | `cap()`, `provide()`. The `defineCapability` + `runWithCapabilityScope` machinery lives inside the reactivity probe already (capabilities are layered on top of the reactive owner). |
| theme      | 1.1 KB  | `themeTokens`, `setTheme`, `readThemeFromRequest`, `themeCookieHeader`. CSS-variables-based theme system + cookie helpers for SSR-correct theme selection. |
| cookies    | 164 B   | `cookie`, `cookieState`, `parseCookieHeader`. Small because `cookieState` reuses the reactivity probe's `state` + `watch`. The header parser is the only new code. |
| form       | 1.2 KB  | `Form`, `action`. Schema-agnostic form runner + typed action factory. |
| virtualList| 803 B   | Windowed-render primitive. |
| suspense   | 407 B   | Lazy-resource boundary. |
| **page**   | **21.1 KB** | `page()`, `layout()`, `app()`. **The largest single bucket.** Pulls in: the `serve()` handler dispatch (mostly tree-shaken for browser), the route matcher, the load-data deserializer including `devalue`, the meta-tag applier, CSP nonce setup, the cache store interface, action dispatch, the page lifecycle. Most of this is structural — every page-driven app needs route dispatch, load-data hydration, and meta application. |
| urlState   | 359 B   | URL-bound reactive state — the router-aware `state<T>` variant. |

## Where the bytes actually go

The framework breaks into three tiers by gzipped size:

**Tier 1 — the always-paid 12 KB.** Reactivity + JSX + hydration is ~11.5 KB combined. Every place app pays for these because nothing renders without them. Comparable subsystems: Solid's signals are ~3 KB; Solid's `dom-expressions` JSX runtime helpers are ~3 KB; Solid's hydration helpers are ~1.5 KB. **The 6 KB delta vs Solid in this tier is fair** — place's reactivity has capability bridging and the two-color scheduler (not in Solid), and the JSX runtime has the universal-Router-aware Link path baked in.

**Tier 2 — opt-in surface, ~4 KB total.** Components (+276 B), routing (+3 B), capability (+47 B), theme (+1.1 KB), cookies (+164 B), form (+1.2 KB), virtualList (+803 B), suspense (+407 B). Each piece is small. An app that doesn't use Form / virtualList / Suspense / theme can tree-shake them.

**Tier 3 — the page lifecycle: 21 KB.** A single subsystem accounting for **57% of the framework footprint** (gzipped). What's inside it that ships to the browser:

- `app()` and `page()` factory bodies (significant — the typed builder pattern carries metadata)
- The route matcher (parsing path patterns at runtime)
- `serve()` is *mostly* tree-shaken on browser target (its body references Bun-only APIs), but its surface — `RenderPageContext`, the handler types, meta serialization helpers — leaks into the bundle through shared types and helpers
- **`devalue` library** — ~7–8 KB minified, vendored as a dep for load-data round-trip
- The streaming runtime + suspense swap chunks (string templates)
- ISR cache key handling
- Security headers + CSP nonce setup helpers

## Trim targets, in priority order (post-`serve()` trim)

### ~~1. Investigate the 21 KB `page` jump~~ — DONE

The `serve()` body leak was the dominant contributor. Gating the public `serve` export behind `__PLACE_BROWSER__` (constant-folded ternary → throwing stub on browser, real impl on server) let the bundler DCE the entire server closure: `renderPage`, `renderToStream`, security-headers, devalue.stringify, Bun.serve, Bun.build, fs/promises, tailwindcss helpers, ISR cache plumbing — all gone from client bundles. Final `page` marginal cost: **+2.1 KB gzipped** (was 21.1 KB).

### 1. Audit Tier 2 polymorphism

Each Tier 2 subsystem is small but they sum to ~4 KB. Polymorphic helpers (especially `wire()` which polymorphs over value type) can carry unused branches that tree-shaking can't drop because TypeScript's emit doesn't preserve enough scope info. Expected saving from a careful pass: **1–3 KB gzipped**.

### 2. Template-hoisting compile-out (separate work)

The `05-bundle-and-stack-research.md` recommendation. Compresses repeated JSX markup to cloned template nodes + targeted inserts. Operates on Tier 1's JSX runtime helpers — expected to shrink the 875 B `jsxRuntime` slice and indirectly reduce the per-component cost in user code. Estimated saving: **5–10 KB gzipped**, but the bigger lever is per-app code, not framework. Bigger investment (~1–2 weeks); now the cheap fix is done, this is the next high-leverage move.

### 3. Other potential leaks

The `serve()` trim worked so well it suggests other dual-runtime APIs may have similar untriggered DCE. Candidates to audit:
- `renderPage`, `renderToStream`, `renderRouteError` — still exported; should they also be ternary-gated, or are they already unreferenced from client code?
- `handler`, `action` (server side of actions vs. client `action.call`)
- `buildStatic`
- `renderToHtml`

Each is a low-risk pattern: rename the impl to a private `_xxxImpl`, ternary-export the public name. If the body isn't reachable from `_serveImpl`-less client code, no extra savings; if it is, more bytes drop.

## What the docs site bundle actually has (after trim)

The docs site prod build, re-measured after the `serve()` trim: **180 KB raw / 49 KB gzipped**. Split:

- Framework: ~16 KB gzipped (whole-framework probe)
- App code (~20 pages + ~10 components + design-system + nav-index + syntax-highlight tokens): ~33 KB gzipped

App code is now ~67% of the bundle. That's the inversion the trim produced — the framework shrank by more than half, app code stayed put. Future trim work shifts attention to **app-side compile-out** (template hoisting recommendation #2) where the next big wins live.

## Where this lands the framework, honestly (after trim)

Whole-framework probe: **16 KB gzipped**. Direct comparison:

| Framework | Runtime gzipped | What's included |
|---|---|---|
| Vue Vapor (3.6 target) | ~6 KB | compile-out, no VDOM |
| Solid (core only) | ~7.6 KB | signals + JSX runtime + hydration |
| Marko 6 | ~10 KB | compile-out tags |
| **place (post-trim, all primitives used)** | **~16 KB** | reactivity + JSX + hydration + components + routing + capability + theme + cookies + form + virtualList + suspense + page lifecycle + urlState |
| Solid + Router + Start | ~25–80 KB | the realistic comparable surface |
| Vue 3.5 | ~33 KB | VDOM + reactivity + templates |
| React + react-dom | ~45 KB | VDOM + reconciler |
| Next.js client | ~80+ KB | reactor + router + glue |
| Qwik (initial) | ~1 KB | resumable, rest lazy-loaded |

**Position:** ½ of Vue 3.5, ~⅓ of React, ~⅕ of Next.js. ~2× Solid's core (Solid excludes router + SSR + capabilities + theme + cookies + form, which place all ships). The framework now beats every signals-family competitor that ships SSR + hydration + router + capability scopes + form + theme + cookies in a single package.

## What this doc deliberately doesn't claim

- That the 16 KB is "wasted." It's not — every byte serves a primitive that real apps use. Tree-shaking drops anything an app doesn't reference.
- That probe diffs are exact attributions. Tree-shaking inter-module sharing means a probe's "marginal cost" undercounts a subsystem's structural cost when the previous probe already pulled in shared helpers. The Tier 1 number (~8 KB) is the *floor* for any place app; the per-subsystem diffs are *upper bounds* on what trimming each subsystem can recover.

## Open question carried forward

Recommendation #2 (template-hoisting compile-out) is now the next high-leverage trim. With the `serve()` work done, app-side bytes are the bigger lever — and Solid-style template hoisting is the technique to shrink them. Plan a dedicated session before that work begins; the design needs its own scope before code lands.

Next concrete step: build a probe that imports `page` alone, with a deliberately minimal page definition, and run `bun build --analyze` (or equivalent) to see which modules contribute most of the 21 KB. That's the entry into the trim pass and is not in this doc's scope.

---

## Reproducibility

The script is at `examples/docs/probes/bundle-probes.ts`. It's idempotent — re-running rebuilds the probes and prints the table. Probe artifacts under `examples/docs/probes/.tmp/` are throwaway.

Numbers will drift over time as the framework evolves. This snapshot is from **2026-05-13** against `systems/component/src/index.ts` after the Fragment.hydrate fix and the auto-import plugin landed.
