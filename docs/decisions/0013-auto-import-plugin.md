# ADR 0013: Auto-import plugin for framework primitives

**Status:** accepted
**Date:** 2026-05-13
**Affects:** `systems/component/src/auto-import-plugin.ts`, `systems/component/src/preload.ts`, `systems/component/src/auto-imports.d.ts`, package.json `exports`, `examples/docs/bunfig.toml`

## Context

By v0.5 the framework primitive surface had grown enough that every
`.tsx` file in a place app started with the same shape:

```tsx
import { Tabs, Activity, ClientOnly, Show, Fragment } from '@place-ts/component'
import { state, watch, derived, onMount, cookieState } from '@place-ts/component'
import { setTheme, themeTokens } from '@place-ts/component'
// then 30 lines of actual component code
```

The user pushed back during the v0.5 polish work: "we have to write so
much still… in the doc code… unnecessary mounts and stuff." Vue (via
unplugin-vue-components), Nuxt (built-in), Svelte (`$state` /
`$derived` runes) all show that auto-import for framework primitives
is a real DX win without the magic-state-mutation downsides those same
ecosystems regretted.

The constraint: place is TypeScript-first and AI-friendliness is a
charter non-negotiable. Any auto-import path that breaks editor
type-checking or hides identifier provenance from `tsc` was a non-
starter.

## Decision

A Bun plugin scans every `.tsx` / `.jsx` file passing through the
build, detects framework identifiers that are referenced but not in
scope, and prepends a single grouped `import { … } from
'@place-ts/component'` line. TypeScript sees those identifiers as
ambient globals via a companion `auto-imports.d.ts`.

### Implementation

Three files form the surface:

1. `auto-import-plugin.ts` — pure plugin factory + the `autoImportTransform`
   function. The transform:
   - Masks strings + comments so identifier names inside literals
     don't trigger false positives.
   - Collects names in scope: imports (named + default + namespace),
     top-level `const`/`let`/`var`/`function`/`class`/`type`/`interface`,
     and source-name halves of renamed imports (`{ state as makeState }`
     marks both `state` and `makeState` as "already accounted for").
   - For each registry name, if it appears word-bounded in the file
     and isn't already in scope, prepends a grouped import line.
   - Idempotent: re-running on already-transformed source is a no-op.

2. `preload.ts` — side-effect module that calls `Bun.plugin(placeAutoImport())`.
   Activated via `preload = ["@place-ts/component/preload"]` in the app's
   `bunfig.toml`. Plugin registers once at runtime startup; affects
   all subsequent file loads.

3. `auto-imports.d.ts` — ambient `declare global` block declaring every
   registry name as a global value-binding typed to `typeof
   import('./index.ts').*`. Apps include via tsconfig:
   `"types": ["@place-ts/component/auto-imports"]` or by appending the
   path to `include`.

The registry (`PLACE_AUTO_IMPORTS`) lives next to the plugin and is
the single source of truth. Adding a new framework primitive adds one
entry to the registry and one matching `const X: typeof _X` line in
the `.d.ts`. Tests cover the registry, transform behavior, and edge
cases.

Scope: framework primitives only. User-defined components stay
explicit imports — this is the deliberate split. unplugin-vue-components
extends auto-import to user components via a project-directory scan;
we don't do that today. Reason: project-component auto-import breaks
grep ("where is `MyCard` defined?") and code-review ("what does this
file pull in?"). The framework primitives are a finite, stable list;
project components are not.

### Tests

`systems/component/tests/unit/auto-import-plugin.test.ts` (10 tests):

- Single missing identifier → single import injected
- Multiple → grouped by source module, sorted
- Already imported → no re-import
- Renamed alias (`{ state as makeState }`) → no auto-import of `state`
- Top-level declaration shadowing → no auto-import
- Comments-only mention → no auto-import
- String-literal mention → no auto-import
- Idempotence (run twice = same output)
- Word boundary (`state` doesn't match `pageState`)
- Registry-coverage spot check

945/945 framework tests green.

### Integration

The framework's own `Bun.build` call (inside `serve()`) registers the
plugin via the build's `plugins` option. The user's runtime (when they
run `bun src/app.ts` directly) gets the plugin via `Bun.plugin()` from
the bunfig preload entry. Both paths share the registry.

The `examples/docs` site demonstrates end-to-end: TypingCode's file
header has no framework imports; the plugin injects `state` and
`onMount` at load time; the docs site builds and renders correctly.

## Consequences

### User-visible

- A new place component file can start with imports of its own
  utilities and project modules only. Framework primitives are
  ambient — used without an import.
- The IDE sees framework names as globals (via the `.d.ts`) and
  navigates to `index.ts` on go-to-definition. Type errors surface
  at the call site with the correct underlying type.
- `bunfig.toml` gains one preload entry. Documented in the framework
  README and in the `create-app` scaffolder template.

### Trade-offs

- File-local grep for "where is `state` defined?" no longer finds an
  import line — it points at `auto-imports.d.ts` (or `index.ts` via
  the `typeof import('./index.ts').state` chain). Acceptable for
  framework primitives; not acceptable for app components, which is
  why we don't extend the scan to project files.
- The plugin is one more piece of infrastructure to keep working.
  Mitigated by the 10-test coverage and the small surface (~150 LOC).
- Build-time transformation introduces a small per-file cost on cold
  builds. Negligible (<1 ms per file in our measurements).

### Architectural

- Reinforces the "framework primitives are special" line. Users see
  them as globals; user components are explicit. The split matches
  the charter's "everything else explicit, framework structurally
  invisible."
- Plugin pattern paves the way for future build-time transforms (the
  template-hoisting compile-out from `05-bundle-and-stack-research.md`
  is the obvious next plugin to slot in).

## Out of scope

- User-component auto-import (Vue's directory-scan model). Deferred
  until a real ergonomic complaint about explicit user-component
  imports arrives.
- Wildcard imports / `import * as` style. The registry is finite and
  named-import-only.
- Removing the preload requirement. Possible if the framework moves
  to a custom CLI entry point (`bunx place dev`); not a priority
  today.
