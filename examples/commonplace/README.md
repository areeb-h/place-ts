# Commonplace Book — Reference App

The reference design that shapes every system in the platform. Not a generic example; a deliberate target.

**Status:** placeholder. Will be implemented incrementally as each system reaches its phase gate.

## Why a commonplace book

A commonplace book is a personal collection of notes, quotes, ideas, and links — historically a notebook for educated readers to copy memorable passages and cross-reference them. As an app, it has the shape that exercises every system the platform offers:

- **Content-heavy** — notes, snippets, attachments. The component system has to render long-form structured content.
- **Search-heavy** — full-text + semantic + structured queries. The search system is central.
- **Link-heavy** — notes reference each other; the graph of links is itself queryable. The data system has to express graph queries.
- **History-heavy** — undo, version history, cross-references over time. The reactivity system's time-indexing has a real consumer.
- **Local-first** — works offline, syncs when online. The persistence system gets exercised under the realistic case, not toy CRUD.
- **Single-user-focused** — sidesteps multi-user collaboration concerns that would expand v0.1 scope unboundedly.

## What it demonstrates per system

| System | Demonstration |
|--------|---------------|
| reactivity | Note state, cross-note dependencies, undo via time, persistence-backed `state` |
| component | Note view, list, detail, search results |
| data | Queries by tag, by date, by link, mutations |
| cache | Query result memoization, invalidation on mutation |
| persistence | IndexedDB + optional sync to a server |
| routing | Notes by ID, by tag, search URL state |
| search | Full-text, tag filters, possibly embedding-based |
| capability | IO handlers for file attachments, sync access |
| build | Closure hashes for graph rehydration on reload, typed-effect enforcement |

## What it deliberately does not include

- Multi-user real-time collaboration.
- Rich-text editing engine (we use the simplest possible editor and treat content as Markdown).
- Plugin architecture.
- Mobile apps (web only at v0.1).
- Authentication beyond the simplest possible login (it's a single-user app).

These belong post-v0.1 if at all.

## Implementation order

The commonplace book is built incrementally as systems become available:

| Milestone | Systems available | What works |
|-----------|------------------|-----------|
| **v0.1** | reactivity (full), component (basic), data (basic), persistence (memory + IndexedDB), routing (basic), search (full-text), build (Phase 6 features) | Create / edit / link / search / undo / reload |
| **v0.2** | All v0.1 + component (full), data (full), cache | Polished UI, cache invalidation, prefetch |
| **v0.3** | + persistence (full), capability (full), routing (full) | Sync, permissions, transitions |
| **v0.4** | + search (full) | Semantic search, structured queries |

## Code

(empty — implementation starts when reactivity reaches Phase 1 done and we need a property-test fixture beyond toy graphs)
