#!/usr/bin/env bun
// `bunx @place-ts/create-app <name>` — minimal-viable scaffolder.
//
// Design (per research-img-vt-cli.md gap 3):
//   - Inline templates (templates/ directory in this package), not
//     degit-style fetch — hermetic, version-locked, offline-capable.
//   - TTY detection: prompts only when stdin is a real TTY; non-TTY
//     contexts (CI, IDE terminals piping stdin) require all answers
//     as flags.
//   - One template ('minimal') initially; --template hook reserved for
//     future commonplace/sandbox templates.
//   - Refuses to overwrite a non-empty target. Match `npm create vite`
//     UX — no clever overwrite logic.
//   - No `upgrade`/`migrate` subcommand. Per the stability covenant,
//     migration tooling lives in a separate package if it's ever needed.

import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type CreateAppArgs, parseArgs, promptForMissing, USAGE } from './args.ts'

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

  // TTY-aware prompts. Skipped when --yes or non-interactive.
  const filled = await promptForMissing(args)

  const targetPath = resolve(filled.targetDir)

  if (existsSync(targetPath)) {
    const entries = readdirSync(targetPath)
    if (entries.length > 0) {
      process.stderr.write(
        `error: target directory '${filled.targetDir}' is not empty (${entries.length} entries). ` +
          'Pick a different name or remove the existing directory.\n',
      )
      return 1
    }
  }

  await mkdir(targetPath, { recursive: true })

  const here = dirname(fileURLToPath(import.meta.url))
  const templatePath = resolve(here, '..', 'templates', filled.template)
  if (!existsSync(templatePath)) {
    process.stderr.write(`error: template '${filled.template}' not found at ${templatePath}\n`)
    return 1
  }

  await copyTemplate(templatePath, targetPath, filled.name)

  process.stdout.write(`\n  ✓ created ${filled.name} at ${targetPath}\n`)

  if (!filled.skipInstall) {
    process.stdout.write('  → installing dependencies (bun install)…\n')
    const proc = Bun.spawn(['bun', 'install'], {
      cwd: targetPath,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const code = await proc.exited
    if (code !== 0) {
      process.stderr.write(
        '\nerror: bun install failed. Skip installation with --no-install and run it manually.\n',
      )
      return code
    }
  }

  process.stdout.write(
    `\nDone. Next steps:\n\n  cd ${filled.name}\n  bun dev\n\nDocs: https://github.com/areeb-h/place-ts\n`,
  )
  return 0
}

/**
 * Recursively copy template files into the target. Substitutes
 * `__APP_NAME__` in file contents (e.g. package.json's "name") with
 * the project name. No mustache, no full template engine — one token
 * suffices for the minimum viable case. Exported for tests.
 */
export async function copyTemplate(
  templatePath: string,
  targetPath: string,
  appName: string,
): Promise<void> {
  const entries = readdirSync(templatePath, { withFileTypes: true })
  for (const e of entries) {
    const srcPath = join(templatePath, e.name)
    const destPath = join(targetPath, e.name)
    if (e.isDirectory()) {
      await mkdir(destPath, { recursive: true })
      await copyTemplate(srcPath, destPath, appName)
      continue
    }
    if (e.isFile()) {
      const stat = statSync(srcPath)
      // Skip extreme-size files defensively; templates shouldn't have
      // multi-MB files.
      if (stat.size > 1_000_000) continue
      const text = await readFile(srcPath, 'utf-8')
      const replaced = text.replaceAll('__APP_NAME__', appName)
      await writeFile(destPath, replaced)
    }
  }
}

// Run if invoked directly (Bun's bin entry).
if (import.meta.main) {
  main().then(process.exit, (err) => {
    process.stderr.write(`unexpected error: ${(err as Error).stack ?? err}\n`)
    process.exit(1)
  })
}
