// `routeSplitter()` — per-route bundle splitting for `serve()`.
//
// Today (T5-B-1 ADR 0018): `serve()` calls `Bun.build` once with one
// entry, producing ONE shared `/client.js` served to every page —
// every page downloads every other page's view code. The T5-A audit
// measured this as the dominant bundle leak (53% of the bundle = page
// view code, all bundled together).
//
// This module emits per-route bundles instead. Given a map of
// `routePath -> sourceFile`, plus the fallback `clientEntry`, it
// builds EACH entry as a SELF-CONTAINED bundle (no `splitting: true`).
//
// Why not `splitting: true`: an HTML-first framework's first-load
// experience is what matters — a user lands on a specific URL,
// downloads that page's bundle, reads. Code splitting (extracting
// shared chunks across entries) optimizes for SPA-style navigation
// where the user transitions across many routes in one session,
// amortizing the shared chunks over later navigations. Bun's
// `splitting: true` also tends to fragment aggressively, producing
// many small shared chunks whose combined first-load size exceeds
// the no-splitting per-route bundle. For our use case, simple
// self-contained per-route bundles win on first-load JS size.
//
// Trade-off (acknowledged): the framework runtime + layout are
// duplicated across per-route bundles. If client-side navigation
// becomes a thing (we don't support it today), revisit. For now,
// the user transitions across routes via the network anyway — each
// page is a fresh HTML response with its own bundle URL.

import type { BunPlugin } from 'bun'

export interface RouteSplitterOptions {
  /** Map of route path -> source file (.ts/.tsx). */
  readonly clientEntries: Readonly<Record<string, string>>
  /**
   * Fallback / default entry. Used for routes not in `clientEntries`
   * (gradual adoption) AND as the seed for default bundle URL.
   */
  readonly clientEntry?: string
  /** Path-prefix the bundles are served under. Default: `/client`. */
  readonly clientPath: string
  /** Plugins to apply at build time (auto-import, etc.). */
  readonly plugins?: readonly BunPlugin[]
  /** Build-time defines, e.g. `__PLACE_BROWSER__`. */
  readonly define: Record<string, string>
  /** External modules. */
  readonly external: readonly string[]
  /**
   * Minify mode. Same shape as island-bundler. `true` for prod, an
   * object like `{ whitespace: true, syntax: true, identifiers: false }`
   * for dev (strips bytes Lighthouse cares about without mangling
   * symbol names).
   */
  readonly minify:
    | boolean
    | { readonly whitespace?: boolean; readonly identifiers?: boolean; readonly syntax?: boolean }
  /** Sourcemap mode ('inline' for dev, 'none' for prod). */
  readonly sourcemap: 'inline' | 'linked' | 'external' | 'none'
}

export interface RouteSplitterResult {
  /**
   * Map of bundle URL → raw UTF-8 JS bytes. `serve()` returns each as
   * the Response body verbatim. **Stored as `Uint8Array<ArrayBuffer>`
   * (not `string`) so the bytes hashed for SRI are bit-identical to
   * the bytes sent in the HTTP body (T6-A, see also island-bundler.ts).**
   * The explicit `ArrayBuffer` parameter satisfies both `BufferSource`
   * and `BodyInit` without casts at consumer sites. Each entry is a
   * self-contained per-route bundle.
   */
  readonly bundles: ReadonlyMap<string, Uint8Array<ArrayBuffer>>
  /**
   * Map of route path -> bundle URL. Used by `renderPage()` to emit
   * the right `<script src=…>` for each request. Routes not in the
   * map fall back to the default `clientEntry` bundle URL.
   */
  readonly routeToBundle: ReadonlyMap<string, string>
  /**
   * The URL of the default bundle (built from `clientEntry`). Used as
   * the fallback for routes not in `clientEntries`.
   */
  readonly defaultBundleUrl: string | null
  /** Cumulative byte size of all emitted JS (raw). */
  readonly totalBytes: number
  /** Number of distinct bundle files emitted. */
  readonly bundleCount: number
  /**
   * SRI hashes (base64 SHA-384) per emitted bundle URL. The framework
   * emits `integrity="sha384-…"` on `<script>` tags whose `src` is in
   * this map — browsers verify fetched bytes match before execution.
   * Closes the CDN-tampering / MITM-injection class of attacks
   * regardless of TLS state. ADR 0025.
   */
  readonly integrity: ReadonlyMap<string, string>
  /**
   * Per-route signature (T8-B; ADR 0028 HMR foundation). Today: 12-
   * char base64 prefix of the bundle's SHA-384. Same semantics as the
   * island-bundler's `signature` field — see that doc for the design
   * rationale + the planned Tier 11 refinement.
   */
  readonly signature: ReadonlyMap<string, string>
}

/**
 * Build per-route bundles via `Bun.build`. One call per entry, each
 * producing a self-contained bundle. Order is deterministic.
 */
export async function buildRouteSplitBundles(
  options: RouteSplitterOptions,
): Promise<RouteSplitterResult> {
  if (typeof Bun === 'undefined' || typeof Bun.build !== 'function') {
    throw new Error(
      'route-splitter: requires Bun.build. Pre-build with esbuild/Vite/Rollup ' +
        'and pass `clientJs` to `serve()` instead, or run under Bun.',
    )
  }

  // Collect every entry (source, route?). The fallback `clientEntry`
  // gets a synthetic `__default__` route key so we can build it once
  // and find its output URL afterward.
  const entries: Array<{ key: string; source: string }> = []
  if (options.clientEntry) {
    entries.push({ key: '__default__', source: options.clientEntry })
  }
  for (const [route, src] of Object.entries(options.clientEntries)) {
    entries.push({ key: route, source: src })
  }
  if (entries.length === 0) {
    return {
      bundles: new Map<string, Uint8Array<ArrayBuffer>>(),
      routeToBundle: new Map(),
      defaultBundleUrl: null,
      totalBytes: 0,
      bundleCount: 0,
      integrity: new Map(),
      signature: new Map(),
    }
  }

  const splitterPrefix = options.clientPath.replace(/\.js$/, '')

  // Build each entry separately. Each entry produces ONE self-
  // contained bundle. We use the route's path (slugified) as the
  // bundle's URL so the URL is human-meaningful: `/client/landing.js`
  // for the `/` route, `/client/concepts/reactivity.js` for the
  // `/concepts/reactivity` route, etc.
  const slugify = (key: string): string => {
    if (key === '__default__') return 'default'
    if (key === '/') return 'landing'
    return key
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
      .replace(/[^a-zA-Z0-9/_-]/g, '-')
  }

  // Bundles are raw UTF-8 bytes (Uint8Array<ArrayBuffer>) — same array
  // is served as the Response body AND hashed for SRI. See
  // island-bundler.ts T6-A commentary for the byte-stability rationale.
  const bundles = new Map<string, Uint8Array<ArrayBuffer>>()
  const routeToBundle = new Map<string, string>()
  const encoder = new TextEncoder()
  const encode = (s: string): Uint8Array<ArrayBuffer> =>
    encoder.encode(s) as Uint8Array<ArrayBuffer>
  let defaultBundleUrl: string | null = null
  let totalBytes = 0

  for (const entry of entries) {
    const build = await Bun.build({
      entrypoints: [entry.source],
      target: 'browser',
      format: 'esm',
      minify: options.minify,
      sourcemap: options.sourcemap,
      define: options.define,
      external: [...options.external],
      plugins: [...(options.plugins ?? [])] as never,
    })
    if (!build.success) {
      throw new Error(`route-splitter: build failed for ${entry.source}:\n${build.logs.join('\n')}`)
    }
    // Find the JS entry output (kind === 'entry-point') and any
    // sourcemap siblings. External-sourcemap mode emits the `.map`
    // file as a separate output; we serve it alongside the JS at a
    // `.js.map` URL so DevTools can fetch it on demand.
    let entryOut: Bun.BuildArtifact | null = null
    const mapOuts: Bun.BuildArtifact[] = []
    for (const o of build.outputs) {
      if (o.kind === 'entry-point') entryOut = o
      else if (o.kind === 'sourcemap' || o.path.endsWith('.map')) mapOuts.push(o)
    }
    if (!entryOut) {
      throw new Error(`route-splitter: no entry output for ${entry.source}`)
    }
    const bytes = encode(await entryOut.text())
    const url = `${splitterPrefix}/${slugify(entry.key)}.js`
    bundles.set(url, bytes)
    totalBytes += bytes.byteLength
    // Sourcemap sibling. `<route-name>.js.map` matches what Bun emits
    // in the `//# sourceMappingURL=` comment.
    for (const map of mapOuts) {
      bundles.set(`${url}.map`, encode(await map.text()))
    }

    if (entry.key === '__default__') {
      defaultBundleUrl = url
    } else {
      routeToBundle.set(entry.key, url)
    }
  }

  // SRI: SHA-384 of each emitted bundle (ADR 0025). Hash the exact
  // bytes we'll write to the HTTP response so the browser's computed
  // digest is guaranteed to match. Skip `.map` siblings (non-executable;
  // SRI guards the `.js` they describe).
  const integrity = new Map<string, string>()
  const signature = new Map<string, string>()
  for (const [url, bytes] of bundles) {
    if (url.endsWith('.map')) continue
    const digest = await crypto.subtle.digest('SHA-384', bytes)
    const b64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    integrity.set(url, b64)
    // T8-B: signature = 12-char b64 prefix; see island-bundler for design.
    signature.set(url, b64.slice(0, 12))
  }

  return {
    bundles,
    routeToBundle,
    defaultBundleUrl,
    totalBytes,
    bundleCount: bundles.size,
    integrity,
    signature,
  }
}
