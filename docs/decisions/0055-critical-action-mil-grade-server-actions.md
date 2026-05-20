# ADR 0055: `criticalAction()` — high-assurance server actions

**Status:** accepted (Phases 1+2 shipped; Phases 3–5 specified, deferred)
**Date:** 2026-05-20
**Affects:** `@place/security` (substrate); `@place/component` (`criticalAction()`,
`provisionActionKey`, `installActionKey`, `ServeOptions.secret`)

## Context

The author asked for a server-action primitive that resists tampering,
replay, and forgery — suitable for critical systems — without losing
performance. Research pass surveyed:

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

Surveyed competitors all fall short on different axes:

| | Origin/CSRF default | Payload HMAC | Replay defense | Endpoint identity |
|---|---|---|---|---|
| Next.js | On (CSRF bypass history) | No | No | `'use server'` → encrypted ID |
| TanStack Start | On (v1-RC) | No | No | Plain URL via `.url` |
| Nuxt | Off (needs nuxt-csurf) | No | No | Plain URL |
| **place (existing `action()`)** | Origin: on; CSRF token: opt-in | No | No | Plain URL |

The existing place `action()` is competitive but lacks payload
authentication, replay defense, per-session key derivation, and a
FIPS-pluggable boundary.

**Constraint:** "without losing performance — actually improving it."

## Decision

Ship `criticalAction()` as a new factory alongside `action()`. The
full stack of defenses runs on every invocation; no tiers, no
opt-out within the primitive. The substrate (Phase 1+2, shipped) is:

1. **`CryptoProviderCap`** — every cryptographic operation goes
   through one interface (`randomBytes`, `hmacSha256`, `timingSafeEqual`,
   `hkdfSha256`). Default `bunCryptoProvider` (not FIPS-validated;
   honest `fipsValidated: false`); deployers slot in AWS-LC-FIPS /
   OpenSSL-FIPS for FedRAMP-High. Charter alignment: OWASP ASVS 5.0
   11.2.2 (crypto-agility).

2. **`NonceStoreCap`** — IPsec-style sliding-window replay defense.
   Per-session `(rightEdge, bitmap)` tuple (~16 bytes). O(1) lookup,
   bounded memory. Default `inMemoryNonceStore({ windowSize: 64 })`;
   pluggable. RFC 4303 algorithm verbatim.

3. **`SessionCap`** — handler can't run without one. Logged-out
   requests get 403 (not 500). Capability-based, not ambient.

4. **`rotatingKey(root)`** — per-day HMAC sub-key derivation via
   HKDF-SHA-256. In-process LRU cache (~5 ns hit, ~2–5 µs miss).
   NIST SP 800-108. Bounded sub-key exposure (see Consequences).

5. **HMAC envelope** binds `(action_id, body_hash, counter, iat,
   origin, session_id, key_id)` under one HMAC-SHA-256 tag.
   Verifier returns typed rejection reasons (`bad-tag`,
   `wrong-body`, `wrong-action`, `wrong-origin`, `wrong-session`,
   `stale-iat`, `future-iat`, `replay`, `malformed`). All map to
   403 on the wire — no info-leak oracle.

6. **`ServeOptions.secret`** — 32+ byte root secret HKDF'd into
   the rotating key. Required iff any `criticalAction()` is
   registered.

### Pipeline (per request)

1. Same-origin check.
2. Content-Length pre-check (early 413).
3. `SessionCap.tryUse()` — must be non-null.
4. `X-Place-Envelope` header — must be present.
5. Read body as bytes.
6. Body-size post-check.
7. Derive verification key: `HKDF(rotatingKey.keyAt(iat), sessionId,
   "place-action-session-v1")`. Try current day + previous day.
8. `verifyEnvelope()` — constant-time tag check first; field
   checks second; body-hash recompute last.
9. `NonceStoreCap.check(sessionId, counter)` — IPsec bitmap.
10. Parse body (JSON only — FormData fallback is `action()`'s).
11. Standard Schema input validation.
12. Call `fn(input, ctx)` with `ctx.session` present.

### Browser-side key flow

- App's session-establishment endpoint calls `provisionActionKey(sessionId)`
  server-side; returns `{ keyBytes, keyId, expiresAt }` in its
  response body.
- Browser-side `installActionKey(provisioned)` imports the key as
  WebCrypto `CryptoKey` with `extractable: false` and persists in
  IndexedDB so it survives reloads + cross-tab.
- A monotonic counter persists alongside the key (see "cross-tab
  counter race" in Consequences for the locking story).
- `clearActionKey()` on logout.

### Relationship to RFC 9421 (HTTP Message Signatures)

`criticalAction()` uses a compact framework-specific envelope rather
than full RFC 9421. The design borrows the same principle — bind
method, target, body digest, origin, session, timestamp, and key
identity into one verifiable signature — but skips RFC 9421's
configurable component selection + general canonicalisation to
reduce per-request overhead and lock the field set at the framework
level (so an attacker can't request a weaker covered-field subset).
If federation across organisations becomes a goal, an RFC 9421
profile can be added later; the underlying primitive (HMAC over a
canonical byte sequence) is the same.

### Threats this primitive addresses, and ones it does not

| Threat | criticalAction's defense |
|---|---|
| Cross-origin CSRF | Origin check + envelope binds `origin` |
| Tampering in flight (proxy / supply-chain mid-request) | HMAC envelope binds `body_hash`; mismatch → 403 |
| Forgery (guess/probe action endpoint) | HMAC requires per-session key |
| Cross-action confusion | Envelope binds `action_id` |
| Replay within session | IPsec sliding-window bitmap |
| Replay across sessions | Envelope binds `session_id` |
| Stale envelope (capture + late replay) | iat freshness window (default 300 s) |
| Clock-forward attack | future-iat cap (default 60 s) |
| Timing oracle on tag/secret compare | `Bun.timingSafeEqual` native |
| Field injection via canonicalisation | JSON-string-encoded field values |
| Schema-bomb DoS on validator | Input parse runs only after all crypto checks pass |
| Privilege escalation | `SessionCap` required at handler entry; macaroons in Phase 3 add per-action capability checks |
| Key-compromise blast radius | Per-day HKDF sub-key rotation; bounded exposure window |
| FIPS audit gap | `CryptoProviderCap` boundary slots a validated module |

**Explicitly NOT addressed by this primitive:**

- **Active same-origin XSS.** Non-extractable `CryptoKey` prevents
  the attacker from exfiltrating the raw key, but malicious script
  running in the same origin can still **invoke** `subtle.sign(…)`
  while the page is alive — the browser will sign anything the
  attacker chooses to send. Strict CSP (default-on in place), SRI
  on every island bundle (default-on), Trusted Types adoption,
  and source-side XSS prevention remain mandatory and orthogonal.
- **Endpoint enumeration.** Action URLs are visible in source
  (intentional — see "visible URLs" below). Defense is on the
  handler: auth, authorization, rate-limit, body validation.
- **Compromised user device.** If the device is malware-infected,
  the attacker can prompt the user to sign actions interactively.
  WebAuthn `txAuth` confirmation (deferred to a higher tier) is
  the mitigation; not in v0.1.

### What we explicitly reject

| Pattern | Rationale |
|---|---|
| Encrypted action IDs (Next-style) | The URL is still in the page; encryption tamper-detects, doesn't hide. CVE-2026-27978 was an origin-check bug — encryption didn't help. Visible URLs win on auditability. |
| Single `/` action endpoint | CVE-2025-66478 — every server function reachable from one URL. Place keeps per-action paths. |
| AEAD on payloads | Gratuitous over TLS 1.3 for the v0.1 case. Warranted only for E2EE app channels — out of scope. |
| Token Binding (RFC 8471) | Dead — Chrome dropped support. Superseded by DPoP. |
| ML-DSA / SLH-DSA today | Premature. AWS KMS shipped FIPS-204 June 2025; mainstream pilots 2027+. The interface is PQ-ready via `CryptoProviderCap`; algorithm choice deferred. HMAC is already PQ-resistant on the symmetric side. |
| LMS / XMSS (SP 800-208 stateful) | State-management hazard — "use this counter exactly once forever" is unsuited to high-frequency web requests. |
| Pure-JS Ed25519 (noble) on hot path | 498 µs verify on M4 vs 50 µs native libsodium. Last-resort fallback only. |
| Heuristic CSRF detection (WAF-style) | Charter: no quick fixes, structural defense only. Envelope binds origin + session + action structurally. |
| AsyncLocalStorage-based auth state | Hides which capability authorized which action. Macaroons (Phase 3) carry capability with the request. |

## Consequences

### What's now harder

- Apps using `criticalAction()` MUST provide a `secret` to `app()`,
  the same secret on every node.
- App's auth flow MUST call `provisionActionKey()` server-side +
  return the bytes to the browser; browser MUST call
  `installActionKey()` before any `.call()`.
- Browser without IndexedDB (rare; blocked iframes, some
  private-browsing modes) can't sign envelopes — apps need to handle
  this case if they target that audience.

### What's now easier

- The default surface area of a server mutation includes: origin
  check, payload HMAC, replay defense, session-binding, schema
  validation, body-size cap, prototype-pollution defense, structured
  errors. Zero handler boilerplate.
- FedRAMP-High deployments slot a FIPS-validated module via
  `CryptoProviderCap`. Zero handler change.

### Bounded sub-key exposure (clarification — NOT forward secrecy)

The daily HKDF rotation gives **bounded sub-key exposure**, not
classical forward secrecy. Classical forward secrecy means
compromise of long-term keys cannot reveal past session keys; here,
if the root secret leaks, past sub-keys can be re-derived
deterministically (same inputs → same HKDF output). What rotation
DOES give:

- A leaked DAILY sub-key reveals only one day's worth of
  signable envelopes (until that key rotates out and verifiers
  reject it).
- The root secret never appears in handler-reachable code; only
  derived sub-keys do. Reduces blast radius if a handler logs its
  key by accident.
- Compromise detection: rotating keys makes "this signing key
  was leaked at <date>" a meaningful event that can be acted on
  by rotating the root early.

True forward secrecy would require an ephemeral DH exchange per
session (out of scope for HTTP request-signing today).

### Cross-tab counter race

Two browser tabs reading the same monotonic counter from IndexedDB
can both choose the same value, sign, and race the server:

```
Tab A reads counter 10 → signs envelope #10 → sends
Tab B reads counter 10 → signs envelope #10 → sends
Server accepts #10 from whichever arrives first; the second is rejected as replay.
```

**Mitigation in v0.1:** Web Locks API when available
(`navigator.locks.request('place-action-counter', …)`); transactional
IndexedDB read-then-increment as fallback. The race is bounded —
the worst case is a user-visible "please retry" on the losing tab,
not a security vulnerability.

**Counters are monotonic, not contiguous.** Failed requests
(network drop, mid-flight cancel) leave gaps; the server's
sliding-window accepts any novel counter within window. Apps should
not assume `counter == N` was definitely sent + accepted just
because the client incremented past N.

### Audit trail (planned for Phase 4)

The Phase 4 Merkle log gives **tamper-evident audit trail** of
accepted requests — anyone with the root hash can verify a log
entry was committed at a point in time without the server being
able to revise history. This is NOT classical "non-repudiation"
(which would require a user-held signing key + independent identity
proof). The handler accepted the envelope as valid; the audit log
proves the handler did accept it. If the user's browser/session/key
were compromised, the envelope is still cryptographically valid;
"the human intentionally performed the action" is a stronger claim
that requires WebAuthn `txAuth` or similar (out of scope here).

### What we'll watch for

- The ~15 µs added crypto cost. Phase 5 (validator codegen) is
  **designed** to repay it with ~90 µs saved per request typical
  Zod-style schema. Until Phase 5 lands + we measure, treat
  "criticalAction is faster than action()" as a **target, not a
  promise**.
- Browser support for non-extractable `CryptoKey` in IndexedDB —
  evergreen browsers all support it; verify before production
  rollout if you target legacy.
- The counter-race story in production: instrument the Web Locks
  path + measure how often the IDB fallback triggers; tighten if
  needed.

### Performance frontier (per-request crypto cost; Bun-native, M-class hardware, 256-byte payload)

| Defense | Per-request cost | Threat eliminated |
|---|---|---|
| TLS 1.3 (assumed) | 0 | Network passive/active MitM |
| Origin + Sec-Fetch-Site | ~0.1 µs | Cross-origin form CSRF |
| HMAC-SHA-256 envelope verify | ~3–5 µs | Tampering, forgery, cross-action confusion |
| IPsec sliding-window check | ~50 ns | Within-session replay |
| `Bun.timingSafeEqual` everywhere | ~0 | Timing oracle on tag/secret |
| Per-day HKDF sub-key (cached) | ~5 ns hit / ~2–5 µs miss | Bounded sub-key exposure |
| Capability-token macaroon verify (Phase 3) | ~8 µs (3 caveats) | Privilege escalation |
| Merkle log append (Phase 4) | ~200 ns + amortised | Tamper-evident audit |
| AEAD on payload | (skipped) | (nothing TLS isn't already defeating) |
| DPoP Ed25519 (deferred to higher tier) | ~50 µs native | Token theft + cross-device replay |

**Pareto-optimal default stack: ~15 µs total added crypto.** Phase 5
codegen target: ~90 µs saved on schema validation; net result
**target** is faster than `action()` despite stronger defense.

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
  Server walks the chain; failures return 403 in constant time.
  Deferred — substrate ready.

- **Phase 4 — Audit log.** `AuditLogCap` interface + in-memory
  Merkle-tree default + opt-in SQLite adapter. Each entry chains
  the previous + canonical (actor, action, payload-hash,
  result-hash, ts). **Tamper-evident**, not classical
  non-repudiation (see Consequences). Deferred.

- **Phase 5 — Validator codegen.** Bun plugin lifts
  `fromStandard(schema)` into generated direct-decode code at build
  time. Target: replace runtime schema interp (~100 µs Zod typical)
  with generated specialised code (~5 µs). Net **target**:
  `criticalAction()` matches or beats `action()` despite the
  crypto. Deferred; treat as target until measured.

## Notes

- Wording discipline (added per first review pass): "tamper-evident
  and tamper-rejecting" — not "cannot be tampered with." Attackers
  can attempt tampering; the system detects and rejects. The
  defense is detection + refusal, not magic.

- Standards mapped explicitly in each shipped commit:
  - OWASP ASVS 5.0 11.1.1 / 11.2.2 (rotation, crypto-agility)
  - OWASP ASVS 5.0 11.2.4 L3 (constant-time)
  - OWASP ASVS 5.0 11.3.4 L3 (single-use nonce)
  - OWASP ASVS 5.0 11.4.1 L1 (HMAC-SHA-256)
  - NIST SP 800-53 Rev 5 AU-10 (non-repudiation), SI-7 (integrity),
    SC-13 (cryptographic protection)
  - NIST SP 800-57 Part 1 Rev 5 (key management lifecycle)
  - NIST SP 800-108 (HKDF)
  - RFC 4303 (IPsec ESP anti-replay)
  - RFC 5869 (HKDF)
  - FedRAMP Crypto Policy v1.1.0 (Jan 2025)

- The visible-URL choice is structural, not pragmatic. A security
  reviewer can `grep -r 'criticalAction(' src/` and enumerate every
  state-mutating endpoint the app exposes. With Next's `'use server'`
  the reviewer has to walk every transitively-imported file the
  build pipeline pulls in. The opacity is exactly the failure mode
  catalogued in `docs/platform/07-prior-art-failures.md` §"compiler
  magic that hides intent."

- Threat model file (`systems/security/src/critical-action.threat-model.md`)
  to be written when Phase 3 lands — the full picture needs
  macaroons + audit log to be complete. The threat-list above is
  the current snapshot.

- Companion ADRs:
  - 0001 (Bun + TS stack — provides the `Bun.timingSafeEqual` floor)
  - 0010 (`__PLACE_BROWSER__` define — keeps server-side crypto code
    out of client bundles via DCE)
  - 0014 (CSP-safe inline style writes — same XSS defense layer)
  - 0020 (island security hardening — SRI + nonce-CSP)
  - 0025 (SRI + attack-surface reduction)
  - 0044 (`<Can do="…">` RBAC gate — predicate-level RBAC that
    composes WITH macaroons, doesn't replace them)
  - 0045 (`fromStandard()` schema interop — validator-agnostic
    input parsing that Phase 5 codegen will optimise)
  - 0056 (entrypoint subpaths — the impossible-import-graph
    that keeps server-side crypto code out of client bundles
    by construction, not by define)
