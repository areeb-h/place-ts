// @vitest-environment happy-dom
//
// Regression test for the double-marker bug. The `<Island name="…" />`
// JSX wrapper looks up `reg.component` and emits a marker for it. The
// modern registration form (`island(import.meta.url, fn)`) returns a
// callable that ALREADY emits its own marker via toHtml — so wrapping
// it in another marker produces nested `<div data-view="island">`
// markers, and the client bundle's selector matches both layers,
// triggering a hydrate mismatch ("expected <button> but found <div>")
// because the inner marker's children are empty (SSR-throw recovery
// path) while the view's tree on the client expects rendered content.
//
// Fix: when `reg.component.__islandBrand === ISLAND_BRAND`, delegate
// to the callable directly. The legacy `(props) => View` registration
// form still wraps.

import { beforeEach, describe, expect, test } from 'vitest'
import { _setIslandRegistry, island, Island, type View } from '../../src/index.ts'

describe('Island JSX wrapper — no double marker', () => {
  beforeEach(() => {
    _setIslandRegistry({})
  })

  test('island()-registered component emits exactly one marker (SSR-throw recovery shape)', () => {
    // basename → "throw-marker"
    const SRC = 'file:///fake/src/throw-marker.tsx'
    const myIsland = island(SRC, () => {
      // Throw to force SSR-recovery path so the inner toHtml emits an
      // empty marker — the exact shape that previously triggered the
      // double-wrap bug for `place-devtools`.
      throw new ReferenceError('document is not defined')
    })

    _setIslandRegistry({
      'throw-marker': { component: myIsland, src: SRC },
    })

    const html = Island({ name: 'throw-marker', client: 'idle' }).toHtml?.() ?? ''
    const markers = html.match(/data-view-id="throw-marker"/g) ?? []
    expect(markers.length).toBe(1)
    expect(html).toContain('data-view-strategy="idle"')
    // No nested marker pattern — the previous double-wrap emitted
    // `…"></div></div>` (closing inner + closing outer back-to-back).
    expect(html).not.toMatch(/data-view-id="throw-marker"[^>]*><div data-view="island"/)
  })

  test('island()-registered component with rendered content — single marker, content inside', () => {
    const SRC = 'file:///fake/src/content-marker.tsx'
    const ok = island(SRC, () => {
      const v: View = {
        toHtml: () => '<button class="x">ok</button>',
        mount: (parent) => {
          const b = document.createElement('button')
          b.className = 'x'
          b.textContent = 'ok'
          parent.appendChild(b)
          return () => b.remove()
        },
      }
      return v
    })

    _setIslandRegistry({
      'content-marker': { component: ok, src: SRC },
    })

    const html = Island({ name: 'content-marker' }).toHtml?.() ?? ''
    const markers = html.match(/data-view-id="content-marker"/g) ?? []
    expect(markers.length).toBe(1)
    expect(html).toContain('<button class="x">ok</button>')
  })

  test('island()-registered component forwards user props through delegate path', () => {
    const SRC = 'file:///fake/src/props-marker.tsx'
    const captured: { args?: { title: string } } = {}
    const propsIsland = island<{ title: string }>(SRC, (props) => {
      captured.args = props
      const v: View = {
        toHtml: () => `<span>${props.title}</span>`,
        mount: (parent) => {
          const s = document.createElement('span')
          s.textContent = props.title
          parent.appendChild(s)
          return () => s.remove()
        },
      }
      return v
    })

    _setIslandRegistry({
      'props-marker': { component: propsIsland, src: SRC },
    })

    const html =
      Island({ name: 'props-marker', props: { title: 'hello' } }).toHtml?.() ?? ''
    const markers = html.match(/data-view-id="props-marker"/g) ?? []
    expect(markers.length).toBe(1)
    expect(html).toContain('data-view-props=')
    expect(html).toContain('<span>hello</span>')
    expect(captured.args?.title).toBe('hello')
  })

  test('legacy plain (props) => View registration still wraps in marker', () => {
    // No __islandBrand — `Island` JSX takes the legacy wrap path.
    const plain = () => ({
      toHtml: () => '<span class="plain">x</span>',
      mount: (parent: ParentNode) => {
        const s = document.createElement('span')
        s.className = 'plain'
        s.textContent = 'x'
        parent.appendChild(s)
        return () => s.remove()
      },
    })

    _setIslandRegistry({
      'plain-comp': { component: plain as never, src: 'file:///fake/src/plain-comp.tsx' },
    })

    const html = Island({ name: 'plain-comp' }).toHtml?.() ?? ''
    const markers = html.match(/data-view-id="plain-comp"/g) ?? []
    expect(markers.length).toBe(1)
    expect(html).toContain('<span class="plain">x</span>')
  })
})
