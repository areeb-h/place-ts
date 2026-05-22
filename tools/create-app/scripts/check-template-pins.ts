#!/usr/bin/env bun
// Guard against template-version drift. Every template layer's
// package.json pins `@place-ts/*` deps with a caret range; if a
// system's version bumps without the layer being updated, users hit
// `error: No version matching "^X.Y.Z" found for specifier ...` at
// scaffold-install time. We already shipped that bug once.
//
// This script walks every `@place-ts/*` dependency in EVERY layer of
// `templates/` (base + each variant + each feature) and asserts the
// caret range still matches the corresponding system's MAJOR.MINOR.
// Fails CI on any drift, naming every offending layer + key.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

interface PkgJson {
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const REPO = join(import.meta.dir, '..', '..', '..')
const TEMPLATES = join(REPO, 'tools', 'create-app', 'templates')

const layerPackageJsons: { layer: string; path: string }[] = []

const collectLayerPkgs = (root: string, label: string): void => {
  const pkg = join(root, 'package.json')
  if (existsSync(pkg)) layerPackageJsons.push({ layer: label, path: pkg })
}

// base
collectLayerPkgs(join(TEMPLATES, 'base'), 'base')

// variants
const variantsDir = join(TEMPLATES, 'variants')
if (existsSync(variantsDir)) {
  for (const name of readdirSync(variantsDir)) {
    const dir = join(variantsDir, name)
    if (statSync(dir).isDirectory()) collectLayerPkgs(dir, `variant:${name}`)
  }
}

// features
const featuresDir = join(TEMPLATES, 'features')
if (existsSync(featuresDir)) {
  for (const name of readdirSync(featuresDir)) {
    const dir = join(featuresDir, name)
    if (statSync(dir).isDirectory()) collectLayerPkgs(dir, `feature:${name}`)
  }
}

const drifts: string[] = []
let checkedRanges = 0

for (const { layer, path } of layerPackageJsons) {
  const pkg = JSON.parse(readFileSync(path, 'utf-8')) as PkgJson
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  }
  for (const [name, range] of Object.entries(deps)) {
    if (!name.startsWith('@place-ts/')) continue
    const sysName = name.slice('@place-ts/'.length)
    const sysPkgPath = join(REPO, 'systems', sysName, 'package.json')
    let sysPkg: PkgJson
    try {
      sysPkg = JSON.parse(readFileSync(sysPkgPath, 'utf-8')) as PkgJson
    } catch {
      drifts.push(`[${layer}] ${name} pinned, but no systems/${sysName}/package.json exists`)
      continue
    }
    checkedRanges++
    const cleanRange = range.replace(/^\^/, '')
    const [tplMaj, tplMin] = cleanRange.split('.')
    const sysVersion = sysPkg.version ?? ''
    const [sysMaj, sysMin] = sysVersion.split('.')
    if (tplMaj !== sysMaj || tplMin !== sysMin) {
      drifts.push(
        `[${layer}] ${name}: pins '${range}' but actual version is '${sysVersion}' — minor/major mismatch`,
      )
    }
  }
}

if (drifts.length > 0) {
  console.error('TEMPLATE VERSION DRIFT — fix template package.json files before publishing:')
  for (const d of drifts) console.error(`  - ${d}`)
  console.error(
    "\nEvery layer's package.json must pin '@place-ts/*' caret ranges to the system's current MAJOR.MINOR.",
  )
  process.exit(1)
}

console.log(
  `template-version-pins OK — ${checkedRanges} pins across ${layerPackageJsons.length} layers match current versions`,
)
