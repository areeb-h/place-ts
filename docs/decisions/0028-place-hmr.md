# ADR 0028: Place HMR — typed-island boundaries, effect-aware state preservation

**Status:** superseded by [ADR 0043](0043-hmr-per-island-swap.md) (2026-05-16)
**Date:** 2026-05-15
**Affects:** `systems/component/src/__hmr.ts` (shipped via 0043); `systems/component/src/build/island-bundler.ts` (HMR-dispose hooks shipped); per-island WebSocket swap protocol shipped.

> **Inventory note (2026-05-21).** ADR 0043 ("Tier 15-E phase 2 — typed-envelope HMR + per-island module swap") landed the design this ADR proposed. `__hmr.ts` implements the hello / swap / reload protocol; `island-bundler.ts` emits the per-island disposer registry; the shared `window.__placeIslandRegistry` lets new bundles tear down live mounts before injecting. The signature-hashing detail from this ADR's Section 5 was simplified to content-hashed URLs (the bundler already produces them); HMR detects rebuilds via WebSocket push, not file-watching, so the "bun --watch" startup-path change was unnecessary. Read 0043 for the shipped design.

## Context

Dev iteration today is `bun --watch src/app.ts` which **restarts the whole process** on every file change. Median latency from save → page-ready is **800-1500 ms** measured on the docs site. Vite hits 100-200 ms on a comparable app; Turbopack hits 80-340 ms (yyx990803's [vite-vs-next-turbo-hmr](https://github.com/yyx990803/vite-vs-next-turbo-hmr/discussions/8) benchmark). We are 4-10× slower than the state of the art.

Three structural assets the incumbents don't share let us aim *lower* than 100 ms:

1. **Signals are stable object references owned by the parent scope.** A render-fn swap doesn't touch the cell. Solid loses descendant state because it allows signal creation inside the swapped body and can't re-key it ([solid#2419](https://github.com/solidjs/solid/issues/2419)). React's Fast Refresh requires hook-call-order to be byte-identical because hooks' identity is positional. place-ts puts the signal in the *island scope* — outside the swappable body.
2. **`island(import.meta.url, fn)` is the typed boundary** the framework already uses for code splitting. Every island has a manifest entry; every island has a chunk URL. The "what subtree does this edit affect?" question is answered at build time. No tree-walk, no Babel registration sweep.
3. **Capability-typed effects** mean the cap object identity persists across swaps. An `effect.fetch` handler swap doesn't recreate the cap, only swaps the impl table entry. React's hook-signature contract becomes a *type* contract for us.

We're also pre-publish, so we can require the typed boundary form (no string `import.meta.hot.accept(...)` literal-match contract Vite carries forward from webpack).

## The decision

Adopt a typed-boundary HMR model that swaps **per island** and preserves state owned by the parent scope. Build-time signature hashing makes "what changed structurally vs cosmetically" a single type-level question. Runtime is a WebSocket on `/_place/hmr` with a typed envelope. Production builds DCE the HMR runtime to zero bytes.

## Design

### Boundary: the island module

Smallest swappable unit = a module whose default-or-named export is wrapped in `island(import.meta.url, fn)`. The build emits one chunk per island already; the dev server reuses the same chunk graph.

Non-island modules (utility helpers, server-only code) bubble up to their nearest island importer. If a util used by `Counter` changes, `Counter`'s chunk re-bundles, the swap targets `Counter`.

Pages without islands are static HTML; a page-only edit triggers server-side re-render and a WS-pushed full-page swap (no JS state to preserve).

### Wire format

WebSocket at `/_place/hmr`, one connection per tab. Typed envelopes both directions; Zod-validated so the protocol surface is observable per charter #7.

```ts
type ServerMsg =
  | { t: 'hello'; build: string; protocol: 1 }
  | { t: 'swap'; islandId: string; chunkUrl: string; hash: string; signature: string; deps: readonly string[] }
  | { t: 'css'; styleId: string; css: string }     // replaces by id; no ghost styles
  | { t: 'page-rerender'; pageId: string; html: string }
  | { t: 'reload-island'; islandId: string; reason: string }  // fallback
  | { t: 'full-reload'; reason: string }            // last resort
  | { t: 'error'; islandId?: string; loc: { file: string; line: number; col: number }; message: string }

type ClientMsg =
  | { t: 'ack'; islandId: string; appliedHash: string; ms: number }
  | { t: 'reject'; islandId: string; reason: 'sig-mismatch' | 'runtime-error'; detail: string }
```

`signature` is a hash over `(props type ID, capability set, signal-cell layout, exported member shape)` — computed at build time. The runtime refuses a swap when the signature changes and emits `reject`; server downgrades to `reload-island`. This is React's Hook-signature contract, recast as a **type** signature, not a syntactic one. Reordering parameters of the same types is safe; adding a prop is a signature change.

### State preservation contract

For an edited island `I`:

| Thing | Preserved? | Why |
|---|---|---|
| Signal cells owned by I's parent scope | YES | The cell object is the same; only the body that consumes it changes. |
| Named `state(x)` inside I's body | YES | Compile-time AST visit assigns a stable key from the binding name. Reorder-safe within a scope. |
| Anonymous `state(x)` inside loops/conditionals | NO | No stable key. Build emits a dev warning pointing to the source with a fix-hint to extract to a named binding. |
| `derived(fn)` | YES (recomputed once) | Identity preserved by name-key; fn body new. |
| `watch(fn)` effects | DISPOSED + REINSTALLED | Previous fn's `dispose` always runs first; new fn runs at next tick. Documented as the contract. |
| Capability handles | YES | Owned by root scope; impl-table swap is transparent. |
| DOM nodes that didn't change | YES | Fine-grained reactivity already only patches dirty cells. |
| Router state, URL, scroll position | YES | Outside the island chunk. |
| Data-system caches | YES | Per ADR 0005 the cache is structurally isolated from per-request state. |

**Why this beats Solid:** Solid resets descendant state because signal creation is allowed inside the body. We require the *named binding* convention for in-body `state()` calls to qualify for preservation. Anonymous in-body state inside a loop/conditional is a warning. The constraint is documented in the authoring guide.

**Why this beats React Fast Refresh:** signature is computed on types (props shape, cap set, signal layout), not on hook-call positions. Adding a non-required prop without a state-shape change is a clean swap; React would remount because the hook-call signature changed.

### DX surface

- **No `import.meta.hot.accept()` boilerplate in user code.** `island()` is the type-level marker. The build transform inserts the accept wrapper.
- **Swap log in dev overlay.** Each swap emits `<filename> ▸ swapped in 42 ms` or `<filename> ▸ fell back to island reload — signature changed (added prop "x")`. Source maps put the click target on the failing line.
- **Errors are typed.** Failed swaps return `loc + message`; the overlay points at the source; no silent "page reloaded for some reason."
- **The reactivity graph is the source of truth.** Per charter #3 ("the graph is observable") the devtool can render the HMR-modified subgraph diff: which cells survived, which nodes were re-keyed. HMR is a node in the graph view, not a parallel system.

### Failure ladder

1. Module swap accepted → island re-renders → `ack`.
2. Signature changed (added prop, changed cap set) → **island reload**: dispose island, re-mount fresh on the same DOM node. Page state intact.
3. Edit touches a module not owned by any island (e.g. a server-side handler) → trigger server-side re-render via separate channel. No island swap; no JS state loss.
4. Runtime error during swap → revert to last-good chunk; overlay shows error; *don't* unmount the running island.
5. Build error → overlay only; no swap; runtime stays untouched.
6. WS disconnect → on reconnect, server sends current `build` id; client mismatches → full reload. Last resort.

### Production carry-over ("even faster in prod")

- **Same per-island chunk graph used in dev IS the prod chunk graph.** No "dev chunks aren't real" gap — what you debug is what you deploy.
- **Signature hash doubles as the content hash for the prod chunk:** `island-<name>-<sig>.js`. `Cache-Control: immutable`. Cache invalidation is automatic when the signature changes.
- **HMR runtime is conditionally imported behind `__PLACE_BROWSER__ && __PLACE_DEV__`.** Bun.build DCEs it. **Zero bytes shipped to prod.**
- **The build-time signature pass already does the work needed to emit tight per-island bundles.** Same analysis, two consumers — dev HMR + prod splitting. No duplicate machinery.
- **Pre-resolved import map per island** means the prod browser cache hit is per-island, not per-route.

### Latency budget

Per-leaf-island save → DOM patched: **target ≤ 30 ms p50, ≤ 80 ms p99** on M-class hardware. Sources of speed:

- Bun.build single-module incremental: sub-10 ms on warm caches.
- No SWC/Babel pass needed — Bun's native TS transform.
- No React reconciler — signal-level patching only touches dirty cells.
- Chunk already exists; only the entry-point module re-bundles.

Beats Turbopack's measured leaf-edit p50 of 84 ms ([benchmark](https://github.com/yyx990803/vite-vs-next-turbo-hmr)) by a structural factor: we skip the framework reconciler entirely.

Root-island edits or signature changes degrade to ~150 ms (still inside one island; no full reload).

## What we explicitly avoid

- **Vite's "must literal `import.meta.hot.accept(`" trick.** We have types; use them. The boundary is `island()`.
- **Solid's position-keyed signal creation inside component bodies.** Require named bindings or warn.
- **React's Hook-call-order contract.** Cap signatures are type-level, not order-level.
- **Bun's current `--hot` shape** ([Bun #17598](https://github.com/oven-sh/bun/issues/17598), [#21076](https://github.com/oven-sh/bun/issues/21076)) — `dispose` / `prune` / `invalidate` are incomplete. We can't sit on top of it; we own the protocol.
- **Astro's island remount-on-every-edit.** The reactive root outlives the swap; only the body changes.
- **CSS dribble.** Every emitted `<style>` carries an id; replacement is by id; removed islands prune their styles.

## Open questions

- **SSR streams during dev.** If a server-rendered page is mid-stream when an edit lands, do we cancel the stream or finish it? Default: cancel + restart; needs spec'ing against the streaming ADR (0029).
- **Multi-tab coherence.** When two tabs are open and an island swaps, do they swap independently or coordinate? Independent seems right; needs verification on common dev workflows (split-screen mobile + desktop).
- **Capability handler hot-swap.** If the user edits a cap handler impl, do in-flight effect invocations see old or new? Default: in-flight finishes with old; next invocation uses new. Document.
- **Source-map precision** across the AST-visit transform that inserts the accept wrapper. Need round-trip locations within 1 column for the error overlay to be honest. Bun's source-map support is the gate.

## Phases

- **Phase 1 — Signature hashing.** Build-time computation of the per-island signature. Lands as a manifest extension. ~200 LOC + tests. This is also what the prod splitter needs for content-hashed chunks; reusing the same analysis.
- **Phase 2 — Wire format + WS server.** `/_place/hmr` endpoint, message envelopes, Zod validation. ~300 LOC.
- **Phase 3 — Client runtime.** ~500 LOC inline script: file watcher → reload chunk → swap render fn → re-link signals by name-key. Dev-only via `__PLACE_DEV__` define.
- **Phase 4 — Build-transform accept wrapper.** AST visitor that wraps `island(import.meta.url, fn)` exports in the dev-only accept call. ~100 LOC. Source-map-correct.
- **Phase 5 — Dev overlay.** Swap log, error overlay, source-mapped locations. Reuses the existing dev error overlay surface.
- **Phase 6 — Devtool integration.** The HMR-modified subgraph diff in the reactivity graph view (depends on the devtool itself, ADR pending).

Phase 1 is gating: the signature analysis is also needed by ADR 0030 (effect-typed classification) for the L2/L3 boundary. Ship that first; reuse it.

## References

- [Vite HMR API](https://vite.dev/guide/api-hmr)
- [Vite vs Next+Turbo HMR benchmark](https://github.com/yyx990803/vite-vs-next-turbo-hmr)
- [Solid issue #2419 — HMR state preservation](https://github.com/solidjs/solid/issues/2419)
- [Bun HMR docs](https://bun.com/docs/bundler/hot-reloading) — current scope + gaps
- [Bun issue #17598 — `ImportMeta.hot` type missing](https://github.com/oven-sh/bun/issues/17598)
- [Astro issue #6742 — HMR works with Svelte, not React/Preact/Solid](https://github.com/withastro/astro/issues/6742)
- [Leapcell — Beyond HMR: Fast Refresh](https://leapcell.io/blog/react-fast-refresh)
- ADR 0019 — typed islands as the boundary
- ADR 0023 — islands as the only hydration model
- ADR 0026 — magic with clarity (the discoverability/traceability gate this design satisfies)
