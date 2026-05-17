# ADR 0002: JSX-shape via TypeScript's automatic JSX runtime

**Status:** accepted
**Date:** 2026-05-01
**Affects:** component system (v0.2+), build system (compiler config), examples

## Context

[01-rendering-anti-patterns.md](../../systems/component/docs/01-rendering-anti-patterns.md) specifies that JSX is "a 'no' by default; an ADR overrides this." This is that ADR.

The user has redirected: "I like the JSX way but we don't have to follow react as it is — we can improve the approach."

The Researcher's findings ([docs/research/2026-05-01-component-dx.md](../research/2026-05-01-component-dx.md)) establish:

1. The anti-pattern is *opaque* JSX — Babel/SWC plugins that aggressively rewrite source post-emit, breaking source maps and obscuring intent. **TypeScript's own automatic JSX runtime is not opaque.** TS emits `jsx(type, props)` calls; nothing third-party rewrites them; source maps are stock.
2. JSX shape and Solid-style template-cloning are **separate decisions**. We adopt the shape only; template-cloning is a perf optimization deferred to a future ADR after Phase 6 reactivity stabilizes.
3. Solid's `<For>` and `<Show>` exist because Solid's reactivity has gaps that need component-level workarounds. Our `keyed(...)` and function-as-child cover both at the right layer; we do not adopt those component primitives.
4. HTM (tagged-template JSX-shape) is a viable Plan B, not Plan A. TypeScript inference inside the template body is structurally weaker; AI authoring friction is higher.

## Options considered

1. **Element factories only, no JSX.** Original 02-design.md plan. Works, but leaves an ergonomic gap users will reach for.
2. **JSX via custom Babel/SWC plugin.** Solid's approach. Captures Solid's perf wins via template-cloning. Compiler-opacity anti-pattern violation; rejected.
3. **JSX via TypeScript's automatic JSX runtime, pointed at our factories.** Author writes `<div class={state.read}>{...}</div>`; TypeScript emits `jsx(div, { class: state.read, children: ... })` where `div` is our existing factory. No third-party rewriter. Source maps preserved. Per-file opt-in via `jsxImportSource` in `tsconfig.json`.
4. **HTM-style tagged templates as primary.** Inferior type inference; runtime parse cost; no compelling reason to lead with it.

## Decision

**Option 3: JSX via TypeScript's automatic JSX runtime, pointed at our factories.**

Concretely:
- Element factories remain the primary runtime (per [02-design.md](../../systems/component/docs/02-design.md)). They work standalone, no JSX required.
- A thin `jsx-runtime.ts` (and `jsx-dev-runtime.ts`) module re-exports the factories under the `jsx`/`jsxs`/`Fragment` names TypeScript expects.
- Consumer projects opt in per-file or per-package via `tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "jsx": "react-jsx",
      "jsxImportSource": "@place/component"
    }
  }
  ```
- No Babel plugin. No SWC plugin. No template-cloning optimization at v0.2.
- `keyed(items, key, render)` remains the list primitive. Function-as-child remains the conditional primitive. **Neither `<For>` nor `<Show>` is adopted.**

**Plan B if (3) fights our `View` return type:** HTM-style tagged-template facade over the same factories. Not a custom plugin.

## Consequences

**Easier:**
- Familiar JSX ergonomics for anyone coming from React/Solid/Vue.
- TypeScript handles the syntax; no third-party tool in the build path.
- Source maps and HMR work without extra plumbing.
- AI co-authoring is more reliable (LLMs author `<div>` better than `div(...)`).

**Harder:**
- Slightly more configuration on the consumer side (`jsxImportSource` in tsconfig).
- We must ensure the factory signature matches what `jsx(type, props)` expects (string tag name OR component function as `type`; props object includes `children`).
- The TS automatic runtime contract is React-flavored. We satisfy the *shape* of the contract, not React's runtime semantics. Any consumer expecting a vDOM-shaped node will be surprised; we document that the return type is `View`, not `ReactNode`.

**Watch for:**
- The automatic runtime spec assumes `jsx(type, props, key?)`. If we ever need to extract `key` for non-`keyed` purposes, the contract is in place.
- Future ADR may revisit template-cloning if benchmarks show we're losing more than 2x to Solid on real workloads.

## Notes

- The 02-design.md "factories first" deliverable order does not change. JSX is a thin facade over the factories; the factories must work standalone for non-JSX users.
- This ADR does NOT commit to publishing `jsx-runtime` publicly at v0.2; it's internal until the factory shape has settled. Public exposure is a v0.3 question.
- Plan B (HTM facade) is a deferred fallback; we do not implement it speculatively.

## Verification spike

Before this ADR is locked, a 30-minute spike: write a stub `jsx-runtime.ts` and a stub factory, configure a sandbox file with `jsxImportSource`, and verify the TypeScript compiler accepts our `View` return type without forcing a vDOM-shaped contract. The spike is part of the implementation that immediately follows this ADR.
