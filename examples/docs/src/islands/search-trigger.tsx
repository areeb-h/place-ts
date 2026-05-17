// Header search trigger. ISLAND.
//
// Opens the SearchPalette by flipping the shared `open` signal. The
// palette listens to the same signal and auto-mounts the modal when
// `open()` becomes true.
//
// **Platform-correct kbd label, no blip.** Earlier this island read
// `navigator.userAgent` in `onMount` and flipped a `state(true)` —
// SSR painted `⌘K` for everyone, then post-hydration JS overwrote
// the text to `Ctrl K` for non-Mac users. The mutation was visible
// as a brief flicker on hard refresh.
//
// The framework now sets `<html data-place-platform="mac|other">` in
// an early-paint inline `<script>` in `<head>` (see `__early.ts`),
// running BEFORE the body parses. We render both labels server-side
// and let CSS attribute selectors hide the wrong one before first
// paint. Zero JS state, zero flicker, zero hydration mismatch.
import { open } from './search-palette.tsx'

const SearchTriggerImpl = () => (
  <button
    type="button"
    class="inline-flex items-center gap-2 w-full px-2.5 py-[7px] rounded-lg bg-card/50 hover:bg-card/70 border border-border/70 hover:border-accent/50 text-muted hover:text-fg text-[13px] cursor-pointer transition-colors duration-150"
    aria-label="Search docs"
    onClick={() => open.set(true)}
  >
    <span class="text-[0.9rem]" aria-hidden="true">
      ⌕
    </span>
    <span class="flex-1 text-left">Search docs</span>
    <kbd class="px-1.5 py-0.5 rounded font-mono text-[11px] bg-bg/60 border border-border/60 text-muted">
      <span class="place-platform-mac">⌘K</span>
      <span class="place-platform-other">Ctrl K</span>
    </kbd>
  </button>
)

export default island(SearchTriggerImpl)
