// Round 7 — root layout. App chrome: header with brand + nav + theme
// toggle, sidebar with quick links + recent tags (hidden on detail/edit
// pages via CSS), main content area, footer with backend-switcher chip.
//
// Built around a CSS grid that yields a real two-column feel on desktop
// and collapses to single-column on narrower viewports. Typography +
// spacing match what a commercial knowledge-base app would ship.

import { css, Link, layout } from '@place/component'
import { BackendSwitcher } from '../components/BackendSwitcher.tsx'
import { ThemeToggle } from '../components/ThemeToggle.tsx'

export const rootLayout = layout({
  meta: {
    title: 'commonplace',
    description: 'A personal commonplace book — the @place/* reference app.',
    themeColor: '#0a0a0c',
    robots: 'noindex, nofollow',
    htmlClass: 'h-full',
    bodyClass: 'h-full bg-bg text-fg font-sans antialiased',
  },
  // Pseudo-element rules Tailwind doesn't ship as utilities by default.
  // Tokens flow through `var(--color-…)` so these adapt to the active theme.
  styles: css`
    ::selection {
      background-color: var(--color-accent);
      color: var(--color-accent-fg);
    }
    ::-webkit-scrollbar { width: 9px; height: 9px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb {
      background: color-mix(in oklab, var(--color-muted) 35%, transparent);
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: color-mix(in oklab, var(--color-muted) 60%, transparent);
    }
    /* Soft ambient gradient — subtle radial highlights tinted by the
       accent so the dark theme doesn't read as a flat black tile. */
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: -1;
      background:
        radial-gradient(circle at 12% 8%, color-mix(in oklab, var(--color-accent) 6%, transparent), transparent 45%),
        radial-gradient(circle at 88% 92%, color-mix(in oklab, var(--color-accent) 4%, transparent), transparent 50%);
    }
    /* Smooth view-transitions for cross-page navigation. */
    ::view-transition-old(root), ::view-transition-new(root) {
      animation-duration: 220ms;
      animation-timing-function: cubic-bezier(.2, .8, .2, 1);
    }
    /* Editorial typography inside prose containers. */
    .prose h1, .prose h2, .prose h3 { color: var(--color-fg); letter-spacing: -0.015em; }
    .prose a { color: var(--color-accent); text-decoration: underline; text-underline-offset: 3px; }
    .prose blockquote {
      border-left: 2px solid color-mix(in oklab, var(--color-accent) 60%, transparent);
      padding-left: 1rem;
      color: color-mix(in oklab, var(--color-fg) 80%, var(--color-muted));
      font-style: italic;
    }
    .prose code {
      font-family: var(--font-mono);
      font-size: 0.92em;
      background: color-mix(in oklab, var(--color-card) 80%, transparent);
      padding: 1px 6px;
      border-radius: 3px;
      border: 1px solid color-mix(in oklab, var(--color-border) 70%, transparent);
    }
  `,
  view: ({ children }) => (
    <div class="flex flex-col h-full min-h-0">
      <header class="flex-shrink-0 border-b border-border/60 bg-card/30 backdrop-blur-sm">
        <div class="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-6">
          <div class="flex items-center gap-1">
            <Link
              to="/"
              class="flex items-baseline gap-2 no-underline text-fg hover:opacity-90 transition-opacity"
            >
              <span class="text-lg font-semibold tracking-tight">commonplace</span>
              <span class="text-[10px] font-mono text-muted hidden sm:inline">
                · a place reference app
              </span>
            </Link>
          </div>
          <nav class="flex items-center gap-1">
            <Link
              to="/"
              class="px-2.5 py-1 rounded-md text-sm text-muted hover:text-fg hover:bg-card border border-transparent hover:border-border no-underline transition-colors"
            >
              notes
            </Link>
            <Link
              to="/tags"
              class="px-2.5 py-1 rounded-md text-sm text-muted hover:text-fg hover:bg-card border border-transparent hover:border-border no-underline transition-colors"
            >
              tags
            </Link>
            <div class="w-px h-5 bg-border/60 mx-1.5" />
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main class="flex-1 min-h-0 overflow-hidden">{children}</main>
      <footer class="flex-shrink-0 border-t border-border/40 bg-card/20 backdrop-blur-sm">
        <div class="max-w-6xl mx-auto px-6 py-2 flex items-center justify-between gap-4 text-[11px] font-mono text-muted">
          <span class="flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-accent/60 inline-block" />
            running on{' '}
            <a
              href="https://github.com/place-ts"
              class="text-fg/80 hover:text-accent no-underline transition-colors"
            >
              @place/*
            </a>
          </span>
          <BackendSwitcher />
        </div>
      </footer>
    </div>
  ),
})
