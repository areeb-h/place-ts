// `<Can>` — RBAC gate primitive (T16-E, ADR 0044).
//
// Renders its children only if the current session's `.can(action)`
// predicate returns true. Fails closed — no session installed, or no
// `.can` populated on the session, OR `.can(action)` returns
// false/undefined → renders `otherwise` (or nothing).
//
// **Why this lives in `@place-ts/security`, not `@place-ts/design`**.
// `<Can>` is a behavior primitive that reads `SessionCap`, not a
// visual component. Putting it next to its data source (Session) is
// the right scope. The design library can still compose with it.
//
// **No async, no JS shipped for static gates**. The predicate is
// synchronous (resolved at session-install time). When the page
// renders server-side, the gate's branch is decided server-side too
// — denied content NEVER appears in the SSR'd HTML, NEVER ships JS
// for the hidden island, and is invisible to view-source. This is
// the "security through serialization" property: the unauthorized
// branch's component tree doesn't even run.
//
// **Reactive sessions**. The predicate runs inside the rendered
// reactive function child, so if the session capability is updated
// reactively at runtime (logout via SPA-nav, for example), the gate
// re-evaluates. The common case (server-set session, persists for
// the request) is the static read.
//
// Usage:
//
//   import { Can } from '@place-ts/security'
//   import { Button } from '@place-ts/design'
//
//   <Can do="post.delete">
//     <Button intent="destructive" on:click={remove}>Delete</Button>
//   </Can>
//
//   <Can do="admin.users.read" otherwise="You don't have access.">
//     <UserTable />
//   </Can>
//
// Free-form action strings. The shape is opaque to `<Can>`; whatever
// `session.can()` resolves is what gets gated. Apps choose: dotted
// names, RBAC role:resource:verb tuples, Cerbos policy IDs, etc.

import { type Child, Fragment, type View } from '@place-ts/component'
import { SessionCap } from './index.ts'

export interface CanProps {
  /**
   * The action being gated. Free-form string; passed verbatim to
   * `session.can()`. Conventional shapes — dotted names
   * (`post.delete`), RBAC tuples (`admin:users:read`), policy IDs
   * (`cerbos:post:delete`) — are all valid; the predicate decides.
   */
  readonly do: string
  /**
   * Content rendered when the predicate allows the action. Standard
   * Children type — a static View, a function returning a View, an
   * array, etc.
   */
  readonly children?: Child
  /**
   * Content rendered when the predicate denies (or when no session /
   * no predicate is installed). Optional — omit to render nothing on
   * deny. Common patterns: a fallback message, a disabled-state
   * indicator, a "request access" link.
   */
  readonly otherwise?: Child
}

/**
 * @provisional — shipped in Tier 16 (ADR 0044). The shape may grow
 * to support a list-of-actions form (`<Can all={['a','b']}>`,
 * `<Can any={['a','b']}>`) and a child-fn form
 * (`<Can do="…">{(allowed) => …}</Can>`) when a concrete use case
 * triggers them. The single-action form is stable.
 */
export function Can(props: CanProps): View {
  return Fragment({
    children: () => {
      const session = SessionCap.tryUse()
      const allowed = session?.can?.(props.do) === true
      return allowed ? (props.children ?? null) : (props.otherwise ?? null)
    },
  })
}
