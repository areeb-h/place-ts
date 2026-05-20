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
        no JWT, no password hashing. The substrate every auth library needs, exposed as one
        package.
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
        failure, throws <code>ActionError(400, 'Validation failed', {`{ fields }`})</code>. Lives
        in <code>@place/component</code> (it's part of the action surface); re-documented here for
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

      <h2 id="see-also">See also</h2>
      <ul>
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
