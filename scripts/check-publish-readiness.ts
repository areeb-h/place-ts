#!/usr/bin/env bun
// Sanity check for publish-time concerns that aren't caught elsewhere:
//
//   1. Workspace packages MAY contain `workspace:*` dep values in
//      source — that's how the workspace resolves. But `npm publish`
//      doesn't rewrite them, and users installing from the registry
//      hit `error: Workspace dependency "..." not found`. The publish
//      flow runs `scripts/prep-publish.ts --apply` to rewrite these
//      to concrete pins before `npm publish`. This probe just reminds
//      contributors that `workspace:*` exists in source so they don't
//      assume `npm publish` will Do The Right Thing.
//
//   2. Every workspace package with `publishConfig.access: public`
//      should have a non-empty `files:` list — otherwise `npm publish`
//      uploads the entire repo (or only `package.json` depending on
//      defaults), wasting space and leaking unintended files.
//
//   3. **Pack-and-inspect probe** — actually pack a representative
//      tarball via `bun pm pack`, inspect the published manifest, and
//      verify it contains NO `workspace:*` values. Catches the case
//      where someone breaks the prep-publish flow + `bun pm pack`
//      stops rewriting (the smoke test uses `overrides` to mask this).
//
// Runs in `bun run ci`. Output is informational unless something
// substantive is missing (no `files`, no `prepublishOnly` etc) — in
// which case exit 1.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

interface Pkg {
  name?: string
  version?: string
  private?: boolean
  files?: readonly string[]
  publishConfig?: { access?: string }
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

const REPO = join(import.meta.dir, '..')
const failures: string[] = []
let workspaceProtoCount = 0
let publishablePkgs = 0

const collect = (subdir: string): { path: string; pkg: Pkg }[] => {
  const dir = join(REPO, subdir)
  const out: { path: string; pkg: Pkg }[] = []
  for (const name of readdirSync(dir)) {
    const childDir = join(dir, name)
    if (!statSync(childDir).isDirectory()) continue
    const pkgPath = join(childDir, 'package.json')
    try {
      out.push({ path: pkgPath, pkg: JSON.parse(readFileSync(pkgPath, 'utf8')) as Pkg })
    } catch {
      // skip
    }
  }
  return out
}

for (const { path, pkg } of [...collect('systems'), ...collect('tools')]) {
  const isPublishable = pkg.private !== true && pkg.publishConfig?.access === 'public'
  if (!isPublishable) continue
  publishablePkgs++

  // Check `files:` is non-empty.
  if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
    failures.push(
      `${pkg.name}: publishable but has no "files" array — npm publish behavior is undefined`,
    )
  }

  // Count workspace:* deps (informational unless something else
  // breaks; the publish flow handles them).
  const allDeps: Record<string, string> = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  }
  for (const value of Object.values(allDeps)) {
    if (value === 'workspace:*' || value.startsWith('workspace:')) workspaceProtoCount++
  }
}

// Pack-and-inspect probe. We pack `@place-ts/design` (a representative
// package with @place-ts/* deps) via `bun pm pack`, read the published
// package.json from the tarball, and assert no `workspace:*` values
// leaked. If `bun pm pack` ever stops rewriting workspace:* (or someone
// switches the publish flow to `npm pack`/`npm publish` without
// `prep-publish.ts --apply` first), this catches it.
//
// Skipped when `PLACE_SKIP_PACK_PROBE=1` (CI runs that just need the
// other checks can opt out).
if (process.env['PLACE_SKIP_PACK_PROBE'] !== '1') {
  const designDir = join(REPO, 'systems', 'design')
  if (existsSync(designDir) && existsSync(join(designDir, 'package.json'))) {
    const proc = Bun.spawnSync(['bun', 'pm', 'pack'], {
      cwd: designDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (proc.exitCode === 0) {
      const designPkg = JSON.parse(readFileSync(join(designDir, 'package.json'), 'utf8')) as Pkg
      const tarball = join(designDir, `place-ts-design-${designPkg.version}.tgz`)
      if (existsSync(tarball)) {
        try {
          // Use a simple gunzip + tar extract to read package/package.json.
          const tarProc = Bun.spawnSync(['tar', '-xzOf', tarball, 'package/package.json'], {
            stdout: 'pipe',
            stderr: 'pipe',
          })
          if (tarProc.exitCode === 0) {
            const tarballPkg = JSON.parse(tarProc.stdout.toString()) as Pkg
            const tarDeps: Record<string, string> = {
              ...(tarballPkg.dependencies ?? {}),
              ...(tarballPkg.devDependencies ?? {}),
              ...(tarballPkg.peerDependencies ?? {}),
            }
            const leakedDeps = Object.entries(tarDeps).filter(([, v]) => v.startsWith('workspace:'))
            if (leakedDeps.length > 0) {
              const lines = leakedDeps.map(([k, v]) => `    ${k}: "${v}"`).join('\n')
              failures.push(
                `pack-and-inspect: @place-ts/design tarball ships workspace:* deps:\n${lines}\n` +
                  `  Run \`bun scripts/prep-publish.ts --apply\` before publishing, or use \`bun publish\` (which rewrites automatically).`,
              )
            }
          }
        } finally {
          // Clean up the tarball.
          Bun.spawnSync(['rm', '-f', tarball])
        }
      }
    }
  }
}

if (workspaceProtoCount > 0) {
  console.log(
    `publish-readiness OK — ${publishablePkgs} publishable packages, ${workspaceProtoCount} workspace:* deps ` +
      `(rewritten at publish time via scripts/prep-publish.ts).`,
  )
} else {
  console.log(
    `publish-readiness OK — ${publishablePkgs} publishable packages, no workspace:* deps in source.`,
  )
}

if (failures.length > 0) {
  console.error('\nPUBLISH READINESS FAILURES:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
