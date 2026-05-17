# 00 — Reactivity Charter

## Scope

A reactivity primitive based on three commitments and one constraint:

- **Time as the primitive.** Every reactive value is time-indexed. Async values are values not yet resolved at the current time index.
- **Derivation as primary.** State and derivation are the same thing. Raw state is derivation with no inputs.
- **Graph as artefact.** The reactive graph is serializable, inspectable, persistable.
- **Typed effects as a constraint.** Every effect-performing operation declares its kind in the type; handlers are installed at boundaries.

## What this system owns

- The primitives: `state`, `derived`, `watch` (or whatever they're finally named — see [02-naming-and-voice](../../../docs/platform/02-naming-and-voice.md)).
- The dependency graph and its traversal algorithm.
- The scheduler (Phase 3).
- The time-indexing model (Phase 5).
- Graph serialization and inspection (Phase 6).
- Typed-effect *declarations* (the kinds, not the handlers).

## What this system does not own

- **Rendering.** The component system reads from reactivity primitives but is independent.
- **Storage.** Persistence is its own system. Reactivity exposes a persistence-adapter contract; persistence implements it.
- **Capability scoping enforcement.** Reactivity supports scoped tracking; capability is its own system that uses it.
- **Routing, search, cache, components, build** — all separate systems with their own charters.

## Non-goals

- Not the fastest reactivity in the JavaScript ecosystem. Within 2x of Solid 2.0 is the target.
- Not a drop-in replacement for any existing framework. The mental model is different.
- Not a v1.0 in 12 months. v0.1 is correctness + commonplace book demo + writeup.

## Depends on

- **build** (eventually) — closure-hash identity for graph serialization, typed-effect static analysis. Phase 6 needs this.

## Exposes to

Every other system. See [04-interfaces.md](04-interfaces.md).

## Phase gates

| Phase | Weeks | Output |
|-------|-------|--------|
| 0 — Foundations | 1-4 | Repo, tooling, journal |
| 1 — Sync core | 5-16 | `cell`, `derived`, `watch` + 8 algebraic invariants |
| 2 — Derivable state | 17-22 | Unified `state(value | () => value)` |
| 3 — Scheduler | 23-32 | Deferred effects, phase semantics |
| 4 — Typed effects | 33-40 | Effect kinds, handler installation |
| 5 — Time | 41-52 | Temporal tuple, time-indexing, fork |
| 6 — Graph | 53-58 | Serialization, inspection |
| v0.1 | 59-66 | Polish, writeup, demo |

See [03-implementation-plan.md](03-implementation-plan.md) for the detailed plan.

## Provisional decisions

These are decisions made in early phases that may be revisited under later constraints. Listed explicitly so they don't harden by accident.

- **Phase 1's synchronous `watch` default** — Phase 3 may flip to deferred.
- **Phase 1's global tracking pointer** — Phase 5 needs scoped tracking; the pointer must be replaceable.
- **Phase 1's `state` API without an adapter slot** — Phase 4+ must accept persistence adapters; design Phase 1's surface so this doesn't break.
- **Phase 1's effect-untyped `watch`** — Phase 4 adds typed-effect declarations; `watch` may grow effect kinds.

## Open decisions

- Final names for primitives, effect kinds, time vocabulary.
- Whether to expose the scheduler in v0.1 or hide it.
- Whether to expose all three derivable-state policies (revert / rebase / permanent) or only the default.

## Test plan

See [05-test-plan.md](05-test-plan.md) — per-phase invariants enumerated.
