# ADR 0040: Tier 15-A quick wins — `@provisional` tags, `theme()`/`themeTokens()` clarity, `peek()` removal, `discoverPages()` tests

**Status:** accepted (2026-05-16)
**Date:** 2026-05-16
**Affects:** `systems/component/src/viewport.ts`, `systems/component/src/__copy-runtime.ts`, `systems/component/src/theme.ts`, `systems/component/src/build/discover-pages.ts`, `systems/component/src/index.ts`, `systems/design/src/Copy.tsx`, `systems/capability/src/index.ts`, `systems/reactivity/src/index.ts`, `systems/reactivity/tests/unit/scheduler.test.ts`, `systems/reactivity/README.md`, `systems/component/tests/unit/discover-pages.test.ts` (new), `examples/sandbox/src/examples/10-persistence.tsx`, `examples/docs/src/pages/roadmap.page.tsx`.

## Context

The 2026-05-16 state-of-place audit (`docs/audits/2026-05-16-state-of-place.md`) identified four immediate-action items as the highest impact-per-effort fixes available:

1. **Tier 12-13 exports lack `@provisional` tags.** Per the stability covenant, anything without that tag is permanently pinned from the version it shipped in. Six exports were unintentionally heading toward permanence: `cap`, `discoverPages`, `theme`, `viewport`, `configureViewport`, `Copy`, `markCopyUsedOnThisRequest`, `useSearch`.
2. **`themeTokens()` vs `theme()` collision.** Both build theme tokens; no JSDoc explained which to use. New users hit autocomplete and have to guess.
3. **Deprecated `peek(state)` re-export.** The pre-publish freedom directive says no `@deprecated` exports should ship pre-v0.1 publish — just remove the surface.
4. **`discoverPages()` had zero test coverage.** Public API, 148 LOC.

The audit flagged a fifth item — `RenderToHtmlOptions` allegedly orphan — but on inspection both `renderToHtml` (function) and `RenderToHtmlOptions` (interface) are exported correctly. False alarm; no action.

## Decision

### 1. Eight `@provisional` JSDoc tags added

Eight Tier 12-13 exports got `@provisional —` JSDoc lines explaining what may change before v0.1 publish:

| Export | Why provisional |
|---|---|
| `viewport` (namespace) | Accessor shape + `Breakpoint` union (Tailwind v4 names) may evolve |
| `configureViewport()` | Signature may evolve |
| `theme()` | Default `SIBLING_DEFAULTS` color-mix expressions may evolve |
| `discoverPages()` | Directory-walk rules may extend to deeper nesting |
| `cap()` | Anonymous shorthand; `defineCapability` remains canonical |
| `Copy` | May evolve into a compound-component shape |
| `markCopyUsedOnThisRequest()` | Cross-package signaling may consolidate |
| `useSearch()` | Honest interim around an inference gap; may be removable when overloads improve |

Result: future API course-corrections are now explicitly allowed without breaking the stability covenant.

### 2. `theme()` vs `themeTokens()` — canonical choice with cross-references

Both functions kept (back-compat). JSDoc explicitly names `theme()` as **the canonical theme entry-point for v0.1**, with `themeTokens()` as the low-level primitive. Each function's JSDoc now includes `@see` cross-references to the other.

Concrete language:

> **`theme()` (canonical)**: "The canonical theme entry-point for v0.1. Use this for any normal app. The lower-level `themeTokens()` is the underlying primitive — reach for it only when you need to emit `--*` CSS variables that aren't colors (`--shadow-*`, `--radius-*`, etc.) or when you're authoring your own theme-shaped helper."

> **`themeTokens()` (low-level)**: "**Low-level primitive.** For most apps reach for `theme()` (below) instead — it has bare color keys, auto-derived sibling tokens via `color-mix()`, and the same return shape."

A future cut may rename one or fold them together. Today's win: a new user reading the autocomplete now sees "use this for apps" vs "use this for primitives" guidance without having to read both implementations.

### 3. Deprecated `peek(state)` standalone export removed

The standalone `peek(state)` function was deleted from `systems/reactivity/src/index.ts`. The method form `state.peek()` was already shipped and is the canonical replacement.

Migrations performed in this cut:

- `examples/sandbox/src/examples/10-persistence.tsx` — `peek(session)?.dispose()` → `session.peek()?.dispose()`
- `examples/docs/src/pages/roadmap.page.tsx` — string mention updated
- `systems/reactivity/README.md` — example block + bullet list updated
- `systems/reactivity/tests/unit/scheduler.test.ts` — entire describe-block migrated to method form
- `systems/component/src/index.ts` — dropped `peek` from the re-export barrel

The function `__internal` (double-underscore prefix) was also flagged by the API audit as inconsistent with the single-underscore "internal" convention. Deliberately left for a future round — it's only consumed by tests and renaming touches more files.

### 4. `discoverPages()` test suite (12 tests, zero → full coverage)

New file: `systems/component/tests/unit/discover-pages.test.ts`. Builds temporary directory fixtures and exercises:

- Top-level `.page.tsx` discovery
- Both `.page.ts` and `.page.tsx` extensions
- Files without `.page.*` suffix are ignored
- Files prefixed with `_` are skipped (private convention)
- Directories prefixed with `_` are skipped entirely
- Subdirectory `index.ts` imports + array spread via `routes()` composition
- Mixed top-level + subdirectory composition
- Duplicate path detection surfaces ALL offenders in one error
- Missing directory → clear error
- Empty directory → empty array (no error)
- Non-page default exports silently skipped

12 tests, all green. Each uses `mkdtemp` for isolation; no shared fixtures between tests.

## Verification

- All 14 typecheck projects clean
- **1254 tests pass** (1242 + 12 new), 14 skipped
- `peek` exported nowhere in framework code (`grep -r "^export.*\bpeek\b" systems/` returns nothing)
- Every Tier 12-13 export has a `@provisional` JSDoc tag (grep verified)

## Trade-offs

- **`peek()` standalone removal IS a breaking change** — pre-publish so OK per the freedom directive, but external consumers (if any existed) would need the `state.peek()` migration.
- **`@provisional` tags don't ENFORCE anything at compile time.** They're documentation conventions per the stability covenant. A formal `@provisional` linter rule could verify they're respected; out of scope here.

## What's NOT in this cut (carried to Tier 15-B+)

- Per-system charter rewrite (capability, routing, security, data, component, design + `04-interfaces.md`)
- HMR per-island module swap (sub-200ms target)
- The `__internal` (double-underscore) rename
- Design library's arbitrary-Tailwind cleanup (6 files)
- 6 high-traffic primitives still missing JSDoc-with-example (`el`, `Fragment`, `Static`, `notFound`, `tabsState`, `revalidate`)

## Why this passes "magic with clarity"

All four wins are **strictly clarifying**, not adding magic:
- `@provisional` tags are explicit text the user reads
- `theme()` vs `themeTokens()` cross-references are explicit text
- `peek()` removal eliminates a confusing alternative
- Tests exercise the public contract, not hidden behavior
