// @vitest-environment node

import { describe, expect, test } from 'vitest'
import { frameEditorHref, parseStackFrames } from '../../src/index.ts'

// Stack-frame parser unit tests. The dev error overlay needs to convert
// a runtime-shaped err.stack string into structured frames so it can
// classify (user/framework) and link to the editor. Bun's runtime maps
// bundled positions back to source paths automatically, so the parser
// only handles the standard V8/Firefox formats — both stable contracts
// across runtime versions.

describe('parseStackFrames — V8 named, V8 anonymous, Firefox formats', () => {
  test('parses V8 named frame with file:// URL', () => {
    const stack = [
      'Error: boom',
      '    at renderView (file:///home/u/proj/src/page.tsx:42:13)',
      '    at handleRequest (file:///home/u/proj/src/server.ts:100:5)',
    ].join('\n')
    const frames = parseStackFrames(stack, '/home/u/proj')
    expect(frames).toHaveLength(2)
    expect(frames[0]).toMatchObject({
      fn: 'renderView',
      file: '/home/u/proj/src/page.tsx',
      line: 42,
      col: 13,
      scope: 'user',
    })
    expect(frames[1]?.fn).toBe('handleRequest')
  })

  test('parses V8 anonymous frame', () => {
    const stack = ['Error: anon', '    at file:///home/u/proj/src/inline.ts:7:1'].join('\n')
    const frames = parseStackFrames(stack, '/home/u/proj')
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      fn: null,
      file: '/home/u/proj/src/inline.ts',
      line: 7,
      col: 1,
      scope: 'user',
    })
  })

  test('parses Firefox-style frame', () => {
    const stack = [
      'fnOne@file:///home/u/proj/src/a.ts:10:5',
      '@file:///home/u/proj/src/b.ts:20:10',
    ].join('\n')
    const frames = parseStackFrames(stack, '/home/u/proj')
    expect(frames).toHaveLength(2)
    expect(frames[0]).toMatchObject({ fn: 'fnOne', file: '/home/u/proj/src/a.ts' })
    // Bare `@file:...` is anonymous → fn === null.
    expect(frames[1]?.fn).toBeNull()
  })

  test('classifies node_modules frames as framework', () => {
    const stack = ['    at vendorFn (file:///home/u/proj/node_modules/lib/dist.js:1:1)'].join('\n')
    const frames = parseStackFrames(stack, '/home/u/proj')
    expect(frames[0]?.scope).toBe('framework')
  })

  test('classifies systems/ frames as framework noise (platform internal)', () => {
    const stack = [
      '    at hydrate (file:///home/u/proj/systems/component/src/index.ts:700:5)',
    ].join('\n')
    const frames = parseStackFrames(stack, '/home/u/proj')
    expect(frames[0]?.scope).toBe('framework')
  })

  test('classifies node: builtins as framework', () => {
    const stack = ['    at process.<anonymous> (node:internal/process/task_queues:95:5)'].join('\n')
    const frames = parseStackFrames(stack, '/home/u/proj')
    expect(frames[0]?.scope).toBe('framework')
    expect(frames[0]?.file).toBe('node:internal/process/task_queues')
  })

  test('returns [] for missing stack', () => {
    expect(parseStackFrames(undefined, '/home/u/proj')).toEqual([])
    expect(parseStackFrames('', '/home/u/proj')).toEqual([])
  })

  test('skips lines that do not match any known format (raw fallback safety net)', () => {
    const stack = [
      'Error: unmatched',
      'unrecognized line that we should ignore',
      '    at fn (file:///home/u/proj/x.ts:1:1)',
    ].join('\n')
    const frames = parseStackFrames(stack, '/home/u/proj')
    // Only the recognizable frame parses; the unmatched lines are
    // dropped from the structured table but preserved in the raw stack
    // <details> by the overlay caller.
    expect(frames).toHaveLength(1)
    expect(frames[0]?.fn).toBe('fn')
  })
})

describe('frameEditorHref — vscode:// link shape', () => {
  test('builds a vscode:// URL from a frame with absolute path', () => {
    const href = frameEditorHref({
      fn: 'x',
      file: '/home/u/proj/src/page.tsx',
      line: 42,
      col: 13,
      raw: '',
      scope: 'user',
    })
    expect(href).toBe('vscode://file//home/u/proj/src/page.tsx:42:13')
  })

  test('returns empty string when frame has no file', () => {
    const href = frameEditorHref({
      fn: null,
      file: '',
      line: 0,
      col: 0,
      raw: '',
      scope: 'unknown',
    })
    expect(href).toBe('')
  })
})
