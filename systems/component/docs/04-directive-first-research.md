# Research: directive-first reactive UI — filtered against the place charter

**Date:** 2026-05-12. **Depth:** standard. **Filters:** platform charter non-negotiables 4/5/7, component-charter commitments 3/7, the proposal in `03-directive-first-ui.md`, prior-art-failures meta-lessons 2 and 6.

## Arguments FOR directive-first (as proposed)

1. **Vue Vapor mode validates "directives + no VDOM."** Vue.js Nation 2025: directive syntax preserved, VDOM dropped, ~53% runtime size reduction, 25–50% faster updates. Closest analogue to place's substrate. Proves directives don't require a VDOM to be ergonomic.
2. **Solid already ships `use:` as proof a narrow directive surface composes with JSX.** Carniato's actual stance is "no template DSL parser," not "no directives." His stated reason for JSX: "I've seen other frameworks' pain with rolling their own syntax/parsers." A JSX-attribute surface that desugars before tsc is consistent with that.
3. **Internal consistency.** The proposal's diagnosis (behavior dressed as composition is a category error) aligns with component-charter commitment 3 and non-negotiable 7. Attribute syntax makes the structural/behavioral split visible at the call site.

## Arguments AGAINST directive-first

1. **Svelte 5 explicitly walked back template-magic — and the reason is non-negotiable 7 in someone else's words.** Rich Harris on runes: file-scope reactivity (a) was opaque, (b) didn't compose across files, (c) made debugging painful. "The problem with magic is that it can be hard to debug." Migration cost was substantial — practitioners report verbosity increases, manual rework after perf regressions, TS ergonomics that feel like "the people who wrote Svelte 5 don't use it with TypeScript." **The proposal's `:state:name` reintroduces exactly the pattern Svelte exited**: a variable named `open` appears in scope inside child directives, but its declaration is an attribute string on an ancestor.
2. **Volar/Vue language tools are the honest TypeScript ceiling for templated attributes — and it's not great.** Vue funds a full-time team on Volar; it generates virtual `.ts` files from SFCs; users still hit "TypeScript intellisense is disabled on template" errors needing tsconfig surgery. The proposal *defers* this work. For a solo evening project this is the famous-last-words category. Build-time-only type errors with attribute strings showing as plain strings in the editor is a regression vs today.
3. **Multi-directive precedence is a bug class place doesn't currently have.** Vue 2→3 silently flipped `v-if` vs `v-for` precedence; `eslint-plugin-vue/no-confusing-v-for-v-if` exists to paper over it. Alpine: 11s vs 3s for 3,000 elements just from being present. The proposal stacks `:if`/`:else-if`/`:else`/`:for`/`:show`/`:client`/`:defer` on the same elements and via siblings.
4. **Attribute-driven frameworks hit the "outgrew it" wall in the record.** Marko is the most relevant — eBay-scale production, ~2 maintainers, adoption stalled per Carniato's own writeup explicitly because TS support lagged. place's TypeScript-everywhere stance makes that not just an adoption risk but a correctness risk.
5. **`:state:name` cannot type-check across the directive boundary without a virtual-file LSP.** Until either a Volar-style plugin or eagerly-synthesized `.d.ts` mirrors ship, every `:state:name` reference is an untyped string from the editor's perspective. Largest tax against non-negotiable 7 (AI-friendliness).
6. **The bundle-size claim is weaker than the proposal implies.** `<Show>`, `<Activity>`, `<ClientOnly>`, `<Deferred>` already desugar to the primitives the directives would compile to. Net delta is low hundreds of bytes after minification — a wash, not a win.
7. **Compiler complexity tradeoff is misframed.** "Pure source-to-source rewrite" understates what `:state:name` needs: scope analysis, hoisting, IIFE injection, source-map fidelity, attribute-position error spans, tsc round-tripping. Vue's template compiler is 30k+ lines maintained full-time; Solid's "small" JSX compiler is ~5k lines and a known hotspot. Combined for one evening-builder, this is platform failure-mode #6 (compiler opacity).

## What this means for us

- **Charter non-negotiable 7** (no compiler magic) is in direct tension with `:state:name`. Svelte's walkback is the strongest signal this pattern is regretted at scale.
- **Non-negotiable 4** (typed effects, compile-time discipline) is undermined when expression strings type-check only after the transform with no editor feedback path.
- **Component-charter commitment 7** (no codegen) becomes hard to defend: IIFE wrappers + hoisted bindings + eventual `.d.ts` mirror files *is* codegen.
- **Current phase:** v0.3 just shipped SSR/hydration. The existing `<Show>`/`<Activity>` already solve directive-hydration composition; re-implementing under a new surface is rework, not new capability.

## What to avoid

- Implicit-scope variables introduced by ancestor attributes (Svelte 4 regret).
- Shipping the directive parser before the virtual-file LSP path exists.
- Multi-directive precedence rules on one element (Vue `v-if`/`v-for` precedent).
- Selling "smaller bundle" when the actual saving is two-digit bytes.

## Open questions raised

- Does extending `use:action={fn}` to typed function-valued directives (no string expressions) buy most of the ergonomic win without the compiler/LSP burden? Real JS, real tsc, real editor squiggles.
- If a directive surface ships, does *control-flow-only* (`:if`, `:show`, `:for`, `:client`, `:defer`) earn its weight while events and state declarations stay JSX-shaped? That subset has no cross-scope identifier problem and no IDE problem.

## Position

**Middle ground. Not the proposal as written.**

The evidence supports a *narrow* directive surface for control flow only — `:if`, `:else`, `:show`, `:for`, possibly `:client` / `:defer` — where the RHS is a typed function or signal reference, **not** a string expression.

Reject from the proposal:
- `:state:name="initialExpr"` — the Svelte 5 regret pattern.
- `:on:click="active.set('place')"` as string-expression form — keep `onClick={…}` JSX-shaped, since events are where TS closure inference matters most.
- The full Vue-style modifier chains (`.prevent` / `.stop` / `.once` / `.capture` / `.passive`). Each one is a precedence-table entry the maintainer pays for forever.

The smaller surface honors non-negotiables 5 and 7 and component-charter commitment 7. It is also one weekend of compiler work, not the multi-quarter Volar-equivalent the full proposal implies.

---

## Sources consulted

- [Svelte 5 migration guide (svelte.dev)](https://svelte.dev/docs/svelte/v5-migration-guide)
- [First thoughts on Svelte 5's runes (Loopwerk)](https://www.loopwerk.io/articles/2025/svelte-5-runes/)
- [Upgrading a Large Application to Svelte 5 (codepeer)](https://codepeer.com/blog/svelte-5-upgrade)
- [From Magic to Mechanics: Svelte 5 Runes (Medium)](https://richard-a-brown.medium.com/from-magic-to-mechanics-a-senior-architects-guide-to-svelte-5-runes-2506f1774128)
- [Vue Vapor Mode — Vue.js Nation 2025 (Vue School)](https://vueschool.io/articles/news/building-vues-high-performance-future-vapor-mode-insights-from-rizumu-ayakas-vue-js-nation-2025-talk/)
- [Vue Vapor benchmarks (BLUESHOE)](https://www.blueshoe.io/blog/vue-vapor-performance-without-virtual-dom/)
- [Solid use:* directive docs](https://docs.solidjs.com/reference/jsx-attributes/use)
- [Solid Discussion #722 — use directive on custom components](https://github.com/solidjs/solid/discussions/722)
- [SolidJS pain points and pitfalls (Medium)](https://vladislav-lipatov.medium.com/solidjs-pain-points-and-pitfalls-a693f62fcb4c)
- [Alpine #570 — x-for perf with large lists](https://github.com/alpinejs/alpine/discussions/570)
- [Alpine #1417 — perf with many DOM elements](https://github.com/alpinejs/alpine/discussions/1417)
- [Alpine #749 — honest drawbacks](https://github.com/alpinejs/alpine/discussions/749)
- [Petite-Vue Discussion #53](https://github.com/vuejs/petite-vue/discussions/53)
- [HTMX sucks (htmx.org essay)](https://htmx.org/essays/htmx-sucks/)
- [A modest critique of Htmx (HN)](https://news.ycombinator.com/item?id=41781457)
- [The Future of Marko (eBay)](https://innovation.ebayinc.com/stories/the-future-of-marko/)
- [What has the Marko team been doing (Carniato)](https://dev.to/ryansolid/what-has-the-marko-team-been-doing-all-these-years-1cf6)
- [Lit built-in directives](https://lit.dev/docs/templates/directives/)
- [Lit repeat directive source](https://github.com/lit/lit/blob/12109c25997ef03180d7eefe05c64e0fb20dd2b0/packages/lit-html/src/directives/repeat.ts)
- [Volar — Vue language tools](https://github.com/vuejs/language-tools)
- [Volar TS-intellisense-disabled issue](https://github.com/johnsoncodehk/volar/issues/1219)
- [Vue v-if vs v-for precedence breaking change](https://v3-migration.vuejs.org/breaking-changes/v-if-v-for.html)
- [eslint-plugin-vue: no-confusing-v-for-v-if](https://eslint.vuejs.org/rules/no-confusing-v-for-v-if)
- [Qwik conditional rendering docs](https://qwik.dev/docs/core/rendering/)
- [Qwik issue #2678 — built-in conditionals](https://github.com/QwikDev/qwik/issues/2678)
