// `<CodeBlock>` — highly customizable syntax-highlighted code display.
//
// Design choices that make this "highly customizable":
//
//   1. **Recipe variants** for the common dimensions (density,
//      radius, theme) so apps pick from preset options without
//      writing CSS.
//   2. **CSS variables** for every token color, line-highlight, and
//      diff color — overridable per instance via `style:--cb-tok-*`.
//   3. **Pluggable tokenizer** — language registry + `tokenize` prop
//      per instance; the `lang` prop preserves literal types via
//      `const T` so consumers can declare custom languages and pass
//      their identifier without `as` casts.
//   4. **Slot composition** — `headerSlot` replaces the header
//      entirely; `actionsSlot` appends to the default action row;
//      per-element class overrides (`headerClass`, `preClass`,
//      `lineClass`) cover the rest.
//   5. **Line-level features** — line numbers, highlighted lines
//      (`{2, 5-7}` markdown-style or array form), diff mode (first
//      char of each line is +/-/space) — composed orthogonally so
//      a diff block can also show line numbers + highlights.
//   6. **Pure SSR** — zero island bundle. Copy button uses one
//      ~250-byte inline runtime emitted once per page.
//
// Authoring DX target: any of the above can be customized by setting
// ONE prop. The recipe defaults render a tasteful block in two lines
// of JSX: `<CodeBlock code={src} lang="ts" />`.

import type { Children, View } from '@place/component'
import { cls, markCopyUsedOnThisRequest, recipe } from '@place/component'
import { getTokenizer, type Tok, type Tokenizer } from './code/tokenize.ts'

// ===== Copy runtime emission =====
//
// Each CodeBlock with `showCopy` enabled emits the inline copy
// runtime alongside its DOM. The runtime is idempotent at the
// browser level: a `window.__placeCodeCopy === 1` guard at the top
// of the script makes subsequent emissions no-ops. So emitting N
// times per page is functionally fine; the only cost is bytes.
//
// At gzip-time, N identical inline scripts deduplicate via the LZ77
// window — 5 copies of a 250-byte runtime is ~300 bytes gzipped
// total (a single emission would be ~200 bytes gzipped). The 100-
// byte overhead is well below what shipping an island bundle would
// cost (~3 KB gzipped), so this stays the right trade-off even for
// pages with many CodeBlocks. Apps that have a strict CSP without
// `'unsafe-inline'` get a per-response nonce on every emission
// (the JSX `<script>` element threads through the same render
// pipeline as other inline scripts).

// ===== Recipe — variant taxonomy =====
//
// `density` controls vertical padding + line spacing. `radius` is
// the corner curvature. `chrome` controls header visibility. `theme`
// lets consumers pick light/dim/dark backgrounds independent of the
// site's overall theme (a doc page might want a dim block on a light
// background, e.g. for a "code in spotlight" treatment).

const codeBlockRecipe = recipe({
  base:
    'place-code relative my-4 mb-6 overflow-hidden font-mono ' + 'transition-shadow duration-150',
  variants: {
    density: {
      // Tokenized type scale (Tailwind defaults). `text-xs/sm/base`
      // ≈ 0.75/0.875/1rem replaces the previous `text-[12/13/14]px`
      // arbitrary values per NN#6 (Tier 15-D).
      compact: '[--cb-py:0.5rem] [--cb-px:0.875rem] text-xs leading-snug',
      comfortable: '[--cb-py:1rem] [--cb-px:1.25rem] text-sm leading-normal',
      spacious: '[--cb-py:1.5rem] [--cb-px:1.5rem] text-base leading-relaxed',
    },
    radius: {
      none: 'rounded-none',
      sm: 'rounded-md',
      md: 'rounded-lg',
      lg: 'rounded-2xl',
    },
    theme: {
      surface: 'border border-border bg-card/95',
      dim: 'border border-border/60 bg-bg/60',
      bare: 'border-0 bg-transparent',
      // **`bg-card/40`** (Tier 17-E v2) — was `bg-fg/[0.04]` arbitrary
      // value. The token-bound utility reads from the theme's
      // `--color-card`; reads cleaner in both light + dark themes
      // (foreground-at-4% drifted too transparent on dark themes
      // where `card` is already close to `bg`).
      contrast: 'border-0 bg-card/40',
    },
  },
  defaults: { density: 'comfortable', radius: 'md', theme: 'surface' },
})

const headerRecipe = recipe({
  base:
    'flex items-center gap-2 px-3.5 py-2 ' +
    'border-b border-border/60 bg-bg/60 ' +
    // Token-bound font sizing (was `text-[11px]` pre-Tier-15-D).
    'font-mono text-xs leading-none text-muted',
  variants: {
    chrome: {
      full: '',
      // `minimal` was `text-[10px]`; tokenized to `text-xs`.
      minimal: 'py-1 px-2.5 text-xs',
      // 'none' is handled at the parent level (header not rendered)
      none: 'hidden',
    },
  },
  defaults: { chrome: 'full' },
})

// ===== Public types =====

/**
 * Part anatomy for `<CodeBlock>` (Tier 17-D / ADR 0050).
 *   - `header` — the header row (filename + lang + copy button).
 *   - `pre`    — the `<pre>` body wrapper.
 *   - `line`   — each individual line `<span>`.
 * Root uses the standalone `class` prop.
 */
export type CodeBlockPart = 'header' | 'pre' | 'line'

export type CodeBlockDensity = 'compact' | 'comfortable' | 'spacious'
export type CodeBlockRadius = 'none' | 'sm' | 'md' | 'lg'
export type CodeBlockTheme = 'surface' | 'dim' | 'bare' | 'contrast'
export type CodeBlockChrome = 'full' | 'minimal' | 'none'
export type CodeBlockWrap = 'scroll' | 'wrap'

/** A line range — single line `5`, or inclusive range `[3, 7]`. */
export type LineRange = number | readonly [number, number]

export interface CodeBlockProps {
  // ----- Required content -----
  /** Source code. Required. Preserved character-for-character (any
   *  preceding/trailing whitespace is your problem — call `trim()` if
   *  you don't want it). */
  readonly code: string

  // ----- Language & tokenization -----
  /** Language identifier. Looked up in the registry; defaults to `'ts'`.
   *  `const T` preserves your literal type for downstream prop unions. */
  readonly lang?: string
  /** Override the resolved tokenizer for this instance. Use when the
   *  registry's default for `lang` isn't what you want, OR for one-off
   *  custom languages where `registerLanguage` is overkill. */
  readonly tokenize?: Tokenizer
  /** Pre-tokenized output. Skip tokenization entirely — useful for
   *  caching or for tokenizers that run outside the render path
   *  (e.g. a Markdown pipeline that already tokenized). */
  readonly tokens?: readonly Tok[]

  // ----- Header / chrome -----
  /** Display in the left of the header. */
  readonly filename?: string
  /** Chrome level. `'full'` shows filename + lang + copy. `'minimal'`
   *  trims padding. `'none'` hides the header entirely. */
  readonly chrome?: CodeBlockChrome
  /** Copy-to-clipboard button. Default: shown when chrome is not
   *  `'none'`. Set `false` to suppress without changing chrome. */
  readonly showCopy?: boolean
  /** Custom labels for the copy button. */
  readonly copyLabels?: { readonly idle?: string; readonly copied?: string }
  /** Replace the entire header. When set, `filename`, `lang` label,
   *  copy button, and `actionsSlot` are NOT auto-rendered — your slot
   *  takes full ownership. */
  readonly headerSlot?: View
  /** Append to the default action row (after the copy button). */
  readonly actionsSlot?: View

  // ----- Line features -----
  /** Show line numbers. `true` starts at 1; `{ start: N }` starts at N. */
  readonly lineNumbers?: boolean | { readonly start?: number }
  /** Lines to highlight (1-indexed). Single number, range, or array of
   *  both: `[3, [5, 7], 12]` highlights lines 3, 5–7, 12. */
  readonly highlightLines?: LineRange | readonly LineRange[]
  /** Diff mode: first character of each line is treated as `+`/`-`/` `,
   *  the marker is stripped, and the line gets a diff background. */
  readonly diff?: boolean

  // ----- Visual variants -----
  readonly density?: CodeBlockDensity
  readonly radius?: CodeBlockRadius
  readonly theme?: CodeBlockTheme
  /** Horizontal overflow: `'scroll'` (default) or `'wrap'`. */
  readonly wrap?: CodeBlockWrap
  /** Max height for the scroll/wrap area — number → `px`, string → as-is. */
  readonly maxHeight?: number | string

  // ----- Composition escape hatches -----
  /** Additive classes on the outer wrapper. */
  readonly class?: string
  /**
   * Typed per-subpart class overrides (Tier 17-D / ADR 0050).
   * Replaces the previous `headerClass` / `preClass` / `lineClass`
   * props. Each key is a known sub-part of the CodeBlock chrome.
   * Root uses the standalone `class` prop.
   */
  readonly classNames?: Partial<Record<CodeBlockPart, string>>
  /** Inline style — pass `--cb-tok-*` overrides here. */
  readonly style?: string | Record<string, string | number>
  /** Optional `aria-label` for the region (e.g. "Code example"). */
  readonly 'aria-label'?: string
}

// ===== Line-range expansion =====

function expandHighlights(hl: CodeBlockProps['highlightLines'] | undefined): ReadonlySet<number> {
  const set = new Set<number>()
  if (hl === undefined) return set
  const ranges: readonly LineRange[] = Array.isArray(hl)
    ? (hl as readonly LineRange[])
    : [hl as LineRange]
  for (const r of ranges) {
    if (typeof r === 'number') set.add(r)
    else {
      const [a, b] = r
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      for (let i = lo; i <= hi; i++) set.add(i)
    }
  }
  return set
}

// ===== Token rendering =====
//
// Two passes: (1) group consecutive `plain` tokens into a buffer so we
// emit fewer DOM nodes; (2) split everything by `\n` so each line is
// renderable as its own row (the grid layout in styles.ts puts the
// line gutter next to each row).

interface RenderedLine {
  /** 1-indexed source line number, or null for empty trailing line. */
  readonly num: number
  /** Diff prefix character if diff mode: `+`, `-`, or null. */
  readonly diff: '+' | '-' | null
  /** Highlighted via `highlightLines`. */
  readonly highlighted: boolean
  /** Inline content (text + token spans). */
  readonly content: Children
}

function tokenize(props: CodeBlockProps): readonly Tok[] {
  if (props.tokens) return props.tokens
  if (props.tokenize) return props.tokenize(props.code)
  return getTokenizer(props.lang ?? 'ts')(props.code)
}

function tokensToLines(
  toks: readonly Tok[],
  diff: boolean,
  highlights: ReadonlySet<number>,
): readonly RenderedLine[] {
  const lines: RenderedLine[] = []
  let currentContent: (string | { kind: string; text: string })[] = []
  let buffer = ''
  let lineNum = 1
  let diffPrefix: '+' | '-' | null = null
  let atLineStart = true

  const flushBuffer = (): void => {
    if (buffer) {
      currentContent.push(buffer)
      buffer = ''
    }
  }
  const finishLine = (): void => {
    flushBuffer()
    const content = currentContent.map((piece) =>
      typeof piece === 'string' ? piece : <span class={`tok-${piece.kind}`}>{piece.text}</span>,
    )
    lines.push({
      num: lineNum,
      diff: diffPrefix,
      highlighted: highlights.has(lineNum),
      content,
    })
    currentContent = []
    diffPrefix = null
    atLineStart = true
    lineNum++
  }

  for (const t of toks) {
    // Split the token's text by newlines.
    let start = 0
    while (start <= t.text.length) {
      const nl = t.text.indexOf('\n', start)
      const chunk = nl === -1 ? t.text.slice(start) : t.text.slice(start, nl)
      // Apply diff prefix detection on line-start.
      let body = chunk
      if (diff && atLineStart && body.length > 0) {
        const first = body.charAt(0)
        if (first === '+' || first === '-') {
          diffPrefix = first
          body = body.slice(1)
        } else if (first === ' ') {
          // Plain context line — consume the leading space.
          body = body.slice(1)
        }
        atLineStart = false
      } else if (body.length > 0) {
        atLineStart = false
      }
      // Append.
      if (t.kind === 'plain') {
        buffer += body
      } else {
        flushBuffer()
        if (body) currentContent.push({ kind: t.kind, text: body })
      }
      if (nl === -1) break
      finishLine()
      start = nl + 1
    }
  }
  // Don't finish a trailing empty line — but if the last token didn't
  // end on a newline, flush its contents into the final line.
  if (buffer || currentContent.length > 0) {
    finishLine()
  }
  return lines
}

// ===== Public component =====

export const CodeBlock = (props: CodeBlockProps): View => {
  const chrome: CodeBlockChrome = props.chrome ?? 'full'
  // `showCopy` default: true when the default header is in use,
  // false when the consumer is taking ownership of the header (via
  // `headerSlot`) — they get to decide whether to opt in to the
  // inline copy runtime by passing `showCopy: true` explicitly. The
  // runtime is emitted iff `showCopy` is true.
  const showCopy = props.showCopy ?? (chrome !== 'none' && props.headerSlot === undefined)
  const wrap: CodeBlockWrap = props.wrap ?? 'scroll'
  const langLabel = props.lang ?? 'ts'
  // Signal renderPage that this page needs the copy runtime — the
  // framework emits the inline `<script>` ONCE per response with the
  // per-request CSP nonce. Without this mark, strict-CSP pages would
  // silently block the previously-inline `<script>` and the copy
  // button would never get its click handler.
  if (showCopy) markCopyUsedOnThisRequest()

  // Variant resolution.
  const baseClasses = codeBlockRecipe({
    ...(props.density !== undefined ? { density: props.density } : {}),
    ...(props.radius !== undefined ? { radius: props.radius } : {}),
    ...(props.theme !== undefined ? { theme: props.theme } : {}),
  })
  const finalClass = props.class ? cls(baseClasses, props.class) : baseClasses
  // Per-subpart classNames (Tier 17-D / ADR 0050). Replaces the
  // previous `headerClass` / `preClass` / `lineClass` props.
  const headerClass = props.classNames?.header ?? headerRecipe({ chrome })
  const preClass =
    props.classNames?.pre ??
    'place-code-pre m-0 py-[var(--cb-py,1rem)] px-[var(--cb-px,1.25rem)] overflow-x-auto bg-transparent border-0'

  // Tokenize + lay out lines.
  const toks = tokenize(props)
  const highlights = expandHighlights(props.highlightLines)
  const lines = tokensToLines(toks, props.diff === true, highlights)

  // Line-numbers configuration.
  const numbersOn = props.lineNumbers !== undefined && props.lineNumbers !== false
  const numbersStart = typeof props.lineNumbers === 'object' ? (props.lineNumbers.start ?? 1) : 1

  // Inline style merge (object → CSS string).
  const inlineStyle = ((): string | undefined => {
    if (props.style === undefined) return undefined
    if (typeof props.style === 'string') return props.style
    return Object.entries(props.style)
      .map(([k, v]) => `${k}:${typeof v === 'number' ? `${v}px` : v}`)
      .join(';')
  })()

  // Pre-element style (maxHeight).
  const preStyle = ((): string | undefined => {
    if (props.maxHeight === undefined) return undefined
    const v = typeof props.maxHeight === 'number' ? `${props.maxHeight}px` : props.maxHeight
    return `max-height:${v};overflow-y:auto`
  })()

  // Encode the code for the copy button's data attribute.
  const encodedCode = encodeURIComponent(props.code)

  // Default header (when no `headerSlot`).
  const idleLabel = props.copyLabels?.idle ?? 'copy'
  const copiedLabel = props.copyLabels?.copied ?? 'copied'

  const renderHeader = (): View | null => {
    if (chrome === 'none') return null
    if (props.headerSlot !== undefined) {
      return <div class={headerClass}>{props.headerSlot}</div>
    }
    return (
      <div class={headerClass}>
        {props.filename ? <span class="mr-auto text-fg">{props.filename}</span> : null}
        <span class={`${props.filename ? '' : 'ml-auto'} lowercase tracking-[0.05em]`}>
          {langLabel}
        </span>
        {showCopy ? (
          <button
            type="button"
            class="bg-transparent border border-transparent rounded px-2 py-0.5 text-muted font-inherit cursor-pointer transition-colors duration-150 hover:text-fg hover:border-border/80 hover:bg-card/60"
            data-place-copy=""
            data-place-copy-text={encodedCode}
            data-state="idle"
            aria-label="Copy code"
          >
            <span data-copy-idle="">{idleLabel}</span>
            <span data-copy-done="">{copiedLabel}</span>
          </button>
        ) : null}
        {props.actionsSlot ?? null}
      </div>
    )
  }

  return (
    <section
      class={finalClass}
      data-wrap={wrap}
      aria-label={props['aria-label']}
      style={inlineStyle}
    >
      {renderHeader()}
      <pre class={preClass} style={preStyle}>
        <code>
          <div class="place-code-lines" data-numbered={numbersOn ? '1' : undefined}>
            {lines.flatMap((ln, idx) => {
              const num = numbersOn ? numbersStart + idx : null
              const dataHl = ln.highlighted ? '1' : undefined
              const dataDiff = ln.diff ?? undefined
              const lineEl = (
                <span
                  class={cls('place-code-line', props.classNames?.line ?? '')}
                  data-hl={dataHl}
                  data-diff={dataDiff}
                >
                  {ln.content}
                  {'\n'}
                </span>
              )
              const gutterEl = numbersOn ? (
                <span
                  class="place-code-ln"
                  data-hl={dataHl}
                  data-diff={dataDiff}
                  aria-hidden="true"
                >
                  {num}
                </span>
              ) : null
              return numbersOn ? [gutterEl, lineEl] : [lineEl]
            })}
          </div>
        </code>
      </pre>
    </section>
  )
}

// ===== Re-exports — tokenizer primitives for advanced consumers =====

export {
  getTokenizer,
  knownLanguages,
  registerLanguage,
  type Tok,
  type Tokenizer,
  type TokKind,
  tokenizeCss,
  tokenizeHtml,
  tokenizeJson,
  tokenizePlain,
  tokenizePython,
  tokenizeShell,
  tokenizeTs,
} from './code/tokenize.ts'
