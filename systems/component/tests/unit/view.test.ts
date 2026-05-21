// @vitest-environment happy-dom
//
// Tests for the unified `view()` factory (ADR 0030 Phase 1).
//
// Three emit paths exercised end-to-end:
//   - level: 'static'  → no marker, no registry, SSR HTML verbatim
//   - level: 'island'  → identical to `island()` (registry + marker)
//   - level: 'thaw'    → throws at definition time with migration hint
//
// `island+stream` aliases to `'island'`; not separately tested at
// emission level — covered by the SSR/streaming integration tests.

import { beforeEach, describe, expect, test } from 'vitest'
import { _drainPendingIslands, _setIslandRegistry, island, view } from '../../src/index.ts'

const SRC = 'file:///fake/src/test-view.tsx'

describe('view() — emit-level paths', () => {
  beforeEach(() => {
    _setIslandRegistry({})
  })

  // ─── static (L0) ──────────────────────────────────────────────────

  test("level: 'static' — emits HTML with NO data-view-id marker", () => {
    const v = view(
      SRC,
      () => ({
        toHtml: () => '<span class="pure">hi</span>',
        mount: (parent: ParentNode) => {
          const s = document.createElement('span')
          s.textContent = 'hi'
          parent.appendChild(s)
          return () => s.remove()
        },
      }),
      { level: 'static' },
    )
    const html = v({}).toHtml?.() ?? ''
    expect(html).toBe('<span class="pure">hi</span>')
    // No marker — the data-view-id attribute MUST NOT appear in the
    // SSR'd output for a static view.
    expect(html).not.toContain('data-view-id')
    expect(html).not.toContain('data-view="island"')
  })

  test("level: 'static' — does NOT register with the island bundler", () => {
    // Drain any pending islands from prior tests so the count below
    // measures only this test's contribution.
    const baseline = Object.keys(_drainPendingIslands()).length
    view(
      'file:///fake/src/never-bundled.tsx',
      () => ({ toHtml: () => '', mount: () => () => {} }),
      { level: 'static' },
    )
    // Critical: a static view's name must NOT appear in the pending
    // bundler registry, or the bundler would emit a per-island bundle
    // for code that ships no JS. Pending islands accumulate across
    // multiple `view()` / `island()` calls; the count must not have
    // grown from this static call.
    const after = _drainPendingIslands()
    expect(after['never-bundled']).toBeUndefined()
    expect(Object.keys(after).length).toBe(baseline)
  })

  test("level: 'static' — props flow into the impl, `client` prop stripped", () => {
    let captured: Record<string, unknown> | null = null
    const v = view<{ title: string }>(
      SRC,
      (props) => {
        captured = props as Record<string, unknown>
        return { toHtml: () => `<h1>${props.title}</h1>`, mount: () => () => {} }
      },
      { level: 'static' },
    )
    // The framework-reserved `client` strategy prop must be stripped
    // BEFORE reaching the user's impl — same convention as island().
    const html =
      v({ title: 'Hello', client: 'idle' } as unknown as { title: string }).toHtml?.() ?? ''
    expect(html).toBe('<h1>Hello</h1>')
    expect(captured).toEqual({ title: 'Hello' })
    expect(captured).not.toHaveProperty('client')
  })

  test("level: 'static' — mount() renders into a container without a marker", () => {
    const v = view(
      SRC,
      () => ({
        toHtml: () => '<button>x</button>',
        mount: (parent: ParentNode) => {
          const b = document.createElement('button')
          b.textContent = 'x'
          parent.appendChild(b)
          return () => b.remove()
        },
      }),
      { level: 'static' },
    )
    const container = document.createElement('div')
    const dispose = v({}).mount(container, null)
    expect(container.innerHTML).toBe('<button>x</button>')
    dispose()
    expect(container.innerHTML).toBe('')
  })

  // ─── island (L2) ──────────────────────────────────────────────────

  test("level: 'island' — registers + emits marker (identical to island())", () => {
    _drainPendingIslands() // clear pending so the registration check below measures THIS call
    const v = view(SRC, () => ({ toHtml: () => '<b>x</b>', mount: () => () => {} }), {
      level: 'island',
    })
    const html = v({}).toHtml?.() ?? ''
    expect(html).toContain('data-view="island"')
    expect(html).toContain('data-view-id="test-view"')
    expect(_drainPendingIslands()['test-view']).toBeDefined()
  })

  test("level: undefined (default) — same as 'island'", () => {
    _drainPendingIslands()
    const v = view(SRC, () => ({ toHtml: () => '<b>x</b>', mount: () => () => {} }))
    const html = v({}).toHtml?.() ?? ''
    expect(html).toContain('data-view-id="test-view"')
    expect(_drainPendingIslands()['test-view']).toBeDefined()
  })

  // ─── island+stream (L3) — aliases to island ──────────────────────

  test("level: 'island+stream' — aliases to 'island' (Suspense wraps from outside)", () => {
    _drainPendingIslands()
    const v = view(SRC, () => ({ toHtml: () => '<b>x</b>', mount: () => () => {} }), {
      level: 'island+stream',
    })
    const html = v({}).toHtml?.() ?? ''
    expect(html).toContain('data-view-id="test-view"')
    expect(_drainPendingIslands()['test-view']).toBeDefined()
  })

  // ─── thaw (L1) — not built ───────────────────────────────────────

  test("level: 'thaw' — throws at definition time with a migration hint", () => {
    expect(() =>
      view(SRC, () => ({ toHtml: () => '', mount: () => () => {} }), { level: 'thaw' }),
    ).toThrow(/L1 thaw runtime is deferred/)
  })
})

// ─── island() backward compatibility ───────────────────────────────

describe('island() — deprecated alias of view()', () => {
  beforeEach(() => {
    _setIslandRegistry({})
  })

  test('island(src, fn) still registers and emits the L2 marker', () => {
    const v = island(SRC, () => ({ toHtml: () => '<b>x</b>', mount: () => () => {} }))
    const html = v({}).toHtml?.() ?? ''
    expect(html).toContain('data-view-id="test-view"')
  })
})
