// /api/action — action() typed RPC. End-to-end-typed server functions
// callable from the client by the same name with the same input shape.

import { Link, page } from '@place-ts/component'
import { CodeBlock } from '@place-ts/design'
import { Callout } from '../../components/callout.tsx'

const SIG = `action<I, O>(def: {
  path: string
  input: (raw: unknown) => I        // validator (schema-agnostic)
  fn: (input: I, ctx: ActionCtx) => Promise<O> | O
}): { handler, call, path }`

const SHAPE = `import { action, shape } from '@place-ts/component'

export const updateProfile = action({
  path: '/profile/update',
  input: shape({
    name: 'string',
    age: 'number?',
  }),
  fn: async (input, { req }) => {
    await db.users.update(currentUser(req).id, input)
    return { ok: true }
  },
})`

const REGISTER = `// An action() result carries a \`.handler\` — a { 'METHOD /path':
// fn } route-table fragment. Spread it into serve()'s routes:
import { serve } from '@place-ts/component/server'
import { updateProfile, deleteAccount, createPost } from './actions'

serve({
  routes: {
    ...updateProfile.handler,
    ...deleteAccount.handler,
    ...createPost.handler,
    // page routes alongside:
    '/': home,
  },
})

// Co-located on a page instead? Use page({ on: { … } }) — the
// handler registers automatically under {pagePath}/_action/{key}.
// See "Page-co-located actions" below.`

const FROM_STANDARD = `// Schema interop — fromStandard() adapts any Standard Schema v1
// validator (Zod 3.24+, Valibot 0.36+, ArkType, Effect Schema) into
// the (raw: unknown) => T shape \`input\` expects. No validation dep.
import { z } from 'zod'
import { action, fromStandard, isValidationFailure } from '@place-ts/component'

export const signup = action({
  path: 'POST /api/signup',
  input: fromStandard(z.object({
    email: z.string().email(),
    age: z.number().int().min(18),
  })),
  fn: async ({ email, age }) => ({ ok: true }),
})

// On validation failure fromStandard throws
// ActionError(400, 'Validation failed', { fields }) — narrow the
// payload with isValidationFailure to route per-field messages.`

const CALL = `// Client-side: call() is fully type-inferred — input matches the
// declared shape; the return type is inferred from fn()'s return.

import { updateProfile } from './actions'

const onSubmit = async () => {
  const result = await updateProfile.call({ name: 'Ada' })
  //    ^? { ok: boolean }
  if (result.ok) toast.success('Saved!')
}`

const ON_DICT = `// For page-co-located actions, use the on: dict on page(). The
// framework auto-CSRFs and auto-types the caller; the path is derived
// from the page's path + handler name.

export default page('/posts/:id/edit', {
  meta: { title: 'Edit post' },
  load: async ({ params }) => ({ post: await db.posts.find(params.id) }),
  on: {
    save: async (input: { title: string }, { params }) => {
      await db.posts.update(params.id, input)
      return { ok: true }
    },
  },
  view: ({ post, on }) => (
    <Form
      action={on.save}              // typed caller — input shape inferred
      defaults={{ title: post.title }}
    >
      <Input name="title" />
      <Button type="submit">Save</Button>
    </Form>
  ),
})`

const ERROR = `// action errors are STRUCTURED, not stringified. The client sees a
// typed ActionError with .status and .payload.

try {
  await updateProfile.call({ name: '' })
} catch (e) {
  if (e instanceof ActionError && e.status === 400) {
    // .message is the server's error string; .payload carries any
    // structured data the handler attached (e.g. fromStandard's
    // { fields } map on validation failure).
    toast.error(e.message)
  }
}`

const CACHE = `// Per-request capability scopes guarantee actions can't accidentally
// share cache entries across users. cache(fn) uses the request scope
// as part of the cache key; auth-bleed bugs (Next #86538) don't reach
// production here.

const getUser = cache(async (id: string) => db.users.find(id))

export const reactToPost = action({
  path: '/posts/react',
  input: shape({ postId: 'string' }),
  fn: async (input, { req }) => {
    const user = await getUser(currentUserId(req))
    // ^ scoped to THIS request — no bleed across concurrent requests
    return reactToPost(input.postId, user.id)
  },
})`

export default page('/action', {
  // No `meta:` — auto-title from `<h1><code>action()</code></h1>`.
  view: () => (
    <article class="prose max-w-3xl">
      <h1>
        <code>action()</code>
      </h1>
      <p>
        <code>action()</code> declares a server-only function that the client can call by name with
        an inferred input shape and an inferred return type. No Babel pass, no encrypted action IDs,
        no <code>'use server'</code> directive — the function lives in a file with a server-only
        type and the framework strips it from the client bundle.
      </p>

      <h2>Signature</h2>
      <CodeBlock code={SIG} />
      <p>
        <code>I</code> is the validated-input type (output of <code>input</code>); <code>O</code> is
        the return type of <code>fn</code>. The handler validates the body, enforces same-origin +
        body-size + prototype-pollution defaults, then runs <code>fn</code>.
      </p>

      <h2>Defining an action</h2>
      <CodeBlock code={SHAPE} />
      <p>
        <code>shape({})</code> is the schema-agnostic validator the framework ships;{' '}
        <code>input</code> accepts any <code>(raw: unknown) =&gt; T</code> function, so plug in Zod,
        Valibot, or yours.
      </p>

      <h2>Registering</h2>
      <p>
        There is no <code>actions</code> field on <code>app()</code>. An <code>action()</code>{' '}
        result exposes a <code>.handler</code> — a <code>{`{ 'METHOD /path': fn }`}</code> fragment
        of the route table. Spread it into <code>serve()</code>'s <code>routes</code> alongside your
        page routes; path uniqueness is checked when the route table is built.
      </p>
      <CodeBlock code={REGISTER} />

      <h2>Schema interop — fromStandard()</h2>
      <p>
        <code>input</code> accepts any <code>(raw: unknown) =&gt; T</code> function.{' '}
        <code>fromStandard()</code> adapts any{' '}
        <a href="https://standardschema.dev">Standard Schema v1</a> validator — Zod 3.24+, Valibot
        0.36+, ArkType, Effect Schema — into that shape, with structured field-level errors. The
        framework ships no validation dependency.
      </p>
      <CodeBlock code={FROM_STANDARD} />

      <h2>Calling from the client</h2>
      <CodeBlock code={CALL} />

      <Callout kind="tip" title="Page-co-located actions">
        For mutations that belong to a single page, use the <code>on:</code> dict on{' '}
        <code>page()</code>. Auto-CSRF, auto-typed callers, and the path is derived from page +
        handler name — zero boilerplate.
      </Callout>
      <CodeBlock code={ON_DICT} />

      <h2>Structured errors</h2>
      <p>
        Thrown errors don't get stringified across the wire. <code>action.call()</code> resolves
        with the typed return on 2xx, or throws an <code>ActionError</code> with{' '}
        <code>.status</code>, <code>.message</code>, and a structured <code>.payload</code> on
        non-2xx.
      </p>
      <CodeBlock code={ERROR} />

      <h2>Request-scoped caches</h2>
      <p>
        Caps installed during a request are isolated via <code>runWithCapabilityScope</code> —
        concurrent requests can't see each other's caps. That means <code>cache(fn)</code> is
        auth-bleed-proof by construction; the per-request cap stack is part of the cache key.
      </p>
      <CodeBlock code={CACHE} />
      <p>
        This closes the class of footguns documented in{' '}
        <a href="https://github.com/vercel/next.js/discussions/86538">Next.js issue #86538</a> (auth
        context bleeding between concurrent cached requests) by structure, not by linting.
      </p>

      <h2>Security defaults that apply</h2>
      <ul>
        <li>
          <strong>Same-origin enforcement</strong> — cross-origin requests rejected by default
        </li>
        <li>
          <strong>Auto-CSRF</strong> — token validated transparently when load() returns one
        </li>
        <li>
          <strong>Body size limit</strong> — 1 MB on <code>'standard'</code>, 256 KB on{' '}
          <code>'strict'</code>
        </li>
        <li>
          <strong>Prototype-pollution guard</strong> — JSON keys <code>__proto__</code>/
          <code>constructor</code>/<code>prototype</code> rejected
        </li>
      </ul>
      <p>
        See{' '}
        <Link to="/concepts/security">
          <code>Security</code> concept
        </Link>{' '}
        for the full picture.
      </p>

      <h2>Related</h2>
      <ul>
        <li>
          <Link to="/api/page">
            <code>page({'{ on }'})</code> — co-located actions
          </Link>
        </li>
        <li>
          <Link to="/recipes/forms">Forms &amp; actions recipe</Link>
        </li>
        <li>
          <Link to="/concepts/security">Security defaults</Link>
        </li>
      </ul>
    </article>
  ),
})
