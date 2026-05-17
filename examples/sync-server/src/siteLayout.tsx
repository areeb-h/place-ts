// Shared site layout for the sync-server demo. Wraps every page with
// a top nav + footer so the routes share chrome without each page
// having to know about it.
//
// This is the layout-DX demo: declare ONCE on serve() (`layout: siteLayout`),
// and every page below gets it automatically. Pages stay focused on
// their own content; layout-level concerns (header, footer, meta
// defaults) live in one place.

import { layout, type View } from '@place/component'

export const siteLayout = layout({
  meta: {
    htmlClass: 'h-full',
    bodyClass: 'min-h-full bg-neutral-50 text-neutral-900 antialiased',
    themeColor: '#fafafa',
  },
  view: ({ children }: { children: View }) => (
    <div class="min-h-screen flex flex-col">
      <header class="border-b border-neutral-200 bg-white">
        <div class="mx-auto max-w-2xl px-8 py-4 flex items-baseline justify-between">
          <a href="/" class="font-semibold text-neutral-900 no-underline">
            place sync-server
          </a>
          <nav class="flex gap-4 text-xs text-neutral-500">
            <a href="/ssr/demo" class="hover:text-neutral-900 no-underline">
              hello
            </a>
            <a href="/ssr/slow" class="hover:text-neutral-900 no-underline">
              streaming
            </a>
            <a href="/actions/demo" class="hover:text-neutral-900 no-underline">
              actions
            </a>
            <a href="/auth/me" class="hover:text-neutral-900 no-underline">
              session
            </a>
          </nav>
        </div>
      </header>

      <main class="flex-1">{children}</main>

      <footer class="border-t border-neutral-200 bg-white">
        <div class="mx-auto max-w-2xl px-8 py-4 text-xs text-neutral-400">
          @place/sync-server · SSR + streaming + cookies + CSRF · MIT
        </div>
      </footer>
    </div>
  ),
})
