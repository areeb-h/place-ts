# 00 — Cache System Charter

**Status:** stub. Designed alongside data system in v0.2.

## Scope (provisional)

- Cache entries keyed by query identity.
- Invalidation graph — entries can be invalidated by event, by mutation, by time, or by other entries.
- Memoization with TTL, LRU, and other policies.
- Stale-while-revalidate semantics.
- Integration with persistence (cached durably) and reactivity (entries are `State`s).

## What this system does not own

- The query API (data).
- Storage (persistence).
- Network transport.

## Depends on

- reactivity (entries surface as `State`s)
- data (the cache serves queries)

## Open questions for design phase

- Cache key: structural hash of args, or user-provided identity?
- Invalidation: declarative rules or imperative API?
- Multi-tier (memory + durable)?
- How do stale-while-revalidate semantics interact with the time-indexing model?

## Phase

Deferred to **v0.2**.
