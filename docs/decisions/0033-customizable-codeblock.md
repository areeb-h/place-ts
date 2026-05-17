# ADR 0033: `<CodeBlock>` as a highly customizable design-library primitive

**Status:** accepted (2026-05-16)
**Date:** 2026-05-16
**Affects:** `systems/design/src/CodeBlock.tsx` (new); supporting
modules `systems/design/src/code/{tokenize,copy-runtime}.ts`;
`systems/design/src/styles.ts` (token-color CSS variables, line/diff
selectors); `systems/design/tests/unit/CodeBlock.test.ts` (27 new
tests); `examples/docs/src/pages/**` (22 pages migrated from the
local `islands/code-block.tsx` to `@place/design`);
`examples/docs/src/components/typing-code.tsx` (tokenizer reused from
`@place/design`); `examples/docs/src/pages/api/design.page.tsx`
(docs entry added).

## Context

The docs site shipped a hand-rolled `CodeBlock` in
`examples/docs/src/components/code-block.tsx` paired with an
`islands/code-block.tsx` wrapper that promoted the entire component
into an island bundle. The bundle was needed only for one feature:
the copy-to-clipboard button's "copied!" toggle.

Issues with that setup:

- **Bundle cost.** Every docs page that used a code block shipped
  ~3 KB gzipped of island bundle, when the actual interactive
  surface was 200 bytes of vanilla JS.
- **Not a real library component.** It lived in the docs app. Other
  consumers couldn't import it; the framework had no pattern for
  "highly customizable" components.
- **Inflexibility.** No line numbers, no line highlighting, no diff
  mode, no theme-token override, no pluggable tokenizer. To add
  any of these you patched the docs-local file.

The "highly customizable" target was set by the user: components in
`@place/design` should be tuneable along every axis a real docs site
or app needs, without copy-paste forking. Build the primitive once;
let every axis be a prop.

## Decision

Ship `<CodeBlock>` as a `@place/design` component with five layers
of customization, each orthogonal to the others, and zero island
bundle.

### 1. Recipe-driven variants (the common dimensions)

```tsx
<CodeBlock code={src} density="compact" radius="lg" theme="dim" />
```

- `density: 'compact' | 'comfortable' | 'spacious'`
- `radius: 'none' | 'sm' | 'md' | 'lg'`
- `theme: 'surface' | 'dim' | 'bare' | 'contrast'`
- `chrome: 'full' | 'minimal' | 'none'` (header style)
- `wrap: 'scroll' | 'wrap'` + optional `maxHeight: number | string`

Built on the framework's existing `recipe()` primitive. Each variant
maps to a Tailwind class string; the framework's Tailwind-aware
`cls()` merger handles compositions.

### 2. CSS variables for token colors (long-tail customization)

```tsx
<CodeBlock
  code={src}
  style={{
    '--cb-tok-keyword': '#ff79c6',
    '--cb-tok-string': '#a0e7a0',
    '--cb-hl-bg': 'rgba(255, 121, 198, 0.12)',
  }}
/>
```

Every token color (`comment`, `string`, `keyword`, `type`, `number`,
`tag`, `tag-component`, `attr`, `punct`, `plain`) is a CSS variable
declared on `.place-code`. Defaults reference the consumer's
`themeTokens()` (`color-fg`, `color-accent`) so untouched blocks
match the surrounding theme. Per-instance override sets the
variables inline. Site-wide override sets them on `:root` (or any
ancestor selector).

This beats `tailwind-merge`-style class merging (you'd merge a
~15 KB runtime patch into every shipped app) and beats CSS-in-JS
(no runtime, no SSR hydration mismatch). One CSS variable per
semantic role; consumers override what they want, defaults flow.

### 3. Pluggable tokenizer

```tsx
// Per-instance — one-off languages.
<CodeBlock code={json} tokenize={tokenizeJson} />

// Global — every future <CodeBlock lang="rust"> picks it up.
import { registerLanguage } from '@place/design'
registerLanguage('rust', tokenizeRust)

// Pre-tokenized — skip the tokenizer entirely (caching pipelines).
<CodeBlock code={ignored} tokens={precomputedToks} />
```

A `Map<string, Tokenizer>` registry, case-insensitive. Built-in
entries cover `ts/tsx/js/jsx` (the hand-rolled tokenizer, ~120
lines), `shell/sh/bash/zsh` (line-leading `$` and `>` highlight),
and plaintext. Unknown languages fall back to plaintext silently —
never throws.

The `getTokenizer<const T extends string>(name: T)` signature uses
TypeScript 6.0.3's `const` type parameter to preserve literal types
at call sites — `getTokenizer('rust')` keeps `'rust'` rather than
widening to `string`. Downstream variant pickers (e.g. typed
language unions) keep their type integrity.

### 4. Slot composition

```tsx
// Replace the entire header.
<CodeBlock
  code={src}
  headerSlot={<MyCustomHeader />}
  showCopy={false}  // headerSlot opts out of default; explicit here
/>

// Or append to the default action row.
<CodeBlock code={src} actionsSlot={<OpenInPlaygroundButton />} />

// Per-element class overrides.
<CodeBlock
  code={src}
  headerClass="my-custom-header"
  preClass="my-custom-pre"
  lineClass="my-custom-line"
/>
```

`headerSlot` (full replacement) and `actionsSlot` (append to
default actions) cover the common composition shapes. Per-element
class overrides handle the "I want the same structure but my own
classes" case. The outer wrapper `class` prop appends via
Tailwind-aware merging.

### 5. Line-level features (composable, all orthogonal)

```tsx
<CodeBlock
  code={src}
  lineNumbers              // boolean or { start: 10 }
  highlightLines={[3, [5, 7], 12]}   // single, range, or array
  diff                     // first char of each line = +/-/space
/>
```

Each feature renders independently. A diff block can also show line
numbers + highlights. The grid layout in CSS lets diff backgrounds
and highlight bars extend across both the gutter and content
columns.

### Zero island bundle — inline copy runtime

The copy button is rendered as a plain `<button>` carrying the
URL-encoded source code on `data-place-code-copy-text`. A 250-byte
inline `<script>` (in `code/copy-runtime.ts`) attaches a single
document-level click listener that:

1. Finds the nearest `[data-place-code-copy]` button.
2. Decodes the text from the data attribute.
3. Calls `navigator.clipboard.writeText`.
4. Mutates `data-state="copied"` for 1.4 s, then back to `idle`.

The browser-level `window.__placeCodeCopy === 1` guard ensures
idempotency across multiple emissions per page (which gzip
deduplicates anyway). A page with N CodeBlocks ships N copies of
the runtime ≈ 200 bytes gzipped total — still well below a single
island bundle's floor.

## Why this beats prior art

- **Shadcn copy-paste:** every consumer owns a fork that drifts
  from upstream. Our component is imported; consumers customize via
  props/variants/CSS vars, not by forking source.
- **Shiki:** ~600 KB gzipped for the full grammar set, ~30 KB per
  language, plus a WASM loader. Our default tokenizer is 120 lines,
  zero deps, and pluggable for the long tail.
- **Prism / Highlight.js:** runtime-only, doesn't render at SSR
  without extra work. We SSR every block; the client sees real
  HTML on first paint.
- **CSS-in-JS theming (MUI, Chakra):** runtime theme provider,
  hydration mismatches, ~15 KB+ ship cost. We use CSS variables on
  the wrapper — zero runtime cost, zero hydration concern.

## Migration

22 docs pages migrated mechanically (one-line `sed`):
`from '../../islands/code-block.tsx'` → `from '@place/design'`.

`typing-code.tsx` now imports `getTokenizer` from `@place/design`
to reuse the framework tokenizer rather than its previous local
fork.

The deprecated `examples/docs/src/components/code-block.tsx` and
`examples/docs/src/islands/code-block.tsx` are unreferenced
post-migration; their removal is a follow-on cleanup.

## TypeScript 6.0.3 features leveraged

- `const T extends string` on `getTokenizer` and `registerLanguage`:
  preserves literal types so a custom language name stays as its
  literal in downstream variant unions, not widened to `string`.
- `Tokenizer` is a typed function signature, not a structural
  `Function`: type-check at the call site rejects shapeless
  tokenizers.
- The recipe's variant choices are pinned via the existing `recipe()`
  primitive's typed `Choices<V>` mapped type — TypeScript catches
  `density: 'big'` (not in the union) at compile time.

Nothing in the 5.7→6.0 deltas blocked this; the heavy lifting still
comes from `const` type params (5.0), `satisfies` (5.0), and typed
mapped types (3.1+). The 6.0 wins were "less context-sensitivity on
this-less function inference" (cleaner generic callback typing on
the `tokenize` prop) and "type instantiation caching" (5.9, makes
deep variant unions compile without depth limits).

## Verification

- 27 new unit tests in `systems/design/tests/unit/CodeBlock.test.ts`
  cover every public axis: base render, all variants, header
  variants, line features, diff mode, slots, tokenizer pluggability,
  CSS-variable customization, ARIA + a11y, copy-runtime emission.
- 1163 total tests pass (1136 + 27).
- 14 typecheck projects clean.
- Live docs site verification: `/api/design`, `/why`,
  `/concepts/reactivity` all render the new markup with token
  spans, line numbers, line highlights, and copy buttons. Landing
  page's `<TypingCode>` reuses the design library's tokenizer
  without regression.

## Consequences

Positive:
- One importable, highly customizable code-block component for any
  consumer (`@place/design` apps + the docs site + future demos).
- Zero island bundle for code blocks. ~3 KB gzipped saved per docs
  page that uses one (most pages).
- The same tokenizer powers the typing-code hero animation.
- A reference pattern for "highly customizable component" inside
  `@place/design`: variants + CSS vars + slots + pluggable
  internals + per-element class overrides.

Trade-offs:
- The hand-rolled tokenizer trades highlight depth for ship cost.
  For a docs site that's right. Consumers wanting Shiki-grade
  output for non-default languages register their own tokenizer
  via `registerLanguage`.
- Copy runtime is emitted per block in the rendered HTML, not
  once. Gzip handles the dedup at the wire; consumers who want
  one emission per page can wire it as a custom inline script in
  the layout and pass `showCopy={false}` on every CodeBlock.

Non-goals:
- Full LSP-grade highlighting. Out of scope; Shiki is the answer
  there, registered via `registerLanguage`.
- Editable code blocks. Different primitive (`<CodeMirror>`-shaped).
  Out of scope for this round.
- Multi-pane diff (side-by-side). The inline `diff` mode covers the
  common case; side-by-side would be a separate `<DiffBlock>`.

## Related ADRs

- **0026** — Magic with clarity. CodeBlock passes the three
  criteria: discoverable in source (every prop documented + typed),
  traceable in tooling (no hidden DOM rewrites, no runtime patches),
  faithful to performance (zero island bundle, CSS vars over
  runtime theming).
- **0016** — Design library as a package. CodeBlock is the
  largest-surface component shipped here so far, exercising the
  "five layers of customization" pattern future primitives can
  follow.
- **0023** — Islands as the only hydration model. The copy runtime
  is the explicit *not-an-island* exception: a single inline
  runtime serving every block on the page beats per-instance
  island bundles for this shape of feature.
