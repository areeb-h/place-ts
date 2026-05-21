import { runWithCapabilityScopeSync } from '@place-ts/capability'

// @place-ts/component cache primitive — used by ISR (revalidate-after-N-seconds)
// and the image optimizer (lazy variant generation). This is NOT a general-
// purpose cache library; it is a typed contract between framework code that
// produces cacheable Responses and pluggable storage backends.
//
// Why we ship our own instead of reusing Next's `unstable_cache` shape:
//   - Next's cache is global, untyped, and infamously prone to auth-context
//     bleed when keys forget to include the auth token. We make the contract
//     boring by not letting it span requests at all by default — keys are
//     URL+search strings, scoped to the route's intended audience.
//   - SvelteKit and Astro punt entirely to Vercel's Build Output API for ISR
//     storage, which only works on Vercel. Ours runs anywhere Bun runs, and
//     the same interface accepts a `@place-ts/persistence`-backed store later
//     for multi-replica deployments.
//
// Inflight-dedupe (a single render serving many simultaneous waiters) is a
// concern of the *consumer* (ISR, image optimizer), not the store — the
// store is just key/value/tags. Consumers wrap the store with their own
// `Map<key, Promise<Entry>>` to dedupe.

export interface CacheEntry {
  /** Response body. String for text/HTML, Uint8Array for binary (images). */
  body: string | Uint8Array
  /** Headers to set on the served response. */
  headers: Record<string, string>
  /** When this entry was built (Date.now() ms). Consumers compare against
   *  the configured TTL to decide stale vs fresh. */
  builtAt: number
  /** Tags for bulk invalidation via `revalidate.tag(name)`. Optional. */
  tags?: string[]
  /**
   * SHA-256 hashes (base64, unquoted) of every distinct `style="…"`
   * attribute value emitted while this body was rendered. T6-B: the
   * dispatcher injects these into the response's CSP `style-src`
   * directive (along with `'unsafe-hashes'`) so strict CSP allows the
   * inline styles the browser is about to see. Stored on the cache
   * entry so subsequent cache hits can rebuild the same CSP without
   * re-rendering.
   */
  inlineStyleAttrHashes?: readonly string[]
}

export interface CacheStore {
  /** Look up an entry by exact key. Returns null when absent. */
  get(key: string): Promise<CacheEntry | null>
  /** Store an entry. Overwrites any existing entry at the same key. */
  set(key: string, entry: CacheEntry): Promise<void>
  /**
   * Invalidate entries by their full keys, by tag membership, or both.
   * Pass `{ keys: ['/page'] }` for path-based revalidation; pass
   * `{ tags: ['posts'] }` for content-class invalidation. Pass `{}` to
   * clear everything (rarely useful — usually a bug).
   */
  delete(filter: { keys?: string[]; tags?: string[] }): Promise<void>
}

/**
 * In-process Map-backed store. The default for `serve()`'s ISR. Survives
 * the lifetime of one Bun process. For multi-replica deployments, swap in
 * a persistence-backed store via the same interface.
 *
 * Key encoding: callers should pass URL-shaped keys ('/page', '/users/42').
 * We don't normalize or hash keys — the consumer chose the format.
 */
export function memoryStore(): CacheStore {
  const map = new Map<string, CacheEntry>()
  return {
    async get(key) {
      return map.get(key) ?? null
    },
    async set(key, entry) {
      map.set(key, entry)
    },
    async delete(filter) {
      // {} (both fields undefined) means "clear everything" — explicit
      // opt-in intent. {keys:[], tags:[]} means "filter matches nothing"
      // and is a no-op.
      if (filter.keys === undefined && filter.tags === undefined) {
        map.clear()
        return
      }
      if (filter.keys?.length) {
        for (const k of filter.keys) map.delete(k)
      }
      if (filter.tags?.length) {
        const tagSet = new Set(filter.tags)
        for (const [k, v] of map) {
          if (v.tags?.some((t) => tagSet.has(t))) map.delete(k)
        }
      }
    },
  }
}

// ===== cache(fn, opts) — opt-in function-level memoization =====
//
// Closes the gap vs Next 16's Cache Components / "use cache" directive,
// without requiring a compiler. Wraps any async function in a memoized
// version backed by an in-process Map; results are keyed by JSON-
// stringified args (override via `opts.key`). TTL + tag-based
// invalidation via the existing `revalidate.tag(...)` registry.
//
// The contract is intentionally smaller than CacheStore:
//   - CacheStore is for HTTP responses (bodies + headers + tags); used
//     by ISR and the image optimizer where the cached unit IS a Response.
//   - cache(fn) is for arbitrary function results; used by app code
//     wanting "fetch this user once per minute, share across all
//     concurrent calls."
//
// Inflight-dedupe: concurrent calls with the same key share one Promise.
// This is the most common bug class in hand-rolled memoization (the
// thundering-herd problem); we get it right by default.
//
// Why no "use cache" directive: Next's compiler approach is magical and
// requires a Babel/SWC pass. A plain function call is cheaper, debuggable,
// and works in any runtime. Trade-off: callers see they're memoizing
// at the call site (`cache(fn, opts)`) instead of the directive site.

export interface CacheOptions<A extends readonly unknown[]> {
  /**
   * Time-to-live in seconds. Past this age, the next call recomputes.
   * Omit for cache-until-tag-invalidation (no time-based expiry).
   */
  ttl?: number
  /**
   * Tags for bulk invalidation via `revalidate.tag(...)`. Every entry
   * produced by this cache shares these tags — fine-grained per-entry
   * tagging would require recomputing on every call (defeating the
   * point), so tag at the cache level.
   */
  tags?: string[]
  /**
   * Custom key-from-args. Default: JSON.stringify(args). Override when
   * args contain non-JSON-safe values (functions, Symbols, cycles) or
   * when only a subset of args should participate in the key (e.g. the
   * first arg only; ignore an options bag).
   */
  key?: (...args: A) => string
}

interface CacheInvalidator {
  tags: ReadonlySet<string>
  clearAll(): void
  clearByKey(key: string): void
}

const _cacheInvalidators = new Set<CacheInvalidator>()

/**
 * Invalidate every `cache(fn)` entry whose tags intersect with the
 * given tags. Called by the framework's `revalidate.tag(...)` so apps
 * use one invalidation API for both ISR and `cache()`.
 */
export function _invalidateCachesByTag(tags: readonly string[]): void {
  if (tags.length === 0) return
  const tagSet = new Set(tags)
  for (const c of _cacheInvalidators) {
    for (const t of c.tags) {
      if (tagSet.has(t)) {
        c.clearAll()
        break
      }
    }
  }
}

/**
 * Memoize `fn` so repeated calls with the same arguments return the
 * cached result instead of recomputing. Concurrent calls share one
 * in-flight promise (no thundering herd).
 *
 * ```ts
 * const getUser = cache(
 *   async (id: string) => fetch(`/api/users/${id}`).then((r) => r.json()),
 *   { ttl: 60, tags: ['user'] },
 * )
 *
 * const u1 = await getUser('abc')   // miss → fetch → store
 * const u2 = await getUser('abc')   // hit → returns cached
 * await revalidate.tag('user')      // clears the cache
 * const u3 = await getUser('abc')   // miss → fetch → store
 * ```
 *
 * Async + sync functions both work. Throws are NOT cached — the next
 * call retries (caching errors makes "outage propagation" worse than
 * the original outage).
 */
export function cache<A extends readonly unknown[], R>(
  fn: (...args: A) => R | Promise<R>,
  options?: CacheOptions<A>,
): (...args: A) => Promise<R> {
  const results = new Map<string, R>()
  const expiries = new Map<string, number>()
  const inflight = new Map<string, Promise<R>>()
  // Per-key sentinel for the inflight cleanup race-fix; see usage below.
  const inflightTokens = new Map<string, object>()
  const tags = new Set(options?.tags ?? [])
  const ttlMs = options?.ttl !== undefined ? options.ttl * 1000 : null
  const keyFn = options?.key ?? ((...args: A) => JSON.stringify(args))

  // Generation counter increments on every invalidation. In-flight
  // promises capture the generation at start; if it changes before
  // they resolve, their result is discarded — the post-invalidation
  // caller has already triggered a fresh fetch with the new generation.
  // This closes a race where an invalidation during in-flight fetch
  // would otherwise re-cache the stale result on resolution.
  let generation = 0

  // Register for invalidation via revalidate.tag().
  if (tags.size > 0) {
    _cacheInvalidators.add({
      tags,
      clearAll: () => {
        results.clear()
        expiries.clear()
        inflight.clear()
        inflightTokens.clear()
        generation++
      },
      clearByKey: (k) => {
        results.delete(k)
        expiries.delete(k)
        inflight.delete(k)
        inflightTokens.delete(k)
        generation++
      },
    })
  }

  return async (...args: A): Promise<R> => {
    const key = keyFn(...args)
    // Fresh hit?
    if (results.has(key)) {
      const expires = expiries.get(key)
      if (expires === undefined || Date.now() < expires) {
        return results.get(key) as R
      }
      // Stale — fall through to recompute.
      results.delete(key)
      expiries.delete(key)
    }
    // Concurrent call already running for this key?
    const existing = inflight.get(key)
    if (existing) return existing
    // Compute, dedupe via inflight map. Capture the generation now;
    // if invalidation bumps it before we resolve, we skip the write
    // (the post-invalidation caller is already producing the fresh value).
    const startGen = generation
    // A unique sentinel per call. We pair the promise with this token
    // in `inflight` so the cleanup in `finally` only evicts OUR entry —
    // not one a concurrent invalidation+caller pair installed in our
    // slot. Using a sentinel (instead of comparing the promise to
    // itself) sidesteps the `used-before-assigned` self-reference.
    const myToken: object = {}
    const promise = (async (): Promise<R> => {
      try {
        // Auth-context-bleed prevention: run `fn` in a fresh capability
        // scope. Per-request capabilities (Session, Router, etc.,
        // installed inside the request handler's scope) are NOT visible
        // here — defineCapability snapshots from the closure baseline
        // on first access, and the closure baseline is the cross-
        // request module-level state. So a cached fn that calls
        // `SessionCap.use()` throws naturally because the cap isn't in
        // its (fresh) scope. This is structural — any cap reader,
        // including transitive ones a future feature might add, fails
        // automatically without us enumerating them.
        //
        // We catch the cap-not-provided error specifically and augment
        // its message with a fix hint pointing at the cause; everything
        // else propagates unchanged.
        // runWithCapabilityScopeSync invokes fn synchronously inside a
        // fresh ALS scope. fn either returns a value (sync) or a Promise
        // (async); we await the result either way. Sync invocation is
        // load-bearing for the inflight-dedupe contract upstream — the
        // first call's `calls++` runs before any caller observes the
        // returned promise.
        let result: R
        try {
          result = (await runWithCapabilityScopeSync(() => fn(...args))) as R
        } catch (err) {
          // Augment cap-not-installed errors with a fix hint pointing
          // at the cache(fn) cause. Substring matches against both the
          // `use()` path ("not provided") and the `requires()` path
          // ("required but not installed").
          if (
            err instanceof Error &&
            err.message.includes('capability ') &&
            (err.message.includes('not provided') ||
              err.message.includes('required but not installed'))
          ) {
            const augmented = new Error(
              `${err.message}\n` +
                "  → Per-request capabilities aren't visible inside cache(fn) — they're isolated " +
                'to prevent auth-context bleed across cached entries. Pass the value as an ' +
                'argument to your cached function and include it in the cache key.',
              { cause: err },
            )
            if (err.stack !== undefined) augmented.stack = err.stack
            throw augmented
          }
          throw err
        }
        if (generation === startGen) {
          results.set(key, result)
          if (ttlMs !== null) expiries.set(key, Date.now() + ttlMs)
        }
        return result
      } finally {
        if (inflightTokens.get(key) === myToken) {
          inflight.delete(key)
          inflightTokens.delete(key)
        }
      }
    })()
    inflight.set(key, promise)
    inflightTokens.set(key, myToken)
    return promise
  }
}
