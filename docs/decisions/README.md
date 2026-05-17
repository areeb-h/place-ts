# Architecture Decision Records (ADRs)

Decisions that shape the platform get recorded here. An ADR is short, self-contained, and immutable once accepted (superseded, not edited).

## When to write one

- A choice between two or more viable alternatives, where future readers will want to know why.
- A change to an interface in `docs/platform/04-interfaces.md`.
- An addition or removal from the system map.
- A change in tooling that affects more than one system.
- A reversal of a previous ADR (the new ADR supersedes the old one explicitly).

## When *not* to write one

- Implementation details inside one system. Use the system's docs.
- Bug fixes. Use commit messages.
- Personal preferences. Use the journal.

## Format

Each ADR lives at `NNNN-short-title.md` where `NNNN` is a zero-padded sequential number. Use the template:

```markdown
# ADR NNNN: <short title>

**Status:** proposed | accepted | superseded by ADR NNNN | deprecated
**Date:** YYYY-MM-DD
**Affects:** <systems>

## Context

What forced this decision. The constraints. What we know.

## Options considered

1. **Option A** — description, pros, cons
2. **Option B** — description, pros, cons
3. **Option C** — description, pros, cons

## Decision

The chosen option, in one sentence.

## Consequences

What changes downstream. What's now harder. What's now easier. What we'll watch for.

## Notes

Optional. Things future readers might find useful — links, references, follow-ups.
```

## Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [0001](0001-stack-bun-typescript.md) | Stack — Bun-everywhere + TypeScript latest | accepted | 2026-05-01 |
| [0002](0002-jsx-shape-via-ts-automatic-runtime.md) | JSX-shape via TypeScript's automatic JSX runtime | accepted | 2026-05-01 |
| [0003](0003-page-as-data-and-the-server-framework.md) | Page-as-data and the server framework inside the component system | accepted | 2026-05-04 |
| [0004](0004-theming-and-page-decoration.md) | Theming + page decoration via meta htmlClass/bodyClass | accepted | 2026-05-05 |
| [0005](0005-cache-no-per-request-state.md) | `cache()` is structurally isolated from per-request caps | accepted | 2026-05-07 |
| [0006](0006-view-transitions.md) | View Transitions API opt-in | accepted | 2026-05-08 |
| [0007](0007-smaller-app-arc.md) | The smaller-app arc: `app([pages])` + `page(path, def)` + `on:` | accepted | 2026-05-11 |
| [0008](0008-port-the-insight-not-the-shape.md) | Port the insight, not the shape (virtualList, future Dialog/Table) | accepted | 2026-05-12 |
| [0009](0009-commonplace-flagship.md) | Commonplace as flagship — what the demo proves | accepted | 2026-05-12 |
| [0010](0010-place-browser-define.md) | `__PLACE_BROWSER__` build define for server-only DCE | accepted | 2026-05-13 |
| [0011](0011-layout-persistence-boot.md) | Layout persistence in `boot()` — page swaps without remounting the chain | accepted | 2026-05-13 |
| [0012](0012-fragment-reactive-children.md) | Fragment.hydrate handles reactive function children | accepted | 2026-05-13 |
| [0013](0013-auto-import-plugin.md) | Auto-import plugin for framework primitives | accepted | 2026-05-13 |
| [0014](0014-csp-safe-style-writes.md) | CSP-safe inline style writes via `CSSStyleDeclaration.setProperty` | accepted | 2026-05-13 |
| [0015](0015-motion-as-reactivity-submodule.md) | Motion lives in `@place/reactivity/motion`, not a separate system | accepted | 2026-05-13 |
| [0016](0016-design-library-as-package.md) | `@place/design` is a package, not a 10th system | accepted | 2026-05-13 |
| [0017](0017-canvas-deferred-pending-devtool.md) | Canvas / scene-graph system deferred until devtool trigger | accepted | 2026-05-13 |
| [0018](0018-per-route-bundle-splitting.md) | Per-route bundle splitting (T5-B-1) | accepted | 2026-05-14 |
| [0019](0019-typed-islands-not-string-directives.md) | Typed islands, not string directives | accepted | 2026-05-14 |
| [0020](0020-island-security-hardening.md) | Island security hardening | accepted | 2026-05-14 |
| [0021](0021-per-system-import-graph-gating.md) | Per-system import-graph gating | accepted | 2026-05-14 |
| [0022](0022-island-shared-chunks.md) | Island shared chunks via Bun `splitting: true` | accepted | 2026-05-14 |
| [0023](0023-islands-as-the-only-hydration-model.md) | Islands as the only hydration model | accepted | 2026-05-14 |
| [0024](0024-spa-nav-and-island-dx.md) | SPA navigation + island DX | accepted | 2026-05-15 |
| [0025](0025-sri-and-attack-surface-reduction.md) | SRI + attack-surface reduction | accepted | 2026-05-15 |
| [0026](0026-magic-with-clarity.md) | Charter pivot: "magic with clarity" | accepted | 2026-05-15 |
| [0027](0027-thaw-resumability.md) | "Thaw" — resumability, our way | proposed | 2026-05-15 |
| [0028](0028-place-hmr.md) | Place HMR — typed-island boundaries, effect-aware preservation | proposed | 2026-05-15 |
| [0029](0029-place-streaming.md) | Place streaming — suspense-driven, request-coalesced | proposed | 2026-05-15 |
| [0030](0030-unified-hydration.md) | Unified hydration via effect-typed classification (`view()`) | proposed | 2026-05-15 |
| [0031](0031-page-directive-ergonomics.md) | Page directive ergonomics: string `meta`, title templates, `<h1>` auto-title | accepted | 2026-05-16 |
| [0032](0032-dev-supervisor.md) | Dev-mode self-supervisor: instant auto-reload from `bun src/app.ts` | accepted | 2026-05-16 |
| [0033](0033-customizable-codeblock.md) | `<CodeBlock>` as a highly customizable design-library primitive | accepted | 2026-05-16 |
| [0034](0034-viewport-reactivity.md) | `viewport` — framework-level reactive screen-size primitive | accepted | 2026-05-16 |
| [0035](0035-typography-in-themetokens.md) | Typography lives in `themeTokens()` | accepted | 2026-05-16 |
| [0036](0036-generic-ui-primitives.md) | Generic UI primitives — `<Copy>`, `--tok-*`, `.place-lines-*` | accepted | 2026-05-16 |
| [0037](0037-tokenizer-v2-1-extensions.md) | Tokenizer V2.1 — JSON / CSS / HTML / Python + TS generics fix | accepted | 2026-05-16 |
| [0038](0038-theme-helper-dx.md) | `theme()` helper + framework defaults + CodeBlock visual fixes | accepted | 2026-05-16 |
| [0039](0039-discover-pages-and-styles-array.md) | `discoverPages()` + `styles: string[]` — DX wins for `app.ts` | accepted | 2026-05-16 |
| [0040](0040-quick-wins-tier-15-a.md) | Tier 15-A quick wins — `@provisional` tags, theme/themeTokens clarity, `peek()` removal, `discoverPages()` tests | accepted | 2026-05-16 |
| [0041](0041-charter-sweep-tier-15-b-c.md) | Tier 15-B + 15-C — per-system charter rewrite sweep | accepted | 2026-05-16 |
| [0042](0042-design-cleanup-and-conformance.md) | Tier 15-D + 15-F — design library Tailwind cleanup + charter conformance tests | accepted | 2026-05-16 |
| [0043](0043-hmr-per-island-swap.md) | Tier 15-E phase 2 — typed-envelope HMR + per-island module swap | accepted | 2026-05-16 |
| [0044](0044-can-rbac-gate.md) | Tier 16-E — `<Can do="…">` RBAC gate primitive | accepted | 2026-05-17 |
| [0045](0045-from-standard-schema-interop.md) | Tier 16-C — `fromStandard()` schema interop + field-level error packaging | accepted | 2026-05-17 |
| [0046](0046-sheet-and-combobox.md) | Tier 16-D — `<Sheet>` + `<Combobox>` primitives | accepted | 2026-05-17 |
| [0047](0047-combobox-flex-shell.md) | Tier 17-A — Combobox flex-shell restructure (fix `pl-8!` Tailwind quirk + audit findings) | accepted | 2026-05-17 |
| [0048](0048-popover-substrate.md) | Tier 17-B — unified popover substrate via CSS Anchor Positioning (kill 3 JS positioners) | accepted | 2026-05-17 |
| [0049](0049-light-dark-theme.md) | Tier 17-C — `light-dark()` theme migration (drop `.dark`-class proliferation) | accepted | 2026-05-17 |
| [0050](0050-classnames-customization-contract.md) | Tier 17-D — typed `class` + `classNames` customization contract | accepted | 2026-05-17 |
