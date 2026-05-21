// @vitest-environment happy-dom

import {
  AuditLogCap,
  attenuate,
  bunCryptoProvider,
  inMemoryAuditLog,
  inMemoryNonceStore,
  mintMacaroon,
  NonceStoreCap,
  rotatingKey,
  type Session,
  SessionCap,
  serializeMacaroon,
  sha256Base64url,
  signEnvelope,
} from '@place/security'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  _clearActionRootKey,
  criticalAction,
  deriveMacaroonKey,
  deriveSessionKey,
  perm,
  provisionActionKey,
  provisionMacaroon,
  setActionRootKey,
} from '../../src/critical-action.ts'

// --- Test fixtures ---------------------------------------------------

const ENCODER = new TextEncoder()

/** Pre-derived 32-byte root for deterministic tests. */
const TEST_ROOT = ENCODER.encode('test-root-secret-32-bytes-long!!')

/** Install the rotating root for each test that needs it. */
function installRoot(): void {
  setActionRootKey(rotatingKey(TEST_ROOT), TEST_ROOT)
}

/** Mint a sample session. */
const SESSION: Session = {
  id: 'session-abc-123',
  userId: 'user-alice',
  issuedAt: Date.now(),
  expiresAt: null,
}

/** Helper: mint a valid envelope for an action call. */
async function mintEnvelope(opts: {
  actionId: string
  body: Uint8Array
  sessionId?: string
  origin?: string
  counter?: number
  at?: Date
}): Promise<string> {
  const sessionId = opts.sessionId ?? SESSION.id
  const { key, keyId } = await deriveSessionKey(sessionId, opts.at)
  const bodyHash = await sha256Base64url(opts.body)
  return signEnvelope(key, {
    actionId: opts.actionId,
    bodyHash,
    counter: opts.counter ?? 1,
    iat: Math.floor((opts.at?.getTime() ?? Date.now()) / 1000),
    origin: opts.origin ?? 'http://localhost',
    sessionId,
    keyId,
  })
}

beforeEach(() => {
  _clearActionRootKey()
})

// --- Tests -----------------------------------------------------------

describe('criticalAction — registration', () => {
  test('returns a typed action with call + handler + path + marker', () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/test',
      input: (raw) => raw as { x: number },
      fn: () => ({ ok: true }),
    })
    expect(a.path).toBe('/__a/test')
    expect(typeof a.call).toBe('function')
    expect(a.handler['POST /__a/test']).toBeDefined()
    expect(a.__isCriticalAction).toBe(true)
  })

  test('rejects malformed path syntax', () => {
    expect(() => criticalAction({ path: 'no-method', input: (r) => r, fn: () => null })).toThrow(
      /'METHOD \/pattern'/,
    )
  })

  test('rejects unsafe characters in path', () => {
    expect(() =>
      // Spaces in the path component aren't allowed (would break URL parsing).
      criticalAction({ path: 'POST /__a/foo bar', input: (r) => r, fn: () => null }),
    ).toThrow(/safe characters/)
  })
})

describe('criticalAction — handler verification pipeline', () => {
  test('rejects request with no envelope', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/test',
      input: (raw) => raw as object,
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/test']
    if (!handler) throw new Error('handler not registered')
    const req = new Request('http://localhost/__a/test', {
      method: 'POST',
      headers: { origin: 'http://localhost' },
      body: JSON.stringify({}),
    })
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
    }
    expect(res.status).toBe(403)
  })

  test('rejects request with no SessionCap installed', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/test',
      input: (raw) => raw as object,
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/test']
    if (!handler) throw new Error('handler not registered')
    const body = ENCODER.encode('{}')
    const envelope = await mintEnvelope({
      actionId: 'POST /__a/test',
      body,
    })
    const req = new Request('http://localhost/__a/test', {
      method: 'POST',
      headers: { referer: 'http://localhost/', 'x-place-envelope': envelope },
      body,
    })
    const res = await handler(req, {}) // no SessionCap.provide
    expect(res.status).toBe(403)
  })

  test('accepts valid envelope + invokes fn + returns JSON', async () => {
    installRoot()
    let received: unknown = null
    const a = criticalAction({
      path: 'POST /__a/echo',
      input: (raw) => raw as { msg: string },
      sameOrigin: false, // happy-dom strips Origin/Referer; same-origin tested separately below
      fn: (input) => {
        received = input
        return { echoed: input.msg }
      },
    })
    const handler = a.handler['POST /__a/echo']
    if (!handler) throw new Error('handler not registered')
    const body = ENCODER.encode(JSON.stringify({ msg: 'hello' }))
    const envelope = await mintEnvelope({ actionId: 'POST /__a/echo', body })
    const req = new Request('http://localhost/__a/echo', {
      method: 'POST',
      headers: { referer: 'http://localhost/', 'x-place-envelope': envelope },
      body,
    })
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
    }
    expect(res.status).toBe(200)
    expect(received).toEqual({ msg: 'hello' })
    expect(await res.json()).toEqual({ echoed: 'hello' })
  })

  test('rejects tampered body (body_hash mismatch)', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/strict',
      input: (raw) => raw as { x: number },
      fn: (input) => input,
    })
    const handler = a.handler['POST /__a/strict']
    if (!handler) throw new Error('handler not registered')
    const original = ENCODER.encode('{"x":1}')
    const envelope = await mintEnvelope({ actionId: 'POST /__a/strict', body: original })
    // Send a DIFFERENT body than the envelope was minted for.
    const tampered = ENCODER.encode('{"x":99}')
    const req = new Request('http://localhost/__a/strict', {
      method: 'POST',
      headers: { referer: 'http://localhost/', 'x-place-envelope': envelope },
      body: tampered,
    })
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
    }
    expect(res.status).toBe(403)
  })

  test('rejects envelope minted for a DIFFERENT action', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/withdraw',
      input: (raw) => raw as object,
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/withdraw']
    if (!handler) throw new Error('handler not registered')
    const body = ENCODER.encode('{}')
    // Mint envelope for /deposit, send to /withdraw.
    const envelope = await mintEnvelope({ actionId: 'POST /__a/deposit', body })
    const req = new Request('http://localhost/__a/withdraw', {
      method: 'POST',
      headers: { referer: 'http://localhost/', 'x-place-envelope': envelope },
      body,
    })
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
    }
    expect(res.status).toBe(403)
  })

  test('rejects envelope minted for a DIFFERENT session', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/test',
      input: (raw) => raw as object,
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/test']
    if (!handler) throw new Error('handler not registered')
    const body = ENCODER.encode('{}')
    // Mint envelope as user B; serve to user A.
    const envelope = await mintEnvelope({
      actionId: 'POST /__a/test',
      body,
      sessionId: 'attacker-session',
    })
    const req = new Request('http://localhost/__a/test', {
      method: 'POST',
      headers: { referer: 'http://localhost/', 'x-place-envelope': envelope },
      body,
    })
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
    }
    expect(res.status).toBe(403)
  })

  test('replay of the same counter is rejected', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/test',
      input: (raw) => raw as object,
      sameOrigin: false,
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/test']
    if (!handler) throw new Error('handler not registered')
    const body = ENCODER.encode('{}')
    const envelope = await mintEnvelope({ actionId: 'POST /__a/test', body, counter: 5 })
    const buildReq = (): Request =>
      new Request('http://localhost/__a/test', {
        method: 'POST',
        headers: { referer: 'http://localhost/', 'x-place-envelope': envelope },
        body,
      })
    const nonceStore = inMemoryNonceStore()
    const disposeNonce = NonceStoreCap.install(nonceStore)
    const disposeSession = SessionCap.install(SESSION)
    let res1: Response
    let res2: Response
    try {
      // First request succeeds.
      res1 = await handler(buildReq(), {})
      // Identical replay (same counter) rejected.
      res2 = await handler(buildReq(), {})
    } finally {
      disposeSession()
      disposeNonce()
    }
    expect(res1.status).toBe(200)
    expect(res2.status).toBe(403)
  })

  test('rejects cross-origin request (default sameOrigin: true)', async () => {
    // happy-dom strips Origin/Referer when set programmatically. We
    // exercise the same-origin check via the Request URL itself —
    // the request hits http://localhost/__a/test but no Origin or
    // Referer is present (browser fetch would always set Origin for
    // POST; absence means the request looks "cross-origin" to the
    // guard). This is the test the guard exists for: an unwitnessed
    // origin is treated as not-same-origin.
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/test',
      input: (raw) => raw as object,
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/test']
    if (!handler) throw new Error('handler not registered')
    const body = ENCODER.encode('{}')
    const envelope = await mintEnvelope({ actionId: 'POST /__a/test', body })
    const req = new Request('http://localhost/__a/test', {
      method: 'POST',
      headers: { 'x-place-envelope': envelope },
      body,
    })
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
    }
    expect(res.status).toBe(403)
  })

  test('rejects oversize body (413)', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/test',
      input: (raw) => raw as object,
      sameOrigin: false,
      fn: () => ({ ok: true }),
      maxBodyBytes: 64,
    })
    const handler = a.handler['POST /__a/test']
    if (!handler) throw new Error('handler not registered')
    const body = ENCODER.encode(`{"x":"${'a'.repeat(200)}"}`)
    const envelope = await mintEnvelope({ actionId: 'POST /__a/test', body })
    const req = new Request('http://localhost/__a/test', {
      method: 'POST',
      headers: {
        origin: 'http://localhost',
        'x-place-envelope': envelope,
        'content-length': String(body.length),
      },
      body,
    })
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
    }
    expect(res.status).toBe(413)
  })

  test('rejects invalid input (400)', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/typed',
      input: (raw: unknown) => {
        const o = raw as Record<string, unknown>
        if (typeof o['x'] !== 'number') throw new Error('x must be number')
        return o as { x: number }
      },
      sameOrigin: false,
      fn: (input) => input,
    })
    const handler = a.handler['POST /__a/typed']
    if (!handler) throw new Error('handler not registered')
    const body = ENCODER.encode(JSON.stringify({ x: 'not-a-number' }))
    const envelope = await mintEnvelope({ actionId: 'POST /__a/typed', body })
    const req = new Request('http://localhost/__a/typed', {
      method: 'POST',
      headers: { referer: 'http://localhost/', 'x-place-envelope': envelope },
      body,
    })
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
    }
    expect(res.status).toBe(400)
  })
})

describe('criticalAction — audit log integration (Phase 4)', () => {
  test('successful invocation appends ONE audit entry with both payload + result hashes', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/audit-ok',
      input: (raw) => raw as { x: number },
      sameOrigin: false,
      fn: (input) => ({ doubled: input.x * 2 }),
    })
    const handler = a.handler['POST /__a/audit-ok']
    if (!handler) throw new Error('handler not registered')
    const body = ENCODER.encode(JSON.stringify({ x: 21 }))
    const envelope = await mintEnvelope({ actionId: 'POST /__a/audit-ok', body })
    const req = new Request('http://localhost/__a/audit-ok', {
      method: 'POST',
      headers: { referer: 'http://localhost/', 'x-place-envelope': envelope },
      body,
    })
    const auditLog = inMemoryAuditLog()
    const disposeAudit = AuditLogCap.install(auditLog)
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
      disposeAudit()
    }
    expect(res.status).toBe(200)
    const entries = await auditLog.query()
    expect(entries.length).toBe(1)
    expect(entries[0]?.action).toBe('POST /__a/audit-ok')
    expect(entries[0]?.actor).toBe(SESSION.userId)
    expect(entries[0]?.payloadHash.length).toBeGreaterThan(20)
    expect(entries[0]?.resultHash.length).toBeGreaterThan(20)
    // Chain verification: a freshly-installed log must verify ok.
    const verify = await auditLog.verify()
    expect(verify.ok).toBe(true)
  })

  test('handler throw appends a failure entry (action + "#error" suffix)', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/audit-err',
      input: (raw) => raw as object,
      sameOrigin: false,
      fn: () => {
        throw new Error('handler decided to fail')
      },
    })
    const handler = a.handler['POST /__a/audit-err']
    if (!handler) throw new Error('handler not registered')
    const body = ENCODER.encode('{}')
    const envelope = await mintEnvelope({ actionId: 'POST /__a/audit-err', body })
    const req = new Request('http://localhost/__a/audit-err', {
      method: 'POST',
      headers: { referer: 'http://localhost/', 'x-place-envelope': envelope },
      body,
    })
    const auditLog = inMemoryAuditLog()
    const disposeAudit = AuditLogCap.install(auditLog)
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
      disposeAudit()
    }
    expect(res.status).toBe(500)
    const entries = await auditLog.query()
    expect(entries.length).toBe(1)
    expect(entries[0]?.action).toBe('POST /__a/audit-err#error')
    expect(entries[0]?.resultHash).toBe('')
  })

  test('ctx.audit() appends handler-emitted events alongside the auto entry', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/audit-events',
      input: (raw) => raw as object,
      sameOrigin: false,
      fn: async (_input, ctx) => {
        await ctx.audit('fraud_score.high', { score: 0.91, reason: 'velocity' })
        await ctx.audit('kyc.escalated')
        return { ok: true }
      },
    })
    const handler = a.handler['POST /__a/audit-events']
    if (!handler) throw new Error('handler not registered')
    const body = ENCODER.encode('{}')
    const envelope = await mintEnvelope({ actionId: 'POST /__a/audit-events', body })
    const req = new Request('http://localhost/__a/audit-events', {
      method: 'POST',
      headers: { referer: 'http://localhost/', 'x-place-envelope': envelope },
      body,
    })
    const auditLog = inMemoryAuditLog()
    const disposeAudit = AuditLogCap.install(auditLog)
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    try {
      await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
      disposeAudit()
    }
    const entries = await auditLog.query()
    // 2 ctx.audit() events + 1 auto-append on return = 3 entries.
    expect(entries.length).toBe(3)
    expect(entries[0]?.action).toBe('fraud_score.high')
    expect(entries[0]?.payloadHash.length).toBeGreaterThan(20)
    expect(entries[1]?.action).toBe('kyc.escalated')
    expect(entries[1]?.payloadHash).toBe('')
    expect(entries[2]?.action).toBe('POST /__a/audit-events')
    // Chain still intact.
    const verify = await auditLog.verify()
    expect(verify.ok).toBe(true)
  })

  test('failed envelope verification does NOT append to audit (rejection before handler)', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/audit-reject',
      input: (raw) => raw as object,
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/audit-reject']
    if (!handler) throw new Error('handler not registered')
    const body = ENCODER.encode('{}')
    // Mint with wrong session id → rejected as wrong-session.
    const envelope = await mintEnvelope({
      actionId: 'POST /__a/audit-reject',
      body,
      sessionId: 'attacker-session',
    })
    const req = new Request('http://localhost/__a/audit-reject', {
      method: 'POST',
      headers: { referer: 'http://localhost/', 'x-place-envelope': envelope },
      body,
    })
    const auditLog = inMemoryAuditLog()
    const disposeAudit = AuditLogCap.install(auditLog)
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
      disposeAudit()
    }
    expect(res.status).toBe(403)
    // No audit entries — the handler never ran; the framework's
    // automatic append is gated on handler execution. Rejected
    // envelopes are a separate concern (a future "rejected-action"
    // log could capture them if needed).
    expect(await auditLog.size()).toBe(0)
  })
})

describe('provisionActionKey', () => {
  test('returns base64url key + stable keyId + expiresAt + sessionId', async () => {
    installRoot()
    const out = await provisionActionKey('session-abc')
    expect(typeof out.keyBytes).toBe('string')
    expect(out.keyBytes.length).toBeGreaterThan(20)
    expect(out.keyId.startsWith('b')).toBe(true)
    expect(out.expiresAt).toBeGreaterThan(Date.now())
    // sessionId echoed back so the browser binds it into envelopes
    // (instead of reading the HttpOnly auth cookie, which JS can't see).
    expect(out.sessionId).toBe('session-abc')
  })

  test('rejects empty sessionId', async () => {
    installRoot()
    await expect(provisionActionKey('')).rejects.toThrow(/non-empty string/)
  })

  test('throws when no root secret is set', async () => {
    _clearActionRootKey()
    await expect(provisionActionKey('any-session')).rejects.toThrow(/no app secret installed/)
  })

  test('different sessions get different keys', async () => {
    installRoot()
    const a = await provisionActionKey('session-a')
    const b = await provisionActionKey('session-b')
    expect(a.keyBytes).not.toBe(b.keyBytes)
  })

  test('same session + same day → same key (deterministic, multi-node safe)', async () => {
    installRoot()
    const a1 = await provisionActionKey('session-x')
    const a2 = await provisionActionKey('session-x')
    expect(a1.keyBytes).toBe(a2.keyBytes)
    expect(a1.keyId).toBe(a2.keyId)
  })
})

describe('deriveSessionKey', () => {
  test('round-trips with provisionActionKey', async () => {
    installRoot()
    const provisioned = await provisionActionKey('session-roundtrip')
    const { key, keyId } = await deriveSessionKey('session-roundtrip')
    expect(keyId).toBe(provisioned.keyId)
    // The bytes should round-trip via base64url-encoded form.
    const provisionedBytes = decodeBase64url(provisioned.keyBytes)
    expect(bunCryptoProvider.timingSafeEqual(key, provisionedBytes)).toBe(true)
  })
})

describe('criticalAction — perm() + requires (Phase 3)', () => {
  test('perm() rejects empty op', () => {
    expect(() => perm('')).toThrow(/non-empty string/)
  })

  test('perm() returns a typed declaration', () => {
    const p = perm('comments.create')
    expect(p.kind).toBe('perm')
    expect(p.op).toBe('comments.create')
  })

  test('requires + no macaroon header → 403', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/needs-cap',
      input: (raw) => raw as object,
      sameOrigin: false,
      requires: [perm('comments.create')],
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/needs-cap']
    if (!handler) throw new Error('handler not registered')
    const body = ENCODER.encode('{}')
    const envelope = await mintEnvelope({ actionId: 'POST /__a/needs-cap', body })
    const req = new Request('http://localhost/__a/needs-cap', {
      method: 'POST',
      headers: { referer: 'http://localhost/', 'x-place-envelope': envelope },
      body,
    })
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
    }
    expect(res.status).toBe(403)
  })

  test('requires + valid permitting macaroon → 200', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/allowed',
      input: (raw) => raw as object,
      sameOrigin: false,
      requires: [perm('comments.create')],
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/allowed']
    if (!handler) throw new Error('handler not registered')

    const { key: macKey } = await deriveMacaroonKey(SESSION.id)
    const root = await mintMacaroon(macKey, SESSION.id)
    const userMac = await attenuate(root, 'op=comments.*')
    const wire = serializeMacaroon(userMac)

    const body = ENCODER.encode('{}')
    const envelope = await mintEnvelope({ actionId: 'POST /__a/allowed', body })
    const req = new Request('http://localhost/__a/allowed', {
      method: 'POST',
      headers: {
        referer: 'http://localhost/',
        'x-place-envelope': envelope,
        'x-place-macaroon': wire,
      },
      body,
    })
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
    }
    expect(res.status).toBe(200)
  })

  test('requires + macaroon that does NOT cover the op → 403', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/forbidden-op',
      input: (raw) => raw as object,
      sameOrigin: false,
      requires: [perm('admin.delete')],
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/forbidden-op']
    if (!handler) throw new Error('handler not registered')

    const { key: macKey } = await deriveMacaroonKey(SESSION.id)
    const root = await mintMacaroon(macKey, SESSION.id)
    // Holder only has comments.* — not admin.delete.
    const userMac = await attenuate(root, 'op=comments.*')
    const wire = serializeMacaroon(userMac)

    const body = ENCODER.encode('{}')
    const envelope = await mintEnvelope({ actionId: 'POST /__a/forbidden-op', body })
    const req = new Request('http://localhost/__a/forbidden-op', {
      method: 'POST',
      headers: {
        referer: 'http://localhost/',
        'x-place-envelope': envelope,
        'x-place-macaroon': wire,
      },
      body,
    })
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
    }
    expect(res.status).toBe(403)
  })

  test('requires + macaroon signed under DIFFERENT key → 403 (bad-sig)', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/forged',
      input: (raw) => raw as object,
      sameOrigin: false,
      requires: [perm('anything')],
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/forged']
    if (!handler) throw new Error('handler not registered')

    // Attacker mints under a key they control — not the framework's
    // derived macaroon key.
    const attackerKey = ENCODER.encode('attacker-key-not-the-real-one!!!')
    const forged = await mintMacaroon(attackerKey, SESSION.id)
    const wire = serializeMacaroon(forged)

    const body = ENCODER.encode('{}')
    const envelope = await mintEnvelope({ actionId: 'POST /__a/forged', body })
    const req = new Request('http://localhost/__a/forged', {
      method: 'POST',
      headers: {
        referer: 'http://localhost/',
        'x-place-envelope': envelope,
        'x-place-macaroon': wire,
      },
      body,
    })
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
    }
    expect(res.status).toBe(403)
  })

  test('requires + malformed macaroon header → 403', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/malformed-mac',
      input: (raw) => raw as object,
      sameOrigin: false,
      requires: [perm('anything')],
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/malformed-mac']
    if (!handler) throw new Error('handler not registered')

    const body = ENCODER.encode('{}')
    const envelope = await mintEnvelope({ actionId: 'POST /__a/malformed-mac', body })
    const req = new Request('http://localhost/__a/malformed-mac', {
      method: 'POST',
      headers: {
        referer: 'http://localhost/',
        'x-place-envelope': envelope,
        'x-place-macaroon': '!!!not-a-valid-macaroon!!!',
      },
      body,
    })
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
    }
    expect(res.status).toBe(403)
  })

  test('requires with multiple perms — ALL must be covered', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/two-caps',
      input: (raw) => raw as object,
      sameOrigin: false,
      requires: [perm('comments.create'), perm('posts.read')],
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/two-caps']
    if (!handler) throw new Error('handler not registered')

    const { key: macKey } = await deriveMacaroonKey(SESSION.id)
    const root = await mintMacaroon(macKey, SESSION.id)
    // Only comments.* — posts.read is NOT in the macaroon's authority.
    const userMac = await attenuate(root, 'op=comments.*')
    const wire = serializeMacaroon(userMac)

    const body = ENCODER.encode('{}')
    const envelope = await mintEnvelope({ actionId: 'POST /__a/two-caps', body })
    const req = new Request('http://localhost/__a/two-caps', {
      method: 'POST',
      headers: {
        referer: 'http://localhost/',
        'x-place-envelope': envelope,
        'x-place-macaroon': wire,
      },
      body,
    })
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
    }
    expect(res.status).toBe(403)
  })

  test('no requires field → macaroon header ignored', async () => {
    installRoot()
    const a = criticalAction({
      path: 'POST /__a/no-requires',
      input: (raw) => raw as object,
      sameOrigin: false,
      // No `requires:` → envelope-only protection. Stray macaroon
      // headers (e.g. installed for a different action) must NOT
      // fail this request.
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/no-requires']
    if (!handler) throw new Error('handler not registered')

    const body = ENCODER.encode('{}')
    const envelope = await mintEnvelope({ actionId: 'POST /__a/no-requires', body })
    const req = new Request('http://localhost/__a/no-requires', {
      method: 'POST',
      headers: {
        referer: 'http://localhost/',
        'x-place-envelope': envelope,
        'x-place-macaroon': 'garbage-but-ignored',
      },
      body,
    })
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
    }
    expect(res.status).toBe(200)
  })

  test('app: caveat verifier consulted', async () => {
    installRoot()
    let verifierCallCount = 0
    const a = criticalAction({
      path: 'POST /__a/tenant',
      input: (raw) => raw as object,
      sameOrigin: false,
      requires: [perm('records.read')],
      appCaveatVerifier: (key, value) => {
        verifierCallCount++
        return key === 'tenant' && value === 'acme'
      },
      fn: () => ({ ok: true }),
    })
    const handler = a.handler['POST /__a/tenant']
    if (!handler) throw new Error('handler not registered')

    const { key: macKey } = await deriveMacaroonKey(SESSION.id)
    const root = await mintMacaroon(macKey, SESSION.id)
    const scoped = await attenuate(root, 'op=records.*')
    const tenanted = await attenuate(scoped, 'app:tenant=acme')
    const wire = serializeMacaroon(tenanted)

    const body = ENCODER.encode('{}')
    const envelope = await mintEnvelope({ actionId: 'POST /__a/tenant', body })
    const req = new Request('http://localhost/__a/tenant', {
      method: 'POST',
      headers: {
        referer: 'http://localhost/',
        'x-place-envelope': envelope,
        'x-place-macaroon': wire,
      },
      body,
    })
    const disposeNonce = NonceStoreCap.install(inMemoryNonceStore())
    const disposeSession = SessionCap.install(SESSION)
    let res: Response
    try {
      res = await handler(req, {})
    } finally {
      disposeSession()
      disposeNonce()
    }
    expect(res.status).toBe(200)
    // Single perm() in requires → one verify call → verifier consulted once.
    expect(verifierCallCount).toBe(1)
  })
})

describe('provisionMacaroon', () => {
  test('returns a serialisable macaroon + stable keyId + expiresAt', async () => {
    installRoot()
    const out = await provisionMacaroon('session-prov')
    expect(out.macaroon.id).toBe('session-prov')
    expect(out.macaroon.caveats).toEqual([])
    expect(out.keyId.startsWith('b')).toBe(true)
    expect(out.expiresAt).toBeGreaterThan(Date.now())
  })

  test('rejects empty sessionId', async () => {
    installRoot()
    await expect(provisionMacaroon('')).rejects.toThrow(/non-empty string/)
  })

  test('different sessions get different macaroons (different keys)', async () => {
    installRoot()
    const a = await provisionMacaroon('session-a')
    const b = await provisionMacaroon('session-b')
    expect(a.macaroon.sig).not.toBe(b.macaroon.sig)
  })

  test('macaroon key is DOMAIN-SEPARATED from envelope session key', async () => {
    installRoot()
    const { key: envKey } = await deriveSessionKey('session-x')
    const { key: macKey } = await deriveMacaroonKey('session-x')
    // Both derived from the same daily-root + same session id, but
    // different HKDF info strings — bytes must differ.
    expect(bunCryptoProvider.timingSafeEqual(envKey, macKey)).toBe(false)
  })
})

// --- Helpers ---------------------------------------------------------

function decodeBase64url(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
