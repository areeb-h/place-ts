// App theme — dark + light with one accent.
//
// The framework's `theme()` helper expects bare color names (no
// `--color-` prefix) and auto-fills sibling tokens (card, border,
// muted, accent-fg, …) via `color-mix()` over the anchors below. To
// override a derived sibling, list it on the mode (`border: 'oklch(…)'`).
//
// Passing `theme: tokens` to `app({...})` auto-injects the early-paint
// script that reads the theme cookie and applies the right class
// BEFORE first paint — zero flash on hard refresh, server + static
// export.

import { theme } from '@place-ts/component'

export const tokens = theme({
  default: 'dark',
  modes: {
    dark: {
      bg: 'oklch(0.16 0.01 270)',
      fg: 'oklch(0.97 0.005 270)',
      accent: 'oklch(0.74 0.16 250)',
    },
    light: {
      bg: 'oklch(0.99 0.003 270)',
      fg: 'oklch(0.20 0.01 270)',
      accent: 'oklch(0.55 0.18 250)',
    },
  },
})
