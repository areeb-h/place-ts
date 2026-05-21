# ADR 0030: Unified hydration via effect-typed classification (`view()`)

**Status:** Phases 1 + 2 shipped — `view()` factory + L0 static path + build-time validation of `level: 'static'` assertions; L1 thaw runtime still deferred (2026-05-21)
**Date:** 2026-05-15
**Affects:** `systems/component/src/view.ts` (shipped); `systems/component/src/build/view-classifier.ts` (shipped); `systems/component/src/build/view-classifier-types.ts` (shipped); `systems/component/src/islands.ts` (`island()` JSDoc-deprecated as a `view()` alias).

> **Inventory note (2026-05-21).** Phase 1 of the unification
> landed: the `view()` factory ships in
> [`systems/component/src/view.ts`](systems/component/src/view.ts)
> with the same author shape as `island()` (one-arg with the
> auto-import plugin; two-arg explicit form). The `level` option
> drives emission:
>
>   - `level: 'static'` (L0) — pure component, no effects. View
>     callable does NOT call `_registerIslandDef`, so the bundler
>     emits NO per-island bundle. `toHtml` returns the impl's HTML
>     with no marker wrap; SSR is the final state. Real shipping
>     savings: a `view({ level: 'static' })` saves the per-island
>     bundle (~4-7 KB gzipped per island avoided).
>   - `level: 'island'` (L2) — default if `level` is unset. Same
>     emit shape as today's `island()`: per-island bundle, marker,
>     full hydration.
>   - `level: 'island+stream'` (L3) — alias for `'island'`. Streaming
>     is wrapped from outside via `<Suspense>` + `renderToStream`
>     (ADR 0029) — not a separate emit shape per island.
>   - `level: 'thaw'` (L1) — THROWS at definition time with a
>     migration hint. The L1 thaw runtime is deferred (ADR 0027);
>     dropping the option falls back to `'island'`.
>
> `island()` is now a JSDoc-deprecated alias of `view()` — same
> behavior, same brand, same JSX-callable shape. Migration is a
> rename only. Existing apps keep working unchanged.
>
> What didn't land in Phase 1: the L1 thaw runtime (ADR 0027) and
> automatic emit selection via classifier prediction.
>
> **Phase 2 landed (2026-05-21).** Build-time validation closes
> the "author asserts, framework validates" half of the contract.
> The island bundler now runs `validateAssertedLevel(name, source,
> classifierResult)` for every island; if the source contains
> `view({ level: 'static' })` AND the classifier sees effects in
> the body, the build throws with a precise error naming the
> offending primitive:
>
>   `view: island 'with-state' asserts level: 'static' but the
>    body has effects.`
>   `  Found: 'state' (effect: 'state', 1 ref)`
>   `  Classifier prediction: 'thaw'`
>   `  Fix: drop the level: 'static' option, OR remove the effect
>    so the assertion holds.`
>
> Only `level: 'static'` is validated — it's the only level
> STRICTER than the default emit, so it's the only one where a
> misclassification would silently break behavior (zero JS shipped
> for code that needed hydration). Other assertions (`'island'`,
> `'island+stream'`, unset, dynamic expressions) skip validation;
> they emit at L2 either way.
>
> The implementation is two small additions in `view-classifier.ts`:
> `extractAssertedLevel(source)` parses the view() call's options
> object for a literal `level` field, and `validateAssertedLevel(...)`
> compares it to the classifier's prediction. The island bundler
> calls the validator inline after classification — no extra build
> pass.
>
> Tests: 9 unit tests for the factory's level paths
> ([view.test.ts](systems/component/tests/unit/view.test.ts)),
> 19 unit tests for the extractor + validator
> ([view-classifier-validate.test.ts](systems/component/tests/unit/view-classifier-validate.test.ts)).
> 28 total for the Phase 1 + 2 surface.
>
> Still deferred (Phase 3+): the L1 thaw runtime (ADR 0027) and
> automatic emit-level selection driven by classifier prediction
> when no level is asserted.

## Context

place-ts has three hydration models on the drawing board:
- `island(import.meta.url, fn)` — typed JSX wrapper, per-island bundle, full hydration. **SHIPPED.**
- `thaw()` (ADR 0027) — server emits markers + inline action AST, ~1.5 kB shared client runtime. **PROPOSED, NOT BUILT.**
- streaming (ADR 0029) — per-suspense `<template>` fills + Channel B state envelopes. **PROPOSED, NOT BUILT.**

Three primitives means three author-facing decisions per component (which model?), three wire formats (`data-thaw-state` JSON vs `data-place-island-props` JSON vs Channel B envelopes), three runtimes, three sets of failure modes. **The author has to think about hydration.** That's exactly the surface every framework gets wrong:

- Astro: `client:load` / `client:visible` / `client:idle` / `client:media` / `client:only` — five directives the author picks ([Astro docs](https://docs.astro.build/en/concepts/islands/)).
- Next.js: `"use client"` / `"use server"` — string directives; cannot type-check what's allowed across the boundary.
- Qwik: `$` suffix on identifiers — invisible at the call site; compile-time magic ([Qwik docs](https://qwik.dev/tutorial/understanding/capturing/)).
- Marko: per-tag classification by the compiler — not portable to JSX surfaces.
- Solid (Carniato's [explicit position](https://dev.to/this-is-learning/islands-server-components-resumability-oh-my-319d)): "these are actually complementary, not unifiable." We deliberately disagree.

The claim: place-ts can ship **one** author-facing primitive whose hydration model is a **pure function of the effect-kind types in its body**. The author writes effects; the type system computes the level; the runtime ships the right wire format.

## Decision

Adopt `view()` as the single authoring primitive. `island()` and `thaw()` become emitter targets the build picks based on a build-time **classifier** that reads effect-kind types off `state`, `derived`, `watch`, `onMount`, `fetch`, etc.

Four hydration levels, classified in order — first match wins:

| Level | Predicate | Emitter | Wire cost |
|---|---|---|---|
| **L0 — static** | No `state`, no events, no async, no `onMount` | Plain HTML, no marker | 0 B |
| **L1 — thaw** | Only `state()` + arithmetic on state + event handlers fitting the pure-action AST (ADR 0027) | `data-view="thaw"` + JSON snapshot + AST | ~300 B per component, shared 1.5 kB runtime |
| **L2 — island** | `onMount` / `setInterval` / `fetch` / closures over non-state values / `derived` outside pure subset | `data-view="island"` + props JSON + per-island chunk | 3-10 kB per component |
| **L3 — island + streaming** | L2 conditions **and** the component (or an ancestor `view`) reads from `Suspense`/`Deferred`/async resource | Same as L2 but SSR'd HTML emitted in chunks (Channel B envelopes per ADR 0029) | L2 cost + framework streaming runtime |

The classifier is a pure function of the typed AST. The author has no `kind:` field, no `client:*` directive, no `$` suffix. The decision is **visible** through the build report — `Counter → L1 (thaw, 312 B AST)`, `Tooltip → L2 (island, 3.1 kB)`, `Chart → L3 (island+stream, 4.2 kB + lazy)` — but it is not authored.

## The load-bearing idea: classification is a typed effect, not a heuristic

Each primitive that promotes a `view()` past L0 carries an effect tag in its TypeScript type:

```ts
// systems/reactivity/src/effects.ts
type Effect = 'pure' | 'state' | 'lifecycle' | 'timer' | 'io' | 'dom' | 'unknown'

export interface State<T, E extends Effect = 'state'> {
  (): T
  set(value: T): void
  __effect: E
}

export const state: <T>(initial: T) => State<T, 'state'>
export const onMount: ((fn: () => void | (() => void)) => void) & { __effect: 'lifecycle' }
export const fetch: typeof globalThis.fetch & { __effect: 'io' }
export const setInterval: typeof globalThis.setInterval & { __effect: 'timer' }
```

A `view()`'s classified level is the **least upper bound (lub) of the effect tags it touches**, computed at type-check time. The classifier reads the effect set off the body's type — it doesn't regex-scan for `onMount` as a string, doesn't AST-visit for known names. It asks `tsc` what effects the body produces.

This is the generalization ADR 0027's pure-action interpreter wanted: a specialized AST walker for `state.x.set(...)` becomes "lub of effect tags." Same machinery decides L1/L2/L3.

### Why no incumbent can do this

- **Qwik:** primitives are effect-untagged. `useSignal` is `useSignal` regardless of how the closure uses it.
- **Solid:** `onMount` returns `void`. There's nowhere to thread the effect tag.
- **React:** hooks are positional and untyped at the effect level.
- **Astro/Next:** the directive is the contract; there's no way to defer the choice to a type.
- **Marko:** the analyzer is tag-runtime-coupled; not portable to JSX.

The opportunity sits in a place a five-line type-system extension lights up; none of the incumbents can take it without rewriting their primitive layer.

## Runtime — three levels, one wire format

The framework today has `data-place-island-props` for islands and (proposed) `data-thaw-state` for thaw. **Unify on `data-view`** with typed sub-attributes:

```html
<!-- L0 static, no marker -->
<div>Hello {name}</div>

<!-- L1 thaw -->
<div data-view="thaw" data-view-id="counter-7" data-view-state='{"c":0}'>
  <span data-view-bind="c">0</span>
  <button data-view-event="click:inc">+</button>
</div>

<!-- L2 island -->
<div data-view="island" data-view-id="tooltip-3" data-view-props='{"label":"hi"}'>...</div>

<!-- L3 island + streaming -->
<div data-view="island" data-view-id="chart-1" data-view-stream="boundary-2">
  <template data-view-fallback>...</template>
</div>
```

**The same DOM walker** (find `[data-view]`, read `data-view-id`, look up the kind in a manifest, dispatch) handles all three. Dispatch is a 200-byte switch on `data-view`'s value:

- `thaw` → inline action interpreter (ADR 0027 runtime)
- `island` → per-island chunk loader (ADR 0023 runtime)
- `island` + `data-view-stream` → wait for the matching stream boundary script (ADR 0029 Channel B), then dispatch as `island`

**Cross-level shared state:** a `view()` body can `import` a module-level `state()` declared elsewhere. The classifier sees this and **forces both views to L2 minimum** — shared signals are not a thaw-able concept because the JSON snapshot per component cannot represent reference identity across components. The build report flags it: `Counter → L2 (promoted from L1: shared signal with Header)`.

## The build-time report (the discoverability gate)

Every build emits `dist/.place/view-manifest.json` and a console summary:

```
Place build — view classification
  Header       L0  static            (0 B)
  Counter      L1  thaw              (312 B inline AST)
  ThemeToggle  L1  thaw              (98 B inline AST)
  Tooltip      L2  island            (3.1 kB)
  Chart        L3  island+stream     (4.2 kB + lazy data)
  CommentList  L2  island            (5.8 kB) — promoted from L1 because
                                       `derived(comments, c => sort(c, locale))`
                                       captures non-state value `locale`
```

The `— promoted from L1 because <reason>` line is what charter #7(b) — traceable in tooling — demands: every classifier decision is traceable to the source construct that caused it. This is the single most important piece of the proposal. It is what makes "the framework decides" not feel like magic.

## Same `<Counter />` author code, three different runtimes

```tsx
// counter.view.tsx — ONE source

import { view, state } from '@place-ts/component'

export default view(import.meta.url, () => {
  const count = state(0)
  return <button onClick={() => count.set(count() + 1)}>{count}</button>
})
```

- **As written:** classifier says L1 (state-only, pure action). Build emits 312 B inline AST. No chunk.
- **Add `onMount(() => console.log('mounted'))`:** classifier promotes to L2. Build emits 3 kB chunk. Full hydration.
- **Wrap call site in `<suspense fallback={...}>` whose payload is async:** classifier promotes containing view to L3. Build emits L2 chunk + stream marker. `renderToStream` attaches the boundary.

**Same authoring code. The dev sees the decision in the build report.** Author can force a level with `view(import.meta.url, fn, { level: 'island' })` — typed, visible, errors if asking for a level *lower* than what the classifier picked.

## Comparison

| | place `view()` | Qwik | Astro islands | Marko 6 | Solid+SolidStart | place today |
|---|---|---|---|---|---|---|
| One author surface | yes | yes (`$`-suffix magic) | no (`client:*` directives) | yes (tag-typed) | yes (component) | no (island vs thaw) |
| Framework picks model | yes (classifier) | partial (compiler picks chunks; level is fixed) | no (author picks `client:load` etc.) | yes (per-tag) | partial | no |
| Decision visible to dev | yes (build report) | no (content-hash chunks) | yes (directive in source) | partial (compiler logs) | partial | partial |
| Shared cross-component state | yes (forces L2) | yes (serialized) | unsafe (Nano Stores caveat) | yes | yes | special module pattern |
| Resumes without re-running impl | yes at L1 | yes everywhere | no | partial | no | no |
| Wire format unified across levels | yes (`data-view`) | no (qwik/json blob) | no (per-directive) | runtime-coupled | per-mode | no (thaw vs island) |
| String directive magic | none | `$` suffix | `client:*` | tag conventions | none | none |
| Effect kinds in types | yes (classifier reads them) | no | no | no | no | partial |

## Risks + mitigations

1. **Classifier surprises.** Author adds `Date.now()` to an action, gets silently promoted to L2 + 3 kB chunk. *Mitigation:* the build report is the front line. A `--max-level=L1` CLI flag fails the build if any view is promoted past L1 — opt-in for performance-critical pages.
2. **Effect-kind types pollute the API.** Every primitive needs an effect tag. *Mitigation:* the tag is a `__effect` brand on the function type; users never see it, only the inference does.
3. **Wire-format versioning.** A unified `data-view-*` is a stable interface. *Mitigation:* per ADR 0027's risk #4, version it: `data-view-v="2"`; runtime refuses unknown versions with full-page reload fallback.
4. **Classifier false negatives.** A function that does `state.set(globalThis.x)` is technically not pure. *Mitigation:* effect-kind types make this a type error before the classifier runs — `globalThis` access is itself an effect.
5. **Streaming + thaw interaction.** L1 thaw inside an L3 streaming island — does the snapshot arrive with the chunk or with the shell? *Mitigation:* snapshots ride the chunk; L1-inside-L3 is just L1 emitted later in the stream (via Channel B per ADR 0029).
6. **Function props at L1.** Thaw cannot serialize a `content={() => <JSX/>}` prop. The classifier detects function-typed props and forces L2 OR errors at the call site with a fix-hint to restructure to children. (This is the Tabs bug we found while implementing the docs island migration — `Tabs tabs={[{label, content: () => …}]}` cannot cross the wire.)

## Phases

- **Phase 1** — Type the effect kinds on all reactivity primitives (`state`, `derived`, `watch`, `onMount`, `setInterval`, `fetch`). Non-breaking type-only change. ~200 LOC + tests. Lands first because ADR 0028 (HMR signature hashing) also needs this analysis.
- **Phase 2** — Build the classifier: pure function `(typed-AST) → Level`. Ship behind a flag; emit the build report; existing `island()` and `thaw()` continue to work. Validate the classifier picks the same level the author would have picked manually for the docs site's chrome and the commonplace demo.
- **Phase 3** — Unify the wire format to `data-view-*`. Existing thaw and island markers translate at the boundary. Existing apps unchanged.
- **Phase 4** — Introduce `view()` as the public primitive. `island()` and `thaw()` become deprecated aliases that error on classifier mismatch.
- **Phase 5** — L3 streaming wiring through `renderToStream`/`suspense()` per ADR 0029. Docs site moves to streaming for slow-data routes.
- **Phase 6** — Devtool: graph panel renders L0/L1/L2/L3 origins with the same node shape, per charter clause 3.

Phase 1 is gating: it's also the basis of HMR's signature hash (ADR 0028) and is needed before any further hydration work. **Phase 2 is the load-bearing measurement.** If the classifier picks differently than authors do for the docs site's chrome islands, the model needs revision before Phase 3.

## What this means for the platform

- **Charter relevance:** the cleanest concrete realization of clause 4 ("effects are typed") yet proposed. Operationalizes clause 7 ("magic with clarity") at a load-bearing surface: every classifier decision is discoverable in source (the effect-tagged primitive), traceable in tooling (the build report), and budget-faithful (the level-cost table is explicit).
- **Relation to prior ADRs:** ADR 0027 (thaw) is **not** scrapped — it becomes the L1 runtime emitter. ADR 0023 (islands as the only hydration model) gets refined: the *runtime* tier has L0/L1/L2/L3; the *authoring* tier is one primitive. ADR 0028 (HMR) reuses the same effect-kind analysis for signature hashing. ADR 0029 (streaming) is the L3 emitter.
- **The "path no one dared take":** promoting **effect kinds, not directives, to the decider role for hydration**. Qwik's `$`, Astro's `client:*`, Next's `"use server"` are all author-burden patterns. We replace the choice with a derived consequence of the *kind of effect the code does*. The author thinks about effects; hydration is downstream.

## What we explicitly avoid

- **Qwik's QRL magic** (invisible to source).
- **Astro's per-directive choice** (author burden).
- **RSC's string directives** (charter-forbidden).
- **Solid's "complementary not unified" stance** (the user explicitly wants the unified path).
- **Marko's runtime-coupled compiler** (not portable to JSX surfaces).
- **A `kind:` field on the primitive** (defeats the purpose).

The classifier reads types, not strings; the wire format is one shape; the report makes the magic visible.

## References

- [Qwik docs: Resumable](https://qwik.dev/docs/concepts/resumable/) — what we're learning from + diverging from
- [Qwik docs: Serialization Graph](https://qwik.dev/tutorial/store/serialization/) — DAG constraint
- [Qwik docs: Non-serializable Properties](https://qwik.dev/tutorial/store/no-serialize/) — the tax we're avoiding
- [LeoNerd: Unlocking the Magic of Closure Serialization in Qwik](https://leonerd.blog/posts/unlocking-the-magic-of-closure-serialization-in-qwik/)
- [Astro: Server Islands docs](https://docs.astro.build/en/guides/server-islands/) + [Shared state caveat](https://docs.astro.build/en/recipes/sharing-state-islands/)
- [DEV: A First Look at MarkoJS — Ryan Carniato](https://dev.to/ryansolid/a-first-look-at-markojs-3h78) — Marko 6 partial-hydration direction
- [DEV: Islands & Server Components & Resumability, Oh My! — Ryan Carniato](https://dev.to/this-is-learning/islands-server-components-resumability-oh-my-319d) — the "complementary, not unified" stance we disagree with
- [Vercel: Optimize RSC Payload Size](https://vercel.com/kb/guide/how-to-optimize-rsc-payload-size) — the payload-grows-large admission
- [Adversis: An RSC Parser Because React Decided Wire Protocols Were Fun](https://www.adversis.io/blogs/an-rsc-parser-because-react-decided-wire-protocols-were-fun)
- ADR 0019 — typed islands, not string directives (the discipline this unifies under)
- ADR 0023 — islands as the only hydration model (refined here into L0/L1/L2/L3)
- ADR 0026 — magic with clarity (the gate every classifier decision passes through)
- ADR 0027 — "thaw" resumability (becomes the L1 emitter)
- ADR 0028 — Place HMR (consumes the same effect-kind analysis for signature hashing)
- ADR 0029 — Place streaming (becomes the L3 emitter)
