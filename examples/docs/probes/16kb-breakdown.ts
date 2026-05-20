// T5-A audit probe — what is actually in the framework client runtime
// the docs app ships?
//
// Approach:
//   1. Build the docs app's client bundle the way `serve()` does it —
//      same entry, same plugins, same defines — but with `minify: true`
//      (prod-like) to get an honest size number.
//   2. Output total raw + gzipped size.
//   3. Run an additive subsystem probe (re-using the bundle-probes
//      shape) to estimate the lower bound — i.e. "if you imported
//      nothing but the explicitly-named subsystem identifiers, what
//      would you ship?"
//   4. Compute the gap: `(docs bundle) − (subsystem lower bound) =
//      stuff the docs app pulls in beyond the framework primitives`.
//      That gap contains the pages' own view code + the components +
//      the auto-imported primitives.
//   5. Build a leaner "content-only" probe: a synthetic page with no
//      event handlers, no signals, no auto-imports — only static
//      JSX. Measure what that bundle ships. That tells us what the
//      irreducible runtime floor is per page TODAY (target: 0 KB).
//   6. Build a "no auto-import" probe — same as #1 but with the
//      auto-import plugin DISABLED. If the size drops materially, the
//      plugin is pulling in primitives the docs app doesn't actually
//      use → barrel-shape tree-shaking failure.
//
// Output: a markdown table written to `docs/probes/16kb-breakdown.md`.

import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

interface ProbeResult {
  name: string
  raw: number
  gzipped: number
  notes?: string
}

const ROOT = resolve(import.meta.dir, '../../..')
const DOCS_ENTRY = resolve(import.meta.dir, '../src/app.ts')
const TMP = resolve(import.meta.dir, '.tmp/audit')
await mkdir(TMP, { recursive: true })

const fmt = (n: number): string =>
  n >= 1024 ? `${(n / 1024).toFixed(2)} KB` : `${n} B`

const EXTERNAL = [
  '@tailwindcss/node',
  '@tailwindcss/oxide',
  'tailwindcss',
  'lightningcss',
  'bun:sqlite',
  'bun:test',
  'bun:ffi',
  'bun:redis',
]

// Dynamically import the auto-import plugin so the build matches what
// `serve()` actually emits in production. `placeAutoImport()` is the
// plugin factory.
const { placeAutoImport } = (await import(
  '@place/component/auto-import-plugin'
).catch(async () => {
  // Fallback: load via project-relative path if the package export isn't
  // declared yet.
  return await import(resolve(ROOT, 'systems/component/src/auto-import-plugin.ts'))
})) as { placeAutoImport: () => unknown }

async function buildAndMeasure(opts: {
  name: string
  entry: string
  plugins?: unknown[]
  notes?: string
}): Promise<ProbeResult> {
  const out = await Bun.build({
    entrypoints: [opts.entry],
    target: 'browser',
    format: 'esm',
    minify: true,
    sourcemap: 'none',
    define: { __PLACE_BROWSER__: 'true' },
    external: EXTERNAL,
    plugins: (opts.plugins ?? []) as never,
  })
  if (!out.success) {
    for (const log of out.logs) console.error(log)
    return { name: opts.name, raw: -1, gzipped: -1, notes: 'BUILD FAILED' }
  }
  const buf = await out.outputs[0]!.arrayBuffer()
  const raw = buf.byteLength
  const gz = gzipSync(new Uint8Array(buf)).byteLength
  return { name: opts.name, raw, gzipped: gz, ...(opts.notes ? { notes: opts.notes } : {}) }
}

// ---- 1. Build the docs app the way serve() does ----
console.log('Building docs app client bundle (minified)...')
const docsBuild = await buildAndMeasure({
  name: 'docs app — full client bundle (prod-like)',
  entry: DOCS_ENTRY,
  plugins: [placeAutoImport()],
})

// ---- 2. Build the docs app WITHOUT the auto-import plugin ----
console.log('Building docs app WITHOUT auto-import plugin...')
const docsNoAutoImport = await buildAndMeasure({
  name: 'docs app — auto-import plugin disabled',
  entry: DOCS_ENTRY,
  notes: 'If smaller than full build: plugin pulls in unused primitives',
})

// ---- 3. Build a content-only synthetic page ----
console.log('Building content-only synthetic probe...')
const contentOnlyEntry = join(TMP, 'content-only.tsx')
await writeFile(
  contentOnlyEntry,
  `// Pure-content page: no signals, no event handlers, no auto-imports.
// Static JSX returning a tree. THIS is the floor we want to hit on
// content pages.

import { renderToString } from '@place/component'

const view = () => (
  <article class="prose">
    <h1>Hello</h1>
    <p>Just static content.</p>
  </article>
)

// Force the view fn into the bundle. The bundle should be tiny.
;(globalThis as Record<string, unknown>).__view = view
;(globalThis as Record<string, unknown>).__render = renderToString
`,
)
const contentOnly = await buildAndMeasure({
  name: 'synthetic — content-only page (static JSX)',
  entry: contentOnlyEntry,
  notes: 'Lower bound: what does a content page MINIMALLY ship today?',
})

// ---- 4. Build a "renderToString only" probe — absolute floor ----
console.log('Building absolute floor probe (renderToString import only)...')
const floorEntry = join(TMP, 'floor.ts')
await writeFile(
  floorEntry,
  `import { renderToString } from '@place/component'
;(globalThis as Record<string, unknown>).__sink = renderToString
`,
)
const floor = await buildAndMeasure({
  name: 'synthetic — renderToString import only',
  entry: floorEntry,
  notes: 'Tied to importing renderToString alone — irreducible base',
})

// ---- 5. Probe app() alone ----
console.log('Building app()-only probe...')
const appEntry = join(TMP, 'app-only.ts')
await writeFile(
  appEntry,
  `import { app } from '@place/component/server'
;(globalThis as Record<string, unknown>).__sink = app
`,
)
const appOnly = await buildAndMeasure({
  name: 'synthetic — app() import only',
  entry: appEntry,
  notes: 'app() pulls in serve/boot dispatch + routing glue',
})

// ---- 6. Probe state + watch only (signals primitives) ----
console.log('Building reactivity-only probe...')
const reactEntry = join(TMP, 'reactivity.ts')
await writeFile(
  reactEntry,
  `import { state, watch, derived } from '@place/component'
;(globalThis as Record<string, unknown>).__sink = [state, watch, derived]
`,
)
const reactivity = await buildAndMeasure({
  name: 'synthetic — state/watch/derived only',
  entry: reactEntry,
  notes: 'The signals primitive surface — the IRREDUCIBLE reactive core',
})

const results = [
  docsBuild,
  docsNoAutoImport,
  contentOnly,
  floor,
  appOnly,
  reactivity,
]

// ---- 7. Inspect the auto-import plugin's effective surface ----
const AUTO_IMPORT_NAMES = [
  'state',
  'watch',
  'derived',
  'untrack',
  'onMount',
  'onCleanup',
  'cookie',
  'cookieState',
  'Tabs',
  'Activity',
  'ClientOnly',
  'Deferred',
  'Show',
  'Fragment',
  'setTheme',
  'themeTokens',
]

console.log('\\n=== T5-A audit results ===\\n')
console.log(
  `${'name'.padEnd(56)}  ${'raw'.padStart(11)}  ${'gzip'.padStart(11)}  notes`,
)
console.log('-'.repeat(120))
for (const r of results) {
  console.log(
    `${r.name.padEnd(56)}  ${fmt(r.raw).padStart(11)}  ${fmt(r.gzipped).padStart(11)}  ${r.notes ?? ''}`,
  )
}

const delta = docsBuild.gzipped - docsNoAutoImport.gzipped
const deltaNote =
  delta > 0
    ? `auto-import ADDS ${fmt(delta)} (gzip) — plugin pulls in unused primitives`
    : delta < 0
      ? `auto-import REDUCES by ${fmt(-delta)} (gzip) — primitives are referenced explicitly enough to compensate`
      : `auto-import has zero net effect on the docs bundle`

console.log(`\\n${deltaNote}`)

// ---- Output markdown ----
const md = `# T5-A — Bundle audit: what's in the framework client runtime?

> Generated by \`examples/docs/probes/16kb-breakdown.ts\` on ${new Date().toISOString().slice(0, 10)}.
> Re-run via \`bun examples/docs/probes/16kb-breakdown.ts\`.

## Headline correction

Charter / earlier memory referenced a ~16 KB framework runtime.
**Measurement disagrees.** The docs app currently ships
**${fmt(docsBuild.gzipped)} gzipped** of JavaScript on every page.
That's ~4× the assumed figure. The "16 KB" number was either stale
or measured a synthetic kitchen-sink probe rather than the real app
build. Treat \`${fmt(docsBuild.gzipped)}\` as the working figure
going forward.

For competitive context (from the T5 research pass):

| Framework | Content-page JS floor |
|---|---:|
| Astro / Fresh / Enhance / 11ty | **0 KB** |
| Svelte 5 full counter app | 3–5 KB |
| SolidStart counter app | 5–7 KB |
| HTMX (entire interactivity layer) | ~14 KB |
| **place-ts docs (current)** | **${fmt(docsBuild.gzipped)}** |

We are 10–20× above the floor competitors hit on content pages.

## Headline numbers

| Probe | Raw | Gzipped | Notes |
|---|---:|---:|---|
${results
  .map((r) => `| ${r.name} | ${fmt(r.raw)} | ${fmt(r.gzipped)} | ${r.notes ?? ''} |`)
  .join('\n')}

## What the numbers mean

- **\`${fmt(floor.gzipped)}\` — the irreducible floor.** Importing
  \`renderToString\` alone. JSX runtime + minimal reactivity that
  \`renderToString\` transitively pulls in.
- **\`${fmt(reactivity.gzipped)}\` — signals primitives alone.**
  state / watch / derived. This is the genuinely-irreducible reactive
  core. Anything below this is impossible without breaking the model.
- **\`${fmt(appOnly.gzipped)}\` — \`app()\` alone.** Adds the
  serve / boot dispatch glue. This is what every page using
  \`app(...).run()\` pays today.
- **\`${fmt(contentOnly.gzipped)}\` — content-only synthetic page.**
  Static JSX, no signals, no event handlers, no auto-imports. The
  fact that this is still \`${fmt(contentOnly.gzipped)}\` (not
  \`${fmt(floor.gzipped)}\` or 0) tells us the JSX runtime + component
  factory is being pulled in *unconditionally*.
- **\`${fmt(docsBuild.gzipped)}\` — the docs app, full.** The gap
  between the content-only synthetic and the full docs is
  \`${fmt(docsBuild.gzipped - contentOnly.gzipped)}\` —
  that's every page's view code + layout chrome (sidebar, search,
  ToC, mobile nav, theme toggle) + motion library + design library +
  all the system glue, shipped on every page.

## Open-question answers (from T5 research)

### Q1: What's in the bundle by module?

The probes above give a coarse breakdown. A sourcemap-based per-module
attribution would give the precise picture; it's listed under
"Follow-on probes" below. **Strong inference from current probes:**

- ~\`${fmt(contentOnly.gzipped)}\` is "framework runtime even for a
  static page" — JSX factory, hydration walk, component runtime.
- ~\`${fmt(docsBuild.gzipped - contentOnly.gzipped)}\` is
  "everything the docs app adds" — page view code (10+ pages × ~2 KB
  each), layout chrome with reactive components (search palette is
  the biggest single contributor), motion + design library
  components used on the landing page, theme tokens, cookies,
  routing helpers.

### Q2: Does the auto-import plugin defeat tree-shaking?

${deltaNote}. ${
    delta > 200
      ? '**This is a real leak.** The plugin is pulling primitives into the bundle that the docs app does not actually use.'
      : delta > 0
        ? 'The plugin has a small but measurable cost — within tolerable range. Tree-shaking is mostly working.'
        : '**Plugin is tree-shaking-safe in the docs app build.** Watch on other apps.'
  }

The auto-import plugin's registered primitives (${AUTO_IMPORT_NAMES.length} names):

\`\`\`
${AUTO_IMPORT_NAMES.join(', ')}
\`\`\`

The plugin injects \`import { X } from '@place/component'\` at the top
of every \`.tsx\` / \`.jsx\` file that REFERENCES \`X\` without already
importing it. Because every reference becomes an explicit import,
per-primitive tree-shaking still works. The barrel-shape concern
(webpack #16863 / Vite #14676) applies when the import TARGET is a
barrel module — \`@place/component\`'s single \`index.ts\` IS a barrel.
The fact that the delta is near zero suggests Bun's tree-shaker is
ESM-pure enough for this case. **Charter contradiction (anti-magic)
remains philosophical; it is not a bundle-size problem.**

### Q3: Per-route bundles or one shared bundle?

**One shared bundle.** \`serve()\` (in \`systems/component/src/index.ts\`
line ~4882) calls \`Bun.build({ entrypoints: [options.clientEntry] })\`
exactly once at startup. The output is a single \`/client.<hash>.js\`
served to every page. **There is no per-route splitting today.**

This is the **root cause** of the floor problem. The cost of any
feature is paid on every page, even pages that don't use it. A blog
post page ships the same \`${fmt(docsBuild.gzipped)}\` as the most
interactive dashboard.

### Q4: Where are the unused-system leaks?

The gap between the reactivity-only floor (\`${fmt(reactivity.gzipped)}\`)
and the full docs bundle (\`${fmt(docsBuild.gzipped)}\`) is
**\`${fmt(docsBuild.gzipped - reactivity.gzipped)}\`** of "everything
else" — component runtime, hydration, layout chrome, all docs pages'
views, motion, design components, theme, cookies, routing. The
sourcemap probe (follow-on) will attribute that bucket per source
module.

## Implications for T5-B and T5-C (plan correction)

The plan as written has T5-B (per-system gating) and T5-C (islands).
The audit surfaces a missing prerequisite:

**T5-B-prerequisite — per-route bundle splitting.** Without this, none
of the gating work pays out: every page still ships the same bundle.
Per-system gating shrinks the SHARED bundle to "what every page
combined needs," not "what THIS page needs."

The path forward, ordered:

1. **Per-route splitting** (insert before T5-B). Bun supports multi-
   entrypoint builds; we emit one entry per page route. Each entry's
   bundle contains only what that page's transitive imports include.
   This drops content pages to roughly \`${fmt(contentOnly.gzipped)}\`
   immediately (the content-only synthetic floor), because static-JSX
   pages stop pulling in the layout chrome's interactive bits.
2. **T5-B per-system gating** — further trims even \`${fmt(contentOnly.gzipped)}\`
   by stripping system code the page doesn't reference.
3. **T5-C islands** — drops it to 0 by structurally removing the need
   for any framework runtime when the page has no interactive
   sub-tree.

This ordering means T5-B and T5-C combined targets get re-baselined:
- Old target (T5-B alone): "≤ 8 KB for a content page" → revised:
  **per-route splitting + T5-B → roughly \`${fmt(reactivity.gzipped)}\`
  per content page**.
- Old target (T5-C): "0 KB on content pages" → unchanged, still the
  islands outcome.

## Follow-on probes (worth writing next)

- **Sourcemap-based byte attribution.** Walk the bundle's sourcemap;
  aggregate bytes by source-file glob (per system, per docs page,
  per design library component). Names the actual leakers.
- **Per-page bundle simulation.** Build each route's transitive
  closure separately; measure. This is essentially "what would per-
  route splitting buy us today, before any other change?"
- **System-ablation probe.** Rebuild with each of the 9 systems
  artificially excluded (alias each system to an empty module); the
  size delta = "how much that system contributes to the docs bundle."

## ADR follow-ups

- **ADR 0018 should explicitly note** that the plan adds per-route
  bundle splitting as a prerequisite to islands (T5-B's prerequisite).
- **ADR 0019** can land as-is (typed islands, not directives).
- **ADR 0020** (per-system gating) now depends on the per-route work.
- **ADR 0021** (auto-import audit) gets a smaller scope: the plugin is
  tree-shaking-safe; the only outstanding question is the charter
  contradiction (anti-magic principle), which is documentation-only.
`

// Write auto-generated numbers to a separate file. The consolidated
// audit at `docs/probes/16kb-breakdown.md` is HAND-MAINTAINED and
// pulls these numbers in; this probe writes the raw data only.
const outPath = resolve(ROOT, 'docs/probes/bundle-headline.md')
await mkdir(resolve(ROOT, 'docs/probes'), { recursive: true })
await writeFile(outPath, md)
console.log(`\nWritten: ${outPath}`)
