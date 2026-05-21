# Security System

Web-security **primitives** for `place`. Not an auth library — no login
flows, no OAuth, no JWT, no password hashing. This system ships the
substrate every auth library needs, and the substrate the framework's
secure-by-default behavior is built on.

**Status:** v0.1 shipping. Public surface stable. See
[docs/00-charter.md](docs/00-charter.md) for the full rationale.

## Thesis

Web security is a substrate problem, not a feature. Frameworks that
treat CSRF / CSP / session signing as opt-in middleware leave
secure-by-default to luck. Place's stance: **the easy path is the safe
path.** `security: 'standard'` (the default for any `app({})`) ships
strict CSP, auto-CSRF on every `action()`, same-origin enforcement,
body-size limits, and prototype-pollution guards on every page.
`@place-ts/security` provides the primitives those defaults stand on.

## Public surface

```ts
import {
  signedToken, csrfToken, rateLimit,
  SessionCap, requireSession, Can,
  setCookieHeader, clearCookieHeader, parseCookies,
  cspHeader, CSP_DEFAULTS, SecurityError,
} from '@place-ts/security'
```

- **`signedToken<T>(secret)`** — HMAC-SHA256-signed opaque payloads
  (`sign` / `verify`, optional expiry). The building block for signed
  cookies, share links, one-time URLs.
- **`csrfToken(secret)`** — double-submit CSRF (`issue` / `verify`).
- **`rateLimit(opts)`** — token-bucket limiter.
- **`SessionCap`** — capability-typed session slot;
  **`requireSession`** guards an action; **`<Can do="…">`** is an
  SSR-friendly RBAC gate reading `SessionCap`'s `can()` predicate
  (see [ADR 0044](../../docs/decisions/0044-can-rbac-gate.md)).
- **Cookie helpers** — `setCookieHeader` / `clearCookieHeader` /
  `parseCookies`, secure-by-default (`HttpOnly`, `SameSite`, `Secure`).
- **`cspHeader` / `CSP_DEFAULTS`** — Content-Security-Policy
  construction with per-request nonces.

## What this system does NOT own

Login flows, OAuth dances, JWT libraries, password hashing, the SQL
layer. Those belong to the app or to a dedicated auth package — see
the charter's non-goals. `@place-ts/security` is the layer beneath them.
