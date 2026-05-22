// App theme — single dark mode by default. Feature `theme-toggle`
// adds the light variant + an early-paint script reading the
// theme cookie.
//
// The framework's `theme()` helper expects bare color names (no
// `--color-` prefix) and auto-fills sibling tokens (card, border,
// muted, accent-fg, …) via `color-mix()` over the anchors below. To
// override a derived sibling, list it on the mode (`border: 'oklch(…)'`).

import { theme } from '@place-ts/component'

export const tokens = theme({
  default: 'dark',
  modes: {
    dark: {
      bg: 'oklch(0.16 0.01 270)',
      fg: 'oklch(0.97 0.005 270)',
      accent: 'oklch(0.74 0.16 250)',
    },
  },
})
