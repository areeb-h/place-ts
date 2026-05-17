// Tiny KV sync server for @place/persistence's serverAdapter.
//
// Single file, ~120 LOC of substance. Demonstrates that "any persistence
// backend through the same contract" includes a real network server,
// not just a swap of localStorage for IndexedDB. Run with:
//
//   bun run --filter @place/sync-server start
//
// or directly:
//
//   bun examples/sync-server/src/server.ts
//
// Then in the sandbox's persistence demo, pick the 'server' backend.
// Add a line in one tab; another tab on the same backend ticks within
// ~1 frame via WebSocket push.
//
// Protocol:
//   GET  /kv/:key       → 200 { value: T | null }
//   PUT  /kv/:key       body { value: T }  → 204, broadcasts { type: 'change', key }
//   GET  /kv (debug)    → 200 [{ key, value }, …]
//   WS   ws://host:port → server pushes { type: 'change', key } per write
//
// AUTH (v0.2): demonstrates @place/security primitives end-to-end —
//   POST /auth/login    body { username }  → Set-Cookie session=… + { user, csrf }
//                                            (rate-limited per IP)
//   POST /auth/logout                       → 204 + clears the cookie
//   GET  /auth/me                           → 200 { user, csrf } | 401
//   GET  /protected/ping                    → 200 { user } | 401  (auth-required demo)
//
// The /auth/* and /protected/* routes are NON-BREAKING — the original
// /kv/:key routes stay public so commonplace's serverAdapter keeps
// working without code changes. Apps that want auth on writes can
// require a session in a wrapper around the existing handlers.

import { Database } from 'bun:sqlite'
import { serve } from '@place/component'
import {
  clearCookieHeader,
  csrfToken,
  parseCookies,
  rateLimit,
  SecurityError,
  setCookieHeader,
  signedToken,
} from '@place/security'
import { actionsPage } from './actions.page.tsx'
import { incrementCounter } from './counter.action.ts'
import { homePage } from './home.page.tsx'
import { indexPage } from './index.page.tsx'
import { siteLayout } from './siteLayout.tsx'
import { slowPage } from './slow.page.tsx'

// No happy-dom install needed: every built-in View has a `toHtml`
// emitter so renderToString runs in pure Bun. The Page component below
// is plain JSX in Page.tsx — same factories the browser-side code uses
// — wrapped into a declarative Page object in home.page.tsx.
//
// Tailwind + security headers are first-class on serve() now: pass
// `tailwind: true` to auto-compile + auto-inject CSS into every page,
// and `security: 'strict'` to apply CSP + HSTS + Referrer-Policy +
// X-Content-Type-Options + frame-ancestors etc. with a vetted baseline.
// The Tailwind hash is auto-added to CSP `style-src`, so strict CSP
// keeps working without `'unsafe-inline'`.

const PORT = Number.parseInt(process.env['PORT'] ?? '5180', 10)
const DB_PATH = process.env['DB_PATH'] ?? 'place-sync.db'
// Session secret — randomized per process if env is missing. In production,
// set SESSION_SECRET to a stable 32+ random bytes so cookies survive restart.
const SESSION_SECRET =
  process.env['SESSION_SECRET'] ?? `${crypto.randomUUID()}${crypto.randomUUID()}`
const SESSION_COOKIE = 'sync_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
// `insecure: true` strips the `Secure` cookie flag for plain-HTTP localhost
// dev. NEVER set this in production — always behind HTTPS.
const COOKIE_INSECURE = process.env['NODE_ENV'] !== 'production'

interface SessionPayload {
  user: string
  iat: number
}

const sessionSigner = signedToken<SessionPayload>(SESSION_SECRET)
const csrfSigner = csrfToken(SESSION_SECRET, { expiresInMs: SESSION_TTL_MS })
// Per-IP rate limit on /auth/login — 5 attempts per minute. Cheap, in-memory,
// resets on process restart (acceptable for the demo).
const loginLimiter = rateLimit({ windowMs: 60_000, max: 5 })

const db = new Database(DB_PATH)
db.exec(`
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`)

const stmtGet = db.prepare<{ value: string } | null, [string]>('SELECT value FROM kv WHERE key = ?')
const stmtPut = db.prepare<unknown, [string, string, number]>(
  'INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
)
const stmtAll = db.prepare<{ key: string; value: string }, []>(
  'SELECT key, value FROM kv ORDER BY key',
)

const sockets = new Set<Bun.ServerWebSocket<unknown>>()
const broadcast = (key: string): void => {
  const msg = JSON.stringify({ type: 'change', key })
  for (const ws of sockets) {
    try {
      ws.send(msg)
    } catch {
      // Socket closed mid-broadcast — let the close handler clean up.
    }
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
}

const json = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })

const noContent = (init?: ResponseInit): Response =>
  new Response(null, { status: 204, headers: { ...corsHeaders, ...(init?.headers ?? {}) } })

const fail = (e: SecurityError): Response =>
  new Response(e.message, { status: e.status, headers: corsHeaders })

// Read + verify the session cookie on the request. Returns the payload
// or null. Centralizes the session→user lookup so handlers don't repeat.
const readSession = async (req: Request): Promise<SessionPayload | null> => {
  const cookies = parseCookies(req.headers.get('cookie'))
  const token = cookies[SESSION_COOKIE]
  if (!token) return null
  return await sessionSigner.verify(token)
}

// Best-effort client identifier for rate-limiting. Uses X-Forwarded-For
// when behind a proxy, falls back to socket address (when srv is
// available — routes called via the router don't have srv handy and
// degrade to 'anon', which is fine for the demo's single-tenant case).
const clientKey = (req: Request, srv?: Bun.Server<unknown>): string => {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]?.trim() ?? 'anon'
  return srv?.requestIP(req)?.address ?? 'anon'
}

// serve() bundles the client entry, serves it at /client.js, and
// dispatches both Pages and raw handlers. WebSocket upgrade + CORS
// preflight live in the `fetch` pre-router hook (they need `srv` and
// don't fit the (req, params) shape). Read top-down — first match wins.
await serve({
  port: PORT,
  clientEntry: `${import.meta.dir}/client.tsx`,
  // Auto-Tailwind: compile once at startup, inject inline CSS into every
  // page's <head>, auto-add the SHA-256 hash to the security CSP so
  // strict CSP keeps working without `'unsafe-inline'`.
  tailwind: { content: [`${import.meta.dir}/**/*.tsx`] },
  // Vetted security baseline: CSP locked to 'self', X-Content-Type-Options:
  // nosniff, Referrer-Policy, frame-ancestors none, COOP same-origin, etc.
  // The `connectSrc` override is needed because the demo's WebSocket
  // talks to ws://localhost:5180/ — the strict default's `'self'` only
  // covers https/http, so we extend with `ws:` and `wss:`.
  security: {
    preset: 'standard',
    csp: { connectSrc: ['self', 'ws:', 'wss:'] },
  },
  // Shared layout for ALL Pages in this server — declared once here,
  // applied automatically to homePage, slowPage, and any future page.
  // Each page's view stays focused on its own content; the header/footer
  // chrome lives in `siteLayout.tsx`. THE layout-DX win: one line.
  layout: siteLayout,
  headers: corsHeaders,
  fetch: (req, srv) => {
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }
    if (new URL(req.url).pathname === '/' && srv.upgrade(req, { data: undefined })) {
      return new Response(null)
    }
    return null
  },
  websocket: {
    open(ws) {
      sockets.add(ws)
    },
    close(ws) {
      sockets.delete(ws)
    },
    // We don't expect client → server messages in v0.1 (server is push-only).
    message() {},
  },
  routes: {
    // Landing page so a fresh GET / lands somewhere readable instead
    // of the blank that the WebSocket-upgrade fallthrough produces.
    '/': indexPage,
    // Action demos — typed action() + full security stack + bun:sqlite.
    '/actions/demo': actionsPage,
    ...incrementCounter.handler,
    // SSR — pure shared Page. Tailwind + CSP auto-applied via serve()'s
    // tailwind + security options above; no per-route spread needed.
    'GET /ssr/demo': homePage,
    // Streaming SSR demo (Phase 4.5): page renders shell + fallback,
    // streams the slow content in via <template> + __place.swap.
    'GET /ssr/slow': slowPage,

    // Auth
    'POST /auth/login': async (req) => {
      if (!loginLimiter.check(clientKey(req))) {
        return fail(new SecurityError(429, 'Too many login attempts'))
      }
      let body: { username?: unknown }
      try {
        body = (await req.json()) as { username?: unknown }
      } catch {
        return fail(new SecurityError(400, 'Invalid JSON'))
      }
      const user = typeof body.username === 'string' ? body.username.trim() : ''
      if (!user) return fail(new SecurityError(400, 'username required'))

      const sessionToken = await sessionSigner.sign(
        { user, iat: Date.now() },
        { expiresInMs: SESSION_TTL_MS },
      )
      const csrf = await csrfSigner.generate(user)
      return json(
        { user, csrf },
        {
          headers: {
            'Set-Cookie': setCookieHeader(SESSION_COOKIE, sessionToken, {
              maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
              insecure: COOKIE_INSECURE,
            }),
          },
        },
      )
    },

    'POST /auth/logout': () =>
      noContent({
        headers: {
          'Set-Cookie': clearCookieHeader(SESSION_COOKIE, { insecure: COOKIE_INSECURE }),
        },
      }),

    'GET /auth/me': async (req) => {
      const session = await readSession(req)
      if (session === null) return fail(new SecurityError(401, 'Not authenticated'))
      const csrf = await csrfSigner.generate(session.user)
      return json({ user: session.user, csrf })
    },

    // Protected demo: session-required + CSRF-required (POST) demos.
    'GET /protected/ping': async (req) => {
      const session = await readSession(req)
      if (session === null) return fail(new SecurityError(401, 'Not authenticated'))
      return json({ user: session.user, ts: Date.now() })
    },

    'POST /protected/echo': async (req) => {
      const session = await readSession(req)
      if (session === null) return fail(new SecurityError(401, 'Not authenticated'))
      const csrf = req.headers.get('x-csrf-token') ?? ''
      const csrfOk = await csrfSigner.verify(csrf, session.user)
      if (!csrfOk) return fail(new SecurityError(403, 'CSRF token invalid'))
      let body: { message?: unknown }
      try {
        body = (await req.json()) as { message?: unknown }
      } catch {
        return fail(new SecurityError(400, 'Invalid JSON'))
      }
      return json({ user: session.user, echoed: String(body.message ?? '') })
    },

    // KV (public, back-compat)
    'GET /kv': () => {
      const rows = stmtAll.all().map((r) => ({ key: r.key, value: JSON.parse(r.value) }))
      return json(rows)
    },
    'GET /kv/:key': (_req, params) => {
      const row = stmtGet.get(params['key'] as string)
      const value = row ? JSON.parse(row.value) : null
      return json({ value })
    },
    'PUT /kv/:key': async (req, params) => {
      const body = (await req.json()) as { value: unknown }
      stmtPut.run(params['key'] as string, JSON.stringify(body.value ?? null), Date.now())
      broadcast(params['key'] as string)
      return noContent()
    },
  },
})
