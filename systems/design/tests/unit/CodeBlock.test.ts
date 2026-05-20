// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { renderToString } from '@place/component'
import {
  CodeBlock,
  registerLanguage,
  knownLanguages,
  type Tokenizer,
} from '../../src/CodeBlock.tsx'

describe('CodeBlock — base rendering', () => {
  test('renders a syntax-highlighted block with default variants', () => {
    const html = renderToString(CodeBlock({ code: 'const x = 1', lang: 'ts' }))
    expect(html).toContain('place-code')
    expect(html).toContain('place-code-lines')
    // Token spans for keyword + number.
    expect(html).toContain('tok-keyword')
    expect(html).toContain('tok-number')
    expect(html).toContain('const')
    expect(html).toContain('1')
  })

  test('header shows filename + lang label + copy button by default', () => {
    const html = renderToString(
      CodeBlock({ code: 'x', lang: 'tsx', filename: 'src/app.tsx' }),
    )
    expect(html).toContain('src/app.tsx')
    expect(html).toContain('tsx')
    expect(html).toContain('data-place-copy')
    // The inline copy runtime is emitted by `renderPage` (NOT by the
    // component itself), so it doesn't appear in the bare-component
    // SSR output. The component MARKS the flag; renderPage consumes
    // it and emits the runtime with the per-request CSP nonce.
    // (Coverage: a render-page integration test asserts the runtime
    // lands in the final HTML; see `page.test.ts`.)
    expect(html).not.toContain('__placeCopy')
  })

  test('chrome="none" hides the header entirely', () => {
    const html = renderToString(
      CodeBlock({ code: 'x', lang: 'ts', chrome: 'none', filename: 'ignored.ts' }),
    )
    expect(html).not.toContain('ignored.ts')
    // No header markup at all → no copy button either.
    expect(html).not.toContain('data-place-copy')
  })

  test('showCopy=false suppresses copy without hiding chrome', () => {
    const html = renderToString(
      CodeBlock({ code: 'x', lang: 'ts', filename: 'a.ts', showCopy: false }),
    )
    expect(html).toContain('a.ts')
    expect(html).not.toContain('data-place-copy')
    // Inline runtime NOT emitted when no copy buttons exist.
    expect(html).not.toContain('__placeCopy')
  })

  test('copy attribute carries URL-encoded source code', () => {
    const code = `'hello\nworld'`
    const html = renderToString(CodeBlock({ code }))
    // URL-encode the code; check it's reflected in the data attr.
    const encoded = encodeURIComponent(code)
    expect(html).toContain(`data-place-copy-text="${encoded}"`)
  })

  test('copyLabels customizes the idle/copied text', () => {
    const html = renderToString(
      CodeBlock({ code: 'x', copyLabels: { idle: '⎘', copied: '✓' } }),
    )
    expect(html).toContain('⎘')
    expect(html).toContain('✓')
  })
})

describe('CodeBlock — variants', () => {
  test('density variants change padding/text-size classes', () => {
    const compact = renderToString(CodeBlock({ code: 'x', density: 'compact' }))
    const spacious = renderToString(CodeBlock({ code: 'x', density: 'spacious' }))
    // Tier 15-D: density uses tokenized Tailwind sizes (text-xs/sm/base)
    // instead of arbitrary `text-[12/13/14]px` values.
    expect(compact).toContain('text-xs')
    expect(spacious).toContain('text-base')
  })

  test('radius=none removes rounding', () => {
    expect(renderToString(CodeBlock({ code: 'x', radius: 'none' }))).toContain('rounded-none')
    expect(renderToString(CodeBlock({ code: 'x', radius: 'lg' }))).toContain('rounded-2xl')
  })

  test('theme variants change background/border', () => {
    expect(renderToString(CodeBlock({ code: 'x', theme: 'bare' }))).toContain('bg-transparent')
    // Tier 17-E v2: was `bg-fg/[0.04]` arbitrary value; now
    // `bg-card/40` token-bound utility (NN#6 — no arbitrary values
    // in design components).
    expect(renderToString(CodeBlock({ code: 'x', theme: 'contrast' }))).toContain('bg-card/40')
  })

  test('wrap mode sets data-wrap attribute for CSS scoping', () => {
    expect(renderToString(CodeBlock({ code: 'x', wrap: 'wrap' }))).toContain('data-wrap="wrap"')
    expect(renderToString(CodeBlock({ code: 'x' }))).toContain('data-wrap="scroll"')
  })

  test('maxHeight prop becomes inline pre style', () => {
    const html = renderToString(CodeBlock({ code: 'x', maxHeight: 400 }))
    expect(html).toContain('max-height:400px')
    const html2 = renderToString(CodeBlock({ code: 'x', maxHeight: '60vh' }))
    expect(html2).toContain('max-height:60vh')
  })
})

describe('CodeBlock — line features', () => {
  test('lineNumbers=true renders a gutter with sequential numbers', () => {
    const html = renderToString(
      CodeBlock({ code: 'a\nb\nc', lang: 'ts', lineNumbers: true }),
    )
    expect(html).toContain('place-code-ln')
    expect(html).toContain('>1<')
    expect(html).toContain('>2<')
    expect(html).toContain('>3<')
  })

  test('lineNumbers={ start: 10 } starts at the given number', () => {
    const html = renderToString(
      CodeBlock({ code: 'a\nb', lineNumbers: { start: 10 } }),
    )
    expect(html).toContain('>10<')
    expect(html).toContain('>11<')
    expect(html).not.toContain('>1<')
  })

  test('highlightLines marks the right rows with data-hl', () => {
    const html = renderToString(
      CodeBlock({ code: 'a\nb\nc\nd\ne', highlightLines: [2, [4, 5]] }),
    )
    // Count data-hl="1" occurrences — should be 3 (lines 2, 4, 5) for
    // the content rows. No gutter (lineNumbers absent), so each
    // highlighted line = 1 marker.
    const matches = html.match(/data-hl="1"/g) ?? []
    expect(matches.length).toBe(3)
  })

  test('diff mode tags lines with data-diff', () => {
    const html = renderToString(
      CodeBlock({ code: '+ added\n- removed\n  context', diff: true }),
    )
    expect(html).toContain('data-diff="+"')
    expect(html).toContain('data-diff="-"')
  })

  test('headerSlot replaces the default header content', () => {
    // The slot is rendered via JSX in the consumer; for the test we
    // pass a pre-rendered View. The auto-rendered filename/lang/copy
    // are suppressed when headerSlot is provided.
    const slot = { toHtml: () => '<span class="custom-header">CUSTOM</span>' }
    const html = renderToString(
      // biome-ignore lint/suspicious/noExplicitAny: minimal View stub
      CodeBlock({ code: 'x', filename: 'should-be-hidden.ts', headerSlot: slot as any }),
    )
    expect(html).toContain('CUSTOM')
    expect(html).not.toContain('should-be-hidden.ts')
    expect(html).not.toContain('data-place-copy')
  })
})

describe('CodeBlock — tokenizer pluggability', () => {
  test('custom `tokenize` prop overrides the registry resolution', () => {
    const everythingIsKeyword: Tokenizer = (src) => [{ kind: 'keyword', text: src }]
    const html = renderToString(
      CodeBlock({ code: 'whatever 123', tokenize: everythingIsKeyword }),
    )
    expect(html).toContain('tok-keyword')
    // No number token despite the digits in the source.
    expect(html).not.toContain('tok-number')
  })

  test('registerLanguage adds a tokenizer to the global registry', () => {
    const before = knownLanguages()
    expect(before).not.toContain('madeup')
    registerLanguage('madeup', (src) => [{ kind: 'string', text: src }])
    expect(knownLanguages()).toContain('madeup')
    const html = renderToString(CodeBlock({ code: 'X', lang: 'madeup' }))
    expect(html).toContain('tok-string')
  })

  test('pre-tokenized output via `tokens` skips the tokenizer entirely', () => {
    const html = renderToString(
      CodeBlock({
        code: 'unused',
        tokens: [
          { kind: 'comment', text: '// hello' },
          { kind: 'plain', text: '\n' },
        ],
      }),
    )
    expect(html).toContain('tok-comment')
    expect(html).toContain('// hello')
  })

  test('unknown language falls back to plain text (no throw)', () => {
    const html = renderToString(CodeBlock({ code: 'whatever', lang: 'unknown-lang-zzz' }))
    expect(html).toContain('place-code')
    // No keyword/number/string highlighting — falls through to plain.
    expect(html).not.toContain('tok-keyword')
  })

  test('language identifier is case-insensitive', () => {
    const a = renderToString(CodeBlock({ code: 'const x = 1', lang: 'ts' }))
    const b = renderToString(CodeBlock({ code: 'const x = 1', lang: 'TS' }))
    const c = renderToString(CodeBlock({ code: 'const x = 1', lang: 'Tsx' }))
    expect(a).toContain('tok-keyword')
    expect(b).toContain('tok-keyword')
    expect(c).toContain('tok-keyword')
  })
})

describe('CodeBlock — composition escape hatches', () => {
  test('class prop appends to the outer wrapper', () => {
    const html = renderToString(CodeBlock({ code: 'x', class: 'my-custom-class' }))
    expect(html).toContain('my-custom-class')
  })

  test('classNames.{header,pre,line} overrides flow through (Tier 17-D)', () => {
    const html = renderToString(
      CodeBlock({
        code: 'a\nb',
        classNames: {
          header: 'CUSTOM-HEADER',
          pre: 'CUSTOM-PRE',
          line: 'CUSTOM-LINE',
        },
      }),
    )
    expect(html).toContain('CUSTOM-HEADER')
    expect(html).toContain('CUSTOM-PRE')
    expect(html).toContain('CUSTOM-LINE')
  })

  test('style as object renders CSS variables for token color overrides', () => {
    const html = renderToString(
      CodeBlock({ code: 'x', style: { '--cb-tok-keyword': '#ff79c6' } }),
    )
    expect(html).toContain('--cb-tok-keyword:#ff79c6')
  })

  test('aria-label propagates to the region', () => {
    const html = renderToString(
      CodeBlock({ code: 'x', 'aria-label': 'Snippet for example' }),
    )
    // <section> has implicit role="region" when given an aria-label —
    // the semantic-elements lint rule prefers the native element over
    // a div with an explicit role.
    expect(html).toContain('<section')
    expect(html).toContain('aria-label="Snippet for example"')
  })
})

describe('CodeBlock — runtime contract', () => {
  test('CodeBlock does not inline the copy runtime — renderPage emits it once with the CSP nonce', () => {
    // After T13+: components render only the click target (button +
    // data attrs). `renderPage` consumes the per-request flag and
    // emits the runtime with the response's CSP nonce so strict CSP
    // can execute it. Verified in `page.test.ts` integration cases.
    const html = renderToString(CodeBlock({ code: 'a' }))
    expect(html).not.toContain('__placeCopy')
    expect(html).toContain('data-place-copy')
  })

  test('copy button surface has data-state="idle" initially', () => {
    const html = renderToString(CodeBlock({ code: 'x' }))
    expect(html).toContain('data-state="idle"')
  })
})
