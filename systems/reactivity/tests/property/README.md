# Property tests — reactivity

Algebraic invariants from [../../docs/05-test-plan.md](../../docs/05-test-plan.md), encoded as `fast-check` properties on Vitest.

## Files

| File | Phase | Invariants covered |
|------|-------|--------------------|
| [synchronous-core.test.ts](synchronous-core.test.ts) | 1 | 1.1 — 1.8 (full Phase 1 contract) |

## Running

```sh
# from project root
bun install                    # one-time
bun test                       # full suite (unit + property + conformance)
bun run test:property          # property tests only
bun test systems/reactivity/tests/property/synchronous-core.test.ts
```

## Why these matter

Reactivity bugs are almost always the case the unit test didn't think of. A property test proves a *class* of inputs holds the invariant; a unit test proves one example. For diamond-dependency convergence, dynamic subscription, glitch-freedom, etc., only the property-test layer is trustworthy.

The eight Phase 1 invariants are non-negotiable. A change that breaks any of them either fixes the breakage before merge or comes with an ADR explaining the reversal.
