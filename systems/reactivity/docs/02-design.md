# 02 — Reactivity Design

**Status:** stub. Will be drafted by consolidating Part 4 of [01-pain-points.md](01-pain-points.md) with the platform reframe.

## What this doc will contain

A focused design statement for the reactivity system — separate from the survey of pain points and separate from the implementation plan. The single doc a reader would consult to understand "what is the design and why."

Outline:

1. **The thesis.** Three commitments + one constraint, articulated cleanly without the survey baggage.
2. **The primitives.** Final shape of the `state` / `derived` / `watch` triple (or its successor under derivable-state unification).
3. **The graph model.** How dependencies form, how invalidation flows, how the graph is addressable.
4. **The scheduler model.** Phases, ticks, fork semantics. How time advances.
5. **The effect-kind model.** What's declared, what's tracked, what handlers do.
6. **The persistence-adapter contract.** How a `state` becomes durable without leaving the reactivity system.
7. **The capability-scope model.** How multiple scopes coexist, how transitions become forks.
8. **What's not in the design** — explicit non-goals, per the charter.

## Why this is a stub for now

The pain-points doc and the implementation plan together cover the same material in scattered form. Consolidating them into one focused design doc is a refinement step that is most valuable *after* the platform-level scaffolding is in place — which is what is happening now in this current effort.

When the platform docs settle, this doc gets drafted. Not before.

## Sources to consolidate

- [01-pain-points.md](01-pain-points.md) — Part 4 ("My honest read on what to combine") and Part 3 ("Six rethink directions") sections A, C, F, B.
- [03-implementation-plan.md](03-implementation-plan.md) — phase-level design choices, especially Phase 1's decisions and Phase 5's temporal tuple shape.
- [00-charter.md](00-charter.md) — non-goals and provisional decisions.
- [../../../docs/platform/04-interfaces.md](../../../docs/platform/04-interfaces.md) — the reactivity interface shape.
