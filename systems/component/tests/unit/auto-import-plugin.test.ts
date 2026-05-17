import { describe, expect, test } from 'vitest'
import { autoImportTransform, PLACE_AUTO_IMPORTS } from '../../src/auto-import-plugin.ts'

// The plugin's transform is a pure function over source text. Test it
// directly so we cover the scope-detection logic (already-imported,
// declared, shadowed, in comments/strings) without spinning up Bun's
// bundler. Integration with `Bun.build` is exercised in the docs site
// build at dev time.

describe('autoImportTransform', () => {
  test('injects a single import for one referenced identifier', () => {
    const src = `export const Foo = () => <Activity when={true}>hi</Activity>`
    const out = autoImportTransform(src, { Activity: '@place/component' })
    expect(out).toBe(`import { Activity } from '@place/component'\n${src}`)
  })

  test('groups multiple identifiers under their source module', () => {
    const src = `export const X = () => {
      const open = state(false)
      return <Activity when={open}>{cookie('x')}</Activity>
    }`
    const out = autoImportTransform(src, {
      Activity: '@place/component',
      state: '@place/component',
      cookie: '@place/component',
    })
    expect(out.startsWith(`import { Activity, cookie, state } from '@place/component'\n`)).toBe(true)
    expect(out.endsWith(src)).toBe(true)
  })

  test('does not re-import an already-imported identifier', () => {
    const src = `import { state } from '@place/component'
const v = state(0)`
    const out = autoImportTransform(src, { state: '@place/component' })
    expect(out).toBe(src)
  })

  test('respects renamed imports — local name takes precedence', () => {
    const src = `import { state as makeState } from '@place/component'
const v = makeState(0)`
    // `state` is NOT referenced in the file; only `makeState` is. So no
    // auto-import should fire even though `state` is in the registry.
    const out = autoImportTransform(src, { state: '@place/component' })
    expect(out).toBe(src)
  })

  test('treats a top-level declaration as already-in-scope (no shadow auto-import)', () => {
    const src = `const state = 42
export const X = state + 1`
    const out = autoImportTransform(src, { state: '@place/component' })
    expect(out).toBe(src)
  })

  test('does not auto-import a name that appears ONLY in a comment', () => {
    const src = `// Activity is a primitive used elsewhere
export const Foo = () => 'noop'`
    const out = autoImportTransform(src, { Activity: '@place/component' })
    expect(out).toBe(src)
  })

  test('does not auto-import a name that appears ONLY in a string literal', () => {
    const src = `export const greeting = "use the Activity primitive"`
    const out = autoImportTransform(src, { Activity: '@place/component' })
    expect(out).toBe(src)
  })

  test('idempotent — running twice yields the same output', () => {
    const src = `export const X = () => <Tabs active={state('a')} tabs={[]} />`
    const reg = { Tabs: '@place/component', state: '@place/component' }
    const once = autoImportTransform(src, reg)
    const twice = autoImportTransform(once, reg)
    expect(twice).toBe(once)
  })

  test('word-boundary match: `state` does not match `pageState`', () => {
    const src = `export const X = () => { const pageState = 1; return pageState }`
    const out = autoImportTransform(src, { state: '@place/component' })
    expect(out).toBe(src)
  })

  test('PLACE_AUTO_IMPORTS registry covers the common entry points', () => {
    // Spot-check that the registry exposes what user code is likely
    // to reach for. If we rename or remove framework primitives, this
    // test trips and we update the registry deliberately.
    const expected = [
      'state',
      'watch',
      'onMount',
      'cookie',
      'cookieState',
      'island',
      'Tab',
      'Tabs',
      'Activity',
      'ClientOnly',
      'Show',
      'Fragment',
    ]
    for (const name of expected) {
      expect(PLACE_AUTO_IMPORTS[name]).toBe('@place/component')
    }
  })

  describe('island(fn) → island(import.meta.url, fn) sugar', () => {
    test('single-arg call gets the URL injected', () => {
      const src = `const C = island((p) => <div>{p.x}</div>)`
      const out = autoImportTransform(src, { island: '@place/component' })
      expect(out).toContain(`island(import.meta.url, (p) => <div>{p.x}</div>)`)
    })

    test('two-arg call (already has URL) is left untouched', () => {
      const src = `const C = island(import.meta.url, (p) => <div/>)`
      const out = autoImportTransform(src, { island: '@place/component' })
      expect(out).toBe(`import { island } from '@place/component'\n${src}`)
    })

    test('idempotent — second pass yields the same output', () => {
      const src = `const C = island((p) => <div>{p.x}</div>)`
      const once = autoImportTransform(src, { island: '@place/component' })
      const twice = autoImportTransform(once, { island: '@place/component' })
      expect(twice).toBe(once)
    })

    test('handles inline arrow with nested parens in body', () => {
      const src = `const C = island((p: { x: number }) => <div onClick={() => alert(p.x)}>hi</div>)`
      const out = autoImportTransform(src, { island: '@place/component' })
      expect(out).toContain(
        `island(import.meta.url, (p: { x: number }) => <div onClick={() => alert(p.x)}>hi</div>)`,
      )
    })

    test('handles named-fn reference (no inline arrow)', () => {
      const src = `const Impl = (p) => <div/>
const C = island(Impl)`
      const out = autoImportTransform(src, { island: '@place/component' })
      expect(out).toContain(`island(import.meta.url, Impl)`)
    })

    test('does not transform `island` inside a string literal', () => {
      const src = `const msg = "use island(fn) to declare"`
      const out = autoImportTransform(src, { island: '@place/component' })
      expect(out).toBe(src)
    })

    test('does not transform `island` inside a comment', () => {
      const src = `// call island(fn) per the docs\nexport const x = 1`
      const out = autoImportTransform(src, { island: '@place/component' })
      expect(out).toBe(src)
    })

    test('handles generic type args: island<Props>(fn)', () => {
      const src = `const C = island<MyProps>(Impl)`
      const out = autoImportTransform(src, { island: '@place/component' })
      expect(out).toContain(`island<MyProps>(import.meta.url, Impl)`)
    })

    test('handles complex generic with intersection types', () => {
      const src = `const C = island<CodeBlockProps & Record<string, unknown>>(CodeBlockImpl)`
      const out = autoImportTransform(src, { island: '@place/component' })
      expect(out).toContain(
        `island<CodeBlockProps & Record<string, unknown>>(import.meta.url, CodeBlockImpl)`,
      )
    })

    test('two-arg call with generics is left alone', () => {
      const src = `const C = island<P>(import.meta.url, Impl)`
      const out = autoImportTransform(src, { island: '@place/component' })
      // No double-injection.
      expect(out).toContain(`island<P>(import.meta.url, Impl)`)
      expect(out).not.toContain(`import.meta.url, import.meta.url`)
    })
  })
})
