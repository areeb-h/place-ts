// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { defineCapability } from '../../../capability/src/index.ts'
import { state } from '../../../reactivity/src/index.ts'
import { component, div, keyed, mount, withCapability } from '../../src/index.ts'

interface Logger {
  log(msg: string): void
}

describe('withCapability', () => {
  test('makes the capability available inside descendant component bodies', () => {
    const Log = defineCapability<Logger>('Log')
    const captured: string[] = []
    const impl: Logger = { log: (m) => captured.push(m) }

    const ActionPanel = component(() => {
      const log = Log.use()
      log.log('mounted')
      return div({}, ['action panel'])
    })

    const root = document.createElement('div')
    mount(withCapability(Log, impl, ActionPanel({})), root)
    expect(captured).toEqual(['mounted'])
  })

  test('event handlers fire with the captured impl', () => {
    const Log = defineCapability<Logger>('Log')
    const captured: string[] = []
    const impl: Logger = { log: (m) => captured.push(m) }

    const Btn = component(() => {
      const log = Log.use()
      return div({ onClick: () => log.log('clicked') })
    })

    const root = document.createElement('div')
    mount(withCapability(Log, impl, Btn({})), root)
    const el = root.firstElementChild as HTMLElement
    el.click()
    el.click()
    expect(captured).toEqual(['clicked', 'clicked'])
  })

  test('disposing tears down inner view inside the impl scope', () => {
    const Log = defineCapability<Logger>('Log')
    const captured: string[] = []
    const impl: Logger = { log: (m) => captured.push(m) }
    let cleanupRan = false

    const C = component(() => {
      const log = Log.use()
      return {
        mount(parent, anchor) {
          const node = document.createElement('span')
          parent.insertBefore(node, anchor ?? null)
          return () => {
            log.log('disposing')
            cleanupRan = true
            node.remove()
          }
        },
      }
    })

    const root = document.createElement('div')
    const dispose = mount(withCapability(Log, impl, C({})), root)
    expect(captured).toEqual([])
    dispose()
    expect(cleanupRan).toBe(true)
    expect(captured).toEqual(['disposing'])
  })

  test('nested withCapability shadows outer for that subtree only', () => {
    const Tag = defineCapability<string>('Tag')
    const log: string[] = []

    const Reader = component(() => {
      log.push(Tag.use())
      return div({}, ['x'])
    })

    const root = document.createElement('div')
    mount(withCapability(Tag, 'outer', withCapability(Tag, 'inner', Reader({}))), root)
    expect(log).toEqual(['inner'])
  })

  test('capability is reactive-state-friendly', () => {
    const Counter = defineCapability<{ inc(): void; current: () => number }>('Counter')
    const root = document.createElement('div')
    const value = state(0)

    const Display = component(() => {
      const c = Counter.use()
      return div({ class: 'display' }, [() => `count=${c.current()}`])
    })

    mount(
      withCapability(
        Counter,
        {
          inc: () => value.update((v) => v + 1),
          current: () => value(),
        },
        Display({}),
      ),
      root,
    )

    const el = root.firstElementChild as HTMLElement
    expect(el.textContent).toBe('count=0')
    value.set(5)
    expect(el.textContent).toBe('count=5')
  })

  test('the capability is unavailable outside the wrapped view', () => {
    const Tag = defineCapability<string>('Tag')
    Tag.provide('inside', () => {
      expect(Tag.use()).toBe('inside')
    })
    expect(() => Tag.use()).toThrow(/not provided/i)
  })

  test('regression: capability survives deferred component mounts via keyed', () => {
    // This is the exact pattern that broke the commonplace book: a keyed
    // list mounted inside withCapability, where new rows are added AFTER
    // the initial mount tree settled. Each new row's component body must
    // still see the capability — without this, +new and note-switching
    // both fail.
    const Cap = defineCapability<{ tag: string }>('Cap')
    const items = state<{ id: string }[]>([{ id: 'a' }])
    const seenTags: string[] = []

    const Row = component((p: { id: string }) => {
      const c = Cap.use()
      seenTags.push(`${p.id}:${c.tag}`)
      return div({}, [`${p.id}=${c.tag}`])
    })

    const tree = div({}, [
      keyed(
        () => items(),
        (it) => it.id,
        (it) => Row({ id: it.id }),
      ),
    ])

    const root = document.createElement('div')
    mount(withCapability(Cap, { tag: 'X' }, tree), root)
    expect(seenTags).toEqual(['a:X'])

    // Add new items — keyed mounts new Rows whose bodies must still see Cap.
    items.set([{ id: 'a' }, { id: 'b' }])
    expect(seenTags, 'cap must survive across deferred mounts').toEqual(['a:X', 'b:X'])

    items.set([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(seenTags).toEqual(['a:X', 'b:X', 'c:X'])
  })

  test('install / uninstall — cap is gone after disposer fires', () => {
    const Cap = defineCapability<string>('Cap')
    const uninstall = Cap.install('hello')
    expect(Cap.use()).toBe('hello')
    uninstall()
    expect(() => Cap.use()).toThrow(/not provided/i)
  })

  test('install — disposing twice is a no-op', () => {
    const Cap = defineCapability<string>('Cap')
    const uninstall = Cap.install('x')
    uninstall()
    expect(() => uninstall()).not.toThrow()
  })

  test('install — out-of-order dispose still works (token-based)', () => {
    const Cap = defineCapability<string>('Cap')
    const a = Cap.install('a')
    const b = Cap.install('b')
    expect(Cap.use()).toBe('b')
    // Dispose outer first (out of stack order)
    a()
    // Inner is still installed — top of stack remains 'b'
    expect(Cap.use()).toBe('b')
    b()
    expect(() => Cap.use()).toThrow()
  })
})
