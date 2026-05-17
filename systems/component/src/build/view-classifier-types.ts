// Type-based view classifier (T8-E; ADR 0030).
//
// Reads `EffectBranded<E>` brands off TypeScript's inferred types for
// every expression inside an `island(import.meta.url, fn)` body. This
// supersedes the Tier 8-D name-match prototype's three known
// problem classes:
//
//   1. **Aliased imports** — `import { state as s } from '@place/component'`.
//      The name-match scanner looks for the literal `state` identifier,
//      so the aliased reference slips through. Type-based inspection
//      reads the *resolved symbol's type*, so the alias doesn't matter.
//
//   2. **Cap-method reads** — `router.path()` where `router.path` is
//      `State<string>`. Name-match has no entry for `path` (it's a
//      cap field, not a framework primitive). Type-based inspection
//      sees the `State<T>` shape on the member access expression and
//      picks up its `'state'` brand.
//
//   3. **False positives in comments / strings** — name-match's
//      whole-word regex flagged `state` mentioned in a JSDoc comment
//      as a real reference (observed on `code-block.tsx`: docstring
//      says "the reactive `copied` state", which the regex counted
//      as one `state` reference and promoted the island to L1 thaw
//      incorrectly). Type-based traversal only visits real AST nodes;
//      string-literal and comment contents are invisible.
//
// **Cross-file impl resolution.** Most islands declare their impl as
// a named variable, often imported from another file:
//
//   import { Counter as Impl } from '../components/counter.tsx'
//   export default island(import.meta.url, Impl)
//
// `resolveImplBody` chases the identifier through TypeScript's symbol
// resolution + alias resolution to find the actual function body.
// The walk runs on the impl body wherever it lives — the source file
// boundary is invisible to the classifier.
//
// **Identifier naming in the report.** The findings cite the *binding
// name* of the branded value, not the primitive name. `const copied =
// state(false)` reports `copied` (3 refs) rather than `state` (1 ref).
// This is the "magic with clarity" payoff: the dev's variable names
// surface in the report, so they can locate the reactive cell at a
// glance without re-reading the island.
//
// **Structural soundness:** every effect-producing primitive is
// branded at the declaration site (`State<T> & EffectBranded<'state'>`,
// `Disposer = ... & EffectBranded<'lifecycle'>`, etc.). The brand IS
// the contract. The classifier no longer projects through an
// out-of-band table; the projection is the type system itself.
//
// **Performance:** the classifier creates ONE `ts.Program` per build
// pass (cached on the bundler's result), parses each island source
// once, and walks the impl-function body. On the docs site (11
// islands, ~10K LOC), the typed pass adds <1 s to a cold build.

import * as ts from 'typescript'
import type * as TS from 'typescript'
import type { Effect, ViewLevel } from '@place/reactivity/effects'
import { levelOf, lubEffect } from '@place/reactivity/effects'
import type {
  ClassifierFinding,
  ClassifierResult,
} from './view-classifier.ts'
import { classifyIslandSource } from './view-classifier.ts'

// `typescript` is statically imported above. This file is reachable
// only from server-side code paths (`_serveImpl` → island-bundler →
// here) — per-island wrappers import from `./_client-mount.ts`, which
// stops the static graph well before reaching `./build/*`. The earlier
// `loadTs()` indirection was dead theatre: the static `findConfigFile`
// import on the same line as the lazy-load already pulled the module,
// and the file isn't in any browser-targeted bundle's graph anyway.
const { findConfigFile, sys } = ts

/**
 * Cached typed classifier context. One program per build pass — the
 * bundler creates this once and reuses it across every island in the
 * pass. Programs are heavy (parses the whole source tree); reusing the
 * instance is the difference between sub-second and multi-second
 * classifier overhead on real apps.
 */
export interface TypedClassifierContext {
  readonly ts: typeof import('typescript')
  readonly program: TS.Program
  readonly checker: TS.TypeChecker
  /** Project root used to resolve relative paths in diagnostics. */
  readonly projectRoot: string
}

/**
 * Locate and load the tsconfig nearest the given source path, then
 * build a `ts.Program` that includes every TS file the tsconfig
 * references. Returns null if no tsconfig is found — the caller falls
 * back to the name-match classifier.
 *
 * **Cache key:** the bundler passes the entries directory's parent
 * (project root). One context per project per build pass; the
 * bundler-level cache lives in `island-bundler.ts`.
 */
export async function createTypedClassifierContext(
  hintPath: string,
): Promise<TypedClassifierContext | null> {
  const configPath = findConfigFile(hintPath, sys.fileExists, 'tsconfig.json')
  if (!configPath) return null

  const configFile = ts.readConfigFile(configPath, sys.readFile)
  if (configFile.error) return null

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    sys,
    configPath.replace(/\/[^/]+$/, ''),
  )
  if (parsed.errors.length > 0) {
    // tsconfig has errors — still try to build the program; type info
    // may be partial but better than nothing.
  }

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  })
  const checker = program.getTypeChecker()
  return {
    ts,
    program,
    checker,
    projectRoot: configPath.replace(/\/[^/]+$/, ''),
  }
}

/**
 * Classify an island by reading TypeScript-inferred types from its
 * source file. Falls back to the name-match classifier if the source
 * file isn't in the program (e.g. a virtual module, or a path the
 * tsconfig doesn't include).
 *
 * The walk is scoped to the second argument of the `island(...)` call
 * — the impl function. Identifiers and member accesses inside the
 * impl body are typed; anything outside (other declarations in the
 * same file, top-level imports) is ignored.
 */
export function classifyIslandWithTypes(
  srcPath: string,
  fallbackSource: string,
  ctx: TypedClassifierContext,
): ClassifierResult {
  const { ts, program, checker } = ctx
  const sourceFile = program.getSourceFile(srcPath)
  if (!sourceFile) {
    // Source isn't in the program — fall back to name-match. This
    // happens for paths the tsconfig excludes (e.g. node_modules
    // shadows, generated files outside the include glob).
    return classifyIslandSource(fallbackSource)
  }

  const islandCall = findIslandCallExpression(ts, sourceFile)
  if (!islandCall) {
    // No `island(...)` call found — treat as static. The bundler only
    // sends paths it registered as island sources, so this shouldn't
    // happen in practice; fall back conservatively.
    return classifyIslandSource(fallbackSource)
  }

  // The second argument is the impl function — but it's almost
  // always a *reference* to a named declaration rather than an inline
  // arrow. Authors write:
  //
  //   const Counter = (props) => { ... }
  //   export default island(import.meta.url, Counter)
  //
  // so the call's second arg is the bare identifier `Counter`. We
  // resolve the identifier to its declaration and walk the function
  // body it initializes. For inline arrows (`island(url, (p) => …)`)
  // we walk the arrow directly. Imported impls (`import { Counter } from …`)
  // also resolve correctly — the symbol's declaration is in the other
  // file, which is in the same Program.
  const rawImplArg = islandCall.arguments[1]
  if (!rawImplArg) return classifyIslandSource(fallbackSource)
  const implArg = resolveImplBody(ts, checker, rawImplArg)
  if (!implArg) {
    // Couldn't reach the function body. Fall back rather than
    // misreport everything as static.
    return classifyIslandSource(fallbackSource)
  }

  const effects = new Set<Effect>()
  const counts = new Map<string, { effect: Effect; count: number }>()

  const recordEffect = (effect: Effect, identifier: string): void => {
    effects.add(effect)
    const existing = counts.get(identifier)
    if (existing) existing.count += 1
    else counts.set(identifier, { effect, count: 1 })
  }

  // Walk every descendant of the impl-function body. For each
  // expression-bearing node, ask the checker for its type and look
  // for the `__effect` brand. The original node IS the resolution
  // location — passing it as the `location` argument to
  // `getTypeOfSymbolAtLocation` is what makes generic substitution
  // work (so `State<T> & EffectBranded<'state'>` resolves the brand
  // property to the literal `'state'`, not the parameter `E`).
  const visit = (node: TS.Node): void => {
    if (ts.isIdentifier(node) && !isDeclarationName(ts, node)) {
      const t = checker.getTypeAtLocation(node)
      const effect = extractEffectFromType(t, checker, node)
      if (effect) recordEffect(effect, node.text)
    } else if (ts.isPropertyAccessExpression(node)) {
      const t = checker.getTypeAtLocation(node)
      const effect = extractEffectFromType(t, checker, node)
      if (effect) recordEffect(effect, node.name.text)
    } else if (ts.isCallExpression(node)) {
      const t = checker.getTypeAtLocation(node)
      const effect = extractEffectFromType(t, checker, node)
      if (effect) {
        const calleeName = getCalleeName(ts, node)
        recordEffect(effect, calleeName ?? '<call>')
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(implArg, visit)

  const level = levelOf(effects)
  const findings: ClassifierFinding[] = []
  for (const [identifier, { effect, count }] of counts) {
    findings.push({ effect, identifier, count })
  }
  findings.sort((a, b) => b.count - a.count)
  const reason = explainLevel(level, findings)

  return { level, effects, findings, reason }
}

/**
 * Pull the `__effect` brand off a type. Returns the literal Effect
 * value or null if the type isn't EffectBranded.
 *
 * EffectBranded<E> is declared as `{ readonly __effect?: E }`. After
 * generic instantiation at the location, the property's type narrows
 * from the parameter `E` to the literal (`'state'`, `'lifecycle'`,
 * ...). Passing the original expression node as `location` is what
 * triggers that substitution — without it the checker returns the
 * unsubstituted parameter and the brand reads as null.
 *
 * Unions of literals (rare; would only happen if a primitive's
 * return narrows to multiple kinds) get reduced via `lubEffect`.
 */
function extractEffectFromType(
  type: TS.Type,
  checker: TS.TypeChecker,
  location: TS.Node,
): Effect | null {
  const prop = type.getProperty('__effect')
  if (!prop) return null
  const propType = checker.getTypeOfSymbolAtLocation(prop, location)
  return readEffectLiteral(propType)
}

function readEffectLiteral(t: TS.Type): Effect | null {
  // String literal type: `__effect?: 'state'` — `.value` is `'state'`.
  if (t.isStringLiteral()) {
    return t.value as Effect
  }
  // Union of string literals: take the lub. The brand's declared type
  // is single-valued in practice (`EffectBranded<'state'>`), so this
  // branch is defensive.
  if (t.isUnion()) {
    let acc: Effect | null = null
    for (const sub of t.types) {
      if (sub.isStringLiteral()) {
        const e = sub.value as Effect
        acc = acc === null ? e : lubEffect(acc, e)
      }
    }
    return acc
  }
  return null
}

/**
 * Resolve the second argument of `island(url, impl)` to a function-
 * shaped node we can walk. Three cases:
 *
 *   1. Inline arrow / function expression — return the arrow itself.
 *   2. Identifier referencing a local `const X = (props) => …` — resolve
 *      the symbol, return the arrow from the variable's initializer.
 *   3. Identifier referencing an imported binding — follow through
 *      `getAliasedSymbol` to the original declaration in the other
 *      file, then return its initializer / body.
 *
 * Returns null if none of those shapes match — caller falls back to
 * the name-match classifier rather than reporting empty effects.
 */
function resolveImplBody(
  ts: typeof import('typescript'),
  checker: TS.TypeChecker,
  arg: TS.Expression,
): TS.Node | null {
  // Case 1: inline arrow / function expression.
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
    return arg
  }
  // Case 2/3: identifier — resolve the symbol and chase to its
  // declaration.
  if (ts.isIdentifier(arg)) {
    let symbol = checker.getSymbolAtLocation(arg)
    if (!symbol) return null
    // Aliased imports: chase the alias one hop to the original
    // declaration's symbol. `getAliasedSymbol` throws if the symbol
    // isn't an alias; gate on the flag check.
    if (symbol.flags & ts.SymbolFlags.Alias) {
      try {
        symbol = checker.getAliasedSymbol(symbol)
      } catch {
        // not actually an alias; keep the original symbol
      }
    }
    const decl = symbol.valueDeclaration ?? symbol.declarations?.[0]
    if (!decl) return null
    if (ts.isVariableDeclaration(decl) && decl.initializer) {
      if (
        ts.isArrowFunction(decl.initializer) ||
        ts.isFunctionExpression(decl.initializer)
      ) {
        return decl.initializer
      }
      // Could be `const X = otherIdentifier` — recurse one level.
      if (ts.isIdentifier(decl.initializer)) {
        return resolveImplBody(ts, checker, decl.initializer)
      }
    }
    if (ts.isFunctionDeclaration(decl)) {
      return decl
    }
  }
  return null
}

/**
 * Walk the source file's top-level statements to find the
 * `island(import.meta.url, fn)` call. Supports both:
 *
 *   export default island(import.meta.url, () => …)
 *   const X = island(import.meta.url, () => …); export default X
 *
 * Returns the call expression node or null.
 */
function findIslandCallExpression(
  ts: typeof import('typescript'),
  sourceFile: TS.SourceFile,
): TS.CallExpression | null {
  let result: TS.CallExpression | null = null
  const visit = (node: TS.Node): void => {
    if (result) return
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'island' &&
      node.arguments.length >= 2
    ) {
      result = node
      return
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)
  return result
}

/**
 * The callee identifier name for a CallExpression, used as the
 * report's identifier when a return-type brand is detected.
 */
function getCalleeName(
  ts: typeof import('typescript'),
  call: TS.CallExpression,
): string | null {
  const e = call.expression
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) return e.name.text
  return null
}

/**
 * Filter out identifier nodes that appear in declaration position
 * (e.g. `const onMount = ...`) — we want references, not declarations.
 */
function isDeclarationName(
  ts: typeof import('typescript'),
  node: TS.Identifier,
): boolean {
  const parent = node.parent
  if (!parent) return false
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true
  if (ts.isParameter(parent) && parent.name === node) return true
  if (ts.isBindingElement(parent) && parent.name === node) return true
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return true
  if (ts.isImportSpecifier(parent) && parent.name === node) return true
  if (ts.isImportClause(parent) && parent.name === node) return true
  return false
}

/**
 * Same shape as the name-match classifier's reason field — keep
 * formatting identical so report rows render uniformly regardless of
 * which classifier produced the entry.
 */
function explainLevel(level: ViewLevel, findings: readonly ClassifierFinding[]): string {
  if (level === 'static') return 'no effects beyond pure'
  if (level === 'thaw') {
    const f = findings.find((x) => x.effect === 'state')
    return f
      ? `state-only — \`${f.identifier}\` (${f.count} ref${f.count === 1 ? '' : 's'})`
      : 'state-only'
  }
  const promoter = findings.find(
    (x) =>
      x.effect === 'lifecycle' ||
      x.effect === 'timer' ||
      x.effect === 'io' ||
      x.effect === 'dom',
  )
  const suspense = findings.find((x) => x.effect === 'suspense')
  if (level === 'island+stream') {
    return `\`${promoter?.identifier ?? '?'}\` (${promoter?.effect}) + \`${suspense?.identifier ?? 'Suspense'}\` (suspense)`
  }
  return `\`${promoter?.identifier ?? '?'}\` (${promoter?.effect})`
}
