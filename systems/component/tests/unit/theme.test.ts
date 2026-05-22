// @vitest-environment node

import { describe, expect, test } from 'vitest'
import {
  DEFAULT_THEME_COOKIE,
  readThemeFromRequest,
  theme,
  themeCookieHeader,
  themeTokens,
} from '../../src/index.ts'
import { resolveTailwindFromTheme } from '../../src/server.ts'

describe('themeTokens — typed, SSR-safe theme registration', () => {
  test('default theme tokens land in @theme block; non-default emits override class', () => {
    const t = themeTokens({
      default: 'light',
      themes: {
        light: { '--color-bg': 'white', '--color-fg': 'black' },
        dark: { '--color-bg': 'black', '--color-fg': 'white' },
      },
    })
    // @import is included so callers don't have to prepend it.
    expect(t.base).toContain('@import "tailwindcss"')
    // Default theme tokens are in @theme so Tailwind v4 picks them up.
    expect(t.base).toMatch(
      /@theme\s*\{[\s\S]*--color-bg:\s*white;[\s\S]*--color-fg:\s*black;[\s\S]*\}/,
    )
    // Both themes emit override classes (default's class is redundant
    // with @theme but lets explicit-default-via-class win over the
    // opposite system preference; see theme.ts).
    expect(t.base).toMatch(/\.theme-dark\s*\{[\s\S]*--color-bg:\s*black;[\s\S]*\}/)
    expect(t.base).toMatch(/\.theme-light\s*\{[\s\S]*--color-bg:\s*white;[\s\S]*\}/)
  })

  test('htmlClass(theme) returns a class name suitable for <html>', () => {
    const t = themeTokens({
      default: 'a',
      themes: { a: { '--x': '1' }, b: { '--x': '2' } },
    })
    expect(t.htmlClass('a')).toBe('theme-a')
    expect(t.htmlClass('b')).toBe('theme-b')
  })

  test('classPrefix is configurable', () => {
    const t = themeTokens({
      default: 'light',
      classPrefix: 't-',
      themes: { light: { '--x': '1' }, dark: { '--x': '2' } },
    })
    expect(t.htmlClass('dark')).toBe('t-dark')
    expect(t.base).toContain('.t-dark')
  })

  test('auto prefers-color-scheme: when light + dark theme names exist', () => {
    const t = themeTokens({
      default: 'light',
      themes: {
        light: { '--color-bg': 'white' },
        dark: { '--color-bg': 'black' },
      },
    })
    // dark != default → emits @media (prefers-color-scheme: dark) block.
    expect(t.base).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{[\s\S]*--color-bg:\s*black/)
    // The @media targets `:root:not(.theme-X)` for every theme, so
    // any explicit choice wins over system preference.
    expect(t.base).toContain(':root:not(.theme-light):not(.theme-dark)')
  })

  test('explicit systemPreference: false disables @media binding', () => {
    const t = themeTokens({
      default: 'light',
      systemPreference: false,
      themes: { light: { '--x': '1' }, dark: { '--x': '2' } },
    })
    expect(t.base).not.toContain('@media (prefers-color-scheme')
  })

  test('non-conventional theme names: no auto media binding', () => {
    const t = themeTokens({
      default: 'classic',
      themes: { classic: { '--x': '1' }, modern: { '--x': '2' } },
    })
    expect(t.base).not.toContain('@media (prefers-color-scheme')
  })

  test('throws on missing token in non-default theme', () => {
    expect(() =>
      themeTokens({
        default: 'light',
        themes: {
          light: { '--color-bg': 'white', '--color-fg': 'black' },
          // dark is missing --color-fg
          dark: { '--color-bg': 'black' } as { '--color-bg': string; '--color-fg': string },
        },
      }),
    ).toThrow(/theme 'dark' is missing token '--color-fg'/)
  })

  test('throws on extra token in non-default theme', () => {
    expect(() =>
      themeTokens({
        default: 'light',
        themes: {
          light: { '--x': '1' },
          dark: { '--x': '2', '--y': '3' } as { '--x': string },
        },
      }),
    ).toThrow(/theme 'dark' declares extra token '--y'/)
  })

  test('throws on token name not starting with --', () => {
    expect(() =>
      themeTokens({
        default: 'light',
        themes: { light: { 'color-bg': 'white' } as Record<string, string> },
      }),
    ).toThrow(/'color-bg'.*must start with '--'/)
  })

  test('token-name error names the theme (0.5.1 DX fix)', () => {
    // The error message identifies WHICH theme had the bad token —
    // critical when an app has 5+ themes and you need to know which
    // one to fix. (The bad token is in the default theme; that's the
    // path that flows through `tokensToLines` with the theme-name
    // annotation we added in 0.5.1.)
    expect(() =>
      themeTokens({
        default: 'main',
        themes: { main: { 'color-bg': 'white' } as Record<string, string> },
      }),
    ).toThrow(/in theme 'main'/)
  })

  test('throws on theme name with invalid CSS class chars', () => {
    expect(() =>
      themeTokens({
        default: 'a b',
        themes: { 'a b': { '--x': '1' } },
      }),
    ).toThrow(/'a b' is not a valid CSS class fragment/)
  })

  test('throws on default theme not in themes', () => {
    expect(() =>
      themeTokens({
        default: 'missing' as 'a',
        themes: { a: { '--x': '1' } },
      }),
    ).toThrow(/default theme 'missing' not found/)
  })

  test('names list reflects declaration order; default field is the chosen theme', () => {
    const t = themeTokens({
      default: 'b',
      themes: { a: { '--x': '1' }, b: { '--x': '2' }, c: { '--x': '3' } },
    })
    expect(t.names).toEqual(['a', 'b', 'c'])
    expect(t.default).toBe('b')
  })

  test('integrates with serve()-shaped tailwind.base — base is a single string', () => {
    const t = themeTokens({
      default: 'dark',
      themes: {
        dark: { '--color-bg': 'oklch(0.14 0 0)', '--radius-md': '0.375rem' },
        light: { '--color-bg': 'white', '--radius-md': '0.375rem' },
      },
    })
    expect(typeof t.base).toBe('string')
    // Tailwind v4 imports first, then @theme, then overrides, then @media.
    const importIdx = t.base.indexOf('@import')
    const themeIdx = t.base.indexOf('@theme')
    const overrideIdx = t.base.indexOf('.theme-light')
    expect(importIdx).toBeGreaterThanOrEqual(0)
    expect(themeIdx).toBeGreaterThan(importIdx)
    expect(overrideIdx).toBeGreaterThan(themeIdx)
  })
})

describe('cookie helpers — server-side theme persistence', () => {
  const tokens = themeTokens({
    default: 'light',
    themes: {
      light: { '--color-bg': 'white' },
      dark: { '--color-bg': 'black' },
    },
  })

  test('readThemeFromRequest: returns null when no cookie (system / no class on root)', () => {
    // 0.10.1 — was `tokens.default`; now `null` so the SSR doesn't ship a
    // class that the early-paint script would then have to strip (the
    // class-flip blip the user reported). Null → caller emits no
    // htmlClass prefix → `@media (prefers-color-scheme)` drives.
    const req = new Request('http://x/')
    expect(readThemeFromRequest(req, tokens)).toBeNull()
  })

  test('readThemeFromRequest: returns null when cookie is `system` explicitly', () => {
    const req = new Request('http://x/', {
      headers: { cookie: 'place-theme=system' },
    })
    expect(readThemeFromRequest(req, tokens)).toBeNull()
  })

  test('readThemeFromRequest: returns user choice when cookie matches a theme', () => {
    const req = new Request('http://x/', {
      headers: { cookie: 'place-theme=dark' },
    })
    expect(readThemeFromRequest(req, tokens)).toBe('dark')
  })

  test('readThemeFromRequest: returns null on unknown theme names (tamper-resistant)', () => {
    // 0.10.1 — was `tokens.default`; now `null` for the same reason as
    // the no-cookie case: refuse to ship a class the script then strips.
    const req = new Request('http://x/', {
      headers: { cookie: 'place-theme=evil-class' },
    })
    expect(readThemeFromRequest(req, tokens)).toBeNull()
  })

  test('readThemeFromRequest: parses cookie among multiple', () => {
    const req = new Request('http://x/', {
      headers: { cookie: 'session=abc; place-theme=dark; csrf=xyz' },
    })
    expect(readThemeFromRequest(req, tokens)).toBe('dark')
  })

  test('readThemeFromRequest: custom cookie name', () => {
    const req = new Request('http://x/', {
      headers: { cookie: 'app-theme=dark' },
    })
    expect(readThemeFromRequest(req, tokens, 'app-theme')).toBe('dark')
  })

  test('themeCookieHeader: produces a long-lived SameSite=Lax Set-Cookie', () => {
    const header = themeCookieHeader('dark')
    expect(header).toContain(`${DEFAULT_THEME_COOKIE}=dark`)
    expect(header).toContain('Path=/')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Max-Age=')
    // Default not Secure (works on plain HTTP localhost).
    expect(header).not.toContain('Secure')
  })

  test('themeCookieHeader: secure flag opt-in', () => {
    const header = themeCookieHeader('dark', { secure: true })
    expect(header).toContain('Secure')
  })

  test('themeCookieHeader: encodes value (special-char safety)', () => {
    const header = themeCookieHeader('a b')
    // ' ' encodes to '%20'.
    expect(header).toContain(`${DEFAULT_THEME_COOKIE}=a%20b`)
  })
})

describe('resolveTailwindFromTheme — serve()-level shorthand', () => {
  const tokens = themeTokens({
    default: 'dark',
    themes: {
      dark: { '--color-bg': 'oklch(0.14 0 0)' },
      light: { '--color-bg': 'oklch(1 0 0)' },
    },
  })

  test('theme + tailwind: true → fills tailwind.base from theme.base', () => {
    const resolved = resolveTailwindFromTheme(tokens, true)
    expect(typeof resolved).toBe('object')
    expect((resolved as { base: string }).base).toBe(tokens.base)
  })

  test('theme + tailwind: { base: custom } → custom base wins (preserved)', () => {
    const resolved = resolveTailwindFromTheme(tokens, { base: '@import "tailwindcss";' })
    expect((resolved as { base: string }).base).toBe('@import "tailwindcss";')
    // Did NOT replace with tokens.base.
    expect((resolved as { base: string }).base).not.toBe(tokens.base)
  })

  test('theme + no tailwind option → no Tailwind compilation triggered', () => {
    // Auto-fill must NOT turn Tailwind on for users who opted out.
    // Theme-only users get CSS-variable theming via the top-level
    // `htmlClass` field + their own stylesheets, without paying the
    // Tailwind compile cost.
    expect(resolveTailwindFromTheme(tokens, undefined)).toBeUndefined()
    expect(resolveTailwindFromTheme(tokens, false)).toBe(false)
  })

  test('no theme passed → returns tailwind input unchanged', () => {
    expect(resolveTailwindFromTheme(undefined, true)).toBe(true)
    expect(resolveTailwindFromTheme(undefined, { content: ['x'] })).toEqual({
      content: ['x'],
    })
  })

  test('theme without .base (custom minimal theme) → no auto-fill', () => {
    // A hand-rolled minimal theme has no `.base` field. The auto-fill
    // returns the tailwind option unchanged.
    const minimal: { base?: string } = {}
    const resolved = resolveTailwindFromTheme(minimal, true)
    expect(resolved).toBe(true)
  })
})

describe('themeTokens — typography extension', () => {
  test('without typography option, base is color-only (back-compat)', () => {
    const t = themeTokens({
      default: 'light',
      themes: { light: { '--color-bg': 'white' } },
    })
    expect(t.base).not.toContain('--font-sans')
    expect(t.base).not.toContain('.text-display')
    expect(t.base).not.toContain('.text-body')
  })

  test('typography: {} emits all default scales + role utility classes', () => {
    const t = themeTokens({
      default: 'light',
      themes: { light: { '--color-bg': 'white' } },
      typography: {},
    })
    // Default families emitted as --font-* in @theme.
    expect(t.base).toMatch(/--font-sans:[^;]*system-ui[^;]*;/)
    expect(t.base).toMatch(/--font-mono:[^;]*ui-monospace[^;]*;/)
    // Default weights as --font-weight-* (Tailwind v4 convention).
    expect(t.base).toContain('--font-weight-regular: 400;')
    expect(t.base).toContain('--font-weight-bold: 700;')
    // Default leading.
    expect(t.base).toContain('--leading-normal: 1.55;')
    expect(t.base).toContain('--leading-tight: 1.2;')
    // Default tracking.
    expect(t.base).toContain('--tracking-tight: -0.02em;')
    // Default role classes — at least display, h1, body, meta.
    expect(t.base).toMatch(/\.text-display\s*\{/)
    expect(t.base).toMatch(/\.text-h1\s*\{/)
    expect(t.base).toMatch(/\.text-body\s*\{/)
    expect(t.base).toMatch(/\.text-meta\s*\{/)
    expect(t.base).toMatch(/\.text-mono\s*\{/)
  })

  test('typography roles emit font-size in rem via modular scale', () => {
    const t = themeTokens({
      default: 'light',
      themes: { light: { '--color-bg': 'white' } },
      typography: { base: 16, scale: 'major-third' /* 1.25 */ },
    })
    // body is step 0 → 16/16 = 1rem.
    expect(t.base).toMatch(/\.text-body\s*\{[^}]*font-size:\s*1rem;/)
    // h1 is step +4 → 16 * 1.25^4 / 16 ≈ 2.4414rem
    expect(t.base).toMatch(/\.text-h1\s*\{[^}]*font-size:\s*2\.\d+rem;/)
    // meta is step -1 → 16 / 1.25 = 12.8px → 0.8rem
    expect(t.base).toMatch(/\.text-meta\s*\{[^}]*font-size:\s*0\.8rem;/)
  })

  test('custom scale ratio changes computed sizes', () => {
    const tight = themeTokens({
      default: 'light',
      themes: { light: { '--color-bg': 'white' } },
      typography: { scale: 'minor-third' /* 1.2 */ },
    })
    const loose = themeTokens({
      default: 'light',
      themes: { light: { '--color-bg': 'white' } },
      typography: { scale: 'perfect-fourth' /* 1.333 */ },
    })
    const tightH1 = tight.base.match(/\.text-h1\s*\{[^}]*font-size:\s*([\d.]+)rem;/)
    const looseH1 = loose.base.match(/\.text-h1\s*\{[^}]*font-size:\s*([\d.]+)rem;/)
    expect(tightH1).not.toBeNull()
    expect(looseH1).not.toBeNull()
    if (tightH1 && looseH1) {
      expect(parseFloat(looseH1[1] as string)).toBeGreaterThan(parseFloat(tightH1[1] as string))
    }
  })

  test('numeric scale ratio accepted directly', () => {
    const t = themeTokens({
      default: 'light',
      themes: { light: { '--color-bg': 'white' } },
      typography: { scale: 1.5, base: 16 },
    })
    // h1 at +4 with ratio 1.5: 16 * 1.5^4 / 16 = 5.0625rem
    expect(t.base).toMatch(/\.text-h1\s*\{[^}]*font-size:\s*5\.0625rem;/)
  })

  test('custom family/weight/leading/tracking override defaults', () => {
    const t = themeTokens({
      default: 'light',
      themes: { light: { '--color-bg': 'white' } },
      typography: {
        family: { display: '"Inter", sans-serif' },
        weight: { black: 900 },
        leading: { single: 1 },
        tracking: { negative: '-0.1em' },
      },
    })
    expect(t.base).toContain('--font-display: "Inter", sans-serif;')
    expect(t.base).toContain('--font-weight-black: 900;')
    expect(t.base).toContain('--leading-single: 1;')
    expect(t.base).toContain('--tracking-negative: -0.1em;')
    // Defaults NOT emitted when caller specifies their own:
    expect(t.base).not.toContain('--font-sans:')
  })

  test('custom roles override defaults; literal sizes accepted', () => {
    const t = themeTokens({
      default: 'light',
      themes: { light: { '--color-bg': 'white' } },
      typography: {
        scale: 1.25,
        base: 16,
        roles: {
          hero: { size: '4rem', weight: 'bold' },
          caption: { size: -2, leading: 'tight' },
        },
      },
    })
    // Literal size string passes through verbatim.
    expect(t.base).toMatch(/\.text-hero\s*\{[^}]*font-size:\s*4rem;/)
    // Numeric step uses scale: 16 * 1.25^-2 / 16 = 0.64rem
    expect(t.base).toMatch(/\.text-caption\s*\{[^}]*font-size:\s*0\.64rem;/)
    // Default roles NOT emitted when caller passes their own roles.
    expect(t.base).not.toContain('.text-h1 ')
  })

  test('roles use leading-scale key OR literal value', () => {
    const t = themeTokens({
      default: 'light',
      themes: { light: { '--color-bg': 'white' } },
      typography: {
        scale: 1.25,
        leading: { tight: 1.1 },
        roles: {
          big: { size: 0, leading: 'tight' }, // key from scale
          loose: { size: 0, leading: 1.9 }, // literal number
        },
      },
    })
    expect(t.base).toMatch(/\.text-big\s*\{[^}]*line-height:\s*1\.1;/)
    expect(t.base).toMatch(/\.text-loose\s*\{[^}]*line-height:\s*1\.9;/)
  })

  test('color + typography compose in one @theme block (atomic switch)', () => {
    const t = themeTokens({
      default: 'dark',
      themes: {
        dark: { '--color-bg': '#000', '--color-fg': '#fff' },
        light: { '--color-bg': '#fff', '--color-fg': '#000' },
      },
      typography: { scale: 1.25 },
    })
    // Both color tokens and font tokens land in the SAME @theme block.
    const themeBlock = t.base.match(/@theme\s*\{([\s\S]*?)\}/)
    expect(themeBlock).not.toBeNull()
    if (themeBlock) {
      const body = themeBlock[1] as string
      expect(body).toContain('--color-bg:')
      expect(body).toContain('--font-sans:')
      expect(body).toContain('--font-weight-bold:')
    }
  })
})

describe('themeTokens() — mode: light-dark (Tier 17-C / ADR 0049)', () => {
  test('emits light-dark() per token + :root color-scheme + per-class overrides', () => {
    const t = themeTokens({
      default: 'dark',
      mode: 'light-dark',
      themes: {
        light: { '--color-bg': 'white', '--color-fg': 'black' },
        dark: { '--color-bg': 'black', '--color-fg': 'white' },
      },
    })
    expect(t.base).toContain('--color-bg: light-dark(white, black);')
    expect(t.base).toContain('--color-fg: light-dark(black, white);')
    expect(t.base).toMatch(/:root\s*\{\s*color-scheme:\s*light dark;\s*\}/)
    expect(t.base).toMatch(/\.theme-light\s*\{\s*color-scheme:\s*light;\s*\}/)
    expect(t.base).toMatch(/\.theme-dark\s*\{\s*color-scheme:\s*dark;\s*\}/)
  })

  test('identical light + dark values collapse to a plain value (no light-dark wrapper)', () => {
    const t = themeTokens({
      default: 'dark',
      mode: 'light-dark',
      themes: {
        light: { '--color-bg': 'white', '--color-fg': 'black', '--color-brand': '#1234ab' },
        dark: { '--color-bg': 'black', '--color-fg': 'white', '--color-brand': '#1234ab' },
      },
    })
    // bg differs → light-dark()
    expect(t.base).toContain('--color-bg: light-dark(white, black);')
    // brand is the same → plain value, no wrapper
    expect(t.base).toContain('--color-brand: #1234ab;')
    expect(t.base).not.toContain('light-dark(#1234ab')
  })

  test('throws when mode: light-dark is used with the wrong theme set', () => {
    expect(() =>
      themeTokens({
        default: 'dark',
        mode: 'light-dark',
        themes: {
          dark: { '--color-bg': 'black' },
          midnight: { '--color-bg': '#000' },
        },
      }),
    ).toThrow(/requires exactly 2 themes named 'light' and 'dark'/)

    expect(() =>
      themeTokens({
        default: 'dark',
        mode: 'light-dark',
        themes: {
          dark: { '--color-bg': 'black' },
        },
      }),
    ).toThrow(/requires exactly 2 themes named 'light' and 'dark'/)
  })

  test('typography lands in the @theme block alongside the color tokens', () => {
    const t = themeTokens({
      default: 'dark',
      mode: 'light-dark',
      themes: {
        light: { '--color-bg': 'white', '--color-fg': 'black' },
        dark: { '--color-bg': 'black', '--color-fg': 'white' },
      },
      typography: { scale: 'major-third' },
    })
    expect(t.base).toContain('--color-bg: light-dark(')
    // Typography role classes still emit.
    expect(t.base).toMatch(/\.text-h1\s*\{/)
  })
})

describe('theme() — high-DX theme helper', () => {
  test('bare color keys auto-prefix with --color- in the @theme block', () => {
    const t = theme({
      modes: {
        dark: { bg: '#000', fg: '#fff', accent: '#ff5500' },
      },
    })
    // Anchor colors prefixed properly.
    expect(t.base).toMatch(/--color-bg:\s*#000;/)
    expect(t.base).toMatch(/--color-fg:\s*#fff;/)
    expect(t.base).toMatch(/--color-accent:\s*#ff5500;/)
  })

  test('sibling tokens auto-fill from defaults via color-mix()', () => {
    const t = theme({
      modes: {
        dark: { bg: '#000', fg: '#fff', accent: '#ff5500' },
      },
    })
    // Without explicit values, siblings get sensible defaults
    expect(t.base).toMatch(/--color-card:\s*color-mix\(/)
    expect(t.base).toMatch(/--color-border:\s*color-mix\(/)
    expect(t.base).toMatch(/--color-muted:\s*color-mix\(/)
    expect(t.base).toMatch(/--color-card-fg:\s*var\(--color-fg\)/)
    expect(t.base).toMatch(/--color-accent-fg:\s*var\(--color-bg\)/)
    expect(t.base).toMatch(/--color-destructive:\s*oklch/)
    expect(t.base).toMatch(/--color-destructive-fg:\s*oklch/)
  })

  test('user-provided sibling values override the auto-derived defaults', () => {
    const t = theme({
      modes: {
        dark: {
          bg: '#000',
          fg: '#fff',
          accent: '#f80',
          // Explicit override of an auto-derivable sibling
          border: '#444',
          'accent-fg': '#fff',
        },
      },
    })
    expect(t.base).toContain('--color-border: #444;')
    expect(t.base).toContain('--color-accent-fg: #fff;')
    // Other siblings still auto-derived
    expect(t.base).toMatch(/--color-card:\s*color-mix\(/)
  })

  test('two modes named light + dark auto-select light-dark() mode (Tier 17-C)', () => {
    const t = theme({
      modes: {
        dark: { bg: '#000', fg: '#fff', accent: '#f80' },
        light: { bg: '#fff', fg: '#000', accent: '#a40' },
      },
    })
    // The @theme block has ONE entry per token, with light-dark()
    // wrapping both values. No per-mode class needed to flip colors.
    expect(t.base).toMatch(/--color-bg:\s*light-dark\(\s*#fff\s*,\s*#000\s*\);/)
    expect(t.base).toMatch(/--color-fg:\s*light-dark\(\s*#000\s*,\s*#fff\s*\);/)
    expect(t.base).toMatch(/--color-accent:\s*light-dark\(\s*#a40\s*,\s*#f80\s*\);/)
    // `:root` declares `color-scheme: light dark` so the browser
    // honors either OS preference or a child override.
    expect(t.base).toMatch(/:root\s*\{\s*color-scheme:\s*light dark;\s*\}/)
    // Per-theme classes still exist — they JUST set `color-scheme`.
    // Existing `setTheme(tokens, 'dark')` call sites continue to
    // work via the class.
    expect(t.base).toMatch(/\.theme-light\s*\{\s*color-scheme:\s*light;\s*\}/)
    expect(t.base).toMatch(/\.theme-dark\s*\{\s*color-scheme:\s*dark;\s*\}/)
    // No per-mode --color-bg overrides in the class blocks — the
    // light-dark() function resolves which value applies.
    expect(t.base).not.toMatch(/\.theme-dark\s*\{[\s\S]*--color-bg/)
  })

  test('multi-mode (>2 or non-light/dark names) falls back to classes mode', () => {
    const t = theme({
      modes: {
        light: { bg: '#fff', fg: '#000', accent: '#a40' },
        dark: { bg: '#000', fg: '#fff', accent: '#f80' },
        sepia: { bg: '#f4ecd8', fg: '#3a2d18', accent: '#a3522e' },
      },
    })
    // Three modes → classic per-class output (light-dark() can't
    // express a third option).
    expect(t.base).toMatch(/\.theme-dark\s*\{[\s\S]*--color-bg:\s*#000;/)
    expect(t.base).toMatch(/\.theme-sepia\s*\{[\s\S]*--color-bg:\s*#f4ecd8;/)
    // No light-dark() function in the output.
    expect(t.base).not.toContain('light-dark(')
  })

  test('default mode defaults to the first listed mode', () => {
    const t = theme({
      modes: {
        first: { bg: '#aaa', fg: '#000', accent: '#0a0' },
        second: { bg: '#bbb', fg: '#000', accent: '#0a0' },
      },
    })
    expect(t.default).toBe('first')
  })

  test('explicit default mode wins', () => {
    const t = theme({
      modes: {
        dark: { bg: '#000', fg: '#fff', accent: '#f80' },
        light: { bg: '#fff', fg: '#000', accent: '#a40' },
      },
      default: 'light',
    })
    expect(t.default).toBe('light')
  })

  test('typography option flows through to themeTokens()', () => {
    const t = theme({
      modes: { dark: { bg: '#000', fg: '#fff', accent: '#f80' } },
      typography: { scale: 'major-third' },
    })
    expect(t.base).toMatch(/--font-sans:/)
    expect(t.base).toMatch(/\.text-h1\s*\{/)
  })

  test('extra custom color tokens pass through with --color- prefix', () => {
    const t = theme({
      modes: {
        dark: {
          bg: '#000',
          fg: '#fff',
          accent: '#f80',
          // Custom semantic role
          success: '#0a0',
          warning: '#fa0',
        },
      },
    })
    expect(t.base).toContain('--color-success: #0a0;')
    expect(t.base).toContain('--color-warning: #fa0;')
  })
})

// =============================================================
// 0.10.1 — themeEarlyScript stash assertion (node env is fine
// since we only inspect the emitted JS string, not DOM).
// =============================================================

describe('themeEarlyScript — writes window.__placeTheme stash (0.10.1)', () => {
  test('emitted script body includes a window.__placeTheme assignment with names/classes/cookieName', async () => {
    const { themeEarlyScript } = await import('../../src/theme.ts')
    const out = themeEarlyScript(
      {
        names: ['dark', 'light'] as const,
        htmlClass: (n: string) => `theme-${n}`,
      },
      'place-theme',
    )
    expect(out).toContain('window.__placeTheme=')
    expect(out).toMatch(/names:\["dark","light"\]/)
    expect(out).toMatch(/classes:\["theme-dark","theme-light"\]/)
    expect(out).toContain('cookieName:"place-theme"')
  })

  test('custom cookieName flows into the stash', async () => {
    const { themeEarlyScript } = await import('../../src/theme.ts')
    const out = themeEarlyScript(
      { names: ['a', 'b'] as const, htmlClass: (n: string) => `theme-${n}` },
      'app-theme',
    )
    expect(out).toContain('cookieName:"app-theme"')
  })
})
