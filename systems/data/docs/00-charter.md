# 00 — Data System Charter

**Status:** scoped down. v0.1 ships ONE helper (`collection<T>()`);
the broader query / mutation / source-of-truth surface from the
original v0.2 design has been deferred per ADR 0040 + the
2026-05-16 audit (charter said "queries exist", reality was one
helper).

## Thesis

Frameworks that ship a typed-query layer (Relay, tRPC, TanStack
Query, Mantine's `use-query`) end up adding 10-50 KB of runtime and
a mental model that competes with the reactivity primitive
underneath. Place takes the position that **most app-level "data"
problems collapse to a typed array in a `State<T[]>`** plus the
existing capability + persistence + cache primitives. The data
system, for v0.1, is the **single helper that makes that pattern
ergonomic**.

A future v0.2 may add typed queries IF a real use case demands them
that the reactivity primitives can't satisfy. Today they can.

## What this system owns

### `collection<T>()` — keyed array as `State<T[]>` with CRUD helpers

```ts
const notes = collection<Note>({ key: 'id' })

notes.all()              // () => readonly Note[]
notes.get(id)            // () => Note | undefined
notes.add(note)          // void
notes.update(id, patch)  // void
notes.remove(id)         // void
notes.replace(items)     // void  — full reset
```

`collection()` is a thin typed wrapper over `state<T[]>([])` plus a
keyed index built lazily on read. The accessor methods `all()`,
`get(id)` are reactive (`Derived<T[]>` / `Derived<T | undefined>`)
— subscribers re-run on changes. Mutations are synchronous; the
underlying state cell flushes via the scheduler.

### `CollectionOptions<T>` — typed options

```ts
interface CollectionOptions<T> {
  key: keyof T            // which field uniquely identifies a record
  initial?: readonly T[]  // pre-seed (rarely used)
  equals?: (a: T, b: T) => boolean  // for `update` change-detection
}
```

The `key` field is the central typed constraint — TS validates that
`'id'` is a real field on `T`, no string-key magic.

### `Collection<T>` — the returned shape

A typed `{ all, get, add, update, remove, replace }` interface.
Designed to compose with `persistence` for durable backing
(`persistedState(collection<Note>(...))`-style) and with `search`
for indexing (`searchable(notes.all)`).

## What this system does NOT own (and may never)

- **HTTP transport.** `fetch()` is the framework's HTTP. Apps either
  load via `page({ load })` (server) or via `resource()` (client) +
  populate a `collection()` from the result.
- **Cache invalidation.** The reactivity graph already invalidates
  via the standard subscribe/notify pattern. No separate cache
  identity / staleness model.
- **Optimistic UI patterns.** Fine-grained reactivity + immediate
  state mutation IS optimistic UI. No `useOptimistic()` hook needed.
- **Schema validation.** Use `shape()` from `@place/component` or
  any Zod-style library. `collection<T>()` only types the records;
  validation happens at the I/O boundary.
- **Typed queries / loaders / source-of-truth abstraction.** Deferred.
  See "Open questions" — bring me a real use case the reactivity
  primitives can't satisfy and we'll add a layer.

## Architectural commitments

1. **Anti-bloat first.** The charter directive from
   `feedback_anti_bloat.md` applies hardest here. The data layer is
   where every other framework spawns runtime bloat; we ship one
   helper and resist additions without a justified trigger.
2. **Compose with persistence + cache + search.** A `collection()`
   that's persisted-and-searchable composes from three primitives;
   no special data-layer wiring required.
3. **Local-first.** Per platform NN #6, the default mental model is
   "the data is on this device; sync is an addition." A
   `collection<T>()` is in-memory; durability is opt-in via
   `@place/persistence`.
4. **Effect-typed mutations.** Add / update / remove are tagged
   `'state'` effect kind (per the capability system's brands), so the
   view classifier knows a component mutating a collection cannot
   compile to `'static'`.

## Depends on

- `@place/reactivity` — `state<T[]>` is the backing cell
- (Composes with `@place/persistence`, `@place/cache`, `@place/search`
  but does not depend on them — apps wire the composition)

## Public surface (v0.1)

```
collection<T>(options)       → Collection<T>
type Collection<T>           { all, get, add, update, remove, replace }
type CollectionOptions<T>    { key, initial?, equals? }
```

Three exports total. The smallest charter-defining surface in the
platform — intentional.

## Open questions (for a future v0.2 only if triggered)

- **Typed `query()`** — when a real app shows the reactivity-graph
  pattern doesn't scale (e.g. a remote feed with pagination + cursor +
  background refresh). Don't ship it preemptively.
- **Typed `mutation()`** — same threshold. Today, `action()` plus a
  reactive `collection()` cover the common case.
- **Source-of-truth abstraction** — only if a real app demonstrates
  the local-first + remote-sync combo can't be expressed as
  `collection() + persistedState(serverAdapter)`.

The original v0.2 charter was speculative; the v0.1 reality (one
helper) is the honest version. Future additions follow the
trigger / non-goal / cut directive.

## Phase

**v0.1** (shipped, stable). Larger query surface = deferred until
a real use case shows the reactivity primitives can't carry it.
