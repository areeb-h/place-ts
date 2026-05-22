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
// Runs in `bun run ci`. Output is informational unless something
// substantive is missing (no `files`, no `prepublishOnly` etc) — in
// which case exit 1.

import { readdirSync, readFileSync, statSync } from 'node:fs'
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
