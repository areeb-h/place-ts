// @vitest-environment node
//
// Tests for the `log` namespace + formatters in `logging.ts`.
//
// Strategy: capture stdout/stderr writes by stubbing each stream's
// `write` method, then assert on the captured lines. The level cache
// in the module is reset between tests via `log.resetForTests()`.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  formatBuildBanner,
  formatRequestLogLine,
  formatStartupBanner,
  formatTerminalError,
  log,
} from '../../src/logging.ts'

interface Captured {
  stdout: string[]
  stderr: string[]
}

const capture = (): Captured => {
  const c: Captured = { stdout: [], stderr: [] }
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    c.stdout.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    c.stderr.push(String(chunk))
    return true
  })
  return c
}

beforeEach(() => {
  log.resetForTests()
  delete process.env['PLACE_LOG_LEVEL']
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('log namespace — levels', () => {
  test('info / warn / error fire at default (info) level', () => {
    const c = capture()
    log.info('hello')
    log.warn('be careful')
    log.error('boom')
    expect(c.stdout.join('')).toMatch(/hello/)
    expect(c.stderr.join('')).toMatch(/be careful/)
    expect(c.stderr.join('')).toMatch(/boom/)
  })

  test('debug + trace silenced at default level', () => {
    const c = capture()
    log.debug('crickets')
    log.trace('nothing')
    expect(c.stdout.length).toBe(0)
  })

  test('PLACE_LOG_LEVEL=debug surfaces debug', () => {
    process.env['PLACE_LOG_LEVEL'] = 'debug'
    log.resetForTests()
    const c = capture()
    log.debug('visible now')
    expect(c.stdout.join('')).toMatch(/visible now/)
  })

  test('PLACE_LOG_LEVEL=error silences info + warn', () => {
    process.env['PLACE_LOG_LEVEL'] = 'error'
    log.resetForTests()
    const c = capture()
    log.info('not me')
    log.warn('nor me')
    log.error('only me')
    expect(c.stdout.length).toBe(0)
    expect(c.stderr.join('')).toMatch(/only me/)
  })
})

describe('log namespace — scope', () => {
  test('scoped logger prepends [prefix]', () => {
    const c = capture()
    log.scope('hmr').info('rebuilt')
    expect(c.stdout.join('')).toMatch(/\[hmr\]/)
    expect(c.stdout.join('')).toMatch(/rebuilt/)
  })

  test('nested scope chains prefixes with :', () => {
    const c = capture()
    log.scope('isr').scope('background').info('failed')
    expect(c.stdout.join('')).toMatch(/\[isr:background\]/)
  })
})

describe('log.error — error formatting', () => {
  test('Error object renders message + frame', () => {
    const c = capture()
    const err = new Error('something broke')
    log.error('module failed', err)
    const out = c.stderr.join('')
    expect(out).toMatch(/module failed/)
    expect(out).toMatch(/something broke/)
  })

  test('non-Error value renders via stringify', () => {
    const c = capture()
    log.error('weird', { detail: 42 })
    const out = c.stderr.join('')
    expect(out).toMatch(/weird/)
    expect(out).toMatch(/42/)
  })
})

describe('log.systemMessage — pre-banner buffer', () => {
  test('messages queued before banner flush', () => {
    log.systemMessage('one')
    log.systemMessage('two')
    const block = log.flushSystemMessages()
    expect(block).toMatch(/one/)
    expect(block).toMatch(/two/)
  })

  test('after flush, systemMessage falls back to info', () => {
    log.flushSystemMessages() // banner has rendered
    const c = capture()
    log.systemMessage('late')
    expect(c.stdout.join('')).toMatch(/late/)
  })

  test('flush returns empty string when no messages', () => {
    expect(log.flushSystemMessages()).toBe('')
  })
})

describe('formatStartupBanner — shape', () => {
  test('contains app name, URL, and ready timing', () => {
    const out = formatStartupBanner({
      name: 'test-app',
      url: 'http://localhost:5174',
      routes: [{ method: 'GET', pattern: '/', isPage: true }],
      clientPath: null,
      timings: {},
      startupMs: 243,
      hasTheme: false,
      themeNames: null,
      hasSecurity: true,
      hasCache: false,
    })
    expect(out).toMatch(/test-app/)
    expect(out).toMatch(/http:\/\/localhost:5174/)
    expect(out).toMatch(/ready in/)
    expect(out).toMatch(/243ms/)
    expect(out).toMatch(/1 routes/)
    expect(out).toMatch(/security/)
  })

  test('includes network URL when provided', () => {
    const out = formatStartupBanner({
      name: 'x',
      url: 'http://localhost:5174',
      networkUrl: 'http://192.168.1.42:5174',
      routes: [],
      clientPath: null,
      timings: {},
      startupMs: 100,
      hasTheme: false,
      themeNames: null,
      hasSecurity: false,
      hasCache: false,
    })
    expect(out).toMatch(/Network/)
    expect(out).toMatch(/192\.168\.1\.42/)
  })

  test('flushes pre-banner system messages above the banner', () => {
    log.systemMessage('port 5174 busy — using 5175')
    const out = formatStartupBanner({
      name: 'x',
      url: 'http://localhost:5175',
      routes: [],
      clientPath: null,
      timings: {},
      startupMs: 100,
      hasTheme: false,
      themeNames: null,
      hasSecurity: false,
      hasCache: false,
    })
    // System message line appears before the banner's app-name line.
    const sysIdx = out.indexOf('port 5174 busy')
    const nameIdx = out.indexOf('x')
    expect(sysIdx).toBeGreaterThanOrEqual(0)
    expect(sysIdx).toBeLessThan(nameIdx)
  })
})

describe('formatRequestLogLine — shape', () => {
  test('200 GET renders one line with method + path + ms', () => {
    const line = formatRequestLogLine({ method: 'GET', path: '/', status: 200, ms: 34 })
    expect(line).not.toBeNull()
    expect(line!).toMatch(/GET/)
    expect(line!).toMatch(/200/)
    expect(line!).toMatch(/34ms/)
  })

  test('static asset paths suppressed at info level', () => {
    const line = formatRequestLogLine({
      method: 'GET',
      path: '/islands/foo.js',
      status: 200,
      ms: 2,
    })
    expect(line).toBeNull()
  })

  test('static asset paths surface at debug level', () => {
    process.env['PLACE_LOG_LEVEL'] = 'debug'
    log.resetForTests()
    const line = formatRequestLogLine({
      method: 'GET',
      path: '/islands/foo.js',
      status: 200,
      ms: 2,
    })
    expect(line).not.toBeNull()
    expect(line!).toMatch(/static/)
  })

  test('redirect target rendered for 3xx with Location', () => {
    const line = formatRequestLogLine({
      method: 'POST',
      path: '/login',
      status: 302,
      ms: 5,
      redirectTo: '/home',
    })
    expect(line).not.toBeNull()
    expect(line!).toMatch(/302/)
    expect(line!).toMatch(/\/home/)
  })

  test('back-compat positional form', () => {
    const line = formatRequestLogLine('GET', '/', 200, 12)
    expect(line).not.toBeNull()
    expect(line!).toMatch(/GET/)
  })
})

describe('formatBuildBanner — shape', () => {
  test('contains pre-render count + done timing', () => {
    const out = formatBuildBanner({
      name: 'blog',
      outDir: 'dist',
      pagesCount: 6,
      islandsCount: 3,
      islandsBytesGz: 8200,
      tailwindBytes: 12300,
      totalMs: 1200,
      hasHeaders: true,
    })
    expect(out).toMatch(/Building blog/)
    expect(out).toMatch(/dist/)
    expect(out).toMatch(/6 pages/)
    expect(out).toMatch(/Done in/)
  })
})

describe('formatTerminalError — shape', () => {
  test('Error renders name + message + at-frame', () => {
    const err = new Error('boom')
    const out = formatTerminalError(err)
    expect(out).toMatch(/Error/)
    expect(out).toMatch(/boom/)
    expect(out).toMatch(/at /)
  })

  test('non-Error value renders stringified', () => {
    const out = formatTerminalError({ kind: 'weird' })
    expect(out).toMatch(/kind/)
  })
})
