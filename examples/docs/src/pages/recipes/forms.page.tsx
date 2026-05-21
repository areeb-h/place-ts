// /recipes/forms — typed mutation with <Form>, action(), shape().
// JS-on and JS-off paths both supported by the same action.

import { Link, page } from '@place-ts/component'
import { CodeBlock } from '@place-ts/design'
import { Callout } from '../../components/callout.tsx'

const PAGE_ACTION = `// Co-located on a page — the natural shape for "form belongs to page".
const subscribe = page('/subscribe', {
  on: {
    submit: async (input: { email: string }) => {
      await emailList.add(input.email)
      return { ok: true }
    },
  },
  view: () => (
    <form onSubmit={(e) => {
      e.preventDefault()
      const fd = new FormData(e.target as HTMLFormElement)
      void subscribe.submit({ email: String(fd.get('email')) })
    }}>
      <input name="email" type="email" required />
      <button>Subscribe</button>
    </form>
  ),
})`

const STANDALONE = `// Standalone action — when the form lives on multiple pages or
// outside a page entirely (e.g. a global newsletter form in the footer).
import { action, Form, shape } from '@place-ts/component'

export const subscribe = action({
  path: 'POST /api/subscribe',
  input: shape({ email: 'string' }),
  fn: async ({ email }) => {
    await emailList.add(email)
    return { ok: true }
  },
})

// Anywhere:
<Form action={subscribe}>
  <input name="email" type="email" required />
  <button>Subscribe</button>
</Form>`

const VALIDATION = `// Bring your own validator — Zod 3.24+, Valibot 0.36+, ArkType,
// Effect Schema, or the built-in shape(). All Standard-Schema-
// compliant libraries plug in the same way via fromStandard().
import { z } from 'zod'
import { action, fromStandard } from '@place-ts/component'

const SubscribeIn = z.object({
  email: z.string().email(),
  source: z.enum(['footer', 'modal', 'inline']).default('footer'),
})

export const subscribe = action({
  path: 'POST /api/subscribe',
  input: fromStandard(SubscribeIn),
  fn: async (input) => {
    // input is typed by Zod's inferred output: { email: string; source: '...' }
    await emailList.add(input.email, input.source)
    return { ok: true }
  },
})`

const FIELD_ERRORS = `// Field-level errors via fromStandard + isValidationFailure +
// <Field error={...}>. The validator's per-field messages route to
// the matching <Field>'s error state cell automatically.
import { state } from '@place-ts/reactivity'
import { ActionError, Form, isValidationFailure } from '@place-ts/component'
import { Field, Input, Button } from '@place-ts/design'
import { signup } from './shared.action'

// One state cell per field. Apps that want sugar can compose a
// formErrors() helper that returns a Record<string, State<string>>.
const emailErr = state('')
const ageErr = state('')

<Form
  action={signup}
  onSuccess={() => {
    emailErr.set('')
    ageErr.set('')
  }}
  onError={(e) => {
    if (e instanceof ActionError && isValidationFailure(e.payload)) {
      emailErr.set(e.payload.fields.email ?? '')
      ageErr.set(e.payload.fields.age ?? '')
    }
  }}
>
  <Field label="Email" error={() => emailErr()}>
    <Input name="email" type="email" required />
  </Field>
  <Field label="Age" error={() => ageErr()}>
    <Input name="age" type="number" required />
  </Field>
  <Button type="submit">Sign up</Button>
</Form>

// On server failure → ActionError(400, "Validation failed", { fields })
// is thrown by fromStandard. onError narrows via isValidationFailure
// and routes each path to its <Field error={...}> state cell. No
// per-field plumbing on the server side; the validator's messages
// flow through structurally.`

export default page('/forms', {
  // No `meta:` — auto-title from `<h1>Forms & actions</h1>`.
  view: () => (
    <article class="prose max-w-2xl">
      <h1>Forms &amp; actions</h1>
      <p>
        Two patterns. Page-attached <code>on:</code> handlers when the form belongs to a page;
        standalone <code>action()</code> + <code>{`<Form>`}</code> when it travels.
      </p>

      <h2 id="page-attached">Page-attached</h2>
      <CodeBlock code={PAGE_ACTION} filename="src/pages/subscribe.page.tsx" />
      <p>
        Each entry in <code>on:</code> auto-registers at <code>POST {`{path}/_action/{key}`}</code>.
        The caller <code>{`subscribe.submit({...})`}</code> is typed; the URL is visible.
      </p>

      <h2 id="standalone">
        <code>action()</code> + <code>&lt;Form&gt;</code>
      </h2>
      <CodeBlock code={STANDALONE} />
      <p>
        <code>{`<Form>`}</code> works with JS enabled (fetch + JSON; typed return) and disabled
        (form-encoded POST; the action handles both). The full security pipeline applies either way.
      </p>

      <Callout kind="tip" title="Auto-CSRF is on">
        Every action requires a CSRF token. If the page's <code>load()</code> returns a{' '}
        <code>csrf</code> field, the framework injects it as a meta tag and <code>{`<Form>`}</code>{' '}
        + <code>action.call()</code> pick it up automatically. No per-form wiring.
      </Callout>

      <h2 id="validation">Validation</h2>
      <p>
        <code>fromStandard(schema)</code> adapts any{' '}
        <a href="https://standardschema.dev">Standard Schema v1</a> validator (Zod 3.24+, Valibot
        0.36+, ArkType, Effect Schema, …) into an <code>ActionSchema&lt;T&gt;</code>. The framework
        ships no validation dep; pick your library, the inferred output type flows.
      </p>
      <CodeBlock code={VALIDATION} />

      <h3 id="field-errors">Field-level errors</h3>
      <p>
        On validation failure, <code>fromStandard</code> throws{' '}
        <code>ActionError(400, 'Validation failed', {`{ fields }`})</code>. The <code>fields</code>{' '}
        map is keyed by dotted path (<code>email</code>, <code>profile.age</code>,{' '}
        <code>items.0.name</code>) → message. Narrow the payload via{' '}
        <code>isValidationFailure</code> and route each path to its{' '}
        <code>{`<Field error={...}>`}</code> state cell.
      </p>
      <CodeBlock code={FIELD_ERRORS} />

      <Callout kind="note" title="No bundled DSL">
        We don't ship a <code>definePolicy()</code> / form-state DSL on top. Standard Schema is the
        contract; apps wire whichever validator they already use. See{' '}
        <Link to="https://github.com/anthropics/place-ts/blob/main/docs/decisions/0045-from-standard-schema-interop.md">
          ADR 0045
        </Link>{' '}
        for the rationale.
      </Callout>

      <h2 id="security">Security pipeline</h2>
      <ul>
        <li>
          <strong>CSRF</strong> — token + double-submit cookie, validated before the handler runs.
        </li>
        <li>
          <strong>Same-origin</strong> — <code>Origin</code> / <code>Referer</code> header
          enforcement.
        </li>
        <li>
          <strong>Body size</strong> — configurable cap; default 1 MB.
        </li>
        <li>
          <strong>Prototype pollution</strong> — JSON parser strips <code>__proto__</code> and{' '}
          <code>constructor</code> keys.
        </li>
      </ul>

      <h2 id="see-also">See also</h2>
      <ul>
        <li>
          <Link to="/api/components">API: &lt;Form&gt;</Link>
        </li>
        <li>
          <Link to="/api/page">API: page() on:</Link>
        </li>
      </ul>
    </article>
  ),
})
