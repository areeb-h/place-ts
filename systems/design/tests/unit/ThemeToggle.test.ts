// @vitest-environment happy-dom

import { mount, renderToString } from '@place-ts/component'
import { beforeEach, describe, expect, test } from 'vitest'

import { ThemeToggle } from '../../src/ThemeToggle.tsx'

const stash = {
  names: ['dark', 'light'],
  classes: ['theme-dark', 'theme-light'],
  cookieName: 'place-theme',
}

const installStash = (): void => {
  ;(window as { __placeTheme?: unknown }).__placeTheme = stash
  document.documentElement.dataset['placeTheme'] = 'system'
}

beforeEach(() => {
  document.documentElement.className = ''
  delete document.documentElement.dataset['placeTheme']
  document.cookie = 'place-theme=; Path=/; Max-Age=0'
  delete (window as { __placeTheme?: unknown }).__placeTheme
})

describe('<ThemeToggle> — defaults', () => {
  test('renders a fieldset with 3 buttons (system + each configured mode)', () => {
    installStash()
    const html = renderToString(ThemeToggle({}))
    expect(html).toMatch(/^<fieldset/)
    const buttonCount = (html.match(/<button/g) ?? []).length
    expect(buttonCount).toBe(3)
    // Each button has its mode's aria-label
    expect(html).toContain('aria-label="System theme"')
    expect(html).toContain('aria-label="Light theme"')
    expect(html).toContain('aria-label="Dark theme"')
  })

  test('legend is screen-reader-only', () => {
    installStash()
    const html = renderToString(ThemeToggle({}))
    expect(html).toMatch(/<legend[^>]*class="sr-only"[^>]*>Theme<\/legend>/)
  })

  test('includes default symbols ◑ ☀ ☾', () => {
    installStash()
    const html = renderToString(ThemeToggle({}))
    expect(html).toContain('◑')
    expect(html).toContain('☀')
    expect(html).toContain('☾')
  })
})

describe('<ThemeToggle> — variant=cycle', () => {
  test('renders a single button', () => {
    installStash()
    const html = renderToString(ThemeToggle({ variant: 'cycle' }))
    const buttonCount = (html.match(/<button/g) ?? []).length
    expect(buttonCount).toBe(1)
  })
})

describe('<ThemeToggle> — prop overrides', () => {
  test('includeSystem={false} hides the system button', () => {
    installStash()
    const html = renderToString(ThemeToggle({ includeSystem: false }))
    expect(html).not.toContain('aria-label="System theme"')
    const buttonCount = (html.match(/<button/g) ?? []).length
    expect(buttonCount).toBe(2)
  })

  test('modes={[...]} restricts the rendered options', () => {
    installStash()
    const html = renderToString(ThemeToggle({ modes: ['dark'] }))
    // 'system' (default-on) + just 'dark' from the modes list.
    expect(html).toContain('aria-label="System theme"')
    expect(html).toContain('aria-label="Dark theme"')
    expect(html).not.toContain('aria-label="Light theme"')
  })

  test('labels override default aria-labels per mode', () => {
    installStash()
    const html = renderToString(
      ThemeToggle({ labels: { system: 'Auto', light: 'Day', dark: 'Night' } }),
    )
    expect(html).toContain('aria-label="Auto"')
    expect(html).toContain('aria-label="Day"')
    expect(html).toContain('aria-label="Night"')
    expect(html).not.toContain('aria-label="System theme"')
  })

  test('class is appended to the wrapper', () => {
    installStash()
    const html = renderToString(ThemeToggle({ class: 'ml-auto custom-x' }))
    expect(html).toContain('ml-auto')
    expect(html).toContain('custom-x')
  })

  test('size variant changes button padding classes', () => {
    installStash()
    const sm = renderToString(ThemeToggle({ size: 'sm' }))
    const lg = renderToString(ThemeToggle({ size: 'lg' }))
    expect(sm).toContain('text-xs')
    expect(lg).toContain('text-base')
  })
})

describe('<ThemeToggle> — SSR markup is a real <fieldset>', () => {
  test('mount produces a fieldset element', () => {
    installStash()
    const root = document.createElement('div')
    mount(ThemeToggle({}), root)
    expect(root.firstChild?.nodeName).toBe('FIELDSET')
  })
})
