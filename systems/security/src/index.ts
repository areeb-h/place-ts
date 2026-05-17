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

import { defineCapability } from '../../capability/src/index.ts'

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

// Compare two equal-length strings in constant time. For unequal-length
// inputs we still walk the longer one to avoid leaking length via
// timing — a real attack is unlikely on token comparisons but the
// pattern is cheap and standard.
function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let result = a.length ^ b.length
  for (let i = 0; i < len; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return result === 0
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
