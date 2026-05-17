# 01 — Platform Charter

What holds the nine systems together. What "coherence" means. Non-negotiables.

---

## The thesis

There is no client state and server state, no reactive state and stored state, no current state and historical state. There is **state**, with a time index, derived from upstream sources, persisted somewhere, observable through one graph.

A platform is the disciplined expression of that thesis across nine cooperating systems.

---

## Non-negotiables

These are the design commitments that bind every system. A proposal that breaks any of these gets rejected before it gets built.

1. **Time is the primitive.** Every stateful primitive carries a time index. The current value is `now`. Past values are addressable. Async values are values not yet resolved at the current index. Transitions are forks of the index.

2. **Derivation is the unit.** State and derivation are not separate categories. Raw state is derivation with no inputs. All state is potentially derivable from upstream; all derivations are potentially writable via projection back to source.

3. **The graph is observable.** No system has hidden internal state. The reactive graph spans the whole platform — reactivity, components, data, cache, persistence, routing — all participate in one graph. It is serializable, inspectable, fork-able.

4. **Effects are typed.** Every effect-performing operation declares its kind in the type. The build system enforces handler installation at boundaries. There is no runtime tagging of effects; the discipline is compile-time.

5. **Each system is independently understandable.** A reader should be able to read one system's docs and use that system, ignorant of the other eight, and have a coherent mental model. The platform's coherence is *additive* — knowing more systems gives you more, but knowing one gives you a working tool.

6. **Local-first is the default.** Persistence assumes the user owns their data, the network is unreliable, and offline is the normal case. Server-authoritative storage is one option among several, not the privileged one.

7. **Magic with clarity.** Typed everything. Explicit syntax. Predictable shapes. The framework adds compile-time and runtime magic — auto-imports, island discovery, auto cap-install, reactive props, typed reactive JSX directives — when it removes ceremony without removing observability. Every magical inference is (a) **discoverable in source** (typed JSX prop, named metadata field, exported helper — not a string-as-directive), (b) **traceable in tooling** (per-bundle origin, per-island manifest, the reactivity graph still spans it), and (c) **faithful to performance budgets** (no hidden cost that defeats a quoted floor). The earlier draft of this non-negotiable read "no compiler magic that hides intent" — too narrow. The discipline is not *less* magic, it is *visible* magic. Identifiers carry meaning. The compiler is part of the contract; ergonomics for humans and ergonomics for LLMs are the same problem. See [ADR 0026](../decisions/0026-magic-with-clarity.md).

8. **No god-object runtime.** Each system has its own runtime contract. They communicate through typed interfaces, not through a shared bus or a global. The platform is composable, not coupled.

---

## What "coherence" means concretely

- One vocabulary. The word "state" means the same thing in reactivity, in persistence, in routing, in cache.
- One time index. The reactivity scheduler's time tick is the same time tick the persistence layer references.
- One graph. Dev tools render reactivity nodes, component nodes, data nodes, cache nodes, persistence nodes — all in the same view.
- One effect type-system. An IO effect declared in data is the same kind that capability handles at the boundary.

---

## What this platform is not trying to be

- **Not the fastest.** Within 2x of the fastest reactive runtime is the goal. Beyond that, design integrity wins over benchmark wins.
- **Not the smallest.** Bundle size is a constraint, not a target. The platform earns its weight if the coherence it offers can't be bought from libraries.
- **Not the most familiar.** The mental model is genuinely different from React/Vue/Solid/Svelte. New users will have to learn time, derivation-primacy, and the graph as concepts. The bet is the learning is worth it.
- **Not a v1.0 in 12 months.** v0.1 is reactivity + a working commonplace book demo. v1.0 is years out.

---

## Audience

Three audiences, in priority order:

1. **The author.** This platform exists because no current platform expresses the thesis. The first user is the person building it.
2. **Solo and small-team builders** of content-heavy, history-heavy, local-first applications. Commonplace books, research tools, journals, knowledge bases, structured-content apps.
3. **Framework researchers** and the broader reactivity-design community. The platform is also research output; the writeup is part of the deliverable.

The platform is *not* aimed at large product teams shipping conventional CRUD apps. Those are well-served by existing frameworks.

---

## Decision rights

- **Scope changes** (adding a system, removing one, expanding charter): change the system map and the charter, then propagate.
- **Interface changes** between systems: change [04-interfaces.md](04-interfaces.md) first, then update the affected systems' charters.
- **Naming changes**: change [02-naming-and-voice.md](02-naming-and-voice.md), then propagate.
- **Phase changes**: change the affected system's implementation plan; if it changes a v-gate, update the system map.

---

## What this charter does not specify

- The project's actual name (placeholder: `place-ts`). See [02-naming-and-voice.md](02-naming-and-voice.md).
- The shape of the public writeup. See [03-writeup-strategy.md](03-writeup-strategy.md).
- The AI agent setup. See [06-ai-agents.md](06-ai-agents.md).

These deserve their own docs because they're load-bearing decisions that touch every system.
