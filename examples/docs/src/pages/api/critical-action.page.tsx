// /api/critical-action — criticalAction() high-assurance server actions.
// Envelope-signed, replay-protected, capability-gated, audit-logged.
// See ADR 0055 for the full design + threat model.

import { Link, page } from '@place-ts/component'
import { CodeBlock } from '@place-ts/design'
import { Callout } from '../../components/callout.tsx'

const SIG = `criticalAction<I, R>(def: {
  path: string
  input: (raw: unknown) => I
  fn: (input: I, ctx: CriticalActionCtx) => Promise<R> | R
  // Optional:
  requires?: readonly PermDeclaration[]   // capability gates (perm('op'))
  sameOrigin?: boolean                    // default true for state-changing methods
  maxBodyBytes?: number                   // default 1 MiB
  maxAgeSec?: number                      // default 300 (replay window)
  appCaveatVerifier?: (key, value, ctx) => boolean | Promise<boolean>
}): { call, handler, path, __isCriticalAction: true }`

const APP_BOOT = `// 1. Add a 32+ byte app secret. Every node in a multi-node deployment
//    derives the same per-session HMAC key from it.

import { app } from '@place-ts/component/server'

app({
  pages: [...],
  secret: process.env.PLACE_SECRET!,   // 32+ bytes, e.g. base64url(crypto.randomBytes(32))
}).run()

// The framework throws at app-config time if any criticalAction() is
// registered without a SessionCap install. Critical actions REQUIRE
// an authenticated session — the envelope binds session.id.`

const DEFINE = `import { criticalAction } from '@place-ts/component/server'
import { shape } from '@place-ts/component'

export const transferFunds = criticalAction({
  path: 'POST /__a/transfer',
  input: shape({ to: 'string', amountCents: 'number' }),
  fn: async (input, { session }) => {
    // session.userId is GUARANTEED non-null — the framework enforces
    // SessionCap before the handler runs. Envelope already verified.
    await ledger.transfer(session.userId, input.to, input.amountCents)
    return { ok: true }
  },
})`

const REGISTER = `// Same registration shape as action() — spread .handler into serve().
import { serve } from '@place-ts/component/server'
import { transferFunds, withdrawFunds } from './actions'

serve({
  routes: {
    ...transferFunds.handler,
    ...withdrawFunds.handler,
    '/': home,
  },
})`

const PERM_DECL = `import { criticalAction, perm } from '@place-ts/component/server'

export const deleteUser = criticalAction({
  path: 'POST /__a/users/delete',
  input: shape({ userId: 'string' }),
  // The macaroon attached to the request MUST permit admin.users.delete.
  // A macaroon scoped to admin.users.* OR admin.* OR * permits it;
  // a macaroon scoped to admin.posts.* does not.
  requires: [perm('admin.users.delete')],
  fn: async ({ userId }) => {
    await db.users.softDelete(userId)
    return { ok: true }
  },
})

// Multiple perms — ALL must be permitted by the request's macaroon.
export const moveDocument = criticalAction({
  path: 'POST /__a/docs/move',
  input: shape({ docId: 'string', folderId: 'string' }),
  requires: [perm('docs.write'), perm('folders.read')],
  fn: async (input) => { /* … */ return { ok: true } },
})`

const PROVISION = `// Server-side auth flow. After successful login, return BOTH the
// action key (for envelope signing) and a macaroon (for the
// capability check). Apps attenuate the macaroon to match the user's
// actual permissions before issuance.

import {
  provisionActionKey,
  provisionMacaroon,
} from '@place-ts/component/server'
import { attenuate, serializeMacaroon } from '@place-ts/security'

export const login = action({
  path: 'POST /api/login',
  input: shape({ email: 'string', password: 'string' }),
  fn: async ({ email, password }, ctx) => {
    const user = await authenticate(email, password)
    const session = await createSession(user)

    // Action key — for envelope signing on every criticalAction call.
    const action = await provisionActionKey(session.id)

    // Macaroon — the broad root authority. Apps attenuate to match
    // the user's actual capability set.
    const broad = await provisionMacaroon(session.id)
    const scoped = await policy.attenuateForUser(broad.macaroon, user)
    //   ↑ your app's helper. For example:
    //     attenuate(m, \`op=\${user.role === 'admin' ? '*' : 'comments.*'}\`)
    //     then attenuate(m, \`app:tenant=\${user.tenantId}\`)

    setCookieHeader(ctx.req, 'place_sid', session.id, { httpOnly: true, secure: true })
    return {
      action,
      macaroon: { macaroon: serializeMacaroon(scoped), expiresAt: broad.expiresAt },
    }
  },
})`

const INSTALL = `// Browser-side, right after login resolves.
// installActionKey imports the HMAC key as a non-extractable
// WebCrypto CryptoKey + persists to IndexedDB so reloads keep it.
// installMacaroon stores the serialised macaroon alongside.

import { installActionKey, installMacaroon } from '@place-ts/component/client'

const onLoginSuccess = async () => {
  const res = await login.call({ email, password })
  await installActionKey(res.action)
  await installMacaroon(res.macaroon)
  // From this point onward every criticalAction().call() picks them
  // up automatically — envelope is signed, macaroon header attached.
}

// On logout: drop both. Subsequent criticalAction calls 403.
import { clearActionKey, clearMacaroon } from '@place-ts/component/client'
await Promise.all([clearActionKey(), clearMacaroon()])`

const CALL = `// Client-side call() is identical to action().call() — no extra
// boilerplate, no manual envelope or macaroon handling. The framework
// signs + sends + verifies + audits.

import { transferFunds } from './actions'

try {
  const result = await transferFunds.call({ to: 'acct_123', amountCents: 5000 })
  //    ^? { ok: boolean }
} catch (e) {
  if (e instanceof ActionError && e.status === 403) {
    // 403 with body "Forbidden" — the server returns no detail on
    // which check failed (no-info-leak oracle). The audit log
    // captures the typed reason server-side.
  }
}`

const CTX_AUDIT = `// ctx.audit() — append custom events to the tamper-evident audit log
// from inside a handler. The framework auto-appends ONE entry per
// invocation (on success or failure); audit() adds MORE.

export const escalate = criticalAction({
  path: 'POST /__a/escalate',
  input: shape({ caseId: 'string', tier: 'number' }),
  requires: [perm('cases.escalate')],
  fn: async (input, ctx) => {
    const score = await fraudScore(input.caseId)
    if (score > 0.9) {
      await ctx.audit('fraud_score.high', { caseId: input.caseId, score })
    }
    if (input.tier >= 3) {
      await ctx.audit('kyc.escalated', { caseId: input.caseId })
    }
    await escalateCase(input.caseId, input.tier)
    return { ok: true }
  },
})

// Verification:
import { useAuditLog } from '@place-ts/security'
const log = useAuditLog()
const { ok, brokenAt } = await log.verify()
if (!ok) reportTampering(brokenAt)`

const APP_CAVEAT = `// app: caveats — app-defined namespace for tenant scoping etc.
// The verifier is invoked once per app: caveat at verify time.
// Fail-closed: if a macaroon carries app: caveats but no verifier is
// registered, the request is rejected.

export const readRecord = criticalAction({
  path: 'POST /__a/records/read',
  input: shape({ recordId: 'string' }),
  requires: [perm('records.read')],
  appCaveatVerifier: (key, value, { op }) => {
    if (key === 'tenant') {
      // Match the macaroon's tenant claim against the request context.
      return value === currentRequestTenant()
    }
    return false // unknown app: key → fail closed
  },
  fn: async ({ recordId }) => db.records.find(recordId),
})

// At provision time the app attenuates the macaroon with the tenant:
const scoped = await attenuate(
  await attenuate(broad.macaroon, 'op=records.*'),
  \`app:tenant=\${user.tenantId}\`,
)`

const VS_ACTION = `// action() vs criticalAction() at a glance:

//                         action()              criticalAction()
// CSRF                    auto-token            HMAC envelope (binds body hash)
// Replay                  (none — token reuse)  IPsec sliding window (per session)
// Body integrity          (none)                envelope binds sha256(body)
// Origin binding          same-origin guard     binds origin into envelope tag
// Action binding          path = path           binds action_id into envelope tag
// Session binding         SessionCap (optional) binds session.id into envelope tag
// Capability gate         ctx.session.can(...)  perm('op') verified via macaroon
// Audit                   (app-defined)         hash-chained log + ctx.audit()
// Cost per call           ~200 µs (validate)    ~205-215 µs (envelope + replay + verify)
//
// Use action() for most mutations. Reach for criticalAction() when:
//   - The action moves money, escalates privilege, or modifies records
//     that compliance cares about
//   - You need a tamper-evident audit trail
//   - You need capability-based authorization (per-tenant, per-scope)
//   - You need replay protection across multi-tab / multi-device
//     scenarios (action()'s CSRF token doesn't defend against replays
//     of a valid token from the same browser)`

export default page('/critical-action', {
  // No `meta:` — auto-title from `<h1>`.
  view: () => (
    <article class="prose max-w-3xl">
      <h1>
        <code>criticalAction()</code>
      </h1>
      <p>
        The high-assurance sibling of{' '}
        <Link to="/api/action">
          <code>action()</code>
        </Link>
        . Same author shape — one declaration produces a typed <code>.call()</code> and a route
        handler — but every request is verified against an HMAC envelope <em>before</em> the handler
        body runs. Envelope signing binds the request to its session, origin, action, body bytes,
        and a monotonic counter. Optional capability checks (<code>requires</code>) and
        tamper-evident audit logging complete the substrate.
      </p>
      <p>
        Designed for the actions where being wrong matters: payments, role changes, deletions,
        anything compliance audits. See{' '}
        <a href="https://github.com/anthropics/place-ts/blob/main/docs/decisions/0055-critical-action-high-assurance-server-actions.md">
          ADR 0055
        </a>{' '}
        for the threat model + standards mapping (OWASP ASVS 5.0, NIST SP 800-53 Rev 5, RFC 4303
        IPsec ESP anti-replay, the Stanford / Google macaroons paper).
      </p>

      <h2>Signature</h2>
      <CodeBlock code={SIG} />

      <h2>App boot — install the secret</h2>
      <CodeBlock code={APP_BOOT} />
      <p>
        The secret roots the daily per-session HMAC key derivation (HKDF-SHA256, info{' '}
        <code>"place-action-session-v1"</code>) and the macaroon key derivation (info{' '}
        <code>"place-macaroon-v1"</code> — domain-separated so a leak of one key doesn't help with
        the other). Rotate the secret by deploying with a new value; sessions issued under the old
        value remain valid for one day, then fail.
      </p>

      <h2>Defining a critical action</h2>
      <CodeBlock code={DEFINE} />

      <h2>Registering</h2>
      <CodeBlock code={REGISTER} />

      <h2>
        Capability gates — <code>perm()</code> + <code>requires:</code>
      </h2>
      <p>
        Macaroon-based capability checks. Each <code>perm('op.name')</code> in <code>requires</code>{' '}
        is verified independently against the macaroon attached to the request (
        <code>X-Place-Macaroon</code> header, sent automatically by <code>.call()</code> when one is
        installed). A macaroon with no <code>op=</code> caveats permits everything; with{' '}
        <code>op=admin.*</code> it permits any <code>admin.*</code>; with{' '}
        <code>op=admin.users.delete</code> it permits only that exact op. Multiple <code>op=</code>{' '}
        caveats compose by intersection — order doesn't matter.
      </p>
      <CodeBlock code={PERM_DECL} />
      <Callout kind="tip" title="Attenuation, not amplification">
        Anyone holding a macaroon can attenuate it further (the chain extends — new HMAC keyed on
        the existing tag) but cannot widen it (that would require the root key, which never leaves
        the server). A captured token narrows; it doesn't escalate.
      </Callout>

      <h2>Auth flow — provision both keys</h2>
      <p>
        Apps mint per-session HMAC keys + macaroons during their auth handler. The framework
        deliberately doesn't auto-attach an auth endpoint — your login / signup / refresh flow is
        app-specific (OAuth, password, magic link, …) and the key delivery rides whichever response
        shape you already use.
      </p>
      <CodeBlock code={PROVISION} />
      <CodeBlock code={INSTALL} />
      <Callout kind="note" title="Why non-extractable">
        <code>installActionKey()</code> imports the raw bytes as a WebCrypto <code>CryptoKey</code>{' '}
        with <code>extractable: false</code>. Once imported, JavaScript on the page cannot read the
        bytes back — only use them to sign. This bounds the impact of an XSS bug: an attacker who
        runs in the page context can still <em>use</em> the key (to sign for actions the user could
        perform anyway), but cannot exfiltrate it for offline use. The macaroon wire string IS
        readable from IndexedDB (it's a bearer token by design), so attenuate broadly server-side
        and use <code>expires=</code> caveats to bound its lifetime.
      </Callout>

      <h2>Calling from the client</h2>
      <CodeBlock code={CALL} />

      <h2>
        Custom audit events — <code>ctx.audit()</code>
      </h2>
      <p>
        Every critical action invocation auto-appends one tamper-evident entry to the audit log
        (success: <code>action</code> + payload-hash + result-hash; failure:{' '}
        <code>action#error</code>+ payload-hash, no result-hash).{' '}
        <code>ctx.audit(event, payload?)</code> appends additional entries with whatever
        handler-emitted context the action wants to record. Entries are hash-chained — any
        retroactive modification breaks <code>verify()</code>.
      </p>
      <CodeBlock code={CTX_AUDIT} />

      <h2>
        <code>app:</code> caveats — tenant scoping etc.
      </h2>
      <CodeBlock code={APP_CAVEAT} />

      <h2>
        <code>action()</code> vs <code>criticalAction()</code>
      </h2>
      <CodeBlock code={VS_ACTION} lang="text" />

      <h2>
        What's enforced before <code>fn</code> runs
      </h2>
      <ol>
        <li>Same-origin guard (cross-origin → 403).</li>
        <li>
          Content-Length pre-check against <code>maxBodyBytes</code> (oversize → 413).
        </li>
        <li>
          <code>SessionCap.tryUse()</code> — no session → 403.
        </li>
        <li>
          <code>X-Place-Envelope</code> header present → else 403.
        </li>
        <li>Read body bytes; size guard again (post-stream).</li>
        <li>
          Verify envelope: constant-time HMAC compare on tag, then check <code>action_id</code> +{' '}
          <code>origin</code> + <code>session_id</code> + <code>body_hash</code> + <code>iat</code>{' '}
          within <code>maxAgeSec</code>. Tries current day then previous day for clock-rollover
          tolerance.
        </li>
        <li>
          Replay defense via <code>NonceStoreCap</code> (IPsec ESP sliding window per session).
        </li>
        <li>
          When <code>requires</code> is non-empty: deserialize <code>X-Place-Macaroon</code>; derive
          macaroon key; verify HMAC chain + every caveat; check each declared <code>perm()</code>{' '}
          against the macaroon's effective op-authority.
        </li>
        <li>JSON parse + prototype-pollution guard.</li>
        <li>
          Schema validate (<code>def.input</code>) — failure → 400.
        </li>
        <li>
          Run <code>fn</code>; auto-append audit entry; return JSON.
        </li>
      </ol>
      <p>
        Every failure returns <code>403 Forbidden</code> with identical body bytes — the typed
        reason is logged server-side but not exposed on the wire (no-info-leak oracle).
      </p>

      <h2>Related</h2>
      <ul>
        <li>
          <Link to="/api/action">
            <code>action()</code> — non-critical actions
          </Link>
        </li>
        <li>
          <Link to="/api/security">
            <code>@place-ts/security</code> — macaroon primitive, session, RBAC, CSP
          </Link>
        </li>
        <li>
          <Link to="/concepts/security">Security concept — full pipeline</Link>
        </li>
        <li>
          <Link to="/recipes/auth">Auth recipe — full provisioning flow</Link>
        </li>
      </ul>
    </article>
  ),
})
