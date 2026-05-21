# 04 — Inter-system Interfaces

The contracts between systems. This is the doc the original implementation plan was missing. Each system exposes a typed boundary; consumers depend only on the boundary, not on internals.

This doc defines the shape of each contract. Concrete TypeScript types live in each system's `src/` once written; the shapes here are the design.

---

## Why this matters

A platform's coherence is not "everything imports everything." It is "every system depends on a small, stable, typed boundary published by the systems below it." Without explicit interfaces, the platform collapses into a tangle.

Three rules:

1. **Each system publishes one interface module.** That is its public contract. Other systems may import only from it.
2. **Internals are private.** No system reaches across into another's internals. If it needs something not in the interface, the interface gets extended (with intent), not bypassed.
3. **Interfaces evolve through ADRs.** A breaking change to an interface is a decision that gets recorded.

---

## Interface index

| Interface | Owner | Consumed by |
|-----------|-------|-------------|
| Reactivity primitives | reactivity | every other system |
| Reactivity scope | reactivity | capability, component (transitions), build |
| Reactivity graph | reactivity | persistence, build, dev tools |
| Effect kinds | reactivity + capability | every system that performs effects |
| Component contract | component | routing, examples |
| Data query contract | data | component, cache, search |
| Cache contract | cache | data |
| Persistence adapter | persistence | data, capability |
| Capability handler | capability | every system performing typed effects |
| Build hooks | build | reactivity, data, capability |

---

## Reactivity → everything

The most-consumed interface in the platform.

```ts
// systems/reactivity/src/index.ts (SHAPE — not final)
export type State<T> = {
  read(): T
  write(next: T | ((prev: T) => T)): void
  at(tick: Tick): T               // historical read (Phase 5)
}

export function state<T>(initial: T | (() => T), options?: StateOptions): State<T>
export function derived<T>(fn: () => T): Derived<T>
export function watch(fn: () => void): Disposer

export type Scope = { /* opaque */ }
export function withScope<T>(scope: Scope, fn: () => T): T
export function currentScope(): Scope

export type Tick = number & { readonly __brand: 'Tick' }
export function fork(fn: () => void): { commit(): void; abandon(): void }

export type Graph = { /* opaque, see graph contract below */ }
export function graph(): Graph
```

**What this enables:**
- Persistence implements `State<T>` with a backing storage.
- Capability uses `Scope` to install handlers on a specific reactive subtree.
- Components observe via `watch`.
- Build introspects `Graph` for closure-hash analysis.

---

## Reactivity ↔ persistence (the redistributed Direction D)

Persistence is its own system, but the user-facing API is *as if* it's reactivity. Implementation-side, the **shipped** contract is:

```ts
// systems/persistence/src/index.ts (SHIPPED, v0.1)
export interface PersistenceAdapter<T> {
  load(): Promise<T | undefined> | T | undefined
  save(value: T): Promise<void> | void
  observe?(onChange: () => void): Disposer    // optional cross-tab/server-push hook
  refresh?(): Promise<void> | void            // optional manual re-pull
}

// `persistedState` lives in @place-ts/persistence (NOT @place-ts/reactivity):
import { persistedState } from '@place-ts/persistence'
export function persistedState<T>(adapter: PersistenceAdapter<T>): State<T> & Disposable
```

**Note: changed from the v0.3 sketch.** The original interface
proposed `initial / observe(next) / write / conflict?` — the
shipped version is `load / save / observe(void) / refresh?`. The
`conflict()` CRDT resolution hook moved to the optional sync-server
adapter rather than the base contract; `refresh()` is added for
cases like "user pulled-to-refresh, re-fetch from server." The
`onChange` callback signature is `() => void` (signal-only; consumer
calls `load()` to fetch); the original `(next: T) => void` shape
pushed the new value via the event, which complicates concurrent-
write conflict handling.

**Adapter family.** `@place-ts/persistence` ships:
`localStorageAdapter`, `indexedDBAdapter`, `serverAdapter` (HTTP
GET/PUT with optional WebSocket observe), `memoryAdapter` (tests),
and `crossTabAdapter(inner)` which decorates any inner adapter
with cross-tab sync via `BroadcastChannel`.

---

## Reactivity ↔ capability (the redistributed Direction E)

Capability scopes are first-class. The reactivity primitive supports being instantiated within a specific scope, with effect handlers installed.

```ts
// systems/capability/src/index.ts (SHAPE)
export type EffectKind = 'IO' | 'Mutate' | 'Throws' | 'Async' | string
export type Handler<K extends EffectKind, T> = (effect: Effect<K>) => T
export function handle<K extends EffectKind, T>(
  kinds: K[],
  handler: Handler<K, T>,
  body: () => T
): T
```

**Implication for Phase 1.** The default reactivity scope is "the global root scope." Multiple scopes coexist by Phase 5. The Phase 1 sync core must not bake in a literal global; it must be replaceable.

---

## Effect kinds (shared)

Effect kinds are *names* that reactivity declares and capability handles. The set is open; v0.1 has four:

```ts
type IO     // reads/writes the outside world
type Mutate // writes a State<T> from inside a derivation
type Throws<E>
type Async
```

Adding an effect kind is an ADR.

---

## Component → reactivity

```ts
// systems/component/src/index.ts (SHAPE)
export type Component<P> = (props: P) => View

export type View = {
  mount(parent: Node): Disposer
  update(props: unknown): void
}

export function defineComponent<P>(fn: Component<P>): Component<P>
```

The component system reads from reactivity primitives directly. There is no separate "store" concept.

---

## Data → cache, persistence, reactivity

```ts
// systems/data/src/index.ts (SHAPE)
export type Query<T, A extends unknown[]> = {
  (...args: A): State<QueryResult<T>>
  invalidate(...args: A): void
  prefetch(...args: A): Promise<T>
}

export type QueryResult<T> =
  | { status: 'loading' }
  | { status: 'ok'; value: T }
  | { status: 'error'; error: unknown }

export function defineQuery<T, A extends unknown[]>(
  name: string,
  loader: (...args: A) => Promise<T>
): Query<T, A>
```

A query is a typed `State`. The cache and persistence are implementation details *behind* the query.

---

## Build → runtime

The build system contributes:
- Closure hashes (so the graph is serializable).
- Effect-kind static analysis (so handler installation is enforced).
- Custom-syntax compilation (Phase 7+).

```ts
// systems/build/src/index.ts (SHAPE)
export interface BuildOutput {
  closureHash(node: Node): string
  effectsOf(fn: Function): EffectKind[]
}
```

Build artefacts are consumed at compile time, not at runtime. The runtime sees stable IDs, not the build itself.

---

## What's not yet specified

These are the gaps in this doc. Each will be filled when the relevant system reaches design phase.

- Routing's interface to component and data (transition coordination is the hard part).
- Cache's invalidation graph and how it interacts with persistence's observe.
- Search's incremental index updates as state changes.
- Dev-tools API for graph inspection.

---

## Stability tiers

Every entry in an interface module carries a stability tag:

- **stable** — breaking change is an ADR + major version
- **provisional** — likely to change before v0.1
- **experimental** — may be removed

By v0.1, every interface entry is `stable` or `provisional`. Nothing experimental ships.
