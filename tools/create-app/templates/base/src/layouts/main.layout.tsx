// Root layout. Wraps every page with a sticky header (brand + nav) and
// a footer. Layouts persist across SPA navigations — when you click a
// <Link>, only the `{children}` slot re-renders, not this whole tree.
//
// `Link` is auto-imported via the @place-ts/component preload plugin
// (bunfig.toml); `layout` stays explicit (common variable name).
//
// `meta` here is the layout-level default — pages override individual
// fields (`title`, `description`) via their own `meta:`. The
// `titleTemplate` formats every page's title as
// `<page title> · __APP_NAME__`. Pages that want to opt out can set
// `meta: { title: '…', titleAbsolute: true }`.

import { layout } from '@place-ts/component'

export const mainLayout = layout({
  meta: {
    titleTemplate: '%s · __APP_NAME__',
    description: 'A place-ts app.',
  },
  htmlClass: 'h-full',
  bodyClass: 'h-full bg-bg text-fg font-sans antialiased',
  view: ({ children }) => (
    <div class="flex flex-col min-h-screen">
      <header class="sticky top-0 z-30 border-b border-border/60 bg-bg/80 backdrop-blur-md">
        <div class="max-w-3xl mx-auto px-5 h-14 flex items-center justify-between">
          <Link
            to="/"
            class="text-lg font-semibold tracking-tight text-fg no-underline hover:opacity-80 transition-opacity"
          >
            __APP_NAME__
          </Link>
          <nav class="flex items-center gap-1 text-sm">
            <Link
              to="/"
              class="px-3 py-1.5 rounded-md text-muted hover:text-fg hover:bg-card/60 no-underline transition-colors"
            >
              Home
            </Link>
          </nav>
        </div>
      </header>

      <main class="flex-1 max-w-3xl mx-auto px-5 py-12 w-full">{children}</main>

      <footer class="border-t border-border/60 bg-bg/60">
        <div class="max-w-3xl mx-auto px-5 py-3 flex items-center justify-between text-[11px] font-mono text-muted">
          <span>
            built with <span class="text-accent">place-ts</span>
          </span>
          <a
            href="https://github.com/areeb-h/place-ts"
            class="no-underline text-muted hover:text-fg transition-colors"
          >
            docs
          </a>
        </div>
      </footer>
    </div>
  ),
})
