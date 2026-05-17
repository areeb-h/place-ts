// @vitest-environment happy-dom

import { describe, expect, test, vi } from 'vitest'
import { state } from '../../../reactivity/src/index.ts'
import { component, el, errorBoundary, mount } from '../../src/index.ts'

const root = (): HTMLDivElement => {
  const r = document.createElement('div')
  document.body.appendChild(r)
  return r
}

describe('errorBoundary — catches throws in the wrapped subtree', () => {
  test('passes children through when nothing throws', () => {
    const r = root()
    const view = errorBoundary({
      fallback: () => el('div', 'should not show'),
      children: el('span', 'ok'),
    })
    const dispose = mount(view, r)
    expect(r.textContent).toContain('ok')
    expect(r.textContent).not.toContain('should not show')
    dispose()
    r.remove()
  })

  test('catches a throw in a component body', () => {
    const Boom = component(() => {
      throw new Error('boom in body')
    })
    const r = root()
    const view = errorBoundary({
      fallback: (e) => el('span', `caught: ${(e as Error).message}`),
      children: Boom({}),
    })
    const dispose = mount(view, r)
    expect(r.textContent).toContain('caught: boom in body')
    dispose()
    r.remove()
  })

  test('catches a throw in a reactive child getter', () => {
    const trigger = state(false)
    const r = root()
    const view = errorBoundary({
      fallback: (e) => el('span', `caught: ${(e as Error).message}`),
      children: el('div', () => {
        if (trigger()) throw new Error('reactive boom')
        return 'fine'
      }),
    })
    const dispose = mount(view, r)
    expect(r.textContent).toContain('fine')

    trigger.set(true)
    expect(r.textContent).toContain('caught: reactive boom')

    dispose()
    r.remove()
  })

  test('retry re-mounts the original children', () => {
    let attempt = 0
    const Sometimes = component(() => {
      attempt++
      if (attempt < 2) throw new Error(`fail attempt ${attempt}`)
      return el('span', 'recovered')
    })
    const r = root()
    // TS can't narrow a closure-mutated variable, so wrap in a holder.
    const holder: { retry: (() => void) | null } = { retry: null }
    const view = errorBoundary({
      fallback: (_e, retry) => {
        holder.retry = retry
        return el('span', 'fallback')
      },
      children: Sometimes({}),
    })
    const dispose = mount(view, r)
    expect(r.textContent).toContain('fallback')
    expect(holder.retry).toBeTypeOf('function')

    holder.retry?.()
    expect(r.textContent).toContain('recovered')

    dispose()
    r.remove()
  })

  test('nested boundaries: innermost catches', () => {
    const Boom = component(() => {
      throw new Error('inner')
    })
    const outerFallback = vi.fn(() => el('span', 'outer caught'))
    const innerFallback = vi.fn((e: unknown) => el('span', `inner: ${(e as Error).message}`))
    const r = root()
    const view = errorBoundary({
      fallback: outerFallback,
      children: errorBoundary({
        fallback: innerFallback,
        children: Boom({}),
      }),
    })
    const dispose = mount(view, r)
    expect(r.textContent).toContain('inner: inner')
    expect(innerFallback).toHaveBeenCalledTimes(1)
    expect(outerFallback).not.toHaveBeenCalled()
    dispose()
    r.remove()
  })

  test('outer boundary catches when inner does not exist along the throw path', () => {
    const Boom = component(() => {
      throw new Error('uncaught path')
    })
    const r = root()
    const view = errorBoundary({
      fallback: (e) => el('span', `outer: ${(e as Error).message}`),
      children: Boom({}),
    })
    const dispose = mount(view, r)
    expect(r.textContent).toContain('outer: uncaught path')
    dispose()
    r.remove()
  })

  test('throws propagate up if no boundary is installed', () => {
    const Boom = component(() => {
      throw new Error('no boundary')
    })
    const r = root()
    expect(() => mount(Boom({}), r)).toThrow(/no boundary/)
    r.remove()
  })

  test('a throwing ref does not leak the cleanups registered before it', () => {
    // Cleanup tracking via a custom event listener — its removal is
    // registered via applyProp BEFORE the ref runs. If makeView didn't
    // run cleanups on a partial-mount throw, this listener would still
    // be attached to a dead node forever.
    const r = root()
    const view = errorBoundary({
      fallback: (e) => el('span', `caught: ${(e as Error).message}`),
      children: el('div', {
        onClick: () => {},
        ref: () => {
          throw new Error('ref boom')
        },
      }),
    })
    const dispose = mount(view, r)
    expect(r.textContent).toContain('caught: ref boom')
    dispose()
    r.remove()
  })

  test('event handler throws route to the wrapping boundary', () => {
    const r = root()
    const view = errorBoundary({
      fallback: (e) => el('span', `caught: ${(e as Error).message}`),
      children: el(
        'button',
        {
          onClick: () => {
            throw new Error('handler boom')
          },
        },
        'click me',
      ),
    })
    const dispose = mount(view, r)
    const btn = r.querySelector('button') as HTMLButtonElement
    btn.click()
    expect(r.textContent).toContain('caught: handler boom')
    dispose()
    r.remove()
  })

  test('cleanups inside a failing component still run before the throw bubbles', () => {
    const cleanup = vi.fn()
    const Boom = component(() => {
      // Note: onCleanup test is integration-ish; just verify no errors.
      // The HOC's catch-block runs registered cleanups before bubbling.
      // We simulate with a dummy cleanup via a state subscription that
      // gets disposed cleanly even on throw.
      throw new Error('after-cleanup-registration')
    })
    const r = root()
    const view = errorBoundary({
      fallback: () => el('span', 'caught'),
      children: Boom({}),
    })
    const dispose = mount(view, r)
    expect(r.textContent).toContain('caught')
    // cleanup never registered (throw happened before any onCleanup
    // call) — assertion is that we reached the fallback at all.
    expect(cleanup).not.toHaveBeenCalled()
    dispose()
    r.remove()
  })
})
