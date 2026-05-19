// Tests for the `place` diagnostics CLI.
//
// Builds a synthetic static export in a temp directory — a static
// route and an interactive route — and exercises the analyzer, the
// formatters, and the CLI dispatch against it. No real build runs;
// the fixture IS the contract `place` reads.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import { analyzeDist, DistNotFoundError, matchIslandName, parseScripts } from '../src/analyze.ts'
import { parseArgs } from '../src/args.ts'
import { main } from '../src/cli.ts'
import { fmtBytes, formatExplainAll, formatExplainRoute, formatWhyJsRoute } from '../src/format.ts'

// ===== fixture =====

let distDir: string
let manifestPath: string

// 12-char content hashes (island bundles are `<name>-<12 chars>.js`).
const COUNTER_JS = '/islands/counter-AbCd12Ef34Gh.js'
const TOGGLE_JS = '/islands/theme-toggle-Hash12345678.js'
const CHUNK_JS = '/islands/chunk-shared0001.js'

const islandBody = (n: string): string => `export const ${n} = () => {};\n`.repeat(40)

beforeAll(() => {
  distDir = mkdtempSync(join(tmpdir(), 'place-cli-'))

  // Static route — one inline early-theme script, no island JS.
  writeFileSync(
    join(distDir, 'index.html'),
    '<!doctype html><html><head>' +
      "<script>document.documentElement.dataset.placeTheme='dark'</script>" +
      '</head><body><h1>home</h1></body></html>',
  )

  // Interactive route — inline + a JSON data script (excluded) + two
  // island bundles + one shared chunk.
  mkdirSync(join(distDir, 'api', 'components'), { recursive: true })
  writeFileSync(
    join(distDir, 'api', 'components', 'index.html'),
    '<!doctype html><html><head>' +
      "<script>document.documentElement.dataset.placeTheme='dark'</script>" +
      '<script type="application/json" id="__place_load__">{"x":1}</script>' +
      '</head><body>' +
      `<script type="module" src="${COUNTER_JS}"></script>` +
      `<script type="module" src="${TOGGLE_JS}"></script>` +
      `<script type="module" src="${CHUNK_JS}"></script>` +
      '</body></html>',
  )

  // Island + chunk bundle files.
  mkdirSync(join(distDir, 'islands'), { recursive: true })
  writeFileSync(join(distDir, 'islands', 'counter-AbCd12Ef34Gh.js'), islandBody('counter'))
  writeFileSync(join(distDir, 'islands', 'theme-toggle-Hash12345678.js'), islandBody('toggle'))
  writeFileSync(join(distDir, 'islands', 'chunk-shared0001.js'), islandBody('shared'))

  // View manifest — the classifier's per-island level + reason.
  manifestPath = join(distDir, '.place', 'island-entries', 'view-manifest.json')
  mkdirSync(join(distDir, '.place', 'island-entries'), { recursive: true })
  writeFileSync(
    manifestPath,
    JSON.stringify({
      generatedAt: 1,
      entries: [
        {
          name: 'counter',
          level: 'island',
          effects: ['state'],
          reason: 'state-only — `state` (2 refs)',
          bytesCurrent: 1234,
        },
        {
          name: 'theme-toggle',
          level: 'island',
          effects: ['lifecycle'],
          reason: '`onMount` (lifecycle)',
          bytesCurrent: 2345,
        },
      ],
    }),
  )
})

afterAll(() => {
  rmSync(distDir, { recursive: true, force: true })
})

// ===== parseScripts =====

describe('parseScripts', () => {
  test('finds module + inline scripts, skips JSON data scripts', () => {
    const scripts = parseScripts(
      '<script>inline()</script>' +
        '<script type="application/json">{"a":1}</script>' +
        '<script type="module" src="/x.js"></script>',
    )
    expect(scripts).toHaveLength(2)
    expect(scripts[0]).toEqual({ src: null, body: 'inline()' })
    expect(scripts[1]?.src).toBe('/x.js')
  })

  test('treats place-state JSON as data (excluded)', () => {
    const scripts = parseScripts('<script type="application/place-state+json">{}</script>')
    expect(scripts).toHaveLength(0)
  })
})

// ===== matchIslandName =====

describe('matchIslandName', () => {
  test('matches <name>-<12 hash>.js against known island names', () => {
    expect(matchIslandName(COUNTER_JS, ['counter', 'theme-toggle'])).toBe('counter')
    expect(matchIslandName(TOGGLE_JS, ['counter', 'theme-toggle'])).toBe('theme-toggle')
  })

  test('rejects a shared chunk (no matching name / wrong length)', () => {
    expect(matchIslandName(CHUNK_JS, ['counter', 'theme-toggle'])).toBeNull()
  })

  test('rejects when there are no known island names', () => {
    expect(matchIslandName(COUNTER_JS, [])).toBeNull()
  })

  test('rejects a non-.js URL', () => {
    expect(matchIslandName('/islands/counter-AbCd12Ef34Gh.css', ['counter'])).toBeNull()
  })
})

// ===== analyzeDist =====

describe('analyzeDist', () => {
  test('throws DistNotFoundError for a missing directory', () => {
    expect(() => analyzeDist({ distDir: join(distDir, 'nope') })).toThrow(DistNotFoundError)
  })

  test('discovers routes sorted by path', () => {
    const a = analyzeDist({ distDir, manifestPath })
    expect(a.routes.map((r) => r.route)).toEqual(['/', '/api/components'])
  })

  test('classifies the static route as zero-JS', () => {
    const a = analyzeDist({ distDir, manifestPath })
    const home = a.routes.find((r) => r.route === '/')!
    expect(home.isStatic).toBe(true)
    expect(home.externalRaw).toBe(0)
    expect(home.externalGzip).toBe(0)
    // The inline early-theme script still ships — counted separately.
    expect(home.inlineRaw).toBeGreaterThan(0)
  })

  test('breaks down the interactive route into islands + chunk', () => {
    const a = analyzeDist({ distDir, manifestPath })
    const route = a.routes.find((r) => r.route === '/api/components')!
    expect(route.isStatic).toBe(false)
    const islands = route.scripts.filter((s) => s.kind === 'island')
    const chunks = route.scripts.filter((s) => s.kind === 'chunk')
    expect(islands.map((s) => s.island).sort()).toEqual(['counter', 'theme-toggle'])
    expect(chunks).toHaveLength(1)
    expect(route.externalGzip).toBeGreaterThan(0)
  })

  test('joins manifest level + reason onto island scripts', () => {
    const a = analyzeDist({ distDir, manifestPath })
    const route = a.routes.find((r) => r.route === '/api/components')!
    const counter = route.scripts.find((s) => s.island === 'counter')!
    expect(counter.level).toBe('island')
    expect(counter.reason).toContain('state')
    expect(counter.effects).toEqual(['state'])
    expect(a.manifestFound).toBe(true)
  })

  test('without a manifest, manifestFound is false and degrades cleanly', () => {
    const a = analyzeDist({ distDir })
    expect(a.manifestFound).toBe(false)
    // Total JS is still exact even without the manifest.
    const route = a.routes.find((r) => r.route === '/api/components')!
    expect(route.externalGzip).toBeGreaterThan(0)
  })
})

// ===== format =====

describe('format', () => {
  test('fmtBytes', () => {
    expect(fmtBytes(0)).toBe('0 B')
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(2048)).toBe('2.0 KB')
  })

  test('explain-all shows static routes + a total', () => {
    const a = analyzeDist({ distDir, manifestPath })
    const out = formatExplainAll(a)
    expect(out).toContain('/')
    expect(out).toContain('static — zero JavaScript')
    expect(out).toContain('1 static (0 B JS)')
  })

  test('explain-route names each island + the chunk', () => {
    const a = analyzeDist({ distDir, manifestPath })
    const route = a.routes.find((r) => r.route === '/api/components')!
    const out = formatExplainRoute(route, a)
    expect(out).toContain('counter')
    expect(out).toContain('theme-toggle')
    expect(out).toContain('L2 island')
  })

  test('why-js on a static route answers "Nothing."', () => {
    const a = analyzeDist({ distDir, manifestPath })
    const home = a.routes.find((r) => r.route === '/')!
    const out = formatWhyJsRoute(home, a)
    expect(out).toContain('Nothing')
    expect(out).toContain('0 bytes of island JavaScript')
  })

  test('why-js on an interactive route cites the effect reason', () => {
    const a = analyzeDist({ distDir, manifestPath })
    const route = a.routes.find((r) => r.route === '/api/components')!
    const out = formatWhyJsRoute(route, a)
    expect(out).toContain("ships because island 'counter'")
    expect(out).toContain('state')
  })
})

// ===== args =====

describe('parseArgs', () => {
  test('parses command + route + options', () => {
    const a = parseArgs(['explain', '/api/app', '--dist', 'out', '--manifest', 'm.json'])
    expect(a).toMatchObject({ command: 'explain', route: '/api/app', distDir: 'out' })
  })

  test('normalizes a route without a leading slash', () => {
    expect(parseArgs(['why-js', 'api/app']).route).toBe('/api/app')
  })

  test('rejects an unknown command', () => {
    expect(() => parseArgs(['bogus'])).toThrow(/unknown command/)
  })

  test('rejects an unknown option', () => {
    expect(() => parseArgs(['explain', '--wat'])).toThrow(/unknown option/)
  })
})

// ===== cli.main =====

describe('cli main', () => {
  test('--help prints usage and exits 0', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(await main(['--help'])).toBe(0)
    spy.mockRestore()
  })

  test('no command prints usage and exits 0', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(await main([])).toBe(0)
    spy.mockRestore()
  })

  test('an unknown command exits 2', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['bogus'])).toBe(2)
    spy.mockRestore()
  })

  test('a missing dist directory exits 1', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['explain', '--dist', join(distDir, 'nope')])).toBe(1)
    spy.mockRestore()
  })

  test('explain over the fixture exits 0', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(await main(['explain', '--dist', distDir, '--manifest', manifestPath])).toBe(0)
    spy.mockRestore()
  })

  test('explain a single route exits 0', async () => {
    const spy = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(
      await main(['explain', '/api/components', '--dist', distDir, '--manifest', manifestPath]),
    ).toBe(0)
    spy.mockRestore()
  })

  test('an unknown route exits 1', async () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['why-js', '/nope', '--dist', distDir])).toBe(1)
    spy.mockRestore()
  })
})
