// @vitest-environment happy-dom
//
// Phase 4.8: pre-boot event capture + post-hydration replay. The runtime
// (in __place_runtime.ts) is a JS string that gets injected into the SSR
// shell when streaming. We exercise it here by evaluating it into the
// happy-dom global, simulating the streaming-then-hydrate sequence.

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { PLACE_RUNTIME } from '../../src/__place_runtime.ts'

declare global {
  // The runtime installs a global `__place` on `window`.
  var __place: {
    r: Record<string, unknown>
    q: Array<{ type: string; target: Element; clientX?: number; clientY?: number }>
    swap: (id: number) => void
    replay: () => void
  }
}

describe('__place runtime — pre-boot capture + replay', () => {
  beforeEach(() => {
    // Each test gets a fresh DOM + fresh __place runtime.
    document.body.innerHTML = ''
    delete (globalThis as { __place?: unknown }).__place
    // Eval the runtime into the test's window context. Real pages get
    // it via <script>${PLACE_RUNTIME}</script> in the SSR shell.
    new Function(PLACE_RUNTIME)()
  })

  afterEach(() => {
    delete (globalThis as { __place?: unknown }).__place
  })

  test('runtime installs __place with the expected shape', () => {
    expect(globalThis.__place).toBeDefined()
    expect(typeof globalThis.__place.swap).toBe('function')
    expect(typeof globalThis.__place.replay).toBe('function')
    expect(Array.isArray(globalThis.__place.q)).toBe(true)
    expect(typeof globalThis.__place.r).toBe('object')
  })

  test('captures a click via the document-level capturing listener', () => {
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    // Synthetic events have isTrusted=false and the runtime is supposed
    // to skip them (otherwise replay would loop). Verify the skip:
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(globalThis.__place.q.length).toBe(0) // skipped (isTrusted false)
  })

  test('replay() drains the buffer and dispatches against the same target', () => {
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    let clickCount = 0
    btn.addEventListener('click', () => {
      clickCount++
    })
    // Manually push a captured event (simulating the capture path with
    // a "trusted" record — we can't fake isTrusted in JSDOM, so we
    // shortcut by injecting directly into the buffer).
    globalThis.__place.q.push({ type: 'click', target: btn })
    expect(globalThis.__place.q.length).toBe(1)
    globalThis.__place.replay()
    expect(clickCount).toBe(1)
    expect(globalThis.__place.q.length).toBe(0) // drained
  })

  test('replay() skips records whose target is no longer in the DOM', () => {
    const btn = document.createElement('button')
    let clickCount = 0
    btn.addEventListener('click', () => {
      clickCount++
    })
    // Push a click for a NEVER-attached target.
    globalThis.__place.q.push({ type: 'click', target: btn })
    globalThis.__place.replay()
    expect(clickCount).toBe(0) // not connected → skipped
  })

  test('replay() handles multiple buffered events in order', () => {
    const a = document.createElement('button')
    const b = document.createElement('button')
    a.id = 'a'
    b.id = 'b'
    document.body.appendChild(a)
    document.body.appendChild(b)
    const order: string[] = []
    a.addEventListener('click', () => order.push('a'))
    b.addEventListener('click', () => order.push('b'))
    globalThis.__place.q.push({ type: 'click', target: a })
    globalThis.__place.q.push({ type: 'click', target: b })
    globalThis.__place.q.push({ type: 'click', target: a })
    globalThis.__place.replay()
    expect(order).toEqual(['a', 'b', 'a'])
  })

  test('swap() replaces comment-marker range with template content', () => {
    document.body.innerHTML =
      '<div>before</div><!--p:0--><span>fallback</span><!--/p:0--><div>after</div>' +
      '<template id="c-0"><span class="real">real content</span></template>'
    globalThis.__place.swap(0)
    // The fallback span between the comments should be gone.
    expect(document.body.innerHTML).not.toContain('fallback')
    // The real content should be inserted in place.
    expect(document.body.innerHTML).toContain('real content')
    // The comment markers are removed after swap so subsequent
    // treeWalker scans don't visit them. (Templates only exist once,
    // so leaving the markers wouldn't break re-swap correctness — but
    // freeing the nodes keeps the comment count down on pages with
    // many streaming boundaries.)
    expect(document.body.innerHTML).not.toContain('<!--p:0-->')
    expect(document.body.innerHTML).not.toContain('<!--/p:0-->')
    // The before/after content is preserved.
    expect(document.body.innerHTML).toContain('<div>before</div>')
    expect(document.body.innerHTML).toContain('<div>after</div>')
    // The <template> is removed after swap.
    expect(document.body.querySelector('#c-0')).toBeNull()
  })

  test('swap() with missing template id is a no-op (no throw)', () => {
    document.body.innerHTML = '<!--p:99--><span>x</span><!--/p:99-->'
    expect(() => globalThis.__place.swap(99)).not.toThrow()
    // Body unchanged.
    expect(document.body.innerHTML).toContain('<span>x</span>')
  })

  test('swap() with missing markers is a no-op', () => {
    document.body.innerHTML = '<template id="c-7"><span>x</span></template>'
    expect(() => globalThis.__place.swap(7)).not.toThrow()
  })

  test('runtime is idempotent — running it twice does not double-install', () => {
    const beforeQ = globalThis.__place.q
    const beforeSwap = globalThis.__place.swap
    new Function(PLACE_RUNTIME)()
    // Same `q` reference and same `swap` function — the second eval
    // hit the `_i` guard and returned without reassigning.
    expect(globalThis.__place.q).toBe(beforeQ)
    expect(globalThis.__place.swap).toBe(beforeSwap)
  })

  // Helper: synthesise an event that passes the runtime's `isTrusted`
  // gate. happy-dom defaults synthetic events to isTrusted=false; real
  // browsers reserve trusted events for actual user input. Overriding
  // via Object.defineProperty is the canonical test-only escape hatch.
  const trusted = <E extends Event>(ev: E): E => {
    Object.defineProperty(ev, 'isTrusted', { value: true })
    return ev
  }

  test('capture: click on [data-place-link] is preventDefaulted and queued', () => {
    const a = document.createElement('a')
    a.href = '/foo'
    a.setAttribute('data-place-link', '')
    document.body.appendChild(a)
    const click = trusted(new MouseEvent('click', { bubbles: true, cancelable: true }))
    a.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(globalThis.__place.q.length).toBe(1)
    expect(globalThis.__place.q[0]?.type).toBe('click')
    expect(globalThis.__place.q[0]?.target).toBe(a)
  })

  test('capture: click on plain <a> is NOT preventDefaulted (framework leaves user content alone)', () => {
    const a = document.createElement('a')
    a.href = '/external'
    document.body.appendChild(a)
    const click = trusted(new MouseEvent('click', { bubbles: true, cancelable: true }))
    a.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    expect(globalThis.__place.q.length).toBe(0)
  })

  test('capture: modifier-click on [data-place-link] is deferred to the browser', () => {
    const a = document.createElement('a')
    a.href = '/foo'
    a.setAttribute('data-place-link', '')
    document.body.appendChild(a)
    // Cmd-click → open in new tab; runtime must NOT preventDefault.
    const click = trusted(
      new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }),
    )
    a.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    expect(globalThis.__place.q.length).toBe(0)
  })

  test('capture: submit on [data-place-form] is preventDefaulted and queued', () => {
    const f = document.createElement('form')
    f.setAttribute('data-place-form', '')
    document.body.appendChild(f)
    const submit = trusted(new Event('submit', { bubbles: true, cancelable: true }))
    f.dispatchEvent(submit)
    expect(submit.defaultPrevented).toBe(true)
    expect(globalThis.__place.q.length).toBe(1)
    expect(globalThis.__place.q[0]?.type).toBe('submit')
    expect(globalThis.__place.q[0]?.target).toBe(f)
  })

  test('capture: submit on plain <form> is NOT preventDefaulted', () => {
    const f = document.createElement('form')
    document.body.appendChild(f)
    const submit = trusted(new Event('submit', { bubbles: true, cancelable: true }))
    f.dispatchEvent(submit)
    expect(submit.defaultPrevented).toBe(false)
    expect(globalThis.__place.q.length).toBe(0)
  })

  test('replay: submit event re-emits with the captured submitter', () => {
    const f = document.createElement('form')
    const btnA = document.createElement('button')
    const btnB = document.createElement('button')
    btnA.type = 'submit'
    btnB.type = 'submit'
    btnA.name = 'action'
    btnB.name = 'action'
    btnA.value = 'save'
    btnB.value = 'delete'
    f.appendChild(btnA)
    f.appendChild(btnB)
    document.body.appendChild(f)

    let observedSubmitter: HTMLElement | null = null
    f.addEventListener('submit', (e) => {
      observedSubmitter = (e as SubmitEvent).submitter
      e.preventDefault()
    })

    // Simulate captured submit with submitter=btnB ("delete" button).
    globalThis.__place.q.push({
      type: 'submit',
      target: f,
      // @ts-expect-error — submitter is part of the new record shape
      submitter: btnB,
    })
    globalThis.__place.replay()
    expect(observedSubmitter).toBe(btnB)
  })

  test('replay() detaches the document-level capture handlers', () => {
    // happy-dom synthesises events with isTrusted=false, so the capture
    // handler's `if(!e.isTrusted)return` would already short-circuit a
    // post-replay dispatch — masking a regression where replay forgets
    // to detach. Spy on `removeEventListener` so we assert the detach
    // direct (this is the contract the runtime must keep).
    const removed: Array<{ type: string; capture: boolean }> = []
    const orig = document.removeEventListener.bind(document)
    document.removeEventListener = ((
      type: string,
      listener: EventListener,
      opts?: EventListenerOptions | boolean,
    ) => {
      const capture = typeof opts === 'boolean' ? opts : !!opts?.capture
      removed.push({ type, capture })
      return orig(type, listener, opts)
    }) as typeof document.removeEventListener

    try {
      globalThis.__place.replay()
      const detachedClick = removed.find((r) => r.type === 'click' && r.capture === true)
      const detachedSubmit = removed.find((r) => r.type === 'submit' && r.capture === true)
      expect(detachedClick).toBeDefined()
      expect(detachedSubmit).toBeDefined()
    } finally {
      document.removeEventListener = orig
    }
  })
})
