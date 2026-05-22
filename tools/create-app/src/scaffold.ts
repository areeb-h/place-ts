// Template composition — the heart of `bunx @place-ts/create-app`.
//
// Today's templates are organized as overlapping layers:
//
//   templates/
//     base/                # shared by every scaffold
//     variants/<name>/     # one of: minimal | content | app
//     features/<name>/     # composable opt-ins (theme-toggle, tests, ci, …)
//
// `composeScaffold` walks them in order (base → variant → each feature)
// and writes the union into `target/`. Conflicting files use last-wins
// semantics EXCEPT for two special cases:
//
//   1. `package.json` — JSON-merged. Each layer contributes
//      `dependencies` / `devDependencies` / `scripts` keys; we deep-
//      merge leaf objects and reject silent overwrites of a non-equal
//      string value (would silently downgrade a dep).
//
//   2. `__patches__/<rel-path>.patch` files inside a feature — applied
//      as unified-diff patches to files written by an earlier layer.
//      Used when a feature needs to amend (not replace) another
//      layer's file — e.g. theme-toggle adds `dark: {…}` tokens to
//      base's `src/theme.ts`. The patch applier checks context lines
//      strictly; a mismatch means the base file changed shape and the
//      feature needs updating.
//
// Inline templates (not degit-style fetch) keep the scaffolder
// hermetic + offline-capable. Layering keeps the on-disk content
// duplication-free.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

export interface ComposeRequest {
  /** Absolute path to the scaffolder's `templates/` directory. */
  templatesRoot: string
  /** Absolute target directory. Created if missing. */
  target: string
  /** Substituted everywhere `__APP_NAME__` appears in template files. */
  appName: string
  /** One of the variant names — `minimal | content | app`. */
  variant: string
  /** Feature names to layer on, in order. */
  features: readonly string[]
}

export interface ComposeResult {
  /** Relative paths (from `target`) of every file written, in order. */
  filesWritten: string[]
  /** Relative paths of patches applied. */
  patchesApplied: string[]
}

/**
 * Compose a scaffold by layering `base/` + `variants/<variant>/` + each
 * `features/<name>/`. Final layers see and may amend earlier layers'
 * files (via `__patches__/`). Always writes — caller is responsible for
 * detecting collisions with the user's existing files (see
 * `enumerateTemplateOutputs` below for the dry-run list).
 */
export async function composeScaffold(req: ComposeRequest): Promise<ComposeResult> {
  const layers = resolveLayers(req)
  await mkdir(req.target, { recursive: true })

  const result: ComposeResult = { filesWritten: [], patchesApplied: [] }
  // `pkg` accumulates package.json across all layers; written once at
  // the end so we don't read+write+read repeatedly.
  let pkg: Record<string, unknown> | null = null

  for (const layer of layers) {
    if (!existsSync(layer.dir)) continue
    for (const file of walkFiles(layer.dir)) {
      const rel = relative(layer.dir, file)
      // Patches live in `__patches__/<original-rel-path>.patch` inside
      // a feature dir. They never produce output files of their own.
      if (rel.startsWith(`__patches__${sep()}`) || rel.startsWith('__patches__/')) {
        const targetRel = rel.replace(/^__patches__[/\\]/, '').replace(/\.patch$/, '')
        const targetAbs = join(req.target, targetRel)
        const patchText = await readFile(file, 'utf8')
        await applyPatch(targetAbs, patchText, layer.name)
        result.patchesApplied.push(targetRel)
        continue
      }
      // package.json is JSON-merged across layers.
      const renamed = renameDotfile(rel)
      if (renamed === 'package.json') {
        const text = (await readFile(file, 'utf8')).replaceAll('__APP_NAME__', req.appName)
        const obj = JSON.parse(text) as Record<string, unknown>
        pkg = pkg === null ? obj : mergePackageJson(pkg, obj, layer.name)
        if (!result.filesWritten.includes('package.json')) {
          result.filesWritten.push('package.json')
        }
        continue
      }
      // Plain file copy. Last layer wins on collision.
      const destAbs = join(req.target, renamed)
      await mkdir(dirname(destAbs), { recursive: true })
      const raw = await readFile(file, 'utf8').catch(() => null)
      if (raw !== null) {
        await writeFile(destAbs, raw.replaceAll('__APP_NAME__', req.appName))
      } else {
        // Binary file — copy raw bytes.
        const buf = await readFile(file)
        await writeFile(destAbs, buf)
      }
      if (!result.filesWritten.includes(renamed)) result.filesWritten.push(renamed)
    }
  }

  if (pkg !== null) {
    const out = `${JSON.stringify(pkg, null, 2)}\n`
    await writeFile(join(req.target, 'package.json'), out)
  }

  return result
}

/**
 * Dry-run: walk every layer and report the destination paths that
 * WOULD be written. Used by the `.`-into-current-directory mode to
 * detect collisions with the user's existing files before scaffolding.
 * Returns paths relative to the target.
 */
export function enumerateTemplateOutputs(req: ComposeRequest): string[] {
  const layers = resolveLayers(req)
  const seen = new Set<string>()
  for (const layer of layers) {
    if (!existsSync(layer.dir)) continue
    for (const file of walkFiles(layer.dir)) {
      const rel = relative(layer.dir, file)
      // Patches produce no new outputs — skip.
      if (rel.startsWith('__patches__/') || rel.startsWith(`__patches__${sep()}`)) continue
      seen.add(renameDotfile(rel))
    }
  }
  return [...seen].sort()
}

interface Layer {
  name: string
  dir: string
}

function resolveLayers(req: ComposeRequest): Layer[] {
  const layers: Layer[] = [
    { name: 'base', dir: join(req.templatesRoot, 'base') },
    { name: `variant:${req.variant}`, dir: join(req.templatesRoot, 'variants', req.variant) },
  ]
  for (const f of req.features) {
    layers.push({ name: `feature:${f}`, dir: join(req.templatesRoot, 'features', f) })
  }
  return layers
}

function sep(): string {
  return process.platform === 'win32' ? '\\' : '/'
}

function walkFiles(root: string): string[] {
  const out: string[] = []
  const visit = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const abs = join(dir, e.name)
      if (e.isDirectory()) {
        visit(abs)
      } else if (e.isFile()) {
        const stat = statSync(abs)
        if (stat.size > 5_000_000) continue // sanity cap on template files
        out.push(abs)
      }
    }
  }
  visit(root)
  return out
}

// npm pack drops files starting with `.` (npm convention) — templates
// that need a dotfile (e.g. `.gitignore`, `.github/`) store it under a
// `_` prefix on every path segment that needs renaming.
function renameDotfile(rel: string): string {
  return rel
    .split(/[/\\]/)
    .map((seg) => (seg.startsWith('_') ? `.${seg.slice(1)}` : seg))
    .join('/')
}

/**
 * Merge `incoming` into `base`. Deep-merge `dependencies`,
 * `devDependencies`, `peerDependencies`, `scripts` (object-valued); for
 * every other top-level key, last-write-wins. Throws if two layers
 * declare the same key (e.g. same script name) with conflicting non-
 * equal string values — the feature author needs to pick one.
 *
 * Layer-name strings (`'base'`, `'variant:foo'`, `'feature:bar'`) are
 * threaded through so the error message names the culprit.
 */
export function mergePackageJson(
  base: Record<string, unknown>,
  incoming: Record<string, unknown>,
  incomingLayer: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  const objKeys = new Set(['dependencies', 'devDependencies', 'peerDependencies', 'scripts'])
  for (const [k, v] of Object.entries(incoming)) {
    if (objKeys.has(k) && isPlainObject(v)) {
      const baseSub = isPlainObject(out[k]) ? (out[k] as Record<string, string>) : {}
      const merged: Record<string, string> = { ...baseSub }
      for (const [subK, subV] of Object.entries(v as Record<string, string>)) {
        const existing = merged[subK]
        if (existing !== undefined && existing !== subV) {
          throw new Error(
            `merge conflict in package.json[${k}][${subK}]: ` +
              `'${existing}' (prior layer) vs '${subV}' (${incomingLayer}). ` +
              `Two layers declare the same key with different values; pick one.`,
          )
        }
        merged[subK] = subV
      }
      out[k] = merged
    } else {
      out[k] = v
    }
  }
  return out
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Apply a unified-diff patch to the file at `targetAbs`. Supports only
 * the minimal subset we need:
 *
 *   - Optional `--- a/file` / `+++ b/file` header lines (ignored;
 *     informational).
 *   - `@@ -ls,lc +rs,rc @@` hunk headers — used to locate but the
 *     applier matches by context lines, not line numbers, so off-by-
 *     one hunk headers are tolerated.
 *   - ` ` context lines (must match the target file exactly).
 *   - `-` removed lines (must match the target file exactly).
 *   - `+` added lines.
 *
 * Refuses silently-fuzzy matching — if context lines don't match the
 * target file's content, we throw with a clear pointer to the layer
 * that owns the patch. This protects against the "feature was
 * authored against an old base" footgun.
 */
export async function applyPatch(
  targetAbs: string,
  patchText: string,
  layerName: string,
): Promise<void> {
  if (!existsSync(targetAbs)) {
    throw new Error(
      `${layerName} patch targets '${targetAbs}' but no earlier layer wrote that file. ` +
        `Either an earlier layer should provide the file, or this patch is misplaced.`,
    )
  }
  const original = await readFile(targetAbs, 'utf8')
  const patched = applyUnifiedDiff(original, patchText, layerName, targetAbs)
  await writeFile(targetAbs, patched)
}

function applyUnifiedDiff(
  original: string,
  patchText: string,
  layerName: string,
  targetPath: string,
): string {
  // Normalize line endings before split. Windows users with
  // `core.autocrlf=true` get template source files with CRLF — the
  // patch text in the repo is LF. Without normalization, every patch
  // hunk's context match fails because origLines end in `\r` while
  // the patch context lines don't. Output reuses the original's
  // detected ending so users on Windows still get CRLF on disk.
  const usedCrlf = original.includes('\r\n')
  const normOriginal = usedCrlf ? original.replace(/\r\n/g, '\n') : original
  const normPatch = patchText.includes('\r\n') ? patchText.replace(/\r\n/g, '\n') : patchText

  const origLines = normOriginal.split('\n')
  // Drop the trailing empty entry from `patchText.split('\n')` when
  // the patch ends with `\n`. Otherwise it would be treated as a
  // blank context line and over-eagerly match the next source line.
  const rawPatchLines = normPatch.split('\n')
  const patchLines =
    rawPatchLines.length > 0 && rawPatchLines[rawPatchLines.length - 1] === ''
      ? rawPatchLines.slice(0, -1)
      : rawPatchLines

  // Parse into hunks. Skip headers + blank lines outside hunks.
  interface Hunk {
    lines: string[] // each starts with ' ', '-', or '+'
  }
  const hunks: Hunk[] = []
  let current: Hunk | null = null
  for (const raw of patchLines) {
    if (raw.startsWith('@@')) {
      if (current) hunks.push(current)
      current = { lines: [] }
      continue
    }
    if (current === null) continue
    if (raw.startsWith('---') || raw.startsWith('+++')) continue
    if (raw.length === 0) {
      // A fully blank line inside a hunk represents an empty CONTEXT
      // line (matching an empty line in the source file). Encode it as
      // ' ' so downstream handling treats it uniformly.
      current.lines.push(' ')
      continue
    }
    if (raw[0] === ' ' || raw[0] === '-' || raw[0] === '+') current.lines.push(raw)
  }
  if (current) hunks.push(current)

  if (hunks.length === 0) {
    throw new Error(
      `${layerName} patch for ${targetPath} contains no hunks (missing '@@' header?).`,
    )
  }

  // Apply each hunk by locating its leading anchor in `origLines`.
  // The anchor is the leading sequence of non-add lines (' ' context
  // OR '-' removal) — collectively they must match the target file
  // verbatim. We rebuild a new line array as we go; hunks are applied
  // in order and never re-process already-emitted lines.
  let cursor = 0
  const out: string[] = []
  for (const hunk of hunks) {
    const headAnchor = leadingAnchor(hunk)
    if (headAnchor.length === 0) {
      throw new Error(
        `${layerName} patch hunk for ${targetPath} has no leading anchor — every hunk needs ` +
          `at least one context (' ') or removal ('-') line before any '+' to locate the change.`,
      )
    }
    const found = findContext(origLines, cursor, headAnchor)
    if (found < 0) {
      throw new Error(
        `${layerName} patch context not found in ${targetPath}. ` +
          `The base file may have changed shape since this patch was written. ` +
          `Expected to find:\n${headAnchor.map((l) => `  ${l}`).join('\n')}`,
      )
    }
    // Emit everything between the cursor and the match.
    while (cursor < found) {
      out.push(origLines[cursor] as string)
      cursor++
    }
    // Walk the hunk: ' ' and '-' consume from origLines; ' ' and '+' emit.
    for (const line of hunk.lines) {
      const body = line.slice(1)
      const kind = line[0]
      if (kind === ' ') {
        if (origLines[cursor] !== body) {
          throw new Error(
            `${layerName} patch context drift at ${targetPath} line ${cursor + 1}: ` +
              `expected '${body}' but found '${origLines[cursor] ?? '<EOF>'}'.`,
          )
        }
        out.push(body)
        cursor++
      } else if (kind === '-') {
        if (origLines[cursor] !== body) {
          throw new Error(
            `${layerName} patch removal mismatch at ${targetPath} line ${cursor + 1}: ` +
              `expected to remove '${body}' but found '${origLines[cursor] ?? '<EOF>'}'.`,
          )
        }
        cursor++ // skip the original line — don't emit it
      } else if (kind === '+') {
        out.push(body)
      }
    }
  }
  // Tail of unchanged content.
  while (cursor < origLines.length) {
    out.push(origLines[cursor] as string)
    cursor++
  }
  // Restore the original's line-ending convention if we normalized
  // away from CRLF above.
  return usedCrlf ? out.join('\r\n') : out.join('\n')
}

// The "leading anchor" is the leading run of non-add lines — context
// (' ') or removal ('-'). Both must match the target file verbatim,
// in order. Plus-lines ('+') are inserts and never part of the anchor.
function leadingAnchor(hunk: { lines: string[] }): string[] {
  const anchor: string[] = []
  for (const line of hunk.lines) {
    if (line[0] === ' ' || line[0] === '-') anchor.push(line.slice(1))
    else break
  }
  return anchor
}

function findContext(origLines: string[], from: number, context: string[]): number {
  outer: for (let i = from; i <= origLines.length - context.length; i++) {
    for (let j = 0; j < context.length; j++) {
      if (origLines[i + j] !== context[j]) continue outer
    }
    return i
  }
  return -1
}
