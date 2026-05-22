// CLI argument parsing + prompt helpers.
//
// Hand-rolled (no inquirer/prompts dep) — keeps the scaffolder
// hermetic, no install-time dependencies. Bun's stdout/stdin work
// unchanged from Node.

export interface CreateAppArgs {
  /** Project name (positional). Empty until parsed/prompted. */
  name: string
  /** Resolved target directory. Defaults to `./<name>`. */
  targetDir: string
  /** Template name. Default: 'minimal'. */
  template: string
  /** Skip `bun install` after scaffolding. */
  skipInstall: boolean
  /** Skip prompts, accept defaults for missing values. */
  yes: boolean
  /** Show usage and exit. */
  help: boolean
}

export const USAGE = `Usage: bunx @place-ts/create-app <name> [options]

Arguments:
  <name>             Project name. Becomes the directory and the
                     "name" field in package.json.

Options:
  --template <name>  Template to scaffold. Default: minimal.
                     Available: minimal.
  --no-install       Skip running 'bun install' after scaffolding.
  --yes              Skip prompts; use defaults for any missing args.
                     Required when stdin is not a TTY (CI, etc.).
  --help             Show this message.

Example:
  bunx @place-ts/create-app my-blog
  bunx @place-ts/create-app my-app --template minimal --no-install --yes
`

export function parseArgs(argv: string[]): CreateAppArgs {
  const out: CreateAppArgs = {
    name: '',
    targetDir: '',
    template: 'minimal',
    skipInstall: false,
    yes: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? ''
    if (a === '--help' || a === '-h') {
      out.help = true
      continue
    }
    if (a === '--no-install') {
      out.skipInstall = true
      continue
    }
    if (a === '--yes' || a === '-y') {
      out.yes = true
      continue
    }
    if (a === '--template') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--template requires a value')
      out.template = v
      continue
    }
    if (a.startsWith('--template=')) {
      out.template = a.slice('--template='.length)
      continue
    }
    if (a.startsWith('--')) {
      throw new Error(`unknown option: ${a}`)
    }
    // First non-flag argument = project name.
    if (out.name === '') {
      out.name = a
      continue
    }
    throw new Error(`unexpected positional argument: ${a}`)
  }
  if (out.name) out.targetDir = out.name
  return out
}

/**
 * Validates a project name. Same rules as npm: 1-214 chars, lowercase,
 * no spaces, no leading dot/underscore. Returns null on valid; an
 * error message string on invalid.
 */
export function validateName(name: string): string | null {
  if (name.length === 0) return 'name cannot be empty'
  if (name.length > 214) return 'name must be 214 characters or fewer'
  if (name !== name.toLowerCase()) return 'name must be lowercase'
  if (/\s/.test(name)) return 'name cannot contain whitespace'
  if (/^[._]/.test(name)) return 'name cannot start with . or _'
  // Match npm's permissive set.
  if (!/^[a-z0-9@/._-]+$/.test(name)) {
    return 'name contains invalid characters (allowed: a-z 0-9 @ / . _ -)'
  }
  return null
}

/**
 * Fill in missing args via prompts (when stdin is a TTY) or fail with
 * a helpful error (when not). Mutates a copy and returns it.
 *
 * Currently the only required arg is `name`; everything else has a
 * default. When the user passes `--yes` or stdin isn't a TTY, we
 * require the name on the command line — no interactive prompt.
 *
 * **Current-directory mode (0.9.1)**: `<name> = '.'` scaffolds into
 * the current working directory and uses the directory's basename as
 * the package name. Matches `npm create vite@latest .` UX. The empty
 * non-empty target-dir check still applies (refuse to overwrite).
 */
export async function promptForMissing(args: CreateAppArgs): Promise<CreateAppArgs> {
  const out = { ...args }
  const isTty = !!process.stdin.isTTY

  if (out.name === '') {
    if (out.yes || !isTty) {
      throw new Error(
        'project name is required. Either pass it as the first positional argument ' +
          'or run interactively (TTY) without --yes.',
      )
    }
    out.name = await prompt('Project name: ')
  }

  // `.` is a special name meaning "scaffold here". Derive the package
  // name from the cwd's basename and set the target dir to '.'. The
  // package name still must validate; if the cwd's basename has
  // unfriendly characters, slugify it.
  if (out.name === '.') {
    const cwd = typeof process !== 'undefined' ? process.cwd() : '.'
    const baseRaw = cwd.split(/[/\\]/).pop() ?? 'place-app'
    // Apply the same npm-style normalization as validateName expects.
    const slug = baseRaw
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[._]+/, '')
      .replace(/-+$/g, '')
    out.name = slug.length > 0 ? slug : 'place-app'
    out.targetDir = '.'
  }

  const nameError = validateName(out.name)
  if (nameError !== null) {
    throw new Error(`invalid project name '${out.name}': ${nameError}`)
  }
  if (out.targetDir === '') out.targetDir = out.name
  return out
}

/**
 * Read a single line from stdin. Bun + Node both expose `process.stdin`
 * as an async iterator of Buffers; we convert to UTF-8 and trim.
 */
async function prompt(question: string): Promise<string> {
  process.stdout.write(question)
  const reader = (process.stdin as unknown as AsyncIterable<Buffer>)[Symbol.asyncIterator]()
  let acc = ''
  while (true) {
    const next = await reader.next()
    if (next.done) break
    const chunk = next.value.toString('utf-8')
    acc += chunk
    if (chunk.includes('\n')) break
  }
  return acc.split(/\r?\n/)[0]?.trim() ?? ''
}
