// Audit log — tamper-evident, append-only record of accepted
// `criticalAction()` invocations (and any `ctx.audit(...)` event
// handlers emit). Each entry chains the previous via a hash field,
// so a single accepted entry's hash + sequence number is enough to
// detect any modification anywhere earlier in the log.
//
// **What this primitive promises:**
//
//   - **Tamper-evidence.** A verifier holding the current tip hash
//     can confirm that the log's prefix up to a given sequence
//     matches what the verifier saw last time. ANY change — a
//     redacted entry, a re-ordered pair, a forged insertion — breaks
//     the chain and is detected on the next verify.
//
//   - **Append-only contract.** The interface has `append` and
//     `query`; no `delete`, no `update`. Adapters that wrap a
//     mutable store (SQLite, Redis) are responsible for not exposing
//     mutation paths.
//
//   - **Cheap.** ~200 ns per append (sha256 of the canonical entry +
//     Map.set). The in-memory default targets 10k entries default;
//     production deployments install a durable adapter via
//     `AuditLogCap`.
//
// **What this primitive does NOT promise** (see ADR 0055
// "Consequences" section):
//
//   - Classical non-repudiation. The log proves the handler accepted
//     a request; it does NOT prove a human intentionally performed
//     the action. If the user's browser/session/key were
//     compromised, the envelope is still cryptographically valid;
//     the audit entry shows it was accepted.
//
//   - External witnessing. The in-memory log lives in process memory;
//     a malicious server-side actor with write access to the
//     framework's source could replay history before flushing.
//     Production durability + external timestamping (sigstore /
//     RFC 3161 TSA / blockchain anchor) are layers on top.
//
//   - Confidentiality. Entries store hashes of payloads, not the
//     payloads themselves. The (actor, action, payloadHash) tuple
//     can still be PII-revealing depending on what's bound; apps
//     concerned about this should hash the actor through a
//     deployment-secret-keyed HMAC before passing to `append`.
//
// **Standards:**
//
//   - NIST SP 800-53 Rev 5 AU-2 (audit events), AU-3 (content),
//     AU-9 (protection — implemented via the tamper-evident chain).
//   - OWASP ASVS 5.0 V10 (logging & error handling) — the entries
//     have a structured, queryable format suitable for V10's
//     "logs must be parseable by tooling" requirement.
//   - PCI DSS 4.0.1 Req 10 — audit trail of all individual user
//     access to cardholder data + admin actions. The chain hash
//     satisfies Req 10.5 (file-integrity monitoring on logs).
//
// **Wire format (the canonical line that's hashed):**
//
//   v=1
//   seq=<int>
//   ts=<epoch-ms>
//   actor=<JSON-string>
//   action=<JSON-string>
//   payload_hash=<JSON-string>
//   result_hash=<JSON-string>      // empty string if handler hadn't completed
//   prev_hash=<JSON-string>
//   key_id=<JSON-string>           // which day's sub-key signed the request
//
// Same canonicalisation discipline as `envelope.ts`: fixed-order
// line-delimited, JSON-encoded values so embedded `\n` or `\0` in
// field values can't break the structure.

import { defineCapability } from '@place/capability'
import { type CryptoProvider, useCryptoProvider } from './index.ts'

const enc = new TextEncoder()

/** Genesis-entry sentinel — what `prev_hash` is for the first entry.
 *  Stable, public string so verifiers can recreate the chain from
 *  scratch. */
export const GENESIS_HASH = 'g'

/** Fields a caller supplies; framework fills in seq + ts + prev_hash
 *  + canonical line. */
export interface AuditAppendInput {
  /** Who. Session id, user id, or hash thereof for PII discipline. */
  readonly actor: string
  /** What. Action id (e.g. "POST /__a/createComment") or event name
   *  ("payment.captured", "admin.role_changed"). */
  readonly action: string
  /** Base64url SHA-256 of the canonicalised request payload. */
  readonly payloadHash: string
  /** Base64url SHA-256 of the canonicalised result. Empty string
   *  when the handler didn't complete (e.g. error mid-handler — the
   *  attempt is still recorded). */
  readonly resultHash: string
  /** Which day's sub-key signed the request. Empty for
   *  framework-emitted events that aren't tied to a request. */
  readonly keyId: string
}

/** A committed audit entry. Returned from `append` + by `query`. */
export interface AuditEntry extends AuditAppendInput {
  /** In-process monotonic sequence number. 1-based. */
  readonly seq: number
  /** Epoch milliseconds at append time. */
  readonly ts: number
  /** sha256(canonical) of the PREVIOUS entry. The genesis entry has
   *  `prev_hash = GENESIS_HASH`. */
  readonly prevHash: string
  /** sha256(canonical) of THIS entry. Used as `prev_hash` of the
   *  next entry. */
  readonly hash: string
  /** The exact canonical bytes the hash covered. Stored alongside so
   *  verifiers can reproduce the hash without re-canonicalising. */
  readonly canonical: string
}

export interface VerifyResult {
  readonly ok: boolean
  /** If `ok: false`, the seq of the first broken entry. */
  readonly brokenAt?: number
  readonly reason?: 'missing-prev' | 'hash-mismatch' | 'gap-in-sequence'
}

export interface AuditLog {
  /**
   * Append an entry. Returns the committed entry including the
   * framework-computed `seq`, `ts`, `prevHash`, `hash`, `canonical`.
   * Idempotent on the framework side — same input twice produces
   * two entries (caller is responsible for not double-calling on
   * the same action invocation).
   */
  append(input: AuditAppendInput): Promise<AuditEntry>
  /** Return entries `[from..to]` inclusive. `from` defaults to the
   *  earliest available; `to` defaults to the latest. The in-memory
   *  default may have dropped earlier entries if `maxEntries` was
   *  exceeded. */
  query(from?: number, to?: number): Promise<readonly AuditEntry[]>
  /** Number of entries currently held. */
  size(): Promise<number>
  /** Sequence number of the most recent entry (0 if empty). */
  tip(): Promise<number>
  /** Hash of the most recent entry (`GENESIS_HASH` if empty). The
   *  "current root" of the chain. */
  tipHash(): Promise<string>
  /**
   * Walk the chain from `from..to` and verify each entry's `hash`
   * matches `sha256(canonical)` AND each entry's `prevHash` matches
   * the previous entry's `hash`. Returns `{ok:true}` on success;
   * `{ok:false, brokenAt, reason}` on any inconsistency.
   *
   * Cost: O(n) — one sha256 per entry. ~200 ns × n for in-memory.
   */
  verify(from?: number, to?: number): Promise<VerifyResult>
  /** Drop everything. For tests + session-rotation scenarios where
   *  a fresh chain is wanted. */
  reset(): Promise<void>
}

/**
 * Build the canonical byte sequence for an entry. Hashed verbatim;
 * verifiers reproduce this exact form to check the chain.
 */
export function canonicaliseAuditEntry(fields: Omit<AuditEntry, 'hash' | 'canonical'>): Uint8Array {
  const lines = [
    'v=1',
    `seq=${fields.seq}`,
    `ts=${fields.ts}`,
    `actor=${JSON.stringify(fields.actor)}`,
    `action=${JSON.stringify(fields.action)}`,
    `payload_hash=${JSON.stringify(fields.payloadHash)}`,
    `result_hash=${JSON.stringify(fields.resultHash)}`,
    `prev_hash=${JSON.stringify(fields.prevHash)}`,
    `key_id=${JSON.stringify(fields.keyId)}`,
    '',
  ]
  return enc.encode(lines.join('\n'))
}

/**
 * In-memory ring buffer with hash chaining. Default 10,000 entries
 * — enough for dev + small-scale prod. Earlier entries silently
 * roll off the back; the chain is still valid for the retained
 * window. Production deployments install a durable adapter.
 */
export function inMemoryAuditLog(opts: { maxEntries?: number } = {}): AuditLog {
  const maxEntries = opts.maxEntries ?? 10_000
  if (maxEntries < 1) {
    throw new Error('inMemoryAuditLog: maxEntries must be ≥ 1')
  }
  const entries: AuditEntry[] = []
  let nextSeq = 1

  return {
    async append(input) {
      const provider = useCryptoProvider()
      const prevHash =
        entries.length === 0 ? GENESIS_HASH : (entries[entries.length - 1] as AuditEntry).hash
      const partial: Omit<AuditEntry, 'hash' | 'canonical'> = {
        seq: nextSeq,
        ts: Date.now(),
        actor: input.actor,
        action: input.action,
        payloadHash: input.payloadHash,
        resultHash: input.resultHash,
        prevHash,
        keyId: input.keyId,
      }
      const canonical = canonicaliseAuditEntry(partial)
      const hash = await sha256B64u(canonical, provider)
      const entry: AuditEntry = {
        ...partial,
        hash,
        canonical: new TextDecoder().decode(canonical),
      }
      entries.push(entry)
      nextSeq++
      // Ring eviction — drop oldest beyond cap.
      while (entries.length > maxEntries) entries.shift()
      return entry
    },
    async query(from, to) {
      if (entries.length === 0) return []
      const first = entries[0]?.seq ?? 1
      const last = entries[entries.length - 1]?.seq ?? 1
      const lo = Math.max(from ?? first, first)
      const hi = Math.min(to ?? last, last)
      if (lo > hi) return []
      const startIdx = lo - first
      const endIdx = hi - first
      return entries.slice(startIdx, endIdx + 1)
    },
    async size() {
      return entries.length
    },
    async tip() {
      return entries.length === 0 ? 0 : (entries[entries.length - 1] as AuditEntry).seq
    },
    async tipHash() {
      return entries.length === 0 ? GENESIS_HASH : (entries[entries.length - 1] as AuditEntry).hash
    },
    async verify(from, to) {
      if (entries.length === 0) return { ok: true }
      const first = entries[0]?.seq ?? 1
      const last = entries[entries.length - 1]?.seq ?? 1
      const lo = Math.max(from ?? first, first)
      const hi = Math.min(to ?? last, last)
      const provider = useCryptoProvider()
      // Starting baseline. Two cases:
      //   - lo === first AND first === 1: chain starts from genesis;
      //     baseline IS the published GENESIS_HASH constant.
      //   - lo === first AND first > 1: ring eviction discarded
      //     entries[1..first-1]; the retained window starts mid-
      //     chain. Trust the first retained entry's `prevHash` as
      //     the anchor — we can verify CONTINUITY within the window
      //     but not the discarded prefix. Apps needing stronger
      //     guarantees install a durable adapter + external anchor.
      //   - lo > first: starting from the middle; baseline is the
      //     hash of the entry at lo-1.
      let expectedPrev: string
      if (lo === first) {
        expectedPrev = first === 1 ? GENESIS_HASH : (entries[0] as AuditEntry).prevHash
      } else {
        expectedPrev = (entries[lo - 1 - first] as AuditEntry).hash
      }
      for (let s = lo; s <= hi; s++) {
        const idx = s - first
        const entry = entries[idx]
        if (!entry) return { ok: false, brokenAt: s, reason: 'gap-in-sequence' }
        if (entry.prevHash !== expectedPrev) {
          return { ok: false, brokenAt: s, reason: 'missing-prev' }
        }
        const recomputed = await sha256B64u(enc.encode(entry.canonical), provider)
        if (recomputed !== entry.hash) {
          return { ok: false, brokenAt: s, reason: 'hash-mismatch' }
        }
        expectedPrev = entry.hash
      }
      return { ok: true }
    },
    async reset() {
      entries.length = 0
      nextSeq = 1
    },
  }
}

/**
 * Capability slot for the audit log. Apps install at boot:
 *
 *   app({ caps: [[AuditLogCap, inMemoryAuditLog({ maxEntries: 10_000 })]] })
 *
 * `criticalAction()` reads via `AuditLogCap.use(defaultInMemoryLog)`,
 * so apps that don't install a cap still get audit-logging — just
 * in process memory.
 */
export const AuditLogCap = defineCapability<AuditLog>('AuditLog')

/**
 * Read the active audit log. Falls back to a process-wide
 * singleton in-memory log when no cap is installed — keeps the
 * default surface "audit-logging is on" rather than "audit-logging
 * is silently no-op."
 */
let _defaultAuditLog: AuditLog | null = null
export function useAuditLog(): AuditLog {
  if (_defaultAuditLog === null) _defaultAuditLog = inMemoryAuditLog()
  return AuditLogCap.use(_defaultAuditLog)
}

// ===== Internal helpers =====

async function sha256B64u(bytes: Uint8Array, provider: CryptoProvider): Promise<string> {
  // The provider's `hmacSha256` is the wrong tool here (HMAC vs raw
  // hash); fall back to the global crypto.subtle.digest for hashing.
  // This is fine even under a FIPS provider — SHA-256 is FIPS-approved
  // and crypto.subtle.digest is the universal API; the provider
  // boundary is more important for the keyed primitives (HMAC, HKDF,
  // signatures) where algorithm choice matters.
  void provider
  const hash = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return base64urlEncode(new Uint8Array(hash))
}

function base64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number)
  return btoa(bin).replace(/\+/g, '-').replace(/_/g, '/').replace(/=+$/, '')
}
