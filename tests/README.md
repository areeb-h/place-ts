# Cross-cutting Tests

Tests that span more than one system, or that verify the platform-as-a-whole. Per-system tests live inside each system at `systems/<name>/tests/`.

| Folder | What lives here | Status |
|--------|-----------------|--------|
| `conformance/` | Charter-compliance tests — one per system, asserting the system behaves as its charter says | 1 test file (reactivity); the directory pattern stays for future system charters |

See [docs/platform/05-testing-strategy.md](../docs/platform/05-testing-strategy.md) for the full testing-strategy doc.

## Convention: where does a test belong?

| Test kind | Location |
|-----------|----------|
| Single-system unit | `systems/<name>/tests/unit/` |
| Single-system property | `systems/<name>/tests/property/` |
| Two-system integration | Consumer system's `tests/integration/` (currently none) |
| Charter conformance | `tests/conformance/` (here) |
| Performance | System's `tests/benchmark/` for system-internal; `/benchmarks/` for cross-system |

## Why no `e2e/` or `integration/` here

End-to-end app flow is browser-verified per session against the live `commonplace` and `sandbox` previews. Headless smoke checks are queued as audit-followup Phase 2.3 — they'll land in `scripts/ci-boot-examples.ts`, not as vitest cases.

3+ system integration tests haven't found an organic home — most multi-system flows are exercised end-to-end via the example apps, or as unit tests in the system that owns the integration point. The folder will reappear when a real workload demands it.
