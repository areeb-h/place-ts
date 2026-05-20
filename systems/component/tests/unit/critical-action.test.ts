// @vitest-environment happy-dom

import {
  AuditLogCap,
  bunCryptoProvider,
  inMemoryAuditLog,
  inMemoryNonceStore,
  NonceStoreCap,
  rotatingKey,
  type Session,
  SessionCap,
  sha256Base64url,
  signEnvelope,
} from '@place/security'
import { beforeEach, describe, expect, test } from 'vitest'
import {
  _clearActionRootKey,
  criticalAction,
  deriveSessionKey,
  provisionActionKey,
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
  test('returns base64url key + stable keyId + expiresAt', async () => {
    installRoot()
    const out = await provisionActionKey('session-abc')
    expect(typeof out.keyBytes).toBe('string')
    expect(out.keyBytes.length).toBeGreaterThan(20)
    expect(out.keyId.startsWith('b')).toBe(true)
    expect(out.expiresAt).toBeGreaterThan(Date.now())
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

// --- Helpers ---------------------------------------------------------

function decodeBase64url(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
