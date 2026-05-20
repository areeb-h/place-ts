# ADR 0053: Framework-owned dev primitives — `app({ devtools })` auto-attach + additive `islands` / `islandsDir`

**Status:** accepted
**Date:** 2026-05-20
**Affects:** `@place/component` (`serve()`, `app()`, `renderPage`, `discoverIslands`); `@place/devtools`

## Context

The docs site shipped with a one-line wrapper file at
`examples/docs/src/islands/_devtools.tsx`:

```ts
import { island } from '@place/component'
import { devtoolsView } from '@place/devtools'
export default island(import.meta.url, devtoolsView)
```

…plus a `<Devtools client="idle" />` JSX in the layout behind a
`process.env.NODE_ENV !== 'production'` gate. The author's question:

> shouldn't we actually move devtools into the framework itself? why
> do we have it in docs app? are we doing anything else like that?

Right call. Apps shouldn't need framework boilerplate to use a
framework feature. The wrapper file existed because:

- The `island(import.meta.url, fn)` factory captures the source URL
  via `import.meta.url` — historically interpreted as "must live in
  the consuming app's project tree."
- `discoverIslands('./src/islands')` only auto-registered files
  under the app's tree, so framework-shipped islands had no path in.
- The validator `validateIslandSrc()` rejected any path that didn't
  `startsWith(cwd)` — defense-in-depth against `..` traversal —
  which also blocked `node_modules/@place/devtools/...` paths.
- The `app()` config treated `islands` (explicit) and `islandsDir`
  (discovery) as mutually exclusive. No way to add a single
  framework-shipped island to a discovery-based registry.

## Options considered

1. **Status quo + accept the boilerplate.** Apps wrap; framework
   stays pure. Argument: opinionation-free.
   - Con: every app that wants devtools writes the same 4 lines.
     Framework feature requires framework boilerplate in app code —
     exact failure mode the charter warns against.

2. **Ship the wrapper from `@place/devtools` and auto-discover it
   from `node_modules` via a magic path scan.**
   - Pro: zero app code.
   - Con: filesystem magic — exactly the "no compiler magic" carve-out
     ADR 0026 ("magic with clarity") allows but only if discoverable
     in source. A scan over `node_modules` isn't discoverable.

3. **Add `app({ devtools: 'auto' | true | false })` and make `islands`
   + `islandsDir` additive — discover from dir, layer explicit
   `islands` array on top, framework auto-registers `@place/devtools`'s
   pre-wrapped island when `devtools` is enabled.**
   - Pro: zero app code in the common case. The mechanism is
     discoverable in source (`app({ devtools: 'auto' })` is right
     there). The `islands` + `islandsDir` merge is reusable for any
     conditional-island pattern (per-environment, per-tenant,
     per-experiment). Framework owns its own opt-in primitive.
   - Con: requires `validateIslandSrc` relaxation to allow
     framework-installed paths.

## Decision

**Option 3.** Four coordinated changes:

1. **`@place/devtools` exports a pre-wrapped island** at
   `systems/devtools/src/place-devtools.tsx` (filename chosen to
   produce a stable, non-collision bundle name). Public surface
   keeps the raw `devtoolsView` export for the unusual case where
   an app wants custom mount placement; `devtoolsIsland` is the
   default path.

2. **`islands` + `islandsDir` are additive.** `serve()` discovers
   from `islandsDir` first (when set) then layers the explicit
   `islands` array on top (last-write-wins by island name). The
   `else if` chain became sequential `if` blocks building a merged
   registry.

3. **`app({ devtools: 'auto' | boolean })`** with default `'auto'`
   resolving to enabled when `NODE_ENV !== 'production'`. Framework
   lazily `_serverDynImport('@place/devtools')` at app boot (when
   enabled) + adds `devtoolsIsland` to the registry. Bun's tree-shaker
   keeps the dep entirely off the prod-build module graph when
   disabled. `RenderPageOptions.emitDevtoolsMarker` flag drives auto-
   emission of `<Island name="place-devtools" client="idle" />` at
   end-of-body via `renderPage`.

4. **`validateIslandSrc` relaxed.** The defense was against
   `../../etc/passwd`-style relative escape. The new check rejects
   any `..` segment + requires absolute (`/` or `file://`) — exact
   threat preserved, framework-installed absolute paths now allowed.

## Consequences

- **Apps using devtools drop 9+ lines of boilerplate.** No wrapper
  file, no layout JSX, no dev gate. `app({ devtools: 'auto', … })`
  is the entire integration.
- **Prod builds get smaller.** `NODE_ENV=production` resolves
  `'auto'` to false → devtools dep never imported, never bundled.
  Measured on docs site: 16 → 15 bundles, devtools-*.js (23 KB)
  removed entirely from `dist/`.
- The `islands` + `islandsDir` additive merge is reusable for any
  conditional-island opt-in beyond devtools. Example documented in
  the JSDoc: per-environment feature flags, per-tenant variants.
- The validator's `..` rejection still closes the relative-escape
  attack class. Path-traversal protection is preserved; the
  startswith(cwd) check that ALSO blocked legitimate
  framework-installed paths is gone.
- Apps with a special placement requirement (e.g. devtools inside
  a specific layout slot rather than end-of-body) can fall back to
  the `devtoolsView` raw export + their own `island()` wrap.
- The same pattern applies to any future framework-shipped UI
  primitive that wants auto-mount semantics — a charter for
  "framework owns its own dev surfaces."

## Notes

- Author's prompt that triggered the cleanup was sharp + correct.
  We accumulate framework-boilerplate-in-app's-clothing if we don't
  watch for it.
- Other docs-app islands audited at the same time (`code-block`,
  `mobile-nav-*`, `page-nav`, `theme-toggle`, `toc`, `search-*`,
  `viewport-demo`, `reactivity-demo`, `sheet-combobox-demo`) are
  genuinely app-specific UI — not framework-in-app's-clothing.
- Commits: `a624df1` (additive islands + initial wiring),
  `b95b838` (devtools auto-attach + validator relax + bundle rename).
