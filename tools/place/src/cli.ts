#!/usr/bin/env bun
// `place` — the place diagnostics CLI.
//
// Two subcommands, one question each:
//   place explain [route]  — what JavaScript does each route ship?
//   place why-js  [route]  — and WHY does it ship that?
//
// `place` is a pure analyzer of a finished static export (`dist/`).
// It runs no build and imports no framework code — it reads the
// emitted HTML + JS and the build's view manifest, and reports. That
// makes it safe to run anywhere and impossible for it to perturb a
// build.
//
// This is the charter's "the graph is observable" + "magic with
// clarity" (ADR 0026) made tangible: every island bundle a route
// ships is traced back to the effect in the developer's own code
// that forced it.

import { analyzeDist, DistNotFoundError } from './analyze.ts'
import { parseArgs, USAGE } from './args.ts'
import {
  formatExplainAll,
  formatExplainRoute,
  formatRouteNotFound,
  formatWhyJsRoute,
} from './format.ts'

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = (() => {
    try {
      return parseArgs(argv)
    } catch (err) {
      process.stderr.write(`error: ${(err as Error).message}\n\n${USAGE}\n`)
      return null
    }
  })()
  if (args === null) return 2

  if (args.help || args.command === null) {
    process.stdout.write(`${USAGE}\n`)
    // No command is a usage request, not an error — exit 0.
    return 0
  }

  let analysis: ReturnType<typeof analyzeDist>
  try {
    analysis = analyzeDist({ distDir: args.distDir, manifestPath: args.manifestPath })
  } catch (err) {
    if (err instanceof DistNotFoundError) {
      process.stderr.write(`error: ${err.message}\n`)
      return 1
    }
    throw err
  }

  // Route-scoped commands: resolve the route filter first.
  if (args.route !== null) {
    const route = analysis.routes.find((r) => r.route === args.route)
    if (route === undefined) {
      process.stderr.write(`${formatRouteNotFound(args.route, analysis)}\n`)
      return 1
    }
    const out =
      args.command === 'explain'
        ? formatExplainRoute(route, analysis)
        : formatWhyJsRoute(route, analysis)
    process.stdout.write(`${out}\n`)
    return 0
  }

  // No route filter.
  if (args.command === 'explain') {
    process.stdout.write(`${formatExplainAll(analysis)}\n`)
    return 0
  }
  // `why-js` with no route — apply it to every route in turn.
  const blocks = analysis.routes.map((r) => formatWhyJsRoute(r, analysis))
  process.stdout.write(`${blocks.join('\n\n')}\n`)
  return 0
}

// Run when invoked directly (Bun's bin entry).
if (import.meta.main) {
  main().then(process.exit, (err) => {
    process.stderr.write(`unexpected error: ${(err as Error).stack ?? err}\n`)
    process.exit(1)
  })
}
