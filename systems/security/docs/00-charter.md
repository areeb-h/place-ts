# 00 — Security System Charter

**Status:** shipped. Public surface stable in v0.1.

## Thesis

Web security is a substrate problem, not a feature. Frameworks that
treat CSRF / CSP / session signing as opt-in middleware leave
secure-by-default to luck. Place's stance: the **easy path is the
safe path**. The framework ships strict-CSP defaults, auto-CSRF on
every `action()`, same-origin enforcement, body-size limits, and
prototype-pollution guards on every page in `security: 'standard'`
mode — which is the default for any `app({})` call (per ADR 0040).

`@place-ts/security` provides the **primitives** these defaults are
built on. It is **not** an auth library — we don't ship login flows,
OAuth dances, JWT libraries, or password hashing. We ship the
substrate every auth library needs: HMAC-signed opaque tokens,
double-submit CSRF tokens, rate-limit token buckets, a capability-
typed session slot, and secure-by-default cookie helpers.

This is the framework's structural answer to the "security
non-negotiable" charter clause (platform NN #4) and the user
feedback `feedback_perf_bar.md` ("be the fastest, most stable, most
secure; security non-negotiables can't be relaxed for ergonomics").

## What this system owns

### `signedToken<T>(secret)` — HMAC-signed opaque payload

Returns `{ sign(value): Promise<string>, verify(token): Promise<T | null> }`.
Uses Web Crypto's `HMAC-SHA256`. Optional `expiresInSeconds` per token.
The building block for any "trust this opaque string came from us
unmodified" use case: cookies, CSRF tokens, signed share links,
short-lived one-time URLs.

### `csrfToken(secret)` — double-submit CSRF

Returns `{ issue(sessionId): Promise<string>, verify(sessionId, token):
Promise<boolean> }`. The classic double-submit pattern: server issues
a token tied to a session id, client echoes it via header or hidden
field, server verifies on every mutating request. Auto-wired into
`action()` and `<Form>` (the framework injects + verifies
transparently when `security: 'standard'` is on).

### `rateLimit(options)` — in-memory token bucket

Returns `(key: string) => boolean` — `true` if the request is allowed,
`false` if rate-limited. Options: `windowMs`, `max`. In-memory (no
Redis dependency); for multi-instance deployments wrap with a shared
backend via the same interface.

### `SessionCap` + `requireSession()` — capability-typed sessions

`SessionCap = defineCapability<Session>('Session')` is the session
slot. Apps populate it inside the request handler via
`SessionCap.provide(session, async () => ...)` after their cookie
lookup. Handlers that need an authenticated user call
`requireSession()` which throws a typed `SecurityError` when the
slot is empty — caught by the framework and converted to a 401.

This is the platform's **structural answer to "is the user logged
in?"** — same shape as every other capability; type-checked at every
call site; SSR-safe (the cap is request-scoped via ALS).

### `parseCookies(headerValue)` and `setCookieHeader(name, value, opts)`

Cookie helpers. **Secure by default**: `setCookieHeader` writes
`HttpOnly; Secure; SameSite=Lax` unless the caller explicitly passes
`insecure: true` (only useful for localhost dev). No `Path=/`
implicit default (you opt in). No SameSite=None unless you also
explicitly set `Secure: true`.

### `CSP_DEFAULTS` + `cspHeader(overrides?)` — content-security policy

`CSP_DEFAULTS` is the strict starter policy: `script-src 'self' 'nonce-...'`,
`style-src 'self'` (with auto-hash injection for inline styles, ADR 0014),
`object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, etc.
The `serve({ security: 'standard' })` path applies this header with
a per-response nonce per ADR 0025. **No `'unsafe-inline'` anywhere.**

### `clearCookieHeader(name)` and `SecurityError`

Cookie deletion helper + the typed error class thrown by
`requireSession()` and friends. `SecurityError` carries a typed
`.kind` field (`'no-session'` | `'csrf-mismatch'` | `'rate-limit'`)
so the framework can map each to the right HTTP status.

### `<Can do="…">` — RBAC gate (T16-E, ADR 0044)

Renders its children only when the current session's `.can(action)`
predicate returns strictly `true`. Fails closed (no session, no
`.can`, or denied → renders the optional `otherwise` content, or
nothing). The predicate runs synchronously at render time inside a
reactive function child, so the gate works pre-hydration in SSR —
unauthorized content never appears in the rendered HTML, never
ships JS for the hidden island, and is invisible to view-source.

`Session.can` is an optional `(action: string) => boolean` field
populated at session-install time by the auth middleware. Apps that
wire a policy engine (Cerbos, Permify, hand-rolled RBAC) store the
resolved predicate here; apps without explicit RBAC leave it
undefined and `<Can>` denies everything by default.

```tsx
<Can do="post.delete">
  <Button intent="destructive" on:click={remove}>Delete</Button>
</Can>

<Can do="admin.users.read" otherwise="Access denied">
  <UserTable />
</Can>
```

## What this system does NOT own

- **Login / signup flows.** App policy. We provide HMAC, CSRF, cookies,
  the session slot — assemble what you need.
- **OAuth / OIDC.** Specific protocol implementations belong in
  apps or external libraries (`@auth/core`, lucia-auth, etc.).
- **Password hashing.** Use `Bun.password.hash()` or argon2 directly.
- **SQL injection prevention.** `bun:sqlite`'s `prepare()` and any
  parameterized driver already cover this; the framework has nothing
  to add at the SQL boundary.
- **The HTTP transport layer.** That's `@place-ts/component`'s `serve()`.
  Security headers + CSP nonces are emitted there; the constants
  + factories live here.

## Architectural commitments

1. **Secure by default.** Insecure choices require explicit opt-in
   syntax (`{ insecure: true }`, `'unsafe-inline'` literal, etc.) so
   the audit trail in source is obvious.
2. **No middleware framework.** Each primitive is one pure function
   or one capability factory. No `app.use(security({}))`-style
   pipelines.
3. **Capability-typed sessions.** `SessionCap` is the same shape as
   any other capability. Same SSR-safe install/provide/use semantics.
4. **Constant-time comparisons.** All token verification uses
   `crypto.subtle.timingSafeEqual` or equivalent.
5. **No magic on the wire.** Tokens are signed strings with a visible
   format (`<base64payload>.<base64sig>`). No opaque binary blobs.

## Cross-system contracts

- `@place-ts/component`'s `security-headers.ts` consumes `CSP_DEFAULTS`
  and `cspHeader()` to construct per-response headers (with the
  per-request nonce).
- `@place-ts/component`'s `action()` + `<Form>` auto-inject + verify
  CSRF tokens when `security: 'standard'` is on; the token shape is
  this system's `csrfToken()`.
- `app({ security })` resolves the preset name (`'standard'`,
  `'strict'`, `'none'`, or a `SecurityOptions` object) into the
  combination of CSP/CSRF/body-limit/proto-pollution-guard settings.

## Depends on

- `@place-ts/capability` — `SessionCap` is a `Capability<Session>`.
- Web Crypto API (`crypto.subtle.*`) — Bun + Node 19+ + every modern
  browser.

## Public surface (v0.1)

```
signedToken(secret)              → { sign, verify }
csrfToken(secret)                → { issue, verify }
rateLimit(options)               → (key) => boolean

SessionCap                       Capability<Session>
requireSession()                 Session  (throws SecurityError if absent)

parseCookies(headerValue)        Record<string, string>
setCookieHeader(name, val, opts) string
clearCookieHeader(name)          string

CSP_DEFAULTS                     Record<string, string[]>
cspHeader(overrides?)            string

SecurityError                    class extends Error
type Session                     { id: string; ... }    (consumer-extensible)
type CsrfTokens                  { issue, verify }
type RateLimiter                 { check, reset }
```

## Open questions

- Whether `rateLimit` gains a Redis adapter for multi-replica
  deployments (vs leaving to apps).
- Whether `signedToken` adds an encrypted variant (`encryptedToken`)
  for sealed-not-just-signed payloads.
- Whether session refresh (rolling cookies) belongs here or in an
  example app.

## Phase

**v0.1** (shipped, stable surface). Future work tracks the open
questions above; will be added as new primitives, never as breaking
changes to the existing five.
