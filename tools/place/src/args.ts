// CLI argument parsing for `place`.
//
// Hand-rolled — no parser dependency, mirroring `@place-ts/create-app`.
// The grammar is tiny: `place <command> [route] [options]`.

/** The two diagnostic subcommands. */
export type Command = 'explain' | 'why-js'

export interface PlaceArgs {
  /** The subcommand. `null` until parsed (or when `--help` is set). */
  command: Command | null
  /** Optional route filter — a single route path like `/api/app`.
   *  When omitted, the command operates over every route. */
  route: string | null
  /** Static-export directory to analyze. Default: `./dist`. */
  distDir: string
  /** Path to `view-manifest.json`. Default: the conventional location. */
  manifestPath: string
  /** Show usage and exit. */
  help: boolean
}

/** The conventional manifest location, written by the island bundler. */
export const DEFAULT_MANIFEST = './.place/island-entries/view-manifest.json'

export const USAGE = `place — what JavaScript does each route ship, and why?

Usage: place <command> [route] [options]

Commands:
  explain [route]   Report the JavaScript shipped per route. With no
                    route, prints a table of every route; with a
                    route, prints the per-script breakdown.
  why-js  [route]   Explain WHY each route ships the JavaScript it
                    does — names the island and the effect that
                    forced a client bundle.

Options:
  --dist <dir>      Static-export directory to analyze.
                    Default: ./dist
  --manifest <file> Path to view-manifest.json (classifier output).
                    Default: ${DEFAULT_MANIFEST}
  --help            Show this message.

Run a production build first ('bun run build'); place reads its
output. A route that ships zero JavaScript is the goal — place makes
that visible.

Examples:
  place explain                 Table of every route's JS cost.
  place explain /api/components Per-script breakdown for one route.
  place why-js /                Why the home page ships what it does.
`

export function parseArgs(argv: string[]): PlaceArgs {
  const out: PlaceArgs = {
    command: null,
    route: null,
    distDir: './dist',
    manifestPath: DEFAULT_MANIFEST,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? ''
    if (a === '--help' || a === '-h') {
      out.help = true
      continue
    }
    if (a === '--dist') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--dist requires a value')
      out.distDir = v
      continue
    }
    if (a.startsWith('--dist=')) {
      out.distDir = a.slice('--dist='.length)
      continue
    }
    if (a === '--manifest') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--manifest requires a value')
      out.manifestPath = v
      continue
    }
    if (a.startsWith('--manifest=')) {
      out.manifestPath = a.slice('--manifest='.length)
      continue
    }
    if (a.startsWith('-')) {
      throw new Error(`unknown option: ${a}`)
    }
    // First positional = command; second = route filter.
    if (out.command === null) {
      if (a !== 'explain' && a !== 'why-js') {
        throw new Error(`unknown command: '${a}' (expected 'explain' or 'why-js')`)
      }
      out.command = a
      continue
    }
    if (out.route === null) {
      // Normalize: a route always starts with `/`.
      out.route = a.startsWith('/') ? a : `/${a}`
      continue
    }
    throw new Error(`unexpected argument: ${a}`)
  }
  return out
}
