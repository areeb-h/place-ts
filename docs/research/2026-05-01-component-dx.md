# Research: Component-system DX path forward, given JSX-shape preference + non-React improvements

**Date:** 2026-05-01
**Time spent:** 1 hour
**Depth:** standard

## Sources consulted

- [dom-expressions README](https://github.com/ryansolid/dom-expressions) — Solid's compile target; JSX → cloned `<template>` + per-leaf `effect()` wrappers. The reference implementation for "JSX without vDOM."
- [babel-plugin-jsx-dom-expressions](https://github.com/ryansolid/babel-plugin-jsx-dom-expressions) — the actual transform; `_$template`, `_$insert`, `_$effect` calls. Configurable `effect` name + output modes (`dom` / `ssr` / `hydrate`).
- [`@solidjs/html`](https://www.npmjs.com/package/@solidjs/html) — Solid's own no-compile tagged-template path. Notable: Ryan Carniato's stated position is that tagged templates are "inferior in every way" except when no-build is a hard requirement (larger bundle, slower runtime, manual `()=>` wrapping for reactivity).
- [HTM 3.0](https://github.com/developit/htm) — sub-1KB, zero-build, hyperscript-shaped tagged-template. TS support exists but inference inside the template body is shallow (well-known limitation; cf. [TS issue 29432](https://github.com/microsoft/TypeScript/issues/29432)).
- [Qwik resumability docs](https://qwik.dev/docs/concepts/resumable/) and ["Resumability vs Hydration"](https://www.builder.io/blog/resumability-vs-hydration) — graph + closure serialization eliminates the hydration phase. Closures are addressed via QRL identity (a content-hash analog). This is exactly what reactivity Phase 6 + build closure-hashing already plans.
- [Astro Islands](https://docs.astro.build/en/concepts/islands/) — selective hydration as opt-in directives. Strictly inferior conceptually if graph-serialization works: islands are a workaround for "we still need hydration somewhere, so let's at least minimize it."
- [Solid's "Understanding JSX"](https://docs.solidjs.com/concepts/understanding-jsx) — confirms component bodies run *once*; JSX is not the runtime, it's a thin compile-target sitting on the same primitives we already have (`createSignal`/`createEffect` ≈ our `state`/`watch`).

## Findings

### 1. The JSX shape can land without inheriting React's runtime model. Solid is the proof.

Solid's compiler turns `<div class={x}>{count()}</div>` into roughly: a hoisted `<template>` clone, an `_$insert` for the dynamic child wrapped in an `_$effect`, and an attribute-binding call. No vDOM, no diffing, no re-renders. The runtime sees direct DOM ops + `effect(() => ...)` calls — i.e. exactly what an element-factory call would expand to. **JSX-shape and our charter are not in conflict** at the runtime layer; the conflict is at the **compiler-opacity** layer (anti-pattern doc §"JSX as a compiler dependency that hides intent").

That anti-pattern is real but not unconditional — what it actually rules out is *opaque* JSX. A JSX transform we own, that compiles to **literally the same factory calls a hand-author would write**, is not opaque. The 02-design.md already names this exit: "Per-file opt-in. Runtime parity. The JSX must compile to exactly the factory calls a hand-author would write."

That last clause is the design contract, and it's achievable with the automatic JSX runtime (`jsx-runtime` import) pointing at our factories. No Babel plugin; just `jsxImportSource` in `tsconfig.json`. TypeScript itself emits the calls, source maps are pristine, no third-party rewriter.

### 2. The Solid-style template-cloning compiler is a *separate* optimization from the JSX *shape*. Don't conflate them.

Two distinct compile-time operations Solid performs:
- (a) **JSX → factory/hyperscript calls.** Cheap. TS does this natively via `jsx-runtime`.
- (b) **Hoist static subtrees into `<template>` clones.** Performance optimization. Requires a custom plugin and is what makes Solid "fastest." Skipping (b) costs 2x-ish runtime perf vs Solid; charter explicitly accepts "within 2x of fastest."

We get the ergonomic win by adopting (a) only. (b) is a future optimization an ADR can revisit when the reactivity graph + build pipeline are stable. **Adopting (a) without (b) is the path that respects "no compiler magic that hides intent."**

### 3. HTM is a viable backstop but worse along every axis we care about.

- **TypeScript inference inside the template string is structurally unsolvable today.** TS 4.x added typed-template-literal *types*, but element-name → attribute-set inference inside HTM-shape strings still requires the full TS issue 29432 work, which has not landed. This breaks AI-friendliness (charter §7) — LLMs author markup more reliably with named function calls than with string-embedded structure that has no inference signal.
- **Bundle and perf hit at runtime** (HTM parses the template at runtime; Solid's own `@solidjs/html` carries the same penalty).
- **One-line wins:** zero build step, syntax familiarity. Neither is load-bearing for us — we already have a build, and JSX-runtime via TS is build-step-free in any sense that matters.

HTM is a legitimate Plan B if JSX-via-TS turns out to have a friction point we don't currently see. It is not a Plan A.

### 4. Hydration: position is settled. Graph serialization wins; islands are a workaround.

Qwik's existence is the proof of concept that graph + closure serialization can replace hydration entirely. The platform charter and the rendering-anti-patterns doc already commit to this. The only thing this round of research adds: **Astro Islands is not a viable middle ground**, despite its popularity. Islands exist because the underlying frameworks (React, Vue, Svelte, etc.) cannot resume — Astro patches around their inability. We should not adopt islands; we should ship the underlying capability that makes islands unnecessary. This is consistent with what's already in `02-design.md` §"Hydration: graph serialization, not rerender."

The 2025-2026 framework convergence is worth naming: **everyone is moving toward fine-grained reactivity + some form of resumability**. React Compiler retrofits memoization; Vue Vapor strips vDOM; Svelte 5 runes are signals. The charter's bet is the right side of this trend.

### 5. Specific Solid trap to avoid: `<For>` and `<Show>` exist because Solid's reactivity has a gap.

Solid's `<For>` is needed because re-running a `.map()` inside a tracked scope re-creates every node every time. That's a reactivity-system limitation Solid papered over at the component layer. **Our `keyed(...)` primitive is the equivalent fix done at the right layer** — a function returning a `View`, not a magic component name the compiler treats specially. This is a strict improvement on Solid's design and one of the few places we should *not* copy Solid.

Same for `<Show>`: the function-form-as-child binding (already in `02-design.md`) covers it. No special primitive needed. Confirm this stance — it's correct.

## What this means for us

- **relevant-to-charter (§7 AI-friendly, §3 graph observable):** JSX via the TS automatic runtime, pointed at our factories, is charter-compatible. The transform is visible (TS emits `jsx(div, {...})`), source maps are stock, nothing rewrites user code post-emit. AI-friendliness improves vs string-embedded HTM.
- **relevant-to-current-phase (component v0.2):** The 02-design.md "factories first, JSX deferred" ordering can hold *unchanged* even if we recommit to JSX-shape. Factories are the runtime; JSX is a thin facade that emits calls to those same factories. Building factories first is still the right v0.2 deliverable; JSX support becomes a config flag in the consumer's tsconfig in v0.2.x or v0.3.

## Recommendation

**Adopt JSX-shape via the TypeScript automatic runtime (`jsxImportSource: "@place-ts/component"`), with our element factories as the JSX runtime target.** No Babel plugin. No template-cloning optimization at v0.2. No `<For>` / `<Show>` magic — `keyed()` and the function-as-child form already cover those.

Concretely:
1. Build factories as `02-design.md` v0.2 already plans. `View` + `mount` + factories + `keyed` ship first.
2. Ship `jsx-runtime.ts` and `jsx-dev-runtime.ts` exports that re-export the factories under the `jsx`/`jsxs`/`Fragment` names TypeScript expects. This is a thin file (~20 LOC).
3. Author code can opt in per-file or per-package via `tsconfig.json` `jsxImportSource`. No project-wide assumption. No filename magic. Charter §"no magic file conventions" preserved.
4. Defer the template-cloning optimization (Solid's perf win) to a future ADR, after Phase 6 reactivity lands. Charter "within 2x of fastest" tolerates this.

**Fallback if JSX-via-TS-runtime turns out impractical** (the only realistic risk: TS's automatic runtime expects React-shaped `jsx(type, props)` signatures; if our factory shape diverges in a way that fights this, it'd require a shim layer that adds opacity): drop to **HTM-style tagged templates as the secondary form, factories as the primary**. The factories *must* always work standalone, so the tagged-template form is decorative — same model as Lit. We do *not* fall back to a custom Babel plugin.

## Decisions for the user/author now vs deferred

**Now:**
- Confirm JSX-shape is adopted, pointed at our factories, via TS automatic runtime (no plugin). One-paragraph ADR.
- Confirm `keyed` stays the list primitive (no `<For>`). Confirm function-as-child stays the conditional primitive (no `<Show>`).
- Confirm Plan B is HTM-style tagged-template-over-factories, *not* a custom Babel plugin.

**Deferred:**
- Template-cloning optimization (Solid's `<template>.cloneNode` trick). ADR after Phase 6.
- SSR + graph-restore wiring. Already deferred to v0.4+.
- Whether to expose the JSX runtime publicly or keep it internal until factory API is stable. Lean: internal at v0.2, public at v0.3 once factory shape is settled.
- Animations / transitions (already deferred in 02-design.md §Open questions).

## Pointers worth reading deeper if we go further

- `dom-expressions/packages/babel-plugin-jsx-dom-expressions/src/dom/element.js` — to see exactly what optimizations the compiler buys you, and which we'd defer.
- TS docs on `jsxImportSource` + the [automatic runtime spec](https://github.com/reactjs/rfcs/blob/createlement-rfc/text/0000-create-element-changes.md) — the contract our `jsx-runtime.ts` must satisfy. Note: the contract is React-flavored; we adopt the *shape* of the contract, not React's semantics.
- Qwik's QRL implementation — relevant when Phase 6 + closure-hashing land, not before.
- Solid's `@solidjs/html` source — small enough to read in 20 minutes; the realistic shape of our HTM Plan B if we ever need it.

## What to avoid

- Writing our own JSX-to-factory Babel/SWC plugin. The TS automatic runtime makes this redundant and reintroduces compiler-opacity.
- Adopting Solid's `<For>`/`<Show>` shape "because it's nice in JSX." It's not nice in JSX; it's a workaround we don't need.
- Treating Astro Islands as a hydration model. It's a workaround for frameworks that can't do what we plan to do.
- Coupling JSX adoption to template-cloning. Two separate decisions; conflating them creates the same opacity we're avoiding.

## Open questions raised

- Does the TS automatic JSX runtime support our factory return type (`View`) cleanly, or does it assume a vDOM-shaped node? Worth a 30-min spike with a throwaway `jsx-runtime.ts` against a stub factory before locking in.
- Is `jsxs` (multi-child variant) worth implementing distinctly, or can it alias `jsx` for our model? Solid aliases; we probably can too.
- For HMR (already an open question in 02-design.md §5): JSX adoption doesn't change the closure-identity problem, but it changes the *granularity* at which identity must be assigned. Worth flagging for the build-system charter, not blocking here.
