// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { defineCapability } from '../../../capability/src/index.ts'
import {
  type AuditLog,
  AuditLogCap,
  bunCryptoProvider,
  CryptoProviderCap,
  CSP_DEFAULTS,
  canonicalise,
  cspHeader,
  csrfToken,
  type EnvelopeFields,
  GENESIS_HASH,
  inMemoryAuditLog,
  inMemoryNonceStore,
  NonceStoreCap,
  parseCookies,
  rateLimit,
  requireSession,
  rotatingKey,
  SecurityError,
  SessionCap,
  setCookieHeader,
  sha256Base64url,
  signEnvelope,
  signedToken,
  useAuditLog,
  useCryptoProvider,
  useNonceStore,
  verifyEnvelope,
} from '../../src/index.ts'

const SECRET = 'this-is-a-test-secret-32-bytes-long!'

describe('signedToken', () => {
  test('round-trips a payload', async () => {
    const t = signedToken<{ userId: string }>(SECRET)
    const tok = await t.sign({ userId: 'u1' })
    expect(await t.verify(tok)).toEqual({ userId: 'u1' })
  })

  test('rejects tampered payload', async () => {
    const t = signedToken<string>(SECRET)
    const tok = await t.sign('hello')
    // Flip a character in the b64 payload portion.
    const dot = tok.indexOf('.')
    const tampered = `${tok.slice(0, dot - 1)}X${tok.slice(dot)}`
    expect(await t.verify(tampered)).toBeNull()
  })

  test('rejects tampered signature', async () => {
    const t = signedToken<string>(SECRET)
    const tok = await t.sign('hello')
    const tampered = `${tok.slice(0, -1)}X`
    expect(await t.verify(tampered)).toBeNull()
  })

  test('rejects token signed with a different secret', async () => {
    const a = signedToken<string>(SECRET)
    const b = signedToken<string>(`${SECRET}-but-different`)
    const tok = await a.sign('hello')
    expect(await b.verify(tok)).toBeNull()
  })

  test('honors expiresInMs', async () => {
    const t = signedToken<string>(SECRET)
    const tok = await t.sign('expiring', { expiresInMs: 1 })
    await new Promise((r) => setTimeout(r, 5))
    expect(await t.verify(tok)).toBeNull()
  })

  test('returns null for malformed tokens', async () => {
    const t = signedToken<string>(SECRET)
    expect(await t.verify('not-a-token')).toBeNull()
    expect(await t.verify('')).toBeNull()
    expect(await t.verify('only-one-dot.')).toBeNull()
  })

  test('throws on too-short secret', () => {
    expect(() => signedToken('short')).toThrow(/16 characters/)
  })
})

describe('csrfToken', () => {
  test('generate + verify with matching session', async () => {
    const csrf = csrfToken(SECRET)
    const tok = await csrf.generate('session-A')
    expect(await csrf.verify(tok, 'session-A')).toBe(true)
  })

  test('rejects when session id differs', async () => {
    const csrf = csrfToken(SECRET)
    const tok = await csrf.generate('session-A')
    expect(await csrf.verify(tok, 'session-B')).toBe(false)
  })

  test('rejects malformed token', async () => {
    const csrf = csrfToken(SECRET)
    expect(await csrf.verify('garbage', 'session-A')).toBe(false)
  })
})

describe('rateLimit', () => {
  test('allows up to max within the window', () => {
    const rl = rateLimit({ windowMs: 1000, max: 3 })
    expect(rl.check('user')).toBe(true)
    expect(rl.check('user')).toBe(true)
    expect(rl.check('user')).toBe(true)
    expect(rl.check('user')).toBe(false)
  })

  test('separate keys have independent buckets', () => {
    const rl = rateLimit({ windowMs: 1000, max: 1 })
    expect(rl.check('a')).toBe(true)
    expect(rl.check('b')).toBe(true)
    expect(rl.check('a')).toBe(false)
    expect(rl.check('b')).toBe(false)
  })

  test('window resets after the configured duration', async () => {
    const rl = rateLimit({ windowMs: 5, max: 1 })
    expect(rl.check('user')).toBe(true)
    expect(rl.check('user')).toBe(false)
    await new Promise((r) => setTimeout(r, 10))
    expect(rl.check('user')).toBe(true)
  })
})

describe('SessionCap + requireSession', () => {
  test('requireSession throws SecurityError(401) when no session installed', () => {
    expect(() => requireSession()).toThrow(SecurityError)
    try {
      requireSession()
    } catch (e) {
      expect(e).toBeInstanceOf(SecurityError)
      expect((e as SecurityError).status).toBe(401)
    }
  })

  test('requireSession returns the session when one is installed', () => {
    const s = {
      id: 's1',
      userId: 'u1',
      issuedAt: Date.now(),
      expiresAt: null,
    } as const
    const result = SessionCap.provide(s, () => requireSession())
    expect(result).toEqual(s)
  })
})

describe('parseCookies + setCookieHeader', () => {
  test('parseCookies parses a typical Cookie header', () => {
    expect(parseCookies('a=1; b=hello%20world; c=')).toEqual({
      a: '1',
      b: 'hello world',
      c: '',
    })
  })

  test('parseCookies handles null / empty', () => {
    expect(parseCookies(null)).toEqual({})
    expect(parseCookies('')).toEqual({})
    expect(parseCookies(undefined)).toEqual({})
  })

  test('parseCookies skips malformed entries', () => {
    expect(parseCookies('a=1; nokey; b=2')).toEqual({ a: '1', b: '2' })
  })

  test('setCookieHeader is secure by default', () => {
    const h = setCookieHeader('s', 'value')
    expect(h).toContain('HttpOnly')
    expect(h).toContain('SameSite=Lax')
    expect(h).toContain('Secure')
    expect(h).toContain('Path=/')
  })

  test('setCookieHeader URL-encodes the value', () => {
    const h = setCookieHeader('s', 'a value with spaces; and weird=chars')
    expect(h.startsWith('s=')).toBe(true)
    expect(h).toContain('%20')
  })

  test('setCookieHeader honors maxAgeSeconds', () => {
    expect(setCookieHeader('s', 'v', { maxAgeSeconds: 3600 })).toContain('Max-Age=3600')
  })

  test('insecure: true strips the Secure flag for localhost dev', () => {
    const h = setCookieHeader('s', 'v', { insecure: true })
    expect(h).not.toContain('Secure')
    // Other defaults still applied.
    expect(h).toContain('HttpOnly')
    expect(h).toContain('SameSite=Lax')
  })
})

describe('cspHeader', () => {
  test('CSP_DEFAULTS produces a safe header', () => {
    const h = cspHeader(CSP_DEFAULTS)
    expect(h).toContain("default-src 'self'")
    expect(h).toContain("frame-ancestors 'none'")
    expect(h).toContain("object-src 'none'")
    expect(h).not.toContain('unsafe-eval')
    // unsafe-inline is in style-src by necessity (Tailwind / CSS-in-JS);
    // but never in script-src.
    expect(h).not.toContain("script-src 'self' 'unsafe-inline'")
  })

  test('extending CSP via spread', () => {
    const h = cspHeader({
      ...CSP_DEFAULTS,
      'connect-src': "'self' https://api.example.com",
    })
    expect(h).toContain("connect-src 'self' https://api.example.com")
  })
})

describe('integration: SessionCap + capability requires() + SecurityError', () => {
  test('a handler that calls requireSession() throws SecurityError(401) when unauthenticated', () => {
    // Auth-required handler shape — what real route handlers look like.
    const handler = () => {
      const session = requireSession()
      return `hello ${session.userId}`
    }

    // No session installed — security layer throws SecurityError(401).
    expect(() => handler()).toThrow(SecurityError)
    try {
      handler()
    } catch (e) {
      expect((e as SecurityError).status).toBe(401)
    }

    // Session installed properly — handler returns success.
    const goodSession = {
      id: 'sid',
      userId: 'alice',
      issuedAt: Date.now(),
      expiresAt: null,
    } as const
    expect(SessionCap.provide(goodSession, handler)).toBe('hello alice')
  })

  test('SessionCap composes with custom permission caps', () => {
    // Demonstrates the layered authz pattern: session establishes who
    // you are; a separate permission cap establishes what you can do.
    const EditCap = defineCapability<{ canEdit: boolean }>('EditCap')

    const editPost = () => {
      requireSession()
      const perms = EditCap.use()
      if (!perms.canEdit) throw new SecurityError(403, 'forbidden')
      return 'ok'
    }

    const session = {
      id: 'sid',
      userId: 'u',
      issuedAt: Date.now(),
      expiresAt: null,
    } as const

    // With session but read-only — 403.
    expect(() =>
      SessionCap.provide(session, () => EditCap.provide({ canEdit: false }, editPost)),
    ).toThrow(/forbidden/)

    // With session AND edit permission — ok.
    expect(SessionCap.provide(session, () => EditCap.provide({ canEdit: true }, editPost))).toBe(
      'ok',
    )
  })
})

// ===== Phase 1: crypto floor + rotating keys =====

describe('CryptoProvider (Phase 1 — crypto floor)', () => {
  test('bunCryptoProvider satisfies the interface', () => {
    expect(bunCryptoProvider.id).toBe('bun-native')
    expect(bunCryptoProvider.fipsValidated).toBe(false)
    expect(typeof bunCryptoProvider.randomBytes).toBe('function')
    expect(typeof bunCryptoProvider.hmacSha256).toBe('function')
    expect(typeof bunCryptoProvider.timingSafeEqual).toBe('function')
    expect(typeof bunCryptoProvider.hkdfSha256).toBe('function')
  })

  test('randomBytes returns the requested length + non-zero entropy', () => {
    const out = bunCryptoProvider.randomBytes(32)
    expect(out.length).toBe(32)
    // Hopelessly weak entropy check, but it catches a stuck implementation.
    let nonZero = 0
    for (const b of out) if (b !== 0) nonZero++
    expect(nonZero).toBeGreaterThan(16)
  })

  test('hmacSha256 produces a 32-byte tag + same input → same output', async () => {
    const key = new TextEncoder().encode('test-key-at-least-32-bytes-long!!!')
    const msg = new TextEncoder().encode('hello world')
    const t1 = await bunCryptoProvider.hmacSha256(key, msg)
    const t2 = await bunCryptoProvider.hmacSha256(key, msg)
    expect(t1.length).toBe(32)
    expect(bunCryptoProvider.timingSafeEqual(t1, t2)).toBe(true)
  })

  test('hmacSha256 — different keys produce different tags', async () => {
    const k1 = new TextEncoder().encode('key-one-must-be-32-bytes-long!!!!')
    const k2 = new TextEncoder().encode('key-two-must-be-32-bytes-long!!!!')
    const msg = new TextEncoder().encode('same message')
    const t1 = await bunCryptoProvider.hmacSha256(k1, msg)
    const t2 = await bunCryptoProvider.hmacSha256(k2, msg)
    expect(bunCryptoProvider.timingSafeEqual(t1, t2)).toBe(false)
  })

  test('timingSafeEqual on unequal lengths returns false', () => {
    const a = new Uint8Array([1, 2, 3])
    const b = new Uint8Array([1, 2, 3, 4])
    expect(bunCryptoProvider.timingSafeEqual(a, b)).toBe(false)
  })

  test('timingSafeEqual on equal arrays returns true', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5])
    const b = new Uint8Array([1, 2, 3, 4, 5])
    expect(bunCryptoProvider.timingSafeEqual(a, b)).toBe(true)
  })

  test('hkdfSha256 — deterministic + same inputs → same key', async () => {
    const ikm = new TextEncoder().encode('input-key-material-must-be-long!!')
    const salt = new TextEncoder().encode('test-salt')
    const info = new TextEncoder().encode('test-info')
    const k1 = await bunCryptoProvider.hkdfSha256(ikm, salt, info, 32)
    const k2 = await bunCryptoProvider.hkdfSha256(ikm, salt, info, 32)
    expect(k1.length).toBe(32)
    expect(bunCryptoProvider.timingSafeEqual(k1, k2)).toBe(true)
  })

  test('hkdfSha256 — different salts produce different keys', async () => {
    const ikm = new TextEncoder().encode('same-ikm-must-be-at-least-32-bytes')
    const info = new TextEncoder().encode('same-info')
    const k1 = await bunCryptoProvider.hkdfSha256(ikm, new TextEncoder().encode('s1'), info, 32)
    const k2 = await bunCryptoProvider.hkdfSha256(ikm, new TextEncoder().encode('s2'), info, 32)
    expect(bunCryptoProvider.timingSafeEqual(k1, k2)).toBe(false)
  })

  test('useCryptoProvider falls back to bunCryptoProvider when no cap installed', () => {
    expect(useCryptoProvider()).toBe(bunCryptoProvider)
  })

  test('useCryptoProvider returns the installed cap impl', () => {
    const mock: typeof bunCryptoProvider = {
      ...bunCryptoProvider,
      id: 'mock-provider',
      fipsValidated: true,
    }
    CryptoProviderCap.provide(mock, () => {
      expect(useCryptoProvider().id).toBe('mock-provider')
      expect(useCryptoProvider().fipsValidated).toBe(true)
    })
  })
})

describe('rotatingKey — per-day HMAC sub-key derivation', () => {
  test('rejects roots shorter than 32 bytes', () => {
    expect(() => rotatingKey(new Uint8Array(16))).toThrow(/at least 32 bytes/)
  })

  test('keyAt returns a 32-byte sub-key', async () => {
    const root = bunCryptoProvider.randomBytes(32)
    const rk = rotatingKey(root)
    const k = await rk.keyAt(new Date('2026-05-20T12:00:00Z'))
    expect(k.length).toBe(32)
  })

  test('same day → same sub-key (cache hit)', async () => {
    const root = bunCryptoProvider.randomBytes(32)
    const rk = rotatingKey(root)
    const noon = new Date('2026-05-20T12:00:00Z')
    const midnight = new Date('2026-05-20T23:59:59Z')
    const k1 = await rk.keyAt(noon)
    const k2 = await rk.keyAt(midnight)
    expect(bunCryptoProvider.timingSafeEqual(k1, k2)).toBe(true)
  })

  test('different days → different sub-keys', async () => {
    const root = bunCryptoProvider.randomBytes(32)
    const rk = rotatingKey(root)
    const k1 = await rk.keyAt(new Date('2026-05-20T12:00:00Z'))
    const k2 = await rk.keyAt(new Date('2026-05-21T12:00:00Z'))
    expect(bunCryptoProvider.timingSafeEqual(k1, k2)).toBe(false)
  })

  test('keyIdAt is stable per day + differs across days', () => {
    const rk = rotatingKey(bunCryptoProvider.randomBytes(32))
    const id1 = rk.keyIdAt(new Date('2026-05-20T12:00:00Z'))
    const id2 = rk.keyIdAt(new Date('2026-05-20T23:00:00Z'))
    const id3 = rk.keyIdAt(new Date('2026-05-21T01:00:00Z'))
    expect(id1).toBe(id2)
    expect(id1).not.toBe(id3)
  })

  test('custom rotation window (1 hour) produces 24 different keys per day', async () => {
    const root = bunCryptoProvider.randomBytes(32)
    const rk = rotatingKey(root, { rotateEveryMs: 60 * 60 * 1000 })
    const seen = new Set<string>()
    for (let h = 0; h < 24; h++) {
      const at = new Date(`2026-05-20T${String(h).padStart(2, '0')}:30:00Z`)
      seen.add(rk.keyIdAt(at))
    }
    expect(seen.size).toBe(24)
  })

  test('two rotating keys with the same root produce the same sub-keys (deterministic across processes)', async () => {
    const root = new TextEncoder().encode('deterministic-root-32-bytes-long')
    const rkA = rotatingKey(root)
    const rkB = rotatingKey(root)
    const at = new Date('2026-05-20T00:00:00Z')
    const kA = await rkA.keyAt(at)
    const kB = await rkB.keyAt(at)
    expect(bunCryptoProvider.timingSafeEqual(kA, kB)).toBe(true)
  })
})

describe('NonceStore — IPsec-style sliding-window replay defense', () => {
  test('first counter for a session is accepted', async () => {
    const store = inMemoryNonceStore()
    expect(await store.check('s1', 1)).toBe(true)
  })

  test('immediate replay of the same counter is rejected', async () => {
    const store = inMemoryNonceStore()
    expect(await store.check('s1', 5)).toBe(true)
    expect(await store.check('s1', 5)).toBe(false) // replay
  })

  test('strictly-increasing counters all accepted', async () => {
    const store = inMemoryNonceStore()
    for (let i = 1; i <= 100; i++) {
      expect(await store.check('s1', i)).toBe(true)
    }
  })

  test('counter older than window is rejected (stale)', async () => {
    const store = inMemoryNonceStore({ windowSize: 8 })
    await store.check('s1', 100)
    // Window is now [93..100]. Counter 92 is past the left edge.
    expect(await store.check('s1', 92)).toBe(false)
    // Counter 93 is the leftmost in-window slot.
    expect(await store.check('s1', 93)).toBe(true)
    // Counter 92 still rejected (replay AND stale).
    expect(await store.check('s1', 92)).toBe(false)
  })

  test('out-of-order delivery within window is accepted exactly once', async () => {
    const store = inMemoryNonceStore({ windowSize: 64 })
    await store.check('s1', 10)
    // A reordered request for counter 7 arrives — within window.
    expect(await store.check('s1', 7)).toBe(true)
    // A second copy of counter 7 — replay.
    expect(await store.check('s1', 7)).toBe(false)
  })

  test('big jump forward resets the window cleanly', async () => {
    const store = inMemoryNonceStore({ windowSize: 8 })
    await store.check('s1', 5)
    // Jump well beyond W. Window must reset (old bitmap discarded).
    expect(await store.check('s1', 1000)).toBe(true)
    // 5 is now stale (1000 - 5 > 8).
    expect(await store.check('s1', 5)).toBe(false)
    // 1000 replay rejected.
    expect(await store.check('s1', 1000)).toBe(false)
  })

  test('exactly at the window left edge is the LAST accepted', async () => {
    const store = inMemoryNonceStore({ windowSize: 8 })
    await store.check('s1', 100)
    // Window: counters 93..100. 93 is in. 92 is out.
    expect(await store.check('s1', 93)).toBe(true)
    expect(await store.check('s1', 92)).toBe(false)
  })

  test('sessions are independent', async () => {
    const store = inMemoryNonceStore()
    expect(await store.check('s1', 1)).toBe(true)
    // Same counter 1 on a DIFFERENT session: accept.
    expect(await store.check('s2', 1)).toBe(true)
    // Replay on each: rejected.
    expect(await store.check('s1', 1)).toBe(false)
    expect(await store.check('s2', 1)).toBe(false)
  })

  test('forget drops the bitmap so a re-issued session starts fresh', async () => {
    const store = inMemoryNonceStore()
    await store.check('s1', 5)
    expect(await store.size()).toBe(1)
    await store.forget('s1')
    expect(await store.size()).toBe(0)
    // s1 is gone — counter 5 is novel again. (App's session-rotation
    // layer is responsible for not reusing session ids; we just
    // honour forget().)
    expect(await store.check('s1', 5)).toBe(true)
  })

  test('non-integer / negative / infinite counters rejected without state mutation', async () => {
    const store = inMemoryNonceStore()
    expect(await store.check('s1', -1)).toBe(false)
    expect(await store.check('s1', 1.5)).toBe(false)
    expect(await store.check('s1', Number.POSITIVE_INFINITY)).toBe(false)
    expect(await store.check('s1', Number.NaN)).toBe(false)
    expect(await store.size()).toBe(0)
    // Valid counter still works after garbage attempts.
    expect(await store.check('s1', 1)).toBe(true)
  })

  test('windowSize=1 → only most-recent counter accepted; everything older rejected', async () => {
    const store = inMemoryNonceStore({ windowSize: 1 })
    await store.check('s1', 5)
    await store.check('s1', 6)
    expect(await store.check('s1', 5)).toBe(false) // outside window
    expect(await store.check('s1', 6)).toBe(false) // replay
    expect(await store.check('s1', 7)).toBe(true)
  })

  test('windowSize must be 1..256', () => {
    expect(() => inMemoryNonceStore({ windowSize: 0 })).toThrow(/windowSize must be 1..256/)
    expect(() => inMemoryNonceStore({ windowSize: 257 })).toThrow(/windowSize must be 1..256/)
  })

  test('useNonceStore falls back to in-memory singleton when no cap installed', async () => {
    const store = useNonceStore()
    expect(await store.check('test-fallback', 1)).toBe(true)
    // Same store across calls (the fallback is cached so we don't lose state).
    expect(await useNonceStore().check('test-fallback', 1)).toBe(false)
  })

  test('useNonceStore returns the installed cap impl', async () => {
    const mock = inMemoryNonceStore({ windowSize: 8 })
    await NonceStoreCap.provide(mock, async () => {
      const active = useNonceStore()
      expect(active).toBe(mock)
    })
  })
})

describe('HMAC envelope — Phase 2b', () => {
  const KEY = new TextEncoder().encode('test-envelope-key-32-bytes-long!')
  const ORIGIN = 'https://example.com'
  const SESSION = 'session-abc'
  const ACTION = 'POST /__a/createComment'
  const validFields = (overrides: Partial<EnvelopeFields> = {}): EnvelopeFields => ({
    actionId: ACTION,
    bodyHash: 'placeholder-will-be-recomputed',
    counter: 1,
    iat: Math.floor(Date.now() / 1000),
    origin: ORIGIN,
    sessionId: SESSION,
    keyId: 'b20020',
    ...overrides,
  })
  const baseOpts = (
    body: Uint8Array,
  ): Omit<Parameters<typeof verifyEnvelope>[1], 'body'> & {
    body: Uint8Array
  } => ({
    expectedActionId: ACTION,
    expectedOrigin: ORIGIN,
    expectedSessionId: SESSION,
    body,
    key: KEY,
  })

  test('canonicalise is deterministic + field-order-stable', () => {
    const f = validFields()
    const c1 = canonicalise(f)
    const c2 = canonicalise(f)
    expect(c1).toEqual(c2)
    const text = new TextDecoder().decode(c1)
    // Field order is fixed: v, action_id, body_hash, counter, iat, origin, session_id, key_id.
    const lines = text.split('\n')
    expect(lines[0]).toBe('v=1')
    expect(lines[1]?.startsWith('action_id=')).toBe(true)
    expect(lines[2]?.startsWith('body_hash=')).toBe(true)
    expect(lines[3]?.startsWith('counter=')).toBe(true)
    expect(lines[4]?.startsWith('iat=')).toBe(true)
    expect(lines[5]?.startsWith('origin=')).toBe(true)
    expect(lines[6]?.startsWith('session_id=')).toBe(true)
    expect(lines[7]?.startsWith('key_id=')).toBe(true)
  })

  test('round-trip — sign + verify accepts the valid envelope', async () => {
    const body = new TextEncoder().encode('{"comment":"hi"}')
    const bodyHash = await sha256Base64url(body)
    const fields = validFields({ bodyHash })
    const wire = await signEnvelope(KEY, fields)
    const result = await verifyEnvelope(wire, baseOpts(body))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.fields.actionId).toBe(ACTION)
      expect(result.fields.counter).toBe(1)
      expect(result.fields.sessionId).toBe(SESSION)
    }
  })

  test('tampered body is rejected with reason "wrong-body"', async () => {
    const original = new TextEncoder().encode('{"comment":"hi"}')
    const tampered = new TextEncoder().encode('{"comment":"hi!"}') // one byte added
    const bodyHash = await sha256Base64url(original)
    const wire = await signEnvelope(KEY, validFields({ bodyHash }))
    const result = await verifyEnvelope(wire, baseOpts(tampered))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('wrong-body')
  })

  test('tampered envelope tag is rejected with reason "bad-tag"', async () => {
    const body = new TextEncoder().encode('{"x":1}')
    const bodyHash = await sha256Base64url(body)
    const wire = await signEnvelope(KEY, validFields({ bodyHash }))
    // Tag lives after the `.`. Flip a char in the MIDDLE of the tag
    // — flipping the LAST char of a base64url tag only changes 4
    // bits (the other 2 bits are "don't care" padding) and may not
    // actually change the decoded bytes; flipping a middle char
    // unambiguously flips 6 bits.
    const dot = wire.lastIndexOf('.')
    const tagStart = dot + 1
    const midTagIdx = tagStart + 5
    const midChar = wire.charAt(midTagIdx)
    const replaceWith = midChar === 'A' ? 'B' : 'A'
    const tampered = `${wire.slice(0, midTagIdx)}${replaceWith}${wire.slice(midTagIdx + 1)}`
    const result = await verifyEnvelope(tampered, baseOpts(body))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('bad-tag')
  })

  test('wrong key produces "bad-tag" — verifier MUST verify HMAC first', async () => {
    const body = new TextEncoder().encode('{"x":1}')
    const bodyHash = await sha256Base64url(body)
    const wrongKey = new TextEncoder().encode('attacker-key-also-32-bytes-long!')
    const wire = await signEnvelope(wrongKey, validFields({ bodyHash }))
    const result = await verifyEnvelope(wire, baseOpts(body))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('bad-tag')
  })

  test('cross-action confusion — envelope minted for action A rejected as B', async () => {
    const body = new TextEncoder().encode('{"x":1}')
    const bodyHash = await sha256Base64url(body)
    // Mint for action A.
    const wire = await signEnvelope(KEY, validFields({ bodyHash, actionId: 'POST /__a/A' }))
    // Verify as action B.
    const result = await verifyEnvelope(wire, {
      ...baseOpts(body),
      expectedActionId: 'POST /__a/B',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('wrong-action')
  })

  test('cross-origin replay — envelope minted at A rejected at B', async () => {
    const body = new TextEncoder().encode('{"x":1}')
    const bodyHash = await sha256Base64url(body)
    const wire = await signEnvelope(KEY, validFields({ bodyHash, origin: 'https://attacker.test' }))
    const result = await verifyEnvelope(wire, baseOpts(body))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('wrong-origin')
  })

  test('wrong session — envelope minted for user A rejected as user B', async () => {
    const body = new TextEncoder().encode('{"x":1}')
    const bodyHash = await sha256Base64url(body)
    const wire = await signEnvelope(KEY, validFields({ bodyHash, sessionId: 'attacker-session' }))
    const result = await verifyEnvelope(wire, baseOpts(body))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('wrong-session')
  })

  test('stale iat (older than maxAgeSec) is rejected', async () => {
    const body = new TextEncoder().encode('{}')
    const bodyHash = await sha256Base64url(body)
    const ancient = Math.floor(Date.now() / 1000) - 10_000 // ~3h old
    const wire = await signEnvelope(KEY, validFields({ bodyHash, iat: ancient }))
    const result = await verifyEnvelope(wire, baseOpts(body))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('stale-iat')
  })

  test('future iat (clock-forward attack) is rejected', async () => {
    const body = new TextEncoder().encode('{}')
    const bodyHash = await sha256Base64url(body)
    const future = Math.floor(Date.now() / 1000) + 10_000
    const wire = await signEnvelope(KEY, validFields({ bodyHash, iat: future }))
    const result = await verifyEnvelope(wire, baseOpts(body))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('future-iat')
  })

  test('malformed wire (no dot) is rejected', async () => {
    const body = new TextEncoder().encode('{}')
    const result = await verifyEnvelope('garbage', baseOpts(body))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('malformed')
  })

  test('malformed wire (bad base64) is rejected', async () => {
    const body = new TextEncoder().encode('{}')
    const result = await verifyEnvelope('!!!.!!!', baseOpts(body))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('malformed')
  })

  test('canonical form is HMAC-tagged + can be inspected by base64url-decode', async () => {
    const body = new TextEncoder().encode('{}')
    const bodyHash = await sha256Base64url(body)
    const wire = await signEnvelope(KEY, validFields({ bodyHash }))
    // The canonical half is base64url; should decode to readable text.
    const [canonicalB64] = wire.split('.')
    expect(canonicalB64).toBeDefined()
    const pad = (4 - ((canonicalB64 as string).length % 4)) % 4
    const b64 = (canonicalB64 as string).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad)
    const decoded = atob(b64)
    expect(decoded.includes('action_id=')).toBe(true)
    expect(decoded.includes(`"${ACTION}"`)).toBe(true)
  })

  test('canonicalisation is JSON-string-encoded — embedded newlines in fields cannot inject extra lines', () => {
    const malicious = validFields({
      actionId: 'fake\naction_id="real-action"', // attacker tries to inject a line
    })
    const canonical = canonicalise(malicious)
    const text = new TextDecoder().decode(canonical)
    // The injected `action_id=...` MUST NOT appear as a parseable
    // line; the `\n` should be JSON-escaped inside the action_id
    // value, so the actionId line is still ONE line.
    const lines = text.split('\n')
    // Exactly one line starts with `action_id=`.
    expect(lines.filter((l) => l.startsWith('action_id=')).length).toBe(1)
    // The actionId line contains the escaped form, not a raw newline.
    expect(lines[1]).toContain('\\n')
  })
})

describe('Audit log — Phase 4', () => {
  const SAMPLE = {
    actor: 'user-alice',
    action: 'POST /__a/createComment',
    payloadHash: 'fake-payload-hash',
    resultHash: 'fake-result-hash',
    keyId: 'b20020',
  }

  test('inMemoryAuditLog: first append starts the chain at GENESIS_HASH', async () => {
    const log = inMemoryAuditLog()
    expect(await log.tip()).toBe(0)
    expect(await log.tipHash()).toBe(GENESIS_HASH)
    const entry = await log.append(SAMPLE)
    expect(entry.seq).toBe(1)
    expect(entry.prevHash).toBe(GENESIS_HASH)
    expect(entry.hash.length).toBeGreaterThan(20)
    expect(entry.actor).toBe('user-alice')
  })

  test('appends form a hash chain — each prev_hash matches the prior hash', async () => {
    const log = inMemoryAuditLog()
    const e1 = await log.append(SAMPLE)
    const e2 = await log.append(SAMPLE)
    const e3 = await log.append(SAMPLE)
    expect(e1.prevHash).toBe(GENESIS_HASH)
    expect(e2.prevHash).toBe(e1.hash)
    expect(e3.prevHash).toBe(e2.hash)
    // Hashes must differ even though the input is identical — the
    // seq + ts + prev_hash fields are distinct per entry.
    expect(e1.hash).not.toBe(e2.hash)
    expect(e2.hash).not.toBe(e3.hash)
  })

  test('verify() returns ok on an untampered chain', async () => {
    const log = inMemoryAuditLog()
    for (let i = 0; i < 5; i++) await log.append(SAMPLE)
    const result = await log.verify()
    expect(result.ok).toBe(true)
  })

  test('verify() detects a tampered prev_hash field (hash-mismatch)', async () => {
    const log = inMemoryAuditLog()
    for (let i = 0; i < 5; i++) await log.append(SAMPLE)
    // Reach into the in-memory entries + corrupt one. The canonical
    // bytes still match the hash field on THAT entry (we didn't change
    // either), but the NEXT entry's prev_hash references the OLD
    // hash. Easier: corrupt the `canonical` so recompute fails.
    const all = await log.query()
    const target = all[2]
    if (!target)
      throw new Error('expected 5 entries')
      // Hack: cast away readonly to mutate the in-memory record. In a
      // real attack, an attacker with write access to the store would
      // do this.
    ;(target as unknown as { canonical: string }).canonical = target.canonical.replace(
      'user-alice',
      'user-evil',
    )
    const result = await log.verify()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.brokenAt).toBe(3) // seq 3 = the corrupted entry
      expect(result.reason).toBe('hash-mismatch')
    }
  })

  test('verify() detects a broken prev-link (missing-prev)', async () => {
    const log = inMemoryAuditLog()
    for (let i = 0; i < 5; i++) await log.append(SAMPLE)
    const all = await log.query()
    const target = all[2]
    if (!target)
      throw new Error('expected 5 entries')
      // Forge the prev_hash to something that doesn't match the prior
      // entry's hash. The canonical line + its hash field still match
      // each other (no `hash-mismatch`), but the chain link is broken.
    ;(target as unknown as { prevHash: string }).prevHash = 'forged-prev-hash'
    const result = await log.verify()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.brokenAt).toBe(3)
      expect(result.reason).toBe('missing-prev')
    }
  })

  test('query(from, to) returns the inclusive slice', async () => {
    const log = inMemoryAuditLog()
    for (let i = 0; i < 10; i++) await log.append(SAMPLE)
    const window = await log.query(3, 7)
    expect(window.length).toBe(5)
    expect(window[0]?.seq).toBe(3)
    expect(window[4]?.seq).toBe(7)
  })

  test('query() with no args returns all retained entries', async () => {
    const log = inMemoryAuditLog()
    for (let i = 0; i < 3; i++) await log.append(SAMPLE)
    const all = await log.query()
    expect(all.length).toBe(3)
  })

  test('ring-buffer eviction: maxEntries=3 drops oldest after 4th append', async () => {
    const log = inMemoryAuditLog({ maxEntries: 3 })
    const e1 = await log.append(SAMPLE)
    const e2 = await log.append(SAMPLE)
    const e3 = await log.append(SAMPLE)
    const e4 = await log.append(SAMPLE)
    expect(await log.size()).toBe(3)
    const remaining = await log.query()
    expect(remaining[0]?.seq).toBe(2) // e1 evicted
    expect(remaining[2]?.seq).toBe(4)
    void e1
    void e2
    void e3
    void e4
  })

  test('tip + tipHash reflect the most recent entry', async () => {
    const log = inMemoryAuditLog()
    await log.append(SAMPLE)
    const e2 = await log.append(SAMPLE)
    expect(await log.tip()).toBe(2)
    expect(await log.tipHash()).toBe(e2.hash)
  })

  test('reset() clears entries + resets the seq counter to 1', async () => {
    const log = inMemoryAuditLog()
    for (let i = 0; i < 5; i++) await log.append(SAMPLE)
    await log.reset()
    expect(await log.size()).toBe(0)
    expect(await log.tip()).toBe(0)
    expect(await log.tipHash()).toBe(GENESIS_HASH)
    const fresh = await log.append(SAMPLE)
    expect(fresh.seq).toBe(1)
    expect(fresh.prevHash).toBe(GENESIS_HASH)
  })

  test('verify() across the ring boundary works for the retained window', async () => {
    // After eviction, the first retained entry has prev_hash =
    // the EVICTED entry's hash. The chain is still internally valid
    // for the retained slice — verify() walks from the retained
    // first entry, using its own prev_hash as the starting baseline.
    const log = inMemoryAuditLog({ maxEntries: 3 })
    for (let i = 0; i < 5; i++) await log.append(SAMPLE)
    const result = await log.verify()
    expect(result.ok).toBe(true)
  })

  test('rejects maxEntries < 1', () => {
    expect(() => inMemoryAuditLog({ maxEntries: 0 })).toThrow(/maxEntries must be/)
  })

  test('useAuditLog falls back to a process-wide singleton when no cap installed', async () => {
    const log = useAuditLog()
    const sizeBefore = await log.size()
    await log.append({ ...SAMPLE, actor: 'fallback-singleton-check' })
    const log2 = useAuditLog()
    expect(await log2.size()).toBe(sizeBefore + 1)
  })

  test('useAuditLog returns the installed cap impl', async () => {
    const mock = inMemoryAuditLog({ maxEntries: 5 })
    const dispose = AuditLogCap.install(mock)
    try {
      expect(useAuditLog()).toBe(mock)
    } finally {
      dispose()
    }
  })

  test('canonical entry encoding: JSON-string-encoded values resist injection', async () => {
    const log = inMemoryAuditLog()
    // Try to smuggle a fake line via an embedded newline in `action`.
    const malicious: typeof SAMPLE = {
      ...SAMPLE,
      action: 'bad\nseq=99\nactor=fake',
    }
    const entry = await log.append(malicious)
    // The action line still appears as ONE line in the canonical
    // form; the `\n` is JSON-escaped to `\\n` inside the JSON-encoded
    // value.
    const actionLines = entry.canonical.split('\n').filter((l) => l.startsWith('action='))
    expect(actionLines.length).toBe(1)
    expect(actionLines[0]).toContain('\\n')
  })

  test('two logs with same input produce different hashes (ts is bound)', async () => {
    const log1 = inMemoryAuditLog()
    const log2 = inMemoryAuditLog()
    const e1 = await log1.append(SAMPLE)
    // Sleep so the ts differs.
    await new Promise((r) => setTimeout(r, 2))
    const e2 = await log2.append(SAMPLE)
    expect(e1.hash).not.toBe(e2.hash)
  })

  test('verify(from, to) partial range works', async () => {
    const log = inMemoryAuditLog()
    for (let i = 0; i < 10; i++) await log.append(SAMPLE)
    const result = await log.verify(3, 7)
    expect(result.ok).toBe(true)
  })

  test('AuditLog type matches the interface contract', async () => {
    const log: AuditLog = inMemoryAuditLog()
    expect(typeof log.append).toBe('function')
    expect(typeof log.query).toBe('function')
    expect(typeof log.size).toBe('function')
    expect(typeof log.tip).toBe('function')
    expect(typeof log.tipHash).toBe('function')
    expect(typeof log.verify).toBe('function')
    expect(typeof log.reset).toBe('function')
  })
})
