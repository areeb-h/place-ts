#!/usr/bin/env bun
// `bunx @place-ts/create-app <name>` — the place-ts scaffolder.
//
// Layered template architecture (see scaffold.ts): base → variant
// (minimal | content | app) → features (theme-toggle, tests, ci,
// design-system, persistence). Inline templates (no degit-style
// fetch) keep the scaffolder hermetic, version-locked, offline-capable.
//
// CLI surface lives in args.ts (parseArgs + promptForMissing + flag
// types). Interactive prompts live in prompt.ts. The composition
// algorithm lives in scaffold.ts. This file orchestrates them and
// emits the user-facing status.

import { existsSync, readdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  type CreateAppArgs,
  DEFAULT_FEATURES,
  FEATURES,
  parseArgs,
  promptForMissing,
  resolveFeatures,
  USAGE,
  VARIANTS,
  type Variant,
} from './args.ts'
import { composeScaffold, enumerateTemplateOutputs } from './scaffold.ts'
import { bold, cyan, dim, gray, green, magenta, red, symbols } from './style.ts'

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: CreateAppArgs
  try {
    args = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${USAGE}\n`)
    return 2
  }

  if (args.help) {
    process.stdout.write(`${USAGE}\n`)
    return 0
  }

  if (args.list) {
    process.stdout.write(formatListing())
    return 0
  }

  let filled: CreateAppArgs
  try {
    filled = await promptForMissing(args)
  } catch (err) {
    const msg = (err as Error).message
    if (msg === 'cancelled') {
      process.stderr.write(`\n${red(symbols.err)}  cancelled\n`)
      return 130
    }
    process.stderr.write(`${red(symbols.err)}  ${msg}\n`)
    return 1
  }

  const variant = filled.variant as Variant
  const features = resolveFeatures(variant, filled.withFeatures, filled.withoutFeatures)
  const targetPath = resolve(filled.targetDir)
  const intoCurrentDir = filled.targetDir === '.'

  const here = dirname(fileURLToPath(import.meta.url))
  const templatesRoot = resolve(here, '..', 'templates')

  if (existsSync(targetPath)) {
    if (intoCurrentDir) {
      const outputs = enumerateTemplateOutputs({
        templatesRoot,
        target: targetPath,
        appName: filled.name,
        variant,
        features,
      })
      const conflicts = outputs.filter((rel) => existsSync(resolve(targetPath, rel)))
      if (conflicts.length > 0) {
        process.stderr.write(
          `${red(symbols.err)}  scaffolding into '.' would overwrite ${conflicts.length} existing file(s):\n` +
            conflicts.map((c) => `     - ${c}`).join('\n') +
            `\n\nMove or remove the conflicting files, or scaffold into a fresh directory.\n`,
        )
        return 1
      }
    } else {
      const entries = readdirSync(targetPath)
      if (entries.length > 0) {
        process.stderr.write(
          `${red(symbols.err)}  target directory '${filled.targetDir}' is not empty (${entries.length} entries). ` +
            'Pick a different name or remove the existing directory.\n',
        )
        return 1
      }
    }
  }

  await mkdir(targetPath, { recursive: true })

  // ◆  Scaffolding <name> (<variant> + <features>)
  const featList = features.length > 0 ? ` + ${features.join(' + ')}` : ''
  process.stdout.write(
    `\n${magenta(symbols.done)}  ${bold(`Scaffolding ${filled.name}`)} ${dim(`(${variant}${featList})`)}\n\n`,
  )

  const result = await composeScaffold({
    templatesRoot,
    target: targetPath,
    appName: filled.name,
    variant,
    features,
  })

  process.stdout.write(
    `   ${green(symbols.ok)} ${result.filesWritten.length} files written` +
      (result.patchesApplied.length > 0
        ? dim(`, ${result.patchesApplied.length} patches applied`)
        : '') +
      `\n`,
  )

  if (!filled.skipInstall) {
    process.stdout.write(`   ${dim('› installing dependencies (bun install)…')}\n`)
    const t0 = Date.now()
    const proc = Bun.spawn(['bun', 'install'], {
      cwd: targetPath,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const code = await proc.exited
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text()
      process.stderr.write(
        `\n${red(symbols.err)}  bun install failed (exit ${code}):\n${stderr}\n` +
          dim(`Skip install with --no-install and run it manually.\n`),
      )
      return code
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
    process.stdout.write(`   ${green(symbols.ok)} bun install ${dim(`(${elapsed}s)`)}\n`)
  }

  if (!filled.skipGit) {
    const gitDir = resolve(targetPath, '.git')
    if (existsSync(gitDir)) {
      process.stdout.write(`   ${dim('› git: already initialized — skipped')}\n`)
    } else {
      const proc = Bun.spawn(['git', 'init'], {
        cwd: targetPath,
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const code = await proc.exited
      if (code === 0) {
        process.stdout.write(`   ${green(symbols.ok)} git init\n`)
      } else {
        // Non-fatal — `git` may not be installed in some containers.
        process.stdout.write(`   ${dim('› git init unavailable — skipped')}\n`)
      }
    }
  }

  // Final next-steps block.
  process.stdout.write(`\n${green(symbols.ok)}  ${bold('Done')} — open with:\n\n`)
  if (!intoCurrentDir) {
    process.stdout.write(`   ${cyan(`cd ${filled.name}`)}\n`)
  }
  process.stdout.write(`   ${cyan('bun dev')}\n\n`)
  process.stdout.write(`   ${dim('Docs   ')}${gray('https://github.com/areeb-h/place-ts')}\n\n`)
  return 0
}

function formatListing(): string {
  const lines: string[] = []
  lines.push('')
  lines.push(`${bold('Templates')}`)
  for (const v of VARIANTS) {
    const defaults = DEFAULT_FEATURES[v]
    lines.push(`  ${magenta(v.padEnd(12))} ${dim(`defaults: ${defaults.join(', ') || '(none)'}`)}`)
  }
  lines.push('')
  lines.push(`${bold('Features')}`)
  for (const f of FEATURES) {
    lines.push(`  ${cyan(f.padEnd(16))}`)
  }
  lines.push('')
  return lines.join('\n')
}

// Run if invoked directly (Bun's bin entry).
if (import.meta.main) {
  main().then(process.exit, (err) => {
    process.stderr.write(`unexpected error: ${(err as Error).stack ?? err}\n`)
    process.exit(1)
  })
}
