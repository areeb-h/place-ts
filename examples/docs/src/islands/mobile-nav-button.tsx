// Mobile-nav hamburger button. ISLAND.
//
// Shares the `open` signal with `mobile-nav-drawer.tsx`. The signal
// lives here as a named export; the drawer imports it directly. Bun's
// `splitting: true` extracts `open` into a shared chunk that evaluates
// ONCE per page (ES module semantics), so the two islands genuinely
// see the same signal — toggling here updates the drawer there.
//
// This used to live in `_mobile-nav-state.ts`; we kept the colocation
// in the consuming TSX once Bun's chunk splitting proved it doesn't
// duplicate the button component into the drawer's bundle.

import { island, state } from '@place/component'

/** Shared open-state for the mobile-nav pair. Imported by the drawer. */
export const open = state(false)

const MobileNavButtonImpl = () => (
  <button
    type="button"
    class="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg bg-transparent text-muted hover:text-fg hover:bg-card/60 border border-border/60 text-base cursor-pointer transition-colors duration-150"
    aria-label="Open menu"
    aria-expanded={() => (open() ? 'true' : 'false')}
    onClick={open.toggle}
  >
    ☰
  </button>
)

export default island(MobileNavButtonImpl)
