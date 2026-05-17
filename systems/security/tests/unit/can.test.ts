// @vitest-environment happy-dom
//
// Tests for the `<Can>` RBAC gate primitive (T16-E, ADR 0044).
//
// Contract:
//   - Fails closed: no session → renders nothing (or `otherwise`).
//   - No `.can` predicate → fails closed.
//   - `.can(action)` must return strictly `true` to allow.
//   - Predicate runs at render time inside a reactive function child,
//     so works for SSR (renderToString) without async work.

import { describe, expect, test } from 'vitest'
import { renderToString } from '../../../component/src/index.ts'
import { div, span } from '../../../component/src/index.ts'
import { Can, type Session, SessionCap } from '../../src/index.ts'

const baseSession = (overrides: Partial<Session> = {}): Session => ({
  id: 's1',
  userId: 'u1',
  issuedAt: 1_000_000,
  expiresAt: null,
  ...overrides,
})

describe('<Can>', () => {
  test('renders children when session.can(action) returns true', () => {
    const session = baseSession({ can: (a) => a === 'post.delete' })
    const html = SessionCap.provide(session, () =>
      renderToString(
        Can({
          do: 'post.delete',
          children: span({}, ['allowed']),
        }),
      ),
    )
    // SSR emits `data-h="N"` hydration markers on every element —
    // assert structure + content, not the exact attribute list.
    expect(html).toMatch(/<span[^>]*>allowed<\/span>/)
  })

  test('renders nothing when session.can(action) returns false', () => {
    const session = baseSession({ can: () => false })
    const html = SessionCap.provide(session, () =>
      renderToString(
        Can({
          do: 'post.delete',
          children: span({}, ['secret']),
        }),
      ),
    )
    expect(html).not.toContain('secret')
  })

  test('renders `otherwise` content when denied', () => {
    const session = baseSession({ can: () => false })
    const html = SessionCap.provide(session, () =>
      renderToString(
        Can({
          do: 'post.delete',
          children: span({}, ['secret']),
          otherwise: span({}, ['denied-fallback']),
        }),
      ),
    )
    expect(html).not.toContain('secret')
    expect(html).toMatch(/<span[^>]*>denied-fallback<\/span>/)
  })

  test('fails closed when no session is installed', () => {
    const html = renderToString(
      Can({
        do: 'post.delete',
        children: span({}, ['secret']),
        otherwise: span({}, ['fallback']),
      }),
    )
    expect(html).not.toContain('secret')
    expect(html).toMatch(/<span[^>]*>fallback<\/span>/)
  })

  test('fails closed when session has no `.can` predicate', () => {
    const session = baseSession()
    const html = SessionCap.provide(session, () =>
      renderToString(
        Can({
          do: 'post.delete',
          children: span({}, ['secret']),
        }),
      ),
    )
    expect(html).not.toContain('secret')
  })

  test('rejects non-strict-true return values', () => {
    // A predicate that returns truthy-but-not-true (e.g. 1, "yes",
    // or an object) is treated as DENY. This is the security
    // principle: `===` true means policy author opted in
    // unambiguously. Any other return is a bug, not a permission.
    const cases: Array<unknown> = [1, 'yes', {}, [], 'true']
    for (const ret of cases) {
      const session = baseSession({ can: () => ret as unknown as boolean })
      const html = SessionCap.provide(session, () =>
        renderToString(
          Can({
            do: 'x',
            children: span({}, ['allowed']),
          }),
        ),
      )
      expect(html).not.toContain('allowed')
    }
  })

  test('passes the `do` string verbatim to .can()', () => {
    const seen: string[] = []
    const session = baseSession({
      can: (a) => {
        seen.push(a)
        return false
      },
    })
    SessionCap.provide(session, () =>
      renderToString(
        Can({
          do: 'admin:users:read',
          children: span({}, ['x']),
        }),
      ),
    )
    expect(seen).toEqual(['admin:users:read'])
  })

  test('allowed branch with complex children composes with other primitives', () => {
    const session = baseSession({ can: () => true })
    const html = SessionCap.provide(session, () =>
      renderToString(
        Can({
          do: 'show',
          children: div({ class: 'card' }, [span({}, ['heading']), span({}, ['body'])]),
        }),
      ),
    )
    expect(html).toContain('class="card"')
    expect(html).toMatch(/<span[^>]*>heading<\/span>/)
    expect(html).toMatch(/<span[^>]*>body<\/span>/)
  })

  test('empty children + empty otherwise renders nothing on either branch', () => {
    const sAllow = baseSession({ can: () => true })
    const sDeny = baseSession({ can: () => false })
    const a = SessionCap.provide(sAllow, () => renderToString(Can({ do: 'x' })))
    const d = SessionCap.provide(sDeny, () => renderToString(Can({ do: 'x' })))
    // Both branches return null → no markup.
    expect(a).toBe('')
    expect(d).toBe('')
  })
})
