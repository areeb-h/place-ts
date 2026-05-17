// @vitest-environment node

import { describe, expect, test } from 'vitest'
import {
  tokenizeCss,
  tokenizeHtml,
  tokenizeJson,
  tokenizePython,
  tokenizeTs,
  type Tok,
} from '../../src/code/tokenize.ts'

// Helpers: project the tokenizer output to a `kind+text` shape that's
// readable in test assertions, and filter out plain-whitespace runs so
// assertions don't depend on exact spacing.

const kt = (toks: readonly Tok[]): Array<[string, string]> =>
  toks
    .filter((t) => !(t.kind === 'plain' && t.text.trim() === ''))
    .map((t) => [t.kind, t.text])

const findToken = (toks: readonly Tok[], text: string): Tok | undefined =>
  toks.find((t) => t.text === text)

describe('tokenizeTs — template literal interpolation', () => {
  test('${expr} contents tokenize as code, not as part of the string', () => {
    const toks = tokenizeTs('const s = `hello ${name}, age ${age}`')
    // The `name` and `age` identifiers should be present as their own
    // tokens with `plain` kind (not part of a `string` blob).
    const nameTok = findToken(toks, 'name')
    expect(nameTok).toBeDefined()
    expect(nameTok?.kind).toBe('plain')
    const ageTok = findToken(toks, 'age')
    expect(ageTok).toBeDefined()
    expect(ageTok?.kind).toBe('plain')
    // The `${` and `}` delimiters get emitted as punct.
    expect(toks.some((t) => t.kind === 'punct' && t.text === '${')).toBe(true)
    expect(toks.some((t) => t.kind === 'punct' && t.text === '}')).toBe(true)
  })

  test('keywords inside ${} interpolation are coloured as keywords', () => {
    const toks = tokenizeTs('`${typeof x === "number" ? "yes" : "no"}`')
    expect(findToken(toks, 'typeof')?.kind).toBe('keyword')
  })

  test('nested templates within ${} are handled (basic)', () => {
    const toks = tokenizeTs('const s = `outer ${`inner ${x}`} end`')
    // Should not crash; should still find `x` as code.
    expect(findToken(toks, 'x')?.kind).toBe('plain')
  })

  test('unclosed template falls back gracefully (no throw)', () => {
    const toks = tokenizeTs('const s = `unclosed string')
    expect(toks.length).toBeGreaterThan(0)
  })

  test('escape sequences inside template do not break interpolation detection', () => {
    const toks = tokenizeTs('`a\\`b ${x} c`')
    expect(findToken(toks, 'x')?.kind).toBe('plain')
  })
})

describe('tokenizeTs — regex literal detection', () => {
  test('regex after = is tokenized as regex, not as division', () => {
    const toks = tokenizeTs('const r = /foo/g')
    const regexTok = toks.find((t) => t.kind === 'regex')
    expect(regexTok).toBeDefined()
    expect(regexTok?.text).toBe('/foo/g')
  })

  test('regex after return keyword', () => {
    const toks = tokenizeTs('return /abc/i')
    expect(toks.find((t) => t.kind === 'regex')?.text).toBe('/abc/i')
  })

  test('division is NOT tokenized as regex', () => {
    const toks = tokenizeTs('const x = a / b / c')
    expect(toks.find((t) => t.kind === 'regex')).toBeUndefined()
  })

  test('regex with character class containing /', () => {
    const toks = tokenizeTs('const r = /[a/b]+/g')
    const regexTok = toks.find((t) => t.kind === 'regex')
    expect(regexTok).toBeDefined()
    expect(regexTok?.text).toContain('[a/b]')
  })
})

describe('tokenizeTs — property access', () => {
  test('obj.foo colors foo as attr', () => {
    const toks = tokenizeTs('obj.foo')
    const fooTok = findToken(toks, 'foo')
    expect(fooTok?.kind).toBe('attr')
  })

  test('chained property: obj.foo.bar colors both as attr', () => {
    const toks = tokenizeTs('obj.foo.bar')
    expect(findToken(toks, 'foo')?.kind).toBe('attr')
    expect(findToken(toks, 'bar')?.kind).toBe('attr')
  })

  test('numeric float (0.5) does NOT trigger property-access mis-color', () => {
    const toks = tokenizeTs('const x = 0.5')
    // `0.5` should be a single number token; no `.5` as attr.
    const numbers = toks.filter((t) => t.kind === 'number')
    expect(numbers.length).toBe(1)
    expect(numbers[0]?.text).toMatch(/^0\.5/)
  })
})

describe('tokenizeTs — JSX attribute values', () => {
  test('attribute names inside a JSX tag get attr kind', () => {
    const toks = tokenizeTs('<div class="x" id={y}>')
    expect(findToken(toks, 'class')?.kind).toBe('attr')
    expect(findToken(toks, 'id')?.kind).toBe('attr')
  })

  test('string attribute values stay as strings', () => {
    const toks = tokenizeTs('<a href="/x">')
    expect(toks.some((t) => t.kind === 'string' && t.text === '"/x"')).toBe(true)
  })

  test('expression attribute values tokenize their inner code', () => {
    const toks = tokenizeTs('<button onClick={() => doIt()}>')
    expect(findToken(toks, 'doIt')?.kind).toBe('plain')
  })
})

describe('tokenizeTs — decorators + new keywords', () => {
  test('@Decorator gets tag-component kind', () => {
    const toks = tokenizeTs('@Sealed\nclass Foo {}')
    expect(findToken(toks, '@Sealed')?.kind).toBe('tag-component')
  })

  test('new TS keywords are coloured (abstract, override, accessor, using)', () => {
    const toks = tokenizeTs('abstract class A { override accessor x = 1 }')
    expect(findToken(toks, 'abstract')?.kind).toBe('keyword')
    expect(findToken(toks, 'override')?.kind).toBe('keyword')
    expect(findToken(toks, 'accessor')?.kind).toBe('keyword')
  })
})

describe('tokenizeTs — output stability (concat = original)', () => {
  // CRITICAL invariant: tokens' text fields must concatenate back to
  // the original source. The renderer depends on this for line
  // numbering + diff parsing.
  test.each([
    'const x = 1',
    'function foo() { return x + 1 }',
    'const s = `hello ${name}, age ${age}`',
    'const r = /abc/g',
    '<div class="x">hello</div>',
    'obj.foo.bar()',
    '@Decorator\nclass A {}',
    'const x = 0.5 + 1e3',
  ])('roundtrip: %s', (src) => {
    const toks = tokenizeTs(src)
    const reassembled = toks.map((t) => t.text).join('')
    expect(reassembled).toBe(src)
  })
})

describe('tokenizeTs — TS generics vs JSX disambiguation', () => {
  test('`function foo<T extends Foo>()` keeps T as code, not a tag', () => {
    const toks = tokenizeTs('function foo<T extends Foo>() {}')
    // `T` should be tokenized as `plain`, NOT as `tag-component`.
    const tTok = findToken(toks, 'T')
    expect(tTok?.kind).toBe('plain')
    // `extends` is a keyword.
    expect(findToken(toks, 'extends')?.kind).toBe('keyword')
    // `Foo` is a type (in TYPES set? No, custom name → plain).
    expect(findToken(toks, 'Foo')?.kind).toBe('plain')
    // `(` after `>` should NOT be inside a JSX tag (no attr-classification weirdness).
  })

  test('`Promise<string>` recognized as generic, not JSX', () => {
    const toks = tokenizeTs('const x: Promise<string> = …')
    // `Promise` is a type.
    expect(findToken(toks, 'Promise')?.kind).toBe('type')
    // `string` should be a type (TYPES set), not stuck in JSX-tag mode.
    expect(findToken(toks, 'string')?.kind).toBe('type')
  })

  test('`<div>` (real JSX) still gets tag colouring', () => {
    const toks = tokenizeTs('return <div>hi</div>')
    expect(findToken(toks, 'div')?.kind).toBe('tag')
  })

  test('`foo<T, U>()` (comma in generic) detected as generic', () => {
    const toks = tokenizeTs('foo<T, U>()')
    expect(findToken(toks, 'T')?.kind).toBe('plain')
    expect(findToken(toks, 'U')?.kind).toBe('plain')
  })

  test('`a < b` (comparison) is NOT treated as generic OR JSX', () => {
    const toks = tokenizeTs('const x = a < b')
    // `b` should be `plain`, not `tag` or `tag-component`.
    expect(findToken(toks, 'b')?.kind).toBe('plain')
  })

  test('JSX close tag (`</div>`) is not mis-detected as a generic', () => {
    // Regression: the generic detection saw `<` preceded by `i`
    // (last char of "hi"), scanned forward, found `>` closing
    // `</div>`, and treated it as a generic — leaving `/div>` to
    // be tokenized as a regex. The fix bails on `</` early.
    const toks = tokenizeTs('return <div>hi</div>')
    // `</` should appear as a punct token.
    expect(toks.some((t) => t.kind === 'punct' && t.text === '</')).toBe(true)
    // No `regex` kind tokens should be present.
    expect(toks.find((t) => t.kind === 'regex')).toBeUndefined()
  })
})

describe('tokenizeJson — JSON-specific colouring', () => {
  test('object keys get attr kind, values get string kind', () => {
    const toks = tokenizeJson('{"name": "Ada", "age": 36}')
    // First string is a key (followed by `:`).
    const strings = toks.filter((t) => t.kind === 'string' || t.kind === 'attr')
    expect(strings[0]?.kind).toBe('attr')
    expect(strings[0]?.text).toBe('"name"')
    // Value next:
    expect(strings[1]?.kind).toBe('string')
    expect(strings[1]?.text).toBe('"Ada"')
  })

  test('booleans + null tokenize as keywords; numbers as number', () => {
    const toks = tokenizeJson('{"ok": true, "n": null, "v": 42}')
    expect(findToken(toks, 'true')?.kind).toBe('keyword')
    expect(findToken(toks, 'null')?.kind).toBe('keyword')
    expect(toks.find((t) => t.kind === 'number')?.text).toBe('42')
  })

  test('negative numbers + exponents', () => {
    const toks = tokenizeJson('{"x": -1.5e3}')
    const num = toks.find((t) => t.kind === 'number')
    expect(num?.text).toBe('-1.5e3')
  })

  test('JSON roundtrips byte-for-byte', () => {
    const json = '{"a": 1, "b": [true, null, "s"]}'
    const toks = tokenizeJson(json)
    expect(toks.map((t) => t.text).join('')).toBe(json)
  })
})

describe('tokenizeCss — CSS-specific colouring', () => {
  test('property name inside a block gets attr kind', () => {
    const toks = tokenizeCss('.foo { color: red; }')
    expect(findToken(toks, 'color')?.kind).toBe('attr')
  })

  test('@-rules tokenize as keywords', () => {
    const toks = tokenizeCss('@media (min-width: 600px) { ... }')
    expect(findToken(toks, '@media')?.kind).toBe('keyword')
  })

  test('CSS variables (--var-name) tokenize as attr', () => {
    const toks = tokenizeCss(':root { --color-bg: white; }')
    expect(findToken(toks, '--color-bg')?.kind).toBe('attr')
  })

  test('numbers + units kept as one token', () => {
    const toks = tokenizeCss('.x { padding: 1.5rem; width: 80%; }')
    const nums = toks.filter((t) => t.kind === 'number')
    expect(nums.map((t) => t.text)).toContain('1.5rem')
    expect(nums.map((t) => t.text)).toContain('80%')
  })

  test('CSS roundtrips byte-for-byte', () => {
    const css = '.foo { color: red; padding: 1rem; }'
    const toks = tokenizeCss(css)
    expect(toks.map((t) => t.text).join('')).toBe(css)
  })
})

describe('tokenizeHtml — HTML tag/attr colouring', () => {
  test('tag names get tag kind; attributes get attr kind', () => {
    const toks = tokenizeHtml('<div class="hero" id="main">text</div>')
    expect(findToken(toks, 'div')?.kind).toBe('tag')
    expect(findToken(toks, 'class')?.kind).toBe('attr')
    expect(findToken(toks, 'id')?.kind).toBe('attr')
    expect(toks.some((t) => t.kind === 'string' && t.text === '"hero"')).toBe(true)
  })

  test('comments and DOCTYPE colour separately', () => {
    const toks = tokenizeHtml('<!DOCTYPE html><!-- a comment --><p>x</p>')
    expect(toks[0]?.kind).toBe('keyword')
    expect(toks[1]?.kind).toBe('comment')
  })

  test('component-style tags (uppercase) keep tag-component kind', () => {
    const toks = tokenizeHtml('<Hero title="x" />')
    expect(findToken(toks, 'Hero')?.kind).toBe('tag-component')
  })

  test('HTML roundtrips byte-for-byte', () => {
    const html = '<div class="x">hello</div>'
    const toks = tokenizeHtml(html)
    expect(toks.map((t) => t.text).join('')).toBe(html)
  })
})

describe('tokenizePython — Python keyword/type colouring', () => {
  test('def/class/return/import are keywords', () => {
    const toks = tokenizePython('def foo(): return None')
    expect(findToken(toks, 'def')?.kind).toBe('keyword')
    expect(findToken(toks, 'return')?.kind).toBe('keyword')
    expect(findToken(toks, 'None')?.kind).toBe('keyword')
  })

  test('triple-quoted docstrings tokenize as a single string', () => {
    const toks = tokenizePython('def f():\n    """\n    Doc here.\n    """\n    pass')
    const strs = toks.filter((t) => t.kind === 'string')
    expect(strs[0]?.text).toContain('Doc here.')
  })

  test('built-in types colour as type', () => {
    const toks = tokenizePython('x: int = 1\ny: List = []')
    expect(findToken(toks, 'int')?.kind).toBe('type')
    expect(findToken(toks, 'List')?.kind).toBe('type')
  })

  test('decorators tokenize as @-prefixed identifier', () => {
    const toks = tokenizePython('@dataclass\nclass Foo: pass')
    expect(findToken(toks, '@dataclass')?.kind).toBe('tag-component')
  })

  test('Python roundtrips byte-for-byte', () => {
    const py = 'def fib(n: int) -> int:\n    if n < 2: return n\n    return fib(n-1) + fib(n-2)'
    const toks = tokenizePython(py)
    expect(toks.map((t) => t.text).join('')).toBe(py)
  })
})

// Silence the `kt` helper noise if not used in assertions yet.
void kt
