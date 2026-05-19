// format.ts — render `DistAnalysis` into the `place` CLI's output.
//
// Pure: every function here is `(data) => string`. The CLI layer
// (`cli.ts`) handles I/O; this module only formats. That split keeps
// the output testable without spawning a process.

import type { DistAnalysis, RouteAnalysis, ScriptRef } from './analyze.ts'

/** Human byte size. `0` → `'0 B'`; sub-KB → `'N B'`; else `'N.N KB'`. */
export function fmtBytes(n: number): string {
  if (n === 0) return '0 B'
  if (n < 1024) return `${n} B`
  return `${(n / 1024).toFixed(1)} KB`
}

/** Right-pad to `width`. */
function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

/** Left-pad to `width`. */
function padStart(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s
}

function header(title: string, analysis: DistAnalysis): string {
  return `${title}\ndist: ${analysis.distDir}\n`
}

/** One-word count summary for a route's external scripts. */
function routeSummary(route: RouteAnalysis): string {
  if (route.isStatic) return 'static — zero JavaScript'
  const islands = route.scripts.filter((s) => s.kind === 'island').length
  const chunks = route.scripts.filter((s) => s.kind === 'chunk').length
  const parts: string[] = []
  if (islands > 0) parts.push(`${islands} island${islands === 1 ? '' : 's'}`)
  if (chunks > 0) parts.push(`${chunks} chunk${chunks === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

/**
 * `place explain` with no route — a table of every route's JS cost.
 * Static routes (the goal) are shown plainly; interactive routes show
 * their gzipped island+chunk total.
 */
export function formatExplainAll(analysis: DistAnalysis): string {
  const lines: string[] = [header('place explain — JavaScript shipped per route', analysis)]
  if (analysis.routes.length === 0) {
    lines.push('  no routes found — is this a place static export?')
    return lines.join('\n')
  }
  const routeWidth = Math.max(...analysis.routes.map((r) => r.route.length))
  const sizeWidth = Math.max(...analysis.routes.map((r) => fmtBytes(r.externalGzip).length))
  for (const r of analysis.routes) {
    const size = r.isStatic
      ? padStart('0 B', sizeWidth)
      : padStart(fmtBytes(r.externalGzip), sizeWidth)
    lines.push(`  ${pad(r.route, routeWidth)}   ${size}   ${routeSummary(r)}`)
  }
  const staticCount = analysis.routes.filter((r) => r.isStatic).length
  const interactive = analysis.routes.length - staticCount
  // The honest aggregate is the sum of DISTINCT bundle files: a
  // chrome island shared by every route ships once and the browser
  // caches it. Summing per-route would multiply that bundle by the
  // route count — a misleading number.
  const distinct = new Map<string, number>()
  for (const r of analysis.routes) {
    for (const s of r.scripts) {
      if (s.kind !== 'inline' && !distinct.has(s.src)) distinct.set(s.src, s.gzipBytes)
    }
  }
  const uniqueGzip = [...distinct.values()].reduce((sum, b) => sum + b, 0)
  lines.push('')
  lines.push(
    `  ${analysis.routes.length} route${analysis.routes.length === 1 ? '' : 's'} · ` +
      `${staticCount} static (0 B JS) · ${interactive} interactive`,
  )
  lines.push(
    `  ${distinct.size} distinct bundle${distinct.size === 1 ? '' : 's'} · ` +
      `${fmtBytes(uniqueGzip)} gz unique (cached across routes)`,
  )
  if (!analysis.manifestFound) {
    lines.push('')
    lines.push('  (no view manifest — run `place why-js` after a build for effect attribution)')
  }
  return lines.join('\n')
}

/** A single script's classifier annotation, or a chunk description. */
function scriptDetail(s: ScriptRef): string {
  if (s.kind === 'chunk') return 'shared framework runtime + deps'
  if (s.kind === 'inline') return 'inline runtime'
  if (s.level !== undefined) {
    const lvl = s.level === 'island' ? 'L2 island' : s.level
    return `${lvl}   ${s.reason ?? ''}`.trimEnd()
  }
  return '(no manifest entry)'
}

/** Basename of a script src, for compact display. */
function basename(src: string): string {
  const i = src.lastIndexOf('/')
  return i >= 0 ? src.slice(i + 1) : src
}

/**
 * `place explain <route>` — the per-script breakdown for one route.
 */
export function formatExplainRoute(route: RouteAnalysis, analysis: DistAnalysis): string {
  const lines: string[] = [header(`place explain ${route.route}`, analysis)]
  const external = route.scripts.filter((s) => s.kind !== 'inline')

  if (route.isStatic) {
    lines.push('  0 B — this route ships zero island JavaScript.')
  } else {
    lines.push(
      `  ${fmtBytes(route.externalGzip)} gz shipped  (${fmtBytes(route.externalRaw)} raw)  ·  ` +
        `${external.length} script${external.length === 1 ? '' : 's'}`,
    )
    lines.push('')
    const labelWidth = Math.max(
      ...external.map((s) => (s.kind === 'island' ? (s.island ?? '') : basename(s.src)).length),
    )
    const sizeWidth = Math.max(...external.map((s) => fmtBytes(s.gzipBytes).length))
    for (const s of external) {
      const label = s.kind === 'island' ? (s.island ?? '') : basename(s.src)
      lines.push(
        `  ${pad(s.kind, 7)}${pad(label, labelWidth)}   ${padStart(fmtBytes(s.gzipBytes), sizeWidth)} gz   ${scriptDetail(s)}`,
      )
    }
  }

  if (route.inlineRaw > 0) {
    lines.push('')
    lines.push(
      `  + ${fmtBytes(route.inlineRaw)} inline (early-theme + SPA-nav runtime, not an island bundle)`,
    )
  }
  return lines.join('\n')
}

/**
 * `place why-js <route>` — explains, per script, WHY the route ships
 * the JavaScript it does. The headline value: a static route's answer
 * is "Nothing."
 */
export function formatWhyJsRoute(route: RouteAnalysis, analysis: DistAnalysis): string {
  const lines: string[] = [header(`place why-js ${route.route}`, analysis)]
  const external = route.scripts.filter((s) => s.kind !== 'inline')

  if (route.isStatic) {
    lines.push(
      `  Nothing. ${route.route} is a static page — it ships 0 bytes of island JavaScript.`,
    )
    if (route.inlineRaw > 0) {
      lines.push('')
      lines.push(
        `  (${fmtBytes(route.inlineRaw)} of inline runtime ships: the early-theme script that`,
      )
      lines.push('   applies a saved theme before first paint, plus SPA-nav wiring.)')
    }
    return lines.join('\n')
  }

  lines.push(
    `  ${route.route} ships ${fmtBytes(route.externalGzip)} gz of JavaScript ` +
      `across ${external.length} script${external.length === 1 ? '' : 's'}:`,
  )
  lines.push('')
  for (const s of external) {
    if (s.kind === 'island') {
      const name = s.island ?? '?'
      if (s.reason !== undefined) {
        lines.push(`  ${name}  (${fmtBytes(s.gzipBytes)} gz)`)
        lines.push(
          `    ships because island '${name}' is classified ` +
            `${s.level === 'island' ? 'L2 island' : s.level} — ${s.reason}`,
        )
      } else {
        lines.push(`  ${name}  (${fmtBytes(s.gzipBytes)} gz)`)
        lines.push('    ships as an interactive island. (No view manifest found — run a build so')
        lines.push('     `place` can name the effect that forced the bundle.)')
      }
    } else {
      lines.push(`  ${basename(s.src)}  (${fmtBytes(s.gzipBytes)} gz)`)
      lines.push('    shared framework runtime + deps — loaded once, cached across every route.')
    }
  }
  return lines.join('\n')
}

/**
 * Error message for a route filter that matched nothing — lists the
 * routes that DO exist so the user can correct the typo.
 */
export function formatRouteNotFound(route: string, analysis: DistAnalysis): string {
  const lines = [`route '${route}' not found in ${analysis.distDir}`, '', 'available routes:']
  for (const r of analysis.routes) lines.push(`  ${r.route}`)
  return lines.join('\n')
}
