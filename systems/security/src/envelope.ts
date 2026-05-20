// HMAC envelope — the per-action integrity wrapper.
//
// Every `criticalAction()` invocation rides inside an envelope that
// binds:
//
//   action_id     — the action's stable identifier (e.g. its path).
//                   Defeats cross-action confusion: an envelope minted
//                   for action A is unforgeable as one for action B.
//   body_hash     — SHA-256 of the request body. Defeats tampering:
//                   any byte change invalidates the tag.
//   counter       — IPsec-style monotonic per-session counter. Paired
//                   with NonceStoreCap, defeats replay within session.
//   iat           — issued-at timestamp (seconds since epoch). Bounds
//                   the freshness window (default ±5min for clock skew).
//   origin        — the page's origin. Defeats cross-origin replay.
//   session_id    — the user session id. Binds the envelope to a user.
//   key_id        — which day's rotating sub-key signed this. Lets
//                   the verifier pick the right key without trial.
//
// **Canonicalisation.** The HMAC covers a fixed-order line-delimited
// canonical form. Server + client serialise identically; any version
// disagreement produces a non-matching tag and is rejected. Fields
// are JSON-string-encoded so embedded `\n` / `\0` in field values
// can't be used to forge a different canonical message.
//
// **Wire format.** Envelope ships as a single header:
//
//   X-Place-Envelope: <base64url(canonical)>.<base64url(tag)>
//
// One header, two base64url segments separated by `.` — same shape
// as JWS Compact Serialization, but with the canonical message
// embedded as JSON (not base64-of-JSON) so a security reviewer can
// `base64url-decode | jq` without a JWT parser.
//
// **Standards:**
//   - OWASP ASVS 5.0 11.4.1 (L1) — HMAC with approved hash. SHA-256.
//   - OWASP ASVS 5.0 11.3.4 (L3) — single-use nonce within window.
//   - NIST SP 800-53 Rev 5 AU-10 — non-repudiation (envelope + audit).
//   - NIST SP 800-53 Rev 5 SI-7 — integrity verification.
//
// **Performance.** All-in cost on Bun-native: ~3-5μs HMAC verify +
// ~1μs SHA-256 body hash + ~50ns nonce check. The envelope adds ~5μs
// to a request whose actual work is typically 1-10ms. Net cost is
// well below noise.

import { bunCryptoProvider, type CryptoProvider, useCryptoProvider } from './index.ts'

const enc = new TextEncoder()
const dec = new TextDecoder()

/** Fields the envelope canonicalises + signs over. Order is fixed.
 *  Every field MUST be JSON-string-encoded (escaped quotes, no
 *  embedded NULs) so an attacker can't smuggle a forged separator. */
export interface EnvelopeFields {
  /** The action's stable id (typically its path, e.g. "POST /__a/x"). */
  readonly actionId: string
  /** SHA-256 of the request body, base64url-encoded. */
  readonly bodyHash: string
  /** Monotonic per-session counter — paired with NonceStoreCap. */
  readonly counter: number
  /** Issued-at (seconds since epoch). Verified against current time
   *  within a freshness window (default 300 s). */
  readonly iat: number
  /** The page's origin. e.g. "https://place-ts.pages.dev". */
  readonly origin: string
  /** Session identifier. Lifts the envelope from "anonymous request"
   *  to "this user's intent". */
  readonly sessionId: string
  /** Which day's rotating sub-key signed this. From `rotatingKey.keyIdAt(...)`. */
  readonly keyId: string
}

/** Canonical serialisation of the envelope. Server + client MUST
 *  produce the same byte sequence — that's what the HMAC tags. */
export function canonicalise(fields: EnvelopeFields): Uint8Array {
  // Newline-separated, fixed-order. JSON-encoded values so embedded
  // characters can't break the structure. Trailing newline so the
  // hash function is fed exactly one canonical form per envelope.
  const lines = [
    `v=1`,
    `action_id=${JSON.stringify(fields.actionId)}`,
    `body_hash=${JSON.stringify(fields.bodyHash)}`,
    `counter=${fields.counter}`,
    `iat=${fields.iat}`,
    `origin=${JSON.stringify(fields.origin)}`,
    `session_id=${JSON.stringify(fields.sessionId)}`,
    `key_id=${JSON.stringify(fields.keyId)}`,
    '',
  ]
  return enc.encode(lines.join('\n'))
}

/** Compute SHA-256 of a body buffer + return as base64url. */
export async function sha256Base64url(body: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', body as BufferSource)
  return base64urlEncode(new Uint8Array(hash))
}

/** Sign an envelope. Returns the wire-format header value
 *  `<base64url(canonical)>.<base64url(tag)>`. */
export async function signEnvelope(
  key: Uint8Array,
  fields: EnvelopeFields,
  provider: CryptoProvider = useCryptoProvider(),
): Promise<string> {
  const canonical = canonicalise(fields)
  const tag = await provider.hmacSha256(key, canonical)
  return `${base64urlEncode(canonical)}.${base64urlEncode(tag)}`
}

/** Result of `verifyEnvelope` — either the validated fields or a
 *  typed rejection. */
export type EnvelopeVerifyResult =
  | { ok: true; fields: EnvelopeFields }
  | {
      ok: false
      /** Why the envelope was rejected. Use this for typed logs +
       *  rate-limit decisions; the framework returns 403 for all
       *  cases without distinguishing them on the wire (info-leak). */
      reason:
        | 'malformed'
        | 'bad-tag'
        | 'stale-iat'
        | 'future-iat'
        | 'replay'
        | 'wrong-action'
        | 'wrong-origin'
        | 'wrong-session'
        | 'wrong-body'
    }

export interface VerifyOptions {
  /** Maximum age of the envelope in seconds before it's "stale". Default 300. */
  readonly maxAgeSec?: number
  /** Maximum future drift in seconds before iat is "future". Default 60. */
  readonly maxFutureSec?: number
  /** Expected action id. The envelope's `actionId` must match. */
  readonly expectedActionId: string
  /** Expected origin. The envelope's `origin` must match. */
  readonly expectedOrigin: string
  /** Expected session id. The envelope's `sessionId` must match. */
  readonly expectedSessionId: string
  /** The body the envelope claims to authenticate. Verified against
   *  the canonical `body_hash` field. */
  readonly body: Uint8Array
  /** The HMAC key to verify under. Typically `rotatingKey.keyAt(date)`. */
  readonly key: Uint8Array
}

/** Verify a wire-format envelope. Returns the canonical fields on
 *  success; a typed rejection on failure. All-in cost: ~5-8μs. */
export async function verifyEnvelope(
  wire: string,
  opts: VerifyOptions,
  provider: CryptoProvider = useCryptoProvider(),
): Promise<EnvelopeVerifyResult> {
  // Parse the wire format. Tag-vs-canonical separator is `.`.
  const dot = wire.lastIndexOf('.')
  if (dot < 0) return { ok: false, reason: 'malformed' }
  const canonicalB64 = wire.slice(0, dot)
  const tagB64 = wire.slice(dot + 1)
  let canonical: Uint8Array
  let tag: Uint8Array
  try {
    canonical = base64urlDecode(canonicalB64)
    tag = base64urlDecode(tagB64)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  // Verify the HMAC FIRST — any later check would be a timing oracle.
  const expectedTag = await provider.hmacSha256(opts.key, canonical)
  if (!provider.timingSafeEqual(tag, expectedTag)) {
    return { ok: false, reason: 'bad-tag' }
  }
  // Now parse the canonical fields. The HMAC checked out so we know
  // these bytes are authentic; if parsing fails the envelope was
  // generated incorrectly (server-internal bug), not an attack.
  const text = dec.decode(canonical)
  let fields: EnvelopeFields
  try {
    fields = parseCanonical(text)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  // Freshness window — iat must be recent + not in the future.
  const nowSec = Math.floor(Date.now() / 1000)
  const maxAge = opts.maxAgeSec ?? 300
  const maxFuture = opts.maxFutureSec ?? 60
  if (fields.iat < nowSec - maxAge) return { ok: false, reason: 'stale-iat' }
  if (fields.iat > nowSec + maxFuture) return { ok: false, reason: 'future-iat' }
  // Action / origin / session bindings.
  if (fields.actionId !== opts.expectedActionId) return { ok: false, reason: 'wrong-action' }
  if (fields.origin !== opts.expectedOrigin) return { ok: false, reason: 'wrong-origin' }
  if (fields.sessionId !== opts.expectedSessionId) return { ok: false, reason: 'wrong-session' }
  // Body integrity — recompute the hash + compare.
  const bodyHash = await sha256Base64url(opts.body)
  if (!constantTimeStringEqual(bodyHash, fields.bodyHash, provider)) {
    return { ok: false, reason: 'wrong-body' }
  }
  return { ok: true, fields }
}

// ===== Internal: parsing + encoding helpers =====

function parseCanonical(text: string): EnvelopeFields {
  const lines = text.split('\n')
  if (lines[0] !== 'v=1') throw new Error('unsupported envelope version')
  const get = (i: number, key: string): string => {
    const line = lines[i] ?? ''
    if (!line.startsWith(`${key}=`)) throw new Error(`missing ${key}`)
    return line.slice(key.length + 1)
  }
  return {
    actionId: JSON.parse(get(1, 'action_id')) as string,
    bodyHash: JSON.parse(get(2, 'body_hash')) as string,
    counter: parseCanonicalInt(get(3, 'counter'), 'counter'),
    iat: parseCanonicalInt(get(4, 'iat'), 'iat'),
    origin: JSON.parse(get(5, 'origin')) as string,
    sessionId: JSON.parse(get(6, 'session_id')) as string,
    keyId: JSON.parse(get(7, 'key_id')) as string,
  }
}

// Strict canonical-integer parse. `Number()` accepts scientific
// notation (`1e15` parses to a valid `Number.isInteger` value far
// past anything a real client should emit), hex (`0x10`), and
// whitespace — any of which would let a confused or malicious
// client desync the canonical form server-side vs. client-side,
// or blow out the replay-window's right edge so legitimate later
// counters fall outside. Lock the wire format to non-negative
// decimal integers ≤ 2^53 - 1.
const CANONICAL_INT = /^(?:0|[1-9][0-9]*)$/
function parseCanonicalInt(raw: string, field: string): number {
  if (!CANONICAL_INT.test(raw)) {
    throw new Error(`invalid ${field}: not a canonical non-negative integer`)
  }
  const n = Number(raw)
  if (!Number.isSafeInteger(n)) {
    throw new Error(`invalid ${field}: outside safe integer range`)
  }
  return n
}

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

function constantTimeStringEqual(a: string, b: string, provider: CryptoProvider): boolean {
  return provider.timingSafeEqual(enc.encode(a), enc.encode(b))
}

// Re-export the default provider so consumers don't have to import
// from two places to use the helpers above.
export { bunCryptoProvider }
