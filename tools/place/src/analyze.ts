// analyze.ts — pure static-export analyzer.
//
// The `place` CLI's data layer. It reads a finished static export
// (`dist/`, produced by `app({...}).build({ outDir })` / `bun run
// build`) plus the on-disk view manifest, and answers ONE question
// per route: what JavaScript ships, and why.
//
// **Design — decoupled by construction.** This module imports nothing
// from `@place/component` or any framework system. It reads emitted
// files (HTML + JS) with `node:fs` and measures them. The manifest
// shape is duplicated locally as `ManifestEntry` rather than imported
// — the manifest is a stable on-disk artefact, and a local type keeps
// the CLI from coupling to framework internals. That decoupling is
// what makes the CLI a zero-risk, purely additive tool.
//
// **Why analyze the export, not the build state:** the static export
// is exactly what a CDN ships. Reading it is precise (no estimation)
// and needs no framework build hooks. The CLI is a pure function of
// `dist/` + the manifest.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

/** Classifier level — mirrors `@place/reactivity`'s `ViewLevel`. */
export type ViewLevel = 'static' | 'thaw' | 'island' | 'island+stream'

/**
 * One entry from `view-manifest.json`. Local copy of the framework's
 * `ViewManifestEntry` — the manifest is a stable on-disk format, and
 * duplicating the shape keeps the CLI decoupled from `@place/component`.
 */
export interface ManifestEntry {
  readonly name: string
  readonly level: ViewLevel
  readonly effects: readonly string[]
  readonly reason: string
  /** Raw byte size of the island's L2 bundle, per the build. */
  readonly bytesCurrent: number
}

/** A single `<script>` reference found in a route's HTML. */
export interface ScriptRef {
  /**
   * `island` — a per-island bundle (named in the view manifest).
   * `chunk`  — a shared / framework-runtime chunk Bun extracted.
   * `inline` — an inline `<script>` body (early-theme, SPA-nav runtime).
   */
  readonly kind: 'island' | 'chunk' | 'inline'
  /** External: the `src` URL. Inline: `'(inline)'`. */
  readonly src: string
  /** Island name (from the manifest join). Only set when `kind` is `island`. */
  readonly island?: string
  /** Raw byte size of the script content. */
  readonly rawBytes: number
  /** Gzipped byte size — the realistic over-the-wire cost. */
  readonly gzipBytes: number
  /** Classifier level — joined from the manifest. Island scripts only. */
  readonly level?: ViewLevel
  /** Human reason the classifier gave for the level. Island scripts only. */
  readonly reason?: string
  /** Effect kinds the classifier observed. Island scripts only. */
  readonly effects?: readonly string[]
}

/** Per-route analysis: which scripts the route ships and their cost. */
export interface RouteAnalysis {
  /** Route path — `'/'`, `'/api/components'`, etc. */
  readonly route: string
  /** Absolute path to the route's `index.html`. */
  readonly htmlPath: string
  /** Every `<script>` the route's HTML carries. */
  readonly scripts: readonly ScriptRef[]
  /** Sum of external (island + chunk) gzip bytes — the headline cost. */
  readonly externalGzip: number
  /** Sum of external (island + chunk) raw bytes. */
  readonly externalRaw: number
  /** Sum of inline `<script>` raw bytes (early-theme + SPA-nav runtime). */
  readonly inlineRaw: number
  /** True when the route ships zero external island/chunk JavaScript. */
  readonly isStatic: boolean
}

/** Full analysis of a `dist/` directory. */
export interface DistAnalysis {
  /** Absolute path to the analyzed `dist/` directory. */
  readonly distDir: string
  /** Every route discovered, sorted by path. */
  readonly routes: readonly RouteAnalysis[]
  /** Whether a `view-manifest.json` was found + parsed. */
  readonly manifestFound: boolean
}

export interface AnalyzeOptions {
  /** The static-export directory to analyze. */
  readonly distDir: string
  /** Path to `view-manifest.json`. Optional — analysis still runs
   *  without it, just without classifier level/reason attribution. */
  readonly manifestPath?: string
}

/** Thrown when the dist directory is missing — the CLI surfaces a hint. */
export class DistNotFoundError extends Error {
  constructor(distDir: string) {
    super(
      `no static export found at ${distDir}\n` +
        "  run a production build first (e.g. 'bun run build'), then re-run place.",
    )
    this.name = 'DistNotFoundError'
  }
}

// Executable-JS script types. A `<script>` with no `type`, or one of
// these, runs code. `type="application/json"` / `place-state+json`
// etc. carry DATA, not JavaScript, and are excluded from the count.
const JS_SCRIPT_TYPES = new Set(['', 'module', 'text/javascript', 'application/javascript'])

/**
 * Analyze a finished static export. Walks `<distDir>/**​/index.html`,
 * parses every `<script>`, measures each (raw + gzip), and joins
 * island bundles to the view manifest for level/reason attribution.
 *
 * Pure apart from filesystem reads — no network, no build, no
 * framework imports. Throws `DistNotFoundError` if `distDir` is absent.
 */
export function analyzeDist(options: AnalyzeOptions): DistAnalysis {
  const distDir = resolve(options.distDir)
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    throw new DistNotFoundError(distDir)
  }

  const manifest = loadManifest(options.manifestPath)
  const manifestNames = manifest === null ? [] : manifest.map((e) => e.name)
  const manifestByName = new Map(manifest?.map((e) => [e.name, e]) ?? [])

  const htmlFiles = findIndexHtml(distDir)
  const routes: RouteAnalysis[] = []
  // Bundle measurements are reused across routes (the same shared
  // chunk appears on every interactive page) — cache by file path.
  const measureCache = new Map<string, { rawBytes: number; gzipBytes: number }>()

  for (const htmlPath of htmlFiles) {
    const route = routeFromHtmlPath(distDir, htmlPath)
    const html = readFileSync(htmlPath, 'utf-8')
    const scripts: ScriptRef[] = []
    let externalGzip = 0
    let externalRaw = 0
    let inlineRaw = 0

    for (const raw of parseScripts(html)) {
      if (raw.src === null) {
        // Inline script. Count its body as shipped JS (raw + gzip).
        const bytes = Buffer.from(raw.body, 'utf-8')
        const gz = gzipSize(bytes)
        inlineRaw += bytes.byteLength
        scripts.push({
          kind: 'inline',
          src: '(inline)',
          rawBytes: bytes.byteLength,
          gzipBytes: gz,
        })
        continue
      }
      // External script. Resolve it inside dist; a missing file is
      // recorded with zero size rather than crashing the whole run.
      const measured = measureExternal(distDir, raw.src, measureCache)
      const islandName = matchIslandName(raw.src, manifestNames)
      const kind: ScriptRef['kind'] = islandName !== null ? 'island' : 'chunk'
      externalGzip += measured.gzipBytes
      externalRaw += measured.rawBytes
      const entry = islandName !== null ? manifestByName.get(islandName) : undefined
      scripts.push({
        kind,
        src: raw.src,
        ...(islandName !== null ? { island: islandName } : {}),
        rawBytes: measured.rawBytes,
        gzipBytes: measured.gzipBytes,
        ...(entry ? { level: entry.level, reason: entry.reason, effects: entry.effects } : {}),
      })
    }

    routes.push({
      route,
      htmlPath,
      scripts,
      externalGzip,
      externalRaw,
      inlineRaw,
      isStatic: externalRaw === 0,
    })
  }

  routes.sort((a, b) => a.route.localeCompare(b.route))
  return { distDir, routes, manifestFound: manifest !== null }
}

// ===== internals =====

/** Recursively collect every `index.html` under `dir`. */
function findIndexHtml(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string): void => {
    for (const e of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, e.name)
      if (e.isDirectory()) {
        // `.place` holds build metadata, not routes; islands hold
        // bundles, not pages. Skip both — nothing to walk there.
        if (e.name === '.place' || e.name === 'islands') continue
        walk(full)
      } else if (e.isFile() && e.name === 'index.html') {
        out.push(full)
      }
    }
  }
  walk(dir)
  return out
}

/** Map `dist/api/app/index.html` → route `/api/app`; `dist/index.html` → `/`. */
function routeFromHtmlPath(distDir: string, htmlPath: string): string {
  const rel = relative(distDir, htmlPath)
  // Drop the trailing `index.html`, normalize separators to URL `/`.
  const dir = rel.slice(0, rel.length - 'index.html'.length)
  const segments = dir.split(sep).filter((s) => s.length > 0)
  return segments.length === 0 ? '/' : `/${segments.join('/')}`
}

interface RawScript {
  /** `src` attribute value, or `null` for an inline script. */
  readonly src: string | null
  /** Inline body (empty for external scripts). */
  readonly body: string
}

/**
 * Parse every `<script>` element from an HTML string. Skips non-JS
 * `type`s (`application/json`, `place-state+json`, …) — those carry
 * data, not executable JavaScript. `<script>` is never self-closing
 * in HTML, so the open-tag → `</script>` pairing is exact.
 */
export function parseScripts(html: string): RawScript[] {
  const out: RawScript[] = []
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const attrs = m[1] ?? ''
    const body = m[2] ?? ''
    const type = (attrs.match(/\btype\s*=\s*["']([^"']*)["']/i)?.[1] ?? '').toLowerCase()
    if (!JS_SCRIPT_TYPES.has(type)) continue
    const src = attrs.match(/\bsrc\s*=\s*["']([^"']*)["']/i)?.[1] ?? null
    out.push({ src, body })
  }
  return out
}

/**
 * Join an island-bundle URL to its manifest name. Island bundles are
 * emitted as `<prefix>/<name>-<hash>.js` where `<hash>` is a fixed
 * 12-char content hash (see `island-bundler.ts`). Rather than guess
 * the hash charset, we test each known manifest name as a prefix:
 * the URL is an island iff `basename === '<name>-<12 chars>.js'` for
 * exactly one manifest name. Everything else (Bun's `chunk-*.js`,
 * sourcemaps) is a shared chunk.
 */
export function matchIslandName(src: string, manifestNames: readonly string[]): string | null {
  const slash = src.lastIndexOf('/')
  const basename = slash >= 0 ? src.slice(slash + 1) : src
  if (!basename.endsWith('.js')) return null
  for (const name of manifestNames) {
    // `<name>` + `-` + 12-char hash + `.js`
    if (basename.length !== name.length + 1 + 12 + 3) continue
    if (basename.startsWith(`${name}-`)) return name
  }
  return null
}

/** Measure an external script file, with a per-run cache. */
function measureExternal(
  distDir: string,
  src: string,
  cache: Map<string, { rawBytes: number; gzipBytes: number }>,
): { rawBytes: number; gzipBytes: number } {
  // `src` is a root-absolute URL path (`/islands/x.js`); resolve it
  // against the dist root.
  const filePath = join(distDir, src.replace(/^\//, ''))
  const cached = cache.get(filePath)
  if (cached) return cached
  let measured: { rawBytes: number; gzipBytes: number }
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const bytes = readFileSync(filePath)
    measured = { rawBytes: bytes.byteLength, gzipBytes: gzipSize(bytes) }
  } else {
    // Referenced-but-missing: record zero rather than crash. The
    // formatter flags it.
    measured = { rawBytes: 0, gzipBytes: 0 }
  }
  cache.set(filePath, measured)
  return measured
}

/**
 * Gzip a byte buffer and return the compressed size. Uses `node:zlib`
 * (not `Bun.gzipSync`) so the analyzer runs identically under Bun, a
 * Node host, and the vitest runtime — `analyze.ts` stays pure
 * node-stdlib with no runtime-global dependency.
 */
function gzipSize(bytes: Uint8Array): number {
  return gzipSync(bytes).byteLength
}

/**
 * Load + parse `view-manifest.json`. Returns `null` (not an error)
 * when the file is absent or malformed — analysis degrades to
 * sizes-only, which is still useful.
 */
function loadManifest(manifestPath: string | undefined): ManifestEntry[] | null {
  if (manifestPath === undefined) return null
  const resolved = resolve(manifestPath)
  if (!existsSync(resolved)) return null
  try {
    const parsed = JSON.parse(readFileSync(resolved, 'utf-8')) as {
      entries?: ManifestEntry[]
    }
    return Array.isArray(parsed.entries) ? parsed.entries : null
  } catch {
    return null
  }
}
