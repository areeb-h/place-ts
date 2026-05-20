// Client-side envelope signing for criticalAction().
//
// Lives in a separate module from `critical-action.ts` so it can be
// tree-shaken from server bundles. Imported lazily via
// `await import('./critical-action-client.ts')` from inside the
// `.call()` method — server-side `__PLACE_BROWSER__` is false, the
// import never resolves, the WebCrypto + IndexedDB dependencies stay
// out of the server module graph.
//
// **The lifecycle of a per-session HMAC key in the browser:**
//
//   1. App's auth handler succeeds (login / signup / refresh).
//      Server calls `provisionActionKey(sessionId)` (in
//      critical-action.ts) → returns { keyBytes, keyId, expiresAt }.
//
//   2. Server's response body includes those fields. The app's
//      auth-flow code on the browser calls `installActionKey(...)`
//      with the response data.
//
//   3. `installActionKey()` imports the base64url-decoded bytes as
//      a non-extractable WebCrypto `CryptoKey` (the `extractable:
//      false` flag means JS can never read the raw bytes back, only
//      use them to sign). The key is stored in IndexedDB so it
//      survives reloads + tab switches.
//
//   4. On every `criticalAction().call(input)`, `signClientEnvelope`
//      reads the CryptoKey + monotonic counter from IDB, mints a
//      fresh envelope (incrementing the counter), signs via
//      `subtle.sign('HMAC', cryptoKey, canonical)`, and returns the
//      wire-format header.
//
//   5. The counter persists in IDB so reloads / multi-tab don't
//      reuse a counter. Server rejects any counter ≤ the highest
//      already seen.
//
//   6. When `expiresAt` passes, the next `.call()` returns a
//      typed `ActionError('expired-action-key')` and the app's
//      session-refresh flow re-provisions.
//
// **What this DOES NOT do:**
//   - Auth flow. App-specific (OAuth, password, magic link, etc.).
//   - Cross-tab key sync. IDB is shared across tabs in the same
//     origin, so this works automatically. Cross-DEVICE is by design
//     a fresh provision per device.
//   - Key rotation while a session is alive. The framework's
//     daily rotation means a session living more than 24h needs a
//     re-provision; the `expiresAt` field signals when.

const enc = new TextEncoder()
const IDB_DB = 'place-action-key'
const IDB_STORE = 'keys'
const KEY_RECORD_ID = 'current' as const
const MACAROON_RECORD_ID = 'current-macaroon' as const

interface StoredKey {
  /** The non-extractable CryptoKey. Browser keeps the raw bytes
   *  inaccessible from JS post-import. */
  readonly cryptoKey: CryptoKey
  /** Daily-rotation key id (e.g. `"b20020"`). Sent in the envelope
   *  so the server picks the right verification key. */
  readonly keyId: string
  /** When the daily root rotates — re-provision before this. */
  readonly expiresAt: number
  /** Session id — bound into the envelope's `session_id` field.
   *  Sourced from the auth response (NOT `document.cookie`) so the
   *  session cookie stays HttpOnly and JS can't pivot via duplicate-
   *  cookie writes. */
  readonly sessionId: string
}

interface IdbKeyRecord {
  readonly id: typeof KEY_RECORD_ID
  /** The non-extractable CryptoKey, stored directly. IndexedDB can
   *  persist CryptoKeys structurally without losing the
   *  `extractable: false` flag. */
  readonly cryptoKey: CryptoKey
  readonly keyId: string
  readonly expiresAt: number
  readonly sessionId: string
  /** Highest counter sent. Persists across reloads. */
  readonly counter: number
}

interface IdbMacaroonRecord {
  readonly id: typeof MACAROON_RECORD_ID
  /** Serialised macaroon (wire string) — what we'll send in
   *  `X-Place-Macaroon`. Opaque to the browser; the server
   *  deserialises and verifies. */
  readonly wire: string
  /** When the macaroon key rotates — re-provision before this. */
  readonly expiresAt: number
}

let _cached: StoredKey | null = null
let _counter: number | null = null
let _cachedMacaroon: { wire: string; expiresAt: number } | null = null

/**
 * Install the per-session HMAC key the server provisioned. Apps call
 * this once after a successful auth flow:
 *
 *   const session = await fetch('/login', ...).then(r => r.json())
 *   await installActionKey(session.action)  // { keyBytes, keyId, expiresAt }
 *
 * The `keyBytes` is imported as a non-extractable CryptoKey + stored
 * in IndexedDB. From this point onward, `criticalAction().call(input)`
 * picks it up automatically.
 *
 * Idempotent: re-installing with the same `keyBytes` is fine. Re-
 * installing with a new key (e.g. after a session refresh) replaces
 * the previous one and resets the counter to 1.
 */
export async function installActionKey(provisioned: {
  keyBytes: string
  keyId: string
  expiresAt: number
  sessionId: string
}): Promise<void> {
  if (typeof provisioned.sessionId !== 'string' || provisioned.sessionId.length === 0) {
    throw new Error(
      'installActionKey: provisioned.sessionId is required. Re-provision via ' +
        '`provisionActionKey()` server-side — it now returns sessionId in the response.',
    )
  }
  const raw = base64urlDecode(provisioned.keyBytes)
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false, // extractable: false — JS can't read the bytes back after this
    ['sign'],
  )
  // Wipe the raw bytes from the Uint8Array we no longer need. The
  // input string `keyBytes` is still readable from the caller's
  // closure; apps are advised to call this immediately after
  // receiving the response + not retain the raw bytes.
  raw.fill(0)
  _cached = {
    cryptoKey,
    keyId: provisioned.keyId,
    expiresAt: provisioned.expiresAt,
    sessionId: provisioned.sessionId,
  }
  _counter = 1
  await idbPut({
    id: KEY_RECORD_ID,
    cryptoKey,
    keyId: provisioned.keyId,
    expiresAt: provisioned.expiresAt,
    sessionId: provisioned.sessionId,
    counter: 1,
  })
}

/**
 * Remove the per-session key. Called on logout. The CryptoKey
 * reference is dropped + the IndexedDB record deleted; subsequent
 * sign attempts throw.
 */
export async function clearActionKey(): Promise<void> {
  _cached = null
  _counter = null
  await idbDelete(KEY_RECORD_ID)
}

/**
 * Install the macaroon the server provisioned (via
 * `provisionMacaroon()` + the app's auth flow). Apps call once
 * after auth + after `installActionKey()`:
 *
 *   await installActionKey(session.action)
 *   await installMacaroon(session.macaroon)
 *
 * The wire string is opaque to the browser; the server
 * deserialises and verifies on every `criticalAction({ requires })`
 * call. Stored in IndexedDB so reloads + multi-tab share it.
 *
 * Re-installing replaces the prior macaroon. Apps that need to
 * NARROW the macaroon further on the client (e.g. limiting an
 * embedded iframe to a sub-scope) can `attenuate()` the
 * deserialised macaroon, then re-install — but note that an
 * attacker with script access can do the same, so cap the actual
 * authority server-side at provision time.
 */
export async function installMacaroon(provisioned: {
  macaroon: string
  expiresAt: number
}): Promise<void> {
  _cachedMacaroon = { wire: provisioned.macaroon, expiresAt: provisioned.expiresAt }
  await idbPutMacaroon({
    id: MACAROON_RECORD_ID,
    wire: provisioned.macaroon,
    expiresAt: provisioned.expiresAt,
  })
}

/** Drop the stored macaroon. Called on logout. Subsequent
 *  criticalAction calls fall back to envelope-only protection;
 *  any handler with `requires:` will 403. */
export async function clearMacaroon(): Promise<void> {
  _cachedMacaroon = null
  await idbDelete(MACAROON_RECORD_ID)
}

/**
 * Read the stored macaroon wire string for header send. Returns
 * `null` if not installed or expired (treated as not installed —
 * apps re-provision via the same flow as action keys).
 */
export async function loadMacaroonWire(): Promise<string | null> {
  if (_cachedMacaroon === null) {
    const rec = await idbGetMacaroon(MACAROON_RECORD_ID)
    if (!rec) return null
    _cachedMacaroon = { wire: rec.wire, expiresAt: rec.expiresAt }
  }
  if (Date.now() > _cachedMacaroon.expiresAt) return null
  return _cachedMacaroon.wire
}

/**
 * Sign an envelope. Reads the current CryptoKey + counter from
 * IDB (lazy-loaded), mints the envelope, signs, returns the wire
 * string. Increments + persists the counter atomically.
 */
export async function signClientEnvelope(args: {
  actionId: string
  body: Uint8Array
}): Promise<string> {
  const stored = await loadKey()
  if (!stored) {
    throw new Error(
      'criticalAction: no action key installed. The app must call ' +
        '`installActionKey()` after auth before any `criticalAction().call()`. ' +
        'See the docs for the recommended auth-flow pattern.',
    )
  }
  if (Date.now() > stored.expiresAt) {
    throw new Error(
      'criticalAction: action key expired. The app must re-provision via ' +
        '`provisionActionKey()` server-side + `installActionKey()` client-side ' +
        'when the session crosses a daily-rotation boundary.',
    )
  }
  const counter = (_counter ?? 1) + 1
  _counter = counter
  await idbUpdateCounter(KEY_RECORD_ID, counter)

  // Compute body hash + canonical envelope, then sign.
  const bodyHash = await sha256Base64url(args.body)
  const origin = typeof location !== 'undefined' ? location.origin : ''
  const iat = Math.floor(Date.now() / 1000)
  const lines = [
    `v=1`,
    `action_id=${JSON.stringify(args.actionId)}`,
    `body_hash=${JSON.stringify(bodyHash)}`,
    `counter=${counter}`,
    `iat=${iat}`,
    `origin=${JSON.stringify(origin)}`,
    `session_id=${JSON.stringify(stored.sessionId)}`,
    `key_id=${JSON.stringify(stored.keyId)}`,
    '',
  ]
  const canonical = enc.encode(lines.join('\n'))
  const tagBuf = await crypto.subtle.sign('HMAC', stored.cryptoKey, canonical as BufferSource)
  const tag = new Uint8Array(tagBuf)
  return `${base64urlEncode(canonical)}.${base64urlEncode(tag)}`
}

// ===== Internal: IndexedDB plumbing =====

async function loadKey(): Promise<StoredKey | null> {
  if (_cached !== null) return _cached
  const rec = await idbGetKey(KEY_RECORD_ID)
  if (!rec) return null
  // Records persisted before sessionId-in-IDB landed lack the field.
  // Treat them as not-installed so apps re-provision through the new
  // path; trying to sign envelopes with sessionId="" would 403 anyway.
  if (typeof rec.sessionId !== 'string' || rec.sessionId.length === 0) return null
  _cached = {
    cryptoKey: rec.cryptoKey,
    keyId: rec.keyId,
    expiresAt: rec.expiresAt,
    sessionId: rec.sessionId,
  }
  _counter = rec.counter
  return _cached
}

// One open IDBDatabase, reused across every helper. Each helper
// previously called `indexedDB.open` per invocation and never closed
// the result — every criticalAction().call() leaked at least two
// connections (`idbGetKey` from loadKey + `idbUpdateCounter` from
// the counter bump), and unclosed connections block `versionchange`
// upgrades on the page. Memoising the promise gives one connection
// per page lifetime, closed on `versionchange` so a parallel tab can
// upgrade.
let _dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (_dbPromise !== null) return _dbPromise
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // If another tab requests an upgrade, drop this connection so
      // the upgrade can proceed; next call re-opens with the new
      // schema. The current Promise stays settled to this db (callers
      // mid-transaction won't crash); subsequent calls go through the
      // re-open path.
      db.onversionchange = () => {
        try {
          db.close()
        } catch (_) {
          // ignore — best-effort close on upgrade signal
        }
        _dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => {
      _dbPromise = null
      reject(req.error)
    }
    req.onblocked = () => {
      // Another tab holds an older version with onversionchange not
      // honored. Re-resolve to allow retry on next call.
      _dbPromise = null
      reject(new Error('criticalAction: IndexedDB open blocked'))
    }
  })
  return _dbPromise
}

async function idbGetKey(id: typeof KEY_RECORD_ID): Promise<IdbKeyRecord | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(id)
    req.onsuccess = () => resolve((req.result as IdbKeyRecord | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function idbGetMacaroon(
  id: typeof MACAROON_RECORD_ID,
): Promise<IdbMacaroonRecord | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(id)
    req.onsuccess = () => resolve((req.result as IdbMacaroonRecord | undefined) ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function idbPut(rec: IdbKeyRecord): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const req = tx.objectStore(IDB_STORE).put(rec)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function idbPutMacaroon(rec: IdbMacaroonRecord): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const req = tx.objectStore(IDB_STORE).put(rec)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function idbDelete(
  id: typeof KEY_RECORD_ID | typeof MACAROON_RECORD_ID,
): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const req = tx.objectStore(IDB_STORE).delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

async function idbUpdateCounter(id: typeof KEY_RECORD_ID, counter: number): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const store = tx.objectStore(IDB_STORE)
    const getReq = store.get(id)
    getReq.onsuccess = () => {
      const rec = getReq.result as IdbKeyRecord | undefined
      if (!rec) {
        resolve()
        return
      }
      const updated: IdbKeyRecord = { ...rec, counter }
      const putReq = store.put(updated)
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(putReq.error)
    }
    getReq.onerror = () => reject(getReq.error)
  })
}

// ===== Internal: encoding helpers =====

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

async function sha256Base64url(body: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', body as BufferSource)
  return base64urlEncode(new Uint8Array(hash))
}
