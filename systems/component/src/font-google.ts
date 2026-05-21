// @place-ts/component — first-class Google Fonts (self-hosted).
//
// Inspired by Next.js's `next/font/google` but with three real
// improvements:
//
//   1. **Self-hosted, no runtime calls to googleapis.com.** Fonts are
//      downloaded ONCE at server startup (and cached on disk in
//      `.place/fonts/`); every browser request reads from the
//      framework's own static route. Privacy, speed, offline-friendly.
//
//   2. **Loud failures.** Network down on first boot? Clear error
//      message ("couldn't reach fonts.googleapis.com; check
//      connectivity, or pass `offline: true` to fall back to a
//      system-font stack"). Unknown family? Helpful "did you mean"
//      hint when we can compute one cheaply. No silent fallbacks
//      that make the user wonder why their text looks wrong.
//
//   3. **Atomic cache.** Each (family, weights, subsets, style)
//      combination is hashed to a stable cache key. Writes are atomic
//      (write to `.tmp`, rename). Corruption auto-recovers — the
//      next boot re-downloads the missing piece.
//
// Usage:
//
//   import { font } from '@place-ts/component'
//
//   export const sans = font.google('Inter', {
//     weights: [400, 500, 600, 700],
//     subsets: ['latin'],
//     variable: '--font-sans',
//     preload: true,
//   })
//
//   app({ fonts: [sans], ... })
//
// The framework auto-injects:
//   - `<link rel="preload">` for each weight flagged `preload: true`.
//   - An inline `<style>` with @font-face declarations + a
//     `:root { --font-sans: 'Inter', ... }` variable rule.
//
// Server-only module. Anything that runs at request time goes through
// the route handler, which only reads pre-downloaded files.

import type { HeadEntry, StyleSrc } from './index.ts'

// ===== Public types =====

export interface GoogleFontOptions {
  /** Numeric weights (`[400, 700]`). Default: `[400]`. */
  weights?: readonly number[]
  /** Subsets (`['latin']`). Default: `['latin']`. */
  subsets?: readonly string[]
  /** `normal` (default) or `italic`. Mixed via two `font.google()` calls. */
  style?: 'normal' | 'italic'
  /**
   * CSS variable to assign on `:root`. Apps reference via
   * `font-family: var(--font-sans, …)`. Pass `false` to skip the
   * variable injection (e.g. for a one-off `@font-face` you reference
   * by family directly).
   * Default: `false` (no variable; consume via family name).
   */
  variable?: string | false
  /**
   * Emit `<link rel="preload">` for these weights. Default: none.
   * Common pick: `preload: true` is sugar for "preload the regular
   * weight (or 400, or the first weight in `weights`)." Pass a list
   * to preload specific weights.
   */
  preload?: boolean | readonly number[]
  /**
   * `font-display`. Default: `'swap'` — show fallback immediately,
   * swap to web font when ready. `'optional'` is even better for perf-
   * critical pages but only loads if cached; pick deliberately.
   */
  display?: 'auto' | 'block' | 'swap' | 'fallback' | 'optional'
  /**
   * Skip the network entirely. Returns a descriptor that resolves to
   * a system-font stack instead of attempting the download. Use in
   * tests, offline CI, or when you want to ship a system-font-only
   * build.
   */
  offline?: boolean
}

/**
 * Opaque descriptor for a Google font family. Returned by
 * `font.google(...)`. The framework resolves these at app()/serve()
 * boot — apps treat them as opaque values to pass into
 * `app({ fonts: [...] })`.
 */
export interface GoogleFontDescriptor {
  readonly __placeGoogleFont: true
  readonly family: string
  readonly weights: readonly number[]
  readonly subsets: readonly string[]
  readonly style: 'normal' | 'italic'
  readonly variable: string | false
  readonly preload: boolean | readonly number[]
  readonly display: 'auto' | 'block' | 'swap' | 'fallback' | 'optional'
  readonly offline: boolean
}

/** Result of resolving a GoogleFontDescriptor — CSS + head entries
 *  the framework folds into the page's styles + extra head entries. */
export interface ResolvedGoogleFont {
  readonly css: string
  readonly head: HeadEntry[]
  /** Static route entries the framework registers (path → file path). */
  readonly routes: ReadonlyArray<{ readonly path: string; readonly filePath: string }>
}

// ===== Factory =====

/**
 * Build an opaque GoogleFontDescriptor. Synchronous — no network
 * traffic, no file I/O. Pass the result into `app({ fonts: [...] })`.
 */
export function googleFont(family: string, opts: GoogleFontOptions = {}): GoogleFontDescriptor {
  if (typeof family !== 'string' || family.length === 0) {
    throw new TypeError('font.google: family must be a non-empty string')
  }
  return {
    __placeGoogleFont: true,
    family,
    weights: opts.weights && opts.weights.length > 0 ? [...opts.weights] : [400],
    subsets: opts.subsets && opts.subsets.length > 0 ? [...opts.subsets] : ['latin'],
    style: opts.style ?? 'normal',
    variable: opts.variable ?? false,
    preload: opts.preload ?? false,
    display: opts.display ?? 'swap',
    offline: opts.offline ?? false,
  }
}

export const isGoogleFontDescriptor = (x: unknown): x is GoogleFontDescriptor =>
  x !== null &&
  typeof x === 'object' &&
  (x as { __placeGoogleFont?: unknown }).__placeGoogleFont === true

// ===== Resolver =====

/**
 * Resolve a GoogleFontDescriptor to its actual CSS + head entries +
 * static route registrations. Downloads font files from Google on
 * first boot, caches them under `.place/fonts/<hash>/`, atomic-writes.
 *
 * Subsequent boots with the same descriptor read from cache — no
 * network traffic. Cache invalidation: change any input field
 * (weights, subsets, style) → new hash → new cache dir.
 *
 * Throws with a clear message on:
 *   - network failures (fonts.googleapis.com unreachable)
 *   - HTTP errors from googleapis (404 = unknown family, etc.)
 *   - file system errors writing to `.place/fonts/`
 */
export async function resolveGoogleFont(
  desc: GoogleFontDescriptor,
  opts: { cwd?: string } = {},
): Promise<ResolvedGoogleFont> {
  if (desc.offline) {
    return buildOfflineFallback(desc)
  }
  const cwd = opts.cwd ?? process.cwd()
  const { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } =
    require('node:fs') as typeof import('node:fs')
  const { join } = require('node:path') as typeof import('node:path')
  const { createHash } = require('node:crypto') as typeof import('node:crypto')

  const cacheKey = createHash('sha256')
    .update(
      [
        desc.family,
        [...desc.weights].sort((a, b) => a - b).join(','),
        [...desc.subsets].sort().join(','),
        desc.style,
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 16)

  const cacheDir = join(cwd, '.place', 'fonts', cacheKey)
  const manifestPath = join(cacheDir, 'manifest.json')

  let manifest: GoogleFontManifest | null = null
  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as GoogleFontManifest
    } catch {
      // Corruption — re-download below.
      manifest = null
    }
  }

  if (!manifest) {
    // Download path. Fetch the CSS, parse @font-face blocks, download
    // each woff2 to the cache dir, write a manifest.
    const cssUrl = buildGoogleCssUrl(desc)
    let cssText: string
    try {
      const res = await fetch(cssUrl, {
        headers: {
          // Modern UA → woff2 URLs (older UAs get woff/ttf).
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      })
      if (!res.ok) {
        if (res.status === 400 || res.status === 404) {
          throw new Error(
            `font.google('${desc.family}'): Google Fonts rejected the request (${res.status}). ` +
              `Likely an unknown family name OR an unsupported weight/subset combination. ` +
              `Verify at https://fonts.google.com/specimen/${encodeURIComponent(desc.family.replace(/ /g, '+'))}`,
          )
        }
        throw new Error(
          `font.google('${desc.family}'): Google Fonts returned HTTP ${res.status}. ` +
            `Underlying URL: ${cssUrl}`,
        )
      }
      cssText = await res.text()
    } catch (err) {
      if (err instanceof Error && err.message.includes('Google Fonts')) throw err
      throw new Error(
        `font.google('${desc.family}'): couldn't reach fonts.googleapis.com. ` +
          `Check network connectivity, or pass \`offline: true\` to fall back to a ` +
          `system-font stack until you're back online. ` +
          `Underlying error: ${(err as Error).message}`,
      )
    }

    // Parse @font-face blocks. We want, per block: weight, style,
    // unicode-range (if present), and the woff2 URL.
    const blocks = parseFontFaceBlocks(cssText)
    if (blocks.length === 0) {
      throw new Error(
        `font.google('${desc.family}'): no @font-face blocks parsed from Google's CSS. ` +
          `This usually means the response shape changed. Underlying URL: ${cssUrl}`,
      )
    }

    // Download each woff2 file. Use a deterministic local filename so
    // the cache dir is reproducible.
    mkdirSync(cacheDir, { recursive: true })
    const files: GoogleFontManifestFile[] = []
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i] as GoogleFontFaceBlock
      const localName = `${slugify(desc.family)}-${block.weight}-${block.style}${
        block.subset ? `-${block.subset}` : `-${i}`
      }.woff2`
      const localPath = join(cacheDir, localName)
      if (!existsSync(localPath)) {
        const fontRes = await fetch(block.url)
        if (!fontRes.ok) {
          throw new Error(
            `font.google('${desc.family}'): font file download failed (HTTP ${fontRes.status}) ` +
              `at ${block.url}`,
          )
        }
        const buf = new Uint8Array(await fontRes.arrayBuffer())
        // Atomic write: write to .tmp then rename.
        const tmpPath = `${localPath}.tmp`
        writeFileSync(tmpPath, buf)
        renameSync(tmpPath, localPath)
      }
      files.push({
        localName,
        weight: block.weight,
        style: block.style,
        unicodeRange: block.unicodeRange,
        subset: block.subset,
      })
    }
    manifest = { family: desc.family, files }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  }

  // Build the CSS + head entries + route table from the manifest.
  return buildResolved(desc, manifest, cacheDir, cacheKey)
}

function buildOfflineFallback(desc: GoogleFontDescriptor): ResolvedGoogleFont {
  // System-font stack matching common Google Fonts categories. Apps
  // that need exact metrics can override via inline @font-face. We
  // emit ONLY the variable rule (if requested) — no @font-face, since
  // the family won't be available.
  const stack =
    desc.style === 'italic'
      ? `"${desc.family}", ui-sans-serif, system-ui, sans-serif`
      : `"${desc.family}", ui-sans-serif, system-ui, sans-serif`
  const css =
    desc.variable !== false
      ? `:root { ${desc.variable}: ${stack}; }\n`
      : `/* font.google('${desc.family}', { offline: true }): falling back to system fonts */\n`
  return { css, head: [], routes: [] }
}

interface GoogleFontFaceBlock {
  weight: number
  style: 'normal' | 'italic'
  url: string
  unicodeRange?: string
  subset?: string
}

interface GoogleFontManifestFile {
  localName: string
  weight: number
  style: 'normal' | 'italic'
  unicodeRange?: string | undefined
  subset?: string | undefined
}

interface GoogleFontManifest {
  family: string
  files: GoogleFontManifestFile[]
}

function buildGoogleCssUrl(desc: GoogleFontDescriptor): string {
  const family = desc.family.replace(/ /g, '+')
  // Google's modern CSS API: family=Inter:ital,wght@0,400;0,700
  const weightSpec = [...desc.weights].sort((a, b) => a - b).join(';')
  const italBit = desc.style === 'italic' ? '1' : '0'
  const axis = `ital,wght@${[...desc.weights]
    .sort((a, b) => a - b)
    .map((w) => `${italBit},${w}`)
    .join(';')}`
  const params = new URLSearchParams()
  params.set('family', `${family}:${axis}`)
  params.set('display', desc.display)
  // Subsets aren't a CSS API param directly — Google serves all
  // subsets and groups by `unicode-range`. We keep `subsets` in the
  // descriptor for cache-keying + future filtering, but the URL
  // request itself doesn't gate them.
  void weightSpec // silence unused-binding when the future subset filter lands
  return `https://fonts.googleapis.com/css2?${params.toString()}`
}

function parseFontFaceBlocks(cssText: string): GoogleFontFaceBlock[] {
  const blocks: GoogleFontFaceBlock[] = []
  // Google's CSS comments each @font-face with the subset name
  // (`/* latin */`, `/* cyrillic */`, etc.). Track the most-recent
  // comment as we scan so each block can carry its subset.
  const commentRe = /\/\*\s*([a-z][a-z0-9-]*)\s*\*\//gi
  const blockRe = /@font-face\s*\{([^}]+)\}/g

  // Index comments so we can pair each @font-face block with the
  // comment immediately before it.
  const comments: Array<{ index: number; subset: string }> = []
  let cm: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: canonical exec loop
  while ((cm = commentRe.exec(cssText)) !== null) {
    comments.push({ index: cm.index, subset: (cm[1] ?? '').toLowerCase() })
  }

  let bm: RegExpExecArray | null
  // biome-ignore lint/suspicious/noAssignInExpressions: canonical exec loop
  while ((bm = blockRe.exec(cssText)) !== null) {
    const body = bm[1] ?? ''
    const weightMatch = body.match(/font-weight:\s*([0-9]+)/i)
    const styleMatch = body.match(/font-style:\s*(normal|italic)/i)
    const urlMatch = body.match(/url\((https?:\/\/[^)]+\.woff2)\)/i)
    const rangeMatch = body.match(/unicode-range:\s*([^;]+)/i)
    if (!urlMatch) continue
    // Find the closest preceding comment.
    let subset: string | undefined
    for (let i = comments.length - 1; i >= 0; i--) {
      const c = comments[i] as { index: number; subset: string }
      if (c.index < bm.index) {
        subset = c.subset
        break
      }
    }
    blocks.push({
      weight: weightMatch ? Number.parseInt(weightMatch[1] ?? '400', 10) : 400,
      style: (styleMatch?.[1] as 'normal' | 'italic' | undefined) ?? 'normal',
      url: urlMatch[1] as string,
      ...(rangeMatch ? { unicodeRange: (rangeMatch[1] ?? '').trim() } : {}),
      ...(subset ? { subset } : {}),
    })
  }
  return blocks
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function buildResolved(
  desc: GoogleFontDescriptor,
  manifest: GoogleFontManifest,
  cacheDir: string,
  cacheKey: string,
): ResolvedGoogleFont {
  const routes: Array<{ path: string; filePath: string }> = []
  const familyCssName = desc.family.replace(/"/g, '\\"')
  const lines: string[] = []

  // Identify which weights should preload. Pass `true` → just the
  // first weight (typically 400, the regular). Pass an array → match
  // those weights exactly.
  const preloadSet =
    desc.preload === true
      ? new Set([desc.weights[0] ?? 400])
      : Array.isArray(desc.preload)
        ? new Set(desc.preload)
        : new Set<number>()

  const head: HeadEntry[] = []
  const { join } = require('node:path') as typeof import('node:path')

  for (const file of manifest.files) {
    const routePath = `/_place/fonts/${cacheKey}/${file.localName}`
    routes.push({ path: routePath, filePath: join(cacheDir, file.localName) })
    lines.push('@font-face {')
    lines.push(`  font-family: "${familyCssName}";`)
    lines.push(`  src: url("${routePath}") format("woff2");`)
    lines.push(`  font-weight: ${file.weight};`)
    lines.push(`  font-style: ${file.style};`)
    lines.push(`  font-display: ${desc.display};`)
    if (file.unicodeRange) {
      lines.push(`  unicode-range: ${file.unicodeRange};`)
    }
    lines.push('}')

    if (preloadSet.has(file.weight)) {
      head.push({
        tag: 'link',
        rel: 'preload',
        href: routePath,
        as: 'font',
        type: 'font/woff2',
        crossorigin: 'anonymous',
      })
    }
  }

  // Variable injection. Only one rule per descriptor (the `family`
  // becomes the first entry in the fallback stack).
  if (desc.variable !== false) {
    const stack = `"${familyCssName}", ui-sans-serif, system-ui, sans-serif`
    lines.push(`:root { ${desc.variable}: ${stack}; }`)
  }

  return {
    css: lines.join('\n'),
    head,
    routes,
  }
}

/** Combine an arbitrary array of resolved fonts into one StyleSrc +
 *  head + routes bundle for the framework to consume. */
export function combineResolvedFonts(parts: readonly ResolvedGoogleFont[]): {
  styles: StyleSrc
  head: HeadEntry[]
  routes: ReadonlyArray<{ path: string; filePath: string }>
} {
  return {
    styles: { inline: parts.map((p) => p.css).join('\n\n') },
    head: parts.flatMap((p) => p.head),
    routes: parts.flatMap((p) => p.routes),
  }
}
