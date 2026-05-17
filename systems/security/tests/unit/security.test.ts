// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { defineCapability } from '../../../capability/src/index.ts'
import {
  CSP_DEFAULTS,
  cspHeader,
  csrfToken,
  parseCookies,
  rateLimit,
  requireSession,
  SecurityError,
  SessionCap,
  setCookieHeader,
  signedToken,
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
