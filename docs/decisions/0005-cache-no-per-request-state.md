# ADR 0005: `cache(fn)` cannot read per-request state

**Status:** accepted
**Date:** 2026-05-05
**Affects:** `@place/component/cache.ts`, `@place/capability` (`runWithCapabilityScopeSync`)

## Context

Next.js's caching layers ([discussion #86538](https://github.com/vercel/next.js/discussions/86538)) are the most-cited "I switched away" trigger in the 2025–2026 ecosystem ([research-dx-painpoints.md](../../research-dx-painpoints.md)). The recurring failure mode: a cached function reads per-request state (cookies, session, headers) that the cache key doesn't capture, so user A's session leaks into user B's cache hit. Auth-context bleed.

Our `cache(fn, opts)` from Phase 7.1 ships the same shape and inherits the same risk if we don't bound it. Concretely: `cache((req) => readUserFromCookie(req))` would memoize a per-user response across users — a textbook footgun.

## Decision

`cache(fn)` invokes `fn` inside a fresh capability scope via `runWithCapabilityScopeSync`. Per-request capabilities (Session, Router, etc., installed inside a request handler's scope) are **structurally invisible** to the cached function. Reads of those caps inside the cached fn fail naturally with the cap-not-provided error.

The cache layer additionally augments the cap-not-provided error message with a fix hint pointing at the cache(fn) cause:

> capability 'SessionCap' not provided. ...
>   → Per-request capabilities aren't visible inside cache(fn) — they're isolated to prevent auth-context bleed across cached entries. Pass the value as an argument to your cached function and include it in the cache key.

For request data not mediated by capabilities — e.g. `parseCookies(req.headers.get('cookie'))` — the user's fn must accept the relevant value as an argument. The default keyer (JSON.stringify(args)) ensures different inputs produce different cache entries; users with non-JSON-safe shapes provide a custom `key` function.

## Why not enumerate readers (the rejected alternative)

The first instinct was to add an "are we inside cache?" ALS flag and have specific functions (`parseCookies`, `requireSession`, `SessionCap.use`, `SessionCap.tryUse`) check it and throw a clear error. This was rejected as a band-aid for two reasons:

1. **Whack-a-mole.** Any user-defined helper that reads per-request state through a different path slips through. Future per-request capabilities (a `LocaleCap`, `RequestIdCap`) need to be added to the guard list manually.
2. **Wrong layer.** The capability system already has the structural answer: scope isolation. Composing `runWithCapabilityScopeSync` with the existing scope mechanism is one primitive doing one job; the reader-list approach duplicates intent at every reader site.

The structural answer survives addition of new per-request caps without code changes — they're auto-isolated.

## Why not compile-time TS guard

A type-level guard rejecting fns whose argument types include `Request` / `Headers` / `URL` was considered. Rejected per direction: transitive reads (a helper that internally reads cookies without exposing the type in its signature) slip through TS conditional types, and the runtime cap-scope mechanism catches more cases. If a future workload needs a type-side guard layered on top, the structural runtime fix doesn't preclude adding it.

## Consequences

- **Positive:** auth-context bleed is structurally prevented, not merely warned-against. App authors who cache a function that needs session must explicitly accept the session-derived value as an argument — making the cache key correctly differentiate.
- **Positive:** future per-request caps inherit the protection automatically.
- **Positive:** error message points at the fix (the cache hint) instead of a generic "cap not installed" that would confuse a developer who DID install the cap (just outside the cache scope).
- **Required infrastructure:** capability now exposes `runWithCapabilityScopeSync` (sync variant of the existing async `runWithCapabilityScope`), backed by top-level await of `node:async_hooks` at module init so `als` is loaded before any importer's code runs. The sync variant is needed by `cache(fn)`'s inflight-dedupe contract, which requires `fn` to be invoked synchronously when the wrapped function is called.
- **Constraint on consumers:** cached functions cannot rely on ambient per-request state. Useful per-request data must be threaded through arguments. This is the right contract — it makes the cache key complete by construction.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| ALS guard at specific security readers (parseCookies, requireSession, SessionCap.use/tryUse) | Whack-a-mole; doesn't survive new caps; duplicates intent at every reader site |
| Compile-time TS guard rejecting Request-typed args | Transitive reads slip through; weaker than runtime structural fix; per direction |
| Two-tier API (`cache` for cross-request, `requestCache` for per-request) | Adds API surface; the request-scope case is rare enough to hand-roll with `Map<key, value>` |
| Documentation only ("don't read per-request state from cache(fn)") | Matches Next's failed approach; the user's mistake is the framework's bug |

## How to adopt

No app-side change required. Existing `cache(fn)` callers continue to work unchanged unless they were reading per-request capabilities — those will now get the augmented error. The fix is to thread the value as an argument:

```ts
// Before (auth-context bleed risk):
const getProfile = cache(async (userId: string) => {
  const session = SessionCap.use() // would throw inside cache(fn)
  return db.profile(userId, session.role)
})

// After (per-request data passed explicitly):
const getProfile = cache(
  async (userId: string, role: string) => {
    return db.profile(userId, role)
  },
  { key: (userId, role) => `${userId}:${role}` },
)
// Caller threads the request data:
const profile = await getProfile(userId, SessionCap.use().role)
```
