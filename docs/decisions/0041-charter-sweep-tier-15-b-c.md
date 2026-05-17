# ADR 0041: Tier 15-B + 15-C — per-system charter rewrite sweep

**Status:** accepted (2026-05-16)
**Date:** 2026-05-16
**Affects:** `systems/capability/docs/00-charter.md`, `systems/routing/docs/00-charter.md`, `systems/security/docs/00-charter.md` (new), `systems/data/docs/00-charter.md`, `systems/component/docs/00-charter.md`, `docs/platform/00-system-map.md`, `docs/platform/04-interfaces.md`.

## Context

The 2026-05-16 audit (`docs/audits/2026-05-16-state-of-place.md`)
flagged charter drift as the dominant pattern across Tier 7-13:
ADRs landed, source surface grew, system charters were not touched.
The headline cases:

- `systems/capability/docs/00-charter.md` described an API
  (`handle(kinds, handler, body)`) bearing no resemblance to the
  shipped `defineCapability` / `provide` / `use` surface.
- `systems/routing/docs/00-charter.md` was a v0.3 stub promising
  loaders / transitions that aren't shipped.
- `systems/security/` had no charter file at all and wasn't on the
  system map.
- `systems/data/docs/00-charter.md` promised typed queries / loaders
  / source-of-truth abstraction; reality ships exactly one helper
  (`collection<T>()`).
- `systems/component/docs/00-charter.md` was missing ~6 Tier 12-13
  features (discoverPages, theme, viewport, typography, titleTemplate,
  dev supervisor) from the §What this system owns list.
- `docs/platform/04-interfaces.md` declared
  `PersistenceAdapter<T>` as `initial / observe(next) / write / conflict?`;
  shipped is `load / save / observe(void) / refresh?`.
- `docs/platform/00-system-map.md` still listed `cache` as a v0.2
  shipping system; `systems/cache/README.md` says deferred
  indefinitely. `security` shipped but wasn't on the map.

## Decision

Rewrite each charter to match shipped reality, using ADR 0026's
"magic with clarity" gate as the spine:

### `systems/capability/docs/00-charter.md` (rewrite)

New thesis: "A capability is a typed runtime slot for an effect."
Lists the eight shipped exports — `defineCapability` / `cap` (with
`@provisional` note) / `.install` / `.provide` / `.use` / `.tryUse` /
`requires` / `Provision` — plus `ClientOnlyAbort`,
`runWithCapabilityScope`, and the effect-kind brand types. Explains
ALS-as-structural-scope-enforcement (vs ALS-as-implicit-globals per
07-prior-art-failures). Six architectural commitments. Phase: v0.1
shipped, stable. Effect-kind brands tagged `@provisional` until view-
classifier (Tier 9) stabilizes.

### `systems/routing/docs/00-charter.md` (rewrite)

New thesis: "Routes are values, paths are typed at the call site,
the URL is reactive state." Lists shipped surface: `Router` +
`RouterCap`, three router factories + `serverRouter`, `<Link>`,
`route()` / `searchParams()`, `parsePath`, `routes('/prefix', [pages])`,
the `place:nav` cross-system event. Five architectural commitments.
Open questions section names loader-coupling + capability-typed
route guards as deferred to Tier 16+.

### `systems/security/docs/00-charter.md` (new)

First charter for the security system. Thesis: "Web security is a
substrate problem, not a feature; the easy path is the safe path."
Lists the five primitives (`signedToken`, `csrfToken`, `rateLimit`,
`SessionCap` + `requireSession`, cookie helpers + CSP defaults) plus
the cross-system contracts that bind `serve({ security: 'standard' })`
to per-response nonces, auto-CSRF, and same-origin enforcement.
Five architectural commitments including "constant-time comparisons"
and "no middleware framework." Phase v0.1 shipped, stable.

### `systems/data/docs/00-charter.md` (scope-down rewrite)

Honest version: the system ships ONE helper (`collection<T>()`).
The broader v0.2 design (typed queries / mutations / source-of-truth
abstraction) is deferred until a real use case shows the reactivity
primitives can't carry it. Four architectural commitments led by
"anti-bloat first." Open questions list the speculative additions
that may show up in v0.2 if triggered. Three exports total — the
smallest charter-defining surface in the platform.

### `systems/component/docs/00-charter.md` (§What this system owns refresh)

Added an "App-level DX layer (Tier 12-13)" subsection covering
`theme()`, typography in `themeTokens()`, `viewport`, `<Copy>`
runtime emission, and the framework-level inline runtimes
(`placeHmr` / `placeSpaNav` / `placeTabs` / `placeDeferredIslands` /
`placeViewport` / `placeCopyRuntime` / `placeEarly`). Renamed
commitment #6 from "No built-in caches" (which was contradicted by
shipped ISR + the image optimizer) to "Page-level `revalidate`
lives at the framework boundary, not inside components." Renamed
commitment #7 from "No codegen" to "Codegen is allowed only when
it doesn't hide intent (per ADR 0026)" — the islands bundler writes
`.place/island-entries/_auto-init.ts` and that's an acceptable
inspection-friendly form of codegen. Added top-of-file note that
Tier 12-13 additions are tagged `@provisional`.

### `docs/platform/04-interfaces.md` (persistence-adapter shape fix)

Rewrote the `PersistenceAdapter<T>` section from the v0.3 sketch
(`initial / observe(next) / write / conflict?`) to the shipped
shape (`load / save / observe(void) / refresh?`). Added a note
explaining why each field changed (conflict moved to sync-server
adapter; refresh added for pull-to-refresh; observe signature
narrowed to a signal-only callback so consumer-driven load() picks
up the new value, not the event). Added the adapter family list
(`localStorageAdapter` / `indexedDBAdapter` / `serverAdapter` /
`memoryAdapter` / `crossTabAdapter`). Corrected the `persistedState`
location — lives in `@place/persistence`, not `@place/reactivity`.

### `docs/platform/00-system-map.md` (refresh)

- `cache` removed from the nine-system table (deferred per
  `systems/cache/README.md`); the framework's internal `CacheStore`
  is now noted as `@place/component` implementation detail.
- `security` promoted onto the table as system #8 (between
  capability and build).
- Every row's §Owns column refreshed to match shipped surface
  (component gets the islands-only / dev-supervisor / app-DX
  additions; routing gets `Router` / `<Link>` / typed schemas;
  persistence gets the full adapter family; data is reality-aligned
  to "one helper"; search is reality-aligned).
- Dependency Mermaid graph updated: `cache` node removed; `security`
  added with the right edges (`capability → security → component`).
- "v0.3 changed" subsection retained but rephrased to match the
  current "v0.1 shipped" status.

## Verification

- All 14 typecheck projects clean (docs-only changes, no code
  touched)
- All **1254 tests pass** (no regressions)
- No charter still lists features that don't ship; no shipped
  feature is missing from its charter

## What's NOT in this cut (Tier 15-D / 15-E)

- **Design library charter refresh** — `systems/design/docs/00-charter.md`
  still lists Button as the only export with the rest as backlog;
  reality ships 12 components + a tokenizer surface. Carried to
  T15-D.
- **Arbitrary-Tailwind cleanup in 6 design-library files**
  (`presentational.tsx`, `Toast.tsx`, `Dialog.tsx`, `Field.tsx`,
  `Menu.tsx`, `CodeBlock.tsx`). Carried to T15-D.
- **HMR per-island module swap** (sub-200 ms target, ADR 0028
  design). Largest remaining piece. Carried to T15-E.
- **`__internal` (double-underscore) rename** in reactivity. Minor
  internal nit.

## Why this passes "magic with clarity"

Charter rewrites are pure documentation — they describe shipped
surface accurately. The architectural commitments in each are
explicit; the open-questions sections name deferred work; the
"@provisional" tags from ADR 0040 are referenced where they apply.
Every claim a reader makes against a charter can be checked against
`src/index.ts`'s exports.
