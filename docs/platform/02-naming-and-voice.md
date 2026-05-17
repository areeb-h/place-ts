# 02 — Naming and Voice

The vocabulary of the platform. The framework name, primitive names, system terms, error-message tone.

This is a **taste decision** doc. Most entries are placeholders. Names need to be sat with for days, not minutes. This doc collects the candidates and the constraints they're chosen against, so that when names commit, they commit deliberately.

---

## The framework name

**Status:** undecided. Working name is `place-ts` (from the directory).

**Constraints:**
- Speakable in 1–2 syllables.
- Doesn't carry React/Vue/Solid baggage.
- Doesn't claim to be "the right way" by name (e.g., not "Pure", "Right", "True").
- Available as an npm package, a domain, a GitHub org.
- Plays well in compound names (`place-ts-router`, `place-ts-store`).
- Hints at the thesis (place = a *where*, time-indexed; commonplace book in the reference design).

**Candidates (drop in as they come):**
- `place` — works with the commonplace book reference; "where" is half of "where + when".
- _(add more)_

**Decision deadline:** before Phase 0 ends. Working name is fine until then.

---

## Primitive vocabulary (reactivity)

Current placeholders, lifted from [systems/reactivity/docs/03-implementation-plan.md](../../systems/reactivity/docs/03-implementation-plan.md):

| Concept | Placeholder | Alternatives |
|---------|-------------|--------------|
| Writable atomic state | `cell` | `state`, `signal`, `ref`, `now` |
| Memoized derivation | `derived` | `computed`, `memo`, `derive`, `fn` |
| Observation primitive | `watch` | `effect`, `observe`, `run`, `watcher` |
| Unified primitive (Phase 2) | `state` | `cell`, `signal`, `current` |
| Scheduler invocation | `flush`, `batch` | `commit`, `settle`, `tick` |
| Time index unit | `tick` | `moment`, `epoch`, `frame`, `step` |
| Time fork | `fork` | `branch`, `alt`, `divergence` |

The reactivity plan's "decisions waiting on your taste" list is the source of truth for this table. Update both.

---

## Effect kind names

Placeholders from Phase 4 of the reactivity plan:

| Concept | Placeholder | Notes |
|---------|-------------|-------|
| External-world side effect | `IO` | Includes network, disk, time, randomness |
| Mutation of non-local state | `Mutate` | A `state.write` performed inside a derivation |
| Failure | `Throws<E>` | Carries the error type |
| Suspension | `Async` | Carries the resolution mechanism |
| Read from a capability scope | `Read<scope>` | Phase 5+ |

---

## Per-system terms

To be filled in as each system gets designed. Constraint: the same word means the same thing across systems.

- **reactivity:** `cell`, `derived`, `watch`, `state`, `tick`, `fork`, `graph`
- **component:** _(TBD — `view`? `widget`? `component`?)_
- **data:** _(TBD — `query`, `loader`, `source`?)_
- **cache:** _(TBD — `entry`, `invalidate`, `key`?)_
- **routing:** _(TBD — `route`, `match`, `transition`?)_
- **persistence:** _(TBD — `store`, `adapter`, `commit`?)_
- **search:** _(TBD — `index`, `query`, `score`?)_
- **capability:** _(TBD — `scope`, `handler`, `grant`?)_
- **build:** _(TBD — `compile`, `analyze`, `emit`?)_

---

## Voice and tone

**For docs:** technical-but-personal. Reads like a careful colleague explaining a hard problem at a whiteboard. Not academic. Not breezy. Honest about uncertainty.

**For error messages:** specific, actionable, never blame the user. "Cycle detected: A → B → A" not "Invalid reactive graph". Show the graph fragment when relevant.

**For the writeup:** see [03-writeup-strategy.md](03-writeup-strategy.md).

**Forbidden words across the platform:** `magic`, `automatically` (without a specific subject), `simply`, `just`, `easy`. These erase the work the system is doing on the reader's behalf.

---

## What this doc does not yet decide

- The project's final name.
- The primitive names.
- The effect kind names.
- The vocabulary for each system below reactivity.

All of those become commitments through use. This doc is the place they get committed.
