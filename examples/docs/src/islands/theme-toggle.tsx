// Three-way theme picker — light / dark / system. ISLAND.
//
// SSR renders the buttons with the cookie-derived initial state (no
// blip on hard refresh). The island bundle attaches reactivity on
// client mount; clicking a button writes the cookie + applies the
// theme class to <html> in one tick.
//
// 'system' leaves the <html> theme class unset so the framework's
// `@media (prefers-color-scheme: …)` CSS bindings drive appearance.
// matchMedia listens for OS-theme changes and re-applies after mount.

// `island`, `cookie`, `onMount`, `setTheme`, `state` are framework
// primitives auto-imported via the @place/component plugin.
import { tokens } from '../theme.ts'

type Choice = 'light' | 'dark' | 'system'

const CHOICE_COOKIE = 'place-theme-choice'

const writeChoiceCookie = (choice: Choice): void => {
  // biome-ignore lint/suspicious/noDocumentCookie: synchronous cookie write — matches setTheme().
  document.cookie = `${CHOICE_COOKIE}=${choice}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`
}

const systemTheme = (): 'light' | 'dark' =>
  window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'

const applyChoice = (choice: Choice): void => {
  const effective = choice === 'system' ? systemTheme() : choice
  setTheme(tokens, effective)
  writeChoiceCookie(choice)
}

const initialChoice = (): Choice => {
  const raw = cookie(CHOICE_COOKIE)
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

const OPT =
  'inline-flex items-center justify-center w-[26px] h-[26px] rounded-md text-[13px] ' +
  'text-muted bg-transparent border-0 cursor-pointer ' +
  'transition-colors duration-150 hover:text-fg ' +
  'aria-[pressed=true]:text-accent aria-[pressed=true]:bg-accent/12'

const ThemeToggleImpl = () => {
  const choice = state<Choice>(initialChoice())

  onMount(() => {
    const mql = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (): void => {
      if (choice() === 'system') applyChoice('system')
    }
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  })

  const pick = (next: Choice): void => {
    choice.set(next)
    applyChoice(next)
  }

  return (
    <fieldset
      class="inline-flex items-center gap-0.5 p-[3px] rounded-lg border border-border/60 bg-card/50"
      aria-label="Theme"
    >
      <button
        type="button"
        class={OPT}
        aria-pressed={() => String(choice() === 'light')}
        aria-label="Light"
        onClick={() => pick('light')}
      >
        ☀
      </button>
      <button
        type="button"
        class={OPT}
        aria-pressed={() => String(choice() === 'system')}
        aria-label="System"
        onClick={() => pick('system')}
      >
        ⌬
      </button>
      <button
        type="button"
        class={OPT}
        aria-pressed={() => String(choice() === 'dark')}
        aria-label="Dark"
        onClick={() => pick('dark')}
      >
        ☾
      </button>
    </fieldset>
  )
}

export default island(ThemeToggleImpl)

// hmr-test-mark

// hmr-test-mark
