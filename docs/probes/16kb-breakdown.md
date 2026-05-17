# T5-A — Bundle audit: what's in the framework client runtime?

> Hand-maintained consolidated audit. Raw probe numbers in
> `docs/probes/bundle-headline.md`, refreshed by re-running
> `bun examples/docs/probes/16kb-breakdown.ts`.
> Per-source attribution in `docs/probes/source-attribution.md`.
> Per-route simulation in `docs/probes/per-route-simulation.md`.

## TL;DR — four findings that drive the plan

1. **The real number is 62 KB gzipped, not 16 KB.** Earlier figure was
   stale or from a synthetic probe. The docs app ships **62.20 KB
   gzipped** on every page today (after the T5-B-2 styles.ts leak fix
   shipped 2026-05-14; was 65.40 KB before that fix). This is
   10–20× the content-page floor competitors hit (Astro / Fresh /
   Enhance / 11ty: 0 KB; Svelte 5 / Solid full counter app: 3–7 KB).
2. **The bundle is dominated by every docs page's view code, not
   framework runtime.** Per-source attribution: ~120 KB raw of page
   view code shipping in the single shared bundle, plus 35 KB raw of
   `systems/component`, plus 9 KB raw of `systems/design`, plus 5 KB
   of `systems/reactivity`. **Every page downloads every other page's
   source.**
3. **Per-route bundle splitting alone delivers a ~68% reduction
   (65 KB → 20 KB average)** with zero other changes to the
   framework. This is the highest-ROI single intervention available
   and becomes T5-B-1.
4. **T5-B-2 shipped (1-day quick win).** Gating `styles.ts` exports
   behind `__PLACE_BROWSER__` removed 3.2 KB gzipped from the bundle
   immediately. Same pattern fixed the design library's styles.

## Headline numbers (latest)

| Probe | Raw | Gzipped | Notes |
|---|---:|---:|---|
| **docs app — current shared bundle** | **213.76 KB** | **62.20 KB** | After T5-B-2 styles.ts leak fix |
| docs app — auto-import plugin disabled | 213.77 KB | 62.20 KB | Plugin has zero net effect |
| synthetic — content-only page (static JSX) | 19.79 KB | 7.49 KB | Lower bound for a page with no signals/handlers |
| synthetic — renderToString import only | 2.83 KB | 1.50 KB | Tied to importing `renderToString` alone |
| synthetic — app() import only | 23.06 KB | 8.97 KB | `app()` adds serve/boot dispatch + routing glue |
| synthetic — state/watch/derived only | 6.33 KB | 2.64 KB | Signals primitive surface — irreducible reactive core |

## Per-source attribution (sourcemap-based, pre-T5-B-2)

Captured 2026-05-14 before the styles.ts leak fix landed.
Top buckets by raw bytes:

| Bucket | Raw bytes | ~Gzipped | % of bundle |
|---|---:|---:|---:|
| `systems/component` | 34.51 KB | 10.03 KB | 15.3% |
| `systems/design` | 8.61 KB | 2.50 KB | 3.8% |
| `systems/reactivity` | 5.21 KB | 1.51 KB | 2.3% |
| `systems/routing` | ~3.3 KB | ~1.0 KB | 1.5% |
| docs pages (sum of 21 pages) | ~120 KB | ~35 KB | **53%** |
| docs layout + components | ~15 KB | ~4 KB | 6.4% |
| `styles.ts` (CSS template literal!) | 10.13 KB | ~3 KB | 4.5% **[FIXED in T5-B-2]** |

**Single largest individual contributors** (pre-T5-B-2):

1. `systems/component/src/index.ts` — 16.58 KB raw
2. `examples/docs/src/styles.ts` — 10.13 KB raw *(NOW DCE'd by `__PLACE_BROWSER__`)*
3. `examples/docs/src/pages/api/design.page.tsx` — 8.54 KB
4. `examples/docs/src/pages/api/components.page.tsx` — 8.30 KB
5. `examples/docs/src/pages/index.page.tsx` — 8.29 KB
6. `examples/docs/src/pages/api/action.page.tsx` — 7.93 KB
7. `examples/docs/src/pages/api/page.page.tsx` — 7.61 KB
8. `examples/docs/src/pages/concepts/security.page.tsx` — 7.21 KB
9. `examples/docs/src/pages/concepts/ssr.page.tsx` — 6.84 KB
10. `examples/docs/src/pages/recipes/theming.page.tsx` — 6.74 KB

Every page module is 4–9 KB. With 21 pages, that's ~120 KB raw of page
view code shipped together. **This is the next biggest leak — fixed
by T5-B-1 per-route splitting.**

## Per-route simulation — what per-route splitting would buy us

Built each of the 25 pages as its own client entry, measured the
result (numbers pre-T5-B-2; expect 3 KB lower now per page):

| Statistic | Value |
|---|---:|
| Pages simulated | 25 |
| **Avg gzipped per page** | **20.48 KB** |
| Min gzipped | 17.78 KB (`recipes/index`) |
| Max gzipped | 23.67 KB (`api/design` — pulls in design library) |
| Current shared bundle | 62.20 KB (post-T5-B-2) |
| **Average win per page from T5-B-1** | **~42 KB gzipped (-67%)** |

Note: the simulation overestimates the win slightly because it
duplicates the layout chrome (search palette, sidebar, ToC) into every
per-route entry. A production splitter would emit:
- One shared chunk for layout + framework runtime (loaded once,
  cached across navigations)
- N small per-page chunks containing only the page's own view code

**Production splitting would do even better** than the 20 KB-per-page
number; the layout is amortized across navigations.

## Open-question answers

### Q1: What's in the bundle by module?

Pages: 53%. `systems/component`: 15%. `styles.ts`: 4.5% **[FIXED]**.
Everything else: ~27% (routing, reactivity, design, layout chrome).

### Q2: Does the auto-import plugin defeat tree-shaking?

**No.** Building with the plugin disabled saves ~5 bytes gzipped —
it's tree-shaking-safe in the docs app. The charter contradiction
(non-negotiable #7, "no compiler magic that hides intent") remains
philosophical; it's not a bundle-size problem.

### Q3: Per-route bundles or one shared bundle?

**One shared bundle.** `serve()` in `systems/component/src/index.ts`
line ~4882 calls `Bun.build({ entrypoints: [options.clientEntry] })`
exactly once at startup. **This is the root cause of the 62 KB floor.**

### Q4: Where are the unused-system leaks?

The 59.56 KB gap from "reactivity-only floor" (2.64 KB) to "full docs
bundle" (62.20 KB) is mostly:
- ~35 KB of docs pages' view code (53% of bundle) — fixable by
  T5-B-1.
- ~10 KB of framework systems (component / reactivity / routing) —
  largely necessary for interactivity; some helpers (form, action) only
  used by some pages → T5-E gating.
- ~3 KB of design library — only used by pages that import `<Card>`
  etc. → also T5-E.

## Side findings worth fixing

### Side finding 1: `styles.ts` (10 KB raw / ~3 KB gzipped) leak

**✓ FIXED (T5-B-2, 2026-05-14).** The docs app's `styles.ts` and the
design library's `styles.ts` both exported large CSS strings that
ended up in the client bundle. Gated both exports behind
`__PLACE_BROWSER__`; bundler DCEs the literals on browser builds.
Saved 3.2 KB gzipped immediately.

Pattern worth capturing in ADR 0022: "any module that exports
server-only data (CSS strings, build-time tokens, file paths) should
gate the export with `__PLACE_BROWSER__` so the data DCEs out on
browser builds."

### Side finding 2: `systems/component/src/index.ts` is 16.58 KB raw

This file is large because it's the framework's main barrel
(re-exports + top-level orchestration). Tier 1-A in the existing plan
(decompose into smaller modules) is still the right move; even if not
strictly necessary for bundle size, it improves maintainability and
might surface latent dead-code opportunities.

## Plan correction — what we did with these findings

The original Tier 5 cuts (T5-B "per-system gating", T5-C "islands")
missed the biggest single win: **per-route bundle splitting**.

Updated ordering + status (now reflected in the main plan file):

| Cut | What | Effort | Status | Target | Actual |
|---|---|---|---|---|---|
| **T5-A** | Bundle audit | 1 day | ✓ DONE | Numbers in this doc | 65.40 KB measured |
| **T5-B-2** | `styles.ts` leak fix | 1 day | ✓ DONE | -3 KB on every page | 65 KB → 62.20 KB |
| **T5-B-1** | Per-route bundle splitting | 1 day (vs 1–2 weeks est.) | ✓ DONE | 62 KB → ~17–20 KB per page | **62 KB → 14 KB avg (-77%)** |
| **T5-C** | Islands primitive (MVP) | 1 day (vs 6–10 weeks est.) | ✓ DONE | content pages → 0 KB | **0 KB / 7.64 KB per island** |
| **T5-C polish** | hydrate() + 4 mount strategies (load/idle/visible/interaction) | 1 day | ✓ DONE | no first-paint flash + lazy mounting | island bundle 10.35 KB |
| **T5-E** | Per-system gating (audit + dynamic-import bundlers) | 1 day | ✓ DONE | trim per-island bundles | **island 10.35 KB → 8.35 KB (-19%)** |
| **T5-D phase 1** | Splitting:true for island bundles + ThemeToggle migration | 1 day | ✓ DONE | shared chunks across islands | **per-island marginal cost: ~952 B gzipped (was ~10 KB)** |
| **T5-D phase 2** | Migrate remaining docs chrome (MobileNav, SearchPalette, ToC) | 1 session | pending | retire clientEntries for docs | TBD |
| **T5-F** | Auto-import plugin resolution | 1 day | pending | charter alignment | TBD |

### T5-B-1 result (measured 2026-05-14, post-implementation)

After implementing the route splitter and wiring `clientEntries` into
the docs app's `app()` config:

| Statistic | Pre-T5-B-1 | Post-T5-B-1 |
|---|---:|---:|
| Average bundle per route | 62.20 KB | **14.01 KB** |
| Min bundle | 62.20 KB | 10.12 KB (`/examples`) |
| Max bundle | 62.20 KB | 17.33 KB (`/api/design`) |
| Reduction | — | **-77%** |

The implementation uses one `Bun.build` per route entry (no `splitting:
true`) — each route's bundle is self-contained. Acknowledged trade-off:
framework runtime is duplicated across per-route bundles. For an HTML-
first framework where users land on specific URLs (server-rendered HTML
+ no client-side router), this is the correct shape. Bun's `splitting:
true` was tried first and produced 30 small shared chunks totaling
72 KB on first load — strictly worse than the single-bundle baseline.

The win compounds with browser cache (per-route bundles get
content-hashed in prod and cache forever via `immutable` headers).

### T5-C result (measured 2026-05-14, post-implementation)

Implemented per-ADR-0019: typed `<Island>` primitive + `islands`
registry + per-island bundle builder. Verified end-to-end via
`bun examples/docs/probes/verify-t5c.tsx`:

| Page shape | JS shipped |
|---|---:|
| Page with **NO** `<Island>` element | **0 bytes** (no `<script>` tag emitted) |
| Page with 1 `<Island name="Counter">` | 7.64 KB gzipped (just the Counter island's auto-mount bundle) |
| Page with 3 `<Island>` elements | 3× bundle URLs emitted; browser fetches each in parallel |

Compare to baseline + intermediate cuts:

| State | Content page floor |
|---|---:|
| Pre-T5 (single shared bundle) | 65.40 KB |
| Post-T5-B-2 (styles leak fixed) | 62.20 KB |
| Post-T5-B-1 (per-route splitting) | 14.01 KB avg |
| **Post-T5-C (islands)** | **0 KB if no `<Island>`, 7.64 KB per island otherwise** |

The competitive picture (T5 research baseline):
- Astro / Fresh / Enhance / 11ty: 0 KB floor — **we match this now**
- Svelte 5 full counter app: 3–5 KB — **we're 2× this per island**
- SolidStart counter: 5–7 KB — **we're competitive**

The remaining gap (place's 7.64 KB per island vs Svelte's 3–5 KB) is
framework-runtime weight, which T5-E (per-system gating) will trim
further.

## Follow-on probes (worth writing later)

- **System-ablation probe.** Rebuild with each system aliased to an
  empty module; size delta = "how much that system contributes."
  Would refine the per-system gating scope (T5-E).
- **Real production per-route simulator.** Mimic the production
  splitter: a shared chunk for layout + framework + N per-page
  chunks. Measures the actual amortized win after T5-B-1.
- **Pre-hydration runtime audit.** What does the framework client
  runtime ACTUALLY need to do before any user JS? If "very little,"
  islands' mount script can be that small.

## ADR follow-ups (numbering after T5)

- **ADR 0018** "Per-route bundle splitting" (T5-B-1, in progress)
- **ADR 0019** "Typed islands, not string-directives" (T5-C)
- **ADR 0020** "Retire full-page hydration" (T5-D)
- **ADR 0021** "Per-system import-graph gating" (T5-E)
- **ADR 0022** "Server-only exports via `__PLACE_BROWSER__` gating"
  (T5-B-2, ✓ shipped — pattern documented)
- **ADR 0023** "Auto-import plugin charter resolution" (T5-F)
