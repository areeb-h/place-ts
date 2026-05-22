// @place-ts/component theme tokens.
//
// A typed, server-side-renderable theming primitive. Inspired by
// shadcn/ui's CSS-variables-as-theme pattern, but improved on three
// axes:
//
//   1. **Typed** — themes is a typed object literal, so the call site
//      knows which theme names exist. shadcn ships a `globals.css` file
//      with no compile-time guarantee that theme classes match the
//      tokens they reference.
//
//   2. **Server-rendered** — the chosen theme rides on the layout/page
//      `htmlClass` field so it ships in the SSR'd HTML. No flash-of-
//      wrong-theme on first paint, no inline pre-paint script (which
//      fights strict CSP). shadcn requires either a blocking
//      `dangerouslySetInnerHTML` script or a flash.
//
//   3. **System preference + user override, both work without JS** —
//      the emitted CSS includes `@media (prefers-color-scheme: …)`
//      bindings (so a fresh visit picks system theme without JS) AND
//      class-based overrides (so an explicit user choice persists).
//      No client-side bootstrap required.
//
// Output shape: a single CSS string for `serve()`'s `tailwind.base`,
// containing:
//
//   - `@import "tailwindcss";` — included so callers don't have to
//     prepend it (they almost always want it).
//   - `@theme { … }` — registers the default theme's tokens with the
//     Tailwind v4 token system, so utilities like `bg-bg` and
//     `text-fg` work out of the box.
//   - `.theme-X { … }` — per-non-default-theme overrides.
//   - `@media (prefers-color-scheme: dark) { :root:not(.theme-X) { … } }`
//     — optional system-preference bindings; explicit class wins.
//
// The minimal usage:
//
//   const tokens = themeTokens({
//     default: 'light',
//     themes: {
//       light: { '--color-bg': 'white', '--color-fg': 'black' },
//       dark:  { '--color-bg': 'black', '--color-fg': 'white' },
//     },
//   })
//
//   serve({ tailwind: { base: tokens.base, content: [...] }, ... })
//   page({ htmlClass: tokens.htmlClass('dark'), bodyClass: 'bg-bg text-fg', view: () => ... })

/**
 * Per-theme tokens. Keys are CSS custom property names (must start with
 * `--`); values are CSS expressions (`oklch(...)`, `#fff`, `1rem`, etc).
 *
 * Different themes must declare the SAME set of token keys — otherwise
 * switching themes leaves stale values from the previous one. Enforced
 * at the type level: TypeScript widens the per-theme records so a
 * missing key in one theme produces a `'--foo' is missing` error at
 * the `themeTokens` call site.
 */
export type ThemeMap = Readonly<Record<string, string>>

export interface ThemeTokensOptions<Themes extends Readonly<Record<string, ThemeMap>>> {
  /**
   * Map of theme name → token map. Token keys must start with `--` (CSS
   * custom property convention). Theme names must be a valid CSS class
   * fragment — they get prefixed with `classPrefix` and emitted as
   * class selectors.
   */
  themes: Themes
  /**
   * Theme applied to `:root` (no parent class needed). Typically your
   * "default" appearance — visitors with no preference see this.
   */
  default: keyof Themes
  /**
   * Bind themes to the OS-level `prefers-color-scheme` media query so
   * the page picks the right theme on a fresh visit without any JS.
   *
   *   systemPreference: { dark: 'dark', light: 'light' }
   *
   * Class-based overrides (e.g. `.theme-light` on `<html>`) take
   * precedence — the emitted media query targets `:root:not(.theme-X)`
   * for each theme used in the override list. Set `false` to disable.
   * Default: a sensible auto-binding when 'light' / 'dark' theme names
   * exist; otherwise no media query.
   */
  systemPreference?: { dark?: keyof Themes; light?: keyof Themes } | false
  /** Class name prefix. Default: 'theme-'. */
  classPrefix?: string
  /**
   * Output strategy (Tier 17-C, ADR 0049). Default: `'classes'`.
   *
   * - `'classes'` — emit one `--token: <val>;` block per theme,
   *   guarded by `.theme-<name>` selectors + `prefers-color-scheme`
   *   media bindings. Switching themes = toggle a class on `<html>`.
   *   Required when there are more than 2 themes (e.g. sepia,
   *   high-contrast) or when the 2 themes aren't named `light` +
   *   `dark`.
   *
   * - `'light-dark'` — emit ONE `--token: light-dark(<lightVal>,
   *   <darkVal>);` per token + `color-scheme: light dark` on `:root`.
   *   Theme switching = set `color-scheme: light` or `dark` on
   *   `<html>` (or on any ancestor of the elements to re-skin).
   *   Browser resolves which value applies; ZERO JS theme-provider
   *   plumbing; no `.dark`-class proliferation. Falls back
   *   automatically to OS preference when no override is set.
   *
   *   Requires exactly 2 themes named `'light'` and `'dark'`.
   *   `theme()` auto-selects this mode for the common 2-mode case.
   */
  mode?: 'classes' | 'light-dark'
  /**
   * Typography config. When provided, `themeTokens()` emits a modular
   * type scale, font families, weights, leading + tracking scales, and
   * semantic role utility classes (`.text-display`, `.text-h1`,
   * `.text-body`, `.text-meta`, etc.) into the `base` output alongside
   * the color tokens.
   *
   *   themeTokens({
   *     default: 'dark',
   *     themes: { dark: {...}, light: {...} },
   *     typography: { scale: 'major-third', base: 16 },
   *   })
   *
   * Omit for color-only theming (back-compat default).
   */
  typography?: TypographyOptions
}

/**
 * Named modular-scale ratios. `major-third` (1.25) is the default —
 * tight enough for dense docs, loose enough for clear hierarchy.
 * Pass a raw number for full control.
 */
export type TypographyScaleRatio =
  | number
  | 'minor-second' // 1.067
  | 'major-second' // 1.125
  | 'minor-third' // 1.2
  | 'major-third' // 1.25
  | 'perfect-fourth' // 1.333
  | 'augmented-fourth' // 1.414
  | 'perfect-fifth' // 1.5
  | 'golden' // 1.618

const SCALE_RATIOS: Readonly<Record<Exclude<TypographyScaleRatio, number>, number>> = {
  'minor-second': 1.067,
  'major-second': 1.125,
  'minor-third': 1.2,
  'major-third': 1.25,
  'perfect-fourth': 1.333,
  'augmented-fourth': Math.SQRT2,
  'perfect-fifth': 1.5,
  golden: 1.618,
}

/**
 * One semantic typography role. Each field is independently optional;
 * unset fields fall back to the role's default position on the scale
 * (or the `body` baseline if no default exists).
 *
 * `size`: either a step on the modular scale (signed integer like
 * `'+3'` / `'-1'`, or `0` for base) or a literal CSS length string.
 * `leading` / `tracking` / `weight`: a key from the corresponding
 * scale on `TypographyOptions`, or a literal value.
 * `family`: a key from `TypographyOptions.family`.
 */
export interface TypographyRole {
  size: string | number
  leading?: string | number
  tracking?: string
  weight?: string | number
  family?: string
}

export interface TypographyOptions {
  /** Base font size in px. Default 16. */
  base?: number
  /** Modular scale ratio (one of named scales or a number). Default
   *  `'major-third'` (1.25). */
  scale?: TypographyScaleRatio
  /** Font families. Each key emits `--font-<key>`; Tailwind v4
   *  generates corresponding `font-<key>` utilities. Defaults: sans,
   *  mono (system stacks). */
  family?: Readonly<Record<string, string>>
  /** Font weights. Each key emits `--font-weight-<key>`. Defaults:
   *  regular, medium, semibold, bold. */
  weight?: Readonly<Record<string, number>>
  /** Line-height scale. Each key emits `--leading-<key>`. Defaults:
   *  tight, snug, normal, relaxed, loose. */
  leading?: Readonly<Record<string, number | string>>
  /** Letter-spacing scale. Each key emits `--tracking-<key>`.
   *  Defaults: tight, normal, wide. */
  tracking?: Readonly<Record<string, string>>
  /** Named semantic roles. Each emits a `.text-<role>` utility class
   *  composing the role's resolved values. Defaults: display, h1, h2,
   *  h3, h4, body, meta, mono. Pass an empty object to skip role
   *  utilities while still emitting the size/leading/etc. scales. */
  roles?: Readonly<Record<string, TypographyRole>>
}

// ===== Typography defaults =====
//
// Match Tailwind v4's reasonable defaults where they exist; pick
// tasteful sans/mono stacks otherwise. All overridable.

const DEFAULT_FAMILY: Readonly<Record<string, string>> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, "JetBrains Mono", Consolas, "Liberation Mono", monospace',
}
const DEFAULT_WEIGHT: Readonly<Record<string, number>> = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
}
const DEFAULT_LEADING: Readonly<Record<string, number | string>> = {
  tight: 1.2,
  snug: 1.4,
  normal: 1.55,
  relaxed: 1.7,
  loose: 2,
}
const DEFAULT_TRACKING: Readonly<Record<string, string>> = {
  tight: '-0.02em',
  normal: '0',
  wide: '0.05em',
}
const DEFAULT_ROLES: Readonly<Record<string, TypographyRole>> = {
  display: { size: '+5', leading: 'tight', tracking: 'tight', weight: 'bold' },
  h1: { size: '+4', leading: 'tight', tracking: 'tight', weight: 'semibold' },
  h2: { size: '+3', leading: 'snug', weight: 'semibold' },
  h3: { size: '+2', leading: 'snug', weight: 'semibold' },
  h4: { size: '+1', leading: 'snug', weight: 'medium' },
  body: { size: 0, leading: 'normal' },
  meta: { size: '-1', leading: 'normal', tracking: 'wide', weight: 'medium' },
  mono: { size: '-1', leading: 'snug', family: 'mono' },
}

/**
 * Compute a modular-scale size at `step` from `base` (px), in `rem`.
 * Step `0` = base; positive steps multiply by ratio^step; negative
 * steps divide. Returns a `rem` string for stable scaling under user
 * font-size overrides.
 */
function modularSize(base: number, ratio: number, step: number): string {
  const px = base * ratio ** step
  // px → rem; round to 4 decimals for output stability.
  const rem = Math.round((px / 16) * 10000) / 10000
  return `${rem}rem`
}

/**
 * Parse a `size:` field on a role. Either a literal string (use as-is)
 * or a signed step like `'+3'` / `'-1'` / numeric `0` (compute via the
 * modular scale).
 */
function resolveRoleSize(rawSize: string | number, base: number, ratio: number): string {
  if (typeof rawSize === 'number') return modularSize(base, ratio, rawSize)
  // String form: try step parse first (e.g. '+3', '-1', '0'); fall
  // back to using the string verbatim (e.g. '1.125rem', '18px').
  const stepMatch = /^[+-]?\d+$/.exec(rawSize)
  if (stepMatch) return modularSize(base, ratio, Number(rawSize))
  return rawSize
}

/**
 * Resolve a `leading` reference on a role: either a key into the
 * leading scale or a literal numeric/string value.
 */
function resolveRoleLeading(
  raw: string | number,
  leading: Readonly<Record<string, number | string>>,
): string {
  if (typeof raw === 'number') return String(raw)
  const fromScale = leading[raw]
  if (fromScale !== undefined) return String(fromScale)
  return raw
}

function resolveRoleTracking(raw: string, tracking: Readonly<Record<string, string>>): string {
  return tracking[raw] ?? raw
}

function resolveRoleWeight(raw: string | number, weight: Readonly<Record<string, number>>): string {
  if (typeof raw === 'number') return String(raw)
  const fromScale = weight[raw]
  return fromScale !== undefined ? String(fromScale) : raw
}

function resolveRoleFamily(raw: string, family: Readonly<Record<string, string>>): string {
  return family[raw] ?? raw
}

/**
 * Build the CSS sections for a typography config. Emits into the same
 * `base` output as the color tokens.
 *
 *   - `@theme` adds `--font-<key>`, `--font-weight-<key>`,
 *     `--leading-<key>`, `--tracking-<key>` tokens (recognized by
 *     Tailwind v4; generates `font-<key>` etc. utilities).
 *   - Role utility classes (`.text-<role>`) emit standalone CSS rules
 *     with the resolved font-size + line-height + letter-spacing +
 *     font-weight + font-family declarations.
 */
function buildTypographySections(opts: TypographyOptions): {
  themeAdditions: string[]
  roleClasses: string[]
} {
  const base = opts.base ?? 16
  const ratio =
    typeof opts.scale === 'number' ? opts.scale : SCALE_RATIOS[opts.scale ?? 'major-third']
  const family = opts.family ?? DEFAULT_FAMILY
  const weight = opts.weight ?? DEFAULT_WEIGHT
  const leading = opts.leading ?? DEFAULT_LEADING
  const tracking = opts.tracking ?? DEFAULT_TRACKING
  const roles = opts.roles ?? DEFAULT_ROLES

  const themeAdditions: string[] = []
  for (const [k, v] of Object.entries(family)) {
    themeAdditions.push(`--font-${k}: ${v};`)
  }
  for (const [k, v] of Object.entries(weight)) {
    themeAdditions.push(`--font-weight-${k}: ${v};`)
  }
  for (const [k, v] of Object.entries(leading)) {
    themeAdditions.push(`--leading-${k}: ${v};`)
  }
  for (const [k, v] of Object.entries(tracking)) {
    themeAdditions.push(`--tracking-${k}: ${v};`)
  }

  const roleClasses: string[] = []
  for (const [name, role] of Object.entries(roles)) {
    const declarations: string[] = []
    declarations.push(`font-size: ${resolveRoleSize(role.size, base, ratio)};`)
    if (role.leading !== undefined) {
      declarations.push(`line-height: ${resolveRoleLeading(role.leading, leading)};`)
    }
    if (role.tracking !== undefined) {
      declarations.push(`letter-spacing: ${resolveRoleTracking(role.tracking, tracking)};`)
    }
    if (role.weight !== undefined) {
      declarations.push(`font-weight: ${resolveRoleWeight(role.weight, weight)};`)
    }
    if (role.family !== undefined) {
      declarations.push(`font-family: ${resolveRoleFamily(role.family, family)};`)
    }
    roleClasses.push(`.text-${name} {\n${indent(declarations)}\n}`)
  }
  return { themeAdditions, roleClasses }
}

export interface ThemeTokens<Themes extends Readonly<Record<string, ThemeMap>>> {
  /**
   * CSS source to drop into `serve()`'s `tailwind.base`. Includes
   * `@import "tailwindcss";`, the `@theme` block (Tailwind v4 token
   * registration), per-theme override classes, and the optional
   * `prefers-color-scheme` media bindings.
   */
  base: string
  /** Resolve a theme name to the class name to put on `<html>`. */
  htmlClass: (theme: keyof Themes) => string
  /** All theme names, in declaration order. Useful for toggle UIs. */
  names: ReadonlyArray<keyof Themes>
  /** The default theme. */
  default: keyof Themes
  /**
   * Typed raw token map, keyed by theme name. Same shape the caller
   * passed in. Useful for programmatic access to token VALUES (motion
   * primitives interpolating between OKLCH colors, canvas renderers
   * needing the literal value, server-side meta tags). For DOM
   * styling, prefer the Tailwind utility classes the `@theme` block
   * generates (`bg-accent`, `text-muted`) — those go through CSS
   * variables so theme switching just changes a class on `<html>`.
   *
   *   tokens.themes.dark['--color-accent']  // 'oklch(0.78 0.16 65)'
   *   tokens.themes.light['--color-accent'] // 'oklch(0.62 0.16 65)'
   */
  themes: Themes
}

/**
 * Tailwind v4's `@theme` directive doesn't accept all CSS properties —
 * arbitrary `--foo` declarations are fine, but only the ones it
 * recognizes (e.g. `--color-*`, `--font-*`, `--spacing`, `--radius-*`)
 * become utility tokens. Token names that don't follow the convention
 * still work as plain CSS variables but won't generate utilities. We
 * accept any `--*` name and let Tailwind decide.
 */
function isTokenName(s: string): boolean {
  return s.startsWith('--')
}

function indent(lines: string[], by = '  '): string {
  return lines.map((l) => `${by}${l}`).join('\n')
}

function tokensToLines(tokens: ThemeMap, themeName?: string): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(tokens)) {
    if (!isTokenName(k)) {
      // Include the theme name so users with multi-theme configs don't
      // have to diff each token map to find the culprit.
      const where = themeName ? ` (in theme '${themeName}')` : ''
      throw new Error(
        `themeTokens: token name '${k}'${where} must start with '--' (CSS custom property convention)`,
      )
    }
    // Trim and end with semicolon — single source for emitted lines so
    // the output is always parseable.
    out.push(`${k}: ${String(v).trim()};`)
  }
  return out
}

const CLASS_NAME_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/

function classNameFor(prefix: string, theme: string): string {
  if (!CLASS_NAME_RE.test(theme)) {
    throw new Error(
      `themeTokens: theme name '${theme}' is not a valid CSS class fragment ` +
        `(allowed: letters, digits, _, -, must not start with a digit)`,
    )
  }
  return `${prefix}${theme}`
}

/**
 * **Low-level primitive.** For most apps reach for `theme()` (below)
 * instead — it has bare color keys, auto-derived sibling tokens via
 * `color-mix()`, and the same return shape. `themeTokens()` is the
 * underlying constructor; use it directly only when you need to set
 * arbitrary `--*` CSS variables that aren't colors (custom
 * `--shadow-*`, `--radius-*`, etc.), or when you're authoring a
 * `theme()`-shaped helper of your own.
 *
 * Build a typed, SSR-safe theme system from a token map. Returns
 * `{ base, htmlClass, names, default, themes }`. Drop `base` into
 * `serve({ tailwind: { base } })` (or pass directly via
 * `app({ theme })`); pass `htmlClass(theme)` to a layout/page's
 * top-level `htmlClass` field to pick a theme per request (e.g. from
 * a cookie).
 *
 * @see {@link theme} — the high-DX wrapper.
 */
export function themeTokens<Themes extends Readonly<Record<string, ThemeMap>>>(
  opts: ThemeTokensOptions<Themes>,
): ThemeTokens<Themes> {
  const themes = opts.themes
  const themeNames = Object.keys(themes) as Array<keyof Themes & string>
  if (themeNames.length === 0) {
    throw new Error('themeTokens: at least one theme is required')
  }
  // Validate every theme name as a CSS class fragment up front. Even
  // the default theme — which never gets emitted as a class — would
  // produce a broken class on `htmlClass(default)` calls.
  for (const name of themeNames) {
    if (!CLASS_NAME_RE.test(name)) {
      throw new Error(
        `themeTokens: theme name '${name}' is not a valid CSS class fragment ` +
          `(allowed: letters, digits, _, -, must not start with a digit)`,
      )
    }
  }
  const defaultName = opts.default as string
  if (!themeNames.includes(defaultName)) {
    throw new Error(
      `themeTokens: default theme '${defaultName}' not found in themes ` +
        `(available: ${themeNames.join(', ')})`,
    )
  }
  const classPrefix = opts.classPrefix ?? 'theme-'

  // Validate that all themes declare the same token set. Catches the
  // foot-gun where switching to a partial theme leaves stale values.
  const defaultTokens = themes[defaultName as keyof Themes] as ThemeMap
  const defaultKeys = new Set(Object.keys(defaultTokens))
  for (const name of themeNames) {
    if (name === defaultName) continue
    const t = themes[name] as ThemeMap
    const otherKeys = new Set(Object.keys(t))
    for (const k of defaultKeys) {
      if (!otherKeys.has(k)) {
        throw new Error(
          `themeTokens: theme '${name}' is missing token '${k}' (declared in default theme '${defaultName}')`,
        )
      }
    }
    for (const k of otherKeys) {
      if (!defaultKeys.has(k)) {
        throw new Error(
          `themeTokens: theme '${name}' declares extra token '${k}' (not in default theme '${defaultName}')`,
        )
      }
    }
  }

  // **Tier 17-C / ADR 0049 — `light-dark()` mode.** When the caller
  // (or `theme()`'s auto-detection) opts in, emit a single
  // `--token: light-dark(<lightVal>, <darkVal>);` per token + a
  // `color-scheme: light dark` declaration on `:root`. Theme
  // switching becomes "write `color-scheme: light/dark` on `<html>`"
  // — the browser resolves which value `light-dark()` returns. No
  // per-theme class proliferation; no `:not(.theme-X)` cascade
  // gymnastics; ZERO JS for theme propagation.
  if (opts.mode === 'light-dark') {
    if (themeNames.length !== 2 || !themeNames.includes('light') || !themeNames.includes('dark')) {
      throw new Error(
        `themeTokens: mode: 'light-dark' requires exactly 2 themes named 'light' and 'dark' ` +
          `(got: ${themeNames.join(', ')})`,
      )
    }
    const lightTokens = themes['light' as keyof Themes] as ThemeMap
    const darkTokens = themes['dark' as keyof Themes] as ThemeMap
    const typoLD = opts.typography ? buildTypographySections(opts.typography) : null

    const ldSections: string[] = []
    ldSections.push('@import "tailwindcss";')

    // @theme block — each color token becomes `light-dark(<light>, <dark>)`.
    // Non-color tokens (typography) ship verbatim since they don't
    // vary per mode.
    const themeBlockLines: string[] = []
    for (const k of Object.keys(lightTokens)) {
      if (!isTokenName(k)) {
        throw new Error(
          `themeTokens: token name '${k}' must start with '--' (CSS custom property convention)`,
        )
      }
      const lightVal = String(lightTokens[k]).trim()
      const darkVal = String(darkTokens[k]).trim()
      // Only colors benefit from light-dark(); but the wrapper is
      // valid for any value type the browser tolerates. If both
      // values are identical, drop to plain value (cleaner output).
      if (lightVal === darkVal) {
        themeBlockLines.push(`${k}: ${lightVal};`)
      } else {
        themeBlockLines.push(`${k}: light-dark(${lightVal}, ${darkVal});`)
      }
    }
    if (typoLD?.themeAdditions) themeBlockLines.push(...typoLD.themeAdditions)
    ldSections.push(`@theme {\n${indent(themeBlockLines)}\n}`)

    // :root color-scheme — required for `light-dark()` to honor
    // either the OS preference (default) or a child `color-scheme`
    // override. Without this declaration, `light-dark()` returns
    // the LIGHT value unconditionally.
    ldSections.push(`:root {\n  color-scheme: light dark;\n}`)

    // Per-theme classes — keep `.theme-light` / `.theme-dark` working
    // as the override channel so existing `setTheme(tokens, 'dark')`
    // call sites still flip the page. Each class just sets
    // `color-scheme`; the browser does the rest.
    ldSections.push(`.${classNameFor(classPrefix, 'light')} {\n  color-scheme: light;\n}`)
    ldSections.push(`.${classNameFor(classPrefix, 'dark')} {\n  color-scheme: dark;\n}`)

    // Typography role classes (theme-agnostic).
    if (typoLD) {
      for (const cls of typoLD.roleClasses) ldSections.push(cls)
    }

    const ldBase = `${ldSections.join('\n\n')}\n`
    return {
      base: ldBase,
      htmlClass: (theme) => classNameFor(classPrefix, theme as string),
      names: themeNames as ReadonlyArray<keyof Themes>,
      default: defaultName as keyof Themes,
      themes,
    }
  }

  // Resolve systemPreference. Auto-binding kicks in when the caller
  // didn't say anything AND the conventional theme names exist.
  let sysPref: { dark?: keyof Themes; light?: keyof Themes } | undefined
  if (opts.systemPreference === false) {
    sysPref = undefined
  } else if (opts.systemPreference) {
    sysPref = opts.systemPreference
  } else {
    const auto: { dark?: keyof Themes; light?: keyof Themes } = {}
    if (themeNames.includes('dark')) auto.dark = 'dark' as keyof Themes
    if (themeNames.includes('light')) auto.light = 'light' as keyof Themes
    sysPref = Object.keys(auto).length > 0 ? auto : undefined
  }

  const sections: string[] = []

  // 1. Tailwind import (callers shouldn't have to prepend this).
  sections.push('@import "tailwindcss";')

  // **Typography**: build the section additions first so we can fold
  // them into the same `@theme` block as color tokens. Tailwind v4
  // recognizes `--font-*`, `--font-weight-*`, `--leading-*`,
  // `--tracking-*` token prefixes and generates corresponding
  // utilities; mixing them with `--color-*` in one @theme keeps
  // theme switching atomic.
  const typo = opts.typography ? buildTypographySections(opts.typography) : null

  // 2. @theme block — registers the default theme's color tokens +
  //    typography scale tokens with v4. These also serve as `:root`
  //    defaults: pages with no theme class get this theme.
  const themeBlockLines = [
    ...tokensToLines(defaultTokens, defaultName),
    ...(typo?.themeAdditions ?? []),
  ]
  sections.push(`@theme {\n${indent(themeBlockLines)}\n}`)

  // 3. Per-theme override classes — emitted for EVERY theme, including
  //    the default. The default's class body is technically redundant
  //    with @theme, but emitting it lets `:root:not(.theme-X)` selectors
  //    in the system-preference @media blocks exclude an explicit
  //    user-chosen default theme. Without it, picking the default via
  //    class would still get overridden by the opposite system pref.
  for (const name of themeNames) {
    const sel = `.${classNameFor(classPrefix, name)}`
    const lines = tokensToLines(themes[name] as ThemeMap, name)
    sections.push(`${sel} {\n${indent(lines)}\n}`)
  }

  // 4. prefers-color-scheme bindings. The selector excludes ALL theme
  //    classes — when the user has set ANY explicit theme class, the
  //    media block doesn't fire and the explicit class's rule wins.
  //    When no class is set, system preference picks the theme.
  if (sysPref) {
    const allThemeClasses = themeNames.map((n) => `.${classNameFor(classPrefix, n)}`)
    const notSelector = `:root:not(${allThemeClasses.join('):not(')})`
    if (sysPref.dark && sysPref.dark !== defaultName) {
      const darkName = String(sysPref.dark)
      const tokens = themes[sysPref.dark] as ThemeMap
      sections.push(
        `@media (prefers-color-scheme: dark) {\n  ${notSelector} {\n${indent(
          tokensToLines(tokens, darkName),
          '    ',
        )}\n  }\n}`,
      )
    }
    if (sysPref.light && sysPref.light !== defaultName) {
      const lightName = String(sysPref.light)
      const tokens = themes[sysPref.light] as ThemeMap
      sections.push(
        `@media (prefers-color-scheme: light) {\n  ${notSelector} {\n${indent(
          tokensToLines(tokens, lightName),
          '    ',
        )}\n  }\n}`,
      )
    }
  }

  // 5. Typography role utility classes — emitted as plain CSS rules
  //    after the @theme block + per-theme overrides + media bindings.
  //    Role classes are theme-agnostic: they compose font-size +
  //    line-height + tracking + weight + family. Color is left to the
  //    consumer (so `text-h1` doesn't fight `text-fg` or similar).
  if (typo) {
    for (const cls of typo.roleClasses) sections.push(cls)
  }

  const base = `${sections.join('\n\n')}\n`

  return {
    base,
    htmlClass: (theme) => classNameFor(classPrefix, theme as string),
    names: themeNames as ReadonlyArray<keyof Themes>,
    default: opts.default,
    themes,
  }
}

// ===== Cookie helper for server-side theme selection =====
//
// The standard pattern: a `theme` cookie stores the user's choice;
// the server reads it on every request, picks the matching theme,
// passes it to the layout/page `htmlClass`. The client toggle sets the cookie
// (and the class) when the user picks a different theme.
//
// `readThemeFromRequest` returns the user-chosen theme, or the
// default if no cookie is set or the cookie names an unknown theme.
// `themeCookieHeader` produces the `Set-Cookie` value for a write.
//
// Why a cookie and not localStorage: cookies ride on the request, so
// the server picks the theme BEFORE rendering — no flash. localStorage
// is only readable from JS, requiring a pre-paint inline script that
// fights strict CSP.

/** Cookie name used by the helpers. Override via `themeCookieName`. */
export const DEFAULT_THEME_COOKIE = 'place-theme'

/**
 * Read the user's chosen theme from a Request's `Cookie` header.
 *
 * The signature takes the bare `{ default, names }` slice of
 * `ThemeTokens` (rather than the full object) so TypeScript's
 * function-parameter contravariance doesn't reject narrowed
 * `htmlClass` callbacks at the call site.
 */
export function readThemeFromRequest<TName extends string>(
  req: Request,
  tokens: { default: TName; names: ReadonlyArray<TName> },
  cookieName = DEFAULT_THEME_COOKIE,
): TName {
  const cookie = req.headers.get('cookie')
  if (!cookie) return tokens.default
  // Parse a single cookie value — minimal parser, no quoted-value or
  // path/domain attrs (those are response-side only).
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    if (k !== cookieName) continue
    const v = decodeURIComponent(part.slice(eq + 1).trim())
    // Validate against the known theme set so a stale or tampered
    // cookie can't inject an arbitrary class.
    if ((tokens.names as readonly string[]).includes(v)) {
      return v as TName
    }
    return tokens.default
  }
  return tokens.default
}

/**
 * Build a `Set-Cookie` header value for persisting the theme choice.
 * Long-lived (1 year), `SameSite=Lax`, root path. Server-side; the
 * client equivalent is `document.cookie = themeCookieClient(...)`.
 */
export function themeCookieHeader(
  theme: string,
  options?: { cookieName?: string; maxAgeSeconds?: number; path?: string; secure?: boolean },
): string {
  const name = options?.cookieName ?? DEFAULT_THEME_COOKIE
  const maxAge = options?.maxAgeSeconds ?? 60 * 60 * 24 * 365
  const path = options?.path ?? '/'
  const secure = options?.secure ?? false
  const parts = [
    `${name}=${encodeURIComponent(theme)}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    'SameSite=Lax',
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Browser-only: set the theme cookie + apply the class to `<html>`.
 * The full client-side toggle in one call. Pass the result of
 * `themeTokens()` so it knows the class-name shape.
 *
 *   import { setTheme } from '@place-ts/component'
 *   <button onClick={() => setTheme(myTokens, 'dark')}>Dark</button>
 *
 * The special value `'system'` clears every theme class so the
 * stylesheet's `@media (prefers-color-scheme: …)` bindings drive
 * appearance from the OS preference. The cookie stores `'system'`
 * verbatim; `themeEarlyScript()` re-applies it before paint on the
 * next load.
 */
export function setTheme<Themes extends Readonly<Record<string, ThemeMap>>>(
  tokens: ThemeTokens<Themes>,
  theme: keyof Themes | 'system',
  options?: { cookieName?: string },
): void {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  // Strip every theme- class first.
  const all = tokens.names.map((n) => tokens.htmlClass(n))
  for (const c of all) html.classList.remove(c)
  // 'system' → no class (the @media bindings take over). A named
  // theme → add its class.
  if (theme !== 'system') {
    html.classList.add(tokens.htmlClass(theme))
  }
  // Mirror the choice onto a data attribute so a theme picker can
  // drive its pressed state from CSS — no SSR/hydration mismatch,
  // no blip. `themeEarlyScript()` sets the same attribute pre-paint.
  html.dataset['placeTheme'] = String(theme)
  // Persist via cookie so the next request / early script picks the
  // same choice. We deliberately set `document.cookie` (not the
  // Cookie Store API, which is Chromium-only) — it works everywhere
  // and is synchronous, which matches the no-flash toggle UX.
  // biome-ignore lint/suspicious/noDocumentCookie: synchronous cross-browser cookie write — Cookie Store API not universally available
  document.cookie =
    `${options?.cookieName ?? DEFAULT_THEME_COOKIE}=${encodeURIComponent(String(theme))}; ` +
    `Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`
}

/**
 * Build the theme early-paint script (T19 follow-up). `serve()` and
 * `app().build()` inject this automatically into every page's
 * `<head>` when `theme` is configured — it runs BEFORE `<body>`
 * parses, so the persisted theme is applied with zero flash, on a
 * live server AND on a static export (where there is no per-request
 * cookie read at SSR).
 *
 * It reads the theme cookie, applies the matching `theme-*` class
 * (or none, for `'system'` — letting the `@media` bindings drive),
 * and mirrors the choice to `<html data-place-theme="…">` so a
 * theme picker can render its pressed state from CSS with no blip.
 *
 * Returned as a raw JS statement string — the framework wraps it in
 * a nonced/hashed `<script>` like any other `earlyHead` entry.
 */
export function themeEarlyScript(
  tokens: { names: ReadonlyArray<string>; htmlClass: (n: string) => string },
  cookieName: string = DEFAULT_THEME_COOKIE,
): string {
  const classes = tokens.names.map((n) => tokens.htmlClass(n))
  const removeArgs = classes.map((c) => JSON.stringify(c)).join(',')
  const applyChecks = tokens.names
    .map((n, i) => `if(v===${JSON.stringify(n)})r.classList.add(${JSON.stringify(classes[i])});`)
    .join('')
  return (
    '(function(){try{' +
    `var m=document.cookie.match(/(?:^|; )${cookieName}=([^;]+)/);` +
    "var v=m?decodeURIComponent(m[1]):'system';" +
    'var r=document.documentElement;' +
    `r.classList.remove(${removeArgs});` +
    applyChecks +
    'r.dataset.placeTheme=v;' +
    '}catch(e){}})()'
  )
}

// ============================================================
// theme() — modern high-DX theming helper (ADR 0038)
// ============================================================
//
// `themeTokens()` is the underlying primitive: typed token map →
// `@theme` block + per-theme classes. Powerful but verbose:
//
//   themeTokens({
//     default: 'dark',
//     themes: {
//       dark: { '--color-bg': 'oklch(0.13 …)', '--color-fg': '…',
//               '--color-accent': '…', '--color-border': '…',
//               '--color-card': '…', '--color-muted': '…',
//               '--color-accent-fg': '…', … 10 more …
//       },
//       light: { …same 10 keys, different values… }
//     }
//   })
//
// Reality: most apps want a SHORTHAND. They have 2-3 "anchor" colors
// per mode (bg / fg / accent) and accept tasteful defaults for the
// rest (card, border, muted, destructive). `theme()` provides that:
//
//   theme({
//     modes: {
//       dark: { bg: 'oklch(0.13 …)', fg: 'oklch(0.97 …)', accent: 'oklch(0.78 …)' },
//       light: { bg: 'oklch(0.985 …)', fg: 'oklch(0.18 …)', accent: 'oklch(0.62 …)' },
//     },
//     default: 'dark',
//   })
//
// Internally `theme()`:
//
//   1. Strips the `--color-` prefix burden (you write `bg`, it emits
//      `--color-bg`). Tailwind v4 picks up the prefixed names + emits
//      `bg-bg`, `text-fg`, etc. utilities.
//   2. Auto-fills sibling tokens (`card`, `card-fg`, `border`,
//      `muted`, `accent-fg`, `destructive`, `destructive-fg`) via
//      `color-mix(in oklab, …)` expressions referencing your anchors.
//      Override any sibling by listing it explicitly in the mode.
//   3. Forwards `typography`, `systemPreference`, `classPrefix` to
//      `themeTokens()` unchanged.
//
// The output is the same `ThemeTokens` shape `themeTokens()` returns
// — fully compatible with `app({ theme })` and the layout/page
// `htmlClass` field.

/**
 * One color mode (e.g. dark or light). Each key maps to a CSS color
 * value (`'oklch(…)'`, `'#hex'`, `'rgb(…)'`, etc.). Anchors are
 * `bg` / `fg` / `accent`; siblings auto-derive when omitted.
 */
export interface ColorMode {
  /** Anchor: page background. */
  bg: string
  /** Anchor: page foreground (text). */
  fg: string
  /** Anchor: accent color (primary brand, focus rings, buttons). */
  accent: string
  /** Color of foreground text on an accent-colored surface. Defaults
   *  to high-contrast pick (near-white on dark accent, near-black on
   *  light accent) via `color-mix` with the page bg/fg anchors. */
  'accent-fg'?: string
  /** Card / panel background — slightly contrasted from `bg`. */
  card?: string
  /** Foreground text on a card. Defaults to `fg`. */
  'card-fg'?: string
  /** Border color — between bg and fg by default. */
  border?: string
  /** Muted text (secondary copy, hints). Mid between bg and fg. */
  muted?: string
  /** Destructive action color (delete, error). Defaults to a tuned red. */
  destructive?: string
  /** Foreground text on a destructive surface. Defaults to near-white. */
  'destructive-fg'?: string
  /** Any extra CSS color tokens. Each key auto-prefixed with `--color-`. */
  [k: string]: string | undefined
}

/** Map of mode-name → ColorMode. Two modes is conventional (dark / light). */
export type ColorModeMap = Readonly<Record<string, ColorMode>>

export interface ThemeOptions<M extends ColorModeMap> {
  /** Color modes, e.g. `{ dark: {...}, light: {...} }`. */
  modes: M
  /** Default mode applied to `:root`. Defaults to the first listed mode. */
  default?: keyof M
  /** Bind modes to `prefers-color-scheme`. Default: auto-binding when
   *  `dark` and `light` mode names exist. Set `false` to disable. */
  systemPreference?: { dark?: keyof M; light?: keyof M } | false
  /** Class name prefix for `<html>`. Defaults to `'theme-'`. */
  classPrefix?: string
  /** Typography config — same shape as `themeTokens({typography})`. */
  typography?: TypographyOptions
}

/**
 * **The canonical theme entry-point for v0.1.** Use this for any
 * normal app. The lower-level `themeTokens()` is the underlying
 * primitive — reach for it only when you need to emit `--*` CSS
 * variables that aren't colors (`--shadow-*`, `--radius-*`, etc.)
 * or when you're authoring your own theme-shaped helper.
 *
 * Wraps `themeTokens()` with cleaner DX:
 *
 *   - Bare color keys (`bg`, `fg`, `accent`) auto-prefixed with `--color-`
 *   - Sibling tokens (`card`, `border`, `muted`, `accent-fg`, etc.)
 *     auto-derived via `color-mix()` from the anchors when omitted
 *   - Same return shape as `themeTokens()` — drop into `app({ theme })`
 *
 * @provisional — shipped in Tier 13 (ADR 0038). The default
 * `SIBLING_DEFAULTS` color-mix expressions may evolve before v0.1
 * publish based on real-world contrast feedback.
 *
 * @see {@link themeTokens} — the low-level primitive this wraps.
 *
 * @example
 * ```ts
 * import { theme } from '@place-ts/component'
 *
 * export const tokens = theme({
 *   modes: {
 *     dark: {
 *       bg: 'oklch(0.13 0.006 286)',
 *       fg: 'oklch(0.97 0.001 286)',
 *       accent: 'oklch(0.78 0.16 65)',
 *     },
 *     light: {
 *       bg: 'oklch(0.985 0.002 286)',
 *       fg: 'oklch(0.18 0.008 286)',
 *       accent: 'oklch(0.62 0.16 65)',
 *     },
 *   },
 *   typography: { scale: 'major-third' },
 * })
 *
 * app({ pages, theme: tokens }).run()
 * ```
 */
export function theme<M extends ColorModeMap>(
  opts: ThemeOptions<M>,
): ThemeTokens<Record<keyof M, ThemeMap>> {
  const modeNames = Object.keys(opts.modes) as Array<keyof M & string>
  if (modeNames.length === 0) {
    throw new Error('theme: at least one mode is required')
  }

  // Sibling-token defaults expressed as `color-mix()` over the anchors.
  // The CSS expressions reference the OUTPUT `--color-*` variables,
  // so siblings track changes to anchors at runtime (CSS-level
  // recalculation — no rebuild required for live theme tweaks).
  const SIBLING_DEFAULTS: Readonly<Record<string, string>> = {
    card: 'color-mix(in oklab, var(--color-bg) 92%, var(--color-fg))',
    'card-fg': 'var(--color-fg)',
    border: 'color-mix(in oklab, var(--color-bg) 78%, var(--color-fg))',
    muted: 'color-mix(in oklab, var(--color-fg) 60%, var(--color-bg))',
    // Heuristic for `accent-fg`: assume accent is mid-luminance, pick
    // a near-bg color (which is high-contrast against typical accents
    // in either light or dark themes).
    'accent-fg': 'var(--color-bg)',
    // Semantic intent colors. Hand-tuned OKLCH values that read
    // legibly on either light or dark surfaces. Apps that want
    // brand-specific success/warn override these per-mode.
    success: 'oklch(0.72 0.16 145)',
    'success-fg': 'oklch(0.98 0 0)',
    warn: 'oklch(0.78 0.17 70)',
    'warn-fg': 'oklch(0.18 0.008 286)',
    destructive: 'oklch(0.62 0.20 25)',
    'destructive-fg': 'oklch(0.98 0 0)',
  }

  // Translate each mode's bare keys into `--color-<key>` keys + fill
  // in sibling defaults when the user didn't specify.
  const themes: Record<string, ThemeMap> = {}
  for (const modeName of modeNames) {
    const mode = opts.modes[modeName] as ColorMode
    // Build mutable map first, freeze into ThemeMap shape via spread.
    const tokens: Record<string, string> = {}
    // Anchor + user-provided keys first (in source order so user
    // overrides win cleanly).
    for (const [k, v] of Object.entries(mode)) {
      if (v === undefined) continue
      tokens[`--color-${k}`] = v
    }
    // Fill in sibling defaults the user didn't specify. We add the
    // default only when the key isn't already present on the mode.
    for (const [k, v] of Object.entries(SIBLING_DEFAULTS)) {
      if (tokens[`--color-${k}`] === undefined) {
        tokens[`--color-${k}`] = v
      }
    }
    themes[modeName] = tokens as ThemeMap
  }

  // Default mode: explicit > first listed.
  const defaultMode = (opts.default ?? modeNames[0]) as keyof M & string

  // **Auto-select `light-dark()` mode** (Tier 17-C / ADR 0049) when
  // exactly 2 modes named `light` + `dark` exist AND the consumer
  // hasn't explicitly disabled system preference. This is the
  // common case; the output drops the `:not(.theme-X)` cascade
  // gymnastics in favor of a single `light-dark()` per token.
  // Multi-mode apps (sepia, hi-contrast, etc.) fall through to the
  // classic `'classes'` mode.
  const canUseLightDark =
    modeNames.length === 2 &&
    modeNames.includes('light') &&
    modeNames.includes('dark') &&
    opts.systemPreference !== false

  // Forward to `themeTokens()`. Cast: the typed shape passes through.
  type SysPref = { dark?: keyof M & string; light?: keyof M & string } | false
  return themeTokens({
    default: defaultMode,
    themes: themes as Record<keyof M & string, ThemeMap>,
    ...(canUseLightDark ? { mode: 'light-dark' as const } : {}),
    ...(opts.systemPreference !== undefined
      ? { systemPreference: opts.systemPreference as SysPref }
      : {}),
    ...(opts.classPrefix ? { classPrefix: opts.classPrefix } : {}),
    ...(opts.typography ? { typography: opts.typography } : {}),
  }) as ThemeTokens<Record<keyof M, ThemeMap>>
}
