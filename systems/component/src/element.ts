// @place-ts/component — element factory + SSR string emitter + directives.
//
// Extracted from index.ts (Tier 20 decomposition, cut 3) — the
// rendering core. `el()` + `makeView()` build every View; the string
// emitter (`elementToHtml` / `childToHtml`) serializes a View to HTML
// for SSR and stamps hydration markers; the directive layer
// (`class:` / `style:` / `bind:` / `use:`) and the CSP-safe
// inline-style writer apply runtime bindings.
//
// `index.ts` imports the symbols it needs from here and re-exports the
// public surface (`el`, the heading-collection helpers, `SsrHeading`),
// so existing call sites and the package's public API are unchanged.

import { defineCapability } from '@place-ts/capability'
// Reactive primitives + the View / Child / props types.
import { batch, type Disposer, type State, untrack, watch } from '@place-ts/reactivity'
// Cleanup-scope + hydration-audit + slot internals.
import { disposeAll, withCleanups } from './_internal/cleanup.ts'
// `ErrorBoundaryCap` — the error-boundary capability `makeView`'s
// error path reads. A `_internal/` leaf; no barrel cycle.
import { ErrorBoundaryCap } from './_internal/error-boundary-cap.ts'
import { _auditHydrationFrame } from './_internal/hydration.ts'
// Hydration-id counter — shared with the SSR renderers.
import { nextHydrationId } from './_internal/hydrationSeq.ts'
// `currentInlineStyleSet` — the live per-request inline-style-attr
// hash collector. The SSR emitter `.add()`s every emitted `style="…"`
// value into it so the dispatcher can whitelist them in the CSP.
import { addInlineStyle } from './_internal/inline-style.ts'
import { makeSlot } from './_internal/slot.ts'
// `mountChildren` (the reactive-children DOM mounter) lives in
// ./mount.ts. element.ts ⇄ mount.ts is a function-level cycle —
// `makeView`'s `.mount()` calls `mountChildren`, which mounts child
// Views built by `el` — resolved fine since neither touches the
// other at module-eval.
import { mountChildren } from './mount.ts'
import type { Child, ElementProps, View } from './types.ts'
// HTML escaping for the SSR string emitter.
import { escapeHtmlAttr, escapeHtmlText } from './utils/escape.ts'

// ===== Generic element factory =====
//
// Three call forms:
//   el('div')                        — no props, no children
//   el('div', { class: 'x' })        — props only (JSX runtime path)
//   el('div', 'text')                — child only (no props)
//   el('div', { class: 'x' }, 'text', span(), () => count.read())
//                                    — props + variadic children
//
// The first arg after `tag` is treated as props if it's a plain object
// (not null, not an array, no .mount method). Anything else, plus all
// remaining args, are children.

type ElementArg = ElementProps | Child | Child[]

function isProps(x: ElementArg): x is ElementProps {
  return x != null && typeof x === 'object' && !Array.isArray(x) && !('mount' in x)
}

export function el(tag: string, ...args: ElementArg[]): View {
  let props: ElementProps = {}
  let rest: ElementArg[] = args

  if (args.length > 0 && isProps(args[0] as ElementArg)) {
    props = args[0] as ElementProps
    rest = args.slice(1)
  }

  if (rest.length > 0) {
    const existing = props.children
    const existingArr: Child[] =
      existing === undefined ? [] : Array.isArray(existing) ? existing : [existing]
    const flattened: Child[] = []
    for (const arg of rest) {
      if (Array.isArray(arg)) flattened.push(...(arg as Child[]))
      else flattened.push(arg as Child)
    }
    props = { ...props, children: [...existingArr, ...flattened] }
  }

  return makeView(tag, props)
}

// ===== String emitter (SSR + hydration markers) =====
//
// Each `el(tag, props)` View knows how to render itself to an HTML
// string without touching the DOM. The string emitter:
//   - HTML-escapes attribute values and text children (XSS safety)
//   - emits boolean attrs as bare attribute names
//   - skips null/false/undefined attrs entirely
//   - resolves reactive prop functions ONCE for their initial value
//   - recurses into children (string / function / View / array)
//   - emits self-closing tags without a closing pair
//   - tags each element with `data-h="<seq>"` for hydration matching
//
// The seq counter is a process-global (`hydrationSeq`); `renderToString`
// resets it before each call so markers are 0-based per render. Since
// rendering is synchronous and Bun is single-threaded, no isolation
// issue at the runtime level.

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

// ============================================================
// Per-render heading collector (auto-anchors h2/h3 in <main>).
// ============================================================
//
// **Why this lives in the element factory, not as a post-render
// regex pass.** `extractMainHeadings()` used to scan rendered HTML
// with regex to find h2/h3 inside `<main>`, slug their text, and
// inject `id="…"` attrs into the output string. That works but it's
// a workaround — parsing the framework's own output instead of
// observing the render. Edge cases (entities in text, nested tags,
// custom main-like containers) need bespoke handling per scanner.
//
// The structural answer is to track headings AS THEY'RE RENDERED.
// `elementToHtml` is the chokepoint where every JSX element gets
// serialized; it already has the tag + props + children in typed
// form. We:
//
//   1. Increment `currentMainDepth` when emitting `<main>`,
//      decrement after its children are rendered.
//   2. When emitting `<h2>` / `<h3>` inside `<main>` while a
//      collector scope is active, extract the heading text from its
//      children (typed-tree walk, not regex), slug it, dedupe, and
//      inject `id="…"` into the element's attrs before serialization.
//      Push `{ id, text, level }` onto the collector.
//   3. Islands declaring `ssrProps` receive `ctx.headings` directly —
//      no string parsing, no second-pass extraction.
//
// **Scope.** The collector is scoped per-render via
// `_beginHeadingCollection()` / `_endHeadingCollection()` (paired
// around `renderToString(view)` in `renderPage`). Concurrent SSR
// renders are serialized through `renderToString`'s synchronous body,
// so the module-level cursor is safe.

/** One heading collected during render. Stable across server + client
 *  (same slug algorithm; the framework's `el()` injects the id at
 *  SSR time so the hydrated DOM matches). */
export interface SsrHeading {
  readonly id: string
  readonly text: string
  readonly level: 2 | 3
}

/**
 * Per-render heading-collection scope. Pre-0.10.10 this was four
 * module-level `let`s; under `renderToString` (synchronous) that
 * worked, but the same caveat as the inline-style collector applies
 * — async ssrProps / transformBody would corrupt it across requests.
 * The cap-backed scope (below) is rigorously per-request via
 * `@place-ts/capability`'s AsyncLocalStorage backing.
 *
 * `mainDepth` and `firstH1Text` are boxed in `{ value: T }` objects
 * because callers (the `el()` factory) mutate them in place. A bare
 * `number` / `string` field would be read-by-value and lose the
 * mutation.
 */
interface HeadingScope {
  collector: SsrHeading[]
  ids: Set<string>
  mainDepth: { value: number }
  firstH1Text: { value: string | null }
}

const HeadingScopeCap = defineCapability<HeadingScope>('PlaceHeadingScope')

// Stack of disposers, one per active begin scope (always at most 1 in
// the current renderPage flow — defensive trampoline for future
// callers that might nest).
const _headingDisposers: Array<() => void> = []

// Module-level reference to the most recently begun scope. Kept so
// `_getFirstH1Text()` can read the value AFTER `_endHeadingCollection()`
// has unwound the cap — a contract the framework's render-page.ts
// relies on. Set on begin; not cleared on end. Always corresponds to
// the LAST render in this process; since begin → render → end →
// _getFirstH1Text is sync inside one renderPage call, no concurrent
// request can land between end and _getFirstH1Text.
let _lastHeadingScope: HeadingScope | null = null

/** Internal: read the active heading scope. Returns `null` outside
 *  any begin/end pair. */
function currentHeading(): HeadingScope | null {
  return HeadingScopeCap.tryUse()
}

/**
 * Begin collecting h2/h3 headings inside `<main>` during the next
 * render. The framework calls this immediately before
 * `renderToString(view)` in `renderPage`; islands declaring
 * `ssrProps` receive the populated list via `ctx.headings`.
 */
export function _beginHeadingCollection(): SsrHeading[] {
  const scope: HeadingScope = {
    collector: [],
    ids: new Set(),
    mainDepth: { value: 0 },
    firstH1Text: { value: null },
  }
  const dispose = HeadingScopeCap.install(scope)
  _headingDisposers.push(dispose)
  _lastHeadingScope = scope
  return scope.collector
}

/** End the heading collection scope. */
export function _endHeadingCollection(): void {
  const d = _headingDisposers.pop()
  if (d !== undefined) d()
  // _lastHeadingScope intentionally kept — `_getFirstH1Text()` reads
  // it AFTER end. It's overwritten on the next `_beginHeadingCollection()`.
}

/**
 * Read the first `<h1>` text captured during the most recent
 * heading-collection scope. Returns `null` when no h1 was rendered
 * inside `<main>`. Used by `renderPage` for auto-title derivation.
 */
export function _getFirstH1Text(): string | null {
  return _lastHeadingScope?.firstH1Text.value ?? null
}

/**
 * Slugify heading text into a stable `[a-z0-9-]+` id. Same algorithm
 * the toc island uses on the client when re-scanning after SPA-nav,
 * so server + client agree on every anchor href.
 */
function slugifyHeadingText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Extract plain text from a Child tree. Walks the same shapes
 * `childToHtml` walks (strings, numbers, function children, arrays,
 * Views) but returns just the visible text content — no tags, no
 * attributes. Used to derive heading text for slug generation.
 */
function childToText(child: Child): string {
  if (child == null || child === false || child === true) return ''
  if (typeof child === 'string') return child
  if (typeof child === 'number') return String(child)
  if (typeof child === 'function') {
    return childToText(untrack(() => (child as () => Child)()))
  }
  if (Array.isArray(child)) {
    let out = ''
    for (const c of child) out += childToText(c as Child)
    return out
  }
  // Views: render to HTML and strip tags. Cheaper than re-walking
  // the View's children directly (we'd need a typed accessor), and
  // headings rarely contain Views that don't toHtml.
  if (child.toHtml) {
    return child.toHtml().replace(/<[^>]*>/g, '')
  }
  return ''
}

// Render a Child to an HTML string. Recurses through nested arrays and
// resolves function children via `untrack` (so we don't leak watch
// subscriptions into the surrounding scope when this is called from a
// reactive context).
export function childToHtml(child: Child): string {
  if (child == null || child === false || child === true) return ''
  if (typeof child === 'string') return escapeHtmlText(child)
  if (typeof child === 'number') return escapeHtmlText(String(child))
  if (typeof child === 'function') {
    const resolved = untrack(() => (child as () => Child)())
    return childToHtml(resolved)
  }
  if (Array.isArray(child)) {
    let out = ''
    for (const c of child) out += childToHtml(c as Child)
    return out
  }
  // Must be a View. Use toHtml if available; fall back to a safety
  // marker so missing implementations are visible during testing.
  if (child.toHtml) return child.toHtml()
  // No string emitter — best we can do is omit the View. Mount-path
  // SSR (the happy-dom fallback in renderToString) will still render
  // it; this branch only fires if someone calls toHtml() directly on
  // a parent containing a View without toHtml.
  return ''
}

function elementToHtml(tag: string, props: ElementProps): string {
  const id = nextHydrationId()
  let attrs = ` data-h="${id}"`
  // Track `<main>` nesting depth so the heading collector below can
  // scope itself to "h2/h3 inside main". Increment BEFORE children
  // are rendered (heading children are processed recursively inside
  // childToHtml below, which fires while we're still on this stack
  // frame). The matching decrement is at function exit via the
  // `try/finally` shape — kept implicit via a guard at the bottom
  // since `elementToHtml` has multiple return points.
  const enteringMain = tag === 'main'
  const _headingScope = currentHeading()
  if (enteringMain && _headingScope !== null) _headingScope.mainDepth.value++
  let childrenHtml = ''
  // Directive props fold into the base `class` / `style` attributes on
  // SSR so the rendered HTML matches what the client would compute on
  // mount. Without this, `class:active={cond}` would emit a literal
  // `class:active` attribute and the active state would only stamp in
  // after hydration — a visible flicker on hard refresh.
  let classFromBase: string | undefined
  const classDirectives: string[] = []
  let styleFromBase: string | undefined
  const styleDirectivePairs: string[] = []
  for (const [key, raw] of Object.entries(props)) {
    if (key === 'children' || key === 'ref') continue
    // Resolve reactive prop fns ONCE for the snapshot at render time.
    // Untrack so we don't accidentally subscribe a parent watch.
    const isReactive = !isEventProp(key) && typeof raw === 'function'
    const value = isReactive ? untrack(() => (raw as () => unknown)()) : raw
    if (isEventProp(key)) continue // event listeners don't render to HTML
    if (key.includes(':')) {
      const colonIdx = key.indexOf(':')
      const prefix = key.slice(0, colonIdx)
      const rest = key.slice(colonIdx + 1)
      // `bind:` and `use:` are runtime-only — no HTML rendering. They
      // attach on the client during hydrate/mount.
      if (prefix === 'bind' || prefix === 'use') continue
      if (prefix === 'class') {
        if (value) classDirectives.push(rest)
        continue
      }
      if (prefix === 'style') {
        if (value === null || value === undefined || value === false) continue
        // Reactive `style:propname={fn}` — skip SSR emission so the
        // CSP-safe runtime path (setProperty) is the sole writer
        // (ADR 0014). Two reasons not to emit the snapshot at SSR:
        //   (1) it forces every page to declare a hash for that
        //       per-request value in style-src, and during SPA-nav the
        //       PREVIOUS page's CSP is still live, so a destination's
        //       fresh inline-style value gets blocked by the source's
        //       CSP that never saw it (T6 user-reported bug).
        //   (2) once the island hydrates, setProperty overwrites the
        //       SSR'd value anyway — so the inline attr is wasted
        //       bytes + a CSP liability rather than a real first-paint
        //       win.
        // Static (string-shape) `style:propname={"value"}` continues
        // to emit normally — those are deterministic per-route and the
        // CSP hash collector covers them.
        if (isReactive) continue
        const kebab = rest.includes('-')
          ? rest
          : rest.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
        styleDirectivePairs.push(`${kebab}:${String(value)};`)
        continue
      }
      // Unknown prefix — fall through to the standard attribute path.
    }
    if (value == null || value === false) continue
    if (value === true) {
      attrs += ` ${key}`
      continue
    }
    if (key === 'class' || key === 'className') {
      classFromBase = String(value)
      continue
    }
    // Reactive `style={() => …}` — same skip rationale as `style:propname`
    // above: the runtime applies via setProperty on hydrate, and
    // skipping the SSR snapshot keeps strict CSP intact under SPA-nav.
    // Authoring guidance: use `style:propname={fn}` for individual
    // custom-property writes — it's the typed/discoverable form and
    // tree-shakes cleanly into a single setProperty call.
    if (key === 'style' && isReactive) continue
    if (key === 'style' && typeof value === 'object') {
      // Serialize style object as inline CSS. Keys are camelCase →
      // kebab-case ('backgroundColor' → 'background-color').
      let css = ''
      for (const [k, v] of Object.entries(value)) {
        if (v == null || v === false) continue
        const kebab = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
        css += `${kebab}:${String(v)};`
      }
      if (css) styleFromBase = css
      continue
    }
    if (key === 'style') {
      styleFromBase = String(value)
      continue
    }
    attrs += ` ${key}="${escapeHtmlAttr(String(value))}"`
  }
  // Emit merged class / style attributes after the directive walk so
  // their final shape reflects every contributor.
  const classMerged = [classFromBase ?? '', ...classDirectives].filter(Boolean).join(' ')
  if (classMerged) attrs += ` class="${escapeHtmlAttr(classMerged)}"`
  const styleMerged = (styleFromBase ?? '') + styleDirectivePairs.join('')
  if (styleMerged) {
    attrs += ` style="${escapeHtmlAttr(styleMerged)}"`
    // T6-B: record the literal style-attribute value so the dispatcher
    // can add `'sha256-<hash>'` to CSP `style-src` (paired with
    // `'unsafe-hashes'`). The browser hashes the *attribute value* —
    // pre-escape — so we collect the raw `styleMerged`, not the HTML-
    // attr-escaped form.
    // `addInlineStyle` hashes synchronously on insert (0.10.10 P2) —
    // no render-end Promise.all to await; the Map dedupes by value.
    addInlineStyle(styleMerged)
  }
  // **Heading auto-id (h2/h3 inside main) + auto-title (first h1
  // inside main).** Inject `id="…"` BEFORE children are rendered,
  // then collect after we know the final text. Honors a manually-set
  // `id=` (the regex below probes `attrs` which already absorbed it
  // from the user's props), so author intent wins. Outside main, or
  // with no active collector, this is a no-op.
  const isCollectableHeading =
    _headingScope !== null &&
    _headingScope.mainDepth.value > 0 &&
    (tag === 'h2' || tag === 'h3')
  const isCollectableH1 =
    _headingScope !== null &&
    _headingScope.mainDepth.value > 0 &&
    tag === 'h1' &&
    _headingScope.firstH1Text.value === null
  // Render children first to know the heading text. Headings should
  // be small (a single line of text + optional inline code), so the
  // double-walk (text + html) is O(N) on tiny strings.
  if (props.children !== undefined) {
    childrenHtml = childToHtml(props.children as Child)
  }
  if (isCollectableH1 && _headingScope !== null) {
    const text = childToText(props.children as Child).trim()
    if (text) _headingScope.firstH1Text.value = text
  }
  if (isCollectableHeading && _headingScope !== null) {
    const existingIdMatch = attrs.match(/\sid="([^"]+)"/)
    const text = childToText(props.children as Child).trim()
    if (text) {
      const base = existingIdMatch ? (existingIdMatch[1] as string) : slugifyHeadingText(text)
      if (base) {
        let finalId = base
        let n = 2
        const seen = _headingScope.ids
        while (seen.has(finalId)) {
          finalId = `${base}-${n}`
          n++
        }
        seen.add(finalId)
        _headingScope.collector.push({
          id: finalId,
          text,
          level: tag === 'h2' ? 2 : 3,
        })
        // Inject the id if the author didn't set one. If they did,
        // attrs already contains it — leave alone.
        if (!existingIdMatch) {
          attrs += ` id="${escapeHtmlAttr(finalId)}"`
        }
      }
    }
  }
  // Decrement main-depth on exit. Since `elementToHtml` has multiple
  // return points (void elements vs. paired tags), this needs to fire
  // before either branch returns.
  if (enteringMain && _headingScope !== null) _headingScope.mainDepth.value--
  if (VOID_ELEMENTS.has(tag)) {
    return `<${tag}${attrs}>`
  }
  return `<${tag}${attrs}>${childrenHtml}</${tag}>`
}

function makeView(tag: string, props: ElementProps): View {
  return {
    toHtml: () => elementToHtml(tag, props),
    // Adopt an existing element rendered by SSR. The slot points at the
    // parent's child cursor; we consume the next element and require a
    // tag match. Attach props (event listeners + reactive bindings) to
    // the EXISTING node — no DOM creation, no insertion.
    //
    // Children handling:
    //   - If ALL children are hydratable Views (the common nested-element
    //     case), recurse via a child-slot — element identity is preserved
    //     down the tree.
    //   - If any child is text/function/static (mixed content like
    //     `['hi, ', () => name, '!']`), fall back to clear + remount.
    //     Text-node boundaries can't be recovered from the merged
    //     content the browser parsed, so adoption isn't safe; remount is.
    hydrate(slot) {
      const node = slot.nextElement()
      // `<noscript>` is special: browsers with JS enabled parse its
      // content as ONE text node rather than as a real element tree.
      // Walking it the normal way desyncs the hydration cursor against
      // the data-h markers the SSR'd children carry. Consume the slot
      // for the noscript element itself and stop — the children are
      // SSR-only fallback content; they don't participate in hydration
      // and the framework runs nothing inside them once JS is live.
      if (tag === 'noscript') {
        if (node !== null) node.removeAttribute('data-h')
        return () => {}
      }
      if (node === null || node.tagName.toLowerCase() !== tag) {
        // Diagnostic-rich error: list the most common causes in plain
        // language, in priority order. The single most common gotcha
        // (root parameter confusion) is named explicitly because every
        // user hits it at least once.
        const got = node === null ? 'no element' : `<${node.tagName.toLowerCase()}>`
        const remaining =
          node === null
            ? ''
            : (() => {
                const sibs: string[] = []
                let n: Element | null = node
                while (n) {
                  sibs.push(n.tagName.toLowerCase())
                  n = n.nextElementSibling
                }
                return sibs.length > 1 ? ` (followed by <${sibs.slice(1).join('>, <')}>)` : ''
              })()
        throw new Error(
          `hydrate: expected <${tag}> but found ${got}${remaining}.\n\n` +
            'Most common causes:\n' +
            "  1. The `root` argument is the SSR'd element itself, not its parent.\n" +
            "     hydrate(view, root) walks `root.children` looking for the View's\n" +
            '     outermost element — pass the CONTAINER (e.g. document.body), not\n' +
            "     the SSR'd element.\n" +
            '  2. The View on the client differs from what the server rendered.\n' +
            '     Both sides must construct the same JSX with the same props (use\n' +
            '     URL-driven state via urlState() to ensure they converge).\n' +
            '  3. The HTML was modified between SSR and hydrate (a browser\n' +
            '     extension, an inline script before bootstrap, etc.).',
        )
      }
      const cleanups: Disposer[] = []
      // Dev-only hydration audit — compare props (what the client would
      // render) against the SSR'd DOM attributes (what the server
      // emitted) BEFORE applyProp mutates them. Production builds with
      // NODE_ENV='production' dead-code-eliminate this branch.
      if (
        typeof process !== 'undefined' &&
        process.env &&
        process.env['NODE_ENV'] !== 'production'
      ) {
        _auditHydrationFrame(node, props as Record<string, unknown>)
      }
      try {
        withCleanups(cleanups, () => {
          for (const [key, value] of Object.entries(props)) {
            if (key === 'children' || key === 'ref') continue
            applyProp(node as HTMLElement, key, value, cleanups)
          }
          if (props.ref) props.ref(node as HTMLElement)
          if (props.children !== undefined) {
            const list: Child[] = Array.isArray(props.children)
              ? (props.children as Child[])
              : [props.children as Child]
            const allHydratableViews = list.every(
              (c) => c != null && typeof c === 'object' && 'mount' in c && 'hydrate' in c,
            )
            if (allHydratableViews && list.length > 0) {
              // Walk via slot — preserves nested element identity.
              const childSlot = makeSlot(node)
              for (const child of list) {
                cleanups.push((child as View).hydrate?.(childSlot) ?? (() => {}))
              }
            } else {
              // Mixed / text / function children — clear + remount.
              while (node.firstChild) node.removeChild(node.firstChild)
              mountChildren(node, props.children, null, cleanups)
            }
          }
        })
      } catch (e) {
        disposeAll(cleanups)
        const handler = ErrorBoundaryCap.tryUse()
        if (handler === null) throw e
        handler(e)
        return () => {}
      }
      // Strip the SSR marker — page DOM should be clean post-hydration.
      node.removeAttribute('data-h')
      return () => disposeAll(cleanups)
    },
    mount(parent, anchor) {
      const node = document.createElement(tag)
      const cleanups: Disposer[] = []

      // If anything inside throws (a reactive prop's initial run, a
      // ref callback, a child's mount), we MUST run any cleanups that
      // accumulated before the throw — otherwise event listeners +
      // reactive watches we registered leak forever, attached to a
      // node that never made it into the DOM. We also bubble to the
      // nearest errorBoundary so consumers can render a fallback (the
      // same catch-and-route pattern the component HOC uses).
      try {
        withCleanups(cleanups, () => {
          for (const [key, value] of Object.entries(props)) {
            if (key === 'children' || key === 'ref') continue
            applyProp(node, key, value, cleanups)
          }
          if (props.ref) props.ref(node)
          if (props.children !== undefined) {
            mountChildren(node, props.children, null, cleanups)
          }
        })
      } catch (e) {
        disposeAll(cleanups)
        const handler = ErrorBoundaryCap.tryUse()
        if (handler === null) throw e
        handler(e)
        return () => {}
      }

      parent.insertBefore(node, anchor ?? null)

      return () => {
        disposeAll(cleanups)
        node.remove()
      }
    },
  }
}

function applyProp(node: HTMLElement, key: string, value: unknown, cleanups: Disposer[]): void {
  if (isEventProp(key)) {
    const event = key.slice(2).toLowerCase()
    if (typeof value === 'function') {
      const handler = value as EventListener
      // Capture the active error boundary AT MOUNT TIME so that throws
      // from the handler route to the same boundary that wrapped this
      // subtree — not to whichever cap happens to be installed when
      // the event fires (which may be a sibling subtree's cap, or none
      // if mount has fully unwound). When no boundary is installed,
      // skip the wrap entirely so the listener has zero overhead.
      //
      // **Auto-batch synchronous state writes inside the handler.** A
      // single click that writes 5 states would otherwise notify each
      // dependent watch 5 times even if all 5 watches read all 5 states
      // (worst case: 25 fires; expected: 1). Wrapping in `batch()`
      // coalesces the notifications — synchronous writes inside the
      // handler all flush together once the handler returns. Solid
      // does this in `createEffect`; React batches event handlers
      // since React 17. We were the only signal-based framework in
      // the survey making users remember `batch()` by hand.
      const boundary = ErrorBoundaryCap.tryUse()
      const wrapped: EventListener =
        boundary === null
          ? (event_) => {
              batch(() => handler(event_))
            }
          : (event_) => {
              try {
                batch(() => handler(event_))
              } catch (err) {
                boundary(err)
              }
            }
      node.addEventListener(event, wrapped)
      cleanups.push(() => node.removeEventListener(event, wrapped))
    }
    return
  }

  // Directive props: `class:foo`, `style:color`, `bind:value`, `use:action`.
  // Each form has its own dispatch. See ./directives.ts.
  if (key.includes(':')) {
    const colonIdx = key.indexOf(':')
    const prefix = key.slice(0, colonIdx)
    const rest = key.slice(colonIdx + 1)
    if (prefix === 'class') {
      applyClassDirective(node, rest, value, cleanups)
      return
    }
    if (prefix === 'style') {
      applyStyleDirective(node, rest, value, cleanups)
      return
    }
    if (prefix === 'bind') {
      applyBindDirective(node, rest, value, cleanups)
      return
    }
    if (prefix === 'use') {
      applyUseDirective(node, rest, value, cleanups)
      return
    }
    // Unknown prefix — fall through to standard attribute handling.
  }

  if (typeof value === 'function') {
    cleanups.push(
      watch(
        () => {
          const resolved = (value as () => unknown)()
          setAttr(node, key, resolved)
        },
        { name: `attr:${key}` },
      ),
    )
    return
  }

  setAttr(node, key, value)
}

// ===== Directives =====
//
// JSX-level shorthand for the four most-common element-level patterns.
// All four are dispatched from `applyProp` based on the `prefix:rest`
// key shape. Type-side: template-literal index signatures on element
// props accept these keys; see types.ts.

function applyClassDirective(
  node: HTMLElement,
  className: string,
  value: unknown,
  cleanups: Disposer[],
): void {
  // `class:foo={cond}` — add `foo` to classList when cond is truthy.
  // cond can be a reactive function/state, or a static value.
  if (typeof value === 'function') {
    cleanups.push(
      watch(
        () => {
          const truthy = !!(value as () => unknown)()
          if (truthy) node.classList.add(className)
          else node.classList.remove(className)
        },
        { name: `class:${className}` },
      ),
    )
    return
  }
  if (value) node.classList.add(className)
}

function applyStyleDirective(
  node: HTMLElement,
  propName: string,
  value: unknown,
  cleanups: Disposer[],
): void {
  // `style:color={value}` — set node.style.color to value (reactively).
  // CSS properties are camelCase on .style; the directive accepts the
  // CSS name (kebab-case or camel-case) and assigns via setProperty for
  // unknown names, otherwise direct assignment for known DOMString props.
  const apply = (resolved: unknown): void => {
    if (resolved === null || resolved === undefined || resolved === false) {
      node.style.removeProperty(propName.includes('-') ? propName : kebabize(propName))
      return
    }
    const str = String(resolved)
    if (propName.includes('-')) {
      node.style.setProperty(propName, str)
    } else {
      // Direct CSSStyleDeclaration assignment; falls through to
      // setProperty for unknown camelCase identifiers.
      ;(node.style as unknown as Record<string, string>)[propName] = str
    }
  }
  if (typeof value === 'function') {
    cleanups.push(
      watch(
        () => {
          apply((value as () => unknown)())
        },
        { name: `style:${propName}` },
      ),
    )
    return
  }
  apply(value)
}

function kebabize(camel: string): string {
  return camel.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

function applyBindDirective(
  node: HTMLElement,
  binding: string,
  value: unknown,
  cleanups: Disposer[],
): void {
  // `bind:value={state}` / `bind:checked={state}` / `bind:files={state}`
  // Two-way binding between an input-like element and a State<T>.
  // The state is callable + has .set; bind:value reads/writes .value,
  // bind:checked reads/writes .checked (for checkboxes/radios).
  if (typeof value !== 'function') return // bind: requires a State (callable)
  const s = value as State<unknown>
  const input = node as HTMLInputElement
  if (binding === 'value') {
    cleanups.push(
      watch(
        () => {
          const v = s()
          const next = v === null || v === undefined ? '' : String(v)
          if (input.value !== next) input.value = next
        },
        { name: 'bind:value' },
      ),
    )
    const handler = (): void => {
      const peeked = s.peek()
      if (typeof peeked === 'number') {
        const num = Number.parseFloat(input.value)
        if (!Number.isNaN(num)) s.set(num as never)
      } else {
        s.set(input.value as never)
      }
    }
    input.addEventListener('input', handler)
    cleanups.push(() => input.removeEventListener('input', handler))
    return
  }
  if (binding === 'checked') {
    cleanups.push(
      watch(
        () => {
          const v = !!s()
          if (input.checked !== v) input.checked = v
        },
        { name: 'bind:checked' },
      ),
    )
    const handler = (): void => {
      s.set(input.checked as never)
    }
    input.addEventListener('change', handler)
    cleanups.push(() => input.removeEventListener('change', handler))
    return
  }
  if (binding === 'files') {
    const handler = (): void => {
      s.set(input.files as never)
    }
    input.addEventListener('change', handler)
    cleanups.push(() => input.removeEventListener('change', handler))
  }
}

function applyUseDirective(
  node: HTMLElement,
  _actionName: string,
  value: unknown,
  cleanups: Disposer[],
): void {
  // `use:action={payload}` — invoke an action function on mount, with
  // the element + optional payload. The action may return a cleanup
  // function or void. The action itself is passed as the value (a
  // function); the directive name is informational (for readability).
  //
  // Conventionally users write `<input use:autofocus />` where
  // `autofocus` is a top-level function imported into the JSX scope.
  // The JSX runtime resolves the identifier; we receive its value here.
  if (typeof value === 'function') {
    // value is the action function itself (no payload). Call action(el).
    const ret = (value as (el: HTMLElement) => unknown)(node)
    if (typeof ret === 'function') cleanups.push(ret as Disposer)
    return
  }
  // Otherwise value is the payload; we expect the user to use the
  // `use:NAME={payload}` form with NAME bound at the JSX level to the
  // action function. Since we can't resolve identifiers at runtime
  // without a registry, we look for a globally-registered action by
  // name. Default: a no-op so unrecognized use: directives don't crash.
  const action = _useDirectiveRegistry[_actionName]
  if (action) {
    const ret = action(node, value)
    if (typeof ret === 'function') cleanups.push(ret as Disposer)
  }
}

const _useDirectiveRegistry: Record<
  string,
  (el: HTMLElement, payload: unknown) => Disposer | undefined
> = {}

/**
 * Register a named `use:` directive action so JSX can reference it by
 * string name in the form `<el use:name={payload} />`. Most consumers
 * won't need this — passing the action function directly via
 * `<el use:something={actionFn} />` is the common path.
 */
export function registerDirective(
  name: string,
  fn: (el: HTMLElement, payload: unknown) => Disposer | undefined,
): void {
  _useDirectiveRegistry[name] = fn
}

function isEventProp(key: string): boolean {
  // onClick, onInput, etc. — must start with 'on' followed by uppercase.
  return (
    key.length > 2 &&
    key.startsWith('on') &&
    key[2] !== undefined &&
    key[2] === key[2].toUpperCase()
  )
}

// Form-input properties that must be set via the DOM property, not the
// HTML attribute. Setting `<input value="x">` via setAttribute changes the
// `defaultValue` only — the displayed value (the `.value` property) does
// not update once the user has interacted with the input. Same for checked
// vs defaultChecked.
//
// We only set these via the property; the attribute is left to the
// browser's default.
const PROPERTY_KEYS = new Set(['value', 'checked', 'selected', 'disabled'])

function setAttr(node: HTMLElement, key: string, value: unknown): void {
  if (key === 'class' || key === 'className') {
    // **Use `setAttribute('class', …)`, not `node.className = …`.** SVG +
    // MathML elements expose `className` as a read-only `SVGAnimatedString`
    // / `DOMTokenList` — assigning to it throws *"Cannot set property
    // className of #<SVGElement> which has only a getter"*, which kills
    // the in-flight hydration of any subtree containing an SVG with a
    // class prop (the reactivity-demo's flow arrows were the first
    // user-visible casualty). `setAttribute` works identically on HTML
    // elements (sets the IDL `class` attribute; the `className`
    // reflection follows) AND on SVG/MathML. There's no hot-path cost.
    if (value == null) node.removeAttribute('class')
    else node.setAttribute('class', String(value))
    return
  }
  if (key === 'style') {
    // CSP-safe style application — strict `style-src` (no `unsafe-inline`)
    // blocks `setAttribute('style', …)` and `style.cssText = …`, but the
    // `CSSStyleDeclaration` API (`.setProperty`, `.removeProperty`,
    // individual property setters) is treated as a programmatic mutation
    // and is NOT blocked. Critical for any app that writes reactive style
    // strings: the framework's whole "reactive prop" promise must work
    // under the same `security: 'standard'` CSP we ship by default.
    if (value == null || value === false) {
      removeAllInlineStyle(node)
      return
    }
    if (typeof value === 'string') {
      applyStyleStringSafe(node, value)
      return
    }
    if (typeof value === 'object') {
      applyStyleObjectSafe(node, value as Record<string, unknown>)
      return
    }
    return
  }
  if (PROPERTY_KEYS.has(key)) {
    // Form-element property assignment (caret-safe — compare-then-set).
    // ONLY applies to real form controls — `value`/`checked`/etc. on a
    // custom element or SVG would silently assign to a property the
    // browser never reads (or worse, shadow a property the element
    // later defines), so we fall through to the standard
    // `setAttribute` path for everything else.
    if (
      node instanceof HTMLInputElement ||
      node instanceof HTMLSelectElement ||
      node instanceof HTMLTextAreaElement ||
      node instanceof HTMLButtonElement ||
      node instanceof HTMLOptionElement
    ) {
      const target = node as unknown as Record<string, unknown>
      const next = value == null ? '' : value
      if (target[key] !== next) target[key] = next
      return
    }
    // fall through to setAttribute
  }
  if (value == null || value === false) {
    // Namespaced removals (`xlink:href` etc.) go through removeAttributeNS so
    // the IDL match is exact; for non-namespaced names the no-NS form is fine.
    const ns = namespaceForAttr(key)
    if (ns !== null) node.removeAttributeNS(ns, key.slice(key.indexOf(':') + 1))
    else node.removeAttribute(key)
    return
  }
  const raw = value === true ? '' : String(value)
  // Namespaced SVG attrs (`xlink:href` on `<use>`, `xml:lang`) require
  // setAttributeNS; plain setAttribute stores them as opaque names that
  // the browser does not project onto the IDL property and therefore
  // ignores. Detect the known SVG/XML namespaces and route accordingly.
  const ns = namespaceForAttr(key)
  if (ns !== null) {
    node.setAttributeNS(ns, key, raw)
    return
  }
  node.setAttribute(key, raw)
}

/**
 * Map a colon-prefixed attribute name to its IDL namespace, or `null`
 * when no special namespace handling is needed. Covers `xlink:*`
 * (deprecated by SVG2 but still used in the wild — `<use xlink:href>`)
 * and `xml:*` (`xml:lang`, `xml:space`). Unknown prefixes fall back to
 * plain `setAttribute`, which is what authors expect for custom-element
 * data-like attrs that just happen to contain a colon.
 */
function namespaceForAttr(name: string): string | null {
  const colon = name.indexOf(':')
  if (colon <= 0) return null
  const prefix = name.slice(0, colon)
  if (prefix === 'xlink') return 'http://www.w3.org/1999/xlink'
  if (prefix === 'xml') return 'http://www.w3.org/XML/1998/namespace'
  if (prefix === 'xmlns') return 'http://www.w3.org/2000/xmlns/'
  return null
}

// ===== CSP-safe inline-style helpers =====
//
// Strict `style-src` (the default we ship via `security: 'standard'`) blocks
// `setAttribute('style', …)` and `style.cssText = …` — those count as
// "inline" style application, which CSP guards under `style-src-attr` and
// requires either `unsafe-inline`, a per-hash, or a per-nonce to allow.
//
// The `CSSStyleDeclaration` API (`.setProperty(name, value)`,
// `.removeProperty(name)`) is treated as programmatic style mutation, not
// inline style, and is NOT blocked. We route every framework-issued style
// write through it. CSS custom properties (`--flash-age`) pass through
// `.setProperty` cleanly; that's the codepath the reactivity demo hits.

function applyStyleStringSafe(node: HTMLElement, css: string): void {
  // Parse "name: value; name: value" → entries. Tolerates trailing `;`,
  // missing `;` on the last decl, and `:` appearing inside `value`
  // (e.g. `url(data:…)` — split-on-first-colon only).
  const nextProps = new Map<string, { value: string; priority: string }>()
  const decls = css.split(';')
  for (const raw of decls) {
    const decl = raw.trim()
    if (!decl) continue
    const colon = decl.indexOf(':')
    if (colon < 0) continue
    const name = decl.slice(0, colon).trim()
    if (!name) continue
    let value = decl.slice(colon + 1).trim()
    let priority = ''
    // `color: red !important` → strip `!important`, set priority.
    const bangIdx = value.lastIndexOf('!')
    if (bangIdx >= 0 && /^!\s*important$/i.test(value.slice(bangIdx))) {
      priority = 'important'
      value = value.slice(0, bangIdx).trim()
    }
    nextProps.set(name, { value, priority })
  }

  // Remove any previously-set inline property that's no longer present.
  // Iterate by index so we capture custom properties too (style[i] returns
  // the property name, including `--foo`).
  const toRemove: string[] = []
  for (let i = 0; i < node.style.length; i++) {
    const name = node.style.item(i)
    if (!nextProps.has(name)) toRemove.push(name)
  }
  for (const name of toRemove) node.style.removeProperty(name)

  // Apply / update.
  for (const [name, { value, priority }] of nextProps) {
    node.style.setProperty(name, value, priority)
  }
}

function applyStyleObjectSafe(node: HTMLElement, obj: Record<string, unknown>): void {
  // Track desired property names so we can remove dropped ones.
  const next = new Map<string, { value: string; priority: string }>()
  for (const key of Object.keys(obj)) {
    const raw = obj[key]
    if (raw == null || raw === false) continue
    // Custom properties (`--foo`) stay as-is; camelCase → kebab-case for
    // standard CSS property names.
    const cssName = key.startsWith('--') ? key : key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
    let value = String(raw)
    let priority = ''
    const bangIdx = value.lastIndexOf('!')
    if (bangIdx >= 0 && /^!\s*important$/i.test(value.slice(bangIdx))) {
      priority = 'important'
      value = value.slice(0, bangIdx).trim()
    }
    next.set(cssName, { value, priority })
  }

  const toRemove: string[] = []
  for (let i = 0; i < node.style.length; i++) {
    const name = node.style.item(i)
    if (!next.has(name)) toRemove.push(name)
  }
  for (const name of toRemove) node.style.removeProperty(name)

  for (const [name, { value, priority }] of next) {
    node.style.setProperty(name, value, priority)
  }
}

function removeAllInlineStyle(node: HTMLElement): void {
  // Iterate backwards because `removeProperty` shortens the live list.
  for (let i = node.style.length - 1; i >= 0; i--) {
    const name = node.style.item(i)
    if (name) node.style.removeProperty(name)
  }
}

// ===== Children =====
