#!/usr/bin/env bun
// Replace every `workspace:*` dep value in every workspace
// package.json with `^<current version>` of the target package.
//
// **Why this exists**: `bun pack` + `npm publish` do NOT rewrite the
// `workspace:` protocol — the published manifest carries `workspace:*`
// literally, and users who install from npm get
//   `error: Workspace dependency "@place-ts/component" not found`.
// (`bun publish` rewrites automatically, but the rest of the ecosystem
// uses `npm publish` for hooks like `prepublishOnly`.)
//
// **Workflow**:
//   1. From repo root: `bun scripts/prep-publish.ts --apply`
//   2. Publish each package: `cd systems/<name> && npm publish` (etc).
//   3. Revert in-place rewrites: `git checkout systems tools`
//
// Or use `scripts/publish-all.sh` (a thin wrapper that does all three).
//
// Dry run by default so accidental invocations print but don't write.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Pkg {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const REPO = join(import.meta.dir, '..')
const APPLY = process.argv.includes('--apply')

const findWorkspacePackages = (root: string): { path: string; pkg: Pkg }[] => {
  const out: { path: string; pkg: Pkg }[] = []
  for (const subdir of ['systems', 'tools']) {
    const dir = join(root, subdir)
    for (const name of readdirSync(dir)) {
      const childDir = join(dir, name)
      if (!statSync(childDir).isDirectory()) continue
      const pkgPath = join(childDir, 'package.json')
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Pkg
        out.push({ path: pkgPath, pkg })
      } catch {
        // Not a package — skip.
      }
    }
  }
  return out
}

const all = findWorkspacePackages(REPO)
const versionByName = new Map<string, string>()
for (const { pkg } of all) {
  if (pkg.name && pkg.version) versionByName.set(pkg.name, pkg.version)
}

interface Rewrite {
  pkgName: string
  section: 'dependencies' | 'devDependencies' | 'peerDependencies'
  depName: string
  from: string
  to: string
}

const rewrites: Rewrite[] = []
for (const { path, pkg } of all) {
  const sections: Array<'dependencies' | 'devDependencies' | 'peerDependencies'> = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
  ]
  let modified = false
  for (const sec of sections) {
    const deps = pkg[sec]
    if (!deps) continue
    for (const [depName, value] of Object.entries(deps)) {
      if (value === 'workspace:*' || value.startsWith('workspace:')) {
        const targetVersion = versionByName.get(depName)
        if (!targetVersion) {
          console.error(
            `[prep-publish] ${pkg.name}: ${depName} is "${value}" but no workspace package with that name found.`,
          )
          continue
        }
        const newValue = `^${targetVersion}`
        rewrites.push({
          pkgName: pkg.name ?? '<unknown>',
          section: sec,
          depName,
          from: value,
          to: newValue,
        })
        deps[depName] = newValue
        modified = true
      }
    }
  }
  if (modified && APPLY) {
    writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`)
  }
}

if (rewrites.length === 0) {
  console.log('[prep-publish] no workspace:* deps found — nothing to rewrite.')
  process.exit(0)
}

console.log(`[prep-publish] ${APPLY ? 'rewrote' : 'would rewrite'} ${rewrites.length} dep values:`)
const byPkg = new Map<string, Rewrite[]>()
for (const r of rewrites) {
  const list = byPkg.get(r.pkgName) ?? []
  list.push(r)
  byPkg.set(r.pkgName, list)
}
for (const [pkgName, list] of byPkg) {
  console.log(`  ${pkgName}:`)
  for (const r of list) {
    console.log(`    ${r.section}.${r.depName}: ${r.from} → ${r.to}`)
  }
}

if (!APPLY) {
  console.log('')
  console.log('Dry run. Re-run with --apply to write the changes:')
  console.log('  bun scripts/prep-publish.ts --apply')
  console.log('Then publish each package and revert via `git checkout systems tools`.')
}
