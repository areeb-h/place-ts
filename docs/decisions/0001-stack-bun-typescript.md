# ADR 0001: Stack — Bun-everywhere + TypeScript latest

**Status:** accepted
**Date:** 2026-05-01
**Affects:** all systems, build, Phase 0 setup

## Context

The original implementation plan ([systems/reactivity/docs/03-implementation-plan.md §Phase 0](../../systems/reactivity/docs/03-implementation-plan.md)) specified:
- Runtime: Bun
- Workspaces: pnpm
- TypeScript: strict mode
- Tests: Vitest + fast-check
- Lint/format: Biome

The user has subsequently directed: "use Bun latest stable + best practices, TypeScript latest version."

This forces a re-decision on the workspace tool. With current Bun, "best practices" tilts toward Bun-everywhere rather than the original Bun-runtime + pnpm-workspaces hybrid.

## Options considered

1. **Original plan: Bun + pnpm.** Familiar tooling, mature pnpm workspaces, Bun for runtime speed. Two-tool split.
2. **Bun-everywhere.** Single tool. Bun runtime + Bun workspaces + `bun install` + `bun.lock`.
3. **Node.js + pnpm.** Conservative, well-understood, slow. Out — user has chosen Bun.

## Decision

**Bun-everywhere on latest stable. TypeScript on latest stable, strict mode.**

Specifically:
- **Runtime:** `bun` latest stable, version pinned in `engines.bun`
- **Package manager + workspaces:** `bun install`, `bun.lock` checked in, Bun workspaces (`workspaces` field in root `package.json` matching `systems/*`)
- **TypeScript:** latest stable
- **Test runner:** **Vitest** (not Bun's native test runner) — see rationale below
- **Property tests:** **fast-check** (unchanged)
- **Lint/format:** **Biome** latest stable
- **No bundler in core systems** (libraries don't ship bundled)
- **Bundler for examples:** TBD when commonplace example begins; **Vite + Bun** is the candidate

## Why Vitest, not `bun test`

Bun has a native test runner. It is fast. We are *not* using it for v0.x because:

- Property tests are the load-bearing test layer for this project. fast-check works with both, but Vitest's integration with fast-check is more mature (better failure shrinking output, watch mode, snapshot interop).
- Vitest's reporter ecosystem (CI integration, coverage, mutation testing via Stryker) is more mature.
- Vitest runs under Bun cleanly. Speed difference is negligible for the suite shape we need.
- A single test runner across systems is the discipline; cross-system conformance tests need consistent reporting.

If `bun test` matures further during v0.x and the migration is mechanical, an ADR may revisit.

## TypeScript "latest stable" — what that means concretely

- Track stable releases. Do not pin to a TypeScript version below latest stable except for a documented compatibility issue.
- When TypeScript ships a major change that affects type-level effect analysis (capability system) or graph serialization (build system), an ADR records the upgrade and any code adjustments.
- Use the strictest feasible config from day one. Loosening is an ADR.

### `tsconfig.json` baseline (Phase 0 setup target)

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `verbatimModuleSyntax: true`
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `target: ESNext`
- `module: ESNext`, `moduleResolution: bundler`
- `noEmit: true` for libraries (Bun handles transpile at runtime / build emits separately)

### Forbidden by default

- `any` (use `unknown` and narrow)
- `// @ts-ignore` without an inline ADR-link justification
- `as` casts without justification
- `enum` (use union types or `as const` objects)

## Consequences

**Easier:**
- Single tool from setup to test. `bun install`, `bun run test`, `bun run dev`. No npm/pnpm/yarn/Bun split-brain.
- Faster install. Faster startup. Faster type-check (with `tsc --noEmit` under Bun's IO).
- Smaller `node_modules` footprint via Bun's module deduplication.

**Harder:**
- Bun's ecosystem is younger than Node's; some niche dependencies may have edge cases. Mitigation: stick to mainstream deps; report Bun bugs upstream.
- Less Stack Overflow / blog content on niche Bun issues. Mitigation: Bun's Discord and GitHub are responsive.
- A 12-18 month project will see multiple Bun major versions. Mitigation: pin via `engines.bun`; bump deliberately, with a journal entry.

**Watch for:**
- Bun version drift across contributors (currently solo, so trivial; codify when it matters).
- Differences in module resolution between Bun and TypeScript's `moduleResolution: bundler`.
- Workspace dependency resolution edge cases (Bun handles these well at current versions, but verify).

## Best-practices defaults

- `package.json`: `"type": "module"` everywhere
- `bun.lock` committed
- No transitive deps without a quick audit (Bun's `bun audit` covers most cases)
- `engines: { bun: ">=X.Y" }` to prevent silent version drift
- Per-workspace `package.json` with explicit `name`, `version`, `exports`
- Root scripts delegate to workspaces; no logic in root `package.json`

## Notes

- The original plan's pnpm choice predates Bun's workspaces being stable. This ADR supersedes that section of [03-implementation-plan.md](../../systems/reactivity/docs/03-implementation-plan.md). The plan should be updated to reference this ADR instead of restating.
- This ADR is the first stack decision. Future ADRs will cover specific tooling choices as they arise (e.g., bundler, doc-site generator, e2e test runner).
- The "latest stable" stance is deliberate. We are not pinning to a frozen version for stability theater. We are tracking the platform we depend on, with ADRs for upgrades that change behavior.
