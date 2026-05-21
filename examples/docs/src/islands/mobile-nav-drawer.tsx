// Mobile-nav drawer. ISLAND.
//
// Reads the shared `open` signal (toggled by the button island), and
// watches RouterCap.path() to auto-close on navigation. RouterCap is
// auto-installed by the framework's `_auto-init.ts` (generated from
// `app({ router: pathRouter })` config; ships once per page via the
// shared chunk).
//
// Sections come from the module-level `NAV` constant in
// `../nav-index.ts` — the island imports it directly rather than
// taking it as a prop. Two reasons: (1) the SSR'd marker would
// duplicate the entire nav data as JSON in `data-view-props`,
// (2) NAV is genuinely module-singleton; passing it through props
// implies it could vary per render.

import { Activity, view, watch } from '@place-ts/component'
import { RouterCap } from '@place-ts/routing'
import { Sidebar } from '../components/sidebar.tsx'
import { NAV } from '../nav-index.ts'
// Shared open-state lives in the sibling button island (T6-E). Bun's
// `splitting: true` extracts it into a shared chunk so both islands
// reference the same signal without duplicating the button impl into
// this bundle.
import { open } from './mobile-nav-button.tsx'

const MobileNavDrawerImpl = () => {
  const router = RouterCap.use()
  let lastPath = router.path()
  watch(() => {
    const p = router.path()
    if (p !== lastPath) {
      lastPath = p
      open.set(false)
    }
  })
  return (
    <Activity when={open}>
      <div class="fixed inset-0 z-50 md:hidden">
        <button
          type="button"
          class="absolute inset-0 bg-bg/70 backdrop-blur-sm border-0 p-0 cursor-pointer"
          aria-label="Close menu"
          onClick={() => open.set(false)}
        />
        <div class="absolute top-0 left-0 bottom-0 w-[min(280px,80vw)] pt-16 pb-8 px-4 bg-bg border-r border-border overflow-y-auto">
          <button
            type="button"
            class="absolute top-3 right-3 inline-flex items-center justify-center w-9 h-9 rounded-lg bg-transparent text-muted hover:text-fg hover:bg-card/60 border border-border/60 text-xl leading-none cursor-pointer transition-colors duration-150"
            aria-label="Close menu"
            onClick={() => open.set(false)}
          >
            ×
          </button>
          <Sidebar sections={NAV} />
        </div>
      </div>
    </Activity>
  )
}

export default view(MobileNavDrawerImpl)
