// sandbox — design tokens. Single dark theme; sandbox is a focused
// playground and doesn't need theme switching, but tokens give it the
// same `bg-bg`/`text-fg`/`text-accent` vocabulary commonplace uses,
// so the design language is consistent across the example apps.

import { themeTokens } from '@place/component'

export const tokens = themeTokens({
  default: 'dark',
  // No `light` theme on purpose — the sandbox is dark-only. The
  // `systemPreference` auto-detection only fires when both 'light'
  // and 'dark' theme names exist, so omitting light is safe.
  themes: {
    dark: {
      // Surface tones.
      '--color-bg': 'oklch(0.14 0.005 285.823)', // zinc-950
      '--color-fg': 'oklch(0.97 0.001 286)', // zinc-100
      '--color-card': 'oklch(0.21 0.006 286)', // zinc-900
      '--color-card-fg': 'oklch(0.92 0.004 286)', // zinc-200
      '--color-muted': 'oklch(0.55 0.016 286)', // zinc-500
      '--color-border': 'oklch(0.27 0.006 286)', // zinc-800
      // Accent — sandbox's signature warm orange (was --color-accent in
      // the pre-tokens base CSS).
      '--color-accent': 'oklch(0.83 0.19 84)', // amber-400
      '--color-accent-fg': 'oklch(0.14 0.005 286)',
      // Destructive — for error-boundary demo.
      '--color-destructive': 'oklch(0.71 0.19 13)', // rose-400
      '--color-destructive-fg': 'oklch(0.97 0.001 286)',
      // Non-color tokens.
      '--radius-md': '0.375rem',
      '--font-sans': 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
      '--font-mono':
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
  },
})
