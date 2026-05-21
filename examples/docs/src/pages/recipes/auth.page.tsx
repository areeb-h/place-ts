// /recipes/auth — session cookie + load() guard + redirect on
// unauthenticated. The shape works for OAuth, magic links, and any
// custom session scheme.

import { Link, page } from '@place/component'
import { CodeBlock } from '@place/design'
import { Callout } from '../../components/callout.tsx'

const SESSION_CAP = `// src/auth.ts
import { defineCapability } from '@place/capability'

interface SessionStore {
  get(req: Request): Promise<Session | null>
  set(user: User): { value: string; cookie: string }
  clear(): { cookie: string }
}

export const SessionCap = defineCapability<SessionStore>('Session')`

const GUARD = `// Reusable layout that guards every page under it.
import { layout } from '@place/component'
import { SessionCap } from '../auth'

export const requireAuth = layout({
  load: async ({ req }) => {
    const session = await SessionCap.use().get(req)
    if (!session) throw redirect('/login?next=' + encodeURIComponent(req.url))
    return { user: session.user }
  },
  view: ({ children, user }) => (
    <>
      <UserBadge name={user.name} />
      {children}
    </>
  ),
})

// Usage:
page('/dashboard', {
  layout: [rootLayout, requireAuth],
  view: ({ user }) => <Dash user={user} />,
})`

const CAN_EX = `// <Can> — render-time RBAC gate (T16-E, ADR 0044).
// Renders its children only when session.can(action) returns true.
// Fails closed (no session, no .can predicate, anything other than
// strict true → renders \`otherwise\` or nothing). Synchronous
// predicate → works pre-hydration in SSR; denied content NEVER
// appears in rendered HTML, NEVER ships JS for the hidden island.
import { Can } from '@place/security'
import { Button } from '@place/design'

<Can do="post.delete">
  <Button intent="destructive" onClick={remove}>Delete</Button>
</Can>

<Can do="admin.users.read" otherwise="You don't have access.">
  <UserTable />
</Can>

// Populate Session.can at session-install time from whatever policy
// engine you use — Cerbos, Permify, hand-rolled RBAC. The framework
// stays out of the policy DSL business.
import { SessionCap } from '@place/security'

SessionCap.provide(
  {
    id, userId, issuedAt, expiresAt,
    can: (action) => policy.evaluate(userId, action),
  },
  () => handler(req),
)`

const LOGIN = `page('/login', {
  on: {
    submit: async ({ email, password }: Creds, { req }) => {
      const user = await verify(email, password)
      if (!user) return { ok: false, error: 'invalid' }
      const { cookie } = SessionCap.use().set(user)
      return new Response(null, {
        status: 302,
        headers: { location: '/dashboard', 'set-cookie': cookie },
      })
    },
  },
  view: () => <LoginForm />,
})`

const CRITICAL_PROVISION = `// Auth flow for apps that use criticalAction() — provision both the
// HMAC action key (envelope signing) and a macaroon (capability gate).
// The /login response returns BOTH; the browser installs them after
// success.
import {
  provisionActionKey,
  provisionMacaroon,
} from '@place/component/server'
import { attenuate, serializeMacaroon } from '@place/security'

export const login = action({
  path: 'POST /api/login',
  input: shape({ email: 'string', password: 'string' }),
  fn: async ({ email, password }, ctx) => {
    const user = await verify(email, password)
    if (!user) throw new ActionError(401, 'invalid')

    const session = await createSession(user)
    setCookieHeader(ctx.req, 'place_sid', session.id, { httpOnly: true, secure: true })

    // 1. Action key — for envelope signing on every criticalAction call.
    const action = await provisionActionKey(session.id)

    // 2. Macaroon — broad root, then attenuate to the user's ops.
    const broad = await provisionMacaroon(session.id)
    const scoped = await attenuate(
      broad.macaroon,
      \`op=\${user.role === 'admin' ? '*' : 'comments.*,posts.read'.split(',')[0]}\`,
    )
    const tenanted = await attenuate(scoped, \`app:tenant=\${user.tenantId}\`)

    return {
      action,
      macaroon: {
        macaroon: serializeMacaroon(tenanted),
        expiresAt: broad.expiresAt,
      },
    }
  },
})`

const CRITICAL_INSTALL = `// Browser side, after login resolves. Both helpers are idempotent —
// re-installing replaces the previous values. On logout, drop both.
import {
  installActionKey,
  installMacaroon,
  clearActionKey,
  clearMacaroon,
} from '@place/component/client'

async function signIn(email: string, password: string) {
  const res = await login.call({ email, password })
  await installActionKey(res.action)
  await installMacaroon(res.macaroon)
  // From here, every criticalAction().call() signs + sends both
  // headers automatically.
}

async function signOut() {
  await Promise.all([clearActionKey(), clearMacaroon()])
}`

export default page('/auth', {
  // No `meta:` — auto-title from `<h1>Authentication</h1>`.
  view: () => (
    <article class="prose max-w-2xl">
      <h1>Authentication</h1>
      <p>
        Sessions live in a cookie, guards live in a layout's <code>load()</code>, and the framework
        flows the typed user into every page underneath. No middleware DSL, no global
        request/response pipeline — just composition.
      </p>

      <h2 id="session-store">Session store as a capability</h2>
      <CodeBlock code={SESSION_CAP} />
      <p>
        Express the contract once. Swap implementations (in-memory for tests, KV in prod) without
        touching consumers.
      </p>

      <h2 id="guard">Guard via a layout's load()</h2>
      <CodeBlock code={GUARD} />
      <p>
        A layout's <code>load()</code> can throw a <code>redirect()</code> to short-circuit the
        page's render. The user object flows into every nested page via <code>loadData</code>, typed
        end-to-end.
      </p>

      <h2 id="login">Login + set-cookie</h2>
      <CodeBlock code={LOGIN} />

      <Callout kind="warn" title="Don't roll your own crypto">
        Use <code>oslo</code>, <code>iron-session</code>, or your platform's built-in session
        primitive for signing. place's contribution is the composition story — the crypto is yours.
      </Callout>

      <h2 id="rbac">
        RBAC: <code>&lt;Can&gt;</code>
      </h2>
      <p>
        Once a session is installed, gate UI on a per-action predicate. <code>&lt;Can&gt;</code>{' '}
        reads <code>SessionCap.tryUse()?.can?.(action)</code> at render time and fails closed — if
        there's no session, no <code>.can</code>, or the predicate doesn't return strictly{' '}
        <code>true</code>, the denied content is never emitted. Because the check is synchronous,
        the gate works pre-hydration; unauthorized content stays out of <em>view-source</em>, not
        just hidden via CSS.
      </p>
      <CodeBlock code={CAN_EX} />
      <p>
        <code>&lt;Can&gt;</code> lives in <code>@place/security</code> (data lives there, not in the
        design library). The framework doesn't ship a policy DSL — apps wire any authorization
        engine (Cerbos, Permify, hand-rolled) into <code>Session.can</code> at install time. See{' '}
        <a href="https://github.com/anthropics/place-ts/blob/main/docs/decisions/0044-can-rbac-gate.md">
          ADR 0044
        </a>
        .
      </p>

      <h2 id="critical-action">
        High-assurance actions: provisioning for <code>criticalAction()</code>
      </h2>
      <p>
        Apps that use{' '}
        <Link to="/api/critical-action">
          <code>criticalAction()</code>
        </Link>{' '}
        provision a per-session HMAC key (for envelope signing) and a macaroon (for capability
        gates). The auth handler returns both; the browser installs them as part of the sign-in
        flow.
      </p>
      <CodeBlock code={CRITICAL_PROVISION} />
      <CodeBlock code={CRITICAL_INSTALL} />
      <Callout kind="tip" title="<Can> and macaroons coexist">
        <code>&lt;Can&gt;</code> is the UI gate; macaroons are the request-time gate. Same logical
        permission, different jobs — one hides the button, the other refuses to run the action when
        the button is clicked anyway (via DevTools, a stale tab, a replayed request). Wire both off
        the same policy data, attenuate the macaroon to match the user's effective permissions at
        auth time. Macaroons attenuate further on the server inside delegating flows;{' '}
        <code>&lt;Can&gt;</code> stays render-time.
      </Callout>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/concepts/capabilities">Concepts: capabilities</Link>
        </li>
        <li>
          <Link to="/api/layout">API: layout()</Link>
        </li>
        <li>
          <Link to="/api/critical-action">API: criticalAction()</Link>
        </li>
        <li>
          <Link to="/concepts/security">Concepts: security pipeline</Link>
        </li>
      </ul>
    </article>
  ),
})
