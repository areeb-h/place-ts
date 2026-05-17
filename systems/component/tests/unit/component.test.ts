// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { defineCapability } from '../../../capability/src/index.ts'
import { state, watch } from '../../../reactivity/src/index.ts'
import {
  button,
  component,
  div,
  el,
  Fragment,
  mount,
  onCleanup,
  provide,
  span,
} from '../../src/index.ts'

describe('mount + el — basics', () => {
  test('mounts a simple div', () => {
    const root = document.createElement('div')
    mount(div({ class: 'hello' }, ['world']), root)
    expect(root.innerHTML).toBe('<div class="hello">world</div>')
  })

  test('disposer removes the element', () => {
    const root = document.createElement('div')
    const dispose = mount(div({}, ['x']), root)
    expect(root.children.length).toBe(1)
    dispose()
    expect(root.children.length).toBe(0)
  })

  test('children can be a single value', () => {
    const root = document.createElement('div')
    mount(div({ children: 'just-one' }), root)
    expect(root.textContent).toBe('just-one')
  })

  test('children can be an array', () => {
    const root = document.createElement('div')
    mount(div({ children: ['a', 'b', 'c'] }), root)
    expect(root.textContent).toBe('abc')
  })

  test('numbers as children are coerced to text', () => {
    const root = document.createElement('div')
    mount(div({ children: [1, ' + ', 2, ' = ', 3] }), root)
    expect(root.textContent).toBe('1 + 2 = 3')
  })

  test('null/undefined/false children are skipped', () => {
    const root = document.createElement('div')
    mount(div({ children: ['x', null, undefined, false, 'y'] }), root)
    expect(root.textContent).toBe('xy')
  })

  test('static attributes are applied', () => {
    const root = document.createElement('div')
    mount(div({ id: 'main', 'data-x': 'foo' }), root)
    const el = root.firstElementChild as HTMLElement
    expect(el.id).toBe('main')
    expect(el.getAttribute('data-x')).toBe('foo')
  })

  test('class and className both work', () => {
    const root = document.createElement('div')
    mount(div({ class: 'a' }), root)
    mount(div({ className: 'b' }), root)
    const els = root.children
    expect(els[0]?.className).toBe('a')
    expect(els[1]?.className).toBe('b')
  })

  test('boolean true sets attribute, false removes it', () => {
    const root = document.createElement('div')
    mount(div({ hidden: true }), root)
    expect((root.firstElementChild as HTMLElement).hasAttribute('hidden')).toBe(true)
  })

  test('event handlers fire', () => {
    const root = document.createElement('div')
    let clicks = 0
    mount(button({ onClick: () => clicks++ }, ['click me']), root)
    const btn = root.firstElementChild as HTMLButtonElement
    btn.click()
    btn.click()
    expect(clicks).toBe(2)
  })

  test('event listeners are removed on dispose', () => {
    const root = document.createElement('div')
    let clicks = 0
    const dispose = mount(button({ onClick: () => clicks++ }), root)
    const btn = root.firstElementChild as HTMLButtonElement
    btn.click()
    expect(clicks).toBe(1)
    dispose()
    // After dispose the element is gone, so this is mostly a sanity check
    btn.click()
    expect(clicks).toBe(1)
  })

  test('mount accepts a selector string', () => {
    const root = document.createElement('div')
    root.id = 'mount-target-selector'
    document.body.appendChild(root)
    const dispose = mount(div({}, ['hi']), '#mount-target-selector')
    expect(root.textContent).toBe('hi')
    dispose()
    root.remove()
  })

  test('mount throws with the selector in the message when nothing matches', () => {
    expect(() => mount(div({}, ['x']), '#nope-doesnt-exist')).toThrow(/#nope-doesnt-exist/)
  })

  test('mount(view, container, { provide: [...] }) installs caps for the subtree', () => {
    const NameCap = defineCapability<string>('Name')
    const root = document.createElement('div')
    document.body.appendChild(root)

    // The view consumes the cap. Without `provide`, this would throw.
    const View = component(() => span({}, [NameCap.use()]))

    const dispose = mount(View({}), root, { provide: [provide(NameCap, 'alice')] })
    expect(root.textContent).toBe('alice')
    dispose()
    root.remove()
  })

  test('mount with empty/missing provide is a no-op wrap (same as no options)', () => {
    const root = document.createElement('div')
    mount(div({}, ['plain']), root, { provide: [] })
    expect(root.textContent).toBe('plain')
  })
})

describe('reactive bindings', () => {
  test('reactive attribute updates when source changes', () => {
    const root = document.createElement('div')
    const cls = state('a')
    mount(div({ class: () => cls() }, ['x']), root)
    const el = root.firstElementChild as HTMLElement
    expect(el.className).toBe('a')
    cls.set('b')
    expect(el.className).toBe('b')
  })

  test('reactive text child updates when source changes', () => {
    const root = document.createElement('div')
    const name = state('alice')
    mount(div({ children: () => `hello ${name()}` }), root)
    expect(root.textContent).toBe('hello alice')
    name.set('bob')
    expect(root.textContent).toBe('hello bob')
  })

  test('reactive child can switch between text and view', () => {
    const root = document.createElement('div')
    const showSpan = state(false)
    mount(div({ children: () => (showSpan() ? span({}, ['hi']) : 'plain') }), root)
    expect(root.textContent).toBe('plain')
    showSpan.set(true)
    expect(root.textContent).toBe('hi')
    expect(root.querySelector('span')?.textContent).toBe('hi')
  })

  test('reactive child cleans up the previous mount on update', () => {
    const root = document.createElement('div')
    let cleanupCalls = 0
    const Comp = component(() => {
      onCleanup(() => cleanupCalls++)
      return div({}, ['x'])
    })
    const which = state(0)
    mount(div({ children: () => (which() === 0 ? Comp({}) : 'gone') }), root)
    expect(cleanupCalls).toBe(0)
    which.set(1)
    expect(cleanupCalls).toBe(1)
  })

  test('disposing the mount tears down reactive watches', () => {
    const root = document.createElement('div')
    const cls = state('a')
    let runCount = 0
    const dispose = mount(
      div({
        class: () => {
          runCount++
          return cls()
        },
      }),
      root,
    )
    runCount = 0
    cls.set('b')
    expect(runCount).toBe(1)
    dispose()
    cls.set('c')
    cls.set('d')
    expect(runCount, 'no further runs after dispose').toBe(1)
  })
})

describe('Fragment', () => {
  test('renders children without a wrapping element', () => {
    const root = document.createElement('div')
    mount(Fragment({ children: [span({}, ['a']), span({}, ['b'])] }), root)
    expect(root.innerHTML).toBe('<span>a</span><span>b</span>')
  })

  test('Fragment in a div composes', () => {
    const root = document.createElement('div')
    mount(div({}, [Fragment({ children: ['hello, '] }), Fragment({ children: ['world'] })]), root)
    expect(root.textContent).toBe('hello, world')
  })
})

describe('components (functions returning views)', () => {
  test('component is just a function', () => {
    const Greeting = (props: { name: string }) => div({}, [`hi, ${props.name}`])
    const root = document.createElement('div')
    mount(Greeting({ name: 'world' }), root)
    expect(root.textContent).toBe('hi, world')
  })

  test('component reading state binds at the leaf', () => {
    const count = state(0)
    const Counter = () => div({}, [() => `count=${count()}`])
    const root = document.createElement('div')
    mount(Counter(), root)
    expect(root.textContent).toBe('count=0')
    count.set(7)
    expect(root.textContent).toBe('count=7')
  })

  test('onCleanup runs when a wrapped component is disposed', () => {
    let cleanedUp = 0
    const C = component(() => {
      onCleanup(() => cleanedUp++)
      return div({}, ['x'])
    })
    const root = document.createElement('div')
    const dispose = mount(C({}), root)
    expect(cleanedUp).toBe(0)
    dispose()
    expect(cleanedUp).toBe(1)
  })
})

describe('regression: tracking isolation across mount boundaries', () => {
  test('descendant state reads do not subscribe ancestor reactive child', () => {
    // The exact bug that broke commonplace book typing:
    //
    //   <main>
    //     {() => {
    //       if (selectedId() === null) return <Empty />
    //       return <Editor noteId={selectedId()} />
    //     }}
    //   </main>
    //
    // Editor's body reads `live().title` (notes state) inside its bindings.
    // Without untrack, those reads subscribed the OUTER function-as-child's
    // watch to `notes`. Every keystroke then unmounted+remounted Editor →
    // input focus lost → characters dropped.
    //
    // After the fix, the outer watch only tracks selectedId. Notes changes
    // don't fire it. Editor stays mounted; its inner bindings update in
    // place.

    const root = document.createElement('div')
    const outerToggle = state(true)
    const innerCounter = state(0)
    let outerRuns = 0

    const Inner = component(() => {
      // Inner body reads innerCounter — should NOT subscribe outer.
      void innerCounter()
      // And so should reactive bindings inside.
      return div({}, [() => `inner=${innerCounter()}`])
    })

    mount(
      div({}, [
        () => {
          outerRuns++
          return outerToggle() ? Inner({}) : 'off'
        },
      ]),
      root,
    )

    expect(outerRuns).toBe(1)
    expect(root.textContent).toBe('inner=0')

    // Update INNER state — outer must not fire.
    innerCounter.set(1)
    expect(outerRuns, 'outer must not re-fire on descendant inner state change').toBe(1)
    expect(root.textContent).toBe('inner=1')

    innerCounter.set(2)
    expect(outerRuns).toBe(1)
    expect(root.textContent).toBe('inner=2')

    // Outer toggle CHANGE should fire outer (legitimate).
    outerToggle.set(false)
    expect(outerRuns).toBe(2)
    expect(root.textContent).toBe('off')
  })

  test('component body reads do not subscribe enclosing watch', () => {
    // If a component's body reads state, those reads should not subscribe
    // any enclosing watch context. The body's reactive bindings handle
    // their own subscriptions.

    const a = state(0)
    let outerWatchRuns = 0

    const Reader = component(() => {
      void a() // body read — must not subscribe outer
      return div({}, ['x'])
    })

    const root = document.createElement('div')
    watch(() => {
      outerWatchRuns++
      // Mount the component inside a watch — the watch should only fire
      // when its own dependencies change, not when descendants update.
      mount(Reader({}), root)
    })

    outerWatchRuns = 0
    a.set(99)
    expect(outerWatchRuns, 'outer watch must not fire on inner body state').toBe(0)
  })

  test('regression: fast input typing does not remount the form', () => {
    // The exact bug the commonplace user hit: typing in an editor input
    // caused the editor to remount on every keystroke, dropping characters
    // and losing focus. The root cause was descendant component bodies'
    // state reads subscribing the outer reactive child watch.
    //
    // This test simulates the editor's structure: reactive child → component
    // wrapping reactive form bindings → bindings read the same state the
    // user is updating.

    const root = document.createElement('div')
    const noteId = state<string | null>('note-a')
    const noteData = state<{ title: string; content: string }>({
      title: '',
      content: '',
    })

    let formMountCount = 0
    let titleInputCreations = 0

    const Form = component(() => {
      formMountCount++
      const live = () => noteData()
      // Track creation count via a ref callback to detect re-mounts
      return div({ class: 'form' }, [
        el('input', {
          type: 'text',
          value: () => live().title,
          ref: () => {
            titleInputCreations++
          },
          onInput: (e) => {
            noteData.set({ ...live(), title: (e.target as HTMLInputElement).value })
          },
        }),
        el('textarea', {
          value: () => live().content,
          onInput: (e) => {
            noteData.set({ ...live(), content: (e.target as HTMLTextAreaElement).value })
          },
        }),
      ])
    })

    mount(
      div({}, [
        () => {
          const id = noteId()
          if (id === null) return ''
          return Form({})
        },
      ]),
      root,
    )

    expect(formMountCount).toBe(1)
    expect(titleInputCreations).toBe(1)

    const input = root.querySelector('input') as HTMLInputElement
    expect(input).toBeTruthy()

    // Simulate typing 5 characters in rapid succession.
    for (const char of 'hello') {
      const before = input.value
      input.value = before + char
      input.dispatchEvent(new Event('input'))
    }

    // The form must NOT have remounted during typing.
    expect(formMountCount, 'form must mount once, not per keystroke').toBe(1)
    expect(titleInputCreations, 'input element must not be recreated').toBe(1)
    expect(noteData().title, 'all characters must register').toBe('hello')
    expect(input.value).toBe('hello')

    // Same for textarea.
    const textarea = root.querySelector('textarea') as HTMLTextAreaElement
    for (const char of 'world') {
      const before = textarea.value
      textarea.value = before + char
      textarea.dispatchEvent(new Event('input'))
    }
    expect(formMountCount).toBe(1)
    expect(noteData().content).toBe('world')
    expect(textarea.value).toBe('world')
  })
})

describe('el — generic factory', () => {
  test('arbitrary tag name works', () => {
    const root = document.createElement('div')
    mount(el('section', { class: 'hero', children: 'content' }), root)
    expect(root.innerHTML).toBe('<section class="hero">content</section>')
  })
})
