// `placeAutoImport()` — Bun plugin that auto-injects imports for the
// framework's primitives.
//
// Goal: a docs page or component file can reference `Tabs`, `Activity`,
// `state`, `cookieState`, `onMount`, etc. without ever writing an
// `import { … } from '@place-ts/component'` line. The plugin scans each
// file at load time and prepends only the imports that file actually
// needs (and doesn't already have).
//
// Why a registry + regex instead of an AST:
//   - The registry is finite and stable: the framework's own exports.
//     User components stay explicit (so grep + code review still work
//     as expected).
//   - Regex with sensible scope-detection covers the common cases —
//     existing imports, top-level declarations — fast enough to run on
//     every file load. False-positive risk (e.g. a user-defined local
//     named `state` would shadow the auto-import) is documented and
//     remediable per-file by adding the explicit import. An AST-based
//     v1 can swap in later without changing the public API.
//
// Why Bun-plugin and not just a TS declaration:
//   - The IDE's TypeScript pulls types from an ambient `.d.ts`; the
//     bundler still needs the actual `import` statement. The plugin
//     emits the runtime import; the `.d.ts` (see `auto-imports.d.ts`)
//     wires up the type-side counterpart.

import type { BunPlugin } from 'bun'

/** Map of identifier name → module that exports it. */
export type AutoImportRegistry = Readonly<Record<string, string>>

/**
 * Default registry — framework primitives from `@place-ts/component`. Each
 * entry says "if this name is referenced in a file but not in scope,
 * add the import." Append project-level entries via the `extras`
 * parameter to `placeAutoImport()`.
 */
export const PLACE_AUTO_IMPORTS: AutoImportRegistry = {
  // ----- Reactivity -----
  state: '@place-ts/component',
  watch: '@place-ts/component',
  derived: '@place-ts/component',
  untrack: '@place-ts/component',
  // ----- Lifecycle -----
  onMount: '@place-ts/component',
  onCleanup: '@place-ts/component',
  // ----- Cookies + persistence -----
  cookie: '@place-ts/component',
  cookieState: '@place-ts/component',
  // ----- Components -----
  island: '@place-ts/component',
  view: '@place-ts/component',
  Tab: '@place-ts/component',
  Tabs: '@place-ts/component',
  tabsState: '@place-ts/component',
  Activity: '@place-ts/component',
  Show: '@place-ts/component',
  Fragment: '@place-ts/component',
  // ----- Routing + top-level factories -----
  // Every app uses these in nearly every file. Auto-imported so pages
  // and layouts can start with `export default page(...)` / `export
  // const layout = layout(...)` with no boilerplate import line.
  page: '@place-ts/component',
  layout: '@place-ts/component',
  Link: '@place-ts/component',
  Form: '@place-ts/component',
  // ----- Theme -----
  setTheme: '@place-ts/component',
  themeTokens: '@place-ts/component',
}

/**
 * Bun.build / Bun.plugin compatible plugin factory. Wire it in via:
 *
 *   // bunfig.toml
 *   preload = ["@place-ts/component/preload"]
 *
 * (the preload module calls `Bun.plugin(placeAutoImport())` so the
 * transform runs for every file loaded thereafter, including pages
 * and components imported at the top of `app.ts`)
 *
 * Or directly inside a custom `Bun.build({ plugins: [...] })` call.
 */
export function placeAutoImport(extras: AutoImportRegistry = {}): BunPlugin {
  const registry: Record<string, string> = { ...PLACE_AUTO_IMPORTS, ...extras }
  return {
    name: 'place-auto-import',
    setup(build) {
      // Scope the filter to `.tsx` / `.jsx` files OUTSIDE node_modules.
      // The negative-lookahead keeps Bun's default loader in charge of
      // every vendored module — important because Bun.plugin's onLoad
      // is an alternative loader (no fall-through), and forcing the
      // `js` loader on CJS-shaped vendored modules (e.g. lightningcss)
      // breaks their re-export shape. User code lives in `.tsx`/`.jsx`
      // files, so narrowing the filter loses nothing.
      build.onLoad({ filter: /^(?!.*\/node_modules\/).*\.[tj]sx$/ }, async (args) => {
        const source = await Bun.file(args.path).text()
        const loader: 'tsx' | 'jsx' = args.path.endsWith('.jsx') ? 'jsx' : 'tsx'
        // Skip framework own source (under any /systems/ directory) —
        // the framework manages its imports explicitly.
        if (args.path.includes('/systems/')) return { contents: source, loader }
        const transformed = autoImportTransform(source, registry)
        return { contents: transformed, loader }
      })
    },
  }
}

/**
 * Pure transform: given source text and a registry, return the source
 * with missing imports prepended. Idempotent — calling twice yields
 * the same output. Exported for unit-testing without spinning up
 * `Bun.build`.
 */
export function autoImportTransform(
  source: string,
  registry: Readonly<Record<string, string>>,
): string {
  // Comments and strings can contain identifiers that look like
  // references but aren't real ones. Mask them with whitespace so the
  // identifier scan only sees real code positions. Newlines preserved
  // so line-anchored regexes (top-level declarations) still work.
  const scannable = maskCommentsAndStrings(source)
  const { inScope, alreadyImported } = collectInScopeAndImportedNames(scannable)
  // Build the missing-import set, grouped by source module so each
  // module gets exactly one import line with sorted names.
  const grouped: Map<string, Set<string>> = new Map()
  for (const ident of Object.keys(registry)) {
    // Skip if the name is in scope OR was already named in any import
    // (e.g., `import { state as foo } from 'x'` — the user explicitly
    // chose to alias `state`; don't override their intent).
    if (inScope.has(ident) || alreadyImported.has(ident)) continue
    // Word-boundary match — ensures `state` doesn't match `pageState` etc.
    const re = new RegExp(`\\b${escapeRegExp(ident)}\\b`)
    if (!re.test(scannable)) continue
    const mod = registry[ident]
    if (mod === undefined) continue
    const set = grouped.get(mod) ?? new Set<string>()
    set.add(ident)
    grouped.set(mod, set)
  }
  // `island(fn)` / `view(fn)` sugar → `<ident>(import.meta.url, fn)`.
  // The single-arg form is the right author shape — `import.meta.url`
  // is pure boilerplate the framework needs but the user doesn't care
  // about. The transform runs after scope analysis so we only rewrite
  // when `island` / `view` actually resolve to the framework's
  // primitive (in-scope or about-to-be-auto-imported); user-defined
  // locals with the same name are left alone.
  let transformed = source
  for (const ident of ['island', 'view'] as const) {
    const isFrameworkRef =
      alreadyImported.has(ident) ||
      inScope.has(ident) ||
      (grouped.get('@place-ts/component')?.has(ident) ?? false) ||
      new RegExp(`\\b${ident}\\b`).test(scannable)
    if (!isFrameworkRef) continue
    transformed = injectFactorySrcUrlArg(transformed, ident)
    // The transform also needs the identifier in scope — promote it
    // into the grouped imports if it isn't already. (User-explicit
    // imports stay unchanged; this only matters for the auto-import
    // case.)
    if (
      !alreadyImported.has(ident) &&
      !inScope.has(ident) &&
      new RegExp(`\\b${ident}\\b`).test(scannable)
    ) {
      const set = grouped.get('@place-ts/component') ?? new Set<string>()
      set.add(ident)
      grouped.set('@place-ts/component', set)
    }
  }
  if (grouped.size === 0) return transformed
  const importLines: string[] = []
  for (const [mod, names] of grouped) {
    const sorted = [...names].sort()
    importLines.push(`import { ${sorted.join(', ')} } from '${mod}'`)
  }
  return `${importLines.join('\n')}\n${transformed}`
}

/**
 * Rewrite `<ident>(<args>)` → `<ident>(import.meta.url, <args>)` when
 * the first argument isn't already a srcUrl (a literal string or
 * `import.meta.url`). Used for both `island(...)` and `view(...)`
 * (the latter being the public successor per ADR 0030).
 *
 * **Cases handled** (idempotent — second pass is a no-op):
 *   - `island(fn)`               → `island(import.meta.url, fn)`
 *   - `island(fn, opts)`         → `island(import.meta.url, fn, opts)`
 *   - `island(import.meta.url, fn)` — already correct; left alone.
 *   - `island(import.meta.url, fn, opts)` — already correct; left alone.
 *   - `island("…", fn)` / `island('…', fn)` — explicit srcUrl; left alone.
 *   - `island()` — zero args; let TypeScript flag it.
 *   - Identifier `island` inside strings/comments — `maskCommentsAndStrings`
 *     replaces those with placeholders before scanning, so we never
 *     match inside JSDoc, string literals, or template literals.
 *   - Same set, mirrored for `view`.
 *
 * **Implementation:** balanced-paren state machine — JS regex can't
 * do recursive balance, and ANY parenthesized expression inside the
 * argument (e.g. `island((p) => <Foo/>)`) would defeat a naive
 * `[^)]+`. We walk the call's args, find depth-1 commas to identify
 * the first arg, and check whether it looks like a srcUrl to decide
 * if injection is needed.
 */
function injectFactorySrcUrlArg(source: string, identName: 'island' | 'view'): string {
  const scannable = maskCommentsAndStrings(source)
  // Find every <identName> IDENTIFIER position. Walk forward through
  // optional generic type args (`<...>`) and whitespace to find the
  // opening paren. Generic args can be nested one level deep — common
  // patterns like `island<Props & Record<string, unknown>>(impl)`.
  // Anything more complex falls through (caller writes the explicit
  // two-arg form).
  const out: string[] = []
  let cursor = 0
  const idRe = new RegExp(`\\b${identName}\\b`, 'g')
  let m: RegExpExecArray | null = null
  // biome-ignore lint/suspicious/noAssignInExpressions: canonical regex.exec loop pattern
  while ((m = idRe.exec(scannable)) !== null) {
    const idEnd = m.index + m[0].length
    let i = idEnd
    // Skip whitespace.
    while (i < scannable.length && /\s/.test(scannable.charAt(i))) i += 1
    // Optional generic type arguments. Walk a balanced `<...>` block.
    if (scannable.charAt(i) === '<') {
      let gDepth = 1
      i += 1
      while (i < scannable.length && gDepth > 0) {
        const ch = scannable.charAt(i)
        if (ch === '<') gDepth += 1
        else if (ch === '>') gDepth -= 1
        i += 1
      }
      if (gDepth !== 0) {
        // Unbalanced generics — likely not a real call. Keep scanning.
        idRe.lastIndex = idEnd
        continue
      }
      // Skip whitespace between generics close and the open paren.
      while (i < scannable.length && /\s/.test(scannable.charAt(i))) i += 1
    }
    if (scannable.charAt(i) !== '(') {
      // Not a call — keep scanning (could be `const island = …` etc.).
      idRe.lastIndex = idEnd
      continue
    }
    const openParen = i
    // Walk balanced parens, counting top-level commas.
    let depth = 1
    let j = openParen + 1
    let commaAtDepthOne = -1
    while (j < scannable.length && depth > 0) {
      const ch = scannable.charAt(j)
      if (ch === '(') depth += 1
      else if (ch === ')') {
        depth -= 1
        if (depth === 0) break
      } else if (ch === ',' && depth === 1 && commaAtDepthOne === -1) {
        commaAtDepthOne = j
      }
      j += 1
    }
    if (depth !== 0) {
      out.push(source.slice(cursor))
      cursor = source.length
      break
    }
    const closeParen = j
    // Identify the first argument's text. For a single-arg call, that
    // spans openParen+1 to closeParen. For a multi-arg call, it
    // spans openParen+1 to the first depth-1 comma.
    const firstArgEnd = commaAtDepthOne === -1 ? closeParen : commaAtDepthOne
    const firstArg = source.slice(openParen + 1, firstArgEnd).trim()
    if (firstArg.length === 0) {
      // Zero-arg call. Let TypeScript flag the error.
      idRe.lastIndex = closeParen + 1
      continue
    }
    // Already-transformed: first arg is the srcUrl. Skip.
    const alreadyHasSrc =
      firstArg === 'import.meta.url' ||
      /^(['"`]).*\1$/.test(firstArg) ||
      firstArg.startsWith('import.meta.')
    if (alreadyHasSrc) {
      idRe.lastIndex = closeParen + 1
      continue
    }
    // Inject `import.meta.url, ` before the first arg. The rest of
    // the args (if any) flows through unchanged — `island(fn, opts)`
    // becomes `island(import.meta.url, fn, opts)`.
    out.push(source.slice(cursor, openParen + 1))
    out.push('import.meta.url, ')
    out.push(source.slice(openParen + 1, closeParen + 1))
    cursor = closeParen + 1
    idRe.lastIndex = closeParen + 1
  }
  out.push(source.slice(cursor))
  return out.join('')
}

/**
 * Collect identifiers already in scope at the top level of the file:
 *   - Named imports (`import { foo, bar as baz } from 'x'`) — local
 *     name in `inScope`, SOURCE name in `alreadyImported`. The split
 *     matters for the renamed case: `import { state as makeState }`
 *     puts `makeState` in scope; `state` is NOT in scope, but it IS
 *     already imported (the user aliased it deliberately, so we
 *     shouldn't add a second import for the same source name).
 *   - Default imports (`import Foo from 'x'`)
 *   - Namespace imports (`import * as Foo from 'x'`)
 *   - Top-level `const`/`let`/`var`/`function`/`class`/`type`/`interface`
 *
 * Best-effort: function parameters, destructured `const { a, b } = …`,
 * and nested-scope locals are NOT tracked. A user who locally shadows a
 * framework name should add the explicit import to opt out — same
 * answer as Vue's unplugin-vue-components.
 */
function collectInScopeAndImportedNames(scannable: string): {
  inScope: Set<string>
  alreadyImported: Set<string>
} {
  const inScope = new Set<string>()
  const alreadyImported = new Set<string>()
  // Named imports — including `type` modifiers.
  for (const m of scannable.matchAll(/import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g)) {
    for (const item of (m[1] ?? '').split(',')) {
      const cleaned = item.trim().replace(/^type\s+/, '')
      const parts = cleaned.split(/\s+as\s+/)
      const original = parts[0]?.trim()
      const local = parts[parts.length - 1]?.trim()
      if (original) alreadyImported.add(original)
      if (local) inScope.add(local)
    }
  }
  // Default imports (`import Foo from 'x'`).
  for (const m of scannable.matchAll(/import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s+from/g)) {
    if (m[1]) inScope.add(m[1])
  }
  // Namespace imports (`import * as Foo from 'x'`).
  for (const m of scannable.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from/g)) {
    if (m[1]) inScope.add(m[1])
  }
  // Top-level declarations. Restrict to "line-starting" positions to
  // avoid catching property accessors etc. The pattern matches an
  // optional `export`, then a binder keyword, then an identifier.
  for (const m of scannable.matchAll(
    /(?:^|[\n;])\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    if (m[1]) inScope.add(m[1])
  }
  return { inScope, alreadyImported }
}

function maskCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/'(?:[^'\\\n]|\\.)*'/g, (m) => `'${' '.repeat(m.length - 2)}'`)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => `"${' '.repeat(m.length - 2)}"`)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
