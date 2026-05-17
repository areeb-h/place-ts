// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { state } from '../../../reactivity/src/index.ts'
import { div, hydrate, keyed, mount, renderToString, span } from '../../src/index.ts'

const tagsOf = (root: ParentNode): string[] =>
  Array.from(root.children).map((el) => `${el.tagName.toLowerCase()}:${el.textContent}`)

describe('keyed — list reconciliation', () => {
  test('renders an initial list', () => {
    const root = document.createElement('div')
    const items = state<string[]>(['a', 'b', 'c'])
    mount(
      keyed(
        () => items(),
        (s) => s,
        (s) => span({}, [s]),
      ),
      root,
    )
    expect(tagsOf(root)).toEqual(['span:a', 'span:b', 'span:c'])
  })

  test('renders an empty list', () => {
    const root = document.createElement('div')
    const items = state<string[]>([])
    mount(
      keyed(
        () => items(),
        (s) => s,
        (s) => span({}, [s]),
      ),
      root,
    )
    expect(root.children.length).toBe(0)
  })

  test('appends a new item', () => {
    const root = document.createElement('div')
    const items = state<string[]>(['a', 'b'])
    mount(
      keyed(
        () => items(),
        (s) => s,
        (s) => span({}, [s]),
      ),
      root,
    )
    items.set([...items(), 'c'])
    expect(tagsOf(root)).toEqual(['span:a', 'span:b', 'span:c'])
  })

  test('inserts in the middle', () => {
    const root = document.createElement('div')
    const items = state<string[]>(['a', 'c'])
    mount(
      keyed(
        () => items(),
        (s) => s,
        (s) => span({}, [s]),
      ),
      root,
    )
    items.set(['a', 'b', 'c'])
    expect(tagsOf(root)).toEqual(['span:a', 'span:b', 'span:c'])
  })

  test('removes from the middle', () => {
    const root = document.createElement('div')
    const items = state<string[]>(['a', 'b', 'c'])
    mount(
      keyed(
        () => items(),
        (s) => s,
        (s) => span({}, [s]),
      ),
      root,
    )
    items.set(['a', 'c'])
    expect(tagsOf(root)).toEqual(['span:a', 'span:c'])
  })

  test('removes from the start', () => {
    const root = document.createElement('div')
    const items = state<string[]>(['a', 'b', 'c'])
    mount(
      keyed(
        () => items(),
        (s) => s,
        (s) => span({}, [s]),
      ),
      root,
    )
    items.set(['b', 'c'])
    expect(tagsOf(root)).toEqual(['span:b', 'span:c'])
  })

  test('removes from the end', () => {
    const root = document.createElement('div')
    const items = state<string[]>(['a', 'b', 'c'])
    mount(
      keyed(
        () => items(),
        (s) => s,
        (s) => span({}, [s]),
      ),
      root,
    )
    items.set(['a', 'b'])
    expect(tagsOf(root)).toEqual(['span:a', 'span:b'])
  })

  test('clears all', () => {
    const root = document.createElement('div')
    const items = state<string[]>(['a', 'b', 'c'])
    mount(
      keyed(
        () => items(),
        (s) => s,
        (s) => span({}, [s]),
      ),
      root,
    )
    items.set([])
    expect(root.children.length).toBe(0)
  })

  test('reorder preserves state inside item views', () => {
    // Each item view holds a counter. After reorder, counters should follow
    // the items (proving state was preserved, not re-rendered).
    const root = document.createElement('div')
    const items = state<string[]>(['a', 'b', 'c'])
    const counters = new Map<string, () => number>()
    mount(
      keyed(
        () => items(),
        (s) => s,
        (s) => {
          const count = state(0)
          counters.set(s, () => count())
          // Pre-increment so each item has a distinct counter
          count.set(s.charCodeAt(0))
          return span({}, [s, ':', () => count()])
        },
      ),
      root,
    )
    expect(tagsOf(root)).toEqual(['span:a:97', 'span:b:98', 'span:c:99'])
    // Reorder
    items.set(['c', 'a', 'b'])
    expect(tagsOf(root)).toEqual(['span:c:99', 'span:a:97', 'span:b:98'])
    // Counters preserved per-key
    expect(counters.get('a')?.()).toBe(97)
    expect(counters.get('b')?.()).toBe(98)
    expect(counters.get('c')?.()).toBe(99)
  })

  test('replace with completely different keys', () => {
    const root = document.createElement('div')
    const items = state<string[]>(['a', 'b', 'c'])
    mount(
      keyed(
        () => items(),
        (s) => s,
        (s) => span({}, [s]),
      ),
      root,
    )
    items.set(['x', 'y', 'z'])
    expect(tagsOf(root)).toEqual(['span:x', 'span:y', 'span:z'])
  })

  test('keys can be numbers', () => {
    const root = document.createElement('div')
    const items = state<{ id: number; name: string }[]>([
      { id: 1, name: 'one' },
      { id: 2, name: 'two' },
    ])
    mount(
      keyed(
        () => items(),
        (item) => item.id,
        (item) => span({}, [item.name]),
      ),
      root,
    )
    expect(tagsOf(root)).toEqual(['span:one', 'span:two'])
    items.set([
      { id: 2, name: 'two-renamed' },
      { id: 1, name: 'one-renamed' },
    ])
    // Reorder — but render doesn't read item reactively, so the *content*
    // doesn't update on the same key. That's the documented behavior:
    // render runs once per new key. To get item-level reactivity, wrap items
    // in state.
    expect(tagsOf(root)).toEqual(['span:two', 'span:one'])
  })

  test('disposing tears down all items', () => {
    const root = document.createElement('div')
    const items = state<string[]>(['a', 'b', 'c'])
    let disposeCalls = 0
    const dispose = mount(
      keyed(
        () => items(),
        (s) => s,
        (s) => ({
          mount(parent, anchor) {
            const node = document.createElement('span')
            node.textContent = s
            parent.insertBefore(node, anchor ?? null)
            return () => {
              disposeCalls++
              node.remove()
            }
          },
        }),
      ),
      root,
    )
    expect(disposeCalls).toBe(0)
    dispose()
    expect(disposeCalls).toBe(3)
    expect(root.children.length).toBe(0)
  })

  test('keyed inside a div positions correctly', () => {
    const root = document.createElement('div')
    const items = state<string[]>(['a', 'b'])
    mount(
      div({}, [
        span({}, ['header']),
        keyed(
          () => items(),
          (s) => s,
          (s) => span({}, [s]),
        ),
        span({}, ['footer']),
      ]),
      root,
    )
    const wrap = root.firstElementChild as HTMLDivElement
    expect(Array.from(wrap.children).map((c) => c.textContent)).toEqual([
      'header',
      'a',
      'b',
      'footer',
    ])
    items.set(['a', 'b', 'c'])
    expect(Array.from(wrap.children).map((c) => c.textContent)).toEqual([
      'header',
      'a',
      'b',
      'c',
      'footer',
    ])
    items.set(['b'])
    expect(Array.from(wrap.children).map((c) => c.textContent)).toEqual(['header', 'b', 'footer'])
  })

  // ─── Post-hydration reactivity ─────────────────────────────────────────
  //
  // After hydrate adopts SSR'd keyed-list DOM, subsequent mutations
  // to the items list MUST update the DOM — same contract as mount.
  // Earlier the hydrate path used `untrack` and never installed a
  // watch, leaving SSR'd lists static after hydration.

  test('hydrate: appending an item after hydration adds a new DOM node', async () => {
    const items = state<string[]>(['a', 'b', 'c'])
    const view = keyed(
      () => items(),
      (s) => s,
      (s) => span({}, [s]),
    )
    const host = document.createElement('div')
    // Wrap in a div so the keyed children adopt cleanly into a parent.
    host.innerHTML = `<div>${renderToString(view)}</div>`
    const wrap = host.firstElementChild as HTMLElement
    hydrate(
      div(
        {},
        keyed(
          () => items(),
          (s) => s,
          (s) => span({}, [s]),
        ),
      ),
      host,
    )
    expect(Array.from(wrap.querySelectorAll('span')).map((s) => s.textContent)).toEqual([
      'a',
      'b',
      'c',
    ])
    items.set(['a', 'b', 'c', 'd'])
    await Promise.resolve()
    expect(Array.from(wrap.querySelectorAll('span')).map((s) => s.textContent)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  test('hydrate: removing items after hydration removes their DOM nodes', async () => {
    const items = state<string[]>(['a', 'b', 'c'])
    const view = keyed(
      () => items(),
      (s) => s,
      (s) => span({}, [s]),
    )
    const host = document.createElement('div')
    host.innerHTML = `<div>${renderToString(view)}</div>`
    hydrate(
      div(
        {},
        keyed(
          () => items(),
          (s) => s,
          (s) => span({}, [s]),
        ),
      ),
      host,
    )
    items.set(['b'])
    await Promise.resolve()
    expect(
      Array.from((host.firstElementChild as HTMLElement).querySelectorAll('span')).map(
        (s) => s.textContent,
      ),
    ).toEqual(['b'])
  })

  test('hydrate: reordering items moves DOM without re-creating nodes', async () => {
    const items = state<string[]>(['a', 'b', 'c'])
    const view = keyed(
      () => items(),
      (s) => s,
      (s) => span({}, [s]),
    )
    const host = document.createElement('div')
    host.innerHTML = `<div>${renderToString(view)}</div>`
    hydrate(
      div(
        {},
        keyed(
          () => items(),
          (s) => s,
          (s) => span({}, [s]),
        ),
      ),
      host,
    )
    const wrap = host.firstElementChild as HTMLElement
    const adoptedA = wrap.querySelector('span') // first span = 'a'
    items.set(['c', 'a', 'b'])
    await Promise.resolve()
    expect(Array.from(wrap.querySelectorAll('span')).map((s) => s.textContent)).toEqual([
      'c',
      'a',
      'b',
    ])
    // Identity check: the original adopted 'a' span is reused after
    // reorder (not re-created). This is what makes reconciliation
    // cheaper than full re-render.
    expect(wrap.querySelectorAll('span')[1]).toBe(adoptedA)
  })

  test('throws on duplicate keys with a clear error message', () => {
    const root = document.createElement('div')
    const items = state<string[]>(['a', 'a'])
    expect(() =>
      mount(
        keyed(
          () => items(),
          (s) => s,
          (s) => span({}, [s]),
        ),
        root,
      ),
    ).toThrow(/duplicate.*key/i)
  })
})
