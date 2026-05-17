// commonplace — theme tokens. Defines the design vocabulary the rest
// of the app composes against. Two themes (light + dark) sharing the
// same token keys; non-color tokens (radius, font) live in `dark` and
// `light` symmetrically so swapping doesn't leak stale values.
//
// Tokens are CSS custom properties, registered with Tailwind v4 via
// the `@theme {}` block emitted by `themeTokens()`. Once registered
// they unlock utilities like `bg-bg`, `text-fg`, `border-border`,
// `text-muted`, `bg-card`, `text-accent`, `rounded-md`. Components in
// the rest of the app reference these tokens — never raw zinc-950 etc
// — so theme-switching means re-binding the variables, not chasing
// classes through every file.

import { themeTokens } from '@place/component'

export const tokens = themeTokens({
  // Default = whatever ships at `:root`. We pick `dark` because the
  // existing commonplace look is dark-first; light is the alternative
  // that wins under `prefers-color-scheme: light` or an explicit
  // `theme-light` class on <html>.
  default: 'dark',
  themes: {
    dark: {
      // Surface tones — bg lives behind everything; card is the raised
      // surface (sidebar, dialogs); muted is for secondary text.
      '--color-bg': 'oklch(0.14 0.005 285.823)', // zinc-950
      '--color-fg': 'oklch(0.97 0.001 286)', // zinc-100
      '--color-card': 'oklch(0.21 0.006 286)', // zinc-900
      '--color-card-fg': 'oklch(0.92 0.004 286)', // zinc-200
      '--color-muted': 'oklch(0.55 0.016 286)', // zinc-500
      '--color-border': 'oklch(0.27 0.006 286)', // zinc-800
      // Accent is the action color — buttons, selected rows, focus rings.
      '--color-accent': 'oklch(0.83 0.19 84)', // amber-400
      '--color-accent-fg': 'oklch(0.14 0.005 286)', // dark text on amber
      // Destructive — for delete buttons and the like.
      '--color-destructive': 'oklch(0.71 0.19 13)', // rose-400
      '--color-destructive-fg': 'oklch(0.97 0.001 286)',
      // Non-color design tokens. Same value across themes (the size of
      // a button corner doesn't depend on whether it's dark mode), but
      // declared on both sides so the token list is symmetric.
      '--radius-md': '0.375rem',
      '--radius-lg': '0.5rem',
      '--font-sans': 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
      '--font-mono':
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
    light: {
      '--color-bg': 'oklch(1 0 0)',
      '--color-fg': 'oklch(0.21 0.006 286)', // zinc-900
      '--color-card': 'oklch(0.985 0 0)', // off-white
      '--color-card-fg': 'oklch(0.21 0.006 286)',
      '--color-muted': 'oklch(0.55 0.016 286)',
      '--color-border': 'oklch(0.92 0.004 286)', // zinc-200
      '--color-accent': 'oklch(0.66 0.22 25)', // burnt orange — a bit darker for contrast on white
      '--color-accent-fg': 'oklch(1 0 0)',
      '--color-destructive': 'oklch(0.55 0.22 25)',
      '--color-destructive-fg': 'oklch(1 0 0)',
      '--radius-md': '0.375rem',
      '--radius-lg': '0.5rem',
      '--font-sans': 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
      '--font-mono':
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    },
  },
  // Auto-detected from theme names: `prefers-color-scheme: dark` →
  // dark, `prefers-color-scheme: light` → light. An explicit
  // `theme-light` / `theme-dark` class on <html> always wins. No
  // configuration needed.
})
