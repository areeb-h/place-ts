# Reactivity Tests

Test layout follows [docs/platform/05-testing-strategy.md](../../../docs/platform/05-testing-strategy.md).

| Folder | Purpose | Tool |
|--------|---------|------|
| `unit/` | Function-level correctness | Vitest |
| `property/` | Algebraic invariants from [docs/05-test-plan.md](../docs/05-test-plan.md) | fast-check on Vitest |
| `integration/` | Reactivity ↔ persistence adapter, ↔ scope, ↔ graph round-trip | Vitest |
| `benchmark/` | Perf vs Solid 2.0, vs Vue, internal regression tracking | tinybench |

Cross-system tests (e2e, multi-system conformance) live in `/tests/`, not here.

## Running

(empty until Phase 0 sets up Vitest — placeholder commands below)

```sh
pnpm test                    # unit + property
pnpm test:property           # property only (slow, run before merge)
pnpm test:integration        # integration only
pnpm bench                   # benchmarks
```
