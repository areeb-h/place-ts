// Tailwind v4 integration. Sub-exported as `@place/component/tailwind`
// so apps that don't use Tailwind don't pay the dependency weight in
// their server bundle (the import is lazy, the deps are peer/optional).
//
// Usage:
//
//   import { tailwind } from '@place/component/tailwind'
//
//   const css = await tailwind({ content: ['src/**/*.tsx'] })
//   page({ styles: css, view: ... })
//
// Returns `{ inline: string }` directly, the shape `page.styles` accepts.
// The CSS is compiled ONCE at server startup (not per-request) — the
// content scan + Tailwind build is the slow part, and it doesn't change
// per request. For dev-time HMR, run `tailwindcss --watch` to a file
// and pass `styles: '/path/to/built.css'` instead.
//
// Why not a Bun.build plugin? Because the SSR path doesn't go through
// Bun.build — we render JSX directly to strings. A plugin would only
// catch CSS in the client bundle, missing the SSR'd HTML's classes.
// The Oxide scanner reads source files directly, so it works for both.

import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'

export interface TailwindOptions {
  /**
   * Source content to scan for class candidates. Each entry is a glob
   * pattern resolved relative to `cwd` (default: process.cwd()).
   *
   *   content: ['src/**\/*.tsx', 'src/**\/*.ts']
   *
   * Tailwind's Oxide scanner reads these files and extracts every
   * potential class-name token. False positives are fine — they just
   * don't generate any CSS.
   */
  content: string[]
  /**
   * The base CSS to compile. Defaults to `@import "tailwindcss";` (the
   * standard Tailwind v4 entry). Pass a multi-line string to add
   * `@theme` blocks, layer customizations, etc:
   *
   *   base: `
   *     @import "tailwindcss";
   *     @theme { --color-brand: oklch(0.7 0.15 200); }
   *   `
   */
  base?: string
  /**
   * Working directory for resolving content globs and `@import`
   * statements in the base CSS. Default: `process.cwd()`.
   */
  cwd?: string
}

/**
 * Compile Tailwind CSS once and return a Style source ready to drop
 * into `page({ styles: ... })`. Run at server startup; do not call per
 * request.
 */
export async function tailwind(options: TailwindOptions): Promise<{ inline: string }> {
  const cwd = options.cwd ?? process.cwd()
  const baseCss = options.base ?? '@import "tailwindcss";'

  // Compile the base CSS first. The compiler discovers `@source` /
  // `@import` directives inside the base; we still pass `content`
  // explicitly via the scanner so apps don't need to embed `@source`.
  const compiled = await compile(baseCss, {
    base: cwd,
    onDependency: () => {},
  })

  // Scan source files for candidate class names.
  const scanner = new Scanner({
    sources: options.content.map((pattern) => ({
      base: cwd,
      pattern,
      negated: false,
    })),
  })
  const candidates = scanner.scan()

  // Build the final CSS from the discovered candidates.
  const inline = compiled.build(candidates)
  return { inline }
}
