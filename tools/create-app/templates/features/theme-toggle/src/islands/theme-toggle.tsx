// Theme toggle island — segmented control for system / light / dark.
//
// The framework handles the heavy lifting:
//   - `setTheme(tokens, choice)` strips every theme-* class on <html>,
//     adds the new one (or none for 'system'), sets `data-place-theme`,
//     and persists the choice as a long-lived cookie.
//   - The framework's `themeEarlyScript()` runs before paint on every
//     page (including hard refresh + static export) — it reads the
//     cookie and applies the class with zero flash.
//   - When the cookie is 'system' or unset, no theme class is on root,
//     so the stylesheet's `@media (prefers-color-scheme: …)` bindings
//     drive appearance from the OS preference.
//
// Initial state comes from `<html data-place-theme="…">`, which the
// early script sets pre-paint. On the server (where there's no
// document), default to 'system'.
//
// Auto-imported: `island`, `state`. The island ships ~1kB of client JS.

import { setTheme } from '@place-ts/component'
import { tokens } from '../theme.ts'

type Choice = 'system' | 'light' | 'dark'

const CHOICES: ReadonlyArray<{ value: Choice; label: string; symbol: string }> = [
  { value: 'system', label: 'System theme', symbol: '◑' },
  { value: 'light', label: 'Light theme', symbol: '☀' },
  { value: 'dark', label: 'Dark theme', symbol: '☾' },
]

const readInitialChoice = (): Choice => {
  if (typeof document === 'undefined') return 'system'
  const v = document.documentElement.dataset['placeTheme']
  if (v === 'light' || v === 'dark' || v === 'system') return v
  return 'system'
}

export default island(() => {
  const choice = state<Choice>(readInitialChoice())

  const pick = (next: Choice): void => {
    choice.set(next)
    setTheme(tokens, next)
  }

  return (
    <fieldset class="inline-flex items-center gap-0.5 rounded-md border border-border bg-card/60 p-0.5">
      <legend class="sr-only">Theme</legend>
      {CHOICES.map((c) => (
        <button
          type="button"
          aria-label={c.label}
          aria-pressed={() => (choice() === c.value ? 'true' : 'false')}
          onClick={() => pick(c.value)}
          class={() =>
            choice() === c.value
              ? 'rounded px-2 py-1 text-sm font-medium bg-bg text-fg shadow-sm'
              : 'rounded px-2 py-1 text-sm text-muted hover:text-fg transition-colors'
          }
        >
          <span aria-hidden="true">{c.symbol}</span>
        </button>
      ))}
    </fieldset>
  )
})
