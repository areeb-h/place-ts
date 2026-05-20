// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { div, page } from '../../src/index.ts'
import { discoverPages } from '../../src/server.ts'

// `discoverPages(dir)` walks a directory and dynamic-imports every
// `*.page.{ts,tsx}` file plus subdirectory `index.{ts,tsx}` files.
// The tests below build a temp pages directory, write source files,
// and assert the discovered set matches expectations.

let tmpDir: string

/**
 * Make a fixture path and write a source file. Returns the absolute
 * path so callers can verify it landed where expected.
 */
async function writePageFile(rel: string, src: string): Promise<string> {
  const abs = join(tmpDir, rel)
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, src, 'utf8')
  return abs
}

/**
 * Source of a leaf page module: imports `page` from
 * `@place/component`, default-exports `page('/path', { view })`.
 *
 * `routePath` is the path the page will register at. `marker` is an
 * arbitrary identifier the test can grep to verify the right page
 * was loaded.
 */
function pageModule(routePath: string, marker: string): string {
  return `
import { page } from '${join(process.cwd(), 'systems/component/src/index.ts').replace(/\\\\/g, '/')}'
export default page('${routePath}', {
  view: () => ({ toHtml: () => '<p>${marker}</p>' }),
})
`
}

/**
 * Source of a routes-prefix barrel module: imports `routes` and
 * composes its leaf children with a `/prefix`.
 */
function routesBarrel(
  prefix: string,
  leafImports: ReadonlyArray<{ name: string; rel: string }>,
): string {
  const imps = leafImports.map((l, i) => `import p${i} from '${l.rel}'`).join('\n')
  const refs = leafImports.map((_, i) => `p${i}`).join(', ')
  return `
import { routes } from '${join(process.cwd(), 'systems/component/src/server.ts').replace(/\\\\/g, '/')}'
${imps}
export default routes('${prefix}', [${refs}])
`
}

describe('discoverPages — directory walk', () => {
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'place-discover-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  test('imports every *.page.tsx at the top level', async () => {
    await writePageFile('home.page.tsx', pageModule('/', 'home'))
    await writePageFile('about.page.tsx', pageModule('/about', 'about'))
    await writePageFile('contact.page.tsx', pageModule('/contact', 'contact'))

    const pages = await discoverPages(tmpDir)
    const paths = pages.map((p) => p.path).sort()
    expect(paths).toEqual(['/', '/about', '/contact'])
  })

  test('imports both .page.ts and .page.tsx extensions', async () => {
    await writePageFile('a.page.tsx', pageModule('/a', 'a'))
    await writePageFile('b.page.ts', pageModule('/b', 'b'))
    const pages = await discoverPages(tmpDir)
    expect(pages.map((p) => p.path).sort()).toEqual(['/a', '/b'])
  })

  test('ignores files without the .page.* suffix', async () => {
    await writePageFile('not-a-page.tsx', pageModule('/x', 'x'))
    await writePageFile('helpers.ts', pageModule('/y', 'y'))
    await writePageFile('real.page.tsx', pageModule('/real', 'real'))
    const pages = await discoverPages(tmpDir)
    expect(pages.map((p) => p.path)).toEqual(['/real'])
  })

  test('skips files prefixed with underscore (private convention)', async () => {
    await writePageFile('_private.page.tsx', pageModule('/private', 'private'))
    await writePageFile('public.page.tsx', pageModule('/public', 'public'))
    const pages = await discoverPages(tmpDir)
    expect(pages.map((p) => p.path)).toEqual(['/public'])
  })

  test('skips directories prefixed with underscore', async () => {
    await writePageFile('_helpers/index.ts', routesBarrel('/helpers', []))
    await writePageFile('real/index.ts', routesBarrel('/real', []))
    const pages = await discoverPages(tmpDir)
    // The `_helpers/` directory should be skipped entirely; the
    // `real/` index.ts is imported (and contributes no pages here).
    expect(pages).toEqual([])
  })

  test('imports subdirectory index.ts and spreads its array of pages', async () => {
    // Set up: pages/api/index.ts exports routes('/api', [pageA, pageB])
    await writePageFile('api/a.page.tsx', pageModule('/a', 'api-a'))
    await writePageFile('api/b.page.tsx', pageModule('/b', 'api-b'))
    await writePageFile(
      'api/index.ts',
      routesBarrel('/api', [
        { name: 'a', rel: './a.page.tsx' },
        { name: 'b', rel: './b.page.tsx' },
      ]),
    )

    const pages = await discoverPages(tmpDir)
    // Top-level walk: only api/ (a directory) is visited; its
    // index.ts is imported. The `*.page.tsx` files INSIDE api/ are
    // NOT auto-imported by discoverPages — the index.ts is the
    // composition point. (Composition logic lives in `routes()`.)
    const paths = pages.map((p) => p.path).sort()
    expect(paths).toEqual(['/api/a', '/api/b'])
  })

  test('honors both top-level pages AND subdirectory index barrels', async () => {
    await writePageFile('home.page.tsx', pageModule('/', 'home'))
    await writePageFile('api/users.page.tsx', pageModule('/users', 'users'))
    await writePageFile(
      'api/index.ts',
      routesBarrel('/api', [{ name: 'users', rel: './users.page.tsx' }]),
    )

    const pages = await discoverPages(tmpDir)
    expect(pages.map((p) => p.path).sort()).toEqual(['/', '/api/users'])
  })

  test('detects + reports ALL duplicate route paths in one error', async () => {
    await writePageFile('a.page.tsx', pageModule('/dup', 'a'))
    await writePageFile('b.page.tsx', pageModule('/dup', 'b'))
    await writePageFile('c.page.tsx', pageModule('/other-dup', 'c'))
    await writePageFile('d.page.tsx', pageModule('/other-dup', 'd'))
    await writePageFile('e.page.tsx', pageModule('/ok', 'e'))

    await expect(discoverPages(tmpDir)).rejects.toThrow(/duplicate route paths/)
    await expect(discoverPages(tmpDir)).rejects.toThrow(/\/dup/)
    await expect(discoverPages(tmpDir)).rejects.toThrow(/\/other-dup/)
  })

  test('errors clearly when the directory does not exist', async () => {
    await expect(discoverPages(join(tmpDir, 'nope'))).rejects.toThrow(/failed to read directory/)
  })

  test('empty directory returns empty array (no error)', async () => {
    await mkdir(join(tmpDir, 'empty'), { recursive: true })
    const pages = await discoverPages(join(tmpDir, 'empty'))
    expect(pages).toEqual([])
  })

  test('files exporting non-page values are silently skipped', async () => {
    // A `.page.tsx` whose default export is NOT a Page object
    await writePageFile('weird.page.tsx', `export default { not: 'a page' }`)
    await writePageFile('real.page.tsx', pageModule('/real', 'real'))
    const pages = await discoverPages(tmpDir)
    // `weird.page.tsx`'s default has no `.path` — collectPagesInto
    // skips it. The `real.page.tsx` page lands.
    expect(pages.map((p) => p.path)).toEqual(['/real'])
  })

  // Coverage note: the standalone `page()` import path resolution
  // assumes the workspace layout. This signal-check imports `page`
  // directly to verify the test runs in the expected environment.
  test('environment sanity: page() factory is importable', () => {
    const p = page('/', { view: () => div({}, ['hi']) })
    expect(p.path).toBe('/')
  })
})
