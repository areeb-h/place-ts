# Build System

The compiler and toolchain. Closure-hash identity for graph serialization, type-level effect analysis, custom syntax compilation (post-v0.1).

**Status (2026-05-05): deferred indefinitely.** Bundling is covered: Vite for the historical SPA path; `serve()` + `Bun.build` for the framework's own pipeline (commonplace, sandbox, sync-server all run on it). The original closure-hash + effect-analysis scope remains designed but unscheduled — we'll revisit when an effect-shape audit becomes a real DX problem rather than a theoretical one.

See [docs/00-charter.md](docs/00-charter.md) for the original scope sketch.
