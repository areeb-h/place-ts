# ADR 0037: Tokenizer V2.1 — JSON / CSS / HTML / Python + TS generics fix

**Status:** accepted (2026-05-16)
**Date:** 2026-05-16
**Affects:** `systems/design/src/code/tokenize.ts` (new tokenizers + generics heuristic); `systems/design/src/CodeBlock.tsx` + `systems/design/src/index.ts` (exports); `systems/design/tests/unit/tokenize.test.ts` (24 new tests).

## Context

The V2 tokenizer (ADR 0033 + T13-D) covered TS/JSX + Shell + a plaintext fallback. The docs site uses `lang="html"` (the SSR page), `lang="bash"` (multiple), and would benefit from `json` and `css` in API + theming docs. Without dedicated tokenizers these fall back to plaintext — no colour, harder to skim.

Two additional gaps surfaced in real use:

1. **TS generics**: `<T extends X>`, `Promise<string>`, `function map<T, U>(...)` were treated as JSX opens. The `<` triggered tag-detection, `T`/`U` got `tag-component` kind, and the inner stream was stuck in JSX-attribute mode.
2. **JSX close-tag regression** (introduced and fixed in this round): the generics detection scanned forward looking for `>`, found `>` closing `</div>`, claimed it as a generic, leaving `/div>` to be mis-tokenized as a regex. Fixed by bailing on `</` early.

## Decision

### New language tokenizers

- **`json`** — strings, numbers (incl. negative + exponent), keywords (`true`/`false`/`null`), object keys get `attr` kind for distinct colour from string values
- **`css`** — selectors / `@`-rules (`keyword`) / property names (`attr` inside `{...}`) / strings / numbers-with-units / CSS variables (`--name` → `attr`) / `var()` / `calc()` / `oklch()` (`tag-component`). Comments via `/* */`.
- **`html`** (also `htm` / `xml` / `svg`) — tags / attribute names (`attr`) / attribute values (`string`) / `<!-- comments -->` / DOCTYPE (`keyword`). Component-style uppercase tags get `tag-component`.
- **`python`** (also `py`) — keywords (`def`/`class`/`return`/`import`/`async`/`match`/etc.), types (`int`/`str`/`List`/`Optional`/etc.), triple-quoted strings, single-line strings, decorators (`@dataclass` → `tag-component`), comments (`#`).

### TS generics heuristic

Two-stage detection:

1. **Prerequisite**: `<` is preceded by an identifier-class token (`plain`/`type`/`attr`/`tag-component`) with **no whitespace** between them — `foo<T>` qualifies, `return <div>` does not.
2. **Inner-scan signal**: scan forward from `<` up to the matching `>` (or abort on `\n`/`;`/`{`). If we see `,`, `=`, `|`, `&`, or one of `extends`/`keyof`/`infer` before that close, treat as generic. Otherwise fall through to JSX.

JSX-close `</tag>` bypasses the whole generic detection (the `</` lookahead is a hard tell).

This correctly handles: `function map<T, U>(...)`, `Promise<string>`, `Foo<Bar, Baz extends string>`, `a < b && c > d` (no generic), `<div>` (JSX, no generic), `</div>` (JSX close, no generic).

## Verification

- 48 tokenizer tests (25 pre-existing + 5 generics + 5 JSON + 5 CSS + 4 HTML + 5 Python + 1 JSX-close regression)
- 1234 total tests pass
- 14 typecheck projects clean
- Live curl on `/concepts/ssr` (which uses `lang="html"`) shows 23 `tok-tag` + 15 `tok-attr` + 10 `tok-string` — proper HTML colouring where there was zero before this round
- Probe (`/tmp/tok-probe.ts`) confirms generic detection on `Promise<string>` (`Promise:type`, `string:type`), JSX close (`</:punct`, `div:tag`), comparison (`a < b`: both `plain`)

## What's NOT in this round (deferred to later if/when needed)

- **Rust / Go / SQL tokenizers** — none used in the docs yet; `registerLanguage()` is the consumer-side extension point
- **Markdown tokenizer** — would be nice for inline code, but the docs site doesn't yet render markdown as code
- **JSX text content highlighting** — text between `>` and `<` currently passes as plain; treating it as a separate kind isn't visually distinct enough to justify the complexity
- **Multi-line template-literal expressions inside Python f-strings** — Python's f-string interpolation (`f"x={x}"`) currently treats the whole f-string as one `string` token; recursing into `{...}` is a future cut

## Why this passes "magic with clarity"

- **Discoverable**: each new lang is a top-level export (`tokenizeJson`, `tokenizeCss`, etc.) + the registry key list is right there in `tokenize.ts`
- **Traceable**: every token still concatenates back to source (roundtrip invariant tested for each language)
- **Faithful to performance**: each tokenizer is one linear pass over the source; no regex backtracking; SSR-only (no client cost)
