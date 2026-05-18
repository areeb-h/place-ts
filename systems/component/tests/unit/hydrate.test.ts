// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { state } from '../../../reactivity/src/index.ts'
import {
  _drainHydrationDeltas,
  _readHydrationDeltas,
  _setHydrated,
  button,
  component,
  div,
  Fragment,
  hydrate,
  renderToString,
  Show,
  span,
} from '../../src/index.ts'

// hydrate adopts the SSR'd DOM in place — element nodes are reused,
// listeners + reactive bindings attach to existing nodes, data-h
// markers strip post-hydration. These tests cover the core contract.

function ssrInto(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

describe('hydrate — client adoption of SSR DOM', () => {
  test('adopts existing element node (does NOT recreate it)', () => {
    const root = ssrInto(renderToString(div({ class: 'a' }, ['hello'])))
    const ssrNode = root.firstElementChild as HTMLElement
    hydrate(div({ class: 'a' }, ['hello']), root)
    // The SAME node identity must persist — adoption, not recreation.
    expect(root.firstElementChild).toBe(ssrNode)
  })

  test('strips data-h markers post-hydration (clean DOM)', () => {
    const root = ssrInto(renderToString(div({ class: 'a' }, [span({}, ['x'])])))
    expect(root.querySelector('[data-h]')).not.toBeNull() // pre-hydration
    hydrate(div({ class: 'a' }, [span({}, ['x'])]), root)
    expect(root.querySelector('[data-h]')).toBeNull() // gone
  })

  test('attaches event listener to the existing node', () => {
    const root = ssrInto(renderToString(button({ class: 'b' }, ['click'])))
    const node = root.firstElementChild as HTMLElement
    let clicks = 0
    hydrate(button({ class: 'b', onClick: () => clicks++ }, ['click']), root)
    node.click()
    node.click()
    expect(clicks).toBe(2)
  })

  test('reactive prop binding updates the existing node on state change', () => {
    const isError = state(false)
    const root = ssrInto(renderToString(div({ class: () => (isError() ? 'err' : 'ok') })))
    const node = root.firstElementChild as HTMLElement
    expect(node.className).toBe('ok')
    hydrate(div({ class: () => (isError() ? 'err' : 'ok') }), root)
    isError.set(true)
    expect(node.className).toBe('err')
  })

  test('throws a clear error on tag mismatch', () => {
    const root = ssrInto(renderToString(div({}, ['x'])))
    expect(() => hydrate(span({}, ['x']), root)).toThrow(/expected <span>/)
  })

  test('throws when there is no element to consume', () => {
    const root = document.createElement('div')
    // empty root — nothing to adopt
    expect(() => hydrate(div({}, ['x']), root)).toThrow(/no element/)
  })

  test('hydrates nested elements, matching DFS order', () => {
    const view = () =>
      div({ class: 'outer' }, [span({ class: 'a' }, ['1']), span({ class: 'b' }, ['2'])])
    const root = ssrInto(renderToString(view()))
    const outer = root.firstElementChild as HTMLElement
    const innerA = outer.children[0] as HTMLElement
    const innerB = outer.children[1] as HTMLElement
    hydrate(view(), root)
    expect(root.firstElementChild).toBe(outer)
    // Nested element children are now ADOPTED — identity preserved
    // when all children are hydratable Views. (Mixed content with text
    // / function children still falls back to clear+remount.)
    expect(outer.children[0]).toBe(innerA)
    expect(outer.children[1]).toBe(innerB)
    // Markers stripped post-hydration on every level
    expect(outer.hasAttribute('data-h')).toBe(false)
    expect(innerA.hasAttribute('data-h')).toBe(false)
    expect(innerB.hasAttribute('data-h')).toBe(false)
  })

  test('hydrates a component', () => {
    const Greeting = component<{ name: string }>((p) => span({ class: 'g' }, [`hi, ${p.name}`]))
    const root = ssrInto(renderToString(Greeting({ name: 'alice' })))
    const node = root.firstElementChild as HTMLElement
    hydrate(Greeting({ name: 'alice' }), root)
    expect(root.firstElementChild).toBe(node)
    expect(node.textContent).toBe('hi, alice')
  })

  test('dispose tears down listeners + watches without removing the DOM', () => {
    const isError = state(false)
    let clicks = 0
    const view = button({ class: () => (isError() ? 'err' : 'ok'), onClick: () => clicks++ })
    const root = ssrInto(renderToString(view))
    const node = root.firstElementChild as HTMLElement
    const dispose = hydrate(view, root)
    node.click()
    expect(clicks).toBe(1)
    dispose()
    // After dispose: DOM stays, watches stop, listeners gone.
    expect(root.firstElementChild).toBe(node)
    isError.set(true)
    expect(node.className).toBe('ok') // watch was disposed; no update
    node.click()
    expect(clicks).toBe(1) // listener removed
  })

  test('reactive child mounts fresh content (V0 cleared-children semantics)', () => {
    const count = state(7)
    const view = () => div({ class: 'wrap' }, [() => `count: ${count()}`])
    const root = ssrInto(renderToString(view()))
    expect(root.textContent).toBe('count: 7') // SSR rendered initial value
    hydrate(view(), root)
    expect(root.textContent).toBe('count: 7') // re-mounted fresh, same value
    count.set(42)
    expect(root.textContent).toBe('count: 42') // reactive update works
  })

  test('reactive function child of a Fragment re-renders post-hydration', () => {
    // SSR renders the function's CURRENT output. After hydrate, flipping
    // the state must replace the SSR-rendered range in place. Without
    // the Fragment-hydrate reactive-function-child boundary, the
    // function was resolved once and never re-evaluated — `<Show>` and
    // any Fragment-with-reactive-child froze after hydrate.
    const open = state(false)
    const view = () =>
      Fragment({
        children: [
          span({ class: 'before' }, ['before']),
          () => (open() ? div({ class: 'modal' }, ['hi']) : null),
          span({ class: 'after' }, ['after']),
        ],
      })
    const root = ssrInto(renderToString(view()))
    expect(root.querySelector('.modal')).toBeNull() // SSR: open=false
    hydrate(view(), root)
    expect(root.querySelector('.modal')).toBeNull() // post-hydrate: still closed
    // Surrounding Fragment siblings remain put.
    expect(root.querySelector('.before')).not.toBeNull()
    expect(root.querySelector('.after')).not.toBeNull()
    open.set(true)
    const modal = root.querySelector('.modal')
    expect(modal).not.toBeNull()
    expect(modal?.textContent).toBe('hi')
    // Siblings unchanged
    expect(root.querySelector('.before')).not.toBeNull()
    expect(root.querySelector('.after')).not.toBeNull()
    open.set(false)
    expect(root.querySelector('.modal')).toBeNull()
  })

  test('<Show> re-renders when the predicate flips post-hydration', () => {
    const isOpen = state(false)
    const view = () =>
      div({ class: 'shell' }, [
        Show({
          when: () => isOpen(),
          children: () => span({ class: 'shown' }, ['visible']),
        }),
      ])
    const root = ssrInto(renderToString(view()))
    expect(root.querySelector('.shown')).toBeNull() // SSR: closed
    hydrate(view(), root)
    isOpen.set(true)
    expect(root.querySelector('.shown')).not.toBeNull()
    isOpen.set(false)
    expect(root.querySelector('.shown')).toBeNull()
    // Flip again to confirm the watch survives multiple cycles.
    isOpen.set(true)
    expect(root.querySelector('.shown')).not.toBeNull()
  })

  test('reactive function child SSR-rendered with TRUE branch — adopts and reacts', () => {
    // Cover the inverse: SSR rendered the SHOWN branch (open=true at
    // SSR time). The adopted nodes must be tracked + replaceable on
    // close, and re-mountable on next open.
    const isOpen = state(true)
    const view = () =>
      Fragment({
        children: () => (isOpen() ? span({ class: 'live' }, ['ALIVE']) : null),
      })
    const root = ssrInto(renderToString(view()))
    expect(root.querySelector('.live')?.textContent).toBe('ALIVE')
    hydrate(view(), root)
    isOpen.set(false)
    expect(root.querySelector('.live')).toBeNull() // removed
    isOpen.set(true)
    expect(root.querySelector('.live')?.textContent).toBe('ALIVE') // re-mounted
  })
})

describe('hydration auditor — detects SSR/client divergence (dev-only)', () => {
  // The auditor populates a module-level deltas array during hydrate;
  // boot()'s post-hydrate flush console.warns + drains. We test the
  // accumulator directly so each test starts with a clean slate.
  beforeEach(() => {
    _drainHydrationDeltas()
  })
  afterEach(() => {
    _drainHydrationDeltas()
  })

  test('class divergence is detected as a `mismatch` delta', () => {
    // Server rendered class="a"; client view says class="b" — typical
    // locale/time-conditional rendering bug.
    const root = ssrInto(renderToString(div({ class: 'a' })))
    hydrate(div({ class: 'b' }), root)
    const deltas = _readHydrationDeltas()
    expect(deltas).toHaveLength(1)
    expect(deltas[0]).toMatchObject({ attribute: 'class', kind: 'mismatch' })
    expect(deltas[0]?.fixHint).toContain('island')
  })

  test('style divergence is detected', () => {
    const root = ssrInto(renderToString(div({ style: 'color: red' })))
    hydrate(div({ style: 'color: blue' }), root)
    const deltas = _readHydrationDeltas()
    expect(deltas.some((d) => d.attribute === 'style' && d.kind === 'mismatch')).toBe(true)
  })

  test('plain-attribute divergence is detected', () => {
    const root = ssrInto(renderToString(div({ id: 'a' })))
    hydrate(div({ id: 'b' }), root)
    const deltas = _readHydrationDeltas()
    expect(deltas.some((d) => d.attribute === 'id' && d.kind === 'mismatch')).toBe(true)
  })

  test('Grammarly-shaped attr is classified as `extension` (informational)', () => {
    // Simulate Grammarly injecting attrs post-SSR.
    const root = ssrInto(renderToString(div({ class: 'note' })))
    const node = root.firstElementChild as HTMLElement
    node.setAttribute('data-gramm', 'false')
    node.setAttribute('data-gramm_editor', 'false')
    hydrate(div({ class: 'note' }), root)
    const exts = _readHydrationDeltas().filter((d) => d.kind === 'extension')
    expect(exts.length).toBeGreaterThanOrEqual(2)
    expect(exts[0]?.fixHint).toContain('extension')
  })

  test('matching server/client → no deltas (no false positives)', () => {
    const root = ssrInto(renderToString(div({ class: 'same', id: 'x' }, ['hello'])))
    hydrate(div({ class: 'same', id: 'x' }, ['hello']), root)
    expect(_readHydrationDeltas()).toHaveLength(0)
  })

  test('class normalization tolerates whitespace / order differences', () => {
    // Server emits "a b c" (literal ordering), client view computes
    // "c  b   a" (different order, extra whitespace) — semantically
    // identical class lists shouldn't flag.
    const root = ssrInto(renderToString(div({ class: 'a b c' })))
    hydrate(div({ class: 'c  b   a' }), root)
    expect(_readHydrationDeltas().filter((d) => d.attribute === 'class')).toHaveLength(0)
  })
})

describe('auto-ClientOnly via per-component cap detection', () => {
  beforeEach(() => {
    _setHydrated(false)
  })
  afterEach(() => {
    _setHydrated(false)
  })

  test('component body throwing ClientOnlyAbort → SSR emits auto-placeholder span', async () => {
    const { defineCapability } = await import('../../../capability/src/index.ts')
    const ClientOnlyCap = defineCapability<{ value: string }>('TestCap', { clientOnly: true })
    const Body = component(() => {
      ClientOnlyCap.use() // throws ClientOnlyAbort SSR-side
      return span({}, ['real'])
    })
    const html = renderToString(Body({}))
    // Auto-placeholder: empty span with both client-only markers
    expect(html).toContain('data-place-client-only')
    expect(html).toContain('data-place-auto')
    expect(html).toContain('data-place-contents=""')
    expect(html).not.toContain('real')
  })

  test('hydrate of the auto-placeholder mounts the real body after flag flips', async () => {
    const { defineCapability } = await import('../../../capability/src/index.ts')
    const ClientOnlyCap = defineCapability<{ value: string }>('TestCap2', { clientOnly: true })
    const ssrHtml = renderToString(
      component(() => {
        ClientOnlyCap.use()
        return span({}, ['nope'])
      })({}),
    )
    const root = ssrInto(ssrHtml)
    expect(root.querySelector('[data-place-auto]')).not.toBeNull()
    // Install the cap browser-side, then hydrate
    const dispose = ClientOnlyCap.install({ value: 'ok' })
    try {
      hydrate(
        component(() => {
          const cap = ClientOnlyCap.use()
          return span({}, [cap.value])
        })({}),
        root,
      )
      // Pre-flip: placeholder still empty
      expect(root.textContent).toBe('')
      _setHydrated(true)
      // Post-flip: body ran (cap was readable) and content mounted
      expect(root.textContent).toBe('ok')
    } finally {
      dispose()
    }
  })
})
