// App stylesheet — Tailwind v4 input CSS.
//
// Concatenated to the design package's base via `styles: [designStyles,
// appStyles]` in `app.ts`, then processed by Tailwind at build/dev.
// Tailwind utility classes are the primary styling tool; this file is
// the home for the small set of things that genuinely need CSS (body
// globals, scrollbar, prose typography).
//
// Client-bundle protection: the string is server-side Tailwind input —
// the client doesn't need it. The `__PLACE_BROWSER__` build define
// constant-folds the whole expression to `''` on browser builds so
// nothing ships to the page.

declare const __PLACE_BROWSER__: boolean

export const styles =
  typeof __PLACE_BROWSER__ !== 'undefined' && __PLACE_BROWSER__
    ? ''
    : `
::selection {
  background-color: var(--color-accent);
  color: var(--color-accent-fg);
}
html { scroll-behavior: smooth; }

.prose { color: var(--color-fg); max-width: 65ch; }
.prose h1 {
  font-size: 2rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin: 0 0 1rem;
  line-height: 1.15;
}
.prose h2 {
  font-size: 1.35rem;
  font-weight: 600;
  margin: 2rem 0 0.5rem;
}
.prose p {
  margin: 0 0 1rem;
  line-height: 1.65;
  color: color-mix(in oklab, var(--color-fg) 90%, var(--color-muted));
}
.prose a {
  color: var(--color-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.prose code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875em;
  background: color-mix(in oklab, var(--color-card) 80%, transparent);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid color-mix(in oklab, var(--color-border) 70%, transparent);
}
`
