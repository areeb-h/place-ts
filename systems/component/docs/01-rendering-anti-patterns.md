# 01 — Rendering Anti-patterns

What other frameworks got wrong about rendering, and what we will not repeat. Counterpart to [systems/reactivity/docs/01-pain-points.md](../../reactivity/docs/01-pain-points.md), but for the component-system layer.

This doc collects pain points; the design decision lives in [02-design.md](02-design.md) when this system reaches active design.

---

## Core anti-patterns

### Virtual DOM as the runtime model

React's virtual DOM allocates a new tree on every render and diffs it against the previous tree. Each render is an allocation. Memoization (`useMemo`, `React.memo`, `useCallback`) exists to fight allocations the model creates. The compiler is retrofitted to fight the same allocations.

**What we do instead:** fine-grained reactivity at the leaves. The reactive graph already knows what changed; rendering follows the graph, not a tree-diff. Solid demonstrates this works in production.

### JSX as an *opaque* compiler dependency

The risk with JSX is *opacity* — Babel/SWC plugins that aggressively rewrite source post-emit, breaking source maps and obscuring intent. A reader of the source cannot predict what the runtime sees without knowing the specific compiler.

**What we do instead:** [ADR 0002](../../../docs/decisions/0002-jsx-shape-via-ts-automatic-runtime.md) accepted: JSX-shape via TypeScript's automatic JSX runtime, pointed at our element factories. TypeScript itself emits `jsx(type, props)`; no third-party rewriter; source maps stock; per-file opt-in. The factories work standalone for non-JSX users. We do *not* adopt Babel/SWC plugins, *do not* adopt template-cloning optimization at v0.2, and *do not* adopt `<For>`/`<Show>` component primitives (our `keyed(...)` and function-as-child cover them at the right layer).

### Hydration as a separate, fragile phase

Server renders HTML; client must reconstruct identical state and bind events. The "hydration mismatch" problem is the universal pain. React's strict-mode double-render exists specifically to surface mismatches earlier — i.e. a runtime workaround for a fragile design.

**What we do instead:** the reactive graph is the artefact (per platform charter). Server-side render produces HTML *and* a serialized graph; client restores the graph rather than re-running the render. This is Qwik's resumability without Qwik's specific architecture. Phase 6 (graph serialization) makes this possible.

### Special-cased reactive boundaries (For, Show, Suspense)

Solid's `<For>` and `<Show>` are framework primitives that exist to wrap reactivity around list-rendering and conditional-rendering. Each is a small DSL with its own rules. Vue's `v-for` and `v-if` carry similar weight as template directives.

**What we do instead:** TBD. The principle: list-rendering and conditional-rendering should fall out of the reactivity primitives, not be special-cased. If we need a `<For>`-like primitive, it's because our reactivity model has a gap, and we fix the gap.

### Multiple rendering modes (SSR / SSG / ISR / RSC / client)

Next.js owns the multiple-rendering-modes catastrophe. Each mode has subtle interactions with caching, data fetching, and component boundaries. The combinatorial space is bewildering.

**What we do instead:** one rendering model. SSR is "render the graph at tick T server-side, serialize, restore on client." There is no separate ISR mode, no server-vs-client-component split.

### Special framework files (.svelte, .vue, .astro)

Svelte 5's runes only work in `.svelte` and `.svelte.ts` files. The framework dictates project structure. Code outside those files cannot be reactive. This is the "code infection" problem.

**What we do instead:** components live in normal `.ts` files. No special extension. No file-level magic. The only thing that distinguishes a component from a function is what it returns and how the platform consumes it.

### Templates as a separate language

Vue and Svelte use templates with their own DSL (`v-bind`, `{#if}`, `{#each}`). Templates ship with their own type-checking story (or no story). Editor tooling has to special-case them.

**What we do instead:** TBD. If we have templates, they must round-trip through the type system without bespoke tooling. Tagged template literals with TypeScript's literal types are one option. Plain-TS factory functions are another.

### Implicit globals for component context

`useContext`, `inject`/`provide`, and similar primitives reach into a hidden global to find ambient state. They produce the action-at-a-distance bugs documented in [docs/platform/07-prior-art-failures.md](../../../docs/platform/07-prior-art-failures.md).

**What we do instead:** capability scopes (handled by the capability system). Context is explicit; a component declares the scopes it operates within and the platform passes them via the reactivity scope mechanism.

---

## What this means for v0.1's sandbox

The current `examples/sandbox/src/lib/dom.ts` is **not the rendering model**. It is a demonstration harness — the smallest set of helpers that lets the reactivity primitives do something visible in a browser. It uses imperative DOM mutation tied directly to `watch`. That works for Phase 1 demos and earns no architectural commitment.

The real rendering model is designed in this system's Phase 2+ docs. The harness goes away when the component system lands.

---

## Open questions for design phase

- Tagged template literals vs custom DSL vs explicit factories — which one for the markup layer?
- How is hydration eliminated entirely (graph serialization) vs reduced (lazy bind)?
- How are list-rendering and conditional-rendering handled without `<For>`/`<Show>` primitives?
- What is the "component" actually, in primitive terms — a function from props to graph subtree?
- How do refs work without escape-hatch globals?
- Is there a render lifecycle at all, or is mounting just "construct a graph subtree, attach to the DOM"?

These get answered when this system enters active design (post-v0.1).
