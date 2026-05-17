// Tokenizer plugin system for the design library's `<CodeBlock>`.
//
// **Why hand-rolled, not Shiki/Prism/Highlight.js.**
//
// Shiki ships VS Code's TextMate grammars — ~600 KB gzipped for the
// full set, ~30 KB per language and a WASM loader. Prism is smaller
// (~10 KB core + ~1-5 KB per language) but its regex-based grammars
// produce noisy DOM and require client-side runtime. Both are
// overkill for a docs-shape site where the goal is *readable colors
// for TS/JSX*, not full LSP-grade highlighting.
//
// The hand-rolled tokenizer below is ~120 lines of code, zero
// dependencies, runs entirely at SSR (zero client JS), and produces
// clean DOM (one `<span class="tok-<kind>">` per coloured run). It
// covers ts/tsx/js/jsx well and is the default. For other languages
// the design library exposes:
//
//   - `registerLanguage(name, fn)` — global plugin (e.g. add rust)
//   - `tokenize: (src) => Tok[]` prop on `<CodeBlock>` — per-instance
//
// Both override the default. Tokenizers MUST return tokens whose
// `text` fields concatenate back to the original source (no
// dropped characters); the renderer relies on that invariant for
// stable line-numbering + diff parsing.

/** A coloured run. `kind` maps to a `.tok-<kind>` CSS class. */
export interface Tok {
  readonly kind: TokKind
  readonly text: string
}

/**
 * Built-in token kinds. Custom tokenizers may emit any string — the
 * renderer prefixes with `tok-` for the CSS class. To keep
 * cross-language consistency, prefer reusing these when applicable.
 */
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
  // String type allowed for custom tokenizers (e.g. 'macro' for
  // rust). The renderer applies `tok-<value>` as the class name.
  | (string & {})

/** Tokenizer signature. Pure, synchronous. Receives raw source. */
export type Tokenizer = (src: string) => readonly Tok[]

// ===== JS / TS / JSX tokenizer V2 (built-in default) =====
//
// Improvements over V1:
//
//   - **Template literal interpolation**: `${expression}` inside
//     backtick strings tokenizes as code, not as part of the string.
//   - **Regex literals**: distinguishes `/foo/g` from `a / b` via a
//     "is regex allowed here?" context heuristic based on the
//     previous non-trivial token kind.
//   - **JSX attribute values**: after a JSX tag name, attribute
//     identifiers get the `attr` kind; values (string literal or
//     `{expression}`) tokenize as expected.
//   - **Property access**: `obj.foo` colors `foo` as `attr` (subtle
//     dim) to mirror reader expectations.
//   - **Decorators**: `@Decorator` gets the `tag-component` kind
//     (same dim accent as JSX components).
//   - **More keywords**: `abstract`, `override`, `accessor`, `using`,
//     `assert`, `module`, `unique`.
//
// Still hand-rolled, still ~250 LOC, still zero deps, still SSR-only.

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return',
  'if', 'else', 'import', 'export', 'default',
  'async', 'await', 'from', 'as', 'type',
  'interface', 'extends', 'class', 'new', 'this',
  'true', 'false', 'null', 'undefined',
  'in', 'of', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue',
  'throw', 'try', 'catch', 'finally',
  'delete', 'typeof', 'instanceof',
  'readonly', 'public', 'private', 'protected',
  'static', 'enum', 'namespace', 'declare', 'yield',
  'satisfies', 'keyof', 'infer', 'is', 'asserts',
  'abstract', 'override', 'accessor', 'using', 'assert',
  'module', 'unique', 'global', 'with', 'package',
  'implements', 'super', 'void',
])

const TYPES = new Set([
  'string', 'number', 'boolean', 'object',
  'any', 'never', 'unknown', 'bigint', 'symbol',
  'Record', 'Array', 'Promise', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'ReadonlyArray', 'Readonly',
  'Partial', 'Required', 'Pick', 'Omit',
  'Awaited', 'NoInfer', 'Exclude', 'Extract',
  'ReturnType', 'Parameters',
  'Date', 'RegExp', 'Error', 'JSON', 'Math',
])

const IDENT = /[A-Za-z_$]/
const IDENT_TAIL = /[A-Za-z0-9_$]/

// Keywords AFTER which a `/` introduces a regex (not division).
// Discriminator for the "is regex allowed here?" heuristic.
const REGEX_AFTER_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of',
  'delete', 'throw', 'new', 'yield', 'await',
  'case', 'do', 'else',
])

// Punctuation chars after which a `/` is a regex (not division).
// E.g. `(`, `,`, `=`, `:`, `;`, `[`, `{`, `?`, operators.
const REGEX_AFTER_PUNCT = '({[,;:=?!&|+-*%~^<>'

/**
 * Walk a template literal starting at `i` (which points at the
 * opening backtick). Emits tokens for the static string portions
 * AND recurses on `${expr}` interpolation chunks via the inner
 * tokenizer (so identifiers / keywords / numbers inside the expr
 * are coloured correctly). Returns the index AFTER the closing
 * backtick (or end-of-source on unclosed).
 */
function scanTemplate(src: string, start: number, out: Tok[]): number {
  // Emit opening backtick as a string-styled punct so theme picks it
  // up as part of the string visual.
  out.push({ kind: 'string', text: '`' })
  let i = start + 1
  let bufStart = i
  while (i < src.length) {
    const ch = src[i] ?? ''
    if (ch === '\\') {
      // Skip escape sequence; only the next char.
      i += 2
      continue
    }
    if (ch === '`') {
      // Flush any pending string buffer.
      if (i > bufStart) out.push({ kind: 'string', text: src.slice(bufStart, i) })
      out.push({ kind: 'string', text: '`' })
      return i + 1
    }
    if (ch === '$' && src[i + 1] === '{') {
      // Flush pending string.
      if (i > bufStart) out.push({ kind: 'string', text: src.slice(bufStart, i) })
      // Emit the `${` delimiter as punct so it visually separates
      // from both the string and the expression contents.
      out.push({ kind: 'punct', text: '${' })
      // Recurse on the inner expression. Find matching `}` accounting
      // for nested braces, strings, and templates inside the expr.
      let depth = 1
      let j = i + 2
      const exprStart = j
      while (j < src.length && depth > 0) {
        const c = src[j] ?? ''
        if (c === '\\') {
          j += 2
          continue
        }
        if (c === '"' || c === "'") {
          // Skip a string literal so its braces don't count.
          const quote = c
          let k = j + 1
          while (k < src.length && src[k] !== quote) {
            if (src[k] === '\\') k++
            k++
          }
          j = Math.min(k + 1, src.length)
          continue
        }
        if (c === '`') {
          // Nested template — find its close.
          let k = j + 1
          while (k < src.length && src[k] !== '`') {
            if (src[k] === '\\') k++
            k++
          }
          j = Math.min(k + 1, src.length)
          continue
        }
        if (c === '{') depth++
        else if (c === '}') depth--
        if (depth === 0) break
        j++
      }
      // Tokenize the inner expression with the same TS tokenizer.
      const inner = tokenizeTsRange(src, exprStart, j)
      for (const tok of inner) out.push(tok)
      out.push({ kind: 'punct', text: '}' })
      i = j + 1
      bufStart = i
      continue
    }
    i++
  }
  // Unclosed — emit remaining buffer as string and stop.
  if (i > bufStart) out.push({ kind: 'string', text: src.slice(bufStart, i) })
  return i
}

/**
 * Tokenize a sub-range of `src` (used by template-literal
 * interpolation to handle nested expressions). Stateless: just runs
 * the main tokenizer over `src.slice(start, end)` and shifts tokens
 * back into the parent stream.
 */
function tokenizeTsRange(src: string, start: number, end: number): readonly Tok[] {
  return tokenizeTs(src.slice(start, end))
}

/**
 * Look at the last non-trivial token to decide whether a `/`
 * introduces a regex literal or a division operator.
 *
 *   - First token in stream → regex
 *   - After a keyword listed in `REGEX_AFTER_KEYWORDS` → regex
 *   - After punctuation in `REGEX_AFTER_PUNCT` → regex
 *   - After plain runs whose trailing non-whitespace char is in
 *     `REGEX_AFTER_PUNCT` → regex (the tokenizer emits single
 *     punctuation chars like `=`, `(`, `,` as `plain` kind today)
 *   - Otherwise → division
 */
function regexAllowedAt(prev: Tok | undefined): boolean {
  if (!prev) return true
  const text = prev.text
  if (prev.kind === 'keyword') return REGEX_AFTER_KEYWORDS.has(text)
  if (prev.kind === 'punct') {
    const last = text.charAt(text.length - 1)
    return REGEX_AFTER_PUNCT.includes(last)
  }
  if (prev.kind === 'plain') {
    const trimmed = text.trim()
    // Pure whitespace — permissive (the meaningful prev was further
    // back; `prevMeaningful` already skipped pure-WS plain runs).
    if (trimmed === '') return true
    const last = trimmed.charAt(trimmed.length - 1)
    return REGEX_AFTER_PUNCT.includes(last)
  }
  // After identifier-like tokens (type, attr, tag-component) or
  // values (number, string, regex) → division more likely.
  return false
}

/** Scan a regex literal starting at the leading `/`. */
function scanRegex(src: string, start: number): { text: string; end: number } {
  let i = start + 1
  let inClass = false
  while (i < src.length) {
    const ch = src[i] ?? ''
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === '[') inClass = true
    else if (ch === ']') inClass = false
    else if (ch === '/' && !inClass) {
      i++
      // Trailing flags.
      while (i < src.length && /[gimsuy]/.test(src[i] ?? '')) i++
      return { text: src.slice(start, i), end: i }
    } else if (ch === '\n') {
      // Unterminated — bail.
      break
    }
    i++
  }
  return { text: src.slice(start, i), end: i }
}

/**
 * Find the meaningful previous token (skipping pure whitespace plain
 * runs). Used by `regexAllowedAt` for the discrimination heuristic.
 */
function prevMeaningful(toks: readonly Tok[]): Tok | undefined {
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i] as Tok
    if (t.kind === 'plain' && t.text.trim() === '') continue
    return t
  }
  return undefined
}

export const tokenizeTs: Tokenizer = (src) => {
  const out: Tok[] = []
  let i = 0
  // JSX tag state: how many tag-name tokens have we emitted whose
  // tag close hasn't appeared yet. Inside the tag, identifiers
  // followed by `=` are attribute names.
  let jsxTagDepth = 0
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
    // Regex literal vs division — context-aware.
    if (ch === '/' && regexAllowedAt(prevMeaningful(out))) {
      const r = scanRegex(src, i)
      if (r.end > i + 1) {
        out.push({ kind: 'regex', text: r.text })
        i = r.end
        continue
      }
    }
    // Template literal — recurse into interpolation expressions.
    if (ch === '`') {
      i = scanTemplate(src, i, out)
      continue
    }
    // Single/double-quoted string.
    if (ch === "'" || ch === '"') {
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
    // JSX tag open — but disambiguate from TS generic type params
    // (`function foo<T extends X>()`, `Promise<string>`, etc.).
    //
    // Heuristic: a `<` is a generic, not a JSX open, when ALL of:
    //   - It's preceded *immediately* by an identifier-class token
    //     (`plain`, `type`, `tag-component`, `attr`) with NO
    //     whitespace separating them (e.g. `foo<T>`, `Promise<U>`).
    //   - The inner `<...>` region contains one of the generic-only
    //     signals: `extends`, `,`, `=`, `keyof`, `infer`, `&`, `|`,
    //     `(` (function type), `[` (tuple/index), or a leading
    //     uppercase type-name + closing `>` with no JSX whitespace.
    //
    // Detect simply: scan forward to the first `>`/`<`/EOL. If we
    // see a generic signal before either, treat as generic — color
    // the bracket as `punct` and let the inner tokens flow.
    // Otherwise treat as JSX.
    if (ch === '<' && (IDENT.test(src[i + 1] ?? '') || src[i + 1] === '/')) {
      // `</foo>` (JSX close tag) is unambiguously NOT a generic —
      // skip the generics detection entirely so the JSX-close path
      // wins. Otherwise the inner-scan would find `>` and falsely
      // claim it's a generic, leaving `/foo>` to be mis-tokenized.
      const nextIsClose = src[i + 1] === '/'
      // Generic detection: previous meaningful token was an
      // identifier-class, no whitespace between it and `<`.
      const prev = prevMeaningful(out)
      const isIdentish =
        !nextIsClose &&
        prev &&
        (prev.kind === 'plain' ||
          prev.kind === 'type' ||
          prev.kind === 'tag-component' ||
          prev.kind === 'attr') &&
        // Check the source character just before `<` is not whitespace.
        i > 0 &&
        !/\s/.test(src[i - 1] ?? '')
      let asGeneric = false
      if (isIdentish) {
        // Scan forward for a generic signal up to the matching `>`
        // or an obvious abort character (newline, `;`, `{`).
        let j = i + 1
        let depth = 1
        while (j < src.length && depth > 0) {
          const c = src[j] ?? ''
          if (c === '\n' || c === ';' || c === '{') break
          if (c === '<') depth++
          else if (c === '>') {
            depth--
            if (depth === 0) {
              asGeneric = true
              break
            }
          } else if (c === ',' || c === '=' || c === '|' || c === '&') {
            asGeneric = true
            break
          } else if (IDENT.test(c)) {
            // Probe for `extends`, `keyof`, `infer` keywords.
            let k = j
            while (k < src.length && IDENT_TAIL.test(src[k] ?? '')) k++
            const word = src.slice(j, k)
            if (word === 'extends' || word === 'keyof' || word === 'infer') {
              asGeneric = true
              break
            }
            j = k
            continue
          }
          j++
        }
      }
      if (asGeneric) {
        // Treat `<` as punct; let the rest of tokenization continue.
        out.push({ kind: 'punct', text: '<' })
        i++
        continue
      }
      // JSX tag open path.
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
        jsxTagDepth++
      }
      i = nameEnd
      continue
    }
    // JSX tag close (`>` or `/>`) — exits attribute-name mode.
    if (jsxTagDepth > 0 && (ch === '>' || (ch === '/' && src[i + 1] === '>'))) {
      jsxTagDepth--
      out.push({ kind: 'punct', text: ch === '/' ? '/>' : '>' })
      i += ch === '/' ? 2 : 1
      continue
    }
    // Decorator: `@Identifier`.
    if (ch === '@' && IDENT.test(src[i + 1] ?? '')) {
      let j = i + 1
      while (j < src.length && IDENT_TAIL.test(src[j] ?? '')) j++
      out.push({ kind: 'tag-component', text: src.slice(i, j) })
      i = j
      continue
    }
    // Property access: `.identifier` (after an identifier-class token).
    if (ch === '.' && IDENT.test(src[i + 1] ?? '')) {
      // Only color as property if previous meaningful token was an
      // identifier-like one (not a number — `0.5` is a float, not a
      // property access).
      const prev = prevMeaningful(out)
      if (
        prev &&
        (prev.kind === 'plain' ||
          prev.kind === 'type' ||
          prev.kind === 'tag-component' ||
          prev.kind === 'attr')
      ) {
        out.push({ kind: 'punct', text: '.' })
        let j = i + 1
        while (j < src.length && IDENT_TAIL.test(src[j] ?? '')) j++
        out.push({ kind: 'attr', text: src.slice(i + 1, j) })
        i = j
        continue
      }
    }
    // Identifier / keyword / type / JSX attribute name.
    if (IDENT.test(ch)) {
      let j = i
      while (j < src.length && IDENT_TAIL.test(src[j] ?? '')) j++
      const word = src.slice(i, j)
      // JSX attribute-name heuristic FIRST — inside a JSX tag, the
      // identifier-followed-by-`=` is an attribute, which beats the
      // keyword/type classification (HTML attrs like `class`, `for`,
      // `default`, `type` all collide with TS keywords otherwise).
      let kind: TokKind
      let asAttr = false
      if (jsxTagDepth > 0) {
        let k = j
        while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k++
        if (src[k] === '=') asAttr = true
      }
      if (asAttr) {
        kind = 'attr'
      } else {
        kind = KEYWORDS.has(word) ? 'keyword' : TYPES.has(word) ? 'type' : 'plain'
      }
      out.push({ kind, text: word })
      i = j
      continue
    }
    // Number — supports hex (`0xff`), octal (`0o7`), binary (`0b1`),
    // decimal with separators (`1_000`), exponents (`1e3`), and
    // BigInt (`1n`).
    if (ch >= '0' && ch <= '9') {
      let j = i
      while (j < src.length) {
        const c = src[j] ?? ''
        if (!/[0-9.xXoObBeE+\-a-fA-F_n]/.test(c)) break
        j++
      }
      out.push({ kind: 'number', text: src.slice(i, j) })
      i = j
      continue
    }
    out.push({ kind: 'plain', text: ch })
    i++
  }
  return out
}

// ===== Shell tokenizer (lines starting with `$` or `>` get colored) =====

export const tokenizeShell: Tokenizer = (src) => {
  const out: Tok[] = []
  const lines = src.split('\n')
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li] ?? ''
    const m = /^(\s*)([$>])\s*/.exec(line)
    if (m) {
      out.push({ kind: 'plain', text: m[1] ?? '' })
      out.push({ kind: 'punct', text: m[2] ?? '' })
      out.push({ kind: 'plain', text: line.slice(m[0].length) })
    } else {
      // Comment lines (start with #).
      const cm = /^(\s*)(#.*)$/.exec(line)
      if (cm) {
        out.push({ kind: 'plain', text: cm[1] ?? '' })
        out.push({ kind: 'comment', text: cm[2] ?? '' })
      } else {
        out.push({ kind: 'plain', text: line })
      }
    }
    if (li < lines.length - 1) out.push({ kind: 'plain', text: '\n' })
  }
  return out
}

// ===== JSON tokenizer =====
//
// Real JSON only: strings (with escapes), numbers, booleans, null,
// punctuation. Keys (strings immediately followed by `:`) get the
// `attr` kind so they read as a distinct color from string values.

export const tokenizeJson: Tokenizer = (src) => {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i] ?? ''
    if (ch === '"') {
      // Scan string.
      let j = i + 1
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\') j++
        j++
      }
      j = Math.min(j + 1, src.length)
      // Look ahead past whitespace for `:` — if so, this is a key.
      let k = j
      while (k < src.length && /\s/.test(src[k] ?? '')) k++
      const isKey = src[k] === ':'
      out.push({ kind: isKey ? 'attr' : 'string', text: src.slice(i, j) })
      i = j
      continue
    }
    if ((ch >= '0' && ch <= '9') || (ch === '-' && (src[i + 1] ?? '') >= '0' && (src[i + 1] ?? '') <= '9')) {
      let j = i
      if (src[j] === '-') j++
      while (j < src.length && /[0-9.eE+\-]/.test(src[j] ?? '')) j++
      out.push({ kind: 'number', text: src.slice(i, j) })
      i = j
      continue
    }
    if (IDENT.test(ch)) {
      let j = i
      while (j < src.length && IDENT_TAIL.test(src[j] ?? '')) j++
      const word = src.slice(i, j)
      const kind: TokKind =
        word === 'true' || word === 'false' ? 'keyword' : word === 'null' ? 'keyword' : 'plain'
      out.push({ kind, text: word })
      i = j
      continue
    }
    if ('{}[]'.includes(ch) || ch === ',' || ch === ':') {
      out.push({ kind: 'punct', text: ch })
      i++
      continue
    }
    out.push({ kind: 'plain', text: ch })
    i++
  }
  return out
}

// ===== CSS tokenizer =====
//
// Colors selectors / properties / values distinctly. `@`-rules
// (`@import`, `@media`, `@theme`) are keywords; inside a `{...}`
// block, the identifier-before-`:` is a property (`attr` kind);
// strings, numbers, and `var(--…)` references are colored. Comments
// are `/* … */`.

export const tokenizeCss: Tokenizer = (src) => {
  const out: Tok[] = []
  let i = 0
  let inBlock = 0 // depth of `{...}` nesting
  let atPropertyValue = false // true after `:` in a property line, until `;` or `}`
  while (i < src.length) {
    const ch = src[i] ?? ''
    // Comment.
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end === -1 ? src.length : end + 2
      out.push({ kind: 'comment', text: src.slice(i, stop) })
      i = stop
      continue
    }
    // String.
    if (ch === '"' || ch === "'") {
      const quote = ch
      let j = i + 1
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\') j++
        j++
      }
      j = Math.min(j + 1, src.length)
      out.push({ kind: 'string', text: src.slice(i, j) })
      i = j
      continue
    }
    if (ch === '{') {
      inBlock++
      atPropertyValue = false
      out.push({ kind: 'punct', text: '{' })
      i++
      continue
    }
    if (ch === '}') {
      if (inBlock > 0) inBlock--
      atPropertyValue = false
      out.push({ kind: 'punct', text: '}' })
      i++
      continue
    }
    if (ch === ';') {
      atPropertyValue = false
      out.push({ kind: 'punct', text: ';' })
      i++
      continue
    }
    if (ch === ':' && inBlock > 0 && !atPropertyValue) {
      atPropertyValue = true
      out.push({ kind: 'punct', text: ':' })
      i++
      continue
    }
    // @-rule.
    if (ch === '@' && IDENT.test(src[i + 1] ?? '')) {
      let j = i + 1
      while (j < src.length && IDENT_TAIL.test(src[j] ?? '')) j++
      out.push({ kind: 'keyword', text: src.slice(i, j) })
      i = j
      continue
    }
    // Identifier — could be a property name (inside block, before `:`),
    // a value identifier (after `:`), or a selector token.
    if (IDENT.test(ch) || ch === '-') {
      // CSS idents allow `-` and `--` prefixes.
      let j = i
      while (j < src.length && (IDENT_TAIL.test(src[j] ?? '') || src[j] === '-')) j++
      const word = src.slice(i, j)
      // Look ahead for `:` (after whitespace) to detect a property name.
      let k = j
      while (k < src.length && /\s/.test(src[k] ?? '')) k++
      const isProperty = inBlock > 0 && !atPropertyValue && src[k] === ':'
      const isVarCall = word === 'var' || word === 'calc' || word === 'rgb' || word === 'rgba' || word === 'hsl' || word === 'oklch' || word === 'color-mix'
      const kind: TokKind = isProperty
        ? 'attr'
        : isVarCall
          ? 'tag-component'
          : word.startsWith('--')
            ? 'attr'
            : 'plain'
      out.push({ kind, text: word })
      i = j
      continue
    }
    // Numbers (including units like 1rem, 2px, 100%).
    if (ch >= '0' && ch <= '9') {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j] ?? '')) j++
      // Optional unit suffix.
      let unitEnd = j
      while (unitEnd < src.length && /[a-zA-Z%]/.test(src[unitEnd] ?? '')) unitEnd++
      out.push({ kind: 'number', text: src.slice(i, unitEnd) })
      i = unitEnd
      continue
    }
    out.push({ kind: 'plain', text: ch })
    i++
  }
  return out
}

// ===== HTML tokenizer =====
//
// Tags, attributes, attribute values, comments, text. The structure
// is similar to the JSX path in `tokenizeTs` but standalone.

export const tokenizeHtml: Tokenizer = (src) => {
  const out: Tok[] = []
  let i = 0
  let inTag = 0 // 1 while we're inside `<...>` (after the tag name)
  while (i < src.length) {
    const ch = src[i] ?? ''
    // HTML comment.
    if (ch === '<' && src.slice(i, i + 4) === '<!--') {
      const end = src.indexOf('-->', i + 4)
      const stop = end === -1 ? src.length : end + 3
      out.push({ kind: 'comment', text: src.slice(i, stop) })
      i = stop
      continue
    }
    // DOCTYPE / declaration.
    if (ch === '<' && src[i + 1] === '!') {
      const end = src.indexOf('>', i + 1)
      const stop = end === -1 ? src.length : end + 1
      out.push({ kind: 'keyword', text: src.slice(i, stop) })
      i = stop
      continue
    }
    // Tag open / close.
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
        inTag = 1
      }
      i = nameEnd
      continue
    }
    // Tag close (`>` or `/>`).
    if (inTag && (ch === '>' || (ch === '/' && src[i + 1] === '>'))) {
      inTag = 0
      out.push({ kind: 'punct', text: ch === '/' ? '/>' : '>' })
      i += ch === '/' ? 2 : 1
      continue
    }
    // Attribute name inside a tag.
    if (inTag && IDENT.test(ch)) {
      let j = i
      while (j < src.length && (IDENT_TAIL.test(src[j] ?? '') || src[j] === '-' || src[j] === ':')) j++
      out.push({ kind: 'attr', text: src.slice(i, j) })
      i = j
      continue
    }
    // Attribute value string.
    if (inTag && (ch === '"' || ch === "'")) {
      const quote = ch
      let j = i + 1
      while (j < src.length && src[j] !== quote) j++
      j = Math.min(j + 1, src.length)
      out.push({ kind: 'string', text: src.slice(i, j) })
      i = j
      continue
    }
    // Outside a tag: text content passes through as plain.
    out.push({ kind: 'plain', text: ch })
    i++
  }
  return out
}

// ===== Python tokenizer =====
//
// Keywords, types, strings (including triple-quoted), numbers,
// comments (`#`), decorators (`@name`).

const PY_KEYWORDS = new Set([
  'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while',
  'in', 'not', 'and', 'or', 'is', 'pass', 'break', 'continue',
  'import', 'from', 'as', 'try', 'except', 'finally', 'raise',
  'with', 'yield', 'lambda', 'global', 'nonlocal', 'async', 'await',
  'True', 'False', 'None', 'self', 'cls', 'match', 'case',
])
const PY_TYPES = new Set([
  'int', 'float', 'str', 'bool', 'list', 'tuple', 'dict', 'set',
  'bytes', 'frozenset', 'object', 'type', 'Any', 'Optional', 'Union',
  'List', 'Dict', 'Set', 'Tuple', 'Callable', 'Iterable', 'Iterator',
])

export const tokenizePython: Tokenizer = (src) => {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i] ?? ''
    // Comment.
    if (ch === '#') {
      const nl = src.indexOf('\n', i)
      const stop = nl === -1 ? src.length : nl
      out.push({ kind: 'comment', text: src.slice(i, stop) })
      i = stop
      continue
    }
    // Triple-quoted string.
    if (
      (ch === '"' && src[i + 1] === '"' && src[i + 2] === '"') ||
      (ch === "'" && src[i + 1] === "'" && src[i + 2] === "'")
    ) {
      const quote = ch + ch + ch
      const end = src.indexOf(quote, i + 3)
      const stop = end === -1 ? src.length : end + 3
      out.push({ kind: 'string', text: src.slice(i, stop) })
      i = stop
      continue
    }
    // Single/double-quoted string (no escapes for newlines).
    if (ch === '"' || ch === "'") {
      const quote = ch
      let j = i + 1
      while (j < src.length && src[j] !== quote && src[j] !== '\n') {
        if (src[j] === '\\') j++
        j++
      }
      j = Math.min(j + 1, src.length)
      out.push({ kind: 'string', text: src.slice(i, j) })
      i = j
      continue
    }
    // Decorator.
    if (ch === '@' && IDENT.test(src[i + 1] ?? '')) {
      let j = i + 1
      while (j < src.length && IDENT_TAIL.test(src[j] ?? '')) j++
      out.push({ kind: 'tag-component', text: src.slice(i, j) })
      i = j
      continue
    }
    // Number.
    if (ch >= '0' && ch <= '9') {
      let j = i
      while (j < src.length && /[0-9._eExXoObB+\-jJ]/.test(src[j] ?? '')) j++
      out.push({ kind: 'number', text: src.slice(i, j) })
      i = j
      continue
    }
    // Identifier / keyword / type.
    if (IDENT.test(ch)) {
      let j = i
      while (j < src.length && IDENT_TAIL.test(src[j] ?? '')) j++
      const word = src.slice(i, j)
      const kind: TokKind = PY_KEYWORDS.has(word) ? 'keyword' : PY_TYPES.has(word) ? 'type' : 'plain'
      out.push({ kind, text: word })
      i = j
      continue
    }
    out.push({ kind: 'plain', text: ch })
    i++
  }
  return out
}

// ===== Plaintext / fallback tokenizer =====

export const tokenizePlain: Tokenizer = (src) => [{ kind: 'plain', text: src }]

// ===== Language registry =====
//
// Maps a language identifier (case-insensitive) to its tokenizer.
// `<CodeBlock lang="rust">` looks up by lowercased lang first; falls
// back to the alias map; falls back to plain text.

const registry = new Map<string, Tokenizer>([
  ['ts', tokenizeTs],
  ['tsx', tokenizeTs],
  ['js', tokenizeTs],
  ['jsx', tokenizeTs],
  ['javascript', tokenizeTs],
  ['typescript', tokenizeTs],
  ['shell', tokenizeShell],
  ['sh', tokenizeShell],
  ['bash', tokenizeShell],
  ['zsh', tokenizeShell],
  ['json', tokenizeJson],
  ['css', tokenizeCss],
  ['html', tokenizeHtml],
  ['htm', tokenizeHtml],
  ['xml', tokenizeHtml],
  ['svg', tokenizeHtml],
  ['python', tokenizePython],
  ['py', tokenizePython],
  ['plaintext', tokenizePlain],
  ['text', tokenizePlain],
])

/**
 * Register a tokenizer for a language identifier. Replaces any
 * existing entry for the same name. The name is stored lowercased.
 *
 * ```ts
 * import { registerLanguage } from '@place/design'
 *
 * registerLanguage('rust', (src) => {
 *   // ... your tokenizer ...
 * })
 * ```
 *
 * Multiple aliases: register each separately.
 */
export function registerLanguage(name: string, fn: Tokenizer): void {
  registry.set(name.toLowerCase(), fn)
}

/**
 * Resolve a language identifier to a tokenizer. Case-insensitive.
 * Returns `tokenizePlain` for unknown languages — never throws.
 *
 * The `const T` type parameter preserves the literal type at the
 * call site (e.g. `getTokenizer('rust')` keeps `'rust'` rather
 * than widening to `string`), which lets variant pickers downstream
 * type-check their lang prop unions.
 */
export function getTokenizer<const T extends string>(name: T): Tokenizer {
  return registry.get(name.toLowerCase()) ?? tokenizePlain
}

/**
 * Known language identifiers — every lowercased registry key. Useful
 * for typed lang-picker UIs (combine with `keyof` patterns).
 */
export function knownLanguages(): readonly string[] {
  return [...registry.keys()]
}
