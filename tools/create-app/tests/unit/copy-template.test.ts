// @vitest-environment node
//
// Template-variant integration test. Scaffolds each (variant × default-
// features) combination into a tmpdir and asserts the result is
// internally consistent: package.json parses, key files exist, every
// patched file remains valid TS shape (best-effort — full typecheck
// happens in `bun run typecheck` on the smoke scaffold).
//
// The legacy `copyTemplate` unit (file-by-file substitution + recursion)
// is now exercised end-to-end via `composeScaffold` against the real
// template tree. The lower-level invariants live in compose.test.ts.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { DEFAULT_FEATURES, VARIANTS, type Variant } from '../../src/args.ts'
import { composeScaffold } from '../../src/scaffold.ts'

const here = dirname(fileURLToPath(import.meta.url))
const templatesRoot = resolve(here, '..', '..', 'templates')

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'place-template-test-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

describe('template variants — every combo composes cleanly', () => {
  for (const v of VARIANTS) {
    test(`variant '${v}' with its default features`, async () => {
      const target = join(workspace, v)
      const result = await composeScaffold({
        templatesRoot,
        target,
        appName: 'test-app',
        variant: v,
        features: [...DEFAULT_FEATURES[v as Variant]],
      })
      // Sanity: at least package.json + src/app.ts exist.
      expect(result.filesWritten).toContain('package.json')
      expect(existsSync(join(target, 'src', 'app.ts'))).toBe(true)
      // Parse package.json — every layer's contribution must produce
      // valid JSON.
      const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
      expect(pkg.name).toBe('test-app')
      expect(pkg.dependencies).toBeTruthy()
      expect(pkg.dependencies['@place-ts/component']).toBeTruthy()
      // The component dep range must be a non-empty string.
      expect(typeof pkg.dependencies['@place-ts/component']).toBe('string')
      // .gitignore must land (it's a base dotfile that's renamed from _gitignore).
      expect(existsSync(join(target, '.gitignore'))).toBe(true)
    })
  }
})

describe('content variant — posts files exist', () => {
  test('home + slug pages, posts collection', async () => {
    const target = join(workspace, 'content')
    await composeScaffold({
      templatesRoot,
      target,
      appName: 'blog',
      variant: 'content',
      features: [...DEFAULT_FEATURES.content],
    })
    expect(existsSync(join(target, 'src', 'pages', 'home.page.tsx'))).toBe(true)
    expect(existsSync(join(target, 'src', 'pages', 'posts', '[slug].page.tsx'))).toBe(true)
    expect(existsSync(join(target, 'src', 'posts.ts'))).toBe(true)
    expect(existsSync(join(target, 'src', 'islands', 'search-palette.tsx'))).toBe(true)
    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    expect(pkg.dependencies['@place-ts/data']).toBeTruthy()
    expect(pkg.dependencies['@place-ts/search']).toBeTruthy()
  })
})

describe('app variant — dashboard + islands exist', () => {
  test('dashboard page + counter + preferences islands', async () => {
    const target = join(workspace, 'app')
    await composeScaffold({
      templatesRoot,
      target,
      appName: 'saas',
      variant: 'app',
      features: [...DEFAULT_FEATURES.app],
    })
    expect(existsSync(join(target, 'src', 'pages', 'dashboard.page.tsx'))).toBe(true)
    expect(existsSync(join(target, 'src', 'islands', 'counter.tsx'))).toBe(true)
    expect(existsSync(join(target, 'src', 'islands', 'preferences.tsx'))).toBe(true)
    expect(existsSync(join(target, 'src', 'state', 'preferences.ts'))).toBe(true) // from persistence feature
    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    expect(pkg.dependencies['@place-ts/persistence']).toBeTruthy()
    expect(pkg.dependencies['@place-ts/design']).toBeTruthy()
  })
})

describe('theme-toggle feature — light tokens patched + island shipped', () => {
  test('theme.ts gains light mode + island file exists', async () => {
    const target = join(workspace, 'mt')
    await composeScaffold({
      templatesRoot,
      target,
      appName: 'x',
      variant: 'minimal',
      features: ['theme-toggle'],
    })
    expect(existsSync(join(target, 'src', 'islands', 'theme-toggle.tsx'))).toBe(true)
    const theme = readFileSync(join(target, 'src', 'theme.ts'), 'utf8')
    expect(theme).toMatch(/light:\s*\{/)
    const layout = readFileSync(join(target, 'src', 'layouts', 'main.layout.tsx'), 'utf8')
    expect(layout).toContain('<ThemeToggle />')
    expect(layout).toContain('import ThemeToggle')
  })
})

describe('tests feature — vitest config + sample test', () => {
  test('opt-in test feature lands its files', async () => {
    const target = join(workspace, 'with-tests')
    await composeScaffold({
      templatesRoot,
      target,
      appName: 'x',
      variant: 'minimal',
      features: ['tests'],
    })
    expect(existsSync(join(target, 'vitest.config.ts'))).toBe(true)
    expect(existsSync(join(target, 'src', 'smoke.test.ts'))).toBe(true)
    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    expect(pkg.scripts.test).toMatch(/vitest/)
    expect(pkg.devDependencies.vitest).toBeTruthy()
  })
})

describe('ci feature — GitHub Actions workflow', () => {
  test('renames _github → .github', async () => {
    const target = join(workspace, 'with-ci')
    await composeScaffold({
      templatesRoot,
      target,
      appName: 'x',
      variant: 'minimal',
      features: ['ci'],
    })
    expect(existsSync(join(target, '.github', 'workflows', 'ci.yml'))).toBe(true)
  })
})
