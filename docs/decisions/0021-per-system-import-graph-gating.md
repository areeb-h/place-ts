# ADR 0021: Per-system import-graph gating (phase 1: kill server-module leaks via dynamic import)

**Status:** accepted, phase 1 shipped (2026-05-14)
**Date:** 2026-05-14
**Affects:** `systems/component/src/index.ts` (imports of
`build/island-bundler.ts` and `build/route-splitter.ts` switched from
static to dynamic); new `systems/component/src/island-validation.ts`
(split out of `build/island-bundler.ts` so the public API can import
validators without dragging in server-only code).

## Context

T5-A audited the docs bundle. T5-B-1 dropped it 77% via per-route
splitting. T5-C dropped content pages to 0 KB via islands. T5-C polish
added hydrate() + 4 mount strategies.

A separate audit (`examples/docs/probes/island-bundle-attribution.ts`)
sourcemap-attributed the per-island bundle and surfaced a real leak:

| Bucket | Raw bytes | Notes |
|---|---:|---|
| `systems/component/src/index.ts` | 13.33 KB | The barrel — irreducible without Tier 1-A split |
| **`node:path`** | **4.44 KB** | **LEAK** — Node module shipped to the browser |
| `systems/reactivity/src/index.ts` | 3.82 KB | Signal core, expected |
| `systems/component/src/_internal/hydration.ts` | 1.71 KB | Full-page hydration helpers |
| `systems/capability/src/index.ts` | 1.35 KB | Capability runtime |
| **`systems/component/src/build/island-bundler.ts`** | **475 B** | **LEAK** — server-only bundler code |
| `systems/component/src/utils/escape.ts` | 256 B | HTML escaping helpers |

The two leaks (`node:path` and `island-bundler.ts`) totaled **~5 KB
raw / ~2 KB gzipped** in every per-island bundle. Root cause: the
framework barrel (`systems/component/src/index.ts`) STATICALLY
imported `buildIslandBundles` and `buildRouteSplitBundles`, both of
which transitively pull in `node:path` and other Node modules.

`__PLACE_BROWSER__` constant-folding correctly dropped the function
calls (the bundlers are only invoked from `_serveImpl`, which is
server-gated), but it could NOT drop the modules themselves — static
imports cause the bundler to evaluate the module for side effects
including loading `node:path`.

## Decision

**Phase 1 (this ADR):** convert the static imports of the bundler
modules to **dynamic imports inside `_serveImpl`**. The `serve()`
function is already gated by `__PLACE_BROWSER__`; when the constant
folds to `true` for browser builds, `_serveImpl` becomes unreachable
and Bun drops the dynamic-import expressions along with their target
modules.

Concretely:

```ts
// Before (static import at top of index.ts):
import { buildIslandBundles } from './build/island-bundler.ts'

// After (dynamic import inside _serveImpl):
const { buildIslandBundles } = await import('./build/island-bundler.ts')
```

To keep the public API ergonomic (the `island()` factory calls
`validateIslandName`), the validators were split out of
`build/island-bundler.ts` into a new tiny module
`systems/component/src/island-validation.ts` that has zero Node-only
imports. The public API imports validators from there.

## Result

Measured via `bun examples/docs/probes/island-bundle-attribution.ts`:

| Metric | Before T5-E | After T5-E phase 1 | Delta |
|---|---:|---:|---:|
| Bundle raw | 26.44 KB | **21.96 KB** | -16.9% |
| Bundle gzipped | 10.35 KB | **8.35 KB** | **-19.3%** |
| `node:path` contribution | 4.44 KB raw | 0 B | gone |
| `island-bundler.ts` contribution | 475 B raw | 0 B | gone |
| Per-route bundle avg (T5-B-1) | 14.01 KB gz | 14.01 KB gz | unchanged (already tree-shaken) |

Per-route bundles didn't change because they tree-shake `serve()` and
its closure already — they don't import `serve` from the framework.
The win is exclusively for per-island bundles whose wrappers DO
import from the framework barrel.

## Consequences

### Positive

- **2 KB per-island reduction** without any architectural change.
- **Static-import-causing-server-leak class of bug closed** for
  islands. Same pattern can be applied to other server-only modules
  in the framework as they're identified.
- **Defense-in-depth on tree-shaking**: even if Bun's tree-shaker
  fails for some pattern in the future, the dynamic-import boundary
  keeps server-only code out structurally.

### Cost

- **One async boundary added per system in `_serveImpl`**. Negligible
  — `_serveImpl` is already async, and the bundler calls are once-
  per-startup, not per-request.
- **TypeScript ergonomics**: dynamic imports return `Promise<Module>`
  with `any` typing; we use `import type { X } from './...'` for the
  type and cast the dynamic-import result. One extra line per dynamic
  import; not painful.

### What this does NOT do (yet)

- **Doesn't shrink `systems/component/src/index.ts` (13.33 KB raw)**.
  The framework barrel still bundles all of its public API. Tier 1-A
  (split index.ts into multiple modules so tree-shaking can prune)
  is the right next step.
- **Doesn't gate per-system code paths conditionally**. The original
  T5-E vision was build-time defines like `__PLACE_USES_CACHE__`
  that strip unused-system code per route/island. That requires
  static analysis of the entry's import graph — deferred until
  Tier 1-A lands (which makes the analysis tractable by reducing the
  barrel's surface).

## Future T5-E phases (deferred)

- **Phase 2**: Tier 1-A interaction. Split `systems/component/src/index.ts`
  per the existing 13-cut plan. Tree-shaking should remove unused
  framework primitives from per-island bundles automatically.
- **Phase 3**: Per-system defines (`__PLACE_USES_CACHE__` etc.) if
  measurements after Phase 2 show specific systems still leaking
  into bundles that don't reference them.
- **Phase 4**: Audit `systems/reactivity/src/index.ts` (3.82 KB raw
  in islands) for further reduction — signals are irreducible, but
  helpers like `resource`, `history`, `batch` may be tree-shakeable
  away in islands that only use `state`/`derived`.

## Verification

- `bun examples/docs/probes/island-bundle-attribution.ts`:
  - `node:path` no longer appears in the bundle
  - `build/island-bundler.ts` no longer appears in the bundle
  - Bundle drops from 26.44 → 21.96 KB raw / 10.35 → 8.35 KB gzipped
- `bun examples/docs/probes/verify-t5c.tsx`: all tests pass
  - 0 KB on no-island pages
  - Strategy attributes correctly emitted
  - hydrate() correctly imported in wrapper
- `bun run typecheck`: clean across all 14 projects
- `bun run test`: 1090 passed / 14 skipped / 0 failed
