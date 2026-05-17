// @vitest-environment node

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { copyTemplate } from '../../src/cli.ts'

describe('copyTemplate — recursive copy + name substitution', () => {
  let templateDir: string
  let targetDir: string

  beforeEach(() => {
    templateDir = mkdtempSync(join(tmpdir(), 'place-tpl-'))
    targetDir = mkdtempSync(join(tmpdir(), 'place-out-'))
  })

  afterEach(() => {
    rmSync(templateDir, { recursive: true, force: true })
    rmSync(targetDir, { recursive: true, force: true })
  })

  test('substitutes __APP_NAME__ in file contents', async () => {
    writeFileSync(join(templateDir, 'package.json'), JSON.stringify({ name: '__APP_NAME__' }))
    await copyTemplate(templateDir, targetDir, 'my-app')
    const result = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'))
    expect(result.name).toBe('my-app')
  })

  test('substitutes every occurrence (replaceAll)', async () => {
    writeFileSync(join(templateDir, 'README.md'), '__APP_NAME__ is great. Welcome to __APP_NAME__.')
    await copyTemplate(templateDir, targetDir, 'fooApp')
    const out = readFileSync(join(targetDir, 'README.md'), 'utf-8')
    expect(out).toBe('fooApp is great. Welcome to fooApp.')
  })

  test('recursively copies nested directories', async () => {
    await mkdir(join(templateDir, 'src', 'pages'), { recursive: true })
    writeFileSync(join(templateDir, 'src', 'server.tsx'), 'export {}\n')
    writeFileSync(
      join(templateDir, 'src', 'pages', 'home.tsx'),
      'export const home = "__APP_NAME__"\n',
    )
    await copyTemplate(templateDir, targetDir, 'foo')
    const home = readFileSync(join(targetDir, 'src', 'pages', 'home.tsx'), 'utf-8')
    expect(home).toContain('"foo"')
    expect(readdirSync(join(targetDir, 'src')).sort()).toEqual(['pages', 'server.tsx'])
  })

  test('files without __APP_NAME__ pass through unchanged', async () => {
    writeFileSync(join(templateDir, 'plain.txt'), 'no substitution here')
    await copyTemplate(templateDir, targetDir, 'foo')
    expect(readFileSync(join(targetDir, 'plain.txt'), 'utf-8')).toBe('no substitution here')
  })
})
