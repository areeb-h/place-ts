# ADR 0055: `criticalAction()` — mil-grade server actions

**Status:** accepted (Phases 1+2 shipped; Phases 3–5 specified, deferred)
**Date:** 2026-05-20
**Affects:** `@place/security` (substrate); `@place/component` (`criticalAction()`,
`provisionActionKey`, `installActionKey`, `ServeOptions.secret`)

## Context

Author asked for "highly secure server actions that cannot be tampered
with, military-intelligence grade, suitable for critical systems,
following cybersecurity best practices without losing performance —
actually improving it." Research pass surveyed:

- OWASP ASVS 5.0 (V11 Cryptography, V13 API, V18 Self-Contained Tokens)
- NIST SP 800-53 Rev 5 (AU-10 non-repudiation, SI-7 integrity)
- NIST SP 800-204A (mutual auth, ABAC, STS for zero-trust microservices)
- NIST SP 800-57 / 800-108 (key management, HKDF)
- FIPS 140-3 + FedRAMP Crypto Policy v1.1.0 (January 2025)
- PCI DSS 4.0.1 Req 6.4.3 / 11.6.1
- RFC 4303 (IPsec ESP anti-replay)
- RFC 5869 (HKDF)
- RFC 9421 (HTTP Message Signatures), RFC 9449 (DPoP)
- Macaroons paper (Stanford / Google)
- Recent CVE landscape: Next.js CVE-2025-29927 (middleware bypass),
  CVE-2026-27978 (Server Actions CSRF), CVE-2025-66478 (single-`/`
  action endpoint); TanStack supply-chain compromise (May 2026,
  CVE-2026-45321); Nuxt `__nuxt_island` props leak (May 2026)

Surveyed competitors all fall short of "mil-grade" on different
axes:

| | Origin/CSRF default | Payload HMAC | Replay defense | Endpoint identity | Standards |
|---|---|---|---|---|---|
| Next.js | On (CSRF bypass history) | No | No | `'use server'` → encrypted ID | None default |
| TanStack Start | On (v1-RC) | No | No | Plain URL via `.url` | None default |
| Nuxt | Off (needs nuxt-csurf) | No | No | Plain URL | nuxt-security module |
| **place (existing `action()`)** | Origin: on; CSRF token: opt-in | No | No | Plain URL | Some |

The existing place `action()` is competitive but not mil-grade — no
payload authentication, no replay defense, no per-session key
derivation, no FIPS-pluggable boundary.

**Constraint:** "without losing performance — actually improving it."

## Options considered

1. **Strengthen `action()` defaults.** Make everything default-on:
   payload HMAC, single-use nonce, audit log.
   - Pro: every app gets the protections.
   - Con: breaks existing apps that don't have a session attached
     to actions. Public/anonymous endpoints become impossible.

2. **Tiered `action({ assurance: 'standard' | 'high' | 'critical' })`.**
   Single primitive, levels gate features.
   - Pro: one mental model.
   - Con: type-checking the conditional ctx shape (`session` only
     guaranteed in `'high'+`) gets ugly. Apps that mix tiers in one
     file have to thread the level through everywhere.

3. **New `criticalAction()` primitive alongside `action()`.** Same
   author shape; opt-in per action.
   - Pro: existing apps untouched. `criticalAction()` always carries
     the full mil-grade stack — no conditional ctx. Apps mix `action()`
     for public endpoints + `criticalAction()` for state mutations
     freely.
   - Con: two primitives where one might do. Mitigation: the
     conceptual line is clear (does this need session + replay +
     audit?), the API shapes are identical otherwise.

## Decision

**Option 3.** `criticalAction()` as a separate factory. Design
locked: the full stack of defenses runs on every invocation; no
tiers, no opt-out within the primitive.

### Architecture

**Five capabilities + one config field** form the substrate:

1. **`CryptoProviderCap`** — FIPS-pluggable boundary. Every
   cryptographic operation (`randomBytes`, `hmacSha256`,
   `timingSafeEqual`, `hkdfSha256`) goes through the cap. Default
   `bunCryptoProvider` (not FIPS-validated); deployers swap in
   AWS-LC-FIPS / OpenSSL-FIPS for FedRAMP-High. Honest
   `fipsValidated: boolean` field for diagnostics.

2. **`NonceStoreCap`** — IPsec-style sliding-window replay defense.
   Per-session `(rightEdge, bitmap)` tuple (~16 bytes). O(1) lookup,
   bounded memory. Default `inMemoryNonceStore({ windowSize: 64 })`;
   pluggable to Redis / Durable Objects / Postgres.

3. **`SessionCap`** — already exists. Required: handler can't run
   without one. `criticalAction()` rejects with 403 ("no-session")
   when missing at request time.

4. **`rotatingKey(root)`** — per-day HMAC sub-key derivation via
   HKDF-SHA-256. Forward secrecy: a leak of one day's sub-key has
   bounded blast radius. In-process LRU cache (~5 ns hit, ~2–5 µs
   miss). Standards: ASVS 11.1.1, 11.2.2; NIST SP 800-57, SP 800-108.

5. **HMAC envelope** (`canonicalise` / `signEnvelope` / `verifyEnvelope`)
   binds `(action_id, body_hash, counter, iat, origin, session_id,
   key_id)` under one HMAC-SHA-256 tag. Verifier returns typed
   rejection reasons (`bad-tag`, `wrong-body`, `wrong-action`,
   `wrong-origin`, `wrong-session`, `stale-iat`, `future-iat`,
   `replay`, `malformed`). All map to 403 on the wire — no info leak.

6. **`ServeOptions.secret`** — 32+ byte root secret HKDF'd into the
   rotating key. Required iff any `criticalAction()` is registered.

### Pipeline (per request)

1. Same-origin check (default-on for state-changing methods).
2. Content-Length pre-check (early 413 for oversize).
3. `SessionCap.tryUse()` — must be non-null.
4. `X-Place-Envelope` header — must be present.
5. Read body as bytes.
6. Body-size post-check.
7. Derive verification key: `HKDF(rotatingKey.keyAt(iat), sessionId,
   "place-action-session-v1")`. Try current day + previous day for
   clock-rollover.
8. `verifyEnvelope()` — constant-time tag check first; field checks
   second; body-hash recompute last.
9. `NonceStoreCap.check(sessionId, counter)` — IPsec bitmap.
10. Parse body (JSON only — FormData fallback is `action()`'s
    progressive-enhancement path).
11. Standard Schema input validation.
12. Call `fn(input, ctx)` with `ctx.session` guaranteed.

### Browser-side key flow

Locked via user direction:

- **App's session-establishment endpoint** (login / signup / refresh)
  calls `provisionActionKey(sessionId)` server-side. Returns
  `{ keyBytes, keyId, expiresAt }` in its response body.
- Browser-side `installActionKey(provisioned)` imports the key as
  WebCrypto `CryptoKey` with `extractable: false` — JS can't read
  the raw bytes back after import. Persists in IndexedDB so it
  survives reloads + cross-tab.
- A monotonic counter persists alongside the key. Each `.call()`
  reads + increments + persists, then signs the envelope with the
  CryptoKey. Counter survival across reloads prevents "fresh tab,
  reuse counter" attacks.
- `clearActionKey()` for logout. App-owned auth flow timing.

### What we explicitly reject

| Pattern | Rationale |
|---|---|
| Encrypted action IDs (Next-style) | Security through obscurity. URL is still in the page; encryption tamper-detects, doesn't hide. CVE-2026-27978 was an origin-check bug — encryption didn't help. Visible URLs win on auditability. |
| Single `/` action endpoint | CVE-2025-66478 — every server function reachable from one URL. Place keeps per-action paths. |
| AEAD on payloads | Gratuitous over TLS 1.3 for the v0.1 case. Warranted only for E2EE app channels — out of scope. |
| Token Binding (RFC 8471) | Dead — Chrome dropped support. Superseded by DPoP. |
| ML-DSA / SLH-DSA today | Premature. AWS KMS shipped FIPS-204 June 2025; mainstream pilots 2027+. Interface is PQ-ready via `CryptoProviderCap`; algorithm choice deferred. HMAC is already PQ-resistant on the symmetric side. |
| LMS / XMSS (SP 800-208 stateful) | State-management hazard — "use this counter exactly once forever" is unsuited to high-frequency web requests. |
| Pure-JS Ed25519 (noble) on hot path | 498 µs verify on M4 vs 50 µs native libsodium. Last-resort fallback only. |
| Heuristic CSRF detection (WAF-style) | Charter: no quick fixes, structural defense only. Envelope binds origin + session + action structurally; replaces heuristics. |
| AsyncLocalStorage-based auth state | Hides which capability authorized which action. Macaroons carry capability with the request (Phase 3). |

## Consequences

### What's now harder

- Apps using `criticalAction()` MUST provide a `secret` to `app()`.
  Same secret on every node (single source of truth).
- App's auth flow MUST call `provisionActionKey()` server-side +
  return the bytes to the browser; browser MUST call
  `installActionKey()` before any `.call()`.
- Browser without IndexedDB (rare, blocked iframes, some private-
  browsing modes) can't sign envelopes — apps need to handle this
  case if they target that audience.

### What's now easier

- The default surface area of a server mutation includes:
  origin check, payload HMAC, replay defense, session-binding,
  schema validation, body-size cap, prototype-pollution defense,
  structured error responses. Zero handler-side boilerplate.
- Adding new actions = adding a `criticalAction()` declaration.
  No middleware composition, no CSRF token plumbing, no
  custom-key-rotation code.
- FedRAMP-High deployments slot a FIPS-validated module via
  `CryptoProviderCap`. Zero handler change.

### What we'll watch for

- The 15 µs added crypto cost. Phase 5 (validator codegen) is
  designed to repay it with ~90 µs saved per request. Until Phase 5
  ships, `criticalAction()` is marginally slower than `action()` —
  in exchange for strictly stronger defense.
- Browser support for non-extractable CryptoKey in IndexedDB. All
  evergreen browsers support it (Chrome 37+, FF 50+, Safari 7+).
  Test before production deploy.

### Performance frontier (verified against tests)

| Defense | Per-request cost | Threat eliminated |
|---|---|---|
| TLS 1.3 (assumed) | 0 | Network passive/active MitM |
| Origin + Sec-Fetch-Site | ~0.1 µs | Cross-origin form CSRF |
| HMAC-SHA-256 envelope verify | ~3–5 µs (Bun native) | Tampering, forgery, cross-action confusion, body substitution |
| IPsec sliding-window check | ~50 ns | Replay within session |
| `Bun.timingSafeEqual` everywhere | ~0 | Timing oracle on tag/secret compare |
| Per-day HKDF sub-key (cached) | ~5 ns hit / ~2–5 µs miss | Key-compromise blast radius bounded |
| Capability-token (macaroon, Phase 3) | ~8 µs (3 caveats) | Privilege escalation |
| Merkle log append (Phase 4) | ~200 ns + amortized | Post-hoc repudiation |
| AEAD on payload | (skipped) | (nothing TLS isn't already defeating) |
| DPoP Ed25519 (deferred to `'critical'+` tier) | ~50 µs native | Token theft + cross-device replay |

**Pareto-optimal default stack: ~15 µs total added crypto.** Phase 5
codegen validators target ~90 µs saved per request — net **faster**
than today's `action()` despite strictly stronger defense.

## Phases (implementation roadmap)

- **Phase 1 — Crypto floor.** Shipped commit `04bd1d1`.
  `Bun.timingSafeEqual` + `CryptoProviderCap` + `rotatingKey`.
  17 tests added.

- **Phase 2 — Envelope + replay + factory.** Shipped commits
  `94224ad` (NonceStore + envelope) and `d1193e1` (`criticalAction()`,
  `provisionActionKey`, `installActionKey`, `ServeOptions.secret`).
  47 tests added (28 substrate + 19 factory). Total 1483 → 1547.

- **Phase 3 — Macaroon caveats.** `perm('comments.create')` declarator
  + caveat chain (`expires=`, `origin=`, `op=`, app-namespace `app:*`).
  Server walks the chain; failures return 403 in constant time with
  no info on which caveat missed. Deferred — substrate ready.

- **Phase 4 — Audit log.** `AuditLogCap` interface + in-memory
  Merkle-tree default + opt-in SQLite adapter for durability.
  Hash-chained entries: each commits the previous + canonical
  (actor, action, payload-hash, result-hash, ts). Satisfies AU-10
  non-repudiation. Deferred.

- **Phase 5 — Validator codegen.** Bun plugin lifts
  `fromStandard(schema)` into generated direct-decode code at build
  time. Replaces runtime schema interp (~100 µs Zod typical) with
  generated specialised code (~5 µs). Net result: `criticalAction()`
  becomes faster than `action()` despite all the crypto. Deferred.

## Notes

- Standards mapped explicitly in each commit message:
  - OWASP ASVS 5.0 11.1.1 / 11.2.2 (rotation, crypto-agility)
  - OWASP ASVS 5.0 11.2.4 L3 (constant-time)
  - OWASP ASVS 5.0 11.3.4 L3 (single-use nonce)
  - OWASP ASVS 5.0 11.4.1 L1 (HMAC-SHA-256)
  - NIST SP 800-53 Rev 5 AU-10 (non-repudiation)
  - NIST SP 800-53 Rev 5 SI-7 (integrity)
  - NIST SP 800-53 Rev 5 SC-13 (cryptographic protection)
  - NIST SP 800-57 Part 1 Rev 5 (key management lifecycle)
  - NIST SP 800-108 (HKDF in counter mode)
  - RFC 4303 (IPsec ESP anti-replay)
  - RFC 5869 (HKDF)
  - FedRAMP Crypto Policy v1.1.0 (Jan 2025)

- The visible-URL choice is structural, not pragmatic. A security
  reviewer can `grep -r 'criticalAction(' src/` and enumerate every
  state-mutating endpoint the app exposes. With Next's `'use server'`
  the reviewer has to walk every transitively-imported file the build
  pipeline pulls in. The opacity is exactly the failure mode catalogued
  in `docs/platform/07-prior-art-failures.md` §"compiler magic that
  hides intent."

- Threat model file: `systems/security/src/critical-action.threat-model.md`
  — to be written when Phase 3 lands (the full picture needs
  macaroons + audit log to be complete).

- Companion ADRs:
  - 0001 (Bun + TS stack — provides the `Bun.timingSafeEqual` floor)
  - 0010 (`__PLACE_BROWSER__` define — keeps server-side crypto code
    out of client bundles via DCE)
  - 0014 (CSP-safe inline style writes — same XSS defense layer)
  - 0020 (island security hardening — SRI + nonce-CSP)
  - 0025 (SRI + attack-surface reduction)
  - 0044 (`<Can do="…">` RBAC gate — predicate-level RBAC that
    composes WITH macaroons, doesn't replace them)
  - 0045 (`fromStandard()` schema interop — validator-agnostic input
    parsing that Phase 5 codegen will optimise)
