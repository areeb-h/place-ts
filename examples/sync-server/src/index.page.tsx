// `/` — landing page for the sync-server demo. Lists the available
// routes so a fresh visitor lands somewhere readable instead of the
// blank page that the WebSocket-upgrade endpoint produces on a normal
// HTTP GET.

import { page } from '@place/component'

export const indexPage = page({
  meta: { title: 'place sync-server — demos' },
  view: () => (
    <div class="mx-auto max-w-2xl px-8 py-12">
      <h1 class="text-3xl font-semibold text-neutral-900">place sync-server</h1>
      <p class="mt-2 text-sm text-neutral-500 leading-relaxed">
        End-to-end demo of place-ts: SSR + streaming + typed actions + bun:sqlite + WebSocket push +
        signed sessions + CSRF tokens. Every page below shares the layout declared once on{' '}
        <code class="font-mono">
          serve({'{'} layout: siteLayout {'}'})
        </code>
        .
      </p>

      <ul class="mt-8 space-y-4 list-none p-0">
        <li class="rounded border border-neutral-200 bg-white p-4">
          <a href="/ssr/demo" class="font-semibold text-neutral-900 no-underline">
            /ssr/demo
          </a>
          <p class="mt-1 text-xs text-neutral-500">
            Plain SSR + client hydration end-to-end. Counter button proves hydration worked.
          </p>
        </li>
        <li class="rounded border border-neutral-200 bg-white p-4">
          <a href="/ssr/slow" class="font-semibold text-neutral-900 no-underline">
            /ssr/slow
          </a>
          <p class="mt-1 text-xs text-neutral-500">
            Streaming SSR with <code class="font-mono">suspense()</code>. Shell flushes immediately;
            the slow data streams in via <code class="font-mono">__place.swap()</code> ~500 ms
            later.
          </p>
        </li>
        <li class="rounded border border-neutral-200 bg-white p-4">
          <a href="/actions/demo" class="font-semibold text-neutral-900 no-underline">
            /actions/demo
          </a>
          <p class="mt-1 text-xs text-neutral-500">
            Typed <code class="font-mono">action()</code> with the full security stack: same-origin,
            body limit, proto-pollution guard, signed CSRF token. SQLite-backed counter. Server
            fetches data via <code class="font-mono">load()</code>; client mutates via{' '}
            <code class="font-mono">&lt;Form&gt;</code>.
          </p>
        </li>
      </ul>

      <p class="mt-8 text-xs text-neutral-400">
        Read source: <code class="font-mono">examples/sync-server/src/</code>
      </p>
    </div>
  ),
})
