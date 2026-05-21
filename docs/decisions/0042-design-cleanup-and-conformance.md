# ADR 0042: Tier 15-D + 15-F — design library Tailwind cleanup + charter conformance tests

**Status:** accepted (2026-05-16)
**Date:** 2026-05-16
**Affects:** `systems/design/docs/00-charter.md`, `systems/design/src/{presentational,Toast,Dialog,Field,Menu,CodeBlock}.tsx`, `systems/design/tests/unit/{CodeBlock,presentational}.test.ts`, `systems/component/src/theme.ts`, `systems/component/tests/unit/viewport.test.ts`, `tests/conformance/{component,routing,design}.charter.test.ts` (new for routing + design).

## Context

The 2026-05-16 audit + ADR 0041 carryforward left two pieces of Tier
15 unfinished:

1. **Design library charter drift** — `systems/design/docs/00-charter.md`
   listed Button as the only shipped export, with everything else as
   "Backlog: …". Reality shipped 12 components plus a tokenizer
   subsystem (per ADRs 0033, 0036, 0037). The same charter declares
   non-negotiable #6 ("No arbitrary Tailwind values bypassing the
   token scale") — but six design-library files violated it via
   `text-[10px]` / `text-[12px]` / `text-[oklch(...)]` /
   `bg-[color-mix(...)]` patterns.

2. **No charter conformance tests** — the audit identified that
   architectural commitments lived only in prose. A future code
   change can silently violate a charter clause without anything
   tripping. Component + reactivity already had conformance test
   files; routing and design did not.

Both pieces were grouped together because they share the same
underlying spine: **a charter clause is only durable if there's a
test against it**. T15-D restates the design library's clauses
clearly; T15-F pins them (and routing's, and component's) into
runtime checks.

## Decision

### T15-D — design library Tailwind cleanup + charter refresh

**Charter (`systems/design/docs/00-charter.md`):**

- §Public surface now lists all 12 shipped components (`Button`,
  `Field`, `Input`, `Textarea`, `Dialog`, `Toast`, `Tooltip`,
  `Menu`, `Avatar`, `Badge`, `Card`, `Copy`, `CodeBlock`) plus the
  tokenizer family (`tokenizeTs`, `tokenizeJson`, `tokenizeCss`,
  `tokenizeHtml`, `tokenizePython`, `registerLanguage`). §Status
  drops the "Backlog: …" line.

- §Architectural commitments NN#6 rewritten to be enforceable:
  > Typography MUST be tokenized — no `text-[12px]` /
  > `leading-[1.45]` / arbitrary font-size literals at any call
  > site. Color literals MUST be tokenized — no inline
  > `text-[oklch(...)]` / `bg-[color-mix(...)]`. Component-layout
  > constraints (`min-w-[10rem]`, `max-w-[min(560px,92vw)]`) ARE
  > allowed when documented in a code comment explaining why the
  > constraint is a design decision, not a styling escape hatch.

- Tokenizer subsystem section added — sanctions the tokenizer family
  as a charter surface (was implicit before; ADR 0033/0036/0037
  established it but the charter never said so).

**Source migration:**

- `systems/design/src/presentational.tsx` — Badge `text-[10px]`/
  `text-[11px]` → `text-xs`. Size differentiation moves to padding
  (`px-1.5` vs `px-2`). Intent variants `bg-[oklch(...)]
  text-[oklch(...)] border-[color-mix(...)]` → tokenized
  `bg-success/12 text-success border-success/40` (and the same
  pattern for `warn`, `destructive`).

- `systems/design/src/Toast.tsx` — same OKLCH → token migration.
  Justified component-layout constraints (`min-w-[280px]`,
  `max-w-[420px]`) documented inline with a comment.

- `systems/design/src/Dialog.tsx` — size variants
  `max-w-[min(420px,92vw)]` etc. documented as justified
  component-layout decisions (would be re-specified at every Dialog
  call site otherwise).

- `systems/design/src/Menu.tsx` — `min-w-[10rem] max-h-[60vh]`
  documented as justified (popover must be readable but bounded by
  viewport).

- `systems/design/src/Field.tsx` — `min-h-[5rem]` on Textarea
  documented as justified (textarea needs a sensible starting
  height before content fills it).

- `systems/design/src/CodeBlock.tsx` — density variants migrated
  from `text-[12px]/text-[13px]/text-[14px]` to `text-xs/sm/base`.
  Header `text-[11px]` → `text-xs`. `rounded-[10px]` → `rounded-lg`.

**Theme tokens:**

- `systems/component/src/theme.ts` `SIBLING_DEFAULTS` extended with
  `success`, `success-fg`, `warn`, `warn-fg` so apps using the
  canonical `theme()` (vs. the lower-level `themeTokens()`) get the
  new tokens for free. Defaults are OKLCH literals tuned to read
  well in both light and dark contexts.

**Tests:**

- `systems/design/tests/unit/CodeBlock.test.ts` — assertions updated
  from `text-[12px]/text-[14px]` to `text-xs/text-base`.
- `systems/design/tests/unit/presentational.test.ts` — Badge size
  test now asserts both sizes use `text-xs` (sizes distinguished by
  padding, not font size).

### T15-F — conformance tests for routing, design, component charters

**Pattern:** one test per architectural commitment in the charter.
Files live at `tests/conformance/<system>.charter.test.ts`. The test
name format `'charter: <commitment paraphrase>'` lets readers find
the test that pins any commitment.

**New files:**

- `tests/conformance/component.charter.test.ts` (7 tests) — routes
  are values, duplicate paths throw at `app()` time, `page()` shape
  has no `__server`/`__client` markers, load data is one
  `<script type="application/json" id="__place_load__">` tag, load
  data is HTML-escape-safe (`</script>` payload becomes
  `</script>`), page-level `revalidate` lives on the
  page def, no `'use server'`/`'use client'` string markers.

- `tests/conformance/routing.charter.test.ts` (9 tests) — `route()`
  builds typed URL helpers (callable directly: `r(params)`, not
  `r.build(params)` — caught and fixed during this round),
  `routes(prefix, [pages])` prefixes paths declaratively, params
  typed from path literal, `route().match()` extracts typed params,
  `parsePath` returns `{ segments, query }` (not
  `{ pathname, search, hash }` — caught and fixed during this
  round), `Router.path()` is reactive, Router exposes
  navigate/replace/back/forward/query, `serverRouter(req)` refuses
  all navigation methods, `RouterHandle` is triple-duty (Router +
  Provision + Disposer).

- `tests/conformance/design.charter.test.ts` (6 tests) — components
  are importable values (no copy-paste model), components use
  tokenized typography (no `text-[Npx]` literals), components use
  token-bound colors (no inline `text-[oklch(...)]` /
  `bg-[oklch(...)]` / `border-[color-mix(...)]`), recipe variants
  produce different class output (recipes ARE the API), components
  do not accept `asChild` (no Radix-style polymorphism), tokenizer
  subsystem is sanctioned (CodeBlock emits `tok-keyword` / `tok-number`
  classes — proving the tokenizer ran).

**Existing-file extensions:**

- `systems/component/tests/unit/viewport.test.ts` — added a
  "Tier 15-F edge cases" describe block covering: thresholds
  inclusive, 1px below thresholds, zero/negative widths,
  `Number.MAX_SAFE_INTEGER`, `viewport.matches(query)` cache
  invariant (same query → same `Derived` instance — important so
  consumers can subscribe once + share), `configureViewport` called
  twice (latest wins).

### Why the routing test had to be rewritten mid-cut

The initial draft assumed `RouterHandle` was a tuple
`[Capability, factory]` and `route()` returned a builder with
`.build(params)`. Neither matches shipped reality:

- `RouterHandle` is `interface RouterHandle extends Router, Provision`
  with `capability`, `impl`, `dispose()` fields
  (`systems/routing/src/index.ts:471`). The triple-duty pattern is
  one object with three roles, not a tuple.
- `Route<P>` is `(params: P) => string` — directly callable
  (`systems/routing/src/index.ts:230`). No `.build()` method.
- `ParsedPath` is `{ segments, query }` not
  `{ pathname, search, hash }` (`systems/routing/src/index.ts:158`).
- `Router` has `path()` / `query()` / `param(key)` / `segment(i)` /
  `navigate()` / `replace()` / `back()` / `forward()` — no
  `search()` or `hash()` methods (they're inside `query()`).
- `routes(prefix, [pages])` lives in `@place-ts/component`
  (`systems/component/src/app.ts:523`) for circularity reasons, not
  in `@place-ts/routing`.

The rewrite is a record of those facts. The conformance test now
matches the actual API and acts as a future regression gate against
re-introducing the wrong shapes.

## Verification

- All 14 typecheck projects status unchanged (pre-existing root-tsc
  DOM-globals noise is a separate, unrelated concern).
- All **1282 tests pass / 14 skipped** (was 1254 pre-T15-F;
  +22 tests from new conformance files and the viewport edge-case
  block — one slightly above the predicted +20).
- `bun run test:conformance` — 32 tests, 4 files, all pass.
- No design-library file contains `text-[Npx]` or inline OKLCH
  literals; the design conformance test fails if either pattern
  reappears.

## What's NOT in this cut

- **HMR per-island module swap (T15-E)** — sub-200 ms target;
  multi-hour architectural undertaking. Carried to its own
  dedicated session. ADR 0028 design is the starting point.
- **Tier 16 widgets** (Table/DataGrid, Image-with-sharp,
  Form-with-Zod, Combobox/Sheet, Can for RBAC, real-time sync-server
  finish). Separate planning round after T15-E closes.
- **Reactivity charter conformance test** — already existed before
  this cut.

## Why this passes "magic with clarity" (ADR 0026)

The charter refresh makes the design library's typography contract
**discoverable** (one place to read what's allowed and what isn't).
The conformance tests make it **traceable** (a code change that
violates the charter trips a named test). Bundle-size impact is
neutral — no new runtime code; the migration is class-name
substitution. NN#6's narrowing — "typography MUST be tokenized;
component-layout pragmatic" — is the most-impactful structural call
in this cut. It resolves a year-long tension between "no escape
hatches" (the original NN#6) and "every Menu needs `min-w-[10rem]`"
(the practical reality) by drawing the line at where the value
participates in the design system's contract (typography does;
component-internal layout doesn't).

## Tier 15 status after this cut

| Cut | Status |
|---|---|
| T15-A | ✓ (ADR 0040) |
| T15-B + T15-C | ✓ (ADR 0041) |
| T15-D + T15-F | ✓ (this ADR) |
| T15-E | ⏸ deferred to dedicated session (HMR per-island module swap) |
