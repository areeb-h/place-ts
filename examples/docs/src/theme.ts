// Docs site theme — dark + light with an amber accent. The framework's
// `theme()` helper expects bare color names (no `--color-` prefix) and
// auto-fills the sibling tokens (card, border, muted, accent-fg,
// destructive, destructive-fg) via `color-mix()` over the anchors.
//
// To override a sibling explicitly, list it on the mode — e.g.
// `border: 'oklch(0.27 …)'`. Untouched siblings track the anchors
// through CSS-level color-mix recomposition, so editing only the
// anchors recolors the whole theme.

import { theme } from '@place/component'

export const tokens = theme({
  default: 'dark',
  modes: {
    dark: {
      bg: 'oklch(0.13 0.006 286)',
      fg: 'oklch(0.97 0.001 286)',
      accent: 'oklch(0.78 0.16 65)',
      // Explicit overrides for tokens whose auto-derived defaults
      // don't quite hit (the docs site uses tuned values for muted +
      // border to keep WCAG AA contrast tight).
      muted: 'oklch(0.72 0.014 286)',
      border: 'oklch(0.27 0.006 286)',
      'accent-fg': 'oklch(0.13 0.006 286)',
      'card-fg': 'oklch(0.97 0.001 286)',
      destructive: 'oklch(0.71 0.19 13)',
      'destructive-fg': 'oklch(0.97 0.001 286)',
    },
    light: {
      bg: 'oklch(0.985 0.002 286)',
      fg: 'oklch(0.18 0.008 286)',
      accent: 'oklch(0.62 0.16 65)',
      muted: 'oklch(0.42 0.014 286)',
      border: 'oklch(0.92 0.005 286)',
      'accent-fg': 'oklch(0.985 0.002 286)',
      card: 'oklch(1 0 0)',
      'card-fg': 'oklch(0.18 0.008 286)',
      destructive: 'oklch(0.55 0.18 13)',
      'destructive-fg': 'oklch(0.985 0.002 286)',
    },
  },
})
