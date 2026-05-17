// `/actions/demo` — server-side data fetch + secure mutation via action().
//
// Demonstrates:
//   - load(): fetches the current counter value from sqlite at SSR time
//     so the page's first paint already shows real server state
//     (no loading spinner, no client-side roundtrip)
//   - <Form action={incrementCounter}>: typed POST that goes through
//     the four security layers (same-origin, body limit, proto guard,
//     signed CSRF token)
//   - The CSRF token is minted server-side in load() and embedded as
//     a hidden input — the no-JS form submission AND the JS-via-fetch
//     path both pick it up
//   - Layout from serve({ layout: siteLayout }) wraps this page
//     automatically (the page's view stays focused on its own content)

import { Form, page } from '@place/component'
import { incrementCounter } from './counter.action.ts'

interface CounterData {
  count: number
  csrf: string
}

export const actionsPage = page<Record<string, never>, CounterData>({
  // Server-side data load — runs once per request, before render. The
  // db helpers are dynamically imported because this page module is
  // bundled into the browser too (for hydration matching) — and
  // `bun:sqlite` would crash a static browser bundle.
  load: async ({ req }) => {
    const { readCounter, mintCsrfFor } = await import('./counter.server.ts')
    return {
      count: readCounter(),
      csrf: await mintCsrfFor(req),
    }
  },
  meta: ({ count }) => ({
    title: `counter: ${count} — place actions demo`,
    description:
      'Demo of place-ts action() with full security: same-origin, body limit, proto guard, signed CSRF token.',
  }),
  view: ({ count, csrf }) => (
    <div class="mx-auto max-w-2xl px-8 py-8">
      <h1 class="text-2xl font-semibold text-neutral-900">action() + security demo</h1>
      <p class="mt-1 text-xs text-neutral-500">
        Server-side data fetch (in <code class="font-mono">load()</code>) + secure mutation (in a
        typed <code class="font-mono">action()</code>).
      </p>

      <div class="my-8 rounded border border-neutral-200 p-6 bg-white">
        <p class="text-sm text-neutral-500">Current counter (read from bun:sqlite at SSR time):</p>
        <p class="mt-2 text-5xl font-mono font-semibold text-neutral-900">{count}</p>
      </div>

      {/* Form wraps the typed action. preventDefault + action.call() runs
          when JS is loaded; if JS is disabled, the browser POSTs the
          form directly to /api/counter/increment with form-encoded body
          (action.handler accepts both JSON and form-encoded). */}
      <Form
        action={incrementCounter}
        class="my-8 flex items-center gap-3"
        // After success, refresh the page so the SSR'd count updates.
        // A fancier demo would optimistic-update the value reactively;
        // we keep this simple for security focus.
        onSuccess={() => globalThis.location?.reload()}
      >
        {/* No csrfToken prop. No hidden csrf input. No input mapper.
            The framework auto-injects `<meta name="csrf-token">` on
            every page whose load() returns a `csrf` field; <Form>
            auto-reads it; shape() auto-coerces "1" → 1 for declared
            number fields. CSRF is invisible to the dev — just mint it
            in load() and forget. */}
        <input
          type="number"
          name="by"
          defaultValue="1"
          min="1"
          max="100"
          class="w-20 px-2 py-1 rounded border border-neutral-300 text-sm font-mono"
        />
        <button
          type="submit"
          class="px-4 py-1 rounded bg-neutral-900 text-white text-sm hover:bg-neutral-700 cursor-pointer"
        >
          increment
        </button>
      </Form>
      {/* Keep `csrf` in the closure so TS doesn't drop it (the framework
          handles the actual transmission via the auto-injected meta tag). */}
      <noscript class="hidden">{csrf.length > 0 ? '' : ''}</noscript>

      <details class="mt-8 text-xs text-neutral-500">
        <summary class="cursor-pointer hover:text-neutral-700">
          Security layers active on this action
        </summary>
        <ul class="mt-3 space-y-2 list-none pl-0">
          <li>
            <strong class="text-neutral-700">1. Same-origin enforcement</strong> — POSTs from{' '}
            <code class="font-mono">https://evil.com</code> with your cookies get 403 before{' '}
            <code class="font-mono">fn()</code> runs. Default-on; opt out via{' '}
            <code class="font-mono">sameOrigin: false</code>.
          </li>
          <li>
            <strong class="text-neutral-700">2. Body size limit</strong> —{' '}
            <code class="font-mono">Content-Length</code> over 256 bytes → 413. Tight cap because
            the input is one number.
          </li>
          <li>
            <strong class="text-neutral-700">3. Prototype-pollution guard</strong> — JSON bodies
            with <code class="font-mono">__proto__</code> /{' '}
            <code class="font-mono">constructor</code> / <code class="font-mono">prototype</code>{' '}
            keys at any depth → 400. Closes a class of CVEs at the input boundary.
          </li>
          <li>
            <strong class="text-neutral-700">4. Signed CSRF token</strong> — bound to the user's
            session ID via the same secret used for session cookies. Replayed tokens from another
            session → 403. The token in this form's hidden input expires per session lifetime.
          </li>
          <li>
            <strong class="text-neutral-700">5. Input schema validation</strong> — the action's{' '}
            <code class="font-mono">
              shape({'{'} by: 'number' {'}'})
            </code>{' '}
            rejects malformed inputs before <code class="font-mono">fn()</code>. Plus the fn itself
            checks <code class="font-mono">by ∈ [1, 100]</code> as a defense-in-depth bound.
          </li>
        </ul>
      </details>
    </div>
  ),
})
