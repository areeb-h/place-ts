// /recipes/theming — theme() + dark mode + custom themes.
// CSS-variable-based theming with cookie persistence + SSR.
//
// theme() is the canonical entry-point (bare bg/fg/accent keys,
// auto-derived siblings, auto light-dark() mode). themeTokens() is
// the low-level primitive — documented at the end for custom --*
// CSS variables that aren't colors.

import { Link, page } from '@place/component'
import { Callout } from '../../components/callout.tsx'
import { CodeBlock } from '@place/design'

const DEFINE_THEME = `// theme.ts — declare your color modes once. theme() is the
// canonical entry-point: bare color keys (no \`--color-\` prefix),
// tasteful sibling tokens auto-derived, and — for the common 2-mode
// case — automatic light-dark() emission so theme switching is a
// single CSS property, zero JS plumbing.

import { theme } from '@place/component'

export const tokens = theme({
  modes: {
    light: {
      bg:     'oklch(0.98 0.005 100)',
      fg:     'oklch(0.18 0.01 280)',
      accent: 'oklch(0.62 0.18 30)',
    },
    dark: {
      bg:     'oklch(0.13 0.01 280)',
      fg:     'oklch(0.95 0.005 100)',
      accent: 'oklch(0.78 0.16 30)',
    },
  },
  default: 'dark',
})

// theme() auto-fills the sibling tokens you didn't list — card,
// card-fg, border, muted, accent-fg, success, warn, destructive
// (+ -fg pairs) — via color-mix() over your anchors. Override any
// of them by listing the key explicitly in a mode. Each key emits
// \`--color-<key>\`, so Tailwind v4 generates bg-bg, text-fg,
// bg-accent, border-border, text-muted … utilities automatically.`

const TYPOGRAPHY = `// theme() (and themeTokens()) take an optional \`typography\` config.
// It emits a modular type scale, font families / weights, leading +
// tracking scales, and semantic role utility classes
// (.text-display, .text-h1 … .text-body, .text-meta).

export const tokens = theme({
  modes: { light: { /* … */ }, dark: { /* … */ } },
  default: 'dark',
  typography: {
    scale: 'major-third',    // named ratio (1.25) or a raw number
    base: 16,                // base font size in px
    // family / weight / leading / tracking / roles all overridable;
    // omitted ones fall back to tasteful system defaults.
  },
})

// Then in markup — role classes compose size + leading + tracking
// + weight + family; color is left to bg-*/text-* so they compose:
<h1 class="text-h1 text-fg">Title</h1>
<p class="text-body text-muted">Body copy.</p>`

const WIRE = `// app.ts — pass the tokens to app({ theme }). The framework wires:
//   - the @theme block into Tailwind (bg-accent, text-fg, … utilities)
//   - <html class="theme-…"> on SSR'd output (reads the theme cookie)
//   - the no-flash early script (see below) into every page <head>

import { app } from '@place/component'
import { tokens } from './theme.ts'

app({
  pages: [...],
  theme: tokens,
}).run()`

const EARLY_SCRIPT = `// You write nothing for no-flash theme persistence — when \`theme\`
// is passed to app(), the framework injects themeEarlyScript()
// into every page's <head> automatically. It runs BEFORE <body>
// parses: reads the theme cookie, applies the matching theme-*
// class (or none, for 'system'), mirrors the choice onto
// <html data-place-theme="…">. Works on a live server AND on a
// static export from app().build().

// Calling it by hand is only needed if you're not using app({theme}):
import { themeEarlyScript } from '@place/component'
import { tokens } from './theme.ts'

const earlyJs = themeEarlyScript(tokens)  // raw JS statement string`

const SWITCH = `// theme-toggle.tsx — flip the theme. setTheme(tokens, name)
// strips every theme-* class, adds the chosen one, mirrors it to
// <html data-place-theme>, and writes the cookie — all in one tick.
//
// Signature: setTheme(tokens, theme, options?)
//   - \`tokens\`: the theme()/themeTokens() result
//   - \`theme\`: a mode name OR the special string 'system'
//   - \`options?\`: { cookieName? }
//
// There is no \`activeTheme\` export — read the current choice off
// <html data-place-theme> (the early script + setTheme keep it
// current) or track your own state cell.

import { setTheme } from '@place/component'
import { tokens } from './theme.ts'

export const ThemeToggle = component(() => {
  const current = () =>
    document.documentElement.dataset['placeTheme'] ?? tokens.default
  return (
    <button
      aria-label="Toggle theme"
      onClick={() => setTheme(tokens, current() === 'dark' ? 'light' : 'dark')}
    >
      {() => (current() === 'dark' ? '☾' : '☀')}
    </button>
  )
})

// 'system' clears every theme class so the stylesheet's
// prefers-color-scheme bindings drive appearance from the OS:
<button onClick={() => setTheme(tokens, 'system')}>Match system</button>`

const USE_IN_COMPONENTS = `// Use semantic Tailwind classes — they're bound to the CSS
// variables the theme emits. Theme switching is invisible to
// components: the class on <html> changes, the variables resolve
// differently, every utility re-skins atomically.

<div class="bg-card border border-border text-fg">
  <h1 class="text-fg">Title</h1>
  <p class="text-muted">Subtitle</p>
  <button class="bg-accent text-accent-fg">Primary</button>
</div>

// Or read the typed tokens object for non-Tailwind code (canvas,
// motion interpolation between OKLCH values, server-side meta tags):
import { tokens } from './theme.ts'
console.log(tokens.themes.dark['--color-accent'])  // 'oklch(0.78 0.16 30)'`

const SUBTREE_OVERRIDE = `// Per-subtree theme override — drop the theme class on any element.
// CSS custom properties cascade to descendants; bg-*/text-*
// utilities read from whichever theme block is closest. Lets you
// nest a dark callout inside a light page (or vice versa).

<section class={tokens.htmlClass('dark')}>
  <h2 class="text-fg">Always dark</h2>
  <p class="text-muted bg-card">Even if the page is in light mode.</p>
</section>`

const PRIMITIVE = `// themeTokens() — the low-level primitive theme() wraps. Reach for
// it directly only when you need to set arbitrary --* CSS variables
// that AREN'T colors (custom --shadow-*, --radius-*), or when
// authoring your own theme()-shaped helper.
//
// You write the full --color-* token keys; every theme must declare
// the SAME key set (a missing key is a type error at the call site).

import { themeTokens } from '@place/component'

export const tokens = themeTokens({
  themes: {
    light: {
      '--color-bg':     'oklch(0.98 0.005 100)',
      '--color-fg':     'oklch(0.18 0.01 280)',
      '--color-accent': 'oklch(0.62 0.18 30)',
      '--radius-card':  '0.75rem',
    },
    dark: {
      '--color-bg':     'oklch(0.13 0.01 280)',
      '--color-fg':     'oklch(0.95 0.005 100)',
      '--color-accent': 'oklch(0.78 0.16 30)',
      '--radius-card':  '0.75rem',
    },
  },
  default: 'dark',
  typography: { scale: 'major-third' },   // same config as theme()
})`

const CUSTOM = `// More than two modes, or modes not named light/dark? theme()
// stays in classic 'classes' mode (one .theme-<name> class per
// mode, swapped via the cookie). Add as many as you want.

theme({
  modes: {
    light:           { bg: '…', fg: '…', accent: '…' },
    dark:            { bg: '…', fg: '…', accent: '…' },
    sepia:           { bg: 'oklch(0.93 0.04 80)', fg: 'oklch(0.20 0.04 60)', accent: '…' },
    'high-contrast': { bg: '#000', fg: '#fff', accent: '#ff0' },
  },
  default: 'dark',
})`

export default page('/theming', {
  // No `meta:` — auto-title from `<h1>Theming & dark mode</h1>`.
  view: () => (
    <article class="prose max-w-3xl">
      <h1>Theming &amp; dark mode</h1>
      <p>
        place ships a typed theming primitive. <code>theme()</code> is the canonical
        entry-point — bare color keys, auto-derived sibling tokens, and (for the common 2-mode
        case) automatic <code>light-dark()</code> emission. It produces a Tailwind v4{' '}
        <code>@theme</code> block, per-theme CSS-variable classes, and a typed JS object exposing
        the raw values. <code>themeTokens()</code> is the low-level primitive underneath — reach
        for it only when you need non-color <code>--*</code> variables.
      </p>

      <h2>1. Declare your theme</h2>
      <CodeBlock code={DEFINE_THEME} />

      <Callout kind="tip" title="Why oklch?">
        Themes that use perceptual color (oklch / oklab) interpolate cleanly across hue and
        lightness. <code>theme()</code> derives siblings via <code>color-mix(in oklab, …)</code>{' '}
        — staying in gamut and looking correct in light + dark from the same anchor values.
      </Callout>

      <Callout kind="note" title="Auto light-dark() mode">
        When you pass exactly two modes named <code>light</code> and <code>dark</code>,{' '}
        <code>theme()</code> auto-selects <code>light-dark()</code> output: one{' '}
        <code>--token: light-dark(lightVal, darkVal)</code> per token plus{' '}
        <code>color-scheme: light dark</code> on <code>:root</code>. Theme switching becomes a
        single CSS property — no <code>.theme-X</code> class proliferation, no JS theme-provider.
        More modes, or modes not named <code>light</code>/<code>dark</code>, fall back to the
        classic class-based mode.
      </Callout>

      <h2>2. Typography</h2>
      <p>
        <code>theme()</code> and <code>themeTokens()</code> take an optional{' '}
        <code>typography</code> config — a modular type scale, font families / weights, leading
        and tracking scales, plus semantic role utility classes (<code>.text-display</code>,{' '}
        <code>.text-h1</code> … <code>.text-body</code>, <code>.text-meta</code>) emitted into the
        same stylesheet as the color tokens.
      </p>
      <CodeBlock code={TYPOGRAPHY} />

      <h2>
        3. Wire into <code>app()</code>
      </h2>
      <CodeBlock code={WIRE} />

      <h2>4. No-flash persistence is automatic</h2>
      <p>
        When <code>theme</code> is passed to <code>app()</code>, the framework injects{' '}
        <code>themeEarlyScript()</code> into every page's <code>&lt;head&gt;</code>{' '}
        automatically — apps get no-flash theme persistence for free. It runs before{' '}
        <code>&lt;body&gt;</code> parses, reads the theme cookie, and applies the matching class.
        Works on a live server <em>and</em> on a static export from <code>app().build()</code>,
        where there's no per-request cookie read at SSR time.
      </p>
      <CodeBlock code={EARLY_SCRIPT} />

      <h2>5. Switch themes</h2>
      <p>
        <code>setTheme(tokens, theme, options?)</code> flips the active theme: it strips every{' '}
        <code>theme-*</code> class, adds the chosen one, mirrors the choice onto{' '}
        <code>&lt;html data-place-theme&gt;</code>, and writes the cookie. The <code>theme</code>{' '}
        argument accepts a mode name or the special string <code>'system'</code> (which clears
        every class so the OS preference drives appearance). There is no <code>activeTheme</code>{' '}
        export — read the current choice off <code>&lt;html data-place-theme&gt;</code>.
      </p>
      <CodeBlock code={SWITCH} />

      <h2>6. Use in components</h2>
      <CodeBlock code={USE_IN_COMPONENTS} />

      <h2>Per-subtree override</h2>
      <p>
        CSS custom properties cascade. To force a region into a different theme — a dark callout
        inside a light page, a light preview inside a dark editor — drop the theme class on any
        element. Descendants inherit the new variables; semantic utilities (<code>bg-bg</code>,{' '}
        <code>text-fg</code>) read from the closest theme block automatically.
      </p>
      <CodeBlock code={SUBTREE_OVERRIDE} />

      <h2>
        The low-level primitive: <code>themeTokens()</code>
      </h2>
      <p>
        <code>theme()</code> wraps <code>themeTokens()</code>. Reach for the primitive directly
        only when you need to emit arbitrary <code>--*</code> CSS variables that aren't colors
        (custom <code>--shadow-*</code>, <code>--radius-*</code>) or when you're authoring your own{' '}
        <code>theme()</code>-shaped helper. It has the same return shape, so it drops into{' '}
        <code>app({ '{ theme }' })</code> unchanged.
      </p>
      <CodeBlock code={PRIMITIVE} />

      <h2>Custom themes</h2>
      <CodeBlock code={CUSTOM} />

      <h2>What you DON'T do</h2>
      <ul>
        <li>
          No <code>ThemeProvider</code>. The theme isn't a context; it's a class on{' '}
          <code>&lt;html&gt;</code> plus a cookie.
        </li>
        <li>
          No JS theme prop on every component. Components use semantic Tailwind classes
          (<code>bg-accent</code>); the variables behind them are theme-dependent.
        </li>
        <li>
          No CSS-in-JS runtime. Tokens compile to CSS variables at build; theme switching is a
          class swap (or, in <code>light-dark()</code> mode, a single CSS property).
        </li>
        <li>
          No hand-written pre-paint script. <code>themeEarlyScript()</code> is injected for you
          when <code>theme</code> is passed to <code>app()</code>.
        </li>
      </ul>

      <h2>Related</h2>
      <ul>
        <li>
          <Link to="/api/design">
            <code>@place/design</code> — components use the theme tokens automatically
          </Link>
        </li>
        <li>
          <Link to="/concepts/ssr">SSR + hydration — how theme cookies survive first paint</Link>
        </li>
      </ul>
    </article>
  ),
})
