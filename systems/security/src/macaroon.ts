// Macaroons — HMAC-chained bearer tokens with attenuating caveats.
//
// Per the Stanford/Google macaroons paper. A macaroon is a bearer
// token of the form:
//
//   id: <stable identifier; we use the session id>
//   caveats: [c_1, c_2, …, c_n]   // each NARROWS the authority
//   sig: HMAC chained over (id, c_1, c_2, …, c_n)
//
// The signature chain:
//
//   m_0 = HMAC(rootKey, id)
//   m_i = HMAC(m_{i-1}, c_i)
//   sig = m_n
//
// **Attenuation, not amplification.** Each caveat NARROWS the
// token's authority. Adding `op=comments.create` to a token that
// previously had `op=comments.*` keeps it valid for
// `comments.create` and rejects `comments.delete`. An attacker who
// captures a token can attenuate it further (the chain extends —
// new HMAC keyed on the existing tag) but cannot widen it (they
// don't have the root key to forge a shorter chain).
//
// **Why macaroons instead of `Session.can()` predicates:**
//
//   - Predicates are sync, in-process, and tied to the session
//     object's state. They authorize at one point in time +
//     against one logical context.
//   - Macaroons are TOKENS. They carry their authority WITH the
//     request — so a sub-system handling part of the work doesn't
//     need to re-fetch the session + recompute permissions; it
//     trusts the (attenuated) macaroon it was handed.
//   - Macaroons SCALE structurally. A login flow mints a macaroon
//     for the user; a delegation flow attenuates it to a narrower
//     scope before passing to a sub-service; the receiving service
//     verifies once + acts. No central authorization service in
//     the request path.
//   - The two compose: `<Can>` (predicate-based UI gating) +
//     macaroon (request-time authorization). One is UI hint, one
//     is structural enforcement.
//
// **Caveat grammar** (fixed in v0.1):
//
//   expires=<ISO-8601 UTC>     // "expires=2026-05-21T00:00:00Z"
//   origin=<URL>                // "origin=https://place-ts.pages.dev"
//   op=<name>                   // "op=comments.create"
//   op=<name>.*                 // "op=admin.*" — prefix match
//   app:<key>=<value>           // "app:tenant=acme" — app-verified
//
// Unknown caveats are REJECTED — fail-closed. App-defined caveats
// MUST use the `app:` prefix so the framework can dispatch them to
// the registered verifier.
//
// **op= semantics:** multiple `op=` caveats compose by intersection.
// `op=admin.*` then `op=admin.users.*` then `op=admin.users.create`
// = exactly `admin.users.create`. Order doesn't matter; the
// intersection is order-free.
//
// **Standards:**
//
//   - Charter NN#4 (typed effects → typed authorization)
//   - OWASP ASVS 5.0 V13 (API/RPC authorization)
//   - Stanford / Google "Macaroons: Cookies with Contextual
//     Caveats for Decentralized Authorization in the Cloud" (2014)
//
// **Performance:**
//
//   - Mint: 1 HMAC. ~3 µs.
//   - Attenuate: 1 HMAC. ~3 µs.
//   - Verify (3 caveats): 3 HMACs + caveat checks ≈ 9 µs.
//
// Less than the envelope cost (Phase 2 envelope is ~5 µs); the
// macaroon adds ~10 µs total to a request whose actual work is
// typically 1–10 ms.

import { bunCryptoProvider, type CryptoProvider, useCryptoProvider } from './index.ts'

const enc = new TextEncoder()
const dec = new TextDecoder()

// ISO-8601 UTC: `YYYY-MM-DDTHH:MM:SS[.fff]Z`. Anchored both ends so
// stray prefix/suffix bytes don't sneak past. `expires=` caveats MUST
// use this canonical form — see verifyMacaroon for why.
const ISO_8601_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

/** A macaroon ready for verification or attenuation. */
export interface Macaroon {
  /** Stable identifier. v0.1: the session id. */
  readonly id: string
  /** Caveat texts in chain order (oldest first). */
  readonly caveats: readonly string[]
  /** Final HMAC tag, base64url. */
  readonly sig: string
}

/**
 * Mint a fresh macaroon with no caveats. The token authorises any
 * operation; callers attenuate via {@link attenuate} before
 * issuance.
 */
export async function mintMacaroon(
  rootKey: Uint8Array,
  id: string,
  provider: CryptoProvider = useCryptoProvider(),
): Promise<Macaroon> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('mintMacaroon: id must be a non-empty string')
  }
  const tag = await provider.hmacSha256(rootKey, enc.encode(id))
  return { id, caveats: [], sig: base64urlEncode(tag) }
}

/**
 * Add a caveat to an existing macaroon. The caveat text is
 * HMAC-chained onto the current signature, producing a new
 * macaroon that's STRICTLY MORE RESTRICTIVE. Attenuation only —
 * the chain cannot remove existing caveats nor widen the
 * authority.
 *
 * Anyone holding a macaroon can attenuate it without the root
 * key — the HMAC step uses the EXISTING signature as the key.
 * This is the "decentralized" part: a service can narrow a
 * received token before passing it to a sub-service.
 */
export async function attenuate(
  m: Macaroon,
  caveat: string,
  provider: CryptoProvider = useCryptoProvider(),
): Promise<Macaroon> {
  if (typeof caveat !== 'string' || caveat.length === 0) {
    throw new Error('attenuate: caveat must be a non-empty string')
  }
  // Reject embedded newlines — they would break the canonical wire
  // format on serialise.
  if (caveat.includes('\n')) {
    throw new Error('attenuate: caveat must not contain newline')
  }
  const prevTag = base64urlDecode(m.sig)
  const newTag = await provider.hmacSha256(prevTag, enc.encode(caveat))
  return {
    id: m.id,
    caveats: [...m.caveats, caveat],
    sig: base64urlEncode(newTag),
  }
}

/**
 * Serialise to a single-line wire string. Newline-delimited within
 * the JSON-encoded shape so embedded `\n` in caveats (rejected by
 * `attenuate`) can't smuggle structure.
 *
 * Wire format:
 *   <base64url(canonical-bytes)>
 *
 * The canonical bytes are:
 *   v=1
 *   id=<JSON-string>
 *   c=<JSON-string>            // one per caveat
 *   c=<JSON-string>
 *   sig=<base64url(tag)>
 *
 * Wrapping the whole thing in one outer base64url makes the
 * macaroon header-safe (no whitespace, no newlines, no quoting
 * issues with HTTP header parsers).
 */
export function serializeMacaroon(m: Macaroon): string {
  const lines = [
    'v=1',
    `id=${JSON.stringify(m.id)}`,
    ...m.caveats.map((c) => `c=${JSON.stringify(c)}`),
    `sig=${m.sig}`,
    '',
  ]
  return base64urlEncode(enc.encode(lines.join('\n')))
}

/** Inverse of {@link serializeMacaroon}. Throws on malformed wire. */
export function deserializeMacaroon(wire: string): Macaroon {
  let canonicalBytes: Uint8Array
  try {
    canonicalBytes = base64urlDecode(wire)
  } catch {
    throw new Error('deserializeMacaroon: malformed base64url')
  }
  const text = dec.decode(canonicalBytes)
  const lines = text.split('\n')
  if (lines[0] !== 'v=1') throw new Error('deserializeMacaroon: unsupported version')
  let id: string | null = null
  let sig: string | null = null
  const caveats: string[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (line === '') continue
    if (line.startsWith('id=')) {
      id = JSON.parse(line.slice(3)) as string
    } else if (line.startsWith('c=')) {
      caveats.push(JSON.parse(line.slice(2)) as string)
    } else if (line.startsWith('sig=')) {
      sig = line.slice(4)
    } else {
      throw new Error(`deserializeMacaroon: unknown field ${line.split('=')[0]}`)
    }
  }
  if (id === null || sig === null) {
    throw new Error('deserializeMacaroon: missing id or sig')
  }
  return { id, caveats, sig }
}

// ===== Verification =====

/** Context the verifier checks each caveat against. */
export interface MacaroonVerifyContext {
  /** The operation the current request needs (e.g. "comments.create"). */
  readonly op: string
  /** Request origin (e.g. "https://place-ts.pages.dev"). */
  readonly origin: string
  /** "Now" in milliseconds since epoch. Defaults to `Date.now()`. */
  readonly now?: number
  /**
   * App-defined caveat verifier. Called for any `app:<key>=<value>`
   * caveat. Return `true` to permit the caveat under this context;
   * `false` to reject. Async permitted but adds latency to every
   * macaroon verify call — keep it fast.
   */
  readonly appVerifier?: (
    key: string,
    value: string,
    ctx: MacaroonVerifyContext,
  ) => boolean | Promise<boolean>
}

/** Result of {@link verifyMacaroon}. Typed rejection reasons let
 *  the framework log specific failures while still mapping all
 *  rejections to 403 on the wire (no info-leak oracle). */
export type MacaroonVerifyResult =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'bad-sig'
        | 'malformed'
        | 'unknown-caveat'
        | 'expired'
        | 'wrong-op'
        | 'wrong-origin'
        | 'app-denied'
      /** Index of the failing caveat (for typed-reason logging),
       *  -1 for bad-sig / malformed. */
      caveatIndex?: number
    }

/**
 * Verify a macaroon under `rootKey` and check all caveats against
 * `ctx`. Walks the chain forward computing the expected signature;
 * then walks the caveats checking each constraint.
 *
 * Signature check is constant-time (`provider.timingSafeEqual`).
 *
 * Cost: ~3 µs per caveat for the chain compute, ~negligible for
 * the caveat checks (string compare, time compare, app-verifier).
 */
export async function verifyMacaroon(
  m: Macaroon,
  rootKey: Uint8Array,
  ctx: MacaroonVerifyContext,
  provider: CryptoProvider = useCryptoProvider(),
): Promise<MacaroonVerifyResult> {
  // 1. Verify the HMAC chain. Re-compute m_0, m_1, …, m_n and
  //    compare against the macaroon's claimed sig.
  let tag = await provider.hmacSha256(rootKey, enc.encode(m.id))
  for (const c of m.caveats) {
    tag = await provider.hmacSha256(tag, enc.encode(c))
  }
  const expectedSig = base64urlEncode(tag)
  if (!provider.timingSafeEqual(enc.encode(expectedSig), enc.encode(m.sig))) {
    return { ok: false, reason: 'bad-sig', caveatIndex: -1 }
  }
  // 2. Walk caveats checking each against ctx. We accumulate
  //    op-restrictions (intersection of all `op=` caveats) and
  //    enforce after the walk so that interleaving doesn't matter.
  const now = ctx.now ?? Date.now()
  const opRestrictions: string[] = []
  for (let i = 0; i < m.caveats.length; i++) {
    const c = m.caveats[i] ?? ''
    const eq = c.indexOf('=')
    if (eq < 0) return { ok: false, reason: 'malformed', caveatIndex: i }
    const key = c.slice(0, eq)
    const value = c.slice(eq + 1)
    if (key === 'expires') {
      // Strict ISO-8601 UTC only. `Date.parse` is implementation-
      // defined for non-ISO inputs — V8 returns NaN for "tomorrow"
      // but accepts "5/21/2026" with locale-dependent semantics,
      // ambiguous two-digit years, etc. A macaroon minted on one
      // runtime could parse to a different expiry on another. Pin
      // the grammar so a caveat is binary-identical across nodes.
      if (!ISO_8601_UTC.test(value)) {
        return { ok: false, reason: 'malformed', caveatIndex: i }
      }
      const expiry = Date.parse(value)
      if (Number.isNaN(expiry)) return { ok: false, reason: 'malformed', caveatIndex: i }
      if (now > expiry) return { ok: false, reason: 'expired', caveatIndex: i }
    } else if (key === 'origin') {
      if (value !== ctx.origin) return { ok: false, reason: 'wrong-origin', caveatIndex: i }
    } else if (key === 'op') {
      opRestrictions.push(value)
    } else if (key.startsWith('app:')) {
      if (ctx.appVerifier) {
        const appKey = key.slice(4)
        const ok = await ctx.appVerifier(appKey, value, ctx)
        if (!ok) return { ok: false, reason: 'app-denied', caveatIndex: i }
      } else {
        // No app verifier installed but the macaroon carries app:*
        // caveats → fail closed. Apps that want to accept app: caveats
        // MUST install a verifier.
        return { ok: false, reason: 'unknown-caveat', caveatIndex: i }
      }
    } else {
      // Unknown caveat. Fail closed — the holder of a token cannot
      // weaken it by encoding new grammar; the verifier must
      // explicitly understand each caveat type.
      return { ok: false, reason: 'unknown-caveat', caveatIndex: i }
    }
  }
  // 3. Apply op restrictions as INTERSECTION. The request's op
  //    must satisfy EVERY op= caveat.
  for (const restriction of opRestrictions) {
    if (!opPermits(restriction, ctx.op)) {
      // We don't know which caveat index drove the rejection (any
      // op= caveat could have); report -1.
      return { ok: false, reason: 'wrong-op', caveatIndex: -1 }
    }
  }
  return { ok: true }
}

/**
 * Does the `restriction` caveat value permit the request's `op`?
 *
 *   restriction = "comments.create"  → exact match
 *   restriction = "comments.*"        → prefix match on "comments."
 *   restriction = "*"                 → wildcard, permits everything
 */
function opPermits(restriction: string, op: string): boolean {
  if (restriction === '*') return true
  if (restriction.endsWith('.*')) {
    const prefix = restriction.slice(0, -1) // keep the trailing "."
    return op.startsWith(prefix)
  }
  return restriction === op
}

// ===== Internal encoding helpers =====

function base64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(s: string): Uint8Array {
  const pad = (4 - (s.length % 4)) % 4
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// Default provider re-export — same pattern as envelope.ts.
export { bunCryptoProvider }
