// @vitest-environment happy-dom
//
// Macaroon primitive tests — covers the HMAC chain, caveat grammar,
// op-intersection semantics, signature tamper resistance, and the
// fail-closed behaviour for unknown / app: caveats without a verifier.

import { describe, expect, test } from 'vitest'
import {
  attenuate,
  deserializeMacaroon,
  mintMacaroon,
  serializeMacaroon,
  verifyMacaroon,
} from '../../src/macaroon.ts'

const enc = new TextEncoder()
const rootKey = enc.encode('this-is-a-test-root-key-32-bytes!')
const otherKey = enc.encode('this-is-a-different-root-32-byte!')
const SID = 'session-abc'
const ORIGIN = 'https://place-ts.pages.dev'

describe('mintMacaroon', () => {
  test('produces a macaroon with id, empty caveats, and a tag', async () => {
    const m = await mintMacaroon(rootKey, SID)
    expect(m.id).toBe(SID)
    expect(m.caveats).toEqual([])
    expect(m.sig.length).toBeGreaterThan(0)
  })

  test('different ids produce different sigs', async () => {
    const a = await mintMacaroon(rootKey, 'a')
    const b = await mintMacaroon(rootKey, 'b')
    expect(a.sig).not.toBe(b.sig)
  })

  test('different roots produce different sigs', async () => {
    const a = await mintMacaroon(rootKey, SID)
    const b = await mintMacaroon(otherKey, SID)
    expect(a.sig).not.toBe(b.sig)
  })

  test('rejects empty id', async () => {
    await expect(mintMacaroon(rootKey, '')).rejects.toThrow(/id must be/)
  })
})

describe('attenuate', () => {
  test('chains caveats and produces a new tag each step', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m1 = await attenuate(m0, 'op=comments.*')
    const m2 = await attenuate(m1, 'expires=2030-01-01T00:00:00Z')
    expect(m1.caveats).toEqual(['op=comments.*'])
    expect(m2.caveats).toEqual(['op=comments.*', 'expires=2030-01-01T00:00:00Z'])
    expect(m1.sig).not.toBe(m0.sig)
    expect(m2.sig).not.toBe(m1.sig)
  })

  test('rejects empty caveat', async () => {
    const m = await mintMacaroon(rootKey, SID)
    await expect(attenuate(m, '')).rejects.toThrow(/non-empty|must be/)
  })

  test('rejects caveat with embedded newline', async () => {
    const m = await mintMacaroon(rootKey, SID)
    await expect(attenuate(m, 'op=foo\nsig=injected')).rejects.toThrow(/newline/)
  })
})

describe('serialize / deserialize', () => {
  test('round-trips a multi-caveat macaroon', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m1 = await attenuate(m0, 'op=comments.*')
    const m2 = await attenuate(m1, `origin=${ORIGIN}`)
    const wire = serializeMacaroon(m2)
    const restored = deserializeMacaroon(wire)
    expect(restored).toEqual(m2)
  })

  test('rejects malformed wire (not base64url)', () => {
    expect(() => deserializeMacaroon('!!!not-base64!!!')).toThrow()
  })
})

describe('verifyMacaroon — signature', () => {
  test('accepts a freshly-minted macaroon under its root key', async () => {
    const m = await mintMacaroon(rootKey, SID)
    const r = await verifyMacaroon(m, rootKey, { op: 'anything', origin: ORIGIN })
    expect(r.ok).toBe(true)
  })

  test('rejects when verified under a different root key', async () => {
    const m = await mintMacaroon(rootKey, SID)
    const r = await verifyMacaroon(m, otherKey, { op: 'x', origin: ORIGIN })
    expect(r).toEqual({ ok: false, reason: 'bad-sig', caveatIndex: -1 })
  })

  test('rejects when the tag has been tampered with', async () => {
    const m = await mintMacaroon(rootKey, SID)
    const tampered = { ...m, sig: `${m.sig.slice(0, -2)}AA` }
    const r = await verifyMacaroon(tampered, rootKey, { op: 'x', origin: ORIGIN })
    expect(r.ok).toBe(false)
  })

  test('rejects when a caveat has been added without re-signing', async () => {
    const m = await mintMacaroon(rootKey, SID)
    const forged = { ...m, caveats: ['op=admin.*'] }
    const r = await verifyMacaroon(forged, rootKey, { op: 'admin.users.read', origin: ORIGIN })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('bad-sig')
  })

  test('attenuated chain still verifies under root', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m1 = await attenuate(m0, 'op=comments.*')
    const m2 = await attenuate(m1, 'op=comments.create')
    const r = await verifyMacaroon(m2, rootKey, { op: 'comments.create', origin: ORIGIN })
    expect(r.ok).toBe(true)
  })
})

describe('verifyMacaroon — op restrictions', () => {
  test('no op= caveats means any op is permitted', async () => {
    const m = await mintMacaroon(rootKey, SID)
    const r = await verifyMacaroon(m, rootKey, { op: 'anything.goes', origin: ORIGIN })
    expect(r.ok).toBe(true)
  })

  test('op=foo.* permits foo.bar but not bar.baz', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m = await attenuate(m0, 'op=comments.*')
    const ok = await verifyMacaroon(m, rootKey, { op: 'comments.create', origin: ORIGIN })
    expect(ok.ok).toBe(true)
    const bad = await verifyMacaroon(m, rootKey, { op: 'posts.create', origin: ORIGIN })
    expect(bad.ok).toBe(false)
    expect((bad as { reason: string }).reason).toBe('wrong-op')
  })

  test('exact op= permits only that op', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m = await attenuate(m0, 'op=comments.create')
    const ok = await verifyMacaroon(m, rootKey, { op: 'comments.create', origin: ORIGIN })
    expect(ok.ok).toBe(true)
    const bad = await verifyMacaroon(m, rootKey, { op: 'comments.delete', origin: ORIGIN })
    expect(bad.ok).toBe(false)
  })

  test('op=* permits anything', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m = await attenuate(m0, 'op=*')
    const r = await verifyMacaroon(m, rootKey, { op: 'whatever.you.want', origin: ORIGIN })
    expect(r.ok).toBe(true)
  })

  test('multiple op= caveats compose by intersection', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m1 = await attenuate(m0, 'op=admin.*')
    const m2 = await attenuate(m1, 'op=admin.users.*')
    const m3 = await attenuate(m2, 'op=admin.users.create')
    // Only the intersection is permitted.
    expect(
      (await verifyMacaroon(m3, rootKey, { op: 'admin.users.create', origin: ORIGIN })).ok,
    ).toBe(true)
    expect((await verifyMacaroon(m3, rootKey, { op: 'admin.users.delete', origin: ORIGIN })).ok).toBe(
      false,
    )
    expect((await verifyMacaroon(m3, rootKey, { op: 'admin.tenants.read', origin: ORIGIN })).ok).toBe(
      false,
    )
  })

  test('intersection order doesn’t matter', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    // Wide-then-narrow ordering
    const a = await attenuate(await attenuate(m0, 'op=*'), 'op=foo.bar')
    // Narrow-then-wide ordering — sig differs but the op-restrictions
    // accumulate to the same SET, so semantics match.
    const b = await attenuate(await attenuate(m0, 'op=foo.bar'), 'op=*')
    expect((await verifyMacaroon(a, rootKey, { op: 'foo.bar', origin: ORIGIN })).ok).toBe(true)
    expect((await verifyMacaroon(b, rootKey, { op: 'foo.bar', origin: ORIGIN })).ok).toBe(true)
    expect((await verifyMacaroon(a, rootKey, { op: 'foo.baz', origin: ORIGIN })).ok).toBe(false)
    expect((await verifyMacaroon(b, rootKey, { op: 'foo.baz', origin: ORIGIN })).ok).toBe(false)
  })
})

describe('verifyMacaroon — expires', () => {
  test('rejects an expired macaroon', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m = await attenuate(m0, 'expires=2000-01-01T00:00:00Z')
    const r = await verifyMacaroon(m, rootKey, { op: 'x', origin: ORIGIN, now: Date.now() })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('expired')
  })

  test('accepts a not-yet-expired macaroon', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const future = new Date(Date.now() + 60_000).toISOString()
    const m = await attenuate(m0, `expires=${future}`)
    const r = await verifyMacaroon(m, rootKey, { op: 'x', origin: ORIGIN })
    expect(r.ok).toBe(true)
  })

  test('rejects malformed expires value', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m = await attenuate(m0, 'expires=not-a-date')
    const r = await verifyMacaroon(m, rootKey, { op: 'x', origin: ORIGIN })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('malformed')
  })

  test('rejects non-ISO-8601 expires forms even when Date.parse would accept them', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    // Forms `Date.parse` accepts but our grammar pins out — locale
    // ambiguous, missing timezone, slash separator. Lock the wire so
    // a macaroon's expiry is binary-identical across nodes.
    const nonIso = ['5/21/2030', '2030/05/21', '2030-05-21', '2030-05-21T00:00:00', '2030-05-21 00:00:00Z']
    for (const value of nonIso) {
      const m = await attenuate(m0, `expires=${value}`)
      const r = await verifyMacaroon(m, rootKey, { op: 'x', origin: ORIGIN })
      expect(r.ok).toBe(false)
      expect((r as { reason: string }).reason).toBe('malformed')
    }
  })
})

describe('verifyMacaroon — origin', () => {
  test('matching origin accepted', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m = await attenuate(m0, `origin=${ORIGIN}`)
    const r = await verifyMacaroon(m, rootKey, { op: 'x', origin: ORIGIN })
    expect(r.ok).toBe(true)
  })

  test('mismatched origin rejected', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m = await attenuate(m0, `origin=${ORIGIN}`)
    const r = await verifyMacaroon(m, rootKey, { op: 'x', origin: 'https://evil.example' })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('wrong-origin')
  })
})

describe('verifyMacaroon — app: caveats', () => {
  test('fails closed when app: caveat is present but no verifier installed', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m = await attenuate(m0, 'app:tenant=acme')
    const r = await verifyMacaroon(m, rootKey, { op: 'x', origin: ORIGIN })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('unknown-caveat')
  })

  test('passes when verifier returns true', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m = await attenuate(m0, 'app:tenant=acme')
    const r = await verifyMacaroon(m, rootKey, {
      op: 'x',
      origin: ORIGIN,
      appVerifier: (k, v) => k === 'tenant' && v === 'acme',
    })
    expect(r.ok).toBe(true)
  })

  test('rejects when verifier returns false', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m = await attenuate(m0, 'app:tenant=acme')
    const r = await verifyMacaroon(m, rootKey, {
      op: 'x',
      origin: ORIGIN,
      appVerifier: () => false,
    })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('app-denied')
  })

  test('async verifier honoured', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m = await attenuate(m0, 'app:tenant=acme')
    const r = await verifyMacaroon(m, rootKey, {
      op: 'x',
      origin: ORIGIN,
      appVerifier: async (k, v) => Promise.resolve(k === 'tenant' && v === 'acme'),
    })
    expect(r.ok).toBe(true)
  })
})

describe('verifyMacaroon — unknown caveats', () => {
  test('rejects any caveat the verifier doesn’t understand', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m = await attenuate(m0, 'made-up-key=value')
    const r = await verifyMacaroon(m, rootKey, { op: 'x', origin: ORIGIN })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('unknown-caveat')
  })

  test('rejects malformed caveat with no =', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const m = await attenuate(m0, 'no-equal-sign')
    const r = await verifyMacaroon(m, rootKey, { op: 'x', origin: ORIGIN })
    expect(r.ok).toBe(false)
    expect((r as { reason: string }).reason).toBe('malformed')
  })
})

describe('attenuation cannot widen authority', () => {
  test('a holder cannot remove a caveat — that would re-mint, which needs the root key', async () => {
    const m0 = await mintMacaroon(rootKey, SID)
    const narrow = await attenuate(m0, 'op=comments.read')
    // Try to "widen" by dropping the caveat. We don't have the root,
    // so the only thing we can do is build a NEW macaroon by attenuating
    // — but that adds caveats, never removes them.
    const stillNarrow = await attenuate(narrow, 'op=*')
    // Intersection of comments.read + * = comments.read; still narrow.
    const ok = await verifyMacaroon(stillNarrow, rootKey, {
      op: 'comments.read',
      origin: ORIGIN,
    })
    expect(ok.ok).toBe(true)
    const stillRejected = await verifyMacaroon(stillNarrow, rootKey, {
      op: 'comments.write',
      origin: ORIGIN,
    })
    expect(stillRejected.ok).toBe(false)
  })
})
