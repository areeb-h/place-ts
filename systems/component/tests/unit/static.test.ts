// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { state } from '../../../reactivity/src/index.ts'
import { button, div, hydrate, renderToString, Static, span } from '../../src/index.ts'

// <Static> is a hydration opt-out. SSR emits the children's HTML; on
// the client, hydrate skips listener attach + reactive watches for the
// wrapped subtree. The DOM stays exactly as the server rendered it.

function ssrInto(html: string): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = html
  return root
}

describe('<Static> — opt-out hydration wrapper', () => {
  test('SSR emits children HTML identically to a Fragment', () => {
    const wrapped = renderToString(Static({ children: [div({ class: 'h' }, ['hi'])] }))
    const bare = renderToString(div({ class: 'h' }, ['hi']))
    expect(wrapped).toBe(bare)
  })

  test('hydrate does NOT attach event listeners inside the static subtree', () => {
    let clicks = 0
    const view = Static({
      children: [button({ class: 'b', onClick: () => clicks++ }, ['click'])],
    })
    const root = ssrInto(renderToString(view))
    const node = root.firstElementChild as HTMLElement
    hydrate(view, root)
    node.click()
    node.click()
    // Static skipped hydration of the button — no listener attached.
    expect(clicks).toBe(0)
  })

  test('hydrate does NOT create reactive watches inside the static subtree', () => {
    const isError = state(false)
    const view = Static({
      children: [div({ class: () => (isError() ? 'err' : 'ok') })],
    })
    const root = ssrInto(renderToString(view))
    const node = root.firstElementChild as HTMLElement
    expect(node.className).toBe('ok') // SSR snapshot
    hydrate(view, root)
    isError.set(true)
    // No watch installed — class stays at the SSR snapshot.
    expect(node.className).toBe('ok')
  })

  test('preserves DOM identity (does not recreate elements)', () => {
    const view = (): ReturnType<typeof Static> =>
      Static({ children: [div({ class: 'x' }, [span({}, ['inner'])])] })
    const root = ssrInto(renderToString(view()))
    const outer = root.firstElementChild as HTMLElement
    const inner = outer.firstElementChild as HTMLElement
    hydrate(view(), root)
    expect(root.firstElementChild).toBe(outer)
    expect(outer.firstElementChild).toBe(inner)
  })

  test('multiple element children are each consumed from the slot', () => {
    // Static wraps two siblings: the outer parent must still see them
    // walked one slot at a time so any sibling AFTER Static hydrates
    // against the correct element.
    let afterClicks = 0
    const view = div({ class: 'wrap' }, [
      Static({ children: [span({ class: 'a' }, ['1']), span({ class: 'b' }, ['2'])] }),
      button({ class: 'after', onClick: () => afterClicks++ }, ['after']),
    ])
    const root = ssrInto(renderToString(view))
    hydrate(view, root)
    const afterBtn = root.querySelector('.after') as HTMLButtonElement
    afterBtn.click()
    // The post-Static button hydrated correctly because Static
    // consumed its 2 element slots before the button's slot.
    expect(afterClicks).toBe(1)
  })

  test('mount path (CSR-only) still wires event handlers', () => {
    // Static is a HYDRATION opt-out, not a mount-path opt-out. When
    // rendered fresh on the client (no SSR), interactivity inside
    // Static still works — that's what the docstring promises.
    let clicks = 0
    const view = Static({
      children: [button({ class: 'b', onClick: () => clicks++ }, ['click'])],
    })
    const root = document.createElement('div')
    view.mount(root, null)
    const node = root.firstElementChild as HTMLElement
    node.click()
    expect(clicks).toBe(1)
  })

  test('empty children renders nothing and hydrates without consuming slots', () => {
    // Edge case: Static with no children.
    const view = div({}, [Static({}), span({ class: 'after' }, ['x'])])
    const root = ssrInto(renderToString(view))
    const after = root.querySelector('.after') as HTMLElement
    expect(after).not.toBeNull()
    // No throws — empty Static is a no-op.
    expect(() => hydrate(view, root)).not.toThrow()
    expect(after.hasAttribute('data-h')).toBe(false) // post-hydrate clean
  })

  test('disposer is a no-op (nothing to tear down)', () => {
    const view = Static({ children: [div({ class: 'x' }, ['hi'])] })
    const root = ssrInto(renderToString(view))
    const dispose = hydrate(view, root)
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
    // DOM stays intact post-dispose.
    expect(root.firstElementChild).not.toBeNull()
  })
})
