# ADR 0044: Tier 16-E — `<Can do="…">` RBAC gate primitive

**Status:** accepted (2026-05-17)
**Date:** 2026-05-17
**Affects:** `systems/security/src/index.ts` (Session.can field + Can re-export), `systems/security/src/can.ts` (new), `systems/security/tests/unit/can.test.ts` (new), `systems/security/docs/00-charter.md`.

## Context

The 2026-05-16 audit ranked SaaS dashboards / e-commerce / internal
tools / forums at **3/5** on use-case readiness, with "missing
widgets" — including an RBAC gate — as the single biggest blocker.
Tier 16-E names `<Can do="…">` as the smallest, most contained widget
to ship; it composes with the existing `SessionCap` + `requireSession`
flow without inventing a new auth model.

## Decision

Ship `<Can>` as a thin behavior primitive in `@place/security` that
gates its children on `session.can(action) === true`. Extend
`Session` with an optional `can?: (action: string) => boolean` field
that apps populate at session-install time from whatever policy
engine they prefer (Cerbos, Permify, hand-rolled RBAC, etc.). The
framework does NOT ship a policy DSL — that's an app/library
concern, not a substrate concern.

### Surface

```ts
interface CanProps {
  readonly do: string                   // free-form action name
  readonly children?: Child             // rendered when allowed
  readonly otherwise?: Child            // rendered when denied (optional)
}

function Can(props: CanProps): View

interface Session {
  // ... existing fields
  readonly can?: (action: string) => boolean
}
```

Usage:

```tsx
<Can do="post.delete">
  <Button intent="destructive" on:click={remove}>Delete</Button>
</Can>

<Can do="admin.users.read" otherwise="Access denied">
  <UserTable />
</Can>
```

### Where it lives

`@place/security`, not `@place/design`. The primitive's input is
`SessionCap` and the security model — the right system to own it is
the one that owns Session. Visual design libraries can still compose
with `<Can>` (e.g., `<Can do="x"><Button …/></Can>`).

### Semantics

- **Fails closed.** No session installed, or no `.can` predicate on
  the session, or `.can(action)` returns anything other than strict
  `true` → render `otherwise` (or nothing). This includes truthy-
  but-not-true values like `1`, `"yes"`, `{}` — they all deny. The
  policy author must opt in unambiguously.
- **Synchronous predicate.** `Session.can` is `(action: string) =>
  boolean`. Async permission checks happen at session-install time;
  the resolved values are baked in. This makes `<Can>` work
  pre-hydration in SSR — denied content NEVER appears in the
  rendered HTML, NEVER ships JS for the hidden island, and is
  invisible to view-source.
- **Reactive ready.** The predicate runs inside a `Fragment` with a
  function child, so if a session capability is updated reactively
  at runtime (logout via SPA-nav), the gate re-evaluates. The common
  case — server-set session, persists for the request — is the
  static read.
- **Free-form action strings.** Dotted names (`post.delete`), RBAC
  tuples (`admin:users:read`), policy IDs (`cerbos:post:delete`) —
  the shape is opaque to `<Can>`; whatever `.can()` matches is what
  gets gated.

### Why no policy DSL

The audit explicitly named the deferred items: a `definePolicy()`
adapter-agnostic helper, integration examples for Cerbos / Kratos.
This ADR ships only the **gate primitive**. The policy DSL is one of:

- A trivial map (`{ 'post.delete': (s) => s.role === 'admin' }`) →
  apps roll their own in 5 lines; framework adds no value.
- A complex DSL (attribute-based, hierarchical, computed) → app or
  library territory, not platform substrate.

Either way the framework's job ends at the gate. Shipping a half-DSL
risks the "every consumer has to install our build pipeline" pattern
the audit (and ADR 0026) explicitly warns against.

## Verification

- **1303 tests pass** (14 skipped) across 79 files. Was 1294
  pre-this-cut; +9 from `can.test.ts`.
- Tests cover: allowed branch, denied branch, `otherwise` rendering,
  no-session deny, no-predicate deny, strict-true required (rejects
  truthy-but-not-true returns), `do` string passes through verbatim,
  composes with element children, empty children + empty otherwise.
- No regressions in existing 1294 tests.

## What's NOT in this cut

- **`definePolicy()` adapter-agnostic helper.** Deferred; apps
  compose their own predicate. Trivial five-line shape; not platform
  surface yet.
- **`<Can all={[...]}>` / `<Can any={[...]}>`** for action lists.
  Add when a use case triggers it.
- **Child-function form `<Can do="x">{(allowed) => …}</Can>`.** Add
  when a use case needs the boolean in the children's scope (e.g.
  to render an `aria-disabled` button instead of hiding it entirely).
- **Cerbos / Kratos example apps.** Tier 16-F territory.
- **Provisional → stable graduation.** `Can` ships marked
  `@provisional` — the list/any/child-fn shape may grow.

## Why this passes "magic with clarity" (ADR 0026)

- **Discoverable in source.** One file (`can.ts`), one function, one
  type. The `Session.can` field is documented inline with its
  contract. Apps reading the code can answer "what gets gated and
  how" in one minute.
- **Traceable in tooling.** The denied branch SSRs to nothing; a
  reader inspecting view-source can confirm the unauthorized content
  is genuinely absent (not hidden via `display: none`). The gate is
  a structural choice, not a CSS trick.
- **Faithful to performance budgets.** Zero added runtime when the
  gate denies (no island bundle, no inline JS). The allowed branch
  costs whatever its children cost. The gate itself is a Fragment
  + one predicate call — about 30 bytes of overhead per `<Can>`.

## Tier 16 status after this cut

| Cut | Status | ADR |
|---|---|---|
| T16-A | (not started) | — |
| T16-B | (not started) | — |
| T16-C | (not started) | — |
| T16-D | (not started) | — |
| T16-E | ✓ | 0044 (this) |
| T16-F | (not started) | — |

## References

- ADR 0026 — "Magic with clarity" gate.
- `systems/security/docs/00-charter.md` — §`<Can>` entry.
- Tier 16 plan in `~/.claude/plans/tender-booping-waffle.md`.
