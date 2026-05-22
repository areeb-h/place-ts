// CLI argument parsing + interactive prompts.
//
// Hand-rolled (no inquirer/prompts dep) — keeps the scaffolder
// hermetic, zero install-time dependencies. Bun's stdout/stdin work
// unchanged from Node.

import { confirm, isPromptCancelled, multiSelect, railLine, select, text } from './prompt.ts'

/**
 * Known variants — kept as a closed enum so unknown values are caught
 * early at parse time. New variants are added by also dropping a
 * `templates/variants/<name>/` directory.
 */
export const VARIANTS = ['minimal', 'content', 'app'] as const
export type Variant = (typeof VARIANTS)[number]

/**
 * Known feature packs — same shape. New features are added by dropping
 * `templates/features/<name>/` plus appending here.
 */
export const FEATURES = ['theme-toggle', 'tests', 'ci', 'design-system', 'persistence'] as const
export type Feature = (typeof FEATURES)[number]

/**
 * Per-variant default features. Picking a variant non-interactively
 * (via `--template foo --yes`) inherits these unless `--without` is
 * passed.
 */
export const DEFAULT_FEATURES: Record<Variant, readonly Feature[]> = {
  minimal: ['theme-toggle'],
  content: ['theme-toggle', 'design-system'],
  app: ['theme-toggle', 'design-system', 'persistence'],
}

const FEATURE_LABELS: Record<Feature, string> = {
  'theme-toggle': 'theme toggle',
  tests: 'tests (vitest)',
  ci: 'CI workflow (GitHub Actions)',
  'design-system': 'design system (@place-ts/design)',
  persistence: 'persistence (@place-ts/persistence)',
}

const FEATURE_HINTS: Record<Feature, string> = {
  'theme-toggle': 'light/dark switcher',
  tests: 'sample test + scripts',
  ci: 'typecheck + test on push',
  'design-system': 'Prose, Button, Dialog…',
  persistence: 'localStorage adapter',
}

const VARIANT_LABELS: Record<Variant, string> = {
  minimal: 'minimal',
  content: 'content',
  app: 'app',
}

const VARIANT_HINTS: Record<Variant, string> = {
  minimal: 'barebones — bring your own',
  content: 'blog · docs · wiki — search + posts',
  app: 'interactive — persistence + design',
}

export interface CreateAppArgs {
  /** Project name (positional). Empty until parsed/prompted. */
  name: string
  /** Resolved target directory. Defaults to `./<name>`. */
  targetDir: string
  /** Template variant. Empty string = unresolved (prompt). */
  variant: Variant | ''
  /** Features explicitly requested via `--with`. */
  withFeatures: Feature[]
  /** Features explicitly opted-out via `--without`. */
  withoutFeatures: Feature[]
  /** Skip `bun install` after scaffolding. */
  skipInstall: boolean
  /** Skip `git init` after scaffolding. */
  skipGit: boolean
  /** Skip prompts, accept defaults for missing values. */
  yes: boolean
  /** Print templates + features list and exit. */
  list: boolean
  /** Show usage and exit. */
  help: boolean
}

export const USAGE = `Usage: bunx @place-ts/create-app <name> [options]

Arguments:
  <name>                Project name. Use '.' to scaffold into the
                        current directory.

Options:
  --template <name>     One of: minimal | content | app
                        Default: prompt.
  --with <feature>      Add an optional feature (repeatable).
  --without <feature>   Remove a default-on feature (repeatable).
  --no-install          Skip 'bun install' after scaffolding.
  --no-git              Skip 'git init' after scaffolding.
  --yes / -y            Skip prompts; use defaults.
  --list                Print available templates + features.
  --help / -h           Show this message.

Templates:
  minimal     barebones — bring your own
  content     blog · docs · wiki — search + posts
  app         interactive — persistence + design system

Features:
  theme-toggle    light/dark switcher
  tests           vitest + sample test
  ci              GitHub Actions workflow
  design-system   @place-ts/design (Prose, Button, …)
  persistence     localStorage / IndexedDB adapter

Examples:
  bunx @place-ts/create-app my-blog --template content
  bunx @place-ts/create-app . --template app --with tests --with ci
  bunx @place-ts/create-app --list
`

const isFeature = (s: string): s is Feature => (FEATURES as readonly string[]).includes(s)
const isVariant = (s: string): s is Variant => (VARIANTS as readonly string[]).includes(s)

export function parseArgs(argv: string[]): CreateAppArgs {
  const out: CreateAppArgs = {
    name: '',
    targetDir: '',
    variant: '',
    withFeatures: [],
    withoutFeatures: [],
    skipInstall: false,
    skipGit: false,
    yes: false,
    list: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? ''
    if (a === '--help' || a === '-h') {
      out.help = true
      continue
    }
    if (a === '--list') {
      out.list = true
      continue
    }
    if (a === '--no-install') {
      out.skipInstall = true
      continue
    }
    if (a === '--no-git') {
      out.skipGit = true
      continue
    }
    if (a === '--yes' || a === '-y') {
      out.yes = true
      continue
    }
    if (a === '--template' || a === '--template=' || a.startsWith('--template=')) {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i]
      if (v === undefined || v.length === 0) throw new Error('--template requires a value')
      if (!isVariant(v)) {
        throw new Error(`unknown template '${v}'. Valid templates: ${VARIANTS.join(', ')}`)
      }
      out.variant = v
      continue
    }
    if (a === '--with' || a.startsWith('--with=')) {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i]
      if (v === undefined || v.length === 0) throw new Error('--with requires a value')
      if (!isFeature(v)) {
        throw new Error(`unknown feature '${v}'. Valid features: ${FEATURES.join(', ')}`)
      }
      if (!out.withFeatures.includes(v)) out.withFeatures.push(v)
      continue
    }
    if (a === '--without' || a.startsWith('--without=')) {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i]
      if (v === undefined || v.length === 0) throw new Error('--without requires a value')
      if (!isFeature(v)) {
        throw new Error(`unknown feature '${v}'. Valid features: ${FEATURES.join(', ')}`)
      }
      if (!out.withoutFeatures.includes(v)) out.withoutFeatures.push(v)
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

/** Validates a project name. Same rules as npm. */
export function validateName(name: string): string | null {
  if (name.length === 0) return 'name cannot be empty'
  if (name.length > 214) return 'name must be 214 characters or fewer'
  if (name !== name.toLowerCase()) return 'name must be lowercase'
  if (/\s/.test(name)) return 'name cannot contain whitespace'
  if (/^[._]/.test(name)) return 'name cannot start with . or _'
  if (!/^[a-z0-9@/._-]+$/.test(name)) {
    return 'name contains invalid characters (allowed: a-z 0-9 @ / . _ -)'
  }
  return null
}

/**
 * Slugify a directory basename into a valid package name. Used when the
 * user passes `.` and we derive the name from cwd.
 */
export function slugifyBasename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._]+/, '')
    .replace(/-+$/g, '')
  return slug.length > 0 ? slug : 'place-app'
}

/**
 * Compute the final feature set for a variant. Starts from
 * `DEFAULT_FEATURES[variant]`, adds `withFeatures`, removes
 * `withoutFeatures`. De-duplicates and preserves insertion order
 * (defaults first, then explicit `--with` additions at the end).
 */
export function resolveFeatures(
  variant: Variant,
  withFeatures: readonly Feature[],
  withoutFeatures: readonly Feature[],
): Feature[] {
  const out: Feature[] = []
  for (const f of DEFAULT_FEATURES[variant]) {
    if (!withoutFeatures.includes(f)) out.push(f)
  }
  for (const f of withFeatures) {
    if (!out.includes(f) && !withoutFeatures.includes(f)) out.push(f)
  }
  return out
}

/**
 * Fill in missing args via prompts (when stdin is a TTY) or fail with
 * a helpful error (when not). Mutates a copy and returns it.
 *
 * **Current-directory mode**: `<name> = '.'` scaffolds into the
 * current working directory and uses the directory's basename as the
 * package name.
 */
export async function promptForMissing(args: CreateAppArgs): Promise<CreateAppArgs> {
  const out = { ...args }
  const isTty = !!process.stdin.isTTY
  const interactive = isTty && !out.yes

  // 1. Project name.
  if (out.name === '') {
    if (!interactive) {
      throw new Error(
        'project name is required. Either pass it as the first positional argument ' +
          'or run interactively (TTY) without --yes.',
      )
    }
    try {
      out.name = await text('Project name', {
        validate: (s) => {
          if (s.length === 0) return 'name cannot be empty'
          if (s === '.') return null
          return validateName(s)
        },
      })
    } catch (err) {
      if (isPromptCancelled(err)) throw new Error('cancelled')
      throw err
    }
  }

  // Handle '.' (current-dir scaffold).
  if (out.name === '.') {
    const cwd = typeof process !== 'undefined' ? process.cwd() : '.'
    const baseRaw = cwd.split(/[/\\]/).pop() ?? 'place-app'
    out.name = slugifyBasename(baseRaw)
    out.targetDir = '.'
  }

  const nameError = validateName(out.name)
  if (nameError !== null) {
    throw new Error(`invalid project name '${out.name}': ${nameError}`)
  }
  if (out.targetDir === '') out.targetDir = out.name

  // 2. Template variant.
  if (out.variant === '') {
    if (!interactive) {
      out.variant = 'minimal' // sensible default for --yes
    } else {
      railLine()
      try {
        const chosen = await select(
          'Template?',
          VARIANTS.map((v) => ({ value: v, label: VARIANT_LABELS[v], hint: VARIANT_HINTS[v] })),
        )
        out.variant = chosen as Variant
      } catch (err) {
        if (isPromptCancelled(err)) throw new Error('cancelled')
        throw err
      }
    }
  }

  // 3. Feature picker. Only interactive — for non-interactive
  // invocations, the variant's defaults apply unless --with / --without
  // override.
  if (interactive && out.withFeatures.length === 0 && out.withoutFeatures.length === 0) {
    railLine()
    try {
      const defaults = DEFAULT_FEATURES[out.variant as Variant]
      const picked = await multiSelect(
        'Add features?',
        FEATURES.map((f) => ({
          value: f,
          label: FEATURE_LABELS[f],
          hint: FEATURE_HINTS[f],
        })),
        { defaultChecked: defaults },
      )
      // Translate the multi-select result into with/without diffs
      // relative to the variant's defaults — minimal CLI flag echoing.
      const defaultSet = new Set<string>(defaults)
      out.withFeatures = picked.filter((f) => !defaultSet.has(f)) as Feature[]
      out.withoutFeatures = defaults.filter((f) => !picked.includes(f)) as Feature[]
    } catch (err) {
      if (isPromptCancelled(err)) throw new Error('cancelled')
      throw err
    }
  }

  return out
}
