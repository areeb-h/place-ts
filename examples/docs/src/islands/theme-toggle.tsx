// Three-way theme picker — light / dark / system. ISLAND.
//
// Theme persistence + no-flash application is FRAMEWORK-OWNED. Passing
// `theme` to `app()` makes `serve()` / `app().build()` auto-inject
// `themeEarlyScript()` into every page's `<head>` — it reads the
// `place-theme` cookie, applies the matching class before first paint
// (on a live server AND a static export), and mirrors the choice to
// `<html data-place-theme="…">`.
//
// So this island only:
//   1. writes the choice on click via `setTheme()` (cookie + class +
//      `data-place-theme`), and
//   2. reflects the choice in `aria-pressed` for assistive tech.
//
// The PRESSED VISUAL is pure CSS keyed off `<html data-place-theme>`
// (see `.place-theme-opt` in styles.ts) — set pre-paint by the early
// script, so there is no SSR/hydration mismatch and no blip on a hard
// refresh. `'system'` removes every theme class, letting the
// stylesheet's `@media (prefers-color-scheme)` bindings track the OS
// with zero JS.
//
// `island`, `setTheme`, `state` are framework primitives auto-imported
// via the `@place/component` plugin.
import { tokens } from '../theme.ts'

type Choice = 'light' | 'dark' | 'system'

// Current choice — read from the `data-place-theme` attribute the
// early script already resolved (client), else `'system'` (SSR).
const currentChoice = (): Choice => {
  if (typeof document === 'undefined') return 'system'
  const v = document.documentElement.dataset['placeTheme']
  return v === 'light' || v === 'dark' ? v : 'system'
}

const OPT =
  'place-theme-opt inline-flex items-center justify-center w-[26px] h-[26px] ' +
  'rounded-md text-[13px] text-muted bg-transparent border-0 cursor-pointer ' +
  'transition-colors duration-150 hover:text-fg'

const ThemeToggleImpl = () => {
  const choice = state<Choice>(currentChoice())

  const pick = (next: Choice): void => {
    choice.set(next)
    // Writes the `place-theme` cookie, applies / clears the theme
    // class, and updates `<html data-place-theme>` — which the CSS
    // pressed-state rule keys off.
    setTheme(tokens, next)
  }

  const opt = (value: Choice, glyph: string, label: string) => (
    <button
      type="button"
      class={OPT}
      data-choice={value}
      aria-pressed={() => String(choice() === value)}
      aria-label={label}
      onClick={() => pick(value)}
    >
      {glyph}
    </button>
  )

  return (
    <fieldset
      class="inline-flex items-center gap-0.5 p-[3px] rounded-lg border border-border/60 bg-card/50"
      aria-label="Theme"
    >
      {opt('light', '☀', 'Light')}
      {opt('system', '⌬', 'System')}
      {opt('dark', '☾', 'Dark')}
    </fieldset>
  )
}

export default view(ThemeToggleImpl)
