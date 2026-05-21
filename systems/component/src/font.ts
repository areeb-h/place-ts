// @place-ts/component font helpers — typed @font-face + preload markup.
//
// Better than Next's `next/font` for our use case:
//   - No build-time download magic. You self-host the font file (drop it
//     in `./public/fonts/`, mount via `serve({ static: { '/fonts': … } })`)
//     and pass the URL. The browser-bundle ships zero font code; CSP is
//     `font-src 'self'` with no exceptions.
//   - One module, two functions: `font()` for a single weight/style,
//     `fonts()` to combine multiple into one drop-in bundle.
//   - Output is plain `{ styles, head }` that plugs into `page({ styles,
//     meta: { extra } })` — no special framework integration.
//
// What this does NOT do (yet):
//   - Auto-download from Google Fonts. Ergonomic but introduces a
//     network step at server startup + CSP egress concerns. Phase 5.2.x
//     follow-up if a workload demands it. For now: download manually
//     once, check into `./public/fonts/`, reference by URL.
//   - Subset / unicode-range optimization. Pass `unicodeRange` yourself
//     to scope per-language declarations.
//   - Format conversion. Use the format the browser will actually use
//     (.woff2 for everything modern; .woff/.ttf only for legacy).

import type { HeadEntry, StyleSrc } from './index.ts'

export interface FontOptions {
  /** CSS `font-family` name. e.g. `'Inter'`, `'JetBrains Mono'`. */
  family: string
  /**
   * URL(s) to the font file(s). First entry is also the preload target
   * (when `preload: true`). Multiple entries become a single `src:`
   * list in the `@font-face` — useful for legacy fallback (.woff2 then
   * .woff). Format is auto-detected from extension; pass full
   * `format(...)` syntax in `srcFormat` if you need overrides.
   */
  src: string | string[]
  /**
   * Numeric weight (`400`) or variable-font range (`'100 900'`).
   * Default: `'400'` (regular).
   */
  weight?: number | string
  /** Default: `'normal'`. */
  style?: 'normal' | 'italic' | 'oblique'
  /**
   * `font-display`. Default: `'swap'` — show fallback immediately, swap
   * to web font when ready. `'optional'` is even better for perf-critical
   * pages but only loads if cached; pick deliberately per use case.
   */
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional'
  /** `unicode-range`. Use to subset per-language ranges. */
  unicodeRange?: string
  /**
   * Emit `<link rel="preload" as="font" crossorigin>` for the primary
   * src. Use sparingly: only the 1-2 fonts that appear above-the-fold
   * benefit. Preloading every weight wastes bandwidth on the critical
   * path.
   */
  preload?: boolean
}

export interface FontResult {
  /** CSS for `@font-face`. Drop into `page({ styles })`. */
  css: string
  /** Head entries (preload links). Drop into `page({ meta: { extra } })`. */
  head: HeadEntry[]
}

const FORMAT_MAP: Record<string, string> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
  eot: 'embedded-opentype',
  svg: 'svg',
}

function detectFormat(url: string): string | null {
  // Trim query string + hash.
  const clean = url.split('?')[0]?.split('#')[0] ?? ''
  const dot = clean.lastIndexOf('.')
  if (dot < 0) return null
  const ext = clean.slice(dot + 1).toLowerCase()
  return FORMAT_MAP[ext] ?? null
}

const FONT_CONTENT_TYPES: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  truetype: 'font/ttf',
  opentype: 'font/otf',
  'embedded-opentype': 'application/vnd.ms-fontobject',
  svg: 'image/svg+xml',
}

function escapeCssString(s: string): string {
  // Escape `\` and `"` for `font-family: "..."` and url("...").
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/**
 * Build a `@font-face` declaration + (optionally) a preload link for a
 * single font weight/style. Output is `{ css, head }` ready to drop into
 * `page({ styles, meta })`.
 */
export function font(options: FontOptions): FontResult {
  const sources = Array.isArray(options.src) ? options.src : [options.src]
  if (sources.length === 0) {
    throw new Error('font: at least one src URL is required')
  }
  const weight = options.weight ?? 400
  const style = options.style ?? 'normal'
  const display = options.display ?? 'swap'

  // Build the `src:` list. Each entry: url("...") format("...").
  const srcEntries = sources.map((url) => {
    const fmt = detectFormat(url)
    const fmtPart = fmt ? ` format("${fmt}")` : ''
    return `url("${escapeCssString(url)}")${fmtPart}`
  })

  const lines: string[] = [
    '@font-face {',
    `  font-family: "${escapeCssString(options.family)}";`,
    `  src: ${srcEntries.join(', ')};`,
    `  font-weight: ${weight};`,
    `  font-style: ${style};`,
    `  font-display: ${display};`,
  ]
  if (options.unicodeRange) {
    lines.push(`  unicode-range: ${options.unicodeRange};`)
  }
  lines.push('}')

  const head: HeadEntry[] = []
  if (options.preload) {
    const primary = sources[0] as string
    const fmt = detectFormat(primary)
    const contentType = fmt ? FONT_CONTENT_TYPES[fmt] : undefined
    head.push({
      tag: 'link',
      rel: 'preload',
      href: primary,
      as: 'font',
      crossorigin: 'anonymous',
      ...(contentType ? { type: contentType } : {}),
    })
  }

  return { css: lines.join('\n'), head }
}

/**
 * Combine multiple `font()` definitions into a single `{ styles, head }`
 * bundle ready to spread into `page()`:
 *
 * ```ts
 * const f = fonts(
 *   { family: 'Inter', src: '/fonts/Inter-400.woff2', weight: 400, preload: true },
 *   { family: 'Inter', src: '/fonts/Inter-700.woff2', weight: 700 },
 * )
 *
 * page({
 *   styles: [f.styles, '/css/app.css'],
 *   meta: { extra: f.head },
 *   view: …,
 * })
 * ```
 *
 * The combined CSS lands in one `<style>` block; preload links emit one
 * per font that opted in.
 */
export function fonts(...defs: FontOptions[]): {
  styles: StyleSrc
  head: HeadEntry[]
} {
  const results = defs.map(font)
  return {
    styles: { inline: results.map((r) => r.css).join('\n\n') },
    head: results.flatMap((r) => r.head),
  }
}
