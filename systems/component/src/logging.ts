// @place/component — dev terminal output.
//
// Extracted from index.ts (Tier 20 decomposition). The startup banner
// (printed once after the port binds) and the per-request log line.
// Server-only, dev-default — serve() calls these from its banner +
// request dispatch.

// Default-on in dev, off in production. The banner runs once after the
// port is bound. The per-request log fires per request, formatted as a
// single tab-aligned line. Uses ANSI color when stdout is a TTY; bare
// text otherwise (so log shippers don't see escape sequences).

// Guard the TTY check — `process` is undefined in browser bundles and
// the entire framework lives in one file, so a bare `process.stdout`
// reference at module scope would crash the client. The check is
// deferred to first use; in browsers we always get the no-color shape.
const ansi = (() => {
  const isTTY = typeof process !== 'undefined' && process.stdout && process.stdout.isTTY
  return isTTY
    ? {
        reset: '\x1b[0m',
        bold: '\x1b[1m',
        dim: '\x1b[2m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        red: '\x1b[31m',
        cyan: '\x1b[36m',
        magenta: '\x1b[35m',
        gray: '\x1b[90m',
      }
    : {
        reset: '',
        bold: '',
        dim: '',
        green: '',
        yellow: '',
        red: '',
        cyan: '',
        magenta: '',
        gray: '',
      }
})()

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / 1024 / 1024).toFixed(2)}MB`
}

function formatMs(n: number): string {
  if (n < 1) return '<1ms'
  if (n < 1000) return `${Math.round(n)}ms`
  return `${(n / 1000).toFixed(2)}s`
}

interface StartupBannerInput {
  name: string
  url: string
  routes: Array<{ method: string; pattern: string; isPage: boolean }>
  clientPath: string | null
  timings: { tailwindMs?: number; bundleMs?: number; bundleBytes?: number; tailwindBytes?: number }
  startupMs: number
  hasTheme: boolean
  themeNames: readonly string[] | null
  hasSecurity: boolean
  hasCache: boolean
}

export function formatStartupBanner(input: StartupBannerInput): string {
  const { bold, dim, cyan, green, magenta, gray, reset } = ansi
  const lines: string[] = []
  lines.push('')
  lines.push(`  ${bold}${magenta}▲${reset}  ${bold}${input.name}${reset}`)
  lines.push('')
  lines.push(`  ${green}→${reset}  ${cyan}${input.url}${reset}`)
  lines.push('')
  // Routes: pad method, then pattern, then a tag.
  if (input.routes.length > 0) {
    lines.push(`  ${dim}Routes${reset}`)
    for (const r of input.routes) {
      const method = r.method.padEnd(5)
      const pattern = r.pattern.padEnd(28)
      const tag = r.isPage ? `${gray}page${reset}` : `${gray}handler${reset}`
      lines.push(`    ${dim}${method}${reset} ${pattern} ${tag}`)
    }
    lines.push('')
  }
  // Bundle + Tailwind timings.
  const built: string[] = []
  if (input.clientPath !== null && input.timings.bundleMs !== undefined) {
    const size = input.timings.bundleBytes
      ? ` ${gray}(${formatBytes(input.timings.bundleBytes)})${reset}`
      : ''
    built.push(
      `    ${dim}bundle${reset}     ${input.clientPath.padEnd(14)} ${formatMs(input.timings.bundleMs).padEnd(7)}${size}`,
    )
  }
  if (input.timings.tailwindMs !== undefined) {
    const size = input.timings.tailwindBytes
      ? ` ${gray}(${formatBytes(input.timings.tailwindBytes)})${reset}`
      : ''
    built.push(
      `    ${dim}tailwind${reset}   ${'inline'.padEnd(14)} ${formatMs(input.timings.tailwindMs).padEnd(7)}${size}`,
    )
  }
  if (built.length > 0) {
    lines.push(`  ${dim}Built${reset}`)
    for (const b of built) lines.push(b)
    lines.push('')
  }
  // Active features.
  const features: string[] = []
  if (input.hasSecurity) features.push(`${green}security${reset}`)
  if (input.hasCache) features.push(`${green}isr${reset}`)
  if (input.hasTheme && input.themeNames !== null) {
    features.push(`${green}theme${reset}${gray}(${input.themeNames.join('/')})${reset}`)
  }
  if (features.length > 0) {
    lines.push(`  ${dim}Active${reset}     ${features.join('  ')}`)
    lines.push('')
  }
  lines.push(`  ${dim}Ready in ${reset}${bold}${formatMs(input.startupMs)}${reset}`)
  lines.push('')
  return `${lines.join('\n')}\n`
}

export function formatRequestLogLine(
  method: string,
  path: string,
  status: number,
  ms: number,
): string {
  const { dim, green, yellow, red, gray, reset } = ansi
  const statusColor = status >= 500 ? red : status >= 400 ? yellow : green
  const m = method.padEnd(5)
  const p = path.length > 50 ? `${path.slice(0, 47)}...` : path.padEnd(50)
  const s = `${statusColor}${status}${reset}`
  const t = formatMs(ms)
  return `  ${dim}${m}${reset} ${p} ${s}  ${gray}${t}${reset}\n`
}
