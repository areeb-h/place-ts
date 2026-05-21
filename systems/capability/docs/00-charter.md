# 00 — Capability System Charter

**Status:** shipped. Public surface stable in v0.1; effect-kind types under refinement.

## Thesis

A **capability** is a typed runtime slot for an effect — a value-shaped
handle that providers fill and consumers read, with the type system
enforcing the slot's contract end-to-end. Where React's Context is a
loose key-value bag that lets any descendant read anything, a place
capability is **typed, scoped, and SSR-aware by construction**. Where
Next.js's `'use server'` directive is a magic string that triggers a
compiler pass, a place capability is a value the user wrote and reads.

Capabilities are the framework's answer to the "effects without
directive magic" charter clause (platform NN #2). Every place app
that does I/O, holds session state, picks a router, or branches on
runtime environment goes through a capability boundary.

## What this system owns

### `defineCapability<T>(name, options?)` and `cap<T>(options?)`

The two factory shapes. `defineCapability('Router', { clientOnly: true })`
is the canonical, stability-pinned form per the covenant; `cap()` is
an anonymous-shorthand alternative (`@provisional`, see ADR 0040).
The returned `Capability<T>` value is the slot; it is `value`-shaped
so consumers `import { RouterCap } from './caps'` like any other
binding.

### `.install(impl)` and `.provide(impl, body)`

`install(impl)` registers a default at module load — visible to every
request that doesn't shadow it. Returns a disposer; calling it
restores the previous slot value. Used by the framework's `app({
caps })` plumbing to bind one impl per process.

`provide(impl, body)` is scope-local: install for the duration of
`body`, restore on exit. Returns whatever `body` returns. The
foundation of request-scoped capabilities.

### `.use(fallback?)` and `.tryUse()`

`use()` reads the current slot value. Throws if no provider is
installed and no `fallback` argument is passed. `tryUse()` returns
`undefined` instead of throwing — the safe form for code paths that
gracefully degrade. Both return the typed slot value (`T`), not a
context object.

### `Provision` — the install-tuple type

`Provision<T> = readonly [Capability<T>, () => T | { client?, server? }]`.
Apps describe their caps array as `Provision[]`; framework iterates
and invokes each factory once per request scope.

### `requires(...caps)` — explicit dependency declaration

Marks a function as requiring the listed capabilities. Throws at
call time if any are missing — caught upstream by error boundaries.
Mostly used by framework code to surface "you need Router installed
before calling Link" diagnostics.

### `ClientOnlyAbort` + `clientOnly: true` on capability options

When a capability is declared `clientOnly`, calling `.use()` inside
SSR throws a typed `ClientOnlyAbort`. The component-system catches
it at the nearest `component()` boundary and substitutes an
auto-placeholder span. Apps never write `if (typeof window)` —
the structural typing of the cap propagates the boundary.

### `runWithCapabilityScope(fn)` / `runWithCapabilityScopeSync(fn)`

Per-request scope installer. Used by `serve()` to isolate concurrent
requests' cap stacks via `AsyncLocalStorage` on Node/Bun, with a
synchronous fallback for non-async runtimes. **This is the structural
rebuttal to the ALS-as-anti-pattern claim in 07-prior-art-failures.md**:
ALS here is not implicit globals — it's request-scoped boundary
enforcement for a typed slot, not a key-value side-channel.

### Effect-kind brand types (`IO`, `Mutate`, `Throws`, `Async`, `Read<S>`)

Reactivity-aligned effect kinds. Each is a phantom brand on a
function's return type. Currently used by the view-classifier (build
system) to decide whether a component can compile to `'static'` /
`'thaw'` / `'island'` / `'island+stream'` (ADR 0030). Brand shapes
are stable; the inferred kinds may extend before v0.1 publish.

## What this system does NOT own

- The factory **implementations** — caps are slots; apps and the
  framework fill them.
- The DOM / hydration runtime — that's `@place-ts/component`.
- The reactive graph — caps return values; reactivity decides who
  re-runs when those values change.
- The build-time effect analysis pipeline — that lives in
  `@place-ts/component/build`.

## Architectural commitments

1. **Capabilities are values, not strings.** No `cap('router')` lookup
   by string key. The `Capability` binding is the identity.
2. **One slot, one impl.** A capability can have at most one installed
   provider at any point in a scope. No "first match wins" magic.
3. **Scope is explicit.** `install()` is process-level; `provide()` is
   scope-local. No global registry, no auto-install.
4. **Disposers compose.** Every `install()` and `provide()` returns
   a `() => void`; cleanups stack via the standard pattern.
5. **SSR-safe by construction.** Server-side `.use()` reads the
   request-scoped value via ALS; client-side reads the module-level
   slot. Same call site, different transport — typed identically.
6. **Magic with clarity (ADR 0026 gate).** Every capability is
   discoverable in source (the binding name), traceable in tooling
   (`tryUse()` returns the impl object you can inspect), and
   performance-faithful (no reflection, no proxy traps).

## Depends on

- `@place-ts/reactivity` — the cap's slot is a state cell internally;
  consumers reading via `use()` participate in the reactive graph
  if they're inside a `watch()`/`derived()`/`view()` scope.

## Public surface (v0.1)

```
defineCapability(name, options?)    → Capability<T>
cap(options?)                       → Capability<T>   (@provisional)
.install(impl)                      → Disposer
.provide(impl, body)                → BodyReturn
.use(fallback?)                     → T               (throws if absent + no fallback)
.tryUse()                           → T | undefined
.requires(...caps)                  → marker
runWithCapabilityScope(fn)          → async scope     (server-side ALS install)
runWithCapabilityScopeSync(fn)      → sync scope
ClientOnlyAbort                     → error class
type Provision<T>                   → install tuple type
type IO, Mutate, Throws, Async, Read<S>  → effect brands (@provisional)
```

## Cross-system contracts

- `RouterCap` is the canonical client-only cap; the framework
  consumes it from `@place-ts/routing` and threads `app({ router })`
  into the install pipeline at boot time.
- `SessionCap` (from `@place-ts/security`) is request-scoped via
  `provide()` inside the request handler — the typed `Session`
  shape flows to every page's `load()` ctx.
- `__placeClientImport` metadata on factory functions (currently an
  expando per ADR-0026 (a) gap) signals to the islands bundler
  which module to import in `_auto-init.ts`. **Migration path: a
  typed field on `Capability` (post-v0.1) replaces the expando.**

## Open questions

- Whether `cap()` (anonymous shorthand) survives to v0.1 or
  consolidates into `defineCapability`.
- Whether the effect-kind brands move to `@place-ts/reactivity` (where
  the system-map currently claims they live).
- Whether `runWithCapabilityScopeSync` is needed long-term or can
  consolidate with the async variant.

## Phase

**v0.1** (shipped, stable). Effect-kind brands at `@provisional`
until view-classifier pipeline stabilizes (Tier 9).
