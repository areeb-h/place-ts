// Discover page modules under a directory — server-only helper.
//
// **The framework's stance on file-system routing** (ADR 0003): we
// don't derive ROUTE PATHS from file paths. Every page declares its
// path explicitly via `page('/path', def)` — refactor-safe, no
// hidden conventions, no codegen.
//
// **What `discoverPages` does** (and doesn't do):
//
//   ✓ Walks a directory and dynamic-imports every `*.page.tsx`,
//     `*.page.ts`, and any sub-`index.ts`/`index.tsx` file.
//   ✓ Returns the collected `Page` values (or arrays from
//     `routes('/prefix', [...])`) as a flat list.
//   ✗ Does NOT derive paths from file names. Each module's default
//     export still declares its own path via `page(path, def)`.
//
// **Why this isn't file-based routing**:
//
//   - The route key is determined by `page.path`, not by the file
//     location. Moving `pages/foo.page.tsx` → `pages/bar.page.tsx`
//     changes nothing about the route.
//   - You compose URL hierarchies via the existing `routes('/api',
//     [...])` helper, not via folder names. `pages/api/index.ts`
//     calls `routes('/api', [page1, page2])` — the helper does the
//     prefix join; the framework just collects what `index.ts`
//     re-exports.
//
// **Usage** (top-level await — Bun supports it natively):
//
//   import { app, discoverPages } from '@place/component'
//
//   export default app({
//     pages: await discoverPages('./src/pages'),
//     layout: docsLayout,
//     theme,
//   }).run()
//
// Apps that want to mix discovered + hand-listed pages just spread:
//
//   pages: [...await discoverPages('./src/pages'), legacyPage]

import type { AnyPage } from '../index.ts'

const PAGE_EXTENSIONS = ['.page.tsx', '.page.ts', '.page.jsx', '.page.js']
const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx']

/**
 * Walk `dir` and import every `*.page.{tsx,ts,jsx,js}` file plus any
 * subdirectory's `index.{ts,tsx,js,jsx}` file. Default exports are
 * collected — single pages (with a `.path` field) are pushed, arrays
 * (from `routes('/prefix', [...])`) are spread.
 *
 * Files / dirs prefixed with `_` are skipped — the "private" convention
 * shared with `discoverIslands`.
 *
 * Throws on duplicate paths after the full discovery completes, with
 * a list of offenders.
 *
 * @provisional — shipped in Tier 13 (ADR 0039). The directory-walk
 * rules (top-level files + one level of `index.ts`) may evolve to
 * support deeper convention-based composition; the stability
 * covenant doesn't yet pin this surface.
 */
export async function discoverPages(dir: string): Promise<readonly AnyPage[]> {
  const { readdir } = await import('node:fs/promises')
  const { existsSync } = await import('node:fs')
  const { resolve } = await import('node:path')

  const absDir = resolve(process.cwd(), dir)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(absDir, { withFileTypes: true })
  } catch (e) {
    throw new Error(
      `discoverPages: failed to read directory '${absDir}': ${
        e instanceof Error ? e.message : String(e)
      }. Pass an existing path via discoverPages('./src/pages').`,
    )
  }

  const pages: AnyPage[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('_')) continue

    const fullPath = resolve(absDir, entry.name)

    if (entry.isDirectory()) {
      // Look for an index file inside the subdirectory.
      let indexPath: string | null = null
      for (const idx of INDEX_FILES) {
        const candidate = resolve(fullPath, idx)
        if (existsSync(candidate)) {
          indexPath = candidate
          break
        }
      }
      if (indexPath) {
        const mod = (await import(indexPath)) as { default?: unknown }
        collectPagesInto(mod.default, pages)
      }
      // No recursion past index — the subdirectory's index.ts is
      // expected to call `routes('/prefix', [...])` to compose its
      // own pages. This preserves URL-hierarchy authoring control.
      continue
    }

    if (PAGE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      const mod = (await import(fullPath)) as { default?: unknown }
      collectPagesInto(mod.default, pages)
    }
  }

  // Validate: no duplicate paths. Surface ALL offenders in one
  // error so the user fixes them in one pass.
  const seen = new Map<string, number>()
  const duplicates: Array<{ path: string; count: number }> = []
  for (const p of pages) {
    if (typeof p?.path !== 'string') continue
    const prev = seen.get(p.path) ?? 0
    seen.set(p.path, prev + 1)
    if (prev === 1) duplicates.push({ path: p.path, count: 2 })
    else if (prev > 1) {
      const dup = duplicates.find((d) => d.path === p.path)
      if (dup) dup.count = prev + 1
    }
  }
  if (duplicates.length > 0) {
    throw new Error(
      `discoverPages: duplicate route paths after discovery:\n${duplicates
        .map((d) => `  '${d.path}' (×${d.count})`)
        .join('\n')}\nEach page must declare a unique \`path\`.`,
    )
  }

  return pages
}

/**
 * Push a single page or spread an array of pages into the output
 * list. Anything else (undefined / unknown shape) is silently
 * skipped so module-level non-page exports don't fail discovery.
 */
function collectPagesInto(val: unknown, out: AnyPage[]): void {
  if (!val) return
  if (Array.isArray(val)) {
    for (const v of val) collectPagesInto(v, out)
    return
  }
  if (typeof val === 'object' && 'path' in (val as object)) {
    out.push(val as AnyPage)
  }
}
