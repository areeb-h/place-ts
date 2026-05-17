# Cache System

Typed-effect cache, invalidation graph, query identity, memoization beyond what `derived` provides.

**Status (2026-05-05): deferred indefinitely.** No concrete trigger emerged. The operational caching need (typed `get`/`set`/`delete` for ISR + image-optimizer storage) is covered by the [`CacheStore`](../component/src/cache.ts) primitive in the component system — that's where the consumers live. The charter here remains as the design intent for the broader vision: cache entries as reactive `State`s, declarative invalidation graph, multi-tier (memory + durable) policies. We'll revisit if a workload demands more than CacheStore provides.

See [docs/00-charter.md](docs/00-charter.md) for the original scope sketch.
