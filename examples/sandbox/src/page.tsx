// sandbox — Page definition. The view is intentionally minimal: just
// an empty `#app` container the client mounts the real `<Layout>` into.
// `meta.bodyClass` carries the body styling utilities (Tailwind picks
// them up via the content scan); the active theme class is auto-prefixed
// onto `<html>` by `serve({ theme })`.

import { css, page } from '@place/component'

export const sandboxPage = page({
  view: () => <div id="app" />,

  // Pseudo-element rules Tailwind doesn't ship as utilities by default
  // (scrollbar appearance, ::selection color). Tokens flow through
  // `var(--color-…)` so these pseudo-elements pick up the active theme.
  styles: css`
    ::selection {
      background-color: var(--color-accent);
      color: var(--color-accent-fg);
    }
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb {
      background: color-mix(in oklab, var(--color-muted) 50%, transparent);
      border-radius: 5px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: color-mix(in oklab, var(--color-muted) 70%, transparent);
    }
  `,

  meta: {
    title: 'place — reactivity sandbox',
    description: 'Live demos of the @place/reactivity primitives.',
    themeColor: '#0a0a0c',
    colorScheme: 'dark',
    robots: 'noindex, nofollow',
    bodyClass: 'bg-bg text-fg font-mono antialiased',
  },
})
