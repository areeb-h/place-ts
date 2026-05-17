// Streaming SSR demo. Demonstrates phase 4.5 — `suspense({ fallback,
// children, on })` boundary that shows fallback content immediately,
// holds the response stream open until a slow resource resolves, then
// pushes a `<template>` swap chunk + devalue-encoded hydration cache
// to the client.
//
// View source on this page after a fresh load: you'll see the shell
// HTML, the inline __place runtime, the fallback, the comment markers
// `<!--p:0-->`, and then the swap chunk emitted ~500ms later.

import { page, Suspense } from '@place/component'
import { resource } from '@place/reactivity'

interface SlowData {
  message: string
  computedAt: string
  numbers: number[]
}

// Simulate a slow data fetch — would be a real API call in production.
function fetchSlow(name: string): Promise<SlowData> {
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          message: `Hello ${name}, this took 500ms`,
          computedAt: new Date().toISOString(),
          numbers: [1, 2, 3, 5, 8, 13, 21],
        }),
      500,
    ),
  )
}

export const slowPage = page({
  // Streaming required: the view contains a suspense() with a pending
  // resource. Without this flag, renderPage() would render synchronously
  // and the user would get the fallback HTML with no swap.
  streaming: true,
  url: (u) => ({ name: u.searchParams.get('name') ?? 'visitor' }),

  view: ({ name }) => {
    // Resource is created per-render (per-request on server, per-mount on
    // client). The hydrationKey ties the SSR-resolved value to the
    // client's resource() so the client doesn't re-fetch.
    const slow = resource(() => fetchSlow(name), {
      hydrationKey: `slow:${name}`,
    })

    return (
      <div class="min-h-screen bg-white p-8 font-sans text-sm leading-relaxed text-neutral-800">
        <div class="mx-auto max-w-2xl">
          <h1 class="text-2xl font-semibold text-neutral-900">streaming SSR demo</h1>
          <p class="mt-1 text-xs text-neutral-400">
            Shell flushes immediately. Slow data ({500}ms) streams in via{' '}
            <code class="font-mono">__place.swap</code>.
          </p>

          <div class="my-6 rounded border border-neutral-200 p-4">
            <Suspense
              fallback={
                <div class="animate-pulse">
                  <div class="h-4 w-3/4 rounded bg-neutral-100" />
                  <div class="mt-2 h-4 w-1/2 rounded bg-neutral-100" />
                </div>
              }
              on={[slow]}
            >
              {() => {
                const s = slow.status()
                if (s.state !== 'ready') return null
                return (
                  <div>
                    <p class="font-semibold">{s.value.message}</p>
                    <p class="mt-1 font-mono text-xs text-neutral-400">
                      computed at: {s.value.computedAt}
                    </p>
                    <p class="mt-2 font-mono text-xs">numbers: [{s.value.numbers.join(', ')}]</p>
                  </div>
                )
              }}
            </Suspense>
          </div>

          <p class="mt-8 text-xs leading-relaxed text-neutral-500">
            View source: shell HTML + inline <code>__place</code> runtime + fallback + comment
            markers ship first; the resolved slow data ships ~500ms later as a{' '}
            <code>&lt;template&gt;</code> + <code>__place.swap()</code> script. The client's
            resource reads from <code>__place.r['slow:{name}']</code> so it doesn't re-fetch.
          </p>
        </div>
      </div>
    )
  },

  meta: ({ name }) => ({
    title: `streaming demo — ${name}`,
    description: 'SSR streaming + suspense + resource hydration.',
    robots: 'noindex, nofollow',
  }),

  // No CSP override needed. The framework auto-generates a fresh
  // per-request nonce and threads it through:
  //   - The CSP `script-src 'nonce-XXX'` for the response
  //   - Every inline <script> the streaming SSR emits (runtime + swap
  //     chunks + load data tag) gets `nonce="XXX"`
  // So strict CSP keeps working without `'unsafe-inline'` or
  // `'unsafe-eval'`. The Tailwind hash is similarly auto-merged into
  // `style-src`.
})
