// @vitest-environment node

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { applyPatch, composeScaffold, mergePackageJson } from '../../src/scaffold.ts'

let workspace: string

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'place-compose-test-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

/**
 * Build a synthetic `templates/` tree at `<workspace>/templates/` and
 * return its path. Caller passes the layer contents as nested record
 * objects keyed by relative path → file contents (or `null` to make a
 * directory only).
 */
function makeTemplates(
  workspace: string,
  layers: {
    base?: Record<string, string>
    variants?: Record<string, Record<string, string>>
    features?: Record<string, Record<string, string>>
  },
): string {
  const root = join(workspace, 'templates')
  const writeAll = (dir: string, files: Record<string, string>): void => {
    for (const [rel, content] of Object.entries(files)) {
      const dest = join(dir, rel)
      mkdirSync(join(dest, '..'), { recursive: true })
      writeFileSync(dest, content)
    }
  }
  if (layers.base) writeAll(join(root, 'base'), layers.base)
  if (layers.variants) {
    for (const [name, files] of Object.entries(layers.variants)) {
      writeAll(join(root, 'variants', name), files)
    }
  }
  if (layers.features) {
    for (const [name, files] of Object.entries(layers.features)) {
      writeAll(join(root, 'features', name), files)
    }
  }
  return root
}

describe('composeScaffold — layer order', () => {
  test('base files land at target', async () => {
    const templatesRoot = makeTemplates(workspace, {
      base: {
        'package.json': '{ "name": "__APP_NAME__" }',
        'README.md': 'Hello __APP_NAME__',
      },
      variants: { minimal: {} },
    })
    const target = join(workspace, 'out')
    const result = await composeScaffold({
      templatesRoot,
      target,
      appName: 'my-app',
      variant: 'minimal',
      features: [],
    })
    expect(result.filesWritten).toContain('package.json')
    expect(result.filesWritten).toContain('README.md')
    expect(readFileSync(join(target, 'README.md'), 'utf8')).toBe('Hello my-app')
  })

  test('variant overrides base on plain files', async () => {
    const templatesRoot = makeTemplates(workspace, {
      base: { 'index.ts': 'base' },
      variants: { foo: { 'index.ts': 'variant' } },
    })
    const target = join(workspace, 'out')
    await composeScaffold({
      templatesRoot,
      target,
      appName: 'x',
      variant: 'foo',
      features: [],
    })
    expect(readFileSync(join(target, 'index.ts'), 'utf8')).toBe('variant')
  })

  test('feature overrides variant on plain files', async () => {
    const templatesRoot = makeTemplates(workspace, {
      base: { 'index.ts': 'base' },
      variants: { foo: { 'index.ts': 'variant' } },
      features: { extra: { 'index.ts': 'feature' } },
    })
    const target = join(workspace, 'out')
    await composeScaffold({
      templatesRoot,
      target,
      appName: 'x',
      variant: 'foo',
      features: ['extra'],
    })
    expect(readFileSync(join(target, 'index.ts'), 'utf8')).toBe('feature')
  })

  test('__APP_NAME__ substitution across all layers', async () => {
    const templatesRoot = makeTemplates(workspace, {
      base: { 'a.txt': 'base for __APP_NAME__' },
      variants: { foo: { 'b.txt': 'variant for __APP_NAME__' } },
      features: { extra: { 'c.txt': 'feature for __APP_NAME__' } },
    })
    const target = join(workspace, 'out')
    await composeScaffold({
      templatesRoot,
      target,
      appName: 'place',
      variant: 'foo',
      features: ['extra'],
    })
    expect(readFileSync(join(target, 'a.txt'), 'utf8')).toBe('base for place')
    expect(readFileSync(join(target, 'b.txt'), 'utf8')).toBe('variant for place')
    expect(readFileSync(join(target, 'c.txt'), 'utf8')).toBe('feature for place')
  })

  test('_dotfile is renamed to .dotfile on write', async () => {
    const templatesRoot = makeTemplates(workspace, {
      base: { _gitignore: 'node_modules/\n' },
      variants: { foo: {} },
    })
    const target = join(workspace, 'out')
    const result = await composeScaffold({
      templatesRoot,
      target,
      appName: 'x',
      variant: 'foo',
      features: [],
    })
    expect(result.filesWritten).toContain('.gitignore')
    expect(readFileSync(join(target, '.gitignore'), 'utf8')).toBe('node_modules/\n')
  })
})

describe('composeScaffold — package.json merge', () => {
  test('deps from feature layer merge into base', async () => {
    const templatesRoot = makeTemplates(workspace, {
      base: {
        'package.json': JSON.stringify({
          name: '__APP_NAME__',
          dependencies: { a: '^1.0.0' },
        }),
      },
      variants: { foo: {} },
      features: {
        extra: {
          'package.json': JSON.stringify({
            name: '__APP_NAME__',
            dependencies: { b: '^2.0.0' },
          }),
        },
      },
    })
    const target = join(workspace, 'out')
    await composeScaffold({
      templatesRoot,
      target,
      appName: 'x',
      variant: 'foo',
      features: ['extra'],
    })
    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    expect(pkg.dependencies).toEqual({ a: '^1.0.0', b: '^2.0.0' })
  })

  test('conflicting non-equal dep version throws', () => {
    const a = { dependencies: { foo: '^1.0.0' } } as Record<string, unknown>
    const b = { dependencies: { foo: '^2.0.0' } } as Record<string, unknown>
    expect(() => mergePackageJson(a, b, 'feature:extra')).toThrow(/merge conflict/)
  })

  test('equal dep version is fine (no throw)', () => {
    const a = { dependencies: { foo: '^1.0.0' } } as Record<string, unknown>
    const b = { dependencies: { foo: '^1.0.0' } } as Record<string, unknown>
    expect(() => mergePackageJson(a, b, 'feature:extra')).not.toThrow()
  })

  test('scripts merge from features', async () => {
    const templatesRoot = makeTemplates(workspace, {
      base: { 'package.json': JSON.stringify({ name: 'x', scripts: { dev: 'a' } }) },
      variants: { foo: {} },
      features: {
        extra: { 'package.json': JSON.stringify({ name: 'x', scripts: { test: 'b' } }) },
      },
    })
    const target = join(workspace, 'out')
    await composeScaffold({
      templatesRoot,
      target,
      appName: 'x',
      variant: 'foo',
      features: ['extra'],
    })
    const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
    expect(pkg.scripts).toEqual({ dev: 'a', test: 'b' })
  })
})

describe('applyPatch', () => {
  test('adds a line at a found context anchor', async () => {
    const target = join(workspace, 'file.txt')
    writeFileSync(target, 'line one\nline two\nline three\n')
    const patch = ` line one\n+inserted\n line two\n`
    // Note the unified-diff header would be `@@ … @@` — our applier
    // tolerates a bare `@@`. Compose it explicitly:
    await applyPatch(target, `@@\n${patch}`, 'feature:test')
    expect(readFileSync(target, 'utf8')).toBe('line one\ninserted\nline two\nline three\n')
  })

  test('removes a line', async () => {
    const target = join(workspace, 'file.txt')
    writeFileSync(target, 'a\nb\nc\n')
    await applyPatch(target, '@@\n a\n-b\n c\n', 'feature:test')
    expect(readFileSync(target, 'utf8')).toBe('a\nc\n')
  })

  test('uses removal as anchor when no leading context', async () => {
    const target = join(workspace, 'file.txt')
    writeFileSync(target, 'keep\nremove\n')
    await applyPatch(target, '@@\n-remove\n+replaced\n', 'feature:test')
    expect(readFileSync(target, 'utf8')).toBe('keep\nreplaced\n')
  })

  test('throws on context mismatch', async () => {
    const target = join(workspace, 'file.txt')
    writeFileSync(target, 'a\nb\nc\n')
    await expect(applyPatch(target, '@@\n zzz\n+new\n', 'feature:test')).rejects.toThrow(
      /context not found/,
    )
  })

  test('throws if target file does not exist', async () => {
    const target = join(workspace, 'missing.txt')
    await expect(applyPatch(target, '@@\n a\n+b\n', 'feature:test')).rejects.toThrow(
      /no earlier layer wrote/,
    )
  })

  test('handles blank context lines', async () => {
    const target = join(workspace, 'file.txt')
    writeFileSync(target, 'one\n\ntwo\n')
    await applyPatch(target, '@@\n one\n\n+inserted\n two\n', 'feature:test')
    expect(readFileSync(target, 'utf8')).toBe('one\n\ninserted\ntwo\n')
  })
})
