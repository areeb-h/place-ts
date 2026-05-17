// Bottom-of-page prev/next nav. ISLAND.
//
// Reads RouterCap.path() reactively to find the current page in
// FLAT_NAV and render adjacent links. Hidden on pages outside the
// reading order (`/`, `/examples`, `/roadmap`).
//
// Why an island and not static: the nav refreshes on each
// navigation if the user uses SPA-style transitions. With per-route
// HTML reloads (current default), this could be static-server-
// rendered — but the cap-based reactive shape is the cleanest read.

import { island, Link } from '@place/component'
import { RouterCap } from '@place/routing'
import { FLAT_NAV } from '../nav-index.ts'

const PageNavImpl = () => {
  const router = RouterCap.use()

  // Pages excluded from the reading-sequence; these don't get
  // prev/next links because they're not part of the linear flow.
  const reading = FLAT_NAV.filter(
    (e) => e.to !== '/' && e.to !== '/examples' && e.to !== '/roadmap',
  )

  return (
    <nav
      aria-label="Page navigation"
      class={() => {
        const path = router.path()
        const idx = reading.findIndex((e) => e.to === path)
        return idx < 0
          ? 'hidden'
          : 'mt-12 pt-6 border-t border-border/40 flex items-stretch gap-3 not-prose'
      }}
    >
      {() => {
        const path = router.path()
        const idx = reading.findIndex((e) => e.to === path)
        if (idx < 0) return null
        const prev = idx > 0 ? reading[idx - 1] : null
        const next = idx < reading.length - 1 ? reading[idx + 1] : null
        return (
          <>
            <div class="flex-1 min-w-0">
              {prev ? (
                <Link
                  to={prev.to}
                  class="group flex flex-col gap-1 px-4 py-3 rounded-lg border border-border/60 bg-card/30 text-muted no-underline transition-[border-color,background-color,color] duration-150 hover:border-accent/40 hover:bg-card/60 hover:text-fg"
                >
                  <span class="text-[10px] uppercase tracking-[0.09em] font-semibold flex items-center gap-1">
                    <span aria-hidden="true">←</span>
                    Previous
                  </span>
                  <span class="text-sm font-medium text-fg truncate">{prev.label}</span>
                </Link>
              ) : null}
            </div>
            <div class="flex-1 min-w-0">
              {next ? (
                <Link
                  to={next.to}
                  class="group flex flex-col gap-1 px-4 py-3 rounded-lg border border-border/60 bg-card/30 text-muted text-right no-underline transition-[border-color,background-color,color] duration-150 hover:border-accent/40 hover:bg-card/60 hover:text-fg"
                >
                  <span class="text-[10px] uppercase tracking-[0.09em] font-semibold flex items-center gap-1 justify-end">
                    Next
                    <span aria-hidden="true">→</span>
                  </span>
                  <span class="text-sm font-medium text-fg truncate">{next.label}</span>
                </Link>
              ) : null}
            </div>
          </>
        )
      }}
    </nav>
  )
}

export default island(PageNavImpl)
