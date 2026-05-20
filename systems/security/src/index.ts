// @place/security — security primitives.
//
// Built on Web Crypto + the capability system. Runs in browsers, Bun,
// and Node 19+. Five primitives total:
//
//   - signedToken<T>(secret)    HMAC-SHA256 signed payload with optional
//                                expiry. The building block for cookies,
//                                CSRF, anywhere you need authenticated
//                                opaque tokens.
//   - csrfToken(secret)         Double-submit CSRF tokens bound to a
//                                session id. Generate, send to client,
//                                verify on mutating requests.
//   - rateLimit(opts)            In-memory token bucket per key.
//   - SessionCap + requireSession  The capability-based session model.
//                                Handlers `requires(SessionCap)` and use
//                                `requireSession()` to fail closed when
//                                unauthenticated.
//   - parseCookies / setCookieHeader  HTTP cookie helpers.
//                                Secure-by-default (HttpOnly, SameSite=Lax,
//                                Secure). Two options: max-age and an
//                                explicit `insecure` for localhost dev.
//
// Design philosophy:
//   - Tight surface: each primitive is one function. No giant config.
//   - Secure-by-default: the *easy* path is the *safe* path. To make a
//     cookie JS-readable or non-Secure, you build the Set-Cookie string
//     yourself — the helper won't help you make insecure choices.
//   - Composable with the rest of the platform: SessionCap is just a
//     capability. CSRF tokens are just signed strings. Rate limit is
//     just a function that returns boolean. No middleware framework.
//
// What this is NOT:
//   - An auth library. We don't ship login flows, OAuth, or JWT
//     compatibility. Those are app-policy decisions; the primitives
//     here are the substrate.
//   - A SQL parameterization wrapper. `bun:sqlite`'s `prepare()` is
//     already the safe path; nothing to add.
//   - A full CSP middleware. Ship a `Content-Security-Policy` header
//     when the consumer's `Bun.serve` handler builds responses; the
//     constants below are starter values, not a one-call solution.

import { defineCapability } from '@place/capability'

// ===== Internal: HMAC + base64url + constant-time compare =====

const enc = new TextEncoder()
const dec = new TextDecoder()

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return base64urlEncode(new Uint8Array(sig))
}

function base64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Constant-time string comparison. The native path (`Bun.timingSafeEqual`,
// or `crypto.timingSafeEqual` in Node) is ~65–110× faster than the
// JS fallback ([advename/web-timing-safe-equal](https://github.com/advename/web-timing-safe-equal))
// AND clears OWASP ASVS 5.0 11.2.4 (L3 — all crypto comparisons must
// be constant-time). The fallback below is preserved for environments
// where neither global is available (esoteric — happy-dom + Node <19,
// some browsers); it still walks the longer string to avoid leaking
// length via timing.
//
// Why this isn't just `Bun.timingSafeEqual`:
//   - Bun's variant is available only when running under Bun.
//   - `crypto.timingSafeEqual` (Node API) requires equal-length inputs
//     and throws otherwise — we have to harmonise lengths first.
//   - Happy-dom (vitest) is a Node environment but doesn't expose the
//     same crypto surface; the fallback covers that case.

declare const Bun:
  | { timingSafeEqual?: (a: Uint8Array | ArrayBuffer, b: Uint8Array | ArrayBuffer) => boolean }
  | undefined

function constantTimeEqual(a: string, b: string): boolean {
  // Pre-check length-mismatch on the OUTSIDE — the native APIs reject
  // unequal lengths, and we want a constant-time `false` in that case
  // anyway. We still walk both buffers to avoid leaking the length
  // difference via timing (the safety-equality result alone doesn't
  // disclose which side is longer, just that they differ).
  const aBytes = enc.encode(a)
  const bBytes = enc.encode(b)
  const lengthOk = aBytes.length === bBytes.length
  // Pad both sides to a common length so the native comparison runs.
  // If lengths differed we'll still get `false`, but the comparison
  // time depends only on the COMMON length — no leak.
  const len = Math.max(aBytes.length, bBytes.length)
  const aPad = aBytes.length === len ? aBytes : padTo(aBytes, len)
  const bPad = bBytes.length === len ? bBytes : padTo(bBytes, len)
  // Prefer Bun.timingSafeEqual (native, AVX2-where-available).
  if (typeof Bun !== 'undefined' && typeof Bun.timingSafeEqual === 'function') {
    return lengthOk && Bun.timingSafeEqual(aPad, bPad)
  }
  // Node fallback — same algorithm, slightly slower.
  const nodeCrypto = (globalThis as { crypto?: { timingSafeEqual?: unknown } }).crypto
  if (
    nodeCrypto &&
    typeof (nodeCrypto as { timingSafeEqual?: unknown }).timingSafeEqual === 'function'
  ) {
    return (
      lengthOk &&
      (
        nodeCrypto as { timingSafeEqual: (a: Uint8Array, b: Uint8Array) => boolean }
      ).timingSafeEqual(aPad, bPad)
    )
  }
  // Pure-JS fallback — order-of-magnitude slower but algorithmically
  // identical. Walks the full length regardless of where the first
  // byte differs.
  let result = lengthOk ? 0 : 1
  for (let i = 0; i < len; i++) {
    result |= (aPad[i] ?? 0) ^ (bPad[i] ?? 0)
  }
  return result === 0
}

function padTo(buf: Uint8Array, len: number): Uint8Array {
  if (buf.length === len) return buf
  const out = new Uint8Array(len)
  out.set(buf)
  return out
}

// ===== CryptoProviderCap — FIPS-pluggable boundary =====
//
// Every cryptographic operation in the framework's hot path goes
// through this interface. The default implementation calls Bun's
// native crypto (the global `crypto.subtle` / `crypto.randomBytes` /
// `Bun.timingSafeEqual`). Deployers who need FedRAMP-High or other
// FIPS-140-3-validated module compliance install a different provider
// (e.g. AWS-LC-FIPS, OpenSSL 3.1.2 FIPS, BoringCrypto) by replacing
// the cap implementation at app boot — zero code change in handlers.
//
// Why a capability instead of a function table:
//   - The capability is scoped by `provide()` or installed at app
//     boot. No global mutable state.
//   - Per-test isolation: a test can install a deterministic mock
//     provider without affecting other tests.
//   - The framework can ship multiple implementations (`bunCrypto`,
//     `awsLcFips`) that consumers select via dep + install.
//
// Standards: OWASP ASVS 5.0 11.2.2 (crypto-agility) + 11.1.1
// (algorithm rotation); NIST SP 800-53 Rev 5 SC-13 (cryptographic
// protection); FedRAMP Crypto Policy v1.1.0 (Jan 2025).
//
// The interface is deliberately minimal — operations the framework
// actually needs, no kitchen-sink. Adding an algorithm later (e.g.
// ML-DSA when ecosystem support normalises) extends the interface
// additively; old providers continue to work.

/** A cryptographic primitive provider — FIPS-validated or otherwise. */
export interface CryptoProvider {
  /** Identifier for diagnostics + audit logs. */
  readonly id: string
  /**
   * Whether this provider has documented FIPS-140-3 validation. The
   * framework prints a startup warning when `criticalAction()` is
   * used with a provider that doesn't claim validation in a build
   * tagged `NODE_ENV=production`. Doesn't enforce — apps own their
   * compliance posture. Honest signal.
   */
  readonly fipsValidated: boolean
  /** Fill the buffer with cryptographically strong random bytes. */
  randomBytes(n: number): Uint8Array
  /** HMAC-SHA-256 sign. Returns the raw 32-byte tag. */
  hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array>
  /**
   * Constant-time equality check on two byte buffers. Differing
   * lengths return `false` without leaking which is longer.
   */
  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean
  /**
   * HKDF-SHA-256 key derivation (RFC 5869). Used by `rotatingKey()`
   * to derive per-day / per-session sub-keys from a root secret
   * without exposing the root to handler code.
   */
  hkdfSha256(
    ikm: Uint8Array,
    salt: Uint8Array,
    info: Uint8Array,
    length: number,
  ): Promise<Uint8Array>
}

/**
 * Default provider — uses Bun's native crypto + the Web Crypto API.
 * Fast, in-process, not FIPS-validated (Bun isn't a FIPS module).
 * Acceptable for everything except FedRAMP-High deployments; for
 * those, swap in a FIPS-validated provider at app boot.
 */
export const bunCryptoProvider: CryptoProvider = {
  id: 'bun-native',
  fipsValidated: false,
  randomBytes(n) {
    const out = new Uint8Array(n)
    crypto.getRandomValues(out)
    return out
  },
  async hmacSha256(key, message) {
    // The `as BufferSource` casts are needed under TS 5.8+'s stricter
    // ArrayBufferLike vs ArrayBuffer distinction — Uint8Array's
    // generic `ArrayBufferLike` doesn't auto-narrow to `ArrayBuffer`
    // even though every concrete Uint8Array we construct has one.
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key as BufferSource,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const tag = await crypto.subtle.sign('HMAC', cryptoKey, message as BufferSource)
    return new Uint8Array(tag)
  },
  timingSafeEqual(a, b) {
    // Mirror the constantTimeEqual harmonisation above: pad to common
    // length so the underlying compare doesn't leak length via timing.
    const lengthOk = a.length === b.length
    const len = Math.max(a.length, b.length)
    const aPad = a.length === len ? a : padTo(a, len)
    const bPad = b.length === len ? b : padTo(b, len)
    if (typeof Bun !== 'undefined' && typeof Bun.timingSafeEqual === 'function') {
      return lengthOk && Bun.timingSafeEqual(aPad, bPad)
    }
    const nodeCrypto = (globalThis as { crypto?: { timingSafeEqual?: unknown } }).crypto
    if (
      nodeCrypto &&
      typeof (nodeCrypto as { timingSafeEqual?: unknown }).timingSafeEqual === 'function'
    ) {
      return (
        lengthOk &&
        (
          nodeCrypto as { timingSafeEqual: (a: Uint8Array, b: Uint8Array) => boolean }
        ).timingSafeEqual(aPad, bPad)
      )
    }
    let result = lengthOk ? 0 : 1
    for (let i = 0; i < len; i++) result |= (aPad[i] ?? 0) ^ (bPad[i] ?? 0)
    return result === 0
  },
  async hkdfSha256(ikm, salt, info, length) {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      ikm as BufferSource,
      { name: 'HKDF' },
      false,
      ['deriveBits'],
    )
    const derived = await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
      cryptoKey,
      length * 8,
    )
    return new Uint8Array(derived)
  },
}

/**
 * Capability slot for the active crypto provider. Apps install at
 * boot:
 *
 *   import { app } from '@place/component/server'
 *   import { CryptoProviderCap, awsLcFipsProvider } from '@place/security'
 *
 *   app({
 *     caps: [[CryptoProviderCap, awsLcFipsProvider]],
 *     …
 *   })
 *
 * Apps that don't install a provider get `bunCryptoProvider` via the
 * `.use(default)` fallback.
 */
export const CryptoProviderCap = defineCapability<CryptoProvider>('CryptoProvider')

/**
 * Read the active crypto provider, falling back to the Bun-native
 * default when no capability is installed. The fallback path is the
 * common case for non-FIPS deployments.
 */
export function useCryptoProvider(): CryptoProvider {
  return CryptoProviderCap.use(bunCryptoProvider)
}

// ===== rotatingKey — per-day HMAC root key with HKDF-derived sub-keys =====
//
// Forward secrecy without a database hit on the hot path. The root
// secret never appears in handler-reachable code; only its
// HKDF-derived per-day sub-keys do, and those rotate automatically.
// A leak of a single day's sub-key has a bounded blast radius.
//
// Pattern from 2025-era webhook providers (Slack, Stripe, GitHub):
// publish a stable root, derive ephemeral keys, in-process LRU cache
// keyed on (rootId, dayBucket).
//
// Standards:
//   - OWASP ASVS 5.0 11.1.1 (rotation), 11.2.2 (crypto-agility)
//   - NIST SP 800-57 Part 1 Rev 5 (key management lifecycle)
//   - NIST SP 800-108 (KDF in counter mode; we use HKDF per RFC 5869)
//
// Cost: cache hit ~5ns (`Map.get()`). Cache miss = one HKDF call
// (~2–5µs Bun-native), then cached. The default 90-day eviction window
// keeps recent days warm without unbounded growth.

export interface RotatingKey {
  /**
   * Return the sub-key for `at` (defaults to now). Cheap when the
   * day's sub-key is cached; performs an HKDF derivation on cache
   * miss. The returned Uint8Array is the actual HMAC key — pass it
   * to `provider.hmacSha256(key, msg)`.
   */
  keyAt(at?: Date): Promise<Uint8Array>
  /**
   * Stable key identifier for `at`. The framework includes this in
   * the action envelope so the verifier knows which day's sub-key
   * was used (clock skew at the edges of a day is handled by the
   * verifier accepting the previous + next day too).
   */
  keyIdAt(at?: Date): string
}

/**
 * Build a rotating-key derivation from a root secret. The root must
 * be at least 32 bytes (256 bits) — the framework refuses to ship
 * weaker secrets in production.
 *
 * @param root  Root secret as bytes (32+ bytes recommended).
 * @param opts  `rotateEveryMs` (default 1 day), `cacheMax` (default 90 entries),
 *              `info` (HKDF info string; defaults to "place/v1/action-key").
 */
export function rotatingKey(
  root: Uint8Array,
  opts: { rotateEveryMs?: number; cacheMax?: number; info?: string } = {},
): RotatingKey {
  if (root.length < 32) {
    throw new Error(
      '@place/security: rotatingKey root must be at least 32 bytes (256 bits). ' +
        'Use `bunCryptoProvider.randomBytes(32)` or equivalent to generate one.',
    )
  }
  const rotateEveryMs = opts.rotateEveryMs ?? 24 * 60 * 60 * 1000
  const cacheMax = opts.cacheMax ?? 90
  const info = enc.encode(opts.info ?? 'place/v1/action-key')
  const cache = new Map<string, Uint8Array>()
  const bucket = (at: Date): number => Math.floor(at.getTime() / rotateEveryMs)
  return {
    keyIdAt(at = new Date()) {
      return `b${bucket(at)}`
    },
    async keyAt(at = new Date()) {
      const id = `b${bucket(at)}`
      const cached = cache.get(id)
      if (cached) return cached
      const provider = useCryptoProvider()
      // Salt = bucket id (deterministic per day); info = stable
      // domain-separation tag. HKDF guarantees independence between
      // buckets even though the root is shared.
      const salt = enc.encode(id)
      const derived = await provider.hkdfSha256(root, salt, info, 32)
      // LRU-style eviction: drop the oldest entry when over cap. Cheap
      // for a 90-entry cache; a Map preserves insertion order so
      // `keys().next().value` is the oldest.
      if (cache.size >= cacheMax) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      cache.set(id, derived)
      return derived
    },
  }
}

// ===== NonceStoreCap — IPsec-style sliding-window replay defense =====
//
// **The threat:** an attacker captures a legitimate action request
// (e.g. via shoulder-surfing TLS keys, network logging at an
// intermediary, browser-history theft) and replays it within the
// HMAC envelope's freshness window. The HMAC is valid; only a
// distinct nonce-tracking layer can reject the replay.
//
// **The defense:** each request carries a monotonically-increasing
// `counter` (the `jti` in the envelope). The server tracks the
// highest counter seen per session, plus a bitmap of the most-recent
// N counters. A request is accepted iff its counter is novel and
// within N of the most recent. This is the exact IPsec anti-replay
// algorithm (RFC 4302/4303), proven correct + memory-bounded:
//
//   - Memory: one `(rightEdge, bitmap)` tuple per session — ~16 bytes
//     per session regardless of how many requests they make.
//   - Lookup: O(1) — bitmap shift + bit test, no DB read.
//   - Out-of-order tolerance: N (default 64) — handles network
//     reordering on a single keep-alive connection while still
//     rejecting any counter older than N behind the right edge.
//
// **Why a counter, not a random `jti`?** Random nonces need either a
// bounded LRU (probabilistic) or unbounded growth. Counters give
// constant memory + O(1) decisions + no probabilistic failures —
// what high-assurance systems use. The client-side complexity (an
// IndexedDB-backed counter that survives reloads) is real but small;
// the framework's client layer (Phase 2b) handles it.
//
// **What goes in the bitmap:**
//
//   right          → bit 0 (LSB) of bitmap
//   right - 1      → bit 1
//   ...
//   right - W + 1  → bit W-1 (MSB of the window)
//
// When a counter c > right arrives, the window slides: shift bitmap
// LEFT by (c - right) positions, then OR in bit 0 (recording c). Any
// bits that fall off the high end were old and don't need to be
// remembered.
//
// **Standards:** OWASP ASVS 5.0 11.3.4 (L3 — nonce single-use within
// the validity window); NIST SP 800-77 Rev 1 (IPsec implementation
// guidance, sec 4.3); RFC 4303 (ESP anti-replay).
//
// **Pluggable.** The default `inMemoryNonceStore()` is per-process.
// Multi-node deployments install `redisNonceStore(client)` or a
// Durable-Object-backed adapter. The interface is small (3 methods)
// so writing a new adapter is ~20 lines.

export interface NonceStore {
  /**
   * Check + record. Returns true when `counter` is novel for
   * `sessionId` AND within the sliding window of the rightmost
   * counter seen; false on replay (counter previously marked) or
   * stale (counter is more than W positions behind the right edge).
   *
   * Implementations MUST be linearizable per (sessionId, counter) —
   * concurrent calls for the same session must agree on which one
   * "wins" the slot. The in-memory default is single-threaded JS so
   * this is free; Redis-backed adapters use Lua/CAS.
   */
  check(sessionId: string, counter: number): Promise<boolean>
  /**
   * Drop the nonce state for `sessionId`. Called when a session
   * logs out / expires, so the bitmap doesn't outlive its purpose.
   * Idempotent — returning when no state existed is fine.
   */
  forget(sessionId: string): Promise<void>
  /**
   * Number of currently-tracked sessions (for observability). The
   * in-memory default uses this for the dev-banner stat; durable
   * stores may return a rolling estimate.
   */
  size(): Promise<number>
}

/**
 * Default in-memory nonce store — one `(rightEdge, bitmap)` tuple per
 * session. Suitable for dev + single-process production. Multi-node
 * deployments install a Redis / Durable-Object / Postgres adapter.
 *
 * @param opts.windowSize  Bitmap width in bits (default 64). Trades
 *   out-of-order tolerance for memory. 64 is the IPsec default + the
 *   sweet spot for HTTP — handles realistic network reordering on
 *   one connection without consuming meaningful memory.
 */
export function inMemoryNonceStore(opts: { windowSize?: number } = {}): NonceStore {
  const W = opts.windowSize ?? 64
  if (W < 1 || W > 256) {
    throw new Error(`@place/security: NonceStore windowSize must be 1..256 (got ${W})`)
  }
  const sessions = new Map<string, { right: number; bitmap: bigint }>()
  const WMask = (1n << BigInt(W)) - 1n
  return {
    async check(sessionId, counter) {
      if (!Number.isInteger(counter) || counter < 0 || !Number.isFinite(counter)) return false
      const entry = sessions.get(sessionId)
      if (!entry) {
        // First-ever counter for this session — accept + record.
        sessions.set(sessionId, { right: counter, bitmap: 1n })
        return true
      }
      const { right, bitmap } = entry
      if (counter > right) {
        // Right edge advances. Shift bitmap left by the gap, set bit 0
        // (the new right edge). Bits that fall off the high end were
        // counters too old to track — they're gone, which is correct
        // (the window only remembers the last W).
        const shift = counter - right
        let newBitmap: bigint
        if (shift >= W) {
          // The jump is bigger than the window — old bitmap entirely
          // out of range. Reset with just the new right edge.
          newBitmap = 1n
        } else {
          newBitmap = ((bitmap << BigInt(shift)) | 1n) & WMask
        }
        sessions.set(sessionId, { right: counter, bitmap: newBitmap })
        return true
      }
      // counter <= right: check the bitmap.
      const offset = right - counter
      if (offset >= W) return false // stale — outside the window
      const bit = 1n << BigInt(offset)
      if ((bitmap & bit) !== 0n) return false // replay
      sessions.set(sessionId, { right, bitmap: bitmap | bit })
      return true
    },
    async forget(sessionId) {
      sessions.delete(sessionId)
    },
    async size() {
      return sessions.size
    },
  }
}

/**
 * Capability slot for the nonce store. Default fallback (when no cap
 * installed) is `inMemoryNonceStore()` — sane for dev + single-process.
 * Multi-node production installs a Redis / DO / Postgres adapter via
 * `app({ caps: [[NonceStoreCap, redisStore]] })`.
 */
export const NonceStoreCap = defineCapability<NonceStore>('NonceStore')

/**
 * Read the active nonce store. Module-level fallback singleton so the
 * default doesn't allocate a new in-memory store per call — a fresh
 * Map per call would reject every "second" request from the same
 * session as a replay.
 */
let _defaultNonceStore: NonceStore | null = null
export function useNonceStore(): NonceStore {
  if (_defaultNonceStore === null) _defaultNonceStore = inMemoryNonceStore()
  return NonceStoreCap.use(_defaultNonceStore)
}

// ===== signedToken — opaque HMAC-signed payloads =====

export interface SignedToken<T> {
  /**
   * Encode `payload` into a signed token string. Optional `expiresInMs`
   * embeds an expiry timestamp; verify() will return `null` after it.
   */
  sign(payload: T, options?: { expiresInMs?: number }): Promise<string>
  /** Decode + verify. Returns the payload, or `null` for any failure. */
  verify(token: string): Promise<T | null>
}

export function signedToken<T = unknown>(secret: string): SignedToken<T> {
  if (secret.length < 16) {
    // 16 chars (~128 bits) is the bare minimum for an HMAC key. Real
    // deployments should use 32+ random bytes (256 bits). Throw loudly
    // rather than ship a quietly-weakened token.
    throw new Error(
      '@place/security: signedToken secret must be at least 16 characters. ' +
        'Use a cryptographically random value (e.g. crypto.randomUUID() + crypto.randomUUID()).',
    )
  }

  return {
    async sign(payload, options) {
      const wrapped = {
        v: payload,
        iat: Date.now(),
        exp: options?.expiresInMs !== undefined ? Date.now() + options.expiresInMs : null,
      }
      const b64 = base64urlEncode(enc.encode(JSON.stringify(wrapped)))
      const sig = await hmacSign(secret, b64)
      return `${b64}.${sig}`
    },
    async verify(token) {
      const dot = token.lastIndexOf('.')
      if (dot < 0) return null
      const b64 = token.slice(0, dot)
      const sig = token.slice(dot + 1)
      const expected = await hmacSign(secret, b64)
      if (!constantTimeEqual(sig, expected)) return null
      try {
        const wrapped = JSON.parse(dec.decode(base64urlDecode(b64))) as {
          v: T
          iat: number
          exp: number | null
        }
        if (wrapped.exp !== null && Date.now() > wrapped.exp) return null
        return wrapped.v
      } catch {
        return null
      }
    },
  }
}

// ===== CSRF token — double-submit, session-bound =====

export interface CsrfTokens {
  /** Generate a CSRF token for the given session id. */
  generate(sessionId: string): Promise<string>
  /**
   * Verify the token came from this session. Returns false for any
   * mismatch — wrong session, expired, malformed, or signature
   * mismatch.
   */
  verify(token: string, sessionId: string): Promise<boolean>
}

export function csrfToken(secret: string, options?: { expiresInMs?: number }): CsrfTokens {
  const signer = signedToken<string>(secret)
  const ttl = options?.expiresInMs ?? 24 * 60 * 60 * 1000 // 24h default
  return {
    generate(sessionId) {
      return signer.sign(sessionId, { expiresInMs: ttl })
    },
    async verify(token, sessionId) {
      const decoded = await signer.verify(token)
      return decoded !== null && constantTimeEqual(decoded, sessionId)
    },
  }
}

// ===== rateLimit — in-memory token bucket =====
//
// Keep this primitive tight: one function, one bucket per key, no
// hierarchy. For production you'd back this with Redis or similar; the
// in-memory version is right for dev / single-process / per-process
// limits. Composes with persistence by writing the buckets out — but
// that's adapter-level work, not a config option here.

export interface RateLimiter {
  /**
   * `true` if a unit of work for `key` is allowed; `false` if the
   * bucket is exhausted for the current window.
   */
  check(key: string): boolean
}

export function rateLimit(options: { windowMs: number; max: number }): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  return {
    check(key) {
      const now = Date.now()
      const bucket = buckets.get(key)
      if (bucket === undefined || now >= bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + options.windowMs })
        return true
      }
      if (bucket.count >= options.max) return false
      bucket.count++
      return true
    },
  }
}

// ===== Session capability =====

export interface Session {
  /** Stable session id — used for CSRF binding, audit logs, etc. */
  readonly id: string
  /** Application-level user identifier. */
  readonly userId: string
  /** Issued-at, milliseconds since epoch. */
  readonly issuedAt: number
  /** Expiry timestamp, or null for non-expiring sessions. */
  readonly expiresAt: number | null
  /**
   * Optional permission predicate (T16-E, ADR 0044). Apps that wire
   * an authorization layer (Cerbos, Permify, hand-rolled RBAC, etc.)
   * populate this when installing the session — the auth middleware
   * computes whether the current user `can` perform each action and
   * stores the resolver here. Apps without an explicit policy leave
   * `can` undefined; the `<Can>` component reads it as "deny by
   * default."
   *
   * The predicate is synchronous so `<Can>` works pre-hydration in
   * SSR — no async permission checks at render time. Async lookups
   * happen at session-install time; the resolved values are baked in.
   */
  readonly can?: (action: string) => boolean
}

/**
 * Capability holding the current session. Auth middleware installs this
 * only when the request is authenticated; an unauthenticated request
 * leaves it uninstalled. Handlers read it via `SessionCap.tryUse()` for
 * optional access, or `requireSession()` to fail closed with a 401.
 */
export const SessionCap = defineCapability<Session>('Session')

/**
 * Read the current session, throwing `SecurityError(401)` if no session
 * is installed. Use this at the top of any handler that requires
 * authentication.
 */
export function requireSession(): Session {
  const s = SessionCap.tryUse()
  if (s === null) throw new SecurityError(401, 'Authentication required')
  return s
}

// ===== Errors =====

export class SecurityError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SecurityError'
  }
}

// ===== Cookies — secure by default =====

/** Parse a `Cookie:` header into a flat object. Returns `{}` for null/empty. */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const name = part.slice(0, eq).trim()
    if (!name) continue
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      // Malformed encoding — skip rather than throw on user input.
    }
  }
  return out
}

/**
 * Build a `Set-Cookie` value with security-first defaults.
 *
 * Always set: `Path=/`, `HttpOnly`, `SameSite=Lax`, and `Secure` (over
 * HTTPS). The two options below are the only adjustments — anything
 * more elaborate, build the string yourself.
 *
 * - `maxAgeSeconds` — cookie lifetime. Omit for session cookies.
 * - `insecure` — strip the `Secure` flag for localhost dev only.
 *   **Never set this in production.** The platform makes you type
 *   `insecure: true` so the choice is visible in the diff.
 */
export function setCookieHeader(
  name: string,
  value: string,
  options?: { maxAgeSeconds?: number; insecure?: boolean },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (options?.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`)
  if (options?.insecure !== true) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Set a `Max-Age=0` cookie to clear a previously-set one. Same default
 * security flags so the browser accepts the deletion request.
 */
export function clearCookieHeader(name: string, options?: { insecure?: boolean }): string {
  return setCookieHeader(name, '', { ...options, maxAgeSeconds: 0 })
}

// ===== Content Security Policy starter =====
//
// A reasonable default for an SPA served from `'self'` with no inline
// scripts and no eval. Consumers compose into a CSP header string; we
// don't ship a header-builder because a real app's policy depends on
// what it actually loads (analytics, fonts, images from CDNs, etc.).

export const CSP_DEFAULTS = Object.freeze({
  'default-src': "'self'",
  'script-src': "'self'",
  'style-src': "'self' 'unsafe-inline'",
  'img-src': "'self' data:",
  'font-src': "'self'",
  'connect-src': "'self'",
  'frame-ancestors': "'none'",
  'base-uri': "'self'",
  'form-action': "'self'",
  'object-src': "'none'",
})

/**
 * Render a CSP header value from a directive map. Drop-in:
 *   `'Content-Security-Policy': cspHeader(CSP_DEFAULTS)`
 *
 * To extend, spread + override:
 *   `cspHeader({ ...CSP_DEFAULTS, 'connect-src': "'self' https://api.example.com" })`
 */
export function cspHeader(directives: Readonly<Record<string, string>>): string {
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v}`)
    .join('; ')
}

// ===== RBAC gate =====
//
// `<Can do="…">` — render-time predicate against `SessionCap.tryUse()?.can()`.
// See `can.ts` for the JSDoc + design rationale. Lives in security
// (not design) because the predicate's input is `SessionCap`, not
// visual variants.

export { Can, type CanProps } from './can.ts'

// ===== HMAC envelope (Phase 2) =====
//
// Per-action integrity wrapper for `criticalAction()`. Binds
// (action_id, body_hash, counter, iat, origin, session_id, key_id)
// under a single HMAC tag. The verifier returns a typed rejection
// the framework maps to 403 — see envelope.ts for the canonical
// form + verification logic.

export {
  canonicalise,
  type EnvelopeFields,
  type EnvelopeVerifyResult,
  sha256Base64url,
  signEnvelope,
  type VerifyOptions,
  verifyEnvelope,
} from './envelope.ts'

// ===== Audit log (Phase 4) =====
//
// Tamper-evident, append-only chain of accepted critical-action
// invocations + handler-emitted events. Each entry binds the
// previous one via `prev_hash`, so any modification anywhere
// earlier breaks the chain and is detected on next `verify()`.

export {
  type AuditAppendInput,
  type AuditEntry,
  type AuditLog,
  AuditLogCap,
  canonicaliseAuditEntry,
  GENESIS_HASH,
  inMemoryAuditLog,
  useAuditLog,
  type VerifyResult,
} from './audit-log.ts'

// ===== Macaroons (Phase 3) =====
//
// HMAC-chained bearer tokens with attenuating caveats. Composes
// with `criticalAction()`'s `requires: [perm('op')]` declaration:
// the framework verifies the macaroon on the request, walks its
// caveats against the request context, and rejects with 403 if
// the effective authority doesn't cover the required op.

export {
  attenuate,
  deserializeMacaroon,
  type Macaroon,
  type MacaroonVerifyContext,
  type MacaroonVerifyResult,
  mintMacaroon,
  serializeMacaroon,
  verifyMacaroon,
} from './macaroon.ts'
