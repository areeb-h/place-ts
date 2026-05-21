// @place-ts/component criticalAction() — high-assurance server action.
//
// The high-assurance sibling of `action()`. Same author shape (one
// declaration produces a typed `call()` and a route handler), but
// every request is verified against an HMAC envelope BEFORE the
// handler body runs:
//
//   1. Origin / body-size pre-checks (cheap, no allocations).
//   2. `SessionCap.tryUse()` — handler MUST have a session attached.
//   3. Read `X-Place-Envelope` header. Missing → 403.
//   4. Derive per-session per-day HMAC key from the app's root
//      secret + the envelope's keyId + sessionId.
//   5. `verifyEnvelope()` — verifies tag in constant time, then
//      checks freshness window + action_id + origin + session_id +
//      body_hash. Any failure → 403, no info on the wire.
//   6. `NonceStoreCap.check(sessionId, counter)` — IPsec-style
//      sliding-window replay defense. Replay → 403.
//   7. Parse body (JSON or FormData; proto-pollution sentinels
//      rejected at parse).
//   8. Standard Schema validation. Invalid → 400.
//   9. Call `fn(input, ctx)`. `ctx.session` is guaranteed.
//
// Total added crypto: ~5-15μs per request. The codegen validators
// (Phase 5) will repay that and more.
//
// **App boot requirements:**
//   - `app({ secret: '...' })` — 32+ byte secret. Used as the root
//     for the framework's per-session key derivation. Must be the
//     same on every node in a multi-node deployment.
//   - `SessionCap` MUST be installed before the handler runs. The
//     framework throws at app-config time if any `criticalAction()`
//     is registered without a SessionCap install.
//
// **Wire format (what the browser sends):**
//
//   POST /__a/createComment
//   X-Place-Envelope: <base64url(canonical)>.<base64url(tag)>
//   Content-Type: application/json
//
//   {"postId":"…","body":"…"}
//
// The canonical envelope BINDS the body's SHA-256 hash. An attacker
// who can flip a byte in the body cannot produce a matching tag
// without the per-session HMAC key, which is non-extractable in the
// browser (WebCrypto) and never leaves the browser-side IndexedDB.
//
// Standards:
//   - OWASP ASVS 5.0 11.4.1 (HMAC-SHA-256), 11.3.4 (single-use
//     nonce within freshness window), 11.2.4 (constant-time compare).
//   - NIST SP 800-53 Rev 5 AU-10 (non-repudiation), SI-7 (integrity).
//   - RFC 4303 (IPsec ESP anti-replay window).

import {
  type CryptoProvider,
  deserializeMacaroon,
  type MacaroonVerifyContext,
  type RotatingKey,
  type Session,
  SessionCap,
  sha256Base64url,
  useAuditLog,
  useCryptoProvider,
  useNonceStore,
  verifyEnvelope,
  verifyMacaroon,
} from '@place-ts/security'
import { ActionError, type ActionSchema, type LoadCtx, rejectsPollution } from './action.ts'

// ===== Public API =====

/**
 * Definition of a critical action. Same field set as `ActionDef`
 * minus `csrf:` (the envelope obsoletes it) plus `assurance:`.
 */
export interface CriticalActionDef<I, R> {
  /**
   * Route path (e.g. `'POST /__a/createComment'`). Same parsing
   * rules as `action()` — METHOD + space + path. State-changing
   * methods default to POST.
   */
  readonly path: string
  /** Standard Schema validator. Reject invalid input with 400. */
  readonly input: ActionSchema<I>
  /**
   * Handler. Receives the validated input + a `CriticalActionCtx`
   * with `session` GUARANTEED present (the framework enforces
   * SessionCap before calling).
   */
  readonly fn: (input: I, ctx: CriticalActionCtx) => Promise<R> | R
  /**
   * Force a same-origin check. Default `true` for state-changing
   * methods. Critical actions are POST-typed so this is almost
   * always `true`. Setting `false` is unusual and explicit.
   */
  readonly sameOrigin?: boolean
  /** Max body size in bytes. Default 1 MiB. */
  readonly maxBodyBytes?: number
  /**
   * Maximum age of the envelope's `iat` in seconds before it's
   * "stale". Default 300 (5 minutes). Tightening this reduces the
   * replay window; loosening accommodates clock skew on the client.
   */
  readonly maxAgeSec?: number
  /**
   * Required capabilities (Phase 3 / ADR 0055). When set, the
   * framework reads a macaroon from the `X-Place-Macaroon` request
   * header, verifies its signature against the session's macaroon
   * key, walks its caveats, and confirms the effective authority
   * covers every declared `perm()`. All-or-nothing: ANY missing
   * permission → 403. Empty array (or absent) = no macaroon check
   * (envelope-only protection from Phases 1+2).
   *
   * Declared via `perm('op.name')`:
   *
   *   criticalAction({
   *     ...,
   *     requires: [perm('comments.create'), perm('posts.read')],
   *     fn: …
   *   })
   *
   * The request's macaroon must permit BOTH `comments.create` AND
   * `posts.read`. The framework checks each independently against
   * the macaroon's effective `op=` restrictions (intersection of
   * all `op=` caveats).
   */
  readonly requires?: readonly PermDeclaration[]
  /**
   * App-specific verifier for `app:<key>=<value>` caveats on the
   * macaroon. Called once per `app:` caveat at verification time.
   * Return `true` to permit; `false` to reject. Async permitted
   * but adds latency to every verify call — keep it fast or
   * memoise.
   *
   * Macaroons that carry `app:` caveats but no verifier is
   * installed fail-closed (the framework refuses to accept caveats
   * it can't evaluate).
   */
  readonly appCaveatVerifier?: (
    key: string,
    value: string,
    ctx: MacaroonVerifyContext,
  ) => boolean | Promise<boolean>
}

/** Marker returned by `perm()` — declares an op required for the
 *  action. Pinned shape so the framework can statically introspect
 *  it (e.g. for OpenAPI generation later). */
export interface PermDeclaration {
  readonly kind: 'perm'
  readonly op: string
}

/**
 * Declare that the action requires the given op-permission. Pass
 * to `criticalAction({ requires: [...] })`. The op string is
 * checked against the request's macaroon caveats:
 *
 *   - A macaroon with no `op=` caveats permits any op.
 *   - A macaroon with `op=comments.*` permits any `comments.*`.
 *   - A macaroon with `op=comments.create` permits ONLY that.
 *
 * Multiple `op=` caveats compose by intersection. The request's
 * op must satisfy ALL of them.
 *
 * Apps mint macaroons during auth (see `provisionMacaroon`) and
 * attenuate them with the user's actual permissions:
 *
 *   const root = await mintMacaroon(macaroonKey, session.id)
 *   const userToken = await attenuate(root, `op=comments.*`)
 *   // send userToken.bytes to the browser
 */
export function perm(op: string): PermDeclaration {
  if (typeof op !== 'string' || op.length === 0) {
    throw new Error('perm: op must be a non-empty string')
  }
  return { kind: 'perm', op }
}

/** Context passed to the handler. Differs from `LoadCtx` in:
 *  - `session` is GUARANTEED non-null (framework enforces).
 *  - `audit(event, payload?)` appends to the tamper-evident audit
 *    log. Use for events the handler decides to record beyond the
 *    framework's automatic per-request entry (which happens on
 *    return). Common cases: a multi-step handler that records
 *    intermediate checkpoints, or a handler that emits an event
 *    when a particular branch fires (`fraud_score.high`,
 *    `kyc.escalated`). Cheap (~200 ns) so liberal use is fine. */
export interface CriticalActionCtx extends LoadCtx {
  /** Authenticated session for the request. Framework-enforced. */
  readonly session: Session
  /**
   * Append a handler-emitted event to the audit log. Binds
   * (session.userId, event, sha256(payload), result-hash="",
   * prev-hash) — the regular entry shape with the action field
   * set to `event` instead of the request's action_id.
   */
  audit(event: string, payload?: unknown): Promise<void>
}

/** The shape returned by `criticalAction()` — call site + handler
 *  registration + the path string for diagnostics. */
export interface CriticalAction<I, R> {
  /**
   * Typed client caller. Reads the per-session HMAC key from the
   * browser's IndexedDB (provisioned by the app's auth flow via
   * `installActionKey()`) + signs the envelope before sending.
   * Mirrors `action().call()` semantics: throws `ActionError` on
   * non-2xx, returns typed result on success.
   */
  call(input: I): Promise<R>
  /** Route table fragment. Spread into `serve({ routes })`. */
  handler: Record<string, (req: Request, params: Record<string, string>) => Promise<Response>>
  /** The path the action POSTs to. */
  path: string
  /** Type-level marker for framework introspection (app-boot
   *  validation that SessionCap is installed). */
  readonly __isCriticalAction: true
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024 // 1 MiB
const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])
const SAFE_ACTION_PATH = /^[A-Z]+ \/[\w/\-:]+$/

/**
 * Server-side accessor for the active rotating-key derivation. Apps
 * install this via `app({ secret })`; the framework's `serve()` calls
 * `setActionRootKey()` at boot. Reads here throw a clear error if no
 * root was set — `criticalAction()` requires it.
 *
 * Per-session keys are derived as
 *   `HKDF(dailyRoot.keyAt(iatDate), sessionId, "place-action-session-v1")`
 * so two sessions on the same day get DIFFERENT per-session keys.
 * Compromise of one session's key is bounded to that session.
 */
let _actionRoot: RotatingKey | null = null
export function setActionRootKey(root: RotatingKey, _raw: Uint8Array): void {
  // `_raw` is accepted for future use (audit log signs with the same
  // root); for v0.1 only the rotating-key wrapper is kept.
  void _raw
  _actionRoot = root
}
export function _clearActionRootKey(): void {
  _actionRoot = null
}
export function getActionRoot(): RotatingKey {
  if (_actionRoot === null) {
    throw new Error(
      'criticalAction: no app secret installed. Pass `secret: "<32+ bytes>"` to `app({...})`. ' +
        'The secret is used as the root for per-session HMAC key derivation; without it the ' +
        'framework cannot verify envelopes.',
    )
  }
  return _actionRoot
}

/**
 * Derive the per-session HMAC key for `sessionId` at `at`. Used by
 * both `criticalAction()`'s server-side verifier AND the app's
 * `provisionActionKey()` helper (which returns the bytes to the
 * browser for client-side signing).
 *
 * Algorithm: HKDF-SHA256(dailyRootKey, salt=sessionId, info="place-action-session-v1").
 * Same root + session + day → same key on every node, so a
 * multi-node deployment shares the verification key without an
 * out-of-band sync.
 */
export async function deriveSessionKey(
  sessionId: string,
  at: Date = new Date(),
  provider: CryptoProvider = useCryptoProvider(),
): Promise<{ key: Uint8Array; keyId: string }> {
  const root = getActionRoot()
  const dailyKey = await root.keyAt(at)
  const enc = new TextEncoder()
  const sessionKey = await provider.hkdfSha256(
    dailyKey,
    enc.encode(sessionId),
    enc.encode('place-action-session-v1'),
    32,
  )
  return { key: sessionKey, keyId: root.keyIdAt(at) }
}

/**
 * Derive the per-session **macaroon** key. Domain-separated from
 * the envelope's session key via a distinct HKDF `info` tag — so
 * a leak of one key doesn't help with the other.
 *
 * Algorithm: HKDF-SHA256(dailyRootKey, salt=sessionId, info="place-macaroon-v1").
 *
 * Apps mint user macaroons in their auth flow:
 *
 *   import { mintMacaroon, attenuate } from '@place-ts/security'
 *   import { deriveMacaroonKey } from '@place-ts/component/server'
 *
 *   const { key } = await deriveMacaroonKey(session.id)
 *   const root = await mintMacaroon(key, session.id)
 *   const userToken = await attenuate(root, `op=comments.*`)
 *   const userToken2 = await attenuate(userToken, `expires=…`)
 *   // serialise + return to the browser via installMacaroon().
 */
export async function deriveMacaroonKey(
  sessionId: string,
  at: Date = new Date(),
  provider: CryptoProvider = useCryptoProvider(),
): Promise<{ key: Uint8Array; keyId: string }> {
  const root = getActionRoot()
  const dailyKey = await root.keyAt(at)
  const enc = new TextEncoder()
  const macaroonKey = await provider.hkdfSha256(
    dailyKey,
    enc.encode(sessionId),
    enc.encode('place-macaroon-v1'),
    32,
  )
  return { key: macaroonKey, keyId: root.keyIdAt(at) }
}

/**
 * Provision a per-session macaroon for the browser. Apps call from
 * their auth handler after authentication succeeds — typically right
 * after `provisionActionKey`. The returned macaroon serialised string
 * is sent to the browser; `installMacaroon()` stores it for use on
 * subsequent `criticalAction.call()` invocations that need `requires`
 * authorisation.
 *
 * The returned macaroon has NO `op=` caveats — it's the broadest
 * authority a session can hold. Apps narrow it via `attenuate()` to
 * match the user's actual permissions before issuance:
 *
 *   const broad = await provisionMacaroon(session.id)
 *   const userToken = await attenuate(broad.macaroon, 'op=comments.*')
 *   return { macaroon: serializeMacaroon(userToken), expiresAt: broad.expiresAt }
 */
export async function provisionMacaroon(
  sessionId: string,
): Promise<{ macaroon: import('@place-ts/security').Macaroon; keyId: string; expiresAt: number }> {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('provisionMacaroon: sessionId must be a non-empty string')
  }
  const { mintMacaroon } = await import('@place-ts/security')
  const { key, keyId } = await deriveMacaroonKey(sessionId)
  const macaroon = await mintMacaroon(key, sessionId)
  // Macaroons rotate with the daily root. After expiry the
  // verifier rejects (key mismatch); apps re-provision via the
  // session-refresh flow.
  const nowMs = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const expiresAt = Math.ceil(nowMs / dayMs) * dayMs
  return { macaroon, keyId, expiresAt }
}

/**
 * Provision a per-session HMAC key for the browser. The app's auth
 * handler (login, signup, session-refresh) calls this + sends the
 * `keyBytes` to the browser in its response body. The browser's
 * `installActionKey()` imports it as a non-extractable CryptoKey +
 * stores in IndexedDB. Subsequent action calls use it to sign.
 *
 * The framework deliberately does NOT auto-attach this to any
 * endpoint — auth flow is app-specific (OAuth, password, magic
 * link, etc.) and the key delivery rides whichever response the
 * app already uses. See the docs for the recommended pattern.
 */
export async function provisionActionKey(sessionId: string): Promise<{
  keyBytes: string // base64url
  keyId: string
  expiresAt: number // epoch ms; the daily-rotation boundary
  sessionId: string // echoed back so the browser binds it into envelopes
}> {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('provisionActionKey: sessionId must be a non-empty string')
  }
  const { key, keyId } = await deriveSessionKey(sessionId)
  // The day boundary is when the rotating key changes; the browser
  // should re-provision before it. Default rotation = 24h, so
  // expiresAt = end of current day (UTC).
  const nowMs = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const expiresAt = Math.ceil(nowMs / dayMs) * dayMs
  // The session id rides ALONGSIDE the key, not in `document.cookie`.
  // Apps set the session cookie HttpOnly (the security default for
  // `setCookieHeader`), so the browser can't read it from JS; instead
  // we echo the id back in the provision response. The browser stores
  // it in IndexedDB next to the non-extractable CryptoKey and uses it
  // when signing envelopes. Two wins:
  //   1. envelope `session_id` is now sourced from IDB, not from
  //      `document.cookie` — the HttpOnly auth cookie stays HttpOnly.
  //   2. closes the XSS pivot where an attacker writes
  //      `document.cookie = "place_sid=victim"` to spoof a different
  //      user's session id into envelopes (HttpOnly blocks reads of the
  //      legit cookie but does NOT block JS-set duplicates with the
  //      same name — a real cross-site bug, see browser cookie spec).
  return { keyBytes: base64urlEncode(key), keyId, expiresAt, sessionId }
}

// ===== Factory =====

export function criticalAction<I, R>(def: CriticalActionDef<I, R>): CriticalAction<I, R> {
  if (typeof def.path !== 'string' || !SAFE_ACTION_PATH.test(def.path)) {
    throw new Error(
      `criticalAction: path must be 'METHOD /pattern' with safe characters (got ${JSON.stringify(def.path)})`,
    )
  }
  const { method, path } = parsePath(def.path)
  const routeKey = `${method} ${path}`
  const sameOriginRequired = def.sameOrigin ?? STATE_CHANGING.has(method)
  const maxBodyBytes = def.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
  const maxAgeSec = def.maxAgeSec ?? 300

  const handler = async (req: Request, params: Record<string, string>): Promise<Response> => {
    // Reject in constant order so timing doesn't leak which check
    // failed (within reason — full constant-time across the whole
    // path isn't feasible for variable-length bodies).

    // 1. Same-origin check. Cross-origin requests die immediately
    //    with no detail.
    if (sameOriginRequired && !isSameOrigin(req)) {
      return forbidden('cross-origin')
    }
    // 2. Body size guard pre-parse. Reject early on Content-Length.
    const contentLength = Number.parseInt(req.headers.get('content-length') ?? '', 10)
    if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
      return new Response(`Payload too large (max ${maxBodyBytes} bytes)`, {
        status: 413,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    // 3. Session. The framework requires SessionCap to be installed
    //    before any criticalAction handler runs; serve()'s app-boot
    //    validation throws if it isn't. Inside the handler we read
    //    via tryUse() so a missing session at REQUEST time (e.g.
    //    logged-out user) returns 403 instead of 500.
    const session = SessionCap.tryUse()
    if (session === null) {
      return forbidden('no-session')
    }
    // 4. Envelope. Critical actions MUST carry one.
    const envelopeWire = req.headers.get('x-place-envelope')
    if (envelopeWire === null || envelopeWire.length === 0) {
      return forbidden('no-envelope')
    }
    // 5. Read body as raw bytes (we need them for body-hash verify).
    let bodyBytes: Uint8Array
    try {
      const buf = await req.arrayBuffer()
      bodyBytes = new Uint8Array(buf)
    } catch {
      return new Response('invalid request body', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    if (bodyBytes.length > maxBodyBytes) {
      return new Response(`Payload too large (max ${maxBodyBytes} bytes)`, {
        status: 413,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    // 6. Derive verification key (tries current day + previous day
    //    for clock-rollover tolerance). Verify envelope.
    const url = new URL(req.url)
    const origin = url.origin
    const provider = useCryptoProvider()
    const now = new Date()
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    let verifyResult: Awaited<ReturnType<typeof verifyEnvelope>> | null = null
    let verifiedAt: Date = now
    for (const at of [now, yesterday]) {
      const { key } = await deriveSessionKey(session.id, at, provider)
      const r = await verifyEnvelope(
        envelopeWire,
        {
          key,
          body: bodyBytes,
          expectedActionId: routeKey,
          expectedOrigin: origin,
          expectedSessionId: session.id,
          maxAgeSec,
        },
        provider,
      )
      if (r.ok) {
        verifyResult = r
        verifiedAt = at
        break
      }
      // Remember the LAST rejection reason — if both attempts fail,
      // we return the most specific one (typically the same).
      verifyResult = r
    }
    if (!verifyResult?.ok) {
      return forbidden(`envelope:${verifyResult?.reason ?? 'unknown'}`)
    }
    // 7. Replay defense.
    const nonceStore = useNonceStore()
    const novel = await nonceStore.check(session.id, verifyResult.fields.counter)
    if (!novel) {
      return forbidden('replay')
    }
    // 7b. Macaroon authorisation. When `requires:` is non-empty the
    //     request MUST carry `X-Place-Macaroon` whose effective
    //     authority covers every declared `perm()`. Verified after
    //     replay so we never pay schema cost for unauthenticated
    //     requests, and so the audit trail of macaroon rejection
    //     does not double-count replays of the same envelope.
    if (def.requires && def.requires.length > 0) {
      const macaroonWire = req.headers.get('x-place-macaroon')
      if (macaroonWire === null || macaroonWire.length === 0) {
        return forbidden('no-macaroon')
      }
      let macaroon: import('@place-ts/security').Macaroon
      try {
        macaroon = deserializeMacaroon(macaroonWire)
      } catch {
        return forbidden('macaroon:malformed')
      }
      const { key: macaroonKey } = await deriveMacaroonKey(session.id, verifiedAt, provider)
      const nowMs = now.getTime()
      for (const decl of def.requires) {
        const verifyCtx: MacaroonVerifyContext = def.appCaveatVerifier
          ? { op: decl.op, origin, now: nowMs, appVerifier: def.appCaveatVerifier }
          : { op: decl.op, origin, now: nowMs }
        const r = await verifyMacaroon(macaroon, macaroonKey, verifyCtx, provider)
        if (!r.ok) {
          return forbidden(`macaroon:${r.reason}`)
        }
      }
    }
    // 8. Parse body for the schema. Critical actions are JSON-only
    //    (FormData is for `action()`'s progressive-enhancement
    //    path; critical actions ride X-Place-Envelope which requires
    //    JS, so the FormData fallback is moot).
    let raw: unknown
    try {
      const text = new TextDecoder().decode(bodyBytes)
      raw = text.length === 0 ? {} : JSON.parse(text)
    } catch {
      return new Response('criticalAction: invalid JSON body', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    if (rejectsPollution(raw)) {
      return new Response('criticalAction: rejected suspicious request body', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    // 9. Schema validate.
    let validated: I
    try {
      validated = def.input(raw)
    } catch (e) {
      return new Response(e instanceof Error ? e.message : 'invalid input', {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    // 10. Call the handler.
    const auditLog = useAuditLog()
    const payloadHash = await sha256Base64url(bodyBytes)
    // Pre-compute the canonical actor field once; reused for the
    // request entry below + every ctx.audit() call inside the handler.
    const actor = session.userId
    let result: R
    try {
      const ctx: CriticalActionCtx = {
        req,
        url,
        params,
        prefetch: false,
        session,
        async audit(event, payload) {
          const evHash =
            payload === undefined
              ? ''
              : await sha256Base64url(new TextEncoder().encode(JSON.stringify(payload)))
          await auditLog.append({
            actor,
            action: event,
            payloadHash: evHash,
            resultHash: '',
            keyId: verifyResult.fields.keyId,
          })
        },
      }
      result = await def.fn(validated, ctx)
    } catch (e) {
      // Audit the failed attempt so the tamper-evident chain shows
      // it. resultHash is empty; action is the route id; the error
      // class/message is NOT bound (could be PII or implementation
      // detail). Handlers that want richer failure attribution call
      // `ctx.audit('action_name.failure', { reason })` themselves.
      await auditLog
        .append({
          actor,
          action: `${routeKey}#error`,
          payloadHash,
          resultHash: '',
          keyId: verifyResult.fields.keyId,
        })
        .catch(() => {
          // Audit failure during error path — don't double-fault.
        })
      if (e instanceof ActionError) {
        return new Response(JSON.stringify({ error: e.message, payload: e.payload }), {
          status: e.status,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        })
      }
      return new Response(e instanceof Error ? e.message : String(e), {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    // Auto-append the success entry. Bound: (actor, action_id,
    // payload_hash, result_hash, key_id). result_hash is the
    // SHA-256 of the JSON-stringified result — deterministic enough
    // to verify "this user got this answer to this request" later.
    const resultJson = JSON.stringify(result)
    const resultHash = await sha256Base64url(new TextEncoder().encode(resultJson))
    await auditLog
      .append({
        actor,
        action: routeKey,
        payloadHash,
        resultHash,
        keyId: verifyResult.fields.keyId,
      })
      .catch(() => {
        // Audit-store failure on the success path is non-fatal for
        // the request — the action ran + the user gets their result.
        // Apps that need stricter "no result without audit" semantics
        // install a durable adapter that fails closed.
      })
    return new Response(resultJson, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  }

  const call = async (input: I): Promise<R> => {
    // Client-side validation — fail-fast before network.
    def.input(input)
    // The browser-side action-key helpers live in a separate module
    // (`@place-ts/component/client`) so they can be tree-shaken from
    // server bundles. We dynamic-import on first use to avoid a hard
    // dep cycle.
    const { signClientEnvelope, loadMacaroonWire } = await import('./critical-action-client.ts')
    const bodyJson = JSON.stringify(input)
    const bodyBytes = new TextEncoder().encode(bodyJson)
    const envelope = await signClientEnvelope({
      actionId: routeKey,
      body: bodyBytes,
    })
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Place-Envelope': envelope,
    }
    // Always attach the macaroon if one is installed. Server checks
    // it only when `requires:` is non-empty, but unconditional send
    // means a single .call() works against any action shape.
    const macaroonWire = await loadMacaroonWire()
    if (macaroonWire !== null) {
      headers['X-Place-Macaroon'] = macaroonWire
    }
    const res = await fetch(path, {
      method,
      headers,
      body: bodyJson,
    })
    if (!res.ok) {
      const ct = res.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) {
        const data = (await res.json()) as { error?: string; payload?: unknown }
        throw new ActionError(res.status, data.error ?? `HTTP ${res.status}`, data.payload)
      }
      throw new ActionError(res.status, await res.text())
    }
    return (await res.json()) as R
  }

  return {
    call,
    handler: { [routeKey]: handler },
    path,
    __isCriticalAction: true,
  }
}

// ===== Internal helpers =====

function parsePath(s: string): { method: string; path: string } {
  const space = s.indexOf(' ')
  if (space < 0) throw new Error(`criticalAction: path must be 'METHOD /pattern' (got ${s})`)
  return { method: s.slice(0, space).toUpperCase(), path: s.slice(space + 1) }
}

function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin') ?? req.headers.get('referer') ?? ''
  if (origin.length === 0) return false
  try {
    return new URL(origin).origin === new URL(req.url).origin
  } catch {
    return false
  }
}

function forbidden(reason: string): Response {
  // No-info-leak: identical bytes for every rejection class. The
  // typed reason is logged server-side (audit log in Phase 4) but
  // the wire just sees "Forbidden".
  void reason
  return new Response('Forbidden', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

function base64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
