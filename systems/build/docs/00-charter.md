# 00 — Build System Charter

**Status:** partial work in v0.1 (closure hashes, effect analysis); full system in v0.2.

## Scope (provisional)

- **Closure hashes** — stable IDs for `derived` and `watch` callbacks (reactivity Phase 6 needs this).
- **Effect-kind static analysis** — determine which effects a function performs (reactivity Phase 4 needs this).
- **Custom syntax compilation** — DSL or templated component syntax (post-v0.1).
- **Bundling** — for the example app and library distribution.
- **Source-map preservation** — through every transformation.

## What this system does not own

- Runtime behavior of any other system. Build outputs stable IDs and analysis results; the runtime is unaware of the build.
- Test runner (Vitest is configured separately).
- Lint / formatter (Biome).

## Depends on

- (foundational — depended on by everyone but depends on no other system)

## Open questions for design phase

- Compiler implementation: TypeScript compiler API, SWC, custom?
- Custom-syntax: Vue-style SFC, Svelte-style component files, JSX, raw TypeScript?
- How does the build emit closure hashes — alongside the bundle, or embedded in source maps?
- Hot module reload story (post-v0.1).

## Phase

Partial v0.1 (closure hashes for graph serialization + effect kinds for typed effects). Full design v0.2.

## What needs deciding before reactivity Phase 4

- The shape of the effect-kind analysis output.
- How the runtime indexes against the build's analysis.
- Whether the analysis runs in `tsc` plugin form, as a Vite plugin, or standalone.

## What needs deciding before reactivity Phase 6

- The closure-hash algorithm (content-addressable hash of normalized AST).
- How user code references stable IDs (compiler-rewritten? runtime registry?).
- Round-trip identity guarantees across rebuilds with non-functional changes (renames, formatting).
