# ADR 0010: `__PLACE_BROWSER__` build define for server-only DCE

**Status:** accepted
**Date:** 2026-05-13
**Affects:** `systems/component/src/index.ts` (Bun.build invocation, `serve` export, `serve.ts` future home), `systems/component/src/app.ts` (`.run()` dispatch)

## Context

A bundle audit during the v0.5 polish round 7 measured the docs site
prod build at **240 KB raw / 67 KB gzipped**. Source-map forensics
showed the `page` factory alone contributed **21 KB gzipped** of the
framework footprint — *57% of the framework runtime* — because the
entire `_serveImpl` body (HTTP handler dispatch, `Bun.serve`,
`Bun.build`, security headers, `devalue` stringify, `fs/promises`,
`tailwindcss`, ISR cache plumbing, ~800 lines total) shipped to the
browser as dead code.

The leak was structural: `app.ts` statically imported `serve` from
`index.ts` so it could call it from `.run()`'s server branch. The
runtime check `if (typeof window === 'undefined')` selected the right
branch at execution time, but the bundler couldn't statically prove
the server branch unreachable on browser builds — `typeof window` is
JS that the bundler doesn't resolve. Both branches stayed in the
bundle.

The textbook fixes (file extraction + dynamic import; bundle splitting;
external module marking) each had real costs: file extraction was
~1500 lines of surgery; dynamic import would create a separate chunk
served only on demand, complicating the static-only deploy path;
external marking required the user to know which paths to mark.

## Decision

Introduce a build-time literal `__PLACE_BROWSER__: boolean` injected
via Bun.build's `define` option for the client bundle. The framework's
`serve()` passes `define: { __PLACE_BROWSER__: 'true' }` in its
`Bun.build` invocation; on the server runtime the define is unset and
`typeof __PLACE_BROWSER__` is `'undefined'`.

The `serve` export becomes a build-time ternary:

```ts
async function _serveImpl(options: ServeOptions): Promise<Bun.Server<unknown>> {
  // … ~800 lines of server-only body …
}

export const serve = typeof __PLACE_BROWSER__ !== 'undefined' && __PLACE_BROWSER__ === true
  ? (() => { throw new Error('serve() is server-only') })
  : _serveImpl
```

On the client bundle: the define replaces `__PLACE_BROWSER__` with
`true`, the ternary constant-folds to the throwing stub, and the
bundler tree-shakes `_serveImpl` (because it's unreferenced) along
with its entire transitive closure.

On the server runtime: the define is unset; `typeof
__PLACE_BROWSER__` is `'undefined'`; the ternary selects `_serveImpl`;
the framework runs normally.

Apps consuming `serve` see no API change. The throwing stub on the
client only executes if someone calls `serve(...)` from client code —
a programming error — so it gives a useful diagnostic instead of
silently breaking.

The same pattern can gate any other server-only API; today only
`serve` is gated. Apps can also use `__PLACE_BROWSER__` directly: the
`auto-imports.d.ts` declares it globally; `app.ts`'s `.run()` uses it
to pick `boot()` vs `serve()` at build time.

`sideEffects: ["./src/preload.ts"]` was added to the `@place/component`
manifest as a prerequisite — the bundler now knows every other module
is pure and can tree-shake aggressively across the barrel.

## Consequences

### Measured

- Whole-framework probe: **37 KB gzipped → 16 KB gzipped** (−21 KB, −57%)
- `page` bucket marginal cost: **+21 KB → +2.1 KB** gzipped (−90%)
- Docs site full prod bundle: **240 KB → 180 KB raw**, **67 KB → 49 KB gzipped** (−27%)
- Test suite: 945/945 green throughout

### Positional

place ships at **~16 KB gzipped framework** when all primitives are
used — sub-Vue-3.5, sub-React, sub-Next.js, ~2× Solid core (Solid
excludes router + SSR + capabilities + form which place all ships in
one package). Realistic stretch with the planned template-hoisting
compile-out: 10–14 KB gzipped.

### Trade-offs

- Build-time define is one more concept the user has to know exists
  when poking the framework's source. `auto-imports.d.ts` declares it
  globally so type-checking works; the place-specific `bunfig.toml`
  preload registers the plugin that injects it. As long as users use
  the standard `serve()` entry, they never write `__PLACE_BROWSER__`
  themselves.
- Server runtime relies on `typeof __PLACE_BROWSER__` not throwing a
  ReferenceError. JS handles undeclared identifiers inside `typeof`
  gracefully, so this works without polyfill or define on the server.
- The pattern is contagious: every future server-only export should
  follow the same ternary shape. Documented in this ADR + inline
  comment on the `serve` export.

## Out of scope

- Extracting `_serveImpl` to its own file. Not necessary — the ternary
  DCE pattern works without the file move. A later cut may extract it
  for readability, but bundle-size impact would be near-zero.
- Generalizing to a `defineServerOnly()` helper. Premature; one
  call-site doesn't justify the abstraction. Revisit if 3+ exports
  need the same gating.
