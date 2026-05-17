// Server-only helpers for the counter action. Imports the session +
// CSRF signers from `@place/security` (server-side; uses crypto.subtle
// which works in browsers too but the secret + cookie semantics here
// are server-only).
//
// In-memory counter on purpose: keeps the demo's dependency graph
// tight and avoids the `bun:sqlite` issue where Bun.build follows
// dynamic imports and tries to bundle the bun:* protocol for the
// browser target. Persistence isn't the point of this demo — the
// action's security layers are. A real app would back this with a
// CacheStore or `@place/persistence` adapter.

import { csrfToken, parseCookies, signedToken } from '@place/security'

const SESSION_SECRET =
  (typeof process !== 'undefined' && process.env?.['SESSION_SECRET']) ||
  `${crypto.randomUUID()}${crypto.randomUUID()}`
const SESSION_COOKIE = 'sync_session'

interface SessionPayload {
  user: string
  iat: number
}

const sessionSigner = signedToken<SessionPayload>(SESSION_SECRET)
const csrfSigner = csrfToken(SESSION_SECRET, { expiresInMs: 7 * 24 * 60 * 60 * 1000 })

let counter = 0

export function readCounter(): number {
  return counter
}

export function incrementBy(by: number): { before: number; after: number } {
  const before = counter
  counter = before + by
  return { before, after: counter }
}

export async function audienceFromRequest(req: Request): Promise<string> {
  const cookies = parseCookies(req.headers.get('cookie'))
  const tok = cookies[SESSION_COOKIE]
  if (!tok) return 'anon'
  const session = await sessionSigner.verify(tok)
  return session?.user ?? 'anon'
}

export async function verifyCsrf(token: string, audience: string): Promise<boolean> {
  return csrfSigner.verify(token, audience)
}

export async function mintCsrfFor(req: Request): Promise<string> {
  const audience = await audienceFromRequest(req)
  return csrfSigner.generate(audience)
}
