# ADR 0056: Bounded entrypoint subpaths — client safety is an impossible import graph, not DCE

**Status:** accepted
**Date:** 2026-05-20
**Affects:** `@place/component` (`exports` map + per-subpath barrels); `examples/docs/probes/forbidden-imports.ts` (CI gate)

## Context

`@place/component` started life as one 9,518-line `index.ts` that
exposed: the JSX runtime, the SSR engine, the client-mount runtime,
the build tools, the static-export pipeline, the per-island bundler,
the per-route splitter, framework-internal helpers, and the public
authoring API — all behind one default subpath. Client safety relied
on `__PLACE_BROWSER__` build defines: Bun.build's `define` injected
`__PLACE_BROWSER__: 'true'` on browser builds, and every server-only
branch was wrapped in `if (typeof __PLACE_BROWSER__ === 'undefined')`
so DCE could drop it.

**The problem with DCE-as-safety:**

- It's load-bearing on a build flag. A misconfigured `define` (typo,
  wrong target, missed via a custom build pass) silently ships
  server code to the browser.
- It's not auditable from outside the framework — the safety lives
  inside the compiler, not the source.
- It bloats the source: every server-side helper inside `index.ts`
  has to be defensive about whether the calling code path is
  reachable from a browser bundle.
- It can't be proven; you have to trust the bundler. The forbidden-
  imports probe could check the output, but the SOURCE doesn't
  encode the rule.

Tier 20's strategic call: replace "DCE drops it" with **"the import
graph cannot reach it"**. Each subpath has a documented reach; the
build tool would have to invent a new edge to violate the rule.

## Decision

Split `@place/component`'s exports map into bounded subpaths, each
backed by a small re-export barrel:

| Subpath | Allowed reach | Holds |
|---|---|---|
| `.` (root) | Universal | `page`, `layout`, `el`, JSX components, `state` re-exports, `<Link>`, `<Show>`, `<Suspense>`, `recipe`, …  — code safe in any runtime |
| `/server` | Server-only | `serve`, `app`, `routes`, `renderToString`, `renderToStream`, `renderPage`, `action()`, `criticalAction()`, cookies, security headers, `discoverPages`, `buildStatic` |
| `/client` | Client / island only | `mount`, `hydrate`, `installActionKey`, `clearActionKey` |
| `/islands` | Client / island authoring | `island()`, `Island`, `IslandComponent`, `ClientStrategy`, related types |
| `/build` | Build-time only | `buildIslandBundles`, `buildRouteSplitBundles`, `discoverIslands`, view classifier, build-static |
| `/internal` | Tests / framework internals | `_`-prefixed registry hooks (hydration deltas, island registry setters, etc.) |
| `/jsx-runtime` | Anywhere | `el` factory for the TS `react-jsx` automatic runtime |
| `/tailwind`, `/preload`, `/auto-import-plugin`, `/adapters/node` | Build-time / boot-time | Helper subsurfaces |

**Enforcement rule** (the safety mechanism):

```
client / island entry → may import: ., /client, /islands, /jsx-runtime
server entry          → may also import: /server
build entry           → may import everything
```

A client bundle that imports `@place/component` reaches only the
root barrel — which by construction does not re-export `serve()`,
`Bun.build`-using helpers, or any `node:*`-touching code. The build
tool cannot follow an edge that isn't in the source.

**CI gate.** `examples/docs/probes/forbidden-imports.ts` runs in
`bun run ci`. It builds the docs production output and grep-scans
every emitted `.js` for tokens that MUST NOT reach the browser:

- `node:` (any builtin import)
- `Bun.serve` / `Bun.build` / `Bun.file` / `Bun.spawn`
- `child_process`
- `fs/promises`

These tokens survive minification because they're property accesses
on `globalThis`/`Bun` or string-literal module specifiers — a
minifier can rename locals but not a `Bun.serve` call. First clean
run (cut 6): 16 client bundles, 46.7 KB gz total, **zero forbidden
tokens**.

## Options considered

1. **Keep `__PLACE_BROWSER__` DCE as the only safety mechanism.**
   - Pro: zero refactor.
   - Con: relies on the compiler. A wrong `define`, a custom build
     step, a sourcemap-rewrite plugin — anything that misses the
     define silently ships server code. The safety is not in the
     source.

2. **One subpath per system (`@place/component/routing`, etc.).**
   - Pro: even cleaner separation.
   - Con: more surface to maintain; per-system splits don't map to
     the actual safety boundary (the boundary is "server / build vs
     client", not per-system).

3. **Bounded subpaths matched to safety domains** (chosen).
   - Pro: the safety boundary is documented as the subpath; the
     import graph IS the audit trail. CI probe enforces it.
   - Con: more files; consumers have to know which subpath to
     import from. Mitigated by: most apps just import from `.`
     (the root); only build tools + framework internals reach
     the specialised subpaths.

## Consequences

### What's now harder

- Apps that previously deep-imported `import { serve } from '@place/component'`
  must update to `@place/component/server`. (`serve` was always
  server-only; the old behaviour relied on DCE.)
- New framework-side exports must choose a subpath at write time.
- Adding a new subpath requires updating: the `package.json`
  `exports` map, the `tsconfig.json` `paths` map, and
  `vitest.config.ts`'s alias map (root-level test files don't go
  through workspace `node_modules` symlinks; vitest needs explicit
  aliases).

### What's now easier

- **Client safety is provable, not asserted.** The forbidden-imports
  CI probe is the runtime proof; the subpath structure is the design.
  A reviewer can `grep` the source and answer "can this module
  reach `Bun.serve`?" by tracing imports — no need to understand
  the build pipeline.
- **Tree-shaking is more reliable.** The barrel-shape concern
  (where a barrel re-exports things consumers don't use) is less
  load-bearing when there are FOUR small barrels instead of ONE
  enormous one. The bundler's job is simpler.
- **Framework decomposition is cheaper.** The 9,518-line `index.ts`
  is in the middle of a decomposition (see `research-file-split-plan.md`).
  The bounded subpaths give each extracted module a clear home;
  cuts can proceed without renegotiating the public surface.
- **FIPS-compliance audit** (per ADR 0055): an auditor can verify
  that the `criticalAction()` HMAC code only ships in server
  bundles by checking that it's exported only from `/server`, and
  no client subpath re-exports it. No need to read the build
  configuration.

### What we'll watch for

- Drift: every new public export must be placed correctly. A
  reviewer rule + the CI probe catch the cases that matter (server
  code leaking to client) but a misplaced public symbol (e.g.
  putting a client helper on `/server`) wouldn't trip the probe.
  Mitigation: code review + the small surface area means errors
  are visible.
- The `package.json` `exports` field is duplicated in three places
  (component package, tsconfig paths, vitest alias). They MUST
  stay in sync; a single source of truth would be nicer but no
  tool currently provides one cleanly. The forbidden-imports CI
  catches divergence in the worst case (an import that resolves
  in tests but not in prod, or vice versa).

## Notes

- Companion to ADR 0010 (`__PLACE_BROWSER__` define). The define
  is NOT going away — it's still useful for in-file dev-vs-prod
  gating (e.g. HMR runtime stripped in prod). But it's no longer
  the **safety boundary**; that's now the import graph.
- Companion to ADR 0021 (per-system import-graph gating). Per-system
  gating works one level deeper: WITHIN the server subpath, each
  system's contribution should be tree-shakeable. Subpath bucketing
  is the coarse safety; per-system gating is the fine bundle-size
  optimisation. Both compose.
- Companion to ADR 0055. The criticalAction HMAC verification +
  per-session key derivation only ships from `/server`. The
  envelope-canonicalisation helpers are SHARED between server
  (verify) and client (sign), so they're also reachable from
  `/client`. The bounded reach makes this rule audit-checkable.
- Phase 3 implementation cuts (per the Tier 20 plan):
  1. ✓ `@place/component/client` extracted (cut 1a).
  2. ✓ `@place/component/build` extracted; `/server`, `/islands`,
     `/internal`, `/jsx-runtime` audited (cut 1b).
  3. (pending) `clientEntry` legacy path removal — the deprecated
     single-bundle code path still woven through `_serveImpl`.
  4. (pending) Physically extract `serve()` + the build pipeline
     out of `index.ts` (currently re-exported from `index.ts` but
     still living there; `research-file-split-plan.md` has the
     deeper plan).
  5. (pending) `place explain <route>` / `place why-js <route>` —
     the diagnostics CLI that reads the build manifest and shows
     a developer which subpath each bundle drew from.
- Commits: `19f5837` (`@place/component/build` subpath wiring +
  vitest aliases — the headline). Earlier cuts shipped progressively
  across Tier 20's first session.
