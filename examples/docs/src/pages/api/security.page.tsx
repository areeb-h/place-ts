// /api/security — @place/security overview.
// One place for sessions, RBAC, CSRF, signed tokens, rate-limit,
// secure cookies, and CSP defaults.

import { Link, page } from '@place/component'
import { CodeBlock } from '@place/design'
import { Callout } from '../../components/callout.tsx'

const SESSION_EX = `// Session capability — typed runtime slot for the authenticated user.
import { SessionCap, requireSession, type Session } from '@place/security'

// Install at the request boundary (typically in a layout's load()):
SessionCap.provide(
  {
    id: sessionId,
    userId: user.id,
    issuedAt: Date.now(),
    expiresAt: null,
    // Optional RBAC predicate; populated from your policy engine.
    can: (action) => policy.evaluate(user, action),
  },
  () => handler(req),
)

// Read inside any handler that requires auth — throws 401 if absent.
const session = requireSession()
const userId = session.userId

// Optional read — returns null if not installed.
const maybe = SessionCap.tryUse()`

const CAN_EX = `// <Can do="..."> — render-time RBAC gate (ADR 0044).
// Fails closed: no session, no .can, anything other than strict true.
// Synchronous predicate → SSR-safe, denied content never reaches HTML.
import { Can } from '@place/security'
import { Button } from '@place/design'

<Can do="post.delete">
  <Button intent="destructive" onClick={remove}>Delete</Button>
</Can>

<Can do="admin.users.read" otherwise="Access denied">
  <UserTable />
</Can>`

const FROM_STANDARD_EX = `// Schema-agnostic validation for action() inputs (ADR 0045).
// Any Standard Schema v1 validator works: Zod 3.24+, Valibot 0.36+,
// ArkType, Effect Schema. Field-level errors land in
// ActionError.payload.fields, narrowed via isValidationFailure.
import { z } from 'zod'
import { action, fromStandard, isValidationFailure } from '@place/component'

export const signup = action({
  path: 'POST /api/signup',
  input: fromStandard(z.object({
    email: z.string().email(),
    age: z.number().int().min(18),
  })),
  fn: async ({ email, age }) => ({ ok: true }),
})

// Client-side:
<Form action={signup} onError={(e) => {
  if (e instanceof ActionError && isValidationFailure(e.payload)) {
    emailErr.set(e.payload.fields.email ?? '')
  }
}}>
  {/* ... */}
</Form>`

const SIGNED_TOKEN_EX = `// HMAC-signed opaque payload. SHA-256, Web Crypto. Optional expiry.
import { signedToken } from '@place/security'

const sessionToken = signedToken<{ userId: string }>(SECRET, {
  expiresInSeconds: 60 * 60 * 24 * 7, // 7 days
})

const token = await sessionToken.sign({ userId: 'u123' })
const payload = await sessionToken.verify(token) // null on bad sig / expired

// Same primitive for any "trust this opaque string came from us
// unmodified" use case: session cookies, share links, magic-link tokens,
// signed download URLs.`

const CSRF_EX = `// Double-submit CSRF — auto-wired into action() + <Form> when
// security: 'standard' is on (the default). The primitive is exposed
// for apps that need it outside that path.
import { csrfToken } from '@place/security'

const csrf = csrfToken(SECRET)
const token = await csrf.issue(sessionId)
const ok = await csrf.verify(sessionId, submittedToken)`

const RATELIMIT_EX = `// In-memory token bucket. For multi-instance deployments wrap with
// a shared backend (Redis, KV) behind the same interface.
import { rateLimit } from '@place/security'

const checkLogin = rateLimit({ windowMs: 60_000, max: 5 })

// In a handler:
if (!checkLogin(req.headers.get('x-forwarded-for') ?? 'anon')) {
  return new Response('Too many requests', { status: 429 })
}`

const COOKIES_EX = `// Secure-by-default cookie helpers.
import { parseCookies, setCookieHeader, clearCookieHeader } from '@place/security'

// Parse incoming Cookie header.
const cookies = parseCookies(req.headers.get('cookie'))
const sessionCookie = cookies['place-session']

// Set: HttpOnly + Secure + SameSite=Lax baked in. Path=/ implicit.
const setCookie = setCookieHeader('place-session', token, {
  maxAgeSeconds: 60 * 60 * 24 * 7,
})
return new Response(body, { headers: { 'set-cookie': setCookie } })

// Clear:
const clear = clearCookieHeader('place-session')

// Localhost dev: pass insecure: true to drop the Secure flag.
// **Never in production** — the explicit name keeps the choice visible.`

const CSP_EX = `// Strict CSP starter. The serve({ security: 'standard' }) path
// applies this header with a fresh per-request nonce. No 'unsafe-inline'
// anywhere; auto-hash injection covers inline-style attrs (ADR 0014).
import { CSP_DEFAULTS, cspHeader } from '@place/security'

const header = cspHeader(CSP_DEFAULTS)

// Extend:
const custom = cspHeader({
  ...CSP_DEFAULTS,
  'connect-src': "'self' https://api.example.com",
})`

const ENVELOPE_EX = `// HMAC envelope — the substrate criticalAction() builds on.
// Signs a canonical metadata blob that binds the action, body hash,
// session, origin, counter, and iat. signEnvelope() returns a single
// wire string; verifyEnvelope() returns ok + typed reason on failure.
//
// Apps don't usually call these directly — criticalAction() does — but
// they're exposed for custom transports (websocket frames, signed
// pub/sub messages, etc.).
import { signEnvelope, verifyEnvelope, sha256Base64url } from '@place/security'

const wire = await signEnvelope(perSessionKey, {
  actionId: 'POST /__a/transfer',
  bodyHash: await sha256Base64url(bodyBytes),
  counter: nextCounter,
  iat: Math.floor(Date.now() / 1000),
  origin: 'https://app.example.com',
  sessionId: session.id,
  keyId: 'b20142',
})

const r = await verifyEnvelope(wire, {
  key: perSessionKey,
  body: bodyBytes,
  expectedActionId: 'POST /__a/transfer',
  expectedOrigin: 'https://app.example.com',
  expectedSessionId: session.id,
  maxAgeSec: 300,
})
if (!r.ok) reject(r.reason)  // bad-tag | stale | replay | wrong-session | …`

const MACAROON_EX = `// Macaroons — HMAC-chained bearer tokens with attenuating caveats.
// criticalAction({ requires }) uses them; the primitives are exposed
// for apps that want capability-based authorization elsewhere.
//
// Stanford / Google macaroons paper. Each caveat NARROWS the token's
// authority — a holder can attenuate without the root key (HMAC over
// existing tag), but cannot widen.
import {
  mintMacaroon,
  attenuate,
  verifyMacaroon,
  serializeMacaroon,
  deserializeMacaroon,
} from '@place/security'

// Mint at the auth boundary.
const root = await mintMacaroon(rootKey, session.id)

// Narrow to the user's actual permissions.
const scoped = await attenuate(root, 'op=comments.*')
const tenanted = await attenuate(scoped, 'app:tenant=acme')
const dated = await attenuate(tenanted, 'expires=2026-06-01T00:00:00Z')

// Send to the browser:
const wire = serializeMacaroon(dated)   // header-safe single-line string

// Verify on receive:
const r = await verifyMacaroon(deserializeMacaroon(wire), rootKey, {
  op: 'comments.create',
  origin: 'https://app.example.com',
  appVerifier: (key, value, ctx) => key === 'tenant' && value === requestTenant(),
})
if (!r.ok) reject(r.reason)
// reason ∈ 'bad-sig' | 'malformed' | 'unknown-caveat' | 'expired'
//        | 'wrong-op' | 'wrong-origin' | 'app-denied'

// Caveat grammar (v0.1, fail-closed on anything else):
//   expires=<ISO-8601 UTC>
//   origin=<URL>
//   op=<name>            // exact
//   op=<prefix>.*        // prefix match
//   op=*                 // wildcard
//   app:<key>=<value>    // requires appVerifier; rejected otherwise
//
// Multiple op= caveats compose by INTERSECTION (order-free).`

const AUDIT_EX = `// Hash-chained tamper-evident audit log. criticalAction() auto-appends
// one entry per invocation (request body hash + result hash bound).
// Apps emit additional entries via ctx.audit() inside the handler.
// Any modification to an existing entry breaks the chain and is caught
// by verify().
import { AuditLogCap, inMemoryAuditLog, useAuditLog } from '@place/security'

// At app boot:
AuditLogCap.install(inMemoryAuditLog({ maxEntries: 10_000 }))
//   ↑ ring-buffered in-memory adapter. Replace with a durable adapter
//     (postgres / S3 / object-store) that conforms to AuditLog.

// Inside any handler (criticalAction sets it up automatically; manual
// use is fine too):
const log = useAuditLog()
await log.append({
  actor: session.userId,
  action: 'admin.role.change',
  payloadHash: await sha256Base64url(payloadBytes),
  resultHash: '',
  keyId: 'b20142',
})

// Verify the chain anywhere:
const { ok, brokenAt } = await log.verify()
if (!ok) reportTampering(brokenAt)`

export default page('/security', {
  meta: '@place/security',
  view: () => (
    <article class="prose max-w-3xl">
      <h1>
        <code>@place/security</code>
      </h1>
      <p>
        Primitives the framework's <code>security: 'standard'</code> default builds on: signed
        tokens, double-submit CSRF, rate limiting, a capability-typed session slot, secure-by-
        default cookie helpers, strict CSP. <strong>Not an auth library</strong> — no OAuth dance,
        no JWT, no password hashing. The substrate every auth library needs, exposed as one package.
      </p>

      <Callout kind="note" title="Charter: secure-by-default">
        Insecure choices require explicit opt-in syntax (<code>{`{ insecure: true }`}</code>,{' '}
        <code>'unsafe-inline'</code> literal, …) so the audit trail in source is obvious. See{' '}
        <Link to="/concepts/security">Concepts: Security</Link> for the full pipeline.
      </Callout>

      <h2 id="session">
        <code>SessionCap</code> + <code>requireSession</code>
      </h2>
      <p>
        Capability-typed session. Apps populate it inside the request handler after their cookie
        lookup. Handlers that need an authenticated user call <code>requireSession()</code> which
        throws a typed <code>SecurityError</code> (401) when the slot is empty.
      </p>
      <CodeBlock code={SESSION_EX} />

      <h2 id="can">
        <code>&lt;Can do="..."&gt;</code> — RBAC gate (ADR 0044)
      </h2>
      <p>
        Renders its children only when the current session's <code>.can(action)</code> predicate
        returns strictly <code>true</code>. Fails closed by default. Synchronous predicate runs at
        render time inside a reactive function child, so the gate works pre-hydration in SSR —
        unauthorized content never appears in rendered HTML, never ships JS for the hidden island,
        and is invisible to view-source.
      </p>
      <CodeBlock code={CAN_EX} />
      <p>
        The framework does not ship a policy DSL. Wire any policy engine (Cerbos, Permify,
        hand-rolled) into <code>Session.can</code> at install time. See{' '}
        <Link to="/recipes/auth">Recipes: Authentication &amp; RBAC</Link> for the full session
        flow.
      </p>

      <h2 id="from-standard">
        <code>fromStandard</code> + <code>isValidationFailure</code> (ADR 0045)
      </h2>
      <p>
        Schema interop for <code>action()</code> inputs. Adapts any{' '}
        <a href="https://standardschema.dev">Standard Schema v1</a> validator (Zod 3.24+, Valibot
        0.36+, ArkType, Effect Schema) into an <code>ActionSchema&lt;T&gt;</code>. On validation
        failure, throws <code>ActionError(400, 'Validation failed', {`{ fields }`})</code>. Lives in{' '}
        <code>@place/component</code> (it's part of the action surface); re-documented here for
        discoverability.
      </p>
      <CodeBlock code={FROM_STANDARD_EX} />
      <p>
        See <Link to="/recipes/forms">Recipes: Forms &amp; actions</Link> for the full form-field
        wiring pattern.
      </p>

      <h2 id="signed-token">
        <code>signedToken&lt;T&gt;(secret)</code>
      </h2>
      <CodeBlock code={SIGNED_TOKEN_EX} />

      <h2 id="csrf">
        <code>csrfToken(secret)</code>
      </h2>
      <CodeBlock code={CSRF_EX} />

      <h2 id="rate-limit">
        <code>rateLimit(options)</code>
      </h2>
      <CodeBlock code={RATELIMIT_EX} />

      <h2 id="cookies">
        Cookies — <code>parseCookies</code>, <code>setCookieHeader</code>,{' '}
        <code>clearCookieHeader</code>
      </h2>
      <CodeBlock code={COOKIES_EX} />

      <h2 id="csp">
        CSP — <code>CSP_DEFAULTS</code> + <code>cspHeader</code>
      </h2>
      <CodeBlock code={CSP_EX} />

      <h2 id="envelope">
        Envelope — <code>signEnvelope</code> + <code>verifyEnvelope</code> (ADR 0055)
      </h2>
      <p>
        HMAC envelope substrate. The canonical metadata blob binds an <code>actionId</code>,
        body hash, monotonic counter, issued-at timestamp, origin, session id, and key id — then
        signs it with a per-session HMAC key. Constant-time verify on the way in. Used by{' '}
        <Link to="/api/critical-action">
          <code>criticalAction()</code>
        </Link>{' '}
        and exposed for custom transports (websocket frames, signed pub/sub messages).
      </p>
      <CodeBlock code={ENVELOPE_EX} />

      <h2 id="macaroon">
        Macaroons — <code>mintMacaroon</code> + <code>attenuate</code> + <code>verifyMacaroon</code> (ADR 0055)
      </h2>
      <p>
        HMAC-chained bearer tokens with attenuating caveats — the Stanford / Google paper, in 300
        lines. Apps mint a broad token at the auth boundary, narrow it to match the user's actual
        permissions, and pass the serialised wire string to the browser. Anyone holding the token
        can attenuate further (the chain extends) but cannot widen (that requires the root key).{' '}
        <code>criticalAction({'{ requires }'})</code> uses these structurally; the primitive is
        exposed for capability-based authorization in custom paths.
      </p>
      <CodeBlock code={MACAROON_EX} />
      <Callout kind="tip" title="Why macaroons and not predicates">
        <code>&lt;Can do="…"&gt;</code> is a render-time predicate — fast, sync, perfect for UI
        gating. Macaroons are <em>tokens</em>: they carry authority WITH the request, so a
        sub-system handling part of the work can trust an attenuated token without re-fetching the
        session. They compose. UI gating and request-time authorization are different jobs — this
        is the second one.
      </Callout>

      <h2 id="audit">
        Audit log — <code>AuditLogCap</code> + <code>inMemoryAuditLog</code> (ADR 0055)
      </h2>
      <p>
        Hash-chained tamper-evident log. Each entry binds the previous via{' '}
        <code>prev_hash = sha256(canonical(entry_{`{i-1}`}))</code>; any retroactive modification
        breaks <code>verify()</code> and reports the broken index.{' '}
        <code>criticalAction()</code> auto-appends one entry per invocation;{' '}
        <code>ctx.audit(event, payload?)</code> appends handler-emitted events alongside. The
        in-memory adapter is a ring buffer (default 10k entries); apps with retention requirements
        plug in a durable adapter conforming to the <code>AuditLog</code> interface.
      </p>
      <CodeBlock code={AUDIT_EX} />

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/api/critical-action">
            API: <code>criticalAction()</code> — uses the envelope, macaroon, and audit primitives
          </Link>
        </li>
        <li>
          <Link to="/concepts/security">Concepts: Security pipeline</Link>
        </li>
        <li>
          <Link to="/concepts/capabilities">Concepts: Capabilities</Link>
        </li>
        <li>
          <Link to="/recipes/auth">Recipes: Authentication &amp; RBAC</Link>
        </li>
        <li>
          <Link to="/recipes/forms">Recipes: Forms &amp; actions</Link>
        </li>
      </ul>
    </article>
  ),
})
