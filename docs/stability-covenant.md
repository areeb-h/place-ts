# Stability covenant

This document is a public commitment. It binds future maintainers as much as current ones. Read it before relying on any `@place/*` API in a production codebase.

## What this covenant covers

Every `@place/*` package's public surface — defined as **every named export of `src/index.ts` plus every documented sub-export path**. Underscore-prefixed exports (`_isInsideCache`, `_setHydrated`, etc.) are explicitly internal and excluded from these guarantees.

Adapter contracts (`Adapter` / `Builder` interfaces, the existing Node adapter, future Vercel + Cloudflare adapters) are part of the public surface.

## Versioning

We follow semantic versioning, but the meaning is concrete:

- **Patch (`0.5.0` → `0.5.1`)**: bug fixes, internal refactors. No surface change. Existing code using public APIs continues to compile and behave identically.
- **Minor (`0.5.0` → `0.6.0`)**: additive changes. New exports, new optional fields on existing types, new options that default to the prior behavior. Existing code continues to compile and behave identically.
- **Major (`0.x.0` → `1.0.0`, then `1.0.0` → `2.0.0`)**: breaking changes (signature changes, removals, renames). Subject to the deprecation policy below.

While in `0.x` we treat minor as the line for breaking changes per SemVer convention, but the deprecation policy still applies — we ship overlap and codemods in `0.x` minor bumps just as we will in `1.x` majors.

## Deprecation policy

Breaking changes require, in order:

1. **An ADR.** New file under `docs/decisions/`. States what changes, why, the rejected alternatives, and the migration path. The PR that ships the change links the ADR.
2. **Six-month deprecation overlap.** The old API stays exported, emits a `console.warn` on first use in dev (not in prod), and is referenced from the new API's docs.
3. **A codemod when feasible.** For renames, signature shuffles, or import-path changes, ship a codemod under `scripts/codemods/<change>.ts` that rewrites usage. For semantic changes (different runtime behavior), document the migration steps in `docs/migrations/v<version>.md`.

If a security issue forces a faster timeline, the deprecation overlap may be shortened — but the ADR + codemod requirements stay.

## What never changes

These are commitments we will not walk back:

- **The framework name `place`.** No rebrand post-1.0. Users who put `@place/component` in their `package.json` get to keep it forever. (Cautionary tale: Remix → React Router v7 alienated power users and broke SEO investment overnight.)
- **The page-as-data shape.** `page({ view, meta, load, … })` is the central abstraction. Fields may be added to the options bag (additive), but the shape — view as a function returning a View, meta as a typed object, load as a function returning Promise<L> — is permanent.
- **Capability-based effect scoping.** `defineCapability`/`provide`/`use`/`tryUse` is the platform's effect-injection contract. No "implicit context" alternative.
- **Strict-CSP-by-default.** `serve({ security: 'standard' })` will not regress to require `'unsafe-inline'` or `'unsafe-eval'`. Future features that need either get a separate explicit opt-in.
- **No file-system routing.** Routes are values. `serve({ routes: { '/': home } })` is the contract.
- **Exports surface stability for v1.0+.** Once v1.0 ships, removing or renaming a v1.0 public export requires a v2.0 bump. No exceptions.

The "deliberately not doing" list in [docs/roadmap.md](roadmap.md) catalogs more anti-features that won't ship.

## Migration support

- Migration notes live in `docs/migrations/v<version>.md` starting at `v0.6`. Every `0.x → 0.x+1` and `0.x → 1.0` major bump gets one.
- Codemods live in `scripts/codemods/`. Run with `bunx jscodeshift -t scripts/codemods/<name>.ts <files>` (or the equivalent for your bundler).
- The roadmap's "In flight" entry names the breaking change at least one minor version before it lands. If you watch the roadmap, you have ≥6 weeks of warning.

## Reporting drift

If you find a public API that changed without an ADR or deprecation overlap, file an issue with the title `Stability covenant violation: <surface>`. We treat these as P0.

## Pre-1.0 caveat

Until `1.0`, the surface itself is still being shaped. We commit to the deprecation policy above for everything we ship, but reserve the right to remove experimental APIs marked "provisional" in their JSDoc — those are not yet under the covenant. Anything not so marked IS under the covenant from the version it shipped in.
