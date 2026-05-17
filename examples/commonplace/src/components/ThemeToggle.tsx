// Theme toggle — flips between light and dark and writes the
// `place-theme` cookie so the next request boots in the same theme.
// Pure client component; the actual theme tokens are emitted by
// serve()'s tailwind base (see ../theme.ts).
//
// No flash on toggle: `setTheme()` updates the class on <html>
// synchronously, then writes the cookie. The class flip is what the
// CSS variables react to; the cookie is just for next-pageload memory.

import { cls, component, setTheme } from '@place/component'
import { state } from '@place/reactivity'
import { tokens } from '../theme.ts'

const initialTheme = (): 'light' | 'dark' => {
  if (typeof document === 'undefined') return 'dark'
  for (const name of tokens.names) {
    if (document.documentElement.classList.contains(tokens.htmlClass(name))) {
      return name as 'light' | 'dark'
    }
  }
  return tokens.default as 'light' | 'dark'
}

// Inline SVG icons — no external dep, no CSP issue.
const SunIcon = (): JSX.Element => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
)
const MoonIcon = (): JSX.Element => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

export const ThemeToggle = component(() => {
  const current = state(initialTheme())
  const toggle = (): void => {
    const next = current() === 'dark' ? 'light' : 'dark'
    setTheme(tokens, next)
    current.set(next)
  }
  return (
    <button
      type="button"
      onClick={toggle}
      title={() => `switch to ${current() === 'dark' ? 'light' : 'dark'} theme`}
      aria-label="toggle theme"
      class={cls(
        'inline-flex items-center justify-center w-8 h-8 rounded-md',
        'text-muted hover:text-fg hover:bg-card border border-transparent hover:border-border',
        'transition-colors',
      )}
    >
      {() => (current() === 'dark' ? <SunIcon /> : <MoonIcon />)}
    </button>
  )
})
