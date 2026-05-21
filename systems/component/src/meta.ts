// ===== meta — typed metadata for the document <head> =====
//
// Replaces ad-hoc string-blob shells. Every field maps to ONE specific
// HTML element (no inferred magic) so what you write is what you get.
//
//   meta: {
//     title: 'My Page',
//     description: '...',
//     og: { title: '...', image: '/cover.png', type: 'website' },
//     twitter: { card: 'summary_large_image' },
//     icon: '/favicon.ico',
//     robots: 'index, follow',
//     canonical: 'https://...',
//     extra: [{ tag: 'link', rel: 'preconnect', href: '...' }],
//   }
//
// Better than Next's `metadata` export because:
//   - No conventions like `metadataBase` resolving relative URLs magically
//   - No "some keys generate one tag, some generate three" guessing
//   - Dynamic via a function `meta: (props) => Meta` — no separate
//     `generateMetadata` export
//   - One module to import (it's typed; your editor tells you what's valid)
//
// Extracted from index.ts (audit Phase 2.1, Cut 1d). Public types and
// functions are re-exported by index.ts for the framework's public
// surface; internal renderers (`renderDocument`, `renderMeta`,
// `renderStyles`, `renderHeadEntry`) are imported back into index.ts
// by the SSR pipeline.

import { escapeHtmlAttrFull, escapeHtmlText } from './utils/escape.ts'

/** Open Graph protocol fields. Each emits one `<meta property="og:…">` tag. */
export interface OpenGraphMeta {
  title?: string
  description?: string
  image?: string
  url?: string
  siteName?: string
  locale?: string
  type?: 'website' | 'article' | 'profile' | 'video.movie' | 'music.song' | 'book'
}

/** Twitter card fields. Each emits one `<meta name="twitter:…">` tag. */
export interface TwitterMeta {
  card?: 'summary' | 'summary_large_image' | 'app' | 'player'
  site?: string
  creator?: string
  title?: string
  description?: string
  image?: string
}

/**
 * Raw `<head>` entries — the escape hatch for anything that doesn't fit
 * the typed shape. Each entry is a structured tag descriptor (NOT a raw
 * string), so attributes get escaped properly and the type-checker can
 * catch typos. Use `inline` on `<style>` / `<script>` for body content.
 */
export type HeadEntry =
  | { tag: 'meta'; name?: string; property?: string; content: string; httpEquiv?: string }
  | {
      tag: 'link'
      rel: string
      href: string
      type?: string
      sizes?: string
      crossorigin?: 'anonymous' | 'use-credentials'
      as?: string
      media?: string
    }
  | {
      tag: 'script'
      src?: string
      type?: string
      async?: boolean
      defer?: boolean
      inline?: string
    }
  | { tag: 'style'; inline: string; media?: string }

/** Document-level metadata. All fields optional. */
export interface PageMeta {
  /** <title>. */
  title?: string
  /**
   * Title template applied to inherited or auto-derived titles. `%s` is
   * the placeholder; everything else is literal. Set ONCE in the
   * layout — pages then provide just the leaf:
   *
   * ```ts
   * // root layout:
   * meta: { titleTemplate: '%s · place docs' }
   *
   * // page:
   * page('/why', {
   *   meta: 'Why place',          // becomes '<title>Why place · place docs</title>'
   *   view: () => …,
   * })
   * ```
   *
   * A page with no `meta.title` gets its `<h1>` text auto-promoted (so
   * `<h1>Why place</h1>` produces the same result without any `meta`).
   *
   * To opt out at a single page (the landing/home, typically), set
   * `titleAbsolute: true` — the inherited template is ignored and the
   * page's `title` is emitted verbatim.
   */
  titleTemplate?: string
  /**
   * When `true`, the page's `title` is emitted verbatim and any
   * inherited `titleTemplate` is ignored. Set on the landing page or
   * any page whose title is intentionally bare.
   */
  titleAbsolute?: boolean
  /** <meta name="description">. */
  description?: string
  /** <html lang="…">. Default: 'en'. */
  lang?: string
  /** <meta charset>. Default: 'utf-8'. */
  charset?: string
  /** <meta name="viewport">. Default: 'width=device-width,initial-scale=1'. */
  viewport?: string
  /** <link rel="canonical">. */
  canonical?: string
  /** <meta name="robots">. e.g. 'index, follow' or 'noindex, nofollow'. */
  robots?: string
  /** <meta name="keywords">. Joined with ', '. */
  keywords?: string[]
  /** <meta name="author">. */
  author?: string
  /** <meta name="theme-color">. */
  themeColor?: string
  /** <meta name="color-scheme">. e.g. 'light dark'. */
  colorScheme?: string
  /**
   * Class attribute on `<html>`. Scanned by Tailwind (the value is a
   * string literal in source), so utility classes here just work:
   *
   *   meta: { htmlClass: 'h-full' }
   *
   * The alternative — declaring base styles via `@layer base` in
   * tailwind's base CSS — is more typing for a worse outcome (you have
   * to teach the Tailwind compiler about classes the page already knows
   * about). Put document-shape utilities here.
   */
  htmlClass?: string
  /**
   * Class attribute on `<body>`. Same reasoning as `htmlClass`. The most
   * common use: page background, text color, font family, antialiasing —
   * the things a CSS reset would normally handle.
   *
   *   meta: { bodyClass: 'bg-zinc-950 text-zinc-100 font-sans antialiased' }
   */
  bodyClass?: string
  /** <link rel="icon">. String shorthand or { href, type, sizes }. */
  icon?: string | { href: string; type?: string; sizes?: string }
  /** Open Graph protocol fields. */
  og?: OpenGraphMeta
  /** Twitter card fields. */
  twitter?: TwitterMeta
  /** Raw escape-hatch <head> entries. Each is a structured descriptor. */
  extra?: HeadEntry[]
}

/**
 * Style sources: a URL string (emits `<link rel="stylesheet">`) or
 * `{ inline: '...' }` (emits `<style>`). Pass an array to combine.
 *
 * Tailwind integration: `await tailwind({ ... })` from
 * `@place-ts/component/tailwind` returns `{ inline: css }` which drops in
 * here directly.
 */
export type StyleSrc = string | { inline: string; media?: string }

/**
 * Tagged-template helper that produces an inline `StyleSrc` from raw
 * CSS. Drop directly into `page({ styles })`:
 *
 * ```ts
 * page({
 *   styles: css`
 *     .note { padding: 1rem; border: 1px solid currentColor; }
 *     .note h2 { margin-top: 0; }
 *   `,
 * })
 * ```
 *
 * Interpolation works for primitive values; objects are JSON-stringified
 * defensively. A media-attribute variant is `cssMedia('print', \`...\`)`.
 */
export function css(strings: TemplateStringsArray, ...values: unknown[]): StyleSrc {
  let out = ''
  for (let i = 0; i < strings.length; i++) {
    out += strings[i]
    if (i < values.length) {
      const v = values[i]
      out += v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    }
  }
  return { inline: out }
}

/**
 * `css` variant that attaches a `media` attribute to the resulting
 * `<style>` block. Curried so the tagged-template syntax works:
 *
 * ```ts
 * styles: cssMedia('print')`body { color: black; }`
 * styles: cssMedia('(max-width: 768px)')`.sidebar { display: none; }`
 * ```
 */
export function cssMedia(
  media: string,
): (strings: TemplateStringsArray, ...values: unknown[]) => StyleSrc {
  return (strings, ...values) => {
    const inner = css(strings, ...values)
    return { inline: (inner as { inline: string }).inline, media }
  }
}

export function renderHeadEntry(e: HeadEntry): string {
  switch (e.tag) {
    case 'meta': {
      let attrs = ''
      if (e.name) attrs += ` name="${escapeHtmlAttrFull(e.name)}"`
      if (e.property) attrs += ` property="${escapeHtmlAttrFull(e.property)}"`
      if (e.httpEquiv) attrs += ` http-equiv="${escapeHtmlAttrFull(e.httpEquiv)}"`
      attrs += ` content="${escapeHtmlAttrFull(e.content)}"`
      return `<meta${attrs}>`
    }
    case 'link': {
      let attrs = ` rel="${escapeHtmlAttrFull(e.rel)}" href="${escapeHtmlAttrFull(e.href)}"`
      if (e.type) attrs += ` type="${escapeHtmlAttrFull(e.type)}"`
      if (e.sizes) attrs += ` sizes="${escapeHtmlAttrFull(e.sizes)}"`
      if (e.crossorigin) attrs += ` crossorigin="${e.crossorigin}"`
      if (e.as) attrs += ` as="${escapeHtmlAttrFull(e.as)}"`
      if (e.media) attrs += ` media="${escapeHtmlAttrFull(e.media)}"`
      return `<link${attrs}>`
    }
    case 'script': {
      let attrs = ''
      if (e.src) attrs += ` src="${escapeHtmlAttrFull(e.src)}"`
      if (e.type) attrs += ` type="${escapeHtmlAttrFull(e.type)}"`
      if (e.async) attrs += ' async'
      if (e.defer) attrs += ' defer'
      // <script> always needs a closing tag, even when src= is set.
      return `<script${attrs}>${e.inline ?? ''}</script>`
    }
    case 'style': {
      const media = e.media ? ` media="${escapeHtmlAttrFull(e.media)}"` : ''
      return `<style${media}>${e.inline}</style>`
    }
  }
}

export function renderMeta(m: PageMeta | undefined): { headHtml: string; lang: string } {
  const lang = m?.lang ?? 'en'
  if (!m) return { headHtml: '', lang }
  const parts: string[] = []
  // Title resolution: when a `titleTemplate` is inherited (typically
  // from a layout) and the leaf isn't marked absolute, substitute the
  // leaf title into the template's `%s` placeholder. Falls back to the
  // raw title when no template is set or absolute is requested.
  const resolvedTitle =
    m.title && m.titleTemplate && !m.titleAbsolute
      ? m.titleTemplate.replace('%s', m.title)
      : m.title
  if (resolvedTitle) parts.push(`<title>${escapeHtmlText(resolvedTitle)}</title>`)
  if (m.description) {
    parts.push(renderHeadEntry({ tag: 'meta', name: 'description', content: m.description }))
  }
  if (m.canonical) parts.push(renderHeadEntry({ tag: 'link', rel: 'canonical', href: m.canonical }))
  if (m.robots) parts.push(renderHeadEntry({ tag: 'meta', name: 'robots', content: m.robots }))
  if (m.keywords?.length) {
    parts.push(renderHeadEntry({ tag: 'meta', name: 'keywords', content: m.keywords.join(', ') }))
  }
  if (m.author) parts.push(renderHeadEntry({ tag: 'meta', name: 'author', content: m.author }))
  if (m.themeColor) {
    parts.push(renderHeadEntry({ tag: 'meta', name: 'theme-color', content: m.themeColor }))
  }
  if (m.colorScheme) {
    parts.push(renderHeadEntry({ tag: 'meta', name: 'color-scheme', content: m.colorScheme }))
  }
  if (m.icon) {
    const ic = typeof m.icon === 'string' ? { href: m.icon } : m.icon
    parts.push(
      renderHeadEntry({
        tag: 'link',
        rel: 'icon',
        href: ic.href,
        ...(ic.type ? { type: ic.type } : {}),
        ...(ic.sizes ? { sizes: ic.sizes } : {}),
      }),
    )
  }
  if (m.og) {
    for (const [k, v] of Object.entries(m.og)) {
      if (v == null) continue
      parts.push(renderHeadEntry({ tag: 'meta', property: `og:${k}`, content: String(v) }))
    }
  }
  if (m.twitter) {
    for (const [k, v] of Object.entries(m.twitter)) {
      if (v == null) continue
      parts.push(renderHeadEntry({ tag: 'meta', name: `twitter:${k}`, content: String(v) }))
    }
  }
  if (m.extra) for (const e of m.extra) parts.push(renderHeadEntry(e))
  return { headHtml: parts.join(''), lang }
}

export function renderStyles(styles: StyleSrc | StyleSrc[] | undefined): string {
  if (!styles) return ''
  const list = Array.isArray(styles) ? styles : [styles]
  let out = ''
  for (const s of list) {
    if (typeof s === 'string') {
      out += renderHeadEntry({ tag: 'link', rel: 'stylesheet', href: s })
    } else {
      out += renderHeadEntry(
        s.media
          ? { tag: 'style', inline: s.inline, media: s.media }
          : { tag: 'style', inline: s.inline },
      )
    }
  }
  return out
}

export interface DocumentParts {
  meta?: PageMeta
  styles?: StyleSrc | StyleSrc[]
  /**
   * Inline script(s) emitted at the TOP of `<head>` — BEFORE styles
   * and BEFORE the body parses. Use this for early-paint hints that
   * the first paint depends on, e.g. setting
   * `<html data-place-platform="mac">` so a platform-specific kbd
   * label paints correctly without a post-hydration mutation blip.
   *
   * Each entry is a raw JS statement (NOT wrapped in `<script>`). The
   * framework wraps with a nonced `<script>` tag for strict CSP.
   * Idempotent re-execution is the caller's responsibility.
   */
  earlyHead?: readonly string[]
  /** Module URL of the hydration bootstrap. Auto-injected by serve(). */
  bootstrap?: string
  /**
   * Shared-chunk URLs to preload in `<head>` via
   * `<link rel="modulepreload">`. Lets the browser fetch them in
   * parallel with the HTML doc + entry bundles, instead of waiting
   * for an island's `import` statement to be parsed. Cuts the
   * critical-path depth on slow connections.
   */
  chunkPreloads?: readonly string[]
  /**
   * Additional `<script type="module">` URLs to emit at the end of
   * `<body>` (after `bootstrap`). T5-C uses this for per-island mount
   * scripts: each used island contributes one URL. Empty/undefined →
   * no extra scripts.
   */
  extraScripts?: readonly string[]
  /**
   * Per-request CSP script nonce. Applied to `bootstrap` and every
   * `extraScripts` tag so strict CSP (`script-src 'self' 'nonce-…'`)
   * accepts them. The same nonce must appear in the response's CSP
   * `script-src` header.
   */
  scriptNonce?: string
  /**
   * Optional SRI (Subresource Integrity) hash per script URL. When a
   * URL has an entry, the framework emits `integrity="sha384-…"
   * crossorigin="anonymous"` on its `<script>` tag — the browser
   * verifies the fetched bytes match the hash before executing.
   * Closes the CDN-tampering / MITM-injection class of attacks
   * regardless of TLS state. ADR 0025.
   *
   * Keys are URLs (the same strings passed in `bootstrap` /
   * `extraScripts`); values are base64-encoded SHA-384 digests.
   */
  scriptIntegrity?: Readonly<Record<string, string>>
}

export function renderDocument(body: string, parts: DocumentParts): string {
  const { headHtml, lang } = renderMeta(parts.meta)
  const charset = parts.meta?.charset ?? 'utf-8'
  const viewport = parts.meta?.viewport ?? 'width=device-width,initial-scale=1'
  const stylesHtml = renderStyles(parts.styles)
  const nonceAttr = parts.scriptNonce ? ` nonce="${escapeHtmlAttrFull(parts.scriptNonce)}"` : ''
  const integrityFor = (url: string): string => {
    const hash = parts.scriptIntegrity?.[url]
    return hash ? ` integrity="sha384-${escapeHtmlAttrFull(hash)}" crossorigin="anonymous"` : ''
  }
  const bootstrapTag = parts.bootstrap
    ? `<script type="module" src="${escapeHtmlAttrFull(parts.bootstrap)}"${nonceAttr}${integrityFor(parts.bootstrap)}></script>`
    : ''
  const extraScriptsHtml =
    parts.extraScripts && parts.extraScripts.length > 0
      ? parts.extraScripts
          .map(
            (src) =>
              `<script type="module" src="${escapeHtmlAttrFull(src)}"${nonceAttr}${integrityFor(src)}></script>`,
          )
          .join('')
      : ''
  const htmlClassAttr = parts.meta?.htmlClass
    ? ` class="${escapeHtmlAttrFull(parts.meta.htmlClass)}"`
    : ''
  const bodyClassAttr = parts.meta?.bodyClass
    ? ` class="${escapeHtmlAttrFull(parts.meta.bodyClass)}"`
    : ''
  // Early-head inline scripts run BEFORE any other head content so
  // attribute-setting (e.g. `data-place-platform`) feeds the very first
  // style resolution. Each entry is wrapped in a nonced `<script>`.
  const earlyHeadHtml =
    parts.earlyHead && parts.earlyHead.length > 0
      ? parts.earlyHead.map((js) => `<script${nonceAttr}>${js}</script>`).join('')
      : ''
  // **`<link rel="modulepreload">` strategy — preload SHARED CHUNKS,
  // not entries.**
  //
  // The dep tree on an islands-mode page is:
  //   HTML doc → island entries → shared chunks (`import` statements).
  //
  // Without preload hints, the browser fetches chunks only AFTER it's
  // parsed at least one entry and discovered the import — that's the
  // 20-30 ms "discovery latency" Lighthouse's critical-path audit
  // surfaces. Preloading the shared chunks in `<head>` lets the
  // browser fetch them in PARALLEL with the HTML doc + entries,
  // collapsing the chain to `HTML → (entries ∥ chunks)`.
  //
  // We deliberately do NOT preload the per-island entries themselves:
  //   - There are 8-12 of them (vs 2-4 chunks).
  //   - At the browser's typical 6-stream HTTP/2 concurrency, 8+
  //     entry preloads compete with the HTML doc for slots → LCP
  //     regression on slow connections (confirmed via Lighthouse A/B:
  //     all-entries preload → 99, no-preload → 92, chunks-only → 100).
  //   - Entries are tiny (~2-3 KB) — their fetch finishes fast once
  //     it starts; the dominant cost is the chunks they import.
  //
  // The per-route bootstrap bundle also gets preloaded for the
  // same reason — it's the entry that everything else hangs off.
  const preloadFor = (src: string): string => {
    const integ = integrityFor(src)
    const crossorigin = integ.includes('crossorigin') ? '' : ' crossorigin="anonymous"'
    return `<link rel="modulepreload" href="${escapeHtmlAttrFull(src)}" as="script"${integ}${crossorigin}>`
  }
  const preloadUrls: string[] = []
  if (parts.bootstrap) preloadUrls.push(parts.bootstrap)
  if (parts.chunkPreloads) preloadUrls.push(...parts.chunkPreloads)
  const preloadsHtml = preloadUrls.map(preloadFor).join('')
  return (
    `<!doctype html><html lang="${escapeHtmlAttrFull(lang)}"${htmlClassAttr}><head>` +
    `<meta charset="${escapeHtmlAttrFull(charset)}">` +
    `<meta name="viewport" content="${escapeHtmlAttrFull(viewport)}">` +
    earlyHeadHtml +
    preloadsHtml +
    headHtml +
    stylesHtml +
    `</head><body${bodyClassAttr}>${body}${bootstrapTag}${extraScriptsHtml}</body></html>`
  )
}
