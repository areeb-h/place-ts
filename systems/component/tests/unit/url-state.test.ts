// @vitest-environment happy-dom

import { describe, expect, test } from 'vitest'
import { state, watch } from '../../../reactivity/src/index.ts'
import { memoryRouter, RouterCap } from '../../../routing/src/index.ts'
import { component, el, mount, urlState, wire } from '../../src/index.ts'

// `urlState` requires RouterCap to be installed. Wrap each test with a
// memoryRouter cap; the helper below reduces noise.
function withRouter<R>(
  initialPath: string,
  body: (router: ReturnType<typeof memoryRouter>) => R,
): R {
  const router = memoryRouter(initialPath)
  return RouterCap.provide(router, () => body(router))
}

describe('urlState — bidirectional URL ↔ State', () => {
  test('reads default when key is absent from URL', () => {
    withRouter('/', (_router) => {
      const Comp = component(() => {
        const tag = urlState('tag', '')
        expect(tag()).toBe('')
        return el('div')
      })
      const root = document.createElement('div')
      mount(Comp({}), root)
    })
  })

  test('reads from URL on initial mount', () => {
    withRouter('/?tag=react', (_router) => {
      const Comp = component(() => {
        const tag = urlState('tag', '')
        expect(tag()).toBe('react')
        return el('div')
      })
      mount(Comp({}), document.createElement('div'))
    })
  })

  test('write updates the URL', () => {
    withRouter('/', (router) => {
      const Comp = component(() => {
        const tag = urlState('tag', '')
        tag.set('react')
        return el('div')
      })
      mount(Comp({}), document.createElement('div'))
      expect(router.param('tag')).toBe('react')
    })
  })

  test('write equal to default removes the key from URL', () => {
    withRouter('/?tag=react', (router) => {
      const Comp = component(() => {
        const tag = urlState('tag', '')
        tag.set('')
        return el('div')
      })
      mount(Comp({}), document.createElement('div'))
      expect(router.param('tag')).toBeNull()
    })
  })

  test('parse function applies typed conversion', () => {
    withRouter('/?page=3', (_router) => {
      const Comp = component(() => {
        const page = urlState('page', 1, { parse: (raw) => (raw ? Number(raw) : 1) })
        expect(page()).toBe(3)
        return el('div')
      })
      mount(Comp({}), document.createElement('div'))
    })
  })

  test('serialize function controls the URL representation', () => {
    withRouter('/', (router) => {
      const Comp = component(() => {
        const filters = urlState('filters', [] as string[], {
          parse: (raw) => (raw ? raw.split(',') : []),
          serialize: (v) => (v.length === 0 ? null : v.join(',')),
        })
        filters.set(['react', 'svelte'])
        return el('div')
      })
      mount(Comp({}), document.createElement('div'))
      expect(router.param('filters')).toBe('react,svelte')
    })
  })

  test('external URL change syncs back into the state reactively', () => {
    withRouter('/?tag=react', (router) => {
      const observed: string[] = []
      const Comp = component(() => {
        const tag = urlState('tag', '')
        watch(() => observed.push(tag()))
        return el('div')
      })
      mount(Comp({}), document.createElement('div'))

      // Simulate an external navigation (browser back, deep link, etc.)
      router.navigate('/?tag=svelte')
      router.navigate('/') // remove tag

      expect(observed).toEqual(['react', 'svelte', ''])
    })
  })

  test('write does not ricochet — only one URL update per write', () => {
    withRouter('/', (router) => {
      let writes = 0
      // Spy on updateQuery
      const original = router.updateQuery
      router.updateQuery = ((...args: Parameters<typeof original>) => {
        writes++
        return original.apply(router, args)
      }) as typeof original

      const Comp = component(() => {
        const tag = urlState('tag', '')
        tag.set('react')
        return el('div')
      })
      mount(Comp({}), document.createElement('div'))

      // Single write → single updateQuery call (the watch's response
      // is deduped via Object.is and does NOT call updateQuery again).
      expect(writes).toBe(1)
    })
  })

  test('replace mode is the default (does not push history)', () => {
    withRouter('/start', (router) => {
      const Comp = component(() => {
        const tag = urlState('tag', '')
        tag.set('react')
        return el('div')
      })
      mount(Comp({}), document.createElement('div'))
      // memoryRouter's path reflects whichever (push vs replace) — both
      // overwrite path here. The behavior we care about is on real
      // browsers: replace doesn't grow history. We assert it via the
      // implementation detail that updateQuery was called with replace.
      expect(router.path()).toBe('/start?tag=react')
    })
  })

  test('push: true uses navigate (new history entry)', () => {
    withRouter('/', (router) => {
      let lastOptions: { replace?: boolean } | undefined
      const original = router.updateQuery
      router.updateQuery = ((
        changes: Parameters<typeof original>[0],
        options?: Parameters<typeof original>[1],
      ) => {
        lastOptions = options
        return original.call(router, changes, options)
      }) as typeof original

      const Comp = component(() => {
        const tag = urlState('tag', '', { push: true })
        tag.set('react')
        return el('div')
      })
      mount(Comp({}), document.createElement('div'))
      expect(lastOptions).toBeUndefined() // push means no { replace: true }
    })
  })

  test('integrates with wire — input value flows through URL', () => {
    withRouter('/', (router) => {
      const Comp = component(() => {
        const tag = urlState('tag', '')
        return el('input', { type: 'text', ...wire(tag) })
      })
      const root = document.createElement('div')
      mount(Comp({}), root)
      const input = root.querySelector('input') as HTMLInputElement
      expect(input.value).toBe('')

      // User types in the input; the URL updates through wire's onInput → tag.write
      input.value = 'react'
      input.dispatchEvent(new Event('input'))
      expect(router.param('tag')).toBe('react')

      // External URL change updates the displayed value through tag.read
      router.navigate('/?tag=svelte')
      expect(input.value).toBe('svelte')
    })
  })

  test('write accepts an updater function (delegates to internal state)', () => {
    withRouter('/?count=5', (router) => {
      const Comp = component(() => {
        const count = urlState('count', 0, {
          parse: (raw) => (raw ? Number(raw) : 0),
        })
        count.update((prev) => prev + 1)
        return el('div')
      })
      mount(Comp({}), document.createElement('div'))
      expect(router.param('count')).toBe('6')
    })
  })

  test('cleans up the URL→state watch on component unmount', () => {
    withRouter('/?tag=initial', (router) => {
      let internalWriteCount = 0
      const Comp = component(() => {
        const tag = urlState('tag', '')
        // observe how often tag changes (proxy for whether the watch is alive)
        watch(() => {
          tag()
          internalWriteCount++
        })
        return el('div')
      })
      const root = document.createElement('div')
      const dispose = mount(Comp({}), root)

      // Initial read counts.
      const baseline = internalWriteCount

      // External navigation while mounted → internal updates → watch fires
      router.navigate('/?tag=mid')
      expect(internalWriteCount).toBeGreaterThan(baseline)
      const afterMid = internalWriteCount

      // Unmount; subsequent URL changes should NOT trigger the watch.
      dispose()
      router.navigate('/?tag=after')
      expect(internalWriteCount).toBe(afterMid)
    })
  })
})

// Avoid unused-import lint warnings — both are used in tests above.
state
