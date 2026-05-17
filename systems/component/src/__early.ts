// Early-paint inline runtime — runs in `<head>` BEFORE body is parsed.
//
// **The contract**: every statement here runs synchronously, before
// the HTML parser reaches `<body>`. Setting attributes on
// `document.documentElement` at this point feeds into the very first
// style resolution. CSS selectors that read those attributes evaluate
// correctly on the very first paint — no FOUC, no post-hydration
// rerender, no JS state in the component tree.
//
// **What ships built-in:**
//
//   1. **Platform hint** — sets `<html data-place-platform="mac|other">`
//      so content like `⌘K` vs `Ctrl K` keyboard hints renders right
//      on first paint via CSS attribute selectors.
//
//   2. **Reduced-motion hint** — sets `<html data-place-motion="reduce|ok">`
//      so motion-sensitive components can opt out of animations BEFORE
//      they mount, not after they've already played a frame.
//
// **What you can add per-app**: `app({ earlyHead: [() => `…JS…`] })`
// or `serve({ earlyHead: […] })`. Each entry is a JS statement string
// the framework wraps in `<script nonce>` and injects after the
// built-ins. Use for app-specific hints that need to feed first paint
// (analytics consent state, feature-flag bucketing, RTL/LTR locale,
// scrollbar-width hints for fixed-position UI, etc.).
//
// **Discipline for early-paint scripts**:
//   - Must be idempotent (the same statement may re-execute, e.g.
//     via SPA-nav script-tag reconciliation).
//   - Must not throw — a thrown error halts page parsing.
//   - Must not block longer than ~1ms — runs sync in the critical path.
//   - Must only WRITE to `document.documentElement` (or its `dataset`).
//     Mutating body content here fails because body isn't parsed yet.
//
// **Size**: built-ins ~250 bytes raw / ~180 B gzipped. Pure DOM API,
// no closures over framework state. Nonce-bound under strict CSP.

export interface PlaceEarlyOptions {
  /** Reserved for future config. Currently unused. */
  readonly _placeholder?: never
}

/**
 * Build the framework's built-in early-paint statements as a single
 * string. `serve()` wraps this in a nonced `<script>` and emits it at
 * the very top of `<head>`, before user-provided `earlyHead` entries.
 *
 * Idempotent on re-execution.
 */
export function placeEarly(_opts?: PlaceEarlyOptions): string {
  // Each statement is on its own line for readability; the whole thing
  // is one inline script tag at serve time. Statement order doesn't
  // matter — they target different documentElement.dataset keys.
  return [
    // Platform hint: distinguishes Mac (⌘) from non-Mac (Ctrl) modifiers
    // for keyboard shortcut labels. Matched via CSS `[data-place-platform]`.
    `document.documentElement.dataset.placePlatform=/Mac|iPod|iPhone|iPad/.test(navigator.userAgent||'')?'mac':'other';`,
    // Reduced-motion hint: respects the OS-level preference BEFORE
    // motion-sensitive islands mount. Matched via CSS
    // `[data-place-motion="reduce"]` (or the equivalent media query —
    // this hint is the JS-readable mirror for code that wants to gate
    // a setInterval/setTimeout chain without a matchMedia listener).
    `document.documentElement.dataset.placeMotion=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches?'reduce':'ok';`,
  ].join('\n')
}
