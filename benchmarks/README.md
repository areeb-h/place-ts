# Benchmarks

Cross-system performance comparison. System-internal benchmarks live at `systems/<name>/tests/benchmark/`; this folder holds platform-level performance work.

## What lives here

- Comparisons against other frameworks (Solid 2.0, Vue, Angular signals, the TC39 polyfill).
- Whole-app benchmarks via the commonplace example.
- Memory profiling under realistic workloads.
- Bundle size tracking over time.

## What does not live here

- Per-primitive micro-benchmarks (live in the relevant system).
- Regression tests for performance bugs (live as benchmarks in the affected system).

## Execution

Nightly in CI. A regression of >25% on any benchmark blocks merge until investigated.

## Tooling

- **tinybench** for primitive timings.
- **Vitest bench** as an alternative (built-in to Vitest).
- Custom harness for whole-app benchmarks (TBD when commonplace example is implemented).

See [docs/platform/05-testing-strategy.md](../docs/platform/05-testing-strategy.md) §Benchmarks.
