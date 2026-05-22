// @vitest-environment happy-dom
//
// DOM-dependent theme tests (0.10.1): the `setTheme(name)` overload
// + `useTheme()` hook + the cross-island `place:theme-changed` event
// sync. Lives in a separate file because the rest of `theme.test.ts`
// is node-env (pure SSR / string-emitter tests) and vitest only honors
// the `@vitest-environment` directive at the top of a file.

import { beforeEach, describe, expect, test } from 'vitest'

import { setTheme, useTheme } from '../../src/index.ts'

const stash = {
  names: ['dark', 'light'],
  classes: ['theme-dark', 'theme-light'],
  cookieName: 'place-theme',
}

const resetEnv = (): void => {
  document.documentElement.className = ''
  delete document.documentElement.dataset['placeTheme']
  document.cookie = 'place-theme=; Path=/; Max-Age=0'
  delete (window as { __placeTheme?: unknown }).__placeTheme
}

beforeEach(() => {
  resetEnv()
})

describe('setTheme(name) overload — reads window.__placeTheme stash', () => {
  test('throws when no stash is registered', () => {
    expect(() => setTheme('dark')).toThrow(/no theme registered/i)
  })

  test('writes the matching class + data attr from the stash', () => {
    ;(window as { __placeTheme?: unknown }).__placeTheme = stash
    setTheme('light')
    expect(document.documentElement.classList.contains('theme-light')).toBe(true)
    expect(document.documentElement.classList.contains('theme-dark')).toBe(false)
    expect(document.documentElement.dataset['placeTheme']).toBe('light')
    expect(document.cookie).toContain('place-theme=light')
  })

  test('"system" strips all theme classes and sets data attr', () => {
    ;(window as { __placeTheme?: unknown }).__placeTheme = stash
    document.documentElement.classList.add('theme-dark') // simulate prior state
    setTheme('system')
    expect(document.documentElement.classList.contains('theme-dark')).toBe(false)
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
    expect(document.documentElement.dataset['placeTheme']).toBe('system')
    expect(document.cookie).toContain('place-theme=system')
  })

  test('dispatches place:theme-changed for cross-island sync', () => {
    ;(window as { __placeTheme?: unknown }).__placeTheme = stash
    let received: string | undefined
    window.addEventListener('place:theme-changed', (e) => {
      received = (e as CustomEvent<string>).detail
    })
    setTheme('dark')
    expect(received).toBe('dark')
  })

  test('unknown mode falls through (no class added), but event still fires', () => {
    ;(window as { __placeTheme?: unknown }).__placeTheme = stash
    setTheme('not-a-mode')
    // Cookie is written verbatim — early-paint script would re-clean
    // it on next load (which it does for any unknown value).
    expect(document.cookie).toContain('place-theme=not-a-mode')
    expect(document.documentElement.classList.contains('theme-dark')).toBe(false)
    expect(document.documentElement.classList.contains('theme-light')).toBe(false)
    expect(document.documentElement.dataset['placeTheme']).toBe('not-a-mode')
  })
})

describe('useTheme() — reactive handle', () => {
  test('reads initial state from data-place-theme', () => {
    ;(window as { __placeTheme?: unknown }).__placeTheme = stash
    document.documentElement.dataset['placeTheme'] = 'dark'
    const theme = useTheme()
    expect(theme.current()).toBe('dark')
    expect(theme.isSystem()).toBe(false)
    expect(theme.modes).toEqual(['dark', 'light'])
  })

  test('defaults to system when data attr is absent', () => {
    ;(window as { __placeTheme?: unknown }).__placeTheme = stash
    const theme = useTheme()
    expect(theme.current()).toBe('system')
    expect(theme.isSystem()).toBe(true)
  })

  test('set() updates reactive current() + persists class + cookie', () => {
    ;(window as { __placeTheme?: unknown }).__placeTheme = stash
    document.documentElement.dataset['placeTheme'] = 'system'
    const theme = useTheme()
    expect(theme.current()).toBe('system')
    theme.set('light')
    expect(theme.current()).toBe('light')
    expect(document.documentElement.classList.contains('theme-light')).toBe(true)
    expect(document.cookie).toContain('place-theme=light')
  })

  test('cross-instance sync via place:theme-changed event', () => {
    ;(window as { __placeTheme?: unknown }).__placeTheme = stash
    document.documentElement.dataset['placeTheme'] = 'system'
    const a = useTheme()
    const b = useTheme()
    expect(a.current()).toBe('system')
    expect(b.current()).toBe('system')
    // A sets — B should see it through the event sync.
    a.set('dark')
    expect(a.current()).toBe('dark')
    expect(b.current()).toBe('dark')
  })

  test('empty modes list when no stash is registered', () => {
    // No stash assignment — simulate an app without theme: config.
    const theme = useTheme()
    expect(theme.modes).toEqual([])
    expect(theme.current()).toBe('system')
  })

  test('removes the place:theme-changed listener on cleanup', async () => {
    // Regression: useTheme used to addEventListener with no removal,
    // leaking a listener per island mount. Now uses onCleanup() to
    // unregister when the enclosing view is disposed.
    const { withCleanups, disposeAll } = await import('../../src/_internal/cleanup.ts')
    ;(window as { __placeTheme?: unknown }).__placeTheme = stash
    document.documentElement.dataset['placeTheme'] = 'system'

    // Track addEventListener / removeEventListener calls for the
    // place:theme-changed event.
    const origAdd = window.addEventListener.bind(window)
    const origRemove = window.removeEventListener.bind(window)
    let addCount = 0
    let removeCount = 0
    window.addEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === 'place:theme-changed') addCount++
      // biome-ignore lint/suspicious/noExplicitAny: spy proxy
      return origAdd(type as any, ...(rest as [any]))
    }) as typeof window.addEventListener
    window.removeEventListener = ((type: string, ...rest: unknown[]) => {
      if (type === 'place:theme-changed') removeCount++
      // biome-ignore lint/suspicious/noExplicitAny: spy proxy
      return origRemove(type as any, ...(rest as [any]))
    }) as typeof window.removeEventListener

    try {
      const cleanups: Array<() => void> = []
      const handle = withCleanups(cleanups, () => useTheme())
      expect(handle.current()).toBe('system')
      expect(addCount).toBe(1)
      expect(removeCount).toBe(0)
      // Simulate the enclosing view being disposed.
      disposeAll(cleanups)
      expect(removeCount).toBe(1)
    } finally {
      window.addEventListener = origAdd
      window.removeEventListener = origRemove
    }
  })
})
