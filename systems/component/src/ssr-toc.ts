// SSR-side helpers: heading extraction, per-island re-render, and
// island-marker post-processing for the `transformBody` hook.
//
// **Why this exists**: a typical docs/article layout has a right-side
// "On this page" outline that lists every `<h2>` / `<h3>` heading in
// the page's main content. Without SSR injection, the outline ships
// empty (the island scans the DOM on client mount), and the user sees
// an empty box flash to a populated list on every page load. That's
// a visible blip on the order of 100-200 ms — small but never zero.
//
// **The fix**: after the framework renders the page body to HTML,
// scan the rendered string for `<h2>` / `<h3>` tags inside `<main>`,
// slug the text into stable ids, inject those ids back into the
// rendered HTML, and surface the heading list to any island that
// wants it.
//
// **Why string ops (not a re-render)**: the alternative is a two-pass
// render — first render the page, collect headings, re-render with the
// toc populated. That doubles the SSR cost. String surgery on the
// already-rendered HTML is O(N) where N is body bytes; on a heavy
// article page that's microseconds. Trade-off is fragility to HTML
// edge cases (escape sequences inside `<h2>` text), addressed below.
//
// **Scope**: the scanner is anchored at the first `<main>` tag and
// stops at its closing `</main>`. Heading tags inside the `<head>` (a
// `<h2>` in a `<title>` would be malformed, but defense-in-depth) or
// nav/aside (e.g. a "Section" subtitle in a sidebar) don't count
// toward the outline.

// Static imports of `./index.ts` create an ESM cycle (index.ts also
// re-exports from this file). The cycle is safe because we only
// dereference these bindings at request-handling time — long after
// both modules finish initialization. `_getIslandRegistry` reads a
// per-app mutable state set by `serve()`; `renderToString` is a
// pure render function. Neither runs at module init.
import { _getIslandRegistry, renderToString, type SsrHeading } from './index.ts'

// `SsrHeading` is now declared canonically in `index.ts` (since the
// framework's render-time heading collector is the primary surface).
// We re-export here so existing consumers of `@place/component` that
// imported the type from this path keep working unchanged.
export type { SsrHeading }

/**
 * Slugify text into a stable `[a-z0-9-]+` id. Same algorithm the
 * framework's render-time collector uses, kept identical so post-
 * render extraction agrees with auto-injected ids.
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Strip HTML tags from a string. Used to get heading text out of
 * `<h2>Some <code>token</code> heading</h2>`. */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim()
}

/** Decode the small set of HTML entities that appear in heading text. */
function decodeBasicEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/**
 * Find the `<main>` region of a body HTML string. Returns the
 * `[start, end)` byte indices of the OPENING tag and the CLOSING tag,
 * or `null` if no `<main>` is present. Used to anchor the heading
 * scan so headings in sidebars, navs, or footers don't get picked up.
 */
function findMainRange(html: string): { open: number; close: number } | null {
  // Tolerate attributes on the opening tag (`<main class="..." data-...>`).
  const openMatch = html.match(/<main[\s>]/i)
  if (!openMatch || openMatch.index === undefined) return null
  // Walk past the opening tag's closing `>`.
  const afterOpen = html.indexOf('>', openMatch.index)
  if (afterOpen < 0) return null
  // The closing `</main>` matches case-insensitively. We assume a
  // single top-level `<main>` per page (which is the HTML5 spec —
  // multiple `<main>` is invalid). Pages that don't follow this get
  // a heading list anchored at the first one.
  const closeIdx = html.toLowerCase().indexOf('</main>', afterOpen)
  if (closeIdx < 0) return null
  return { open: afterOpen + 1, close: closeIdx }
}

/**
 * Scan the body for `<h2>` / `<h3>` tags inside `<main>`. For each:
 *   - if the tag has no `id` attribute, slugify the text and inject one
 *   - append `{ id, text, level }` to the headings list
 *
 * Returns the (possibly modified) HTML + the heading list. The
 * function is pure — no per-request state, safe to call concurrently.
 *
 * Duplicate slugs get a numeric suffix (`section-2`, `section-3`, …)
 * so anchor links always resolve uniquely. Matches the client-side
 * `rescan()` algorithm in the docs ToC island, by design.
 */
export function extractMainHeadings(html: string): {
  readonly html: string
  readonly headings: ReadonlyArray<SsrHeading>
} {
  const range = findMainRange(html)
  if (!range) return { html, headings: [] }
  // Match every <h2> / <h3> opening tag + inner content + closing tag.
  // The pattern is anchored on `<h(2|3)` (case-insensitive) and lazy-
  // matches its inner content up to the matching `</h(2|3)>`.
  //
  // Two captures:
  //   [1] level digit
  //   [2] attribute string between `<h2` and `>`
  //   [3] inner HTML
  const before = html.slice(0, range.open)
  const main = html.slice(range.open, range.close)
  const after = html.slice(range.close)
  const tagRe = /<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi
  const headings: SsrHeading[] = []
  const seenIds = new Set<string>()
  let cursor = 0
  let out = ''
  for (let m = tagRe.exec(main); m !== null; m = tagRe.exec(main)) {
    // The regex always produces 4 captures (full, level, attrs, inner)
    // and matches require all three groups to participate; the
    // non-nullable assertions are safe because the regex shape
    // guarantees them. TypeScript types `string | undefined` for any
    // capture group, defensively — we coerce with `?? ''` rather than
    // bang-assert to also handle truly-empty inner-HTML edges.
    const full = m[0]
    const levelStr = m[1] ?? ''
    const attrs = m[2] ?? ''
    const innerHtml = m[3] ?? ''
    const startIdx = m.index
    const endIdx = startIdx + full.length
    // Existing id attribute? Honor it — the page set the id explicitly,
    // we don't overwrite. Anchor links from elsewhere may depend on it.
    const idMatch = attrs.match(/\sid=("([^"]*)"|'([^']*)')/)
    const existingId = idMatch ? (idMatch[2] ?? idMatch[3] ?? '') : ''
    const text = decodeBasicEntities(stripTags(innerHtml))
    if (!text) {
      // Empty heading: skip — no useful entry to add.
      out += main.slice(cursor, endIdx)
      cursor = endIdx
      continue
    }
    const baseId = existingId || slugifyHeading(text)
    if (!baseId) {
      // Unable to slug (text was all-punctuation). Skip.
      out += main.slice(cursor, endIdx)
      cursor = endIdx
      continue
    }
    let finalId = baseId
    let n = 2
    while (seenIds.has(finalId)) {
      finalId = `${baseId}-${n}`
      n++
    }
    seenIds.add(finalId)
    headings.push({
      id: finalId,
      text,
      level: levelStr === '2' ? 2 : 3,
    })
    if (existingId) {
      // Already has an id — write the heading tag through unchanged.
      out += main.slice(cursor, endIdx)
    } else {
      // Inject id="..." right after the opening `<hN` tag-name. We add
      // the attribute as the FIRST attribute so existing `class`,
      // `data-*`, etc. on the tag don't have to be parsed.
      const injected = `<h${levelStr} id="${finalId}"${attrs}>${innerHtml}</h${levelStr}>`
      out += main.slice(cursor, startIdx) + injected
    }
    cursor = endIdx
  }
  out += main.slice(cursor)
  return { html: before + out + after, headings }
}

/**
 * Locate an island marker by `data-view-id` and replace its inner HTML
 * (the contents between the opening and closing `<div>` tags) with
 * `newInner`. Also merges `propPatch` into the marker's
 * `data-view-props` attribute so the island reads the new initial
 * state when it hydrates on the client.
 *
 * Returns the modified HTML, or the input unchanged if no marker with
 * that id is present (silent — apps can wire this hook safely even on
 * pages where the island isn't used).
 *
 * **Why we modify both inner HTML AND props**: hydration adopts the
 * SSR'd DOM and runs the island function with whatever the props say.
 * If the inner HTML shows the populated list but props say
 * `{ initialHeadings: [] }`, the island's first reactive read of its
 * state will overwrite the SSR DOM with the empty list. Both halves
 * must agree.
 */
export function patchIslandMarker(
  html: string,
  viewId: string,
  newInner: string,
  propPatch?: Record<string, unknown>,
): string {
  // Marker shape (current framework wire format):
  //   <div data-view="island" data-view-id="<NAME>" [data-view-props='{...}'] [data-view-strategy="..."]>
  //     <SSR rendered island content>
  //   </div>
  // Match the opening div + capture its attributes, find the matching
  // closing </div>, and rebuild.
  const openRe = new RegExp(`<div([^>]*\\sdata-view-id="${escapeRegex(viewId)}"[^>]*)>`, 'i')
  const m = openRe.exec(html)
  if (!m) return html
  const openTag = m[0]
  const attrs = m[1] ?? ''
  const openStart = m.index
  const openEnd = m.index + openTag.length
  // Find the matching </div>. We track depth to handle nested divs.
  let depth = 1
  let i = openEnd
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', i)
    const nextClose = html.indexOf('</div>', i)
    if (nextClose < 0) return html // unbalanced — abort
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }
  if (depth !== 0) return html
  const closeEnd = i
  // Patch attributes if requested. Walk the existing data-view-props
  // (which is JSON-as-attribute), merge, re-encode. If absent, add.
  let nextAttrs = attrs
  if (propPatch) {
    const propsMatch = attrs.match(/\sdata-view-props=('([^']*)'|"([^"]*)")/)
    let current: Record<string, unknown> = {}
    if (propsMatch) {
      const raw = decodeBasicEntities(propsMatch[2] ?? propsMatch[3] ?? '{}')
      try {
        current = JSON.parse(raw) as Record<string, unknown>
      } catch {
        current = {}
      }
    }
    const merged = { ...current, ...propPatch }
    const encoded = encodeForHtmlAttr(JSON.stringify(merged))
    if (propsMatch) {
      nextAttrs = attrs.replace(propsMatch[0], ` data-view-props='${encoded}'`)
    } else {
      // Insert before the closing > of the opening tag.
      nextAttrs = `${attrs} data-view-props='${encoded}'`
    }
  }
  const newOpen = `<div${nextAttrs}>`
  // `closeEnd` is the byte index immediately after the matched </div>.
  // Splice: [start, openStart) + newOpen + newInner + </div> + [closeEnd, end).
  return `${html.slice(0, openStart)}${newOpen}${newInner}</div>${html.slice(closeEnd)}`
}

/**
 * Re-render an island server-side with new props and patch the result
 * back into the rendered body. The framework looks up the island's
 * registered component (the same one the user passed to `island(...)`),
 * invokes it with `props`, serialises the resulting view to HTML, and
 * splices that HTML in place of the island marker's current inner
 * content — also merging `props` into the marker's `data-view-props`
 * so client hydration receives the same initial state.
 *
 * **Why this exists.** The simpler primitives (`extractMainHeadings`
 * + `patchIslandMarker`) leave the app rendering a parallel HTML
 * template that must byte-match the island's JSX (label class, list
 * class, anchor class permutations for active vs inactive, etc.).
 * Any drift between the two breaks hydration with cryptic "expected
 * <div> but found no element" errors. `rerenderIsland` removes the
 * duplication by routing the second-pass render through the very
 * same component the island would have used at hydrate time — so by
 * construction the SSR HTML matches what the client expects.
 *
 * **Usage** from a `transformBody` hook:
 *
 * ```ts
 * import { extractMainHeadings, rerenderIsland } from '@place/component'
 *
 * app({
 *   transformBody: (body) => {
 *     const { html, headings } = extractMainHeadings(body)
 *     if (headings.length === 0) return html
 *     return rerenderIsland(html, 'toc', { initialHeadings: headings })
 *   }
 * })
 * ```
 *
 * The island's component accepts `props` as a single argument; pass
 * whatever shape the component expects. Type checking is the caller's
 * responsibility (the registry stores erased component types).
 *
 * **Cost.** One extra `renderToString` per request for each island
 * being re-rendered — the toc on a typical docs page costs ~0.5 ms
 * (measured on the docs build). Cheaper than a two-pass page render
 * and only runs when the page actually has headings worth surfacing.
 *
 * Returns the (possibly modified) HTML, or the input unchanged if no
 * island with that id is registered or the marker isn't in the body.
 */
export function rerenderIsland<P extends Record<string, unknown>>(
  html: string,
  viewId: string,
  props: P,
): string {
  const reg = _getIslandRegistry()[viewId]
  if (!reg) return html
  // Invoke the registered component with the new props. The view it
  // returns is the **wrapped callable** the island registry stores —
  // calling it produces a full `<div data-view="island" …>…</div>`
  // marker as if the island were being SSR'd inside a page. We want
  // only the marker's INNER content; the outer marker is already
  // present in `html` and `patchIslandMarker` will splice the new
  // inner into it. Strip the wrapper before patching.
  const view = reg.component(props as never)
  const wrappedHtml = renderToString(view)
  const innerHtml = stripIslandWrapper(wrappedHtml)
  return patchIslandMarker(html, viewId, innerHtml, props)
}

/**
 * Strip the outermost `<div data-view="island" …>…</div>` from a
 * single-island render. The island factory emits the marker as the
 * outermost element; the rest of the rendered HTML is the user's
 * view. This function removes the marker open/close pair so the body
 * can be spliced into a pre-existing marker without nesting markers.
 *
 * Conservative: returns the input unchanged if the shape doesn't
 * match the expected marker (which means either Bun changed how
 * `island()` emits its wrapper, or the caller passed non-island
 * HTML — both cases should be visible as "no patching happened"
 * rather than a silent partial strip).
 */
function stripIslandWrapper(html: string): string {
  const trimmed = html.trim()
  if (!trimmed.startsWith('<div')) return html
  const openClose = trimmed.indexOf('>')
  if (openClose < 0) return html
  // Quick sanity: the opening tag must contain `data-view="island"`.
  // Otherwise this isn't the island wrapper we expect.
  const openTag = trimmed.slice(0, openClose + 1)
  if (!openTag.includes('data-view="island"')) return html
  if (!trimmed.endsWith('</div>')) return html
  return trimmed.slice(openClose + 1, trimmed.length - '</div>'.length)
}

/** RegExp-escape user-supplied strings for embedding in patterns. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Encode a JSON string for safe placement inside a single-quoted
 * HTML attribute. Apostrophes get HTML-entity-encoded; `<` is escaped
 * so the attribute can't accidentally close the surrounding tag. */
function encodeForHtmlAttr(json: string): string {
  return json.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;')
}
