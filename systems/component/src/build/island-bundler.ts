// `buildIslandBundles()` — per-island client bundle build (T5-C, ADR 0019).
//
// For each registered island, emit a self-contained ESM bundle whose
// entry: (a) imports the island module, (b) finds every
// `<div data-place-island="<name>">` in the document, (c) reads the
// serialized props from `data-place-island-props`, and (d) mounts the
// island component into the marker via `mount()`.
//
// We generate a tiny wrapper entry per island at build time (written
// to `.tmp/islands/<name>.entry.tsx`) so the user's island source
// stays clean — just an ordinary component module. The wrapper adds
// the auto-mount footer.
//
// Output: a Map<bundleUrl, content> for `serve()` to expose, plus a
// `nameToBundleUrl` map for `_setIslandBundleUrls()` to register so
// `renderPage()` can emit the right `<script>` per used island.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BunPlugin } from 'bun'

import type { IslandRegistration } from '../index.ts'
import { validateIslandName, validateIslandSrc } from '../island-validation.ts'
import {
  classifyIslandSource,
  predictBytesAtLevel,
  renderReport,
  type ViewManifest,
  type ViewManifestEntry,
} from './view-classifier.ts'
import {
  classifyIslandWithTypes,
  createTypedClassifierContext,
} from './view-classifier-types.ts'

/**
 * Description of one capability to install on the client at island
 * boot time. Constructed by `_serveImpl` from the user's `app()`
 * config (e.g. `router: pathRouter`). The bundler emits one
 * `import + install` pair per entry into the generated client-init
 * module, which ships in the shared chunk via `splitting: true`.
 *
 * The factory function's source module is identified by the function's
 * `__placeClientImport` metadata (see `ClientCapImport` in
 * `@place/routing`). The framework ships this metadata for
 * `pathRouter` / `hashRouter` / `memoryRouter`; third-party caps
 * either annotate their factory or the user installs them manually.
 */
export interface ClientCapInstall {
  /** Module specifier the bundler emits an `import` from. */
  readonly module: string
  /** Exported name of the factory function (called on the client). */
  readonly factoryName: string
  /** Exported name of the cap object (`.install()` is called on it). */
  readonly capName: string
}

export interface IslandBundlerOptions {
  /** The registered islands (name → { component, src }). */
  readonly islands: Readonly<Record<string, IslandRegistration>>
  /** URL prefix where bundles are served. Default: `/islands`. */
  readonly bundlePrefix: string
  /** Plugins (auto-import). */
  readonly plugins?: readonly BunPlugin[]
  /** Build-time defines. */
  readonly define: Record<string, string>
  /** External modules. */
  readonly external: readonly string[]
  /**
   * Minify mode. `true` = full prod minification (whitespace +
   * identifiers + syntax). `false` = no minification. An object
   * `{ whitespace, identifiers, syntax }` enables granular control —
   * dev typically uses `{ whitespace: true, syntax: true, identifiers: false }`
   * which strips bytes Lighthouse cares about but preserves
   * devtools-readable symbol names.
   */
  readonly minify:
    | boolean
    | { readonly whitespace?: boolean; readonly identifiers?: boolean; readonly syntax?: boolean }
  /** Sourcemap mode. */
  readonly sourcemap: 'inline' | 'linked' | 'external' | 'none'
  /**
   * Caps to install on the client BEFORE any island body runs. The
   * bundler generates a `_auto-init.ts` module that each wrapper
   * imports as a side-effect. The init module installs each cap; ES
   * module semantics + `splitting: true` guarantee it evaluates
   * exactly ONCE per page.
   *
   * Empty array = no auto-install (the user manages caps manually,
   * the legacy `_init.ts` pattern still works).
   */
  readonly clientCaps?: readonly ClientCapInstall[]
  /**
   * Directory to write the generated wrapper entry files into. Should
   * be project-relative and OK to be temporary (gitignored). Default:
   * `.place/island-entries`.
   */
  readonly entriesDir?: string
}

export interface IslandBundlerResult {
  /**
   * Map of bundle URL → raw UTF-8 JS bytes. `serve()` returns each as
   * the Response body verbatim. **Stored as `Uint8Array<ArrayBuffer>`
   * (not `string`) so the bytes hashed for SRI are bit-identical to
   * the bytes sent in the HTTP body — eliminating the string→bytes
   * encoding ambiguity that broke SRI on inline-sourcemap dev builds
   * (T6-A, ADR 0025 follow-up).** The explicit `ArrayBuffer` (not
   * `ArrayBufferLike`) parameter satisfies both `BodyInit` and
   * `BufferSource` without casts at call sites.
   */
  readonly bundles: ReadonlyMap<string, Uint8Array<ArrayBuffer>>
  /** Map of island name → bundle URL. Wires into `_setIslandBundleUrls()`. */
  readonly nameToBundleUrl: ReadonlyMap<string, string>
  /** Cumulative byte size of all emitted JS (raw). */
  readonly totalBytes: number
  /**
   * Map of bundle URL → SHA-384 hash (base64) for SRI. The renderer
   * emits `integrity="sha384-…"` on every `<script>` tag that has a
   * hash here, so the browser verifies the fetched bytes match before
   * executing. ADR 0025.
   */
  readonly integrity: ReadonlyMap<string, string>
  /**
   * **Per-island signature** (T8-B foundation for ADR 0028 HMR + ADR
   * 0030 classifier). Today: a 12-character base64 prefix of the
   * bundle's SHA-384 — a content hash that's bit-stable across no-op
   * rebuilds and changes on any source modification. Used by HMR
   * (Tier 11) as the "did the island's shape change" pessimistic
   * proxy: ANY signature change → island reload. The pessimistic
   * variant is correct (no state loss; full re-mount on the same DOM
   * node), it just gives up the body-only swap optimization React's
   * Fast Refresh takes via hook-call-shape comparison.
   *
   * The richer type-shape signature (props type ID + cap set + named
   * state-cell layout — distinguishes "body changed, shape didn't"
   * from "shape changed, must reload") lands alongside HMR proper in
   * Tier 11. The shape is a strict superset of today's value: HMR
   * code paths planned around `signature` work unchanged when it
   * gets refined.
   */
  readonly signature: ReadonlyMap<string, string>
  /**
   * **View classification manifest** (T8-D; ADR 0030 prototype).
   * Per-island prediction of the hydration level the future `view()`
   * primitive would compile each island to (L0 static / L1 thaw / L2
   * island / L3 island+stream), with the effect identifier that
   * forced the level so the build report can render
   * `<view> → <level> (because <identifier>)`.
   *
   * Today the manifest is **report-only**: every island still emits
   * at L2 regardless of its classified level. Tier 9 promotes the
   * classifier to authoritative by routing emission through
   * L0/L1/L2/L3 emitters per the manifest.
   */
  readonly viewManifest: ViewManifest
}

function generateWrapperEntry(
  name: string,
  islandSrc: string,
  frameworkSrc: string,
  autoInitSrc: string | null,
): string {
  // Auto-mount wrapper. Imports the island module's default export
  // and finds every `<div data-place-island="<name>">` marker. For
  // each marker:
  //   - Read its `data-place-island-props` (JSON.parse + proto-key
  //     strip) and `data-place-island-strategy` (closed enum).
  //   - Dispatch to the strategy: `load` mounts immediately, `idle`
  //     defers via `requestIdleCallback`, `visible` waits for the
  //     marker to enter the viewport, `interaction` waits for first
  //     hover/focus/click.
  //   - When the strategy fires, run `hydrate(component, el)` —
  //     adopts the SSR'd HTML inside the marker rather than
  //     replacing it (no first-paint flash).
  //
  // Both imports use ABSOLUTE paths so the generated entry can live
  // anywhere on disk (even outside any workspace) and still resolve.
  //
  // Security hardening:
  //   - `name` is restricted to [a-zA-Z0-9_-] at island() time, so
  //     all interpolations below are injection-proof.
  //   - `islandSrc` / `frameworkSrc` come from `resolve()` of
  //     framework-controlled paths; not user-tainted.
  //   - JSON.parse of `data-place-island-props` is bounded by a
  //     post-parse proto-key sweep so a malicious DOM mutation can't
  //     pollute the island's props.
  //   - The strategy attribute is validated against a closed set
  //     before any branching; unknown values fall back to `load`.

  // Side-effect import of the auto-init module (when caps are
  // configured). Bun's `splitting: true` puts it in a shared chunk so
  // the cap installs run ONCE per page no matter how many islands
  // mount. ES module spec guarantees a single evaluation.
  const autoInitImport = autoInitSrc ? `import ${JSON.stringify(autoInitSrc)}\n` : ''

  return `// Auto-generated island wrapper.
// Name: ${JSON.stringify(name)}
// Source: ${JSON.stringify(islandSrc)}
${autoInitImport}import islandComponent from ${JSON.stringify(islandSrc)}
import { _setHydrated, hydrate, mount } from ${JSON.stringify(frameworkSrc)}

const NAME = ${JSON.stringify(name)}
const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const STRATEGIES = new Set(['load', 'idle', 'visible', 'interaction'])

function sanitizeProps(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(raw as object)) {
    if (POLLUTION_KEYS.has(key)) continue
    out[key] = (raw as Record<string, unknown>)[key]
  }
  return out
}

function readProps(el: HTMLElement): Record<string, unknown> {
  // T8-C: \`data-view-props\` (was \`data-place-island-props\` pre-Tier-8).
  // The dataset key is the camelCased form Bun's TS lib already maps:
  // \`data-view-props\` → \`el.dataset.viewProps\`.
  const raw = el.dataset.viewProps
  if (!raw) return {}
  try {
    return sanitizeProps(JSON.parse(raw))
  } catch {
    return {}
  }
}

function readStrategy(el: HTMLElement): string {
  const raw = el.dataset.viewStrategy
  if (raw && STRATEGIES.has(raw)) return raw
  return 'load'
}

// Per-element disposer registry. Every hydrateOne records the View's
// dispose closure here so SPA-nav can dispose stale instances when
// their marker is detached from the document (the user navigated
// away and back; the new SSR'd marker is a different DOM node).
// Without this, every navigation back to a page leaks the island's
// watches + timers + event listeners — TypingCode's setTimeout
// chain keeps firing against a detached state cell, ReactivityDemo
// keeps subscribing to derived values, etc.
//
// **Cross-bundle shared via \`window.__placeIslandRegistry\`** so the
// HMR runtime (\`__hmr.ts\`) can dispose live mounts before injecting a
// new bundle. The registry is shared by reference across hot-reloaded
// bundles of the same island — old + new bundles see the same Map +
// Set, and each new bundle's \`disposeAll\` overwrite is harmless
// (the previous one has already executed by the time a swap happens).
// In production builds the HMR runtime DCEs to zero bytes; the
// registry still exists but is only used as the SPA-nav cleanup map.
var registry = (window as any).__placeIslandRegistry || ((window as any).__placeIslandRegistry = {});
var entry = registry[NAME] || (registry[NAME] = { markers: new Set(), disposers: new WeakMap() });
var mountedDisposers = entry.disposers as WeakMap<HTMLElement, () => void>;
var mountedMarkers = entry.markers as Set<HTMLElement>;
// HMR dispose hook (ADR 0028). Called by the HMR runtime before
// injecting the next bundle. Disposes every live mount + clears the
// \`viewMounted\` sentinel so the new bundle's \`scanAndSchedule()\`
// re-hydrates these same DOM nodes with the new render fn.
entry.disposeAll = function(): void {
  mountedMarkers.forEach(function(el: HTMLElement){
    try {
      const fn = mountedDisposers.get(el)
      if (typeof fn === 'function') fn()
    } catch (_) {}
    mountedDisposers.delete(el)
    try { delete el.dataset.viewMounted } catch (_) {}
  })
  mountedMarkers.clear()
};

function hydrateOne(el: HTMLElement): void {
  if (el.dataset.viewMounted === '1') return
  el.dataset.viewMounted = '1'
  const props = readProps(el)
  try {
    const view = islandComponent(props)
    var dispose: any
    if (view && typeof view.hydrate === 'function' && el.firstChild) {
      dispose = hydrate(view, el)
    } else {
      // No SSR'd content OR view doesn't support hydration: re-render
      // via mount() — accepts the flash.
      dispose = mount(view, el)
    }
    if (typeof dispose === 'function') {
      mountedDisposers.set(el, dispose)
    }
    mountedMarkers.add(el)
    // Flip the framework's global hydration flag so any \`onMount(fn)\`
    // calls registered during this island's body fire their bodies
    // immediately. The flag is a no-op write once it's true, so
    // subsequent islands mounting on the same page don't re-fire
    // anything. Without this, islands-only apps (no \`boot()\` call)
    // leave the flag at \`false\` forever and onMount never runs —
    // exactly the bug the new Tabs island hit on /why before this
    // line existed.
    _setHydrated(true)
  } catch (e) {
    console.error('[place-island] Failed to hydrate', NAME, ':', e)
  }
}

function disposeDetached(): void {
  // Walk the disposer registry. Any element no longer in the live
  // document (typically removed by SPA-nav's <main> swap) gets its
  // View's cleanup run + entry removed. Idempotent — the map is
  // bounded by live + just-detached island instances.
  mountedMarkers.forEach(function(el: HTMLElement){
    if (!document.contains(el as Node)) {
      try {
        const fn = mountedDisposers.get(el)
        if (typeof fn === 'function') fn()
      } catch (_) {}
      mountedDisposers.delete(el)
      mountedMarkers.delete(el)
    }
  })
}

function scheduleForStrategy(el: HTMLElement, strategy: string): void {
  if (strategy === 'load') {
    hydrateOne(el)
    return
  }
  if (strategy === 'idle') {
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback
    if (ric) ric(() => hydrateOne(el))
    else setTimeout(() => hydrateOne(el), 200)
    return
  }
  if (strategy === 'visible') {
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver((entries, o) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            o.disconnect()
            hydrateOne(el)
            return
          }
        }
      }, { rootMargin: '64px' })
      obs.observe(el)
    } else {
      hydrateOne(el)
    }
    return
  }
  if (strategy === 'interaction') {
    const events = ['pointerenter', 'focusin', 'click', 'touchstart']
    const onTrigger = (): void => {
      for (const e of events) el.removeEventListener(e, onTrigger)
      hydrateOne(el)
    }
    for (const e of events) {
      el.addEventListener(e, onTrigger, { once: true, passive: true })
    }
    return
  }
  // Unknown strategy — should not happen given validation; fall back to load.
  hydrateOne(el)
}

function scanAndSchedule(): void {
  if (typeof document === 'undefined') return
  // T8-C: \`data-view="island"\` + \`data-view-id="<name>"\` (ADR 0030
  // unified wire). Replaces the legacy \`data-place-island="<name>"\`
  // single attribute; the kind discriminator lets thaw + island+stream
  // emitters land on the same wire format with one DOM walker.
  const selector = '[data-view="island"][data-view-id="' + NAME + '"]'
  const markers = document.querySelectorAll(selector)
  for (const el of markers) {
    const strategy = readStrategy(el as HTMLElement)
    scheduleForStrategy(el as HTMLElement, strategy)
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scanAndSchedule)
} else {
  scanAndSchedule()
}
// SPA nav: the inline runtime dispatches 'place:nav' after the
// <main> swap. We do TWO things in this listener:
//   1. \`disposeDetached()\` — every island marker from the OLD page
//      that's no longer in the live document gets its View's cleanup
//      run. Without this, watches + timers + listeners installed by
//      the old mount leak forever, eventually multiplying with every
//      navigation cycle (back-and-forth N times = N stale subscribers).
//   2. \`scanAndSchedule()\` — find any new markers (a fresh marker
//      for this island name in the swapped <main>, possibly with
//      different props) and hydrate them. Idempotent thanks to
//      dataset.viewMounted on already-handled markers.
//
// This is the fundamental guarantee for ALL islands: identical
// behaviour to hard refresh, just without the round-trip. Authors
// don't think about it — every \`island(fn)\` participates in this
// cycle for free.
window.addEventListener('place:nav', function(){
  disposeDetached()
  scanAndSchedule()
})
`
}

export async function buildIslandBundles(
  options: IslandBundlerOptions,
): Promise<IslandBundlerResult> {
  if (typeof Bun === 'undefined' || typeof Bun.build !== 'function') {
    throw new Error(
      'island-bundler: requires Bun.build. Pre-build with esbuild/Vite/Rollup ' +
        'and pass per-island bundles directly to serve() (not yet supported); ' +
        'or run under Bun.',
    )
  }

  const islands = options.islands
  const names = Object.keys(islands)
  if (names.length === 0) {
    return {
      bundles: new Map<string, Uint8Array<ArrayBuffer>>(),
      nameToBundleUrl: new Map(),
      totalBytes: 0,
      integrity: new Map(),
      signature: new Map(),
      viewManifest: { generatedAt: Date.now(), entries: [] },
    }
  }

  const entriesDir = resolve(process.cwd(), options.entriesDir ?? '.place/island-entries')
  await mkdir(entriesDir, { recursive: true })

  // Absolute path to the **client-mount leaf** — the wrapper imports
  // `_setHydrated` / `hydrate` / `mount` from here, NOT from the
  // framework barrel (`./index.ts`). Routing through a leaf keeps the
  // island bundle's static import graph bounded to client-runtime
  // code: no `./build/*` modules (Bun.build orchestration, view
  // classifier, TypeScript compiler) end up in the wrapper's chunk
  // graph, even via the `splitting: true` dynamic-import walk. Prior
  // to this split, every island bundle was carrying a 1.2 MB gzipped
  // shared chunk of TypeScript compiler code — the leaf is the
  // structural fix that closes that leak.
  // We're at `<framework>/src/build/island-bundler.ts`; the leaf is
  // `<framework>/src/_client-mount.ts`.
  const frameworkSrc = resolve(import.meta.dir, '..', '_client-mount.ts')

  // T5-D phase 2 auto cap-install: generate the client-init module if
  // the app configured any client caps. Side-effect-only (no exports);
  // each island wrapper imports it. Bun's `splitting: true` keeps the
  // body in the shared chunk so the install runs ONCE across all
  // islands on a page (ES module evaluate-once).
  let autoInitSrc: string | null = null
  if (options.clientCaps && options.clientCaps.length > 0) {
    autoInitSrc = resolve(entriesDir, '_auto-init.ts')
    // Group imports by module to keep the emitted code tidy.
    const imports = new Map<string, Set<string>>()
    const installs: string[] = []
    for (const cap of options.clientCaps) {
      const seen = imports.get(cap.module) ?? new Set<string>()
      seen.add(cap.factoryName)
      seen.add(cap.capName)
      imports.set(cap.module, seen)
      // Guard: only install if the cap isn't already provided. Lets
      // legacy `_init.ts` patterns coexist + survives hot reload.
      installs.push(
        `if (${cap.capName}.use(null) === null) ${cap.capName}.install(${cap.factoryName}())`,
      )
    }
    const importLines: string[] = []
    for (const [mod, names] of imports) {
      importLines.push(`import { ${[...names].sort().join(', ')} } from ${JSON.stringify(mod)}`)
    }
    const initBody =
      `// Auto-generated by buildIslandBundles. Side-effect-only module\n` +
      `// that installs client caps configured via app() / serve(). One\n` +
      `// evaluation per page (ES module semantics + Bun splitting).\n\n` +
      importLines.join('\n') + '\n\n' + installs.join('\n') + '\n'
    await writeFile(autoInitSrc, initBody)
  }

  // Bundles are stored as raw UTF-8 bytes (Uint8Array). Hash + serve
  // use the same array — no string→bytes path can diverge (T6-A).
  // The explicit `<ArrayBuffer>` parameter (vs `<ArrayBufferLike>`)
  // satisfies `crypto.subtle.digest` + `Response` `BodyInit` without
  // call-site casts; the runtime shape is identical.
  const bundles = new Map<string, Uint8Array<ArrayBuffer>>()
  const nameToBundleUrl = new Map<string, string>()
  const encoder = new TextEncoder()
  /** Encode a string to UTF-8 bytes typed for `BufferSource` / `BodyInit`. */
  const encode = (s: string): Uint8Array<ArrayBuffer> =>
    encoder.encode(s) as Uint8Array<ArrayBuffer>
  let totalBytes = 0

  // Generate one wrapper entry per island. Each one imports the
  // user's island module + the framework's `hydrate` / `mount`.
  // We then run ONE Bun.build with all entrypoints + `splitting: true`
  // so the framework runtime (shared across every island) extracts
  // as a single shared chunk loaded once and cached across pages.
  // Without splitting, each island would inline ~13 KB of framework
  // code — N islands on one page = N × duplication.
  const entryPaths: string[] = []
  const entryToName = new Map<string, string>()
  for (const name of names) {
    const reg = islands[name]
    if (!reg) continue
    validateIslandName(name)
    const absoluteSrc = resolve(process.cwd(), reg.src)
    validateIslandSrc(absoluteSrc, process.cwd())
    const entryPath = resolve(entriesDir, `${name}.entry.ts`)
    await writeFile(entryPath, generateWrapperEntry(name, absoluteSrc, frameworkSrc, autoInitSrc))
    entryPaths.push(entryPath)
    entryToName.set(entryPath, name)
  }

  const build = await Bun.build({
    entrypoints: entryPaths,
    // **`root: entriesDir`** so Bun emits flat output paths
    // (`./tabs.entry.js`, `./chunk-abc.js`) instead of paths that carry
    // the `.place/island-entries/` source-tree prefix. When Bun infers
    // the root from the entrypoint files' common ancestor — which it
    // does when this option is omitted — the emitted bundle's
    // splitting-chunk imports come out as `../../chunk-abc.js` (the
    // relative walk back up to the shared chunk's location). That URL
    // 404s against our `/islands/chunk-abc.js` serve route, so every
    // entry bundle fails to load its dependencies and no island
    // mounts. Anchoring root at the wrapper directory keeps chunk
    // imports as flat `./chunk-abc.js` references, matching the URLs
    // the serve handler exposes.
    root: entriesDir,
    target: 'browser',
    format: 'esm',
    minify: options.minify,
    sourcemap: options.sourcemap,
    define: options.define,
    external: [...options.external],
    plugins: [...(options.plugins ?? [])] as never,
    splitting: true,
  })
  if (!build.success) {
    throw new Error(
      `island-bundler: build failed:\n${build.logs.join('\n')}`,
    )
  }

  // Sort outputs into three buckets:
  //  • entry-points (one per island), code goes into `bundles`
  //  • chunks (Bun's shared splits), code goes into `bundles`
  //  • sourcemaps (external mode emits `.map` siblings), also into
  //    `bundles` — the serve handler discriminates by URL extension so
  //    `.map` requests come back with `application/json`.
  // Going external in dev (vs the prior inline data-URLs) trims ~75 %
  // of every island bundle's bytes — the maps still load on demand
  // when DevTools is open, no DX loss.
  const entryOutputs: Bun.BuildArtifact[] = []
  const chunkOutputs: Bun.BuildArtifact[] = []
  const sourcemapOutputs: Bun.BuildArtifact[] = []
  for (const o of build.outputs) {
    if (o.kind === 'entry-point') entryOutputs.push(o)
    else if (o.kind === 'sourcemap' || o.path.endsWith('.map')) sourcemapOutputs.push(o)
    else chunkOutputs.push(o)
  }

  // **Correlate entry outputs to island names by FILENAME, not by
  // position.** Bun does not preserve `entrypoints[]` order across the
  // `build.outputs` array (observed empirically on `splitting: true`
  // builds — outputs come back grouped or alphabetized). The previous
  // positional zip silently mis-aligned: every island bundle got
  // served with the wrong island's wrapper, so e.g. requests for
  // `/islands/code-block.js` returned the bundle whose wrapper had
  // `NAME = "theme-toggle"` baked in. The marker for code-block
  // existed in the DOM, the bundle loaded, but its auto-mount wrapper
  // scanned for `[data-place-island="theme-toggle"]` and didn't find
  // the code-block marker — so code-block stayed dead.
  //
  // Each entry source path is `<entriesDir>/<name>.entry.ts`; Bun emits
  // each as `./<name>.entry.js` (basename preserved). Build a basename
  // → island-name map, then index outputs by their own basename.
  if (entryOutputs.length !== entryPaths.length) {
    throw new Error(
      `island-bundler: expected ${entryPaths.length} entry outputs, ` +
        `got ${entryOutputs.length}`,
    )
  }
  const basenameToName = new Map<string, string>()
  for (const entryPath of entryPaths) {
    const name = entryToName.get(entryPath)
    if (!name) continue
    // `<name>.entry.ts` → `<name>.entry` (extension-stripped basename
    // that Bun's output filename uses, modulo the `.js` extension it
    // tacks on for ESM output).
    basenameToName.set(`${name}.entry`, name)
  }
  for (const out of entryOutputs) {
    // `out.path` is something like `.place/island-entries/tabs.entry.js`
    // OR `./tabs.entry.js` depending on Bun version + entrypoint
    // resolution. Extract the file basename (everything after the
    // last `/`) and strip the `.js` extension for the lookup.
    const lastSlash = out.path.lastIndexOf('/')
    const outBase = out.path.slice(lastSlash + 1).replace(/\.js$/, '')
    const name = basenameToName.get(outBase)
    if (!name) {
      throw new Error(
        `island-bundler: no island name for output path "${out.path}" ` +
          `(extracted basename "${outBase}"). This means Bun emitted an ` +
          `entry-point whose filename doesn't match any of the wrapper ` +
          `files we generated — likely a Bun version mismatch.`,
      )
    }
    const bytes = encode(await out.text())
    // **Content-hashed entry URLs.** Eliminates the
    // stale-HTML-cached-against-rebuilt-bundle class of bug: when the
    // bundle bytes change (server restart, code edit, deploy), the URL
    // changes too. The browser's cached HTML references the OLD URL,
    // gets a 404 (instead of mismatching SRI), and a fresh page load
    // pulls the new URL. Cache-busts cleanly across all reverse
    // proxies / CDNs / browsers — no Cache-Control gymnastics.
    //
    // The hash is the first 12 chars of the SHA-384 of the bytes
    // (same value used for the `signature` map below). Stable across
    // no-op rebuilds (digest is deterministic) → identical URL across
    // server restarts if no source changed. 72 bits of entropy →
    // collision-safe for any practical app.
    const digest = await crypto.subtle.digest('SHA-384', bytes)
    const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    const hashSuffix = b64.slice(0, 12).replace(/[+/=]/g, (c) =>
      c === '+' ? '-' : c === '/' ? '_' : '',
    )
    const url = `${options.bundlePrefix}/${name}-${hashSuffix}.js`
    bundles.set(url, bytes)
    nameToBundleUrl.set(name, url)
    totalBytes += bytes.byteLength
  }
  // Helper: extract the file basename from a Bun BuildArtifact.path
  // (handles both `./foo.js` and `.place/island-entries/foo.js` shapes).
  const fileBasename = (p: string): string => p.slice(p.lastIndexOf('/') + 1)

  // Shared chunks live under the same prefix so they share the cache
  // policy + CSP rules `serve()` applies to all `splitterBundles`.
  for (const chunk of chunkOutputs) {
    const url = `${options.bundlePrefix}/${fileBasename(chunk.path)}`
    const bytes = encode(await chunk.text())
    bundles.set(url, bytes)
    totalBytes += bytes.byteLength
  }
  // Sourcemap siblings — `.js.map` files for external sourcemap mode.
  // We do NOT include their byte count in `totalBytes` (it tracks
  // executable JS, which is what budgets care about), and we do NOT
  // hash them for SRI (the maps are non-executable, integrity protects
  // the `.js` they describe; an attacker substituting maps can only
  // degrade DX, not behavior).
  for (const map of sourcemapOutputs) {
    const url = `${options.bundlePrefix}/${fileBasename(map.path)}`
    bundles.set(url, encode(await map.text()))
  }

  // T5-D-phase-2 (ADR 0025) SRI: compute SHA-384 of each bundle so the
  // server can emit `integrity="sha384-…"` on every `<script>` tag.
  // The browser verifies fetched bytes before execution — closes the
  // CDN-tampering + MITM class of attacks.
  //
  // We hash the SAME `Uint8Array` we'll serve as the Response body
  // (T6-A). Earlier shapes hashed `new TextEncoder().encode(content)`
  // while serving `new Response(content)`; in dev (`sourcemap: 'inline'`
  // appends a multi-KB data-URL to the JS string) Bun's string→bytes
  // path for Response diverged from `TextEncoder.encode`, producing an
  // SRI mismatch that blocked every island bundle in the browser.
  // Encoding once upstream and reusing the bytes for both Response +
  // hash makes the bit-identity guarantee structural, not incidental.
  //
  // Hash all bundles (entries + shared chunks) since chunks are
  // imported via ES module imports inside the entries. Even though
  // `integrity` on `<script>` only covers entries directly, the
  // browser computes integrity on each module fetch in the graph if
  // `integrity` is present on the parent — but to be safe we hash
  // every emitted file. Future cut: also emit integrity attributes
  // for shared-chunk modules via `<link rel="modulepreload" integrity>`.
  const integrity = new Map<string, string>()
  const signature = new Map<string, string>()
  for (const [url, bytes] of bundles) {
    // Skip sourcemaps — they're non-executable; SRI guards the `.js`
    // they describe, not the maps themselves.
    if (url.endsWith('.map')) continue
    const digest = await crypto.subtle.digest('SHA-384', bytes)
    const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    integrity.set(url, b64)
    // T8-B: signature = first 12 chars of the integrity hash. Stable
    // across no-op rebuilds (digest is deterministic), changes on
    // any byte change. 12 base64 chars = 72 bits — collision-safe
    // for any practical app's island count. HMR (Tier 11) reads this
    // off the manifest; the wire envelope ships `signature` so the
    // client can detect cross-rebuild mismatches.
    signature.set(url, b64.slice(0, 12))
  }

  // **T8-E (ADR 0030):** classify each island and emit the view
  // manifest. Report-only — every island still ships at L2. The
  // manifest predicts the level the Tier 9 `view()` primitive would
  // compile each island to and the byte cost at that level vs
  // current. Promotion reasons cite identifiers the developer wrote.
  //
  // **Two classifier paths:**
  //   1. **Type-based** (preferred). Creates a `ts.Program` once for
  //      the project root and reads `EffectBranded<E>` brands off
  //      every expression's inferred type. Closes the name-match
  //      prototype's known false-negatives: aliased imports
  //      (`import { state as s }`) and cap-method reads
  //      (`router.path()` where `path: State<string>`).
  //   2. **Name-match fallback.** Used when the typed context fails
  //      to load (no tsconfig nearby, typescript module unavailable,
  //      or the source isn't in the program). Tier 8-D shape;
  //      sufficient for the report.
  //
  // The typed context is created lazily — first island that needs it
  // triggers the program build. Subsequent islands reuse the cached
  // program; the heavy cost is paid once per `serve()` startup.
  const firstSrc =
    names.length > 0 && islands[names[0] ?? '']
      ? resolve(process.cwd(), islands[names[0] ?? '']!.src)
      : process.cwd()
  const typedCtx = await createTypedClassifierContext(firstSrc).catch(() => null)
  const manifestEntries: ViewManifestEntry[] = []
  for (const name of names) {
    const reg = islands[name]
    if (!reg) continue
    const absoluteSrc = resolve(process.cwd(), reg.src)
    let src = ''
    try {
      src = await readFile(absoluteSrc, 'utf-8')
    } catch {
      // Source unreadable (e.g. virtual module): skip classification.
      // The view manifest just doesn't include this island; report
      // skips it. Better than failing the whole build.
      continue
    }
    const result =
      typedCtx !== null
        ? classifyIslandWithTypes(absoluteSrc, src, typedCtx)
        : classifyIslandSource(src)
    const url = nameToBundleUrl.get(name)
    const bytesCurrent = url ? (bundles.get(url)?.byteLength ?? 0) : 0
    const bytesPredicted = predictBytesAtLevel(result.level, bytesCurrent)
    manifestEntries.push({
      name,
      level: result.level,
      effects: [...result.effects],
      reason: result.reason,
      bytesCurrent,
      bytesPredicted,
    })
  }
  const viewManifest: ViewManifest = {
    generatedAt: Date.now(),
    entries: manifestEntries,
  }

  // Persist the manifest next to the generated wrapper entries so
  // probes / CI / the future devtool can pick it up without coupling
  // to the framework's in-memory build state. Best-effort: a failed
  // write is logged but doesn't fail the build.
  if (manifestEntries.length > 0) {
    try {
      await writeFile(
        resolve(entriesDir, 'view-manifest.json'),
        JSON.stringify(viewManifest, null, 2),
      )
    } catch {
      // intentionally swallowed — the in-memory manifest is the
      // source of truth; on-disk is convenience.
    }
  }

  return {
    bundles,
    nameToBundleUrl,
    totalBytes,
    integrity,
    signature,
    viewManifest,
  }
}

/**
 * Render the T8-D classifier's prediction as a console-friendly
 * report. `serve()` calls this once at startup, after the island
 * bundle phase. Helper re-exported so probes + the build CLI can
 * print the same shape.
 */
export function renderViewManifestReport(manifest: ViewManifest): string {
  return renderReport(manifest)
}
