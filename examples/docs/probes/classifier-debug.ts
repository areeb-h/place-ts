// Probe: inspect what TypeScript types report for primitive uses
// inside an island source. Used to diagnose T8-E type-based classifier.
//
// Run from the docs project:
//   bun probes/classifier-debug.ts <island-name>
// e.g.
//   bun probes/classifier-debug.ts code-block

import { findConfigFile, sys } from 'typescript'
import * as ts from 'typescript'
import { resolve } from 'node:path'

const islandName = process.argv[2] ?? 'code-block'
const islandPath = resolve(
  import.meta.dir,
  '..',
  'src',
  'islands',
  `${islandName}.tsx`,
)

const configPath = findConfigFile(islandPath, sys.fileExists, 'tsconfig.json')
if (!configPath) {
  console.error('no tsconfig found from', islandPath)
  process.exit(1)
}
console.log('tsconfig:', configPath)

const configFile = ts.readConfigFile(configPath, sys.readFile)
const parsed = ts.parseJsonConfigFileContent(
  configFile.config,
  sys,
  configPath.replace(/\/[^/]+$/, ''),
)
console.log('files in program:', parsed.fileNames.length)
console.log('island path included?', parsed.fileNames.includes(islandPath))

const program = ts.createProgram({
  rootNames: parsed.fileNames,
  options: parsed.options,
})
const checker = program.getTypeChecker()

const sf = program.getSourceFile(islandPath)
if (!sf) {
  console.error('source file NOT in program:', islandPath)
  console.error('first few program files:')
  for (const f of program.getSourceFiles().slice(0, 5)) {
    console.error('  ', f.fileName)
  }
  process.exit(1)
}
console.log('source file loaded ok')

// Find every Identifier in the file and report its type's properties.
const seen = new Set<string>()
const visit = (node: ts.Node): void => {
  if (ts.isIdentifier(node)) {
    const name = node.text
    if (
      (name === 'state' ||
        name === 'derived' ||
        name === 'onMount' ||
        name === 'watch' ||
        name === 'cookieState') &&
      !seen.has(name)
    ) {
      seen.add(name)
      const t = checker.getTypeAtLocation(node)
      console.log(`\n${name} (identifier at line ${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}):`)
      console.log('  type:', checker.typeToString(t))
      const props = t.getProperties()
      console.log('  property count:', props.length)
      const effectProp = t.getProperty('__effect')
      if (effectProp) {
        const propType = checker.getTypeOfSymbolAtLocation(effectProp, node)
        console.log('  __effect FOUND, type:', checker.typeToString(propType))
        if (propType.isStringLiteral()) {
          console.log('  __effect literal value:', propType.value)
        }
      } else {
        console.log('  __effect: NOT FOUND on identifier type')
      }
    }
  }
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const callee = node.expression.text
    if (
      (callee === 'state' || callee === 'derived' || callee === 'cookieState') &&
      !seen.has(`${callee}()`)
    ) {
      seen.add(`${callee}()`)
      const t = checker.getTypeAtLocation(node)
      console.log(`\n${callee}() (call at line ${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}):`)
      console.log('  return type:', checker.typeToString(t))
      const effectProp = t.getProperty('__effect')
      if (effectProp) {
        const propType = checker.getTypeOfSymbolAtLocation(effectProp, node)
        console.log('  __effect FOUND on return, type:', checker.typeToString(propType))
        if (propType.isStringLiteral()) {
          console.log('  __effect literal value:', propType.value)
        }
      } else {
        console.log('  __effect: NOT FOUND on return type')
      }
    }
  }
  ts.forEachChild(node, visit)
}
ts.forEachChild(sf, visit)
