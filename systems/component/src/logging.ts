// @place-ts/component — dev terminal output (log surface).
//
// Single source of truth for everything the framework prints during
// dev/build. Scattered `console.log` + `process.stdout.write` calls
// across `serve.ts`, `app.ts`, font/tailwind/isr subsystems route
// through the `log` namespace defined here, so we get consistent
// formatting, level filtering, and TTY-aware coloring without
// audit-by-grep.
//
// Public contract (effective `@place-ts/component` 0.10.0):
//
//   - `log.{error,warn,info,debug,trace}(msg, ...rest)` — write to
//     stderr (error/warn) or stdout (info/debug/trace) at the configured
//     level. `debug` + `trace` are silent unless `PLACE_LOG_LEVEL`
//     allows them.
//   - `log.scope(prefix)` — returns a child logger that prepends
//     `[prefix] ` to every line. Used by HMR / ISR / Tailwind / font
//     subsystems.
//   - `log.systemMessage(msg)` — buffered. Printed BEFORE the startup
//     banner when the banner flushes (so port-walk notices, optional-
//     peer warnings, etc. appear in a coherent pre-banner block,
//     never interleaved with the banner itself).
//   - `formatStartupBanner` / `formatRequestLogLine` / `formatBuildBanner`
//     / `formatTerminalError` — pure formatters used by serve()'s
//     dispatcher + the build pipeline.
//
// Level resolution:
//   1. `process.env.PLACE_LOG_LEVEL` (one of error|warn|info|debug|trace).
//   2. `info` (default).
//
// Browser-bundle safe: `process` is undefined in client bundles. The
// TTY check is deferred to module evaluation, but reads of
// `process.env` go through a guarded helper.

import { parseStackFrames, type StackFrame } from './error-overlay.ts'

// ===== ANSI + TTY =====

const isTTY = (): boolean =>
  typeof process !== 'undefined' && process.stdout && Boolean(process.stdout.isTTY)

const ansi = (() => {
  const tty = isTTY()
  const make = (open: string, close = '0'): ((s: string) => string) =>
    tty ? (s: string) => `\x1b[${open}m${s}\x1b[${close}m` : (s: string) => s
  return {
    bold: make('1', '22'),
    dim: make('2', '22'),
    red: make('31', '39'),
    green: make('32', '39'),
    yellow: make('33', '39'),
    magenta: make('35', '39'),
    cyan: make('36', '39'),
    gray: make('90', '39'),
    reset: tty ? '\x1b[0m' : '',
  }
})()

// Symbol set used throughout the framework's terminal output.
const sym = {
  done: '◆',
  bullet: '◦',
  ok: '✓',
  err: '✗',
  info: 'i',
  arrow: '→',
  caret: '›',
  rail: '│',
} as const

// ===== formatting helpers =====

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function formatMs(n: number): string {
  if (n < 1) return '<1ms'
  if (n < 1000) return `${Math.round(n)}ms`
  return `${(n / 1000).toFixed(2)}s`
}

// ===== log levels =====

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'trace'

const LEVELS: Record<LogLevel, number> = {
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
}

function resolveLevel(): LogLevel {
  const raw =
    typeof process !== 'undefined' && process.env ? (process.env['PLACE_LOG_LEVEL'] ?? '') : ''
  const lower = raw.toLowerCase() as LogLevel
  if (lower in LEVELS) return lower
  return 'info'
}

// Cached on first use; level changes after server boot are unusual so
// resolving once keeps the hot path branch-free.
let cachedLevel: LogLevel | null = null
function activeLevel(): LogLevel {
  if (cachedLevel === null) cachedLevel = resolveLevel()
  return cachedLevel
}

const shouldLog = (level: LogLevel): boolean => LEVELS[level] >= LEVELS[activeLevel()]

// ===== log namespace =====

export interface Logger {
  error(msg: string, errOrRest?: unknown, ...more: unknown[]): void
  warn(msg: string, ...rest: unknown[]): void
  info(msg: string, ...rest: unknown[]): void
  debug(msg: string, ...rest: unknown[]): void
  trace(msg: string, ...rest: unknown[]): void
  scope(prefix: string): Logger
}

// Pre-banner buffer. Calls to `log.systemMessage(...)` between server
// boot and banner flush land here so they appear ABOVE the banner —
// a single coherent block of startup diagnostics.
const systemMessages: string[] = []

const writeStream = (level: LogLevel, line: string): void => {
  if (typeof process === 'undefined') return
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout
  stream.write(`${line}\n`)
}

const formatRest = (rest: readonly unknown[]): string => {
  if (rest.length === 0) return ''
  // util.inspect is the right tool for structured rendering but it's
  // node-only; on Bun + browser bundles we fall back to JSON.stringify
  // with a depth-1 guard. The terminal renderer for actual Errors
  // (formatTerminalError) is the one place where rich formatting
  // belongs — plain `rest` is bag-style.
  return rest.map((r) => (typeof r === 'string' ? r : safeStringify(r))).join(' ')
}

const safeStringify = (v: unknown): string => {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function makeLogger(prefix: string): Logger {
  const prefixed = (
    kind: 'ok' | 'warn' | 'err' | 'info' | 'bullet' | 'dim',
    msg: string,
  ): string => {
    const sigil =
      kind === 'err'
        ? ansi.red(sym.err)
        : kind === 'warn'
          ? ansi.yellow(sym.info)
          : kind === 'ok'
            ? ansi.green(sym.ok)
            : kind === 'info'
              ? ansi.cyan(sym.info)
              : ansi.gray(sym.bullet)
    const scopeTag = prefix === '' ? '' : ansi.gray(`[${prefix}] `)
    return `  ${sigil}  ${scopeTag}${msg}`
  }

  return {
    error(msg, errOrRest, ...more) {
      if (!shouldLog('error')) return
      const tail =
        errOrRest instanceof Error
          ? `\n${formatTerminalError(errOrRest, { indent: 6 })}`
          : errOrRest === undefined
            ? ''
            : ` ${formatRest([errOrRest, ...more])}`
      writeStream('error', prefixed('err', `${msg}${tail}`))
    },
    warn(msg, ...rest) {
      if (!shouldLog('warn')) return
      writeStream(
        'warn',
        prefixed('warn', `${msg}${rest.length > 0 ? ` ${formatRest(rest)}` : ''}`),
      )
    },
    info(msg, ...rest) {
      if (!shouldLog('info')) return
      writeStream('info', prefixed('ok', `${msg}${rest.length > 0 ? ` ${formatRest(rest)}` : ''}`))
    },
    debug(msg, ...rest) {
      if (!shouldLog('debug')) return
      writeStream(
        'debug',
        prefixed('dim', `${msg}${rest.length > 0 ? ` ${formatRest(rest)}` : ''}`),
      )
    },
    trace(msg, ...rest) {
      if (!shouldLog('trace')) return
      writeStream(
        'trace',
        prefixed('dim', `${msg}${rest.length > 0 ? ` ${formatRest(rest)}` : ''}`),
      )
    },
    scope(child) {
      return makeLogger(prefix === '' ? child : `${prefix}:${child}`)
    },
  }
}

/**
 * The framework-wide logger. Subsystems should obtain a scoped child
 * (`const hmr = log.scope('hmr')`) rather than emit raw to console.
 * Top-level errors / startup messages use `log.error`, `log.warn`,
 * `log.info` directly.
 */
export const log: Logger & {
  systemMessage(msg: string): void
  flushSystemMessages(): string
  resetForTests(): void
} = Object.assign(makeLogger(''), {
  /**
   * Buffer a system-level diagnostic message to appear ABOVE the
   * startup banner. Used for port-walk fallbacks, optional-peer-dep
   * warnings, security defaults applied, etc. Each message is
   * prefixed `i ` and rendered with the muted-info color.
   *
   * If the banner has already flushed (or no banner will be printed —
   * e.g. test runs), the message is emitted immediately via `log.info`.
   */
  systemMessage(msg: string): void {
    if (bannerFlushed) {
      log.info(msg)
      return
    }
    systemMessages.push(msg)
  },
  /**
   * Internal: called by the banner formatter to drain + emit the
   * buffered messages. Returns the formatted block (multi-line string,
   * trailing newline) for inclusion above the banner. Exported here
   * for the few callers that need to flush manually.
   */
  flushSystemMessages(): string {
    if (systemMessages.length === 0) {
      bannerFlushed = true
      return ''
    }
    const out: string[] = []
    for (const m of systemMessages) {
      out.push(`  ${ansi.yellow(sym.info)}  ${ansi.dim(m)}`)
    }
    systemMessages.length = 0
    bannerFlushed = true
    return `${out.join('\n')}\n\n`
  },
  /** Reset state — for unit tests only. */
  resetForTests(): void {
    systemMessages.length = 0
    bannerFlushed = false
    cachedLevel = null
  },
})

let bannerFlushed = false

// ===== startup banner =====

export interface StartupBannerInput {
  name: string
  url: string
  networkUrl?: string | null
  routes: Array<{ method: string; pattern: string; isPage: boolean }>
  clientPath: string | null
  timings: { tailwindMs?: number; bundleMs?: number; bundleBytes?: number; tailwindBytes?: number }
  startupMs: number
  hasTheme: boolean
  themeNames: readonly string[] | null
  hasSecurity: boolean
  hasCache: boolean
  islandsCount?: number
  islandsBytesGz?: number
}

export function formatStartupBanner(input: StartupBannerInput): string {
  const lines: string[] = []
  // Flush pre-banner system messages first (port-walk, optional-peer
  // warnings, etc). Result includes its own trailing blank line.
  const sysBlock = log.flushSystemMessages()
  if (sysBlock !== '') lines.push(sysBlock.trimEnd())

  // Header: ◆  <name> — ready in 243ms
  lines.push('')
  lines.push(
    `  ${ansi.magenta(sym.done)}  ${ansi.bold(input.name)} ${ansi.dim('—')} ${ansi.dim('ready in')} ${ansi.bold(formatMs(input.startupMs))}`,
  )
  lines.push('')

  // URLs.
  lines.push(`     ${ansi.dim('Local   ')} ${ansi.cyan(input.url)}`)
  if (input.networkUrl) {
    lines.push(`     ${ansi.dim('Network ')} ${ansi.cyan(input.networkUrl)}`)
  }
  lines.push('')

  // Summary: routes · islands · active features. One line.
  const summaryParts: string[] = []
  if (input.routes.length > 0) {
    summaryParts.push(ansi.dim(`${input.routes.length} routes`))
  }
  if (input.islandsCount !== undefined && input.islandsCount > 0) {
    const gz =
      input.islandsBytesGz !== undefined
        ? ` ${ansi.gray(`(${formatBytes(input.islandsBytesGz)} gz)`)}`
        : ''
    summaryParts.push(ansi.dim(`${input.islandsCount} islands`) + gz)
  } else if (input.clientPath !== null && input.timings.bundleBytes !== undefined) {
    summaryParts.push(ansi.dim(`bundle ${formatBytes(input.timings.bundleBytes)}`))
  }
  const features: string[] = []
  if (input.hasSecurity) features.push('security')
  if (input.hasCache) features.push('isr')
  if (input.hasTheme && input.themeNames !== null) {
    features.push(`theme(${input.themeNames.join('/')})`)
  }
  if (features.length > 0) summaryParts.push(ansi.green(features.join(' · ')))
  if (summaryParts.length > 0) {
    lines.push(`     ${summaryParts.join('  ·  ')}`)
    lines.push('')
  }

  // Per-route table — only at debug level (banner stays compact for
  // most users; verbose mode keeps the old shape).
  if (shouldLog('debug') && input.routes.length > 0) {
    lines.push(`     ${ansi.dim('Routes')}`)
    for (const r of input.routes) {
      const method = r.method.padEnd(5)
      const pattern = r.pattern.padEnd(28)
      const tag = r.isPage ? ansi.gray('page') : ansi.gray('handler')
      lines.push(`       ${ansi.dim(method)} ${pattern} ${tag}`)
    }
    lines.push('')
  }

  return `${lines.join('\n')}\n`
}

// ===== request log line =====

const isStaticPath = (path: string): boolean =>
  path.startsWith('/islands/') ||
  path.startsWith('/_place/') ||
  path.startsWith('/static/') ||
  /\.(?:js|css|svg|png|jpg|jpeg|gif|webp|ico|woff2?)$/i.test(path)

export interface RequestLogInput {
  method: string
  path: string
  status: number
  ms: number
  /** Set for 3xx responses with a Location header. */
  redirectTo?: string | null
}

/**
 * Format a single per-request line. Returns the formatted string
 * (including trailing newline), or `null` if the line should be
 * suppressed at the current log level — static-asset noise is hidden
 * at `info`, surfaced at `debug`.
 */
export function formatRequestLogLine(
  input: RequestLogInput | string,
  ...rest: unknown[]
): string | null {
  // Back-compat overload: `formatRequestLogLine(method, path, status, ms)`
  // — older call sites used positional args. The new shape is a single
  // input object, but we keep the positional form working through 0.10.x.
  const arg: RequestLogInput =
    typeof input === 'string'
      ? {
          method: input,
          path: rest[0] as string,
          status: rest[1] as number,
          ms: rest[2] as number,
          redirectTo: null,
        }
      : input

  const staticTag = isStaticPath(arg.path)
  if (staticTag && !shouldLog('debug')) return null

  const statusColor = arg.status >= 500 ? ansi.red : arg.status >= 400 ? ansi.yellow : ansi.green
  const msColor = arg.ms > 1000 ? ansi.red : ansi.gray
  const m = arg.method.padEnd(5)
  const p = arg.path.length > 40 ? `${arg.path.slice(0, 37)}...` : arg.path.padEnd(40)
  const s = statusColor(String(arg.status))
  const t = msColor(formatMs(arg.ms).padStart(6))
  const redirect = arg.redirectTo ? ` ${ansi.dim(sym.arrow)} ${ansi.dim(arg.redirectTo)}` : ''
  const tag = staticTag ? `  ${ansi.gray('· static')}` : ''
  return `  ${ansi.gray(sym.bullet)}  ${ansi.dim(m)} ${p} ${s}  ${t}${redirect}${tag}\n`
}

// ===== build banner =====

export interface BuildBannerInput {
  name: string
  outDir: string
  pagesCount: number
  islandsCount?: number
  islandsBytesGz?: number
  tailwindBytes?: number
  totalMs: number
  hasHeaders?: boolean
}

export function formatBuildBanner(input: BuildBannerInput): string {
  const lines: string[] = []
  lines.push('')
  lines.push(
    `  ${ansi.magenta(sym.done)}  ${ansi.bold(`Building ${input.name}`)} ${ansi.dim(`— static export → ${input.outDir}/`)}`,
  )
  lines.push('')
  if (input.tailwindBytes !== undefined) {
    lines.push(
      `     ${ansi.dim(sym.caret)} ${ansi.dim('Tailwind compiled')}     ${formatBytes(input.tailwindBytes)}`,
    )
  }
  if (input.islandsCount !== undefined && input.islandsCount > 0) {
    const size =
      input.islandsBytesGz !== undefined
        ? ` ${ansi.gray(`(${formatBytes(input.islandsBytesGz)} gz)`)}`
        : ''
    lines.push(
      `     ${ansi.dim(sym.caret)} ${ansi.dim('Islands bundled')}       ${input.islandsCount} chunks${size}`,
    )
  }
  lines.push(
    `     ${ansi.dim(sym.caret)} ${ansi.dim('Pre-rendered')}          ${input.pagesCount} pages`,
  )
  if (input.hasHeaders) {
    lines.push(
      `     ${ansi.dim(sym.caret)} ${ansi.dim('_headers written')}      ${ansi.gray('Cloudflare CSP')}`,
    )
  }
  lines.push('')
  lines.push(
    `  ${ansi.green(sym.ok)}  ${ansi.dim('Done in')} ${ansi.bold(formatMs(input.totalMs))}`,
  )
  lines.push('')
  return `${lines.join('\n')}\n`
}

// ===== terminal error frame =====

/**
 * Render an Error (or unknown thrown value) as a terminal-friendly
 * block — file:line of the top user frame, the message, and up to 3
 * stack frames. Used by `log.error(msg, err)` and by serve()'s HMR
 * rebuild-failure path.
 *
 * Stays compact (no source-preview window — that lives in the browser
 * overlay only). The terminal block targets "scan + jump to file";
 * the browser overlay targets "read in context."
 */
export function formatTerminalError(err: unknown, options: { indent?: number } = {}): string {
  const indent = ' '.repeat(options.indent ?? 6)
  if (!(err instanceof Error)) {
    return `${indent}${ansi.red(safeStringify(err))}`
  }
  const cwd = typeof process !== 'undefined' && process.cwd ? process.cwd() : ''
  const frames = parseStackFrames(err.stack, cwd)
  const lines: string[] = []
  lines.push(`${indent}${ansi.red(ansi.bold(err.name ?? 'Error'))}: ${err.message}`)
  // Top user frame first, then up to 2 more.
  const topUser = frames.find((f) => f.scope === 'user') ?? frames[0]
  if (topUser) {
    lines.push(`${indent}${ansi.cyan(formatFrameLocation(topUser))}`)
  }
  const moreFrames = frames.filter((f) => f !== topUser).slice(0, 2)
  for (const f of moreFrames) {
    lines.push(`${indent}${ansi.dim(formatFrameLocation(f))}`)
  }
  return lines.join('\n')
}

function formatFrameLocation(f: StackFrame): string {
  const where = f.fn ? `${f.fn}` : '<anonymous>'
  return `at ${where} (${f.file}:${f.line}:${f.col})`
}
