# 04 — Reactivity Interfaces

What this system exposes to the rest of the platform, and what it consumes from build.

This doc is the system-specific elaboration of [docs/platform/04-interfaces.md](../../../docs/platform/04-interfaces.md). The platform doc gives the cross-system overview; this one gives the reactivity-specific shape, with explicit phase annotations.

---

## Stability and phase legend

| Tag | Meaning |
|-----|---------|
| **shipped** | Available now in `src/index.ts`. Stability tier: **provisional** until v0.1 release. |
| **Phase N** | Reserved name; lights up at the listed phase. May be added to the type before runtime support exists. |
| **deferred** | Identified but no committed phase. May be cut. |

---

## Shipped (Phase 1 + 2 + 3)

```ts
export interface State<T> {
  read(): T
  write(next: T | ((prev: T) => T)): void
}

export type Disposer = () => void

export interface StateOptions<T> {
  equals?: (a: T, b: T) => boolean
}

export interface WatchOptions {
  defer?: boolean   // run at next microtask instead of synchronously
}

export function state<T>(
  initial: T | (() => T),
  options?: StateOptions<T>,
): State<T>

export function watch(fn: () => void, options?: WatchOptions): Disposer

export function peek<T>(s: State<T>): T

export function batch<T>(fn: () => T): T

export function flush(): void
```

**Three primitives + two scheduler controls.** Phase 1 covered the synchronous core (raw state + derived state + observation). Phase 2 unified raw and derived under one primitive with the **revert policy** for local writes on derived state. Phase 3 added scheduler primitives: `batch` for grouping writes, `flush` for manual draining, `defer: true` for microtask-coalesced watches, and `peek` for untracked reads.

### Behavioral notes (provisional)

- `watch` runs **synchronously** by default when its tracked sources change value. Pass `{ defer: true }` to opt into microtask scheduling. The default of `defer: false` is **committed**: existing call sites stay synchronous forever.
- Derivations must be pure: writing to a `state` from inside a `state(() => …)` callback throws.
- Watches may write to states freely; the scheduler loops to settle.
- `state(fn)` interprets `fn` as the derivation. If you want `fn`-as-value, wrap: `state<F>(() => fn)`.
- `batch(fn)` defers all watch firing until the outermost batch returns. Nested batches only flush at the outermost level.
- `flush()` synchronously drains both queues; no-op inside a batch.
- `peek(s)` reads without subscribing the current observer. Useful for sentinel reads inside watches or derivations.

---

## Phase 4 (typed effects)

```ts
export type EffectKind = 'IO' | 'Mutate' | 'Throws' | 'Async'

export type Effect<K extends EffectKind, T = unknown> = {
  kind: K
  payload: T
}
```

Effect kinds are declared by the reactivity system and handled by the capability system. Phase 4 introduces compile-time analysis; runtime stays untagged for performance.

---

## Phase 5 (time-indexing and scopes)

```ts
export type Tick = number & { readonly __brand: 'Tick' }
export function now(): Tick
export function fork(fn: () => void): { commit(): void; abandon(): void }

export type Scope = { readonly __brand: 'Scope' }
export function rootScope(): Scope
export function childScope(parent: Scope): Scope
export function withScope<T>(scope: Scope, fn: () => T): T
export function currentScope(): Scope
```

`State<T>` gains an `at(tick: Tick): T` method for historical reads.

---

## Phase 6 (graph as artefact)

```ts
export type Graph = {
  readonly tick: Tick
  nodes(): Iterable<Node>
  edges(): Iterable<Edge>
  snapshot(): GraphSnapshot
  atTime(tick: Tick): GraphSnapshot
  serialize(): SerializedGraph
  restore(serialized: SerializedGraph): void
}

export function graph(): Graph
```

---

## Persistence adapter (Phase 4+, consumed)

```ts
export interface PersistenceAdapter<T> {
  initial(): Promise<T> | T
  observe(onChange: (next: T) => void): Disposer
  write(next: T): Promise<void> | void
  conflict?(local: T, remote: T): T
}

// state options gain:
export interface StateOptions<T> {
  equals?: (a: T, b: T) => boolean
  adapter?: PersistenceAdapter<T>   // Phase 4+
  scope?: Scope                     // Phase 5+
}
```

The `state` constructor accepts an adapter so a state can be backed by IndexedDB, server sync, etc. without leaving the reactivity API surface. The persistence system implements the adapters; reactivity consumes them.

---

## Deferred / open

| Entry | Status | Notes |
|-------|--------|-------|
| `peek(state)` / untracked read | deferred | Workaround for now: read outside any observer |
| `state.dispose()` | deferred | States are GC-managed; dispose may be needed when adapters land |
| Cycle path in error | deferred | Capturing the cycle nodes costs something; revisit when the graph is inspectable (Phase 6) |
| Multiple-policy support (rebase, permanent) | deferred | Per Tier 3 decision: revert-only at first ship |

---

## Stability tiers (current)

| Entry | Tier |
|-------|------|
| `state`, `watch` | provisional |
| `State<T>`, `StateOptions<T>`, `Disposer` | provisional |

By v0.1 release: every entry is `stable` or `provisional`. Nothing experimental ships in the public surface.

---

## What this doc deliberately does not cover

- Internal types (the graph node representation, scheduler internals). Those live in source comments, not interfaces.
- Helper functions on top of the primitives (e.g. `useToggle`-style sugar). Those belong in higher-level systems or separate utility packages.
- Test-only APIs. The current `__internal` namespace is a transient hook for property tests; not part of the public surface.
