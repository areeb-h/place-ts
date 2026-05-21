// /concepts/security — security defaults in place. CSP, CSRF,
// same-origin, body-limit, prototype-pollution guard, what each one
// stops, how the presets compose, and how to tighten or loosen.

import { Link, page } from '@place/component'
import { CodeBlock } from '@place/design'
import { Callout } from '../../components/callout.tsx'

const PRESET = `app({
  pages: [...],
  security: 'standard',  // 'standard' | 'strict' | 'off' | { ...custom }
}).run()`

const STANDARD = `// security: 'standard' enables:
//   - Content-Security-Policy (strict, no inline scripts/styles)
//   - X-Content-Type-Options: nosniff
//   - X-Frame-Options: DENY
//   - Referrer-Policy: strict-origin-when-cross-origin
//   - Permissions-Policy: deny camera/mic/geo/USB/payment/etc.
//   - Cross-Origin-Opener-Policy: same-origin
//   - Auto-CSRF token injection + same-origin enforcement on actions
//   - 1 MB body-size limit on action() bodies
//   - Prototype-pollution guard (rejects __proto__, constructor, prototype keys)`

const STRICT = `// security: 'strict' adds:
//   - Cross-Origin-Embedder-Policy: require-corp  (tightens to SAB-eligible)
//   - Stricter CSP (no 'unsafe-inline' fallbacks; no eval)
//   - 256 KB body-size limit on action() bodies`

const CSP_DIRECTIVES = `// What ships when security: 'standard':
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-<random>';
  style-src 'self' 'nonce-<random>';
  img-src 'self' data:;
  font-src 'self' data:;
  connect-src 'self';
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';`

const STYLE_CSP = `// Inline style="…" attributes that SSR emits are CSP-safe by
// per-response hash injection. The framework collects every inline
// style attribute value while rendering, SHA-256 hashes them, and
// adds 'unsafe-hashes' + each 'sha256-<hash>' to the response's
// style-src CSP directive. Pages with no inline styles ship a
// tight 'self'-only style-src; pages that do ship exactly the hashes
// they need.

<div style={\`color: red;\`}>Hi</div>
// SSR emits: <div style="color: red;">Hi</div>
// CSP gets:  style-src 'self' 'unsafe-hashes' 'sha256-<hash>';

// Reactive style bindings (style:transform, style:opacity) write
// through element.style.setProperty() at hydration — no inline
// attribute, no hash needed.
<div style:transform={() => \`translateX(\${x()}px)\`} />
// → el.style.setProperty('transform', \`translateX(\${x()}px)\`)`

const CSRF = `// Auto-CSRF: when load() returns { csrf }, the framework injects a
// <meta name="csrf-token"> in the SSR'd <head>. <Form> and
// action.call() auto-read it. Zero developer wiring.

load: async () => ({
  csrf: await issueCsrfToken(),
  user: await getUser(),
})

// On the client, the action handler verifies the token automatically:
const updateProfile = action({
  path: '/profile/update',
  input: shape({ name: 'string' }),
  fn: async (input) => { /* token already validated */ },
})`

const SAME_ORIGIN = `// Same-origin: state-changing actions reject cross-origin requests
// by default. Set the allowed origins in app() if you need to
// allowlist a specific host:

app({
  pages: [...],
  security: {
    preset: 'standard',
    sameOrigin: ['https://app.example.com', 'https://staging.example.com'],
  },
}).run()`

const HIGH_ASSURANCE = `// criticalAction() — the high-assurance sibling of action(). Same
// author shape; every request is verified against an HMAC envelope
// BEFORE the handler body runs. ADR 0055; OWASP ASVS 5.0 V11/V13;
// NIST SP 800-53 Rev 5 AU-10 + SI-7; RFC 4303 (IPsec ESP anti-replay).
//
// Wire format (browser → server):
//
//   POST /__a/transferFunds
//   X-Place-Envelope: <base64url(canonical)>.<base64url(tag)>
//   X-Place-Macaroon: <serialised macaroon>   ← when requires: is set
//   Content-Type: application/json
//
//   {"to":"acct_123","amountCents":5000}
//
// The canonical envelope binds:
//   v=1
//   action_id   — METHOD + path; envelope minted for /deposit fails on /withdraw
//   body_hash   — sha256(body bytes); flipping a byte in the body fails
//   counter     — monotonic per session; replay is rejected
//   iat         — issued-at unix seconds; maxAgeSec bounds the window
//   origin      — request origin; cross-site reuse fails
//   session_id  — session.id; user A's envelope rejected for user B
//   key_id      — daily-rotation key id

import { criticalAction, perm } from '@place/component/server'

export const transferFunds = criticalAction({
  path: 'POST /__a/transfer',
  input: shape({ to: 'string', amountCents: 'number' }),
  requires: [perm('payments.transfer')],
  fn: async (input, { session }) => {
    // session GUARANTEED non-null. Envelope verified. Macaroon checked.
    await ledger.transfer(session.userId, input.to, input.amountCents)
    return { ok: true }
  },
})`

export default page('/security', {
  // No `meta:` — auto-title from `<h1>Security</h1>`.
  view: () => (
    <article class="prose max-w-3xl">
      <h1>Security</h1>
      <p>
        place ships with security defaults that are <strong>on by default</strong>. The presets are
        named values, not opt-in arrays of headers to maintain — pick <code>'standard'</code> or{' '}
        <code>'strict'</code>, and the framework wires CSP, CSRF, same-origin enforcement, body size
        limits, and prototype-pollution guards in one shot.
      </p>

      <h2>Pick a preset</h2>
      <CodeBlock code={PRESET} />

      <h2>
        What <code>'standard'</code> enables
      </h2>
      <CodeBlock code={STANDARD} />

      <h2>
        What <code>'strict'</code> adds
      </h2>
      <CodeBlock code={STRICT} />

      <h2>Content-Security-Policy</h2>
      <p>
        place's strict CSP is the framework's first-class output, not an afterthought. The
        directives that ship under <code>'standard'</code>:
      </p>
      <CodeBlock code={CSP_DIRECTIVES} lang="text" />

      <Callout kind="tip" title="Per-response hashes, never 'unsafe-inline'">
        <code>script-src</code> uses per-request nonces; the framework's SPA-nav runtime is the only
        inline script and it carries the request nonce. <code>style-src</code> uses per-response
        SHA-256 hashes for any inline <code>style="…"</code> attribute the SSR actually emitted — so
        the directive is tight without breaking author-written inline styles. Reactive{' '}
        <code>style:*</code> bindings still write through <code>setProperty()</code> on hydration
        and need no hash.
      </Callout>

      <h3>
        How inline styles + <code>style:*</code> directives stay CSP-safe
      </h3>
      <p>
        SSR renders inline <code>style="…"</code> attrs verbatim, but the framework collects every
        value it emits during the render and adds <code>'unsafe-hashes' 'sha256-&lt;hash&gt;'</code>{' '}
        to the response's <code>style-src</code>. ISR cache hits reuse the same hash list, so the
        CSP is byte-stable across cache + live renders. Reactive bindings stay out of the SSR'd HTML
        entirely.
      </p>
      <CodeBlock code={STYLE_CSP} />

      <h2>Auto-CSRF</h2>
      <p>
        State-changing routes (POST / PUT / DELETE) verify a same-origin CSRF token by default. The
        token issuance is zero-config — return a <code>csrf</code> field from <code>load()</code>{' '}
        and the framework injects a <code>&lt;meta name="csrf-token"&gt;</code> into the head; the{' '}
        client transport reads it back when calling actions.
      </p>
      <CodeBlock code={CSRF} />

      <h2>Same-origin enforcement</h2>
      <p>
        <code>action()</code> handlers reject cross-origin requests unless the origin is in the
        allowlist. Override the default if you legitimately need cross-origin requests:
      </p>
      <CodeBlock code={SAME_ORIGIN} />

      <h2>Body-size + prototype-pollution guards</h2>
      <p>
        <code>action()</code> enforces a body-size limit (1 MB on <code>'standard'</code>, 256 KB on{' '}
        <code>'strict'</code>) before any user code runs. JSON parsing rejects keys named{' '}
        <code>__proto__</code>, <code>constructor</code>, or <code>prototype</code> — the
        single-line patch that closes the entire class of prototype-pollution exploits.
      </p>

      <Callout kind="warn" title="Don't relax for ergonomics">
        The security defaults stay on for a reason. If a feature in your app fights with{' '}
        <code>'standard'</code>, that's signal — the framework documents the failure mode at the
        violation site (CSP report, body-too-large 413, CSRF reject 403). Read those, don't relax
        the defaults.
      </Callout>

      <h2>
        High-assurance actions — <code>criticalAction()</code>
      </h2>
      <p>
        For mutations where being wrong matters (payments, role changes, deletions, anything
        compliance audits), <code>action()</code>'s same-origin + CSRF defaults are not enough. A
        valid CSRF token can be replayed; a same-origin XSS bug can still drive an{' '}
        <code>action()</code> handler with any body. <code>criticalAction()</code> raises every
        request to a signed HMAC envelope that binds the session, origin, action, body bytes, and a
        monotonic counter — and gates execution behind macaroon-based capability checks.
      </p>
      <CodeBlock code={HIGH_ASSURANCE} />
      <p>
        The pipeline that runs before <code>fn</code>:
      </p>
      <ol>
        <li>Same-origin guard.</li>
        <li>Body-size pre-check (Content-Length).</li>
        <li>SessionCap required (framework throws at app-boot if absent).</li>
        <li>
          Envelope verify: constant-time HMAC compare, then check <code>action_id</code>,{' '}
          <code>origin</code>, <code>session_id</code>, <code>body_hash</code>, freshness window.
        </li>
        <li>Replay defense via IPsec ESP sliding-window counter store (RFC 4303).</li>
        <li>
          Macaroon verify (when <code>requires</code> is set) — caveat chain + op-intersection
          check.
        </li>
        <li>JSON parse + prototype-pollution guard.</li>
        <li>Schema validate.</li>
        <li>
          Run <code>fn</code>; auto-append entry to the hash-chained audit log; return JSON.
        </li>
      </ol>
      <p>
        Total added crypto: ~5–15 µs per request. Every failure returns <code>403</code> with
        identical body bytes (typed reason logged server-side, not on the wire). See{' '}
        <Link to="/api/critical-action">
          <code>criticalAction()</code> API ref
        </Link>{' '}
        for the full surface; ADR 0055 has the threat model + standards mapping.
      </p>

      <h2>Related</h2>
      <ul>
        <li>
          <Link to="/api/page">
            <code>page({'{ load, on }'})</code> — server-side data + actions
          </Link>
        </li>
        <li>
          <Link to="/api/critical-action">
            <code>criticalAction()</code> — high-assurance API ref
          </Link>
        </li>
        <li>
          <Link to="/recipes/forms">Forms &amp; actions recipe</Link>
        </li>
        <li>
          <Link to="/recipes/auth">Authentication recipe</Link>
        </li>
      </ul>
    </article>
  ),
})
