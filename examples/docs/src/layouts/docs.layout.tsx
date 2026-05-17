// Docs site root layout. Header with brand + search + theme toggle.
// Three-column body: sidebar / main / right-side ToC. Mobile drawer
// below md. Cmd+K search palette mounts globally.

import { Link, layout } from '@place/component'
// Chrome ISLANDS — each default-exports an `island(...)`-wrapped
// component; the framework auto-discovers them via `app({ islandsDir })`
// so no manual registration is needed in `app.ts`. We still import
// the values here to use as JSX.
import MobileNavButton from '../islands/mobile-nav-button.tsx'
import MobileNavDrawer from '../islands/mobile-nav-drawer.tsx'
import PageNav from '../islands/page-nav.tsx'
import SearchPalette from '../islands/search-palette.tsx'
import SearchTrigger from '../islands/search-trigger.tsx'
import ThemeToggle from '../islands/theme-toggle.tsx'
import ToC from '../islands/toc.tsx'
import { Sidebar } from '../components/sidebar.tsx'
import { NAV } from '../nav-index.ts'

// Favicon — a "place" location-pin mark, inlined as a data-URI SVG.
//
// Inlining (vs. a /favicon.svg file) means there is NO favicon
// request at all: the icon ships inside every page's HTML, so it can
// never re-fetch, re-decode, or blip on reload — and the browser
// issues no /favicon.ico probe (which would 404 on the static host).
// `encodeURIComponent` at build time produces a valid data URI; SVG
// favicons are universal across evergreen browsers (Chrome, Firefox,
// Safari 16.4+, Edge). The amber matches the brand accent.
const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<path d="M16 2.5c-5.6 0-10.2 4.4-10.2 9.9 0 7 8.5 15 9.6 16a.9.9 0 0 0 1.2 0' +
  'c1.1-1 9.6-9 9.6-16C26.2 6.9 21.6 2.5 16 2.5Z" fill="#e8a23c"/>' +
  '<circle cx="16" cy="12.4" r="3.8" fill="#15140f"/></svg>'
const FAVICON = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`

/**
 * Docs layout with typed named slots. Pages can fill:
 *   - `headerActions` — extra buttons in the header nav row (after
 *     start/why/github). Replaces the need for per-page header
 *     overrides via prop drilling.
 *   - `tocOverride` — replaces the auto-generated ToC for pages that
 *     don't have headings (landing, examples, etc.).
 *
 * Layouts without slots stayed `layout({ ... })`; the typed slot
 * union is purely opt-in.
 */
export const docsLayout = layout<{}, 'headerActions' | 'tocOverride'>({
  meta: {
    // `titleTemplate` wraps every page's title with the site suffix —
    // pages now write `meta: 'Why place'` (or no meta at all, letting
    // the framework auto-promote their <h1>) and the layout supplies
    // the rest. `%s` is the placeholder; everything else is literal.
    // Landing pages can opt out with `meta: { title: '…', titleAbsolute: true }`.
    titleTemplate: '%s · place docs',
    description:
      'place is a nine-system platform for shipping the web. ' +
      'Smaller surface than Next, fewer footguns than Remix, more honest than TanStack.',
    themeColor: '#0a0a0c',
    icon: { href: FAVICON, type: 'image/svg+xml' },
    htmlClass: 'h-full',
    bodyClass: 'h-full bg-bg text-fg font-sans antialiased',
  },
  view: ({ children, slots }) => (
    <div class="flex flex-col h-full min-h-0">
      <header class="flex-shrink-0 border-b border-border/50 bg-bg/70 backdrop-blur-md sticky top-0 z-30">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <MobileNavButton />
          <Link
            to="/"
            class="flex items-baseline gap-2 no-underline text-fg hover:opacity-90 transition-opacity"
          >
            <span class="text-lg font-semibold tracking-tight">place</span>
            <span class="text-[10px] font-mono text-muted hidden sm:inline">docs</span>
          </Link>
          <div class="hidden sm:block ml-3 flex-1 max-w-xs">
            <SearchTrigger />
          </div>
          <nav class="flex items-center gap-1 text-sm ml-auto">
            <Link
              to="/getting-started"
              class="hidden md:inline-flex px-3 py-1.5 rounded-md text-muted hover:text-fg hover:bg-card/60 no-underline transition-colors"
            >
              Get started
            </Link>
            <Link
              to="/why"
              class="hidden md:inline-flex px-3 py-1.5 rounded-md text-muted hover:text-fg hover:bg-card/60 no-underline transition-colors"
            >
              Why place
            </Link>
            <a
              href="https://github.com/anthropics/place-ts"
              aria-label="place source on GitHub"
              class="px-3 py-1.5 rounded-md text-muted hover:text-fg hover:bg-card/60 no-underline transition-colors"
            >
              GitHub
            </a>
            {slots('headerActions')}
            <div class="ml-1.5"><ThemeToggle /></div>
          </nav>
        </div>
      </header>

      <div class="flex-1 min-h-0 overflow-hidden">
        <div class="max-w-6xl mx-auto h-full grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)_220px] gap-x-2 lg:gap-x-6">
          <aside class="hidden md:block border-r border-border/40 overflow-y-auto py-8 px-3">
            <Sidebar sections={NAV} />
          </aside>

          {/* `overflow-x-clip` is the page-level horizontal-overflow
              guard. Sections (like the landing hero) can place absolute-
              positioned decoratives that bleed past their own edges
              for soft-fade glow effects — main clips horizontally so
              the bleed never produces a viewport scrollbar. y is auto
              so the article body still scrolls. */}
          <main class="overflow-y-auto overflow-x-clip py-8 px-5 sm:px-7 md:px-10 lg:px-12 min-w-0">
            {children}
            {/* Bottom-of-article nav: only hydrate when scrolled into view.
                Removes its bundle from the critical-path connection budget. */}
            <PageNav client="visible" />
          </main>

          <aside class="hidden lg:block overflow-y-auto py-8 pr-4">
            {/* Pages can override the auto-ToC island with a `tocOverride`
                slot fill (e.g. landing & gallery pages that have no
                heading hierarchy). Otherwise the heading-scanner island
                builds the ToC at runtime. */}
            {slots.has('tocOverride') ? slots('tocOverride') : <ToC client="idle" />}
          </aside>
        </div>
      </div>

      <footer class="flex-shrink-0 border-t border-border/50 bg-bg/60 backdrop-blur-sm">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between text-[11px] font-mono text-muted">
          <span>
            <span class="text-accent">place</span> — a TS-first web platform
          </span>
          <span class="hidden sm:inline">built with place</span>
        </div>
      </footer>

      {/* Search palette + mobile drawer are hidden modals — neither
          shows on first paint. We DEFER but use `client="idle"`, not
          `client="interaction"`: the modal markers have `height: 0`
          (Activity wraps the content in `<span hidden>`), so the
          user can never hover/click the marker itself to trigger the
          interaction-strategy promote. Idle loads them after first
          paint completes; the trigger button + Cmd+K + hamburger
          click then have a live consumer of the shared `open`
          signal. Cost: ~3 KB on each page, but off the critical
          path. The interaction strategy stays a valid choice for
          deferred islands whose marker IS visible. */}
      <SearchPalette client="idle" />
      <MobileNavDrawer client="idle" />
    </div>
  ),
})
