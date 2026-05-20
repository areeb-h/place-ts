// Syntax-highlighted code block with copy-to-clipboard + language label.
// Tokenizer is hand-rolled (~70 lines) and good enough for TS/JSX —
// the goal is readable colors, not a full LSP. SSR-safe: the tokenized
// HTML renders on the server; the copy button only does anything after
// hydration.

import { state } from '@place/component'

export type TokKind =
  | 'comment'
  | 'string'
  | 'keyword'
  | 'type'
  | 'number'
  | 'tag-component'
  | 'tag'
  | 'attr'
  | 'punct'
  | 'plain'

export interface Tok {
  kind: TokKind
  text: string
}

const KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'import',
  'export',
  'default',
  'async',
  'await',
  'from',
  'as',
  'type',
  'interface',
  'extends',
  'class',
  'new',
  'this',
  'true',
  'false',
  'null',
  'undefined',
  'in',
  'of',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'throw',
  'try',
  'catch',
  'finally',
  'delete',
  'typeof',
  'instanceof',
  'readonly',
  'public',
  'private',
  'protected',
  'static',
  'enum',
  'namespace',
  'declare',
  'yield',
])

const TYPES = new Set([
  'string',
  'number',
  'boolean',
  'object',
  'any',
  'void',
  'never',
  'unknown',
  'Record',
  'Array',
  'Promise',
  'Map',
  'Set',
  'ReadonlyArray',
  'Partial',
  'Required',
  'Pick',
  'Omit',
])

const IDENT = /[A-Za-z_$]/
const IDENT_TAIL = /[A-Za-z0-9_$]/

export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i] ?? ''
    // Line comment.
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      const stop = nl === -1 ? src.length : nl
      out.push({ kind: 'comment', text: src.slice(i, stop) })
      i = stop
      continue
    }
    // Block comment.
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      out.push({ kind: 'comment', text: src.slice(i, stop) })
      i = stop
      continue
    }
    // String literal.
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\') j++
        j++
      }
      j = Math.min(j + 1, src.length)
      out.push({ kind: 'string', text: src.slice(i, j) })
      i = j
      continue
    }
    // JSX tag open: <Name | </Name. We don't try to parse the rest of
    // the tag — just colorize the tag name. Attribute names get picked
    // up later as bare idents inside the same line.
    if (ch === '<' && (IDENT.test(src[i + 1] ?? '') || src[i + 1] === '/')) {
      let j = i + 1
      if (src[j] === '/') j++
      let nameEnd = j
      while (nameEnd < src.length && IDENT_TAIL.test(src[nameEnd] ?? '')) nameEnd++
      out.push({ kind: 'punct', text: src.slice(i, j) })
      const name = src.slice(j, nameEnd)
      if (name) {
        out.push({
          kind: /^[A-Z]/.test(name) ? 'tag-component' : 'tag',
          text: name,
        })
      }
      i = nameEnd
      continue
    }
    // Identifier / keyword / type.
    if (IDENT.test(ch)) {
      let j = i
      while (j < src.length && IDENT_TAIL.test(src[j] ?? '')) j++
      const word = src.slice(i, j)
      const kind: TokKind = KEYWORDS.has(word) ? 'keyword' : TYPES.has(word) ? 'type' : 'plain'
      out.push({ kind, text: word })
      i = j
      continue
    }
    // Number.
    if (ch >= '0' && ch <= '9') {
      let j = i
      while (j < src.length) {
        const c = src[j] ?? ''
        if (!/[0-9.xXa-fA-F_]/.test(c)) break
        j++
      }
      out.push({ kind: 'number', text: src.slice(i, j) })
      i = j
      continue
    }
    // Anything else — punctuation, whitespace, etc. — passes through.
    out.push({ kind: 'plain', text: ch })
    i++
  }
  return out
}

function renderTokens(toks: readonly Tok[]) {
  const out: (string | { kind: TokKind; text: string })[] = []
  let buffer = ''
  for (const t of toks) {
    if (t.kind === 'plain') {
      buffer += t.text
    } else {
      if (buffer) {
        out.push(buffer)
        buffer = ''
      }
      out.push(t)
    }
  }
  if (buffer) out.push(buffer)
  return out.map((piece) =>
    typeof piece === 'string' ? piece : <span class={`tok-${piece.kind}`}>{piece.text}</span>,
  )
}

export interface CodeBlockProps {
  code: string
  lang?: string
  filename?: string
}

export const CodeBlock = (props: CodeBlockProps) => {
  const copied = state(false)
  const onCopy = (): void => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    void navigator.clipboard.writeText(props.code).then(() => {
      copied.set(true)
      setTimeout(() => copied.set(false), 1400)
    })
  }
  const tokens = tokenize(props.code)
  const rendered = renderTokens(tokens)
  return (
    // `code-block` semantic class kept for Tabs panel selector
    // (`.tabs-panel > .code-block`) and the prose pre override. The
    // visual styling is all Tailwind utilities on the elements here.
    <div class="code-block group relative my-4 mb-6 border border-border rounded-[10px] overflow-hidden bg-card/95">
      <div class="flex items-center gap-2 py-2 px-3.5 border-b border-border/60 bg-bg/60 font-mono text-[11px] leading-none text-muted">
        {props.filename ? <span class="mr-auto text-fg">{props.filename}</span> : null}
        <span class="ml-auto lowercase tracking-[0.05em]">{props.lang ?? 'ts'}</span>
        <button
          type="button"
          class="bg-transparent border border-transparent rounded px-2 py-0.5 text-muted font-inherit cursor-pointer transition-colors duration-150 hover:text-fg hover:border-border/80 hover:bg-card/60"
          onClick={onCopy}
          aria-label="Copy code"
        >
          {() => (copied() ? 'copied' : 'copy')}
        </button>
      </div>
      <pre class="code-block-pre m-0 py-4 px-5 overflow-x-auto font-mono text-[13px] leading-[1.65] bg-transparent border-0">
        <code>{rendered}</code>
      </pre>
    </div>
  )
}
