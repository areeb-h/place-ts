#!/usr/bin/env bun
// Guard against template-version drift. The minimal template pins each
// `@place-ts/*` dep with a caret range. Every time we bump a system's
// version, that pin can fall behind — and the failure only surfaces
// downstream (a user's `bunx @place-ts/create-app .` install). We
// already shipped that bug once.
//
// This script walks every `@place-ts/*` dependency in the minimal
// template's package.json and asserts the caret range still satisfies
// the actual current version of that system. Fails CI on drift.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface PkgJson {
  version: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const REPO = join(import.meta.dir, '..', '..', '..')
const TEMPLATE = join(REPO, 'tools', 'create-app', 'templates', 'minimal', 'package.json')

const template = JSON.parse(readFileSync(TEMPLATE, 'utf-8')) as PkgJson
const allDeps = { ...(template.dependencies ?? {}), ...(template.devDependencies ?? {}) }

const drifts: string[] = []
for (const [name, range] of Object.entries(allDeps)) {
  if (!name.startsWith('@place-ts/')) continue
  const sysName = name.slice('@place-ts/'.length)
  const sysPkgPath = join(REPO, 'systems', sysName, 'package.json')
  let sysPkg: PkgJson
  try {
    sysPkg = JSON.parse(readFileSync(sysPkgPath, 'utf-8')) as PkgJson
  } catch {
    drifts.push(`${name} in template, but no systems/${sysName}/package.json exists`)
    continue
  }
  // Caret range: `^X.Y.Z` satisfies any version >=X.Y.Z and <X+1.0.0
  // (or for 0.x, <0.Y+1.0). The drift we care about is when the
  // template's caret range no longer matches the system's MINOR. We
  // check exact MAJOR.MINOR equality — patch differences are fine
  // (template can ship before a patch bump; users get the patch on
  // install).
  const cleanRange = range.replace(/^\^/, '')
  const [tplMaj, tplMin] = cleanRange.split('.')
  const [sysMaj, sysMin] = sysPkg.version.split('.')
  if (tplMaj !== sysMaj || tplMin !== sysMin) {
    drifts.push(
      `${name}: template pins '${range}' but actual version is '${sysPkg.version}' — minor/major mismatch`,
    )
  }
}

if (drifts.length > 0) {
  console.error('TEMPLATE VERSION DRIFT — fix template package.json before publishing:')
  for (const d of drifts) console.error(`  - ${d}`)
  console.error(
    "\nThe minimal template ships with caret ranges that must satisfy each system's current version.",
  )
  console.error(`Edit ${TEMPLATE} to bump the failing pins.`)
  process.exit(1)
}

console.log(
  `template-version-pins OK — ${Object.keys(allDeps).filter((d) => d.startsWith('@place-ts/')).length} @place-ts/* deps satisfy current versions`,
)
