// /recipes/theming — themeTokens() + dark mode + custom themes.
// CSS-variable-based theming with cookie persistence + SSR.

import { Link, page } from '@place/component'
import { Callout } from '../../components/callout.tsx'
import { CodeBlock } from '@place/design'

const DEFINE_TOKENS = `// theme.ts — declare your tokens once, get a typed object + a
// Tailwind v4 @theme block + per-theme classes + a CSS-variable
// emission that respects prefers-color-scheme.
//
// Token keys MUST start with \`--\` (CSS custom-property convention).
// Names like \`--color-accent\` follow Tailwind v4's @theme protocol so
// utilities (\`bg-accent\`, \`text-accent\`) generate automatically.

import { themeTokens } from '@place/component'

export const tokens = themeTokens({
  themes: {
    light: {
      '--color-bg':              'oklch(0.98 0.005 100)',
      '--color-fg':              'oklch(0.18 0.01 280)',
      '--color-card':            'oklch(0.96 0.008 100)',
      '--color-border':          'oklch(0.88 0.008 100)',
      '--color-accent':          'oklch(0.62 0.18 30)',
      '--color-accent-fg':       'oklch(0.98 0.005 100)',
      '--color-muted':           'oklch(0.55 0.02 280)',
      '--color-destructive':     'oklch(0.55 0.20 25)',
      '--color-destructive-fg':  'oklch(0.98 0.005 100)',
    },
    dark: {
      '--color-bg':              'oklch(0.13 0.01 280)',
      '--color-fg':              'oklch(0.95 0.005 100)',
      '--color-card':            'oklch(0.18 0.012 280)',
      '--color-border':          'oklch(0.28 0.012 280)',
      '--color-accent':          'oklch(0.78 0.16 30)',
      '--color-accent-fg':       'oklch(0.13 0.01 280)',
      '--color-muted':           'oklch(0.58 0.015 280)',
      '--color-destructive':     'oklch(0.68 0.20 25)',
      '--color-destructive-fg':  'oklch(0.13 0.01 280)',
    },
  },
  default: 'dark',
})`

const SUBTREE_OVERRIDE = `// Per-subtree theme override — drop the theme class on any element.
// CSS custom properties cascade to descendants; \`bg-bg\`/\`text-fg\`
// utilities read from whichever theme block is closest. Lets you nest
// a dark callout inside a light page (or vice versa) with no extra API.

<section class={tokens.htmlClass('dark')}>
  <h2 class="text-fg">Always dark</h2>
  <p class="text-muted bg-card">Even if the page is in light mode.</p>
</section>`

const RECIPES_PATTERN = `// design-system.ts — define your visual recipes ONCE, use everywhere.
// \`recipe()\` returns a function that takes variants and produces a
// class string. Replaces the wall-of-Tailwind on every call site.

import { recipe } from '@place/component'

export const button = recipe({
  base: 'inline-flex items-center gap-2 rounded-md font-medium transition-colors',
  variants: {
    intent: {
      primary:   'bg-accent text-accent-fg hover:opacity-90',
      secondary: 'bg-card border border-border text-fg hover:border-accent',
      ghost:     'text-muted hover:text-fg',
    },
    size: {
      sm: 'px-2.5 py-1 text-xs',
      md: 'px-4 py-2 text-sm',
      lg: 'px-5 py-2.5 text-sm',
    },
  },
  defaults: { intent: 'primary', size: 'md' },
})

// Call site:
<button class={button({ intent: 'secondary', size: 'sm' })}>Save draft</button>`

const WIRE = `// app.ts — pass tokens to app(). Framework wires:
//   - @theme block into Tailwind (semantic class names: bg-accent etc.)
//   - <html class="theme-…"> on SSR'd output (reads cookie, defaults to default)
//   - <meta name="color-scheme"> hint
//   - prefers-color-scheme media query for SSR-time best guess

import { app } from '@place/component'
import { tokens } from './theme.ts'

app({
  pages: [...],
  theme: tokens,
  router: pathRouter,
}).run()`

const SWITCH = `// theme-toggle.tsx — flip the active theme. The framework's theme
// signal is a module-scoped state; flipping it writes a cookie AND
// updates <html class="…"> immediately.

import { state } from '@place/reactivity'
import { activeTheme, setTheme } from '@place/component'

export const ThemeToggle = component(() => (
  <button
    aria-label="Toggle theme"
    onClick={() => setTheme(activeTheme() === 'dark' ? 'light' : 'dark')}
  >
    {() => activeTheme() === 'dark' ? '☾' : '☀'}
  </button>
))

// SSR: reads the theme cookie; cookie persists across requests.
// Client: changing the theme writes the cookie + updates DOM in one tick.`

const USE_IN_COMPONENTS = `// Use semantic Tailwind classes — they're bound to the CSS variables
// emitted by the theme. Theme switching is invisible to components.

<div class="bg-card border border-border text-fg">
  <h1 class="text-fg">Title</h1>
  <p class="text-muted">Subtitle</p>
  <button class="bg-accent text-accent-fg">Primary</button>
</div>

// Or read the typed tokens object for non-Tailwind code:
import { tokens } from './theme.ts'
console.log(tokens.themes.dark['--color-accent'])  // 'oklch(0.78 0.16 30)'`

const CUSTOM = `// Add as many named themes as you want. Each becomes a
// .theme-<name> class the framework swaps via cookie.

themeTokens({
  themes: {
    light: { /* … */ },
    dark:  { /* … */ },
    sepia: {
      '--color-bg': 'oklch(0.93 0.04 80)',
      '--color-fg': 'oklch(0.20 0.04 60)',
      // …
    },
    'high-contrast': {
      '--color-bg': '#000',
      '--color-fg': '#fff',
      // …
    },
  },
  default: 'dark',
})`

export default page('/theming', {
  // No `meta:` — auto-title from `<h1>Theming & dark mode</h1>`.
  view: () => (
    <article class="prose max-w-3xl">
      <h1>Theming &amp; dark mode</h1>
      <p>
        place ships a typed theming primitive — <code>themeTokens()</code> — that produces a
        Tailwind v4 <code>@theme</code> block, per-theme CSS-variable classes, and a typed JS
        object exposing the raw values. Theme switching is one cookie write + one class on{' '}
        <code>&lt;html&gt;</code>; nothing JS-y propagates through the tree.
      </p>

      <h2>1. Declare tokens</h2>
      <CodeBlock code={DEFINE_TOKENS} />

      <Callout kind="tip" title="Why oklch?">
        Themes that use perceptual color (oklch / oklab) interpolate cleanly across hue and
        lightness. Mixing accent tints (<code>color-mix(in oklab, …)</code>) stays in gamut and
        looks correct in light + dark themes from the same source values.
      </Callout>

      <h2>2. Wire into <code>app()</code></h2>
      <CodeBlock code={WIRE} />
      <p>
        The <code>theme</code> option drives:
      </p>
      <ul>
        <li>Tailwind's <code>@theme</code> block (so <code>bg-accent</code> etc. work)</li>
        <li>
          A <code>{`<html class="theme-…">`}</code> class on the SSR'd document, read from a cookie
        </li>
        <li>
          A <code>{`<meta name="color-scheme">`}</code> hint for the browser
        </li>
        <li>
          A <code>prefers-color-scheme</code> media-query fallback for first-time visitors
        </li>
      </ul>

      <h2>3. Switch themes</h2>
      <CodeBlock code={SWITCH} />

      <h2>4. Use in components</h2>
      <CodeBlock code={USE_IN_COMPONENTS} />

      <h2>Per-subtree override</h2>
      <p>
        CSS custom properties cascade. To force a region into a different theme — a dark callout
        inside a light page, a light preview inside a dark editor — drop the theme class on any
        element. Descendants inherit the new variables; semantic utilities (<code>bg-bg</code>,{' '}
        <code>text-fg</code>) read from the closest theme block automatically.
      </p>
      <CodeBlock code={SUBTREE_OVERRIDE} />

      <h2>Streamline with recipes</h2>
      <p>
        Wall-of-Tailwind class strings are easy to write but hard to maintain. Use{' '}
        <code>recipe()</code> to define your visual vocabulary once and reference it by intent.
        The recipe still uses Tailwind utilities under the hood — you get the full classes plus a
        typed function for the call site.
      </p>
      <CodeBlock code={RECIPES_PATTERN} />

      <h2>Custom themes</h2>
      <CodeBlock code={CUSTOM} />

      <h2>What you DON'T do</h2>
      <ul>
        <li>
          No <code>ThemeProvider</code>. The theme isn't a context; it's a single state +{' '}
          <code>&lt;html&gt;</code> class.
        </li>
        <li>
          No JS theme prop on every component. Components use semantic Tailwind classes
          (<code>bg-accent</code>); the variables behind them are theme-dependent.
        </li>
        <li>
          No CSS-in-JS runtime. Tokens compile to CSS variables at build; theme switching is a
          class swap.
        </li>
        <li>
          No <code>@media (prefers-color-scheme)</code> in your own CSS. The framework already
          handles the SSR-time first-paint guess via the cookie + media query.
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
