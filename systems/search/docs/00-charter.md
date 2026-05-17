# 00 — Search System Charter

**Status:** stub. Designed in v0.4. Critical for the commonplace book reference design.

## Scope (provisional)

- Full-text index over content (the commonplace book is search-heavy).
- Semantic search via embeddings (optional adapter, not required at v0.4).
- Structured queries — by tag, by date range, by linked-from, by note shape.
- Ranking — content relevance, recency, link weight.
- Incremental index updates as content changes (driven by reactivity).

## What this system does not own

- Storage of indexes (persistence).
- Embedding model (user-provided adapter).
- Reactive primitives (reactivity).

## Depends on

- data (for content access)
- persistence (for index storage)
- cache (for query result memoization)

## Open questions for design phase

- Index implementation: Lunr-style, custom inverted index, SQLite FTS, Tantivy via WASM?
- Embedding provider: pluggable (OpenAI / local / nothing)?
- Real-time vs eventually-consistent indexing?
- Query DSL: builder-style or SQL-like?

## Phase

Deferred to **v0.4**.
