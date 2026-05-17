// Tests for the type-based view classifier (T8-E).
//
// We exercise the classifier against tiny synthetic island sources
// rather than the docs site so the unit test stays fast (creates a
// program over just a few files) and structural (locked to the
// EffectBranded contract, not to specific identifiers in real apps).

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

import {
  classifyIslandWithTypes,
  createTypedClassifierContext,
} from '../../src/build/view-classifier-types.ts'

// Locate the repo root so the tsconfig's `paths` resolve against the
// real `@place/*` workspace packages. We resolve from this test file's
// import URL.
const repoRoot = new URL('../../../..', import.meta.url).pathname

// One tmp dir per test — necessary because `createTypedClassifierContext`
// snapshots the file list from disk at program-construction time.
// Writing additional fixture files into the same directory after the
// program is built leaves them invisible to subsequent classifications
// (silent fall-through to name-match, false test pass). Isolation per
// test fixes that structurally.
const dirs: string[] = []

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const TSCONFIG = {
  compilerOptions: {
    target: 'ESNext',
    module: 'ESNext',
    moduleResolution: 'bundler',
    jsx: 'react-jsx',
    jsxImportSource: '@place/component',
    strict: true,
    lib: ['ESNext', 'DOM'],
    types: [],
    paths: {
      '@place/reactivity': [`${repoRoot}/systems/reactivity/src/index.ts`],
      '@place/component': [`${repoRoot}/systems/component/src/index.ts`],
      '@place/component/jsx-runtime': [
        `${repoRoot}/systems/component/src/jsx-runtime.ts`,
      ],
      '@place/capability': [`${repoRoot}/systems/capability/src/index.ts`],
    },
  },
  include: ['*.tsx', '*.ts'],
}

async function classifyFixture(filename: string, source: string) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'place-classifier-'))
  dirs.push(tmpDir)
  writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify(TSCONFIG))
  const path = join(tmpDir, filename)
  writeFileSync(path, source)
  const ctx = await createTypedClassifierContext(path)
  if (!ctx) throw new Error('classifier context could not be created')
  return classifyIslandWithTypes(path, source, ctx)
}

describe('classifyIslandWithTypes', () => {
  test('static: an island body with no effect-branded references', async () => {
    const result = await classifyFixture(
      'pure.tsx',
      `
        import { island } from '@place/component'
        const Pure = (props: { label: string }) => <div>{props.label}</div>
        export default island(import.meta.url, Pure)
      `,
    )
    expect(result.level).toBe('static')
    expect([...result.effects]).toEqual([])
  })

  test('thaw: a state-only island body', async () => {
    const result = await classifyFixture(
      'counter.tsx',
      `
        import { island, state } from '@place/component'
        const Counter = () => {
          const n = state(0)
          return <button onClick={() => n.set(n() + 1)}>{n}</button>
        }
        export default island(import.meta.url, Counter)
      `,
    )
    expect(result.level).toBe('thaw')
    expect(result.effects.has('state')).toBe(true)
  })

  test('island: state + lifecycle (onMount) promotes past thaw', async () => {
    const result = await classifyFixture(
      'lifecycle.tsx',
      `
        import { island, state, onMount } from '@place/component'
        const Hooked = () => {
          const n = state(0)
          onMount(() => { /* side effect */ })
          return <div>{n}</div>
        }
        export default island(import.meta.url, Hooked)
      `,
    )
    expect(result.level).toBe('island')
    expect(result.effects.has('lifecycle')).toBe(true)
  })

  test('aliased imports — name-match would miss; type-based catches', async () => {
    const result = await classifyFixture(
      'aliased.tsx',
      `
        import { island, state as makeSignal } from '@place/component'
        const X = () => {
          const n = makeSignal(0)
          return <div>{n}</div>
        }
        export default island(import.meta.url, X)
      `,
    )
    expect(result.level).toBe('thaw')
    expect(result.effects.has('state')).toBe(true)
  })

  test('comments/strings mentioning primitive names produce no false positive', async () => {
    const result = await classifyFixture(
      'commented.tsx',
      `
        import { island } from '@place/component'
        // This island has no state, no onMount, no watch — just the word "state"
        // appearing in this docstring three times. The name-match prototype
        // counted such mentions as references; the typed classifier does not.
        const Doc = () => <p>describes state semantics</p>
        export default island(import.meta.url, Doc)
      `,
    )
    expect(result.level).toBe('static')
    expect([...result.effects]).toEqual([])
  })

  test('report identifier is the binding name when referenced multiple times', async () => {
    // When a State binding is read N times in the body, it accumulates
    // N findings under its variable name. The primitive identifier
    // (`state`) shows up only once — at the construction site. With
    // `findings` sorted by ref-count, the binding name surfaces ahead
    // of the primitive when it's used more than once, which is the
    // common case in real islands. This is the "magic with clarity"
    // payoff: `copied (3 refs)` beats `state (1 ref)` in the report.
    const result = await classifyFixture(
      'naming.tsx',
      `
        import { island, state } from '@place/component'
        const Hello = () => {
          const greeting = state('hi')
          return (
            <button onClick={() => greeting.set('bye')}>
              {greeting} - {greeting()}
            </button>
          )
        }
        export default island(import.meta.url, Hello)
      `,
    )
    // Both findings appear; the binding name beats the primitive name
    // because it has more references in the body.
    const top = result.findings.find((f) => f.effect === 'state')
    expect(top?.identifier).toBe('greeting')
    expect(result.findings.some((f) => f.identifier === 'state')).toBe(true)
  })
})
