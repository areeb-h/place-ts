# ADR 0036: Generic UI primitives — `<Copy>`, `--tok-*`, `.place-lines-*`

**Status:** accepted (2026-05-16)
**Date:** 2026-05-16
**Affects:** `systems/design/src/Copy.tsx` (new); `systems/design/src/__copy-runtime.ts` (new — generic runtime); `systems/design/src/code/copy-runtime.ts` (re-export bridge for back-compat); `systems/design/src/styles.ts` (rename `--cb-tok-*` → `--tok-*`, alias `.place-code-*` ↔ `.place-lines-*`, add tokenizer V2 `tok-regex` selector); `systems/design/src/index.ts` (export `Copy`); `systems/design/tests/unit/Copy.test.ts` (6 new tests); `systems/design/tests/unit/CodeBlock.test.ts` (3 string-assertion updates).

## Context

The `<CodeBlock>` shipped in ADR 0033 baked three reusable patterns into a single component:

1. **Inline copy-to-clipboard runtime** — generic for any "click to copy text" surface
2. **Token-color CSS variables** (`--cb-tok-comment`, `--cb-tok-keyword`, etc.) — generic for any syntax-coloured display
3. **Line-grid CSS** (`.place-code-lines`, `.place-code-ln`, `.place-code-line` + `[data-hl]`/`[data-diff]`) — generic for any "lines with optional gutter + highlights + diff bg" display (future Terminal viewer, Log viewer, Diff viewer)

The user (2026-05-16) asked: "why do we have codeblock specific stuff in the systems? shouldn't it be generic for any component like that? but you may keep the current codeblock thing as is rn... so we have a floor to build other components over it?"

The structural answer: extract the generic primitives without breaking CodeBlock. Future components compose them.

## Decision

Three additive extractions, each its own commit, each fully back-compatible.

### 1. `<Copy>` primitive

New `systems/design/src/Copy.tsx` (~70 LOC). Generic click-to-copy button:

```tsx
import { Copy } from '@place/design'

<Copy text="bun add @place/design" />

<Copy text={code} idleLabel="copy snippet" copiedLabel="copied!" />

<Copy text={url} class="my-styles">
  <ShareIcon /> share link
</Copy>
```

Behaviour:
- Renders a `<button data-place-copy data-place-copy-text="<encoded>">`
- Emits a shared inline copy runtime alongside the button (idempotent via `window.__placeCopy === 1` guard)
- Toggles `data-state="copied"` for 1.4 s on success; CSS in `styles.ts` swaps the visible label

CodeBlock continues to render its own copy button via the legacy `data-place-code-copy` attribute — the same shared inline runtime handles both attribute names. The legacy alias persists for one release; future CodeBlock cleanup can route through `<Copy>` directly.

### 2. Generic CSS variables (`--tok-*` + `--lines-*`)

Renamed from `--cb-tok-*` → `--tok-*` and split the highlight/diff colors into `--lines-hl-bg`, `--lines-hl-bar`, `--lines-diff-add-bg`, `--lines-diff-rm-bg`. Both class selectors (`.place-code` and `.place-lines`) declare the variables so either consumer family can override them per-instance:

```tsx
<CodeBlock style={{ '--tok-keyword': '#ff79c6' }} />

// Future Terminal viewer would use the same variables:
<Terminal style={{ '--tok-keyword': '...' }} class="place-lines" />
```

### 3. Line-grid CSS — dual selectors for transition

CSS now ships both class names targeting the same rules:

| Old (still works for CodeBlock) | New (for future generic consumers) |
|---|---|
| `.place-code-lines` | `.place-lines-rows` |
| `.place-code-ln` | `.place-lines-gutter` |
| `.place-code-line` | `.place-lines-row` |

CodeBlock's emitter still produces `place-code-*` so the 27 existing CodeBlock tests pass unchanged. Future components emit `place-lines-*`. Both share the underlying grid + highlight + diff rules.

### Why this is "the floor"

A consumer building a `<Terminal>` component now writes:

```tsx
<div class="place-lines" data-wrap="scroll">
  <div class="place-lines-rows">
    {lines.map((line, i) => (
      <>
        <span class="place-lines-gutter">{i + 1}</span>
        <span class="place-lines-row" data-hl={line.highlighted ? '1' : undefined}>
          {tokenize(line.text).map(t => <span class={`tok-${t.kind}`}>{t.text}</span>)}
        </span>
      </>
    ))}
  </div>
</div>
<Copy text={fullText} />
```

…and gets line gutter + highlights + token colours + a copy button "for free" — zero new CSS, zero new runtime, zero per-component matchMedia / clipboard plumbing. The floor is in place.

## Verification

- 6 new tests in `Copy.test.ts` (default labels, URL-encoded text, custom labels, children override, class merging, aria-label)
- 27 CodeBlock tests pass with 3 updated string assertions (`__placeCodeCopy` → `__placeCopy`)
- 14 typecheck projects clean
- Live curl on `/why`: 14× `__placeCopy` runtime emissions, 14× `tok-attr` (new property access kind), 47× `tok-keyword`, 2× `tok-regex` (regex literal detection)

## Migration

Pre-publish: no compatibility shim, but a one-release alias window is provided anyway:

- The old `placeCodeBlockCopy` export at `systems/design/src/code/copy-runtime.ts` re-exports the new `placeCopyRuntime` (function identity preserved; both names usable)
- The inline runtime recognizes both `data-place-copy` and the legacy `data-place-code-copy` attribute
- The CSS recognizes both `place-code-*` and `place-lines-*` class names

A future cut can drop the aliases when the design library publishes; right now they cost nothing.

## What's NOT in this round

- A `<Terminal>` / `<Log>` / `<Diff>` component built on the new primitives — the user explicitly said "you may keep the current codeblock thing as is rn... so we have a floor to build other components over it." The floor is the work; the buildings come later.
- Renaming CodeBlock's emitted classes from `place-code-*` to `place-lines-*`. Not necessary; CodeBlock and the line-grid primitive coexist.

## Why this passes "magic with clarity"

- **Discoverable**: every primitive is a named export — `Copy`, `CopyProps`, `placeCopyRuntime`. The CSS variables are listed in one place (`styles.ts`).
- **Traceable**: `window.__placeCopy` flag is visible in devtools; `data-place-copy` attributes are visible on inspect-element.
- **Faithful to performance**: ~280 bytes raw inline runtime; idempotent via the browser-level guard; gzip dedupes N emissions per page into ~300 bytes total. No island bundle.
