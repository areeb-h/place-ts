// Theme toggle island. Reads the framework's `theme()` cookie + sets
// it on click; the next page render uses the new mode. Because the
// framework injects an early-paint script that reads the cookie
// BEFORE first paint, hard refreshes show the user's preferred
// theme with no flash.
//
// Auto-imported: `island`, `state`. The framework exposes
// `document.cookie` reads from the client, so this island runs in
// the browser only.

const COOKIE = 'place-theme'
const readCookie = (): 'dark' | 'light' => {
  if (typeof document === 'undefined') return 'dark'
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`))
  return (m?.[1] as 'dark' | 'light') ?? 'dark'
}

export default island(() => {
  const mode = state<'dark' | 'light'>(readCookie())

  const toggle = (): void => {
    const next = mode() === 'dark' ? 'light' : 'dark'
    mode.set(next)
    document.cookie = `${COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
    // Apply immediately — the framework keys the body on `<theme>` class.
    document.documentElement.classList.remove('dark', 'light')
    document.documentElement.classList.add(next)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      class="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-fg hover:bg-bg transition-colors"
    >
      {() => (mode() === 'dark' ? '☾ dark' : '☀ light')}
    </button>
  )
})
