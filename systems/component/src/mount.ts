// @place-ts/component — client-side mount machinery + Fragment + Tabs.
//
// Extracted from index.ts (Tier 20 decomposition, cut 4). Holds the
// reactive-children DOM mounter (`mountChildren` / `mountChild` /
// `mountReactiveChild`) that `makeView`'s `.mount()` delegates to,
// plus the `Fragment` grouping primitive and the `Tabs` component —
// the contiguous client-render block that followed the element
// factory in the original file.
//
// `index.ts` re-exports the public surface (`Fragment`, `Tabs`).
// `element.ts` imports `mountChildren` from here, which turns the
// element ⇄ index cycle the cut-3 extraction left behind into a
// benign element ⇄ mount function-level cycle.

import { type Disposer, type State, untrack, watch } from '@place-ts/reactivity'
// Cleanup-scope helper shared with the element factory + SSR path.
import { disposeAll } from './_internal/cleanup.ts'
// `ErrorBoundaryCap` — the error-boundary capability the reactive-child
// + Fragment mounters read. A `_internal/` leaf; no barrel cycle.
import { ErrorBoundaryCap } from './_internal/error-boundary-cap.ts'
import { _isHydratedSignal } from './_internal/hydration.ts'
// Cookie-backed reactive state — backs `<Tabs group>` persistence.
import { cookieState } from './cookies.ts'
// Element factory + SSR string emitter. element.ts ⇄ mount.ts is a
// benign function-level cycle (see header).
import { childToHtml, el } from './element.ts'
// `onMount` still lives in index.ts; touched only inside runtime
// functions, so the mount ⇄ index cycle stays benign.
import { onMount } from './index.ts'
import type { Child, Children, View } from './types.ts'

export function mountChildren(
  parent: ParentNode,
  children: Children,
  anchor: Node | null,
  cleanups: Disposer[],
): void {
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    cleanups.push(mountChild(parent, child, anchor))
  }
}

function mountChild(parent: ParentNode, child: Child, anchor: Node | null): Disposer {
  if (child == null || child === false || child === true) {
    return () => {}
  }

  if (typeof child === 'string' || typeof child === 'number') {
    const node = document.createTextNode(String(child))
    parent.insertBefore(node, anchor)
    return () => node.remove()
  }

  if (typeof child === 'function') {
    return mountReactiveChild(parent, child as () => Child, anchor)
  }

  // Arrays of children: mount each in order, return a composite
  // disposer. Required because `Child` is recursive (`Child[]` is
  // itself a Child), so JSX like `<Frag>{items.map(…)}{conditional}</Frag>`
  // produces an array child at this position. The runtime mirrors what
  // `childToHtml` already does for SSR.
  if (Array.isArray(child)) {
    const disposers: Disposer[] = []
    for (const c of child) {
      disposers.push(mountChild(parent, c as Child, anchor))
    }
    return () => {
      for (const d of disposers) d()
    }
  }

  // It's a View
  return (child as View).mount(parent, anchor)
}

// Reactive child binding: function returns text/number/View. We use a
// comment node as a stable anchor and keep track of whatever was last mounted.
//
// Critical: the descendant `mountChild` call is wrapped in `untrack` so that
// component bodies / nested watches mounted inside this child do not subscribe
// THIS watch to their inner state reads. Without it, a `<NoteEditor>` mounted
// here would have its `live().title` reads (etc.) tracked against the outer
// watch — causing the entire subtree to unmount and remount on every keystroke
// the inner editor handled. That manifests as input focus loss and characters
// being dropped. fn() itself remains tracked because its reactivity is the
// whole point — it tells us when to re-mount.
function mountReactiveChild(parent: ParentNode, fn: () => Child, anchor: Node | null): Disposer {
  const slot = document.createComment('')
  parent.insertBefore(slot, anchor)
  let current: Disposer = () => {}

  const watchDispose = watch(
    () => {
      try {
        current()
        const resolved = fn()
        current = untrack(() => mountChild(parent, resolved, slot))
      } catch (e) {
        // Failed mount: no cleanup to run. Bubble the throw to the
        // nearest error boundary; if none, re-throw so the page surfaces
        // the error loudly instead of silently swallowing.
        current = () => {}
        const handler = ErrorBoundaryCap.tryUse()
        if (handler === null) throw e
        handler(e)
      }
    },
    { name: 'reactive child' },
  )

  return () => {
    watchDispose()
    current()
    slot.remove()
  }
}

// ===== Fragment =====
//
// Groups siblings without adding a wrapping DOM element.

// `_isHydratedState` lives in `./_internal/hydration.ts`; imported at
// the top of this file. It backs `onMount`, the hydration auditor,
// and the internal `ClientOnly` helper below.
//
// The public `<ClientOnly>` / `<Deferred>` full-page-hydration
// corrector components were removed with the islands migration —
// interactive browser-only content belongs in an `island()`. The
// `ClientOnly` helper survives as an INTERNAL primitive only: it
// backs the auto-placeholder `component()` emits when a `clientOnly`
// capability is touched during SSR. Not exported, not auto-imported.

interface ClientOnlyProps {
  children: () => Child
}

export function ClientOnly(props: ClientOnlyProps): View {
  return el('span', { 'data-place-client-only': '', 'data-place-contents': '' }, () =>
    _isHydratedSignal.read() ? props.children() : null,
  )
}

export interface ActivityProps {
  /**
   * Reactive (or static) predicate. Truthy → children visible.
   * Falsy → children stay in the DOM but are hidden (`display:none`).
   */
  when: boolean | (() => boolean)
  children?: Child | Child[]
}

/**
 * Render content that's sometimes hidden — without unmounting it.
 *
 * `<Activity>` is the "render everything, toggle visibility" pattern.
 * Same shape as React 19's `<Activity>`, but powered by the platform:
 * the wrapper uses the browser's `hidden` HTML attribute, which is a
 * UA-stylesheet rule (`display: none`) that strict CSP can't block —
 * no inline style, no nonce, no opt-in. The subtree stays mounted
 * across visibility changes, so any reactive state inside survives
 * — no remount cost, no input focus lost, no scroll reset.
 *
 * Typical use is for tab panels, accordions, wizards — anywhere the
 * UI cycles through alternative views and the work to render them
 * is non-trivial or the state needs to persist.
 *
 * ```tsx
 * {tabs.map(t => (
 *   <Activity when={() => active() === t.label}>
 *     {t.content()}
 *   </Activity>
 * ))}
 * ```
 *
 * Trade-off vs `<Show>`: Activity ships ALL branches in the SSR HTML
 * (so search engines see them; first paint of an inactive tab is
 * instant), whereas Show emits only the active branch. Use Show when
 * the inactive branch is expensive to render or contains side-effects
 * that shouldn't fire when hidden.
 */
export function Activity(props: ActivityProps): View {
  const hidden =
    typeof props.when === 'function' ? () => !(props.when as () => boolean)() : !props.when
  return el(
    'span',
    {
      'data-place-activity': '',
      hidden,
    },
    props.children as Child,
  )
}

// ===== Tabs =====
//
// Compose-with-`<Tab>` tabs primitive. Author shape:
//
// ```tsx
// <Tabs group="hello">
//   <Tab label="place">    <CodeBlock code={PLACE} /></Tab>
//   <Tab label="Next.js">  <CodeBlock code={NEXT}  /></Tab>
//   <Tab label="Remix">    <CodeBlock code={REMIX} /></Tab>
// </Tabs>
// ```
//
// Why this shape:
//   - Label travels with its panel — no parallel-array bookkeeping,
//     no off-by-one mistakes when adding / reordering tabs.
//   - Active-tab persistence is automatic: when `group` is set, the
//     framework wires a `place-tab-${group}` cookie under the hood.
//     Authors don't write `cookieState(...)` themselves.
//   - The framework owns the trigger row, the panel divs, the active
//     state, and the click delegation — author writes content only.
//
// **Hydration model.** Tabs is a server-rendered component. The
// trigger click handling rides on ONE inline document-level
// delegated listener (`__tabs.ts`), included via `<script nonce>`
// once per page when any Tabs renders. No island bundle ships;
// no per-instance JS runs at load. The runtime toggles `hidden` on
// `[data-tabs-panel]` siblings + writes the cookie on click.

const TAB_BRAND_NAME = '__placeTabBrand'
/** Symbol carried on `<Tab>`'s return so `<Tabs>` can introspect children. */
export const TAB_BRAND: symbol = Symbol.for(TAB_BRAND_NAME)

/**
 * Descriptor returned by `<Tab>`. Implements the `View` interface with
 * no-op methods (Tabs renders the panel itself, reading `children`
 * off this descriptor — Tab never appears in the rendered tree).
 */
interface TabDescriptor extends View {
  readonly __tabBrand: symbol
  readonly label: Child
  readonly value: string
  readonly panelChildren: Child
}

export interface TabProps {
  /** Visible trigger label. If a string, doubles as the stable `value`. */
  readonly label: Child
  /**
   * Stable id for this tab. Used as the DOM marker AND the cookie
   * value. Required when `label` isn't a string (e.g. JSX label).
   * Optional otherwise; defaults to the string label.
   */
  readonly value?: string
  /** Panel content. Renders into `<div role="tabpanel">` server-side. */
  readonly children?: Children
}

/**
 * Tab marker for use as a direct child of `<Tabs>`. Returns a
 * descriptor `<Tabs>` reads — never rendered in place.
 *
 * The function value itself carries the `__tabBrand` so the JSX
 * runtime can detect it via `(type as {...}).__tabBrand === TAB_BRAND`
 * and skip the `component()` auto-wrap. Without the brand on the
 * function, the runtime would wrap Tab in component(), strip the
 * descriptor's metadata, and Tabs's child introspection would fail
 * with "at least one <Tab> child required" at every call site.
 */
function _Tab(props: TabProps): View {
  const value = props.value ?? (typeof props.label === 'string' ? props.label : undefined)
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      '<Tab>: pass `value` explicitly when `label` is not a plain string. ' +
        '`value` is the stable id used for the active-tab cookie + DOM markers.',
    )
  }
  const descriptor: TabDescriptor = {
    toHtml: () => '',
    mount: () => () => {},
    hydrate: () => () => {},
    __tabBrand: TAB_BRAND,
    label: props.label,
    value,
    panelChildren: props.children ?? null,
  }
  return descriptor
}
export const Tab: typeof _Tab & { __tabBrand: symbol } = Object.assign(_Tab, {
  __tabBrand: TAB_BRAND,
})

function flattenChildren(children: Child | Children | undefined): Child[] {
  if (children === undefined || children === null) return []
  if (Array.isArray(children)) {
    return children.flatMap((c) => flattenChildren(c as Child))
  }
  return [children as Child]
}

function collectTabs(children: Child | Children | undefined): TabDescriptor[] {
  const flat = flattenChildren(children)
  const out: TabDescriptor[] = []
  for (const c of flat) {
    if (c === null || c === undefined || typeof c !== 'object') continue
    const maybe = c as Partial<TabDescriptor>
    if (maybe.__tabBrand === TAB_BRAND) {
      out.push(maybe as TabDescriptor)
    }
  }
  return out
}

export interface TabsClassNames {
  /** Outer wrapper. */
  readonly root?: string
  /** Trigger list (`role="tablist"`). */
  readonly list?: string
  /** Each trigger button (`role="tab"`). Always applied. */
  readonly trigger?: string
  /** Class added to the active trigger. Concatenated with `trigger`. */
  readonly triggerActive?: string
  /** Each panel wrapper (`role="tabpanel"`). */
  readonly panel?: string
}

/**
 * Quick visual variants. Each picks a different default for the
 * outer chrome + trigger row. `classes` still overrides everything
 * — use `variant` for a one-line theme pick, `classes` for full
 * control.
 *
 *   `'card'`       — bordered rounded box; underline-active triggers (default)
 *   `'underline'`  — no outer border; triggers sit above a bottom rule
 *   `'pill'`       — rounded pill triggers; no outer border
 *   `'ghost'`      — minimal triggers, no chrome
 */
export type TabsVariant = 'card' | 'underline' | 'pill' | 'ghost'

export interface TabsProps {
  /**
   * Stable group id. When set, the framework wires a
   * `place-tab-${group}` cookie for active-tab persistence across
   * reloads. Omit for in-memory (ephemeral) tabs.
   */
  readonly group?: string
  /**
   * `<Tab>` children, in order. The first tab is the default active.
   * Children that aren't `<Tab>` are filtered out with a dev warning.
   */
  readonly children?: Children
  /** Quick visual variant. Default: `'card'`. */
  readonly variant?: TabsVariant
  /** Optional class overrides. Wins over `variant` defaults. */
  readonly classes?: TabsClassNames
}

const TABS_VARIANTS: Readonly<Record<TabsVariant, Required<TabsClassNames>>> = {
  card: {
    root: 'my-4 mb-6 border border-border rounded-[10px] overflow-hidden',
    list: 'flex gap-0 bg-bg/60 border-b border-border/60',
    trigger:
      'bg-transparent border-0 py-2 px-4 text-muted text-[13px] cursor-pointer border-b-2 border-b-transparent transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:text-fg',
    triggerActive: 'text-accent border-b-accent',
    panel: '',
  },
  underline: {
    root: 'my-4 mb-6',
    list: 'flex gap-2 border-b border-border/60 mb-3',
    trigger:
      'bg-transparent border-0 py-2 px-1 text-muted text-[13px] cursor-pointer border-b-2 border-b-transparent transition-colors duration-150 hover:text-fg focus-visible:outline-none focus-visible:text-fg',
    triggerActive: 'text-fg border-b-accent',
    panel: '',
  },
  pill: {
    root: 'my-4 mb-6',
    list: 'inline-flex gap-1 p-1 rounded-lg bg-card/60 border border-border/60 mb-3',
    trigger:
      'bg-transparent border-0 py-1 px-3 text-muted text-[13px] rounded-md cursor-pointer transition-colors duration-150 hover:text-fg focus-visible:outline-none',
    triggerActive:
      'text-fg bg-bg/80 shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-border)_70%,transparent)]',
    panel: '',
  },
  ghost: {
    root: 'my-4 mb-6',
    list: 'flex gap-3 mb-3',
    trigger:
      'bg-transparent border-0 py-1 px-0 text-muted text-[13px] cursor-pointer transition-colors duration-150 hover:text-fg focus-visible:outline-none',
    triggerActive: 'text-accent',
    panel: '',
  },
}

// Per-process anonymous-group counter for `<Tabs>` without a `group`
// prop. Used only as a stable DOM id so the inline runtime can scope
// queries. Resets per renderToString cycle.
let anonTabsGroupCounter = 0

/**
 * Render a tabs widget. Triggers + panels SSR; clicks handled by the
 * page's inlined tabs runtime (`__tabs.ts`).
 *
 * **Active state.** Per-request:
 *   - If `group` is set: read `place-tab-${group}` cookie; fall back
 *     to the first tab's `value` when absent. Cookie writes happen
 *     on click via the inline runtime.
 *   - Otherwise (no group): first tab is active for this render.
 */
export function Tabs(props: TabsProps): View {
  const tabs = collectTabs(props.children)
  const firstTab = tabs[0]
  if (firstTab === undefined) {
    throw new Error(
      '<Tabs>: at least one <Tab> child is required. ' +
        'Use: <Tabs group="…"><Tab label="A">…</Tab><Tab label="B">…</Tab></Tabs>',
    )
  }
  const groupId = props.group ?? `tabs-${++anonTabsGroupCounter}`
  const fallback = firstTab.value
  // SSR-correct active resolution. cookieState reads request cookies
  // on the server, document.cookie on the client.
  const cookieKey = props.group ? `place-tab-${props.group}` : ''
  const active = cookieKey ? cookieState(cookieKey, fallback) : null
  const initial = active ? active() : fallback

  // Signal renderPage that this page needs the tabs runtime. Idempotent
  // across multiple Tabs on the same page.
  if (typeof window === 'undefined') {
    markTabsUsedOnThisRequest()
  }

  const variant = TABS_VARIANTS[props.variant ?? 'card']
  const cls = props.classes ?? {}
  const rootClass = cls.root ?? variant.root
  const listClass = cls.list ?? variant.list
  const triggerBase = cls.trigger ?? variant.trigger
  const triggerActive = cls.triggerActive ?? variant.triggerActive
  const panelClass = cls.panel ?? variant.panel

  return el(
    'div',
    {
      class: rootClass,
      'data-tabs-group': groupId,
      'data-tabs-cookie': cookieKey,
    },
    el(
      'div',
      { class: listClass, role: 'tablist' },
      tabs.map((t) =>
        el(
          'button',
          {
            type: 'button',
            role: 'tab',
            'data-tabs-trigger': t.value,
            'data-tabs-active': t.value === initial ? '' : undefined,
            'aria-selected': t.value === initial ? 'true' : 'false',
            tabindex: t.value === initial ? 0 : -1,
            class: `${triggerBase}${t.value === initial ? ` ${triggerActive}` : ''}`,
          },
          t.label,
        ),
      ),
    ),
    ...tabs.map((t) =>
      el(
        'div',
        {
          role: 'tabpanel',
          'data-tabs-panel': t.value,
          class: panelClass,
          hidden: t.value === initial ? undefined : ('' as unknown as boolean),
        },
        t.panelChildren,
      ),
    ),
  )
}

// Per-request bookkeeping: which pages used <Tabs>? renderPage reads
// the flag and conditionally inlines the tabs runtime. Server-only.
let _tabsUsedFlag = false
export function markTabsUsedOnThisRequest(): void {
  _tabsUsedFlag = true
}
export function _consumeTabsUsedFlag(): boolean {
  const v = _tabsUsedFlag
  _tabsUsedFlag = false
  return v
}

/**
 * Reactive binding to a `<Tabs group="…">` group's active value.
 *
 * Returns a `State<string>` that:
 *   - **On the server**: reads the `place-tab-${group}` cookie (or
 *     falls back to `initial`). Same shape as `cookieState`, so SSR
 *     can use it to render conditional content for the active tab.
 *   - **On the client**: subscribes to the framework's `place:tabs`
 *     CustomEvent (fired by the tabs runtime on every trigger click)
 *     and writes the new value into the State when the event's
 *     `detail.group` matches. Disposer cleans up on unmount.
 *
 * Use case: Tabs as a filter trigger. Author writes ONE LINE in an
 * island instead of a manual `addEventListener` + cast + remove.
 *
 * ```tsx
 * const TodoList = island(() => {
 *   const filter = tabsState('todo-filter', 'all')
 *   return <ul>{() => items.filter(matchesFilter(filter())).map(renderRow)}</ul>
 * })
 * ```
 *
 * The cookie persists the choice across reloads; the State integrates
 * with the rest of the reactivity graph (derived, watch, JSX function
 * children) like any other signal.
 */
export function tabsState(group: string, initial = ''): State<string> {
  const key = `place-tab-${group}`
  const s = cookieState(key, initial)
  // Server: no event subscription possible — just return the cookie-
  // backed state. SSR reads s() and produces the right initial paint.
  if (typeof window === 'undefined') return s
  // Client: bind to the runtime's CustomEvent. The listener fires on
  // every trigger click; we only update when the event's group matches
  // ours so multiple `tabsState` calls on the same page stay isolated.
  // The handler installs via onMount + cleans up via onCleanup so the
  // binding follows the surrounding component's lifecycle (and works
  // both during SSR-pre-hydration and post-hydration mounts).
  onMount(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent).detail as { group?: unknown; value?: unknown } | undefined
      if (detail && detail.group === group && typeof detail.value === 'string') {
        s.set(detail.value)
      }
    }
    document.addEventListener('place:tabs', handler)
    return () => document.removeEventListener('place:tabs', handler)
  })
  return s
}

export interface ShowProps {
  /**
   * Reactive predicate. Truthy → render `children`; falsy → render
   * `fallback` (or nothing if absent).
   */
  when: () => unknown
  /** Function returning the content shown when `when()` is truthy. */
  children: () => Child
  /** Optional content shown when `when()` is falsy. */
  fallback?: Child
}

/**
 * Conditional render primitive. Replaces the common `{() => cond ? <X /> : null}`
 * shape with a named component so the intent reads:
 *
 * ```tsx
 * <Show when={() => open.read()} fallback={null}>
 *   {() => <Modal />}
 * </Show>
 * ```
 *
 * Both branches are lazy — only the active branch runs. The `when`
 * function tracks reactively; flipping it toggles which branch mounts
 * without re-running the inactive one. No wrapper element; the children
 * are emitted directly inline.
 */
export function Show(props: ShowProps): View {
  return Fragment({
    children: () => (props.when() ? props.children() : (props.fallback ?? null)),
  })
}

export const Fragment = (props: { children?: Children }): View => ({
  // No wrapping element — emit children directly. No hydration marker
  // either: hydration walks elements, not Fragment boundaries.
  toHtml: () => (props.children === undefined ? '' : childToHtml(props.children as Child)),
  // Hydrate by passing the slot through to each child.
  //
  // Three child shapes need different treatment:
  //   - Static text/number/boolean/null: nothing to walk, nothing to wire.
  //   - View: hand the slot to its hydrate; one element consumed.
  //   - **Reactive function child**: SSR emitted the function's CURRENT
  //     output at this position. On the client we adopt those nodes via
  //     the normal hydrate path AND set up a watch so future changes to
  //     the function's result replace the rendered range in place — same
  //     reactivity contract as `mountReactiveChild` on a fresh mount.
  //
  // The third case is what makes `<Show when={…}>{() => …}</Show>` work
  // across hydration. Without it, the SSR-emitted branch would be
  // adopted once and never re-render when `when()` flipped — every
  // reactive function child inside a Fragment would silently freeze.
  hydrate(slot) {
    const cleanups: Disposer[] = []
    if (props.children !== undefined) {
      const list: Child[] = Array.isArray(props.children) ? props.children : [props.children]
      const hydrateInto = (sink: Disposer[], child: Child): void => {
        if (child == null || typeof child === 'boolean') return
        if (typeof child === 'string' || typeof child === 'number') return
        if (typeof child === 'function') {
          hydrateFunctionChild(sink, child as () => Child)
          return
        }
        if (Array.isArray(child)) {
          for (const c of child) hydrateInto(sink, c as Child)
          return
        }
        if (child.hydrate) sink.push(child.hydrate(slot))
      }
      const hydrateFunctionChild = (sink: Disposer[], fn: () => Child): void => {
        const parent = slot.parent()
        // Bound the function's range with two comment anchors. We insert
        // `startAnchor` BEFORE hydrating fn's output (at the cursor's
        // current element position, which is the next sibling after
        // whatever the previous child consumed); `endAnchor` AFTER
        // hydration walked the cursor past fn's output. The two anchors
        // delimit a region we can clear + re-fill on every state change.
        //
        // Why two anchors and not one: when fn rendered nothing on SSR
        // (empty branch), there's no SSR-emitted node between them to
        // capture — so a single end-anchor + "previous sibling" walk
        // would happily walk into the NEXT Fragment child's region.
        // Two anchors make the range unambiguous even when empty.
        const startAnchor = document.createComment('')
        const endAnchor = document.createComment('')
        const cursorEl = slot.peekElement()
        if (cursorEl !== null) parent.insertBefore(startAnchor, cursorEl)
        else parent.appendChild(startAnchor)
        // Adopt the SSR-rendered initial output. `subCleanups` holds the
        // listeners for THIS render so the watch can dispose the right
        // subtree when fn() changes — separate from the outer Fragment's
        // cleanups which would survive across re-renders.
        let subCleanups: Disposer[] = []
        const initial = untrack(fn)
        hydrateInto(subCleanups, initial)
        const cursorEnd = slot.peekElement()
        if (cursorEnd !== null) parent.insertBefore(endAnchor, cursorEnd)
        else parent.appendChild(endAnchor)
        // Snapshot the DOM nodes that belong to the initial render —
        // everything STRICTLY between the two anchors.
        let currentNodes: Node[] = []
        let cursor: Node | null = startAnchor.nextSibling
        while (cursor !== null && cursor !== endAnchor) {
          currentNodes.push(cursor)
          cursor = cursor.nextSibling
        }
        let firstRun = true
        const watchDispose = watch(
          () => {
            let resolved: Child
            try {
              resolved = fn()
            } catch (e) {
              const handler = ErrorBoundaryCap.tryUse()
              if (handler === null) throw e
              handler(e)
              return
            }
            if (firstRun) {
              firstRun = false
              return
            }
            // Subsequent fires: tear down the previous render (listeners
            // + DOM) and mount the new value into the bounded region.
            disposeAll(subCleanups)
            subCleanups = []
            for (const n of currentNodes) n.parentNode?.removeChild(n)
            currentNodes = []
            let dispose: Disposer
            try {
              dispose = untrack(() => mountChild(parent, resolved, endAnchor))
            } catch (e) {
              const handler = ErrorBoundaryCap.tryUse()
              if (handler === null) throw e
              handler(e)
              return
            }
            subCleanups.push(dispose)
            // Re-snapshot the freshly-mounted range from startAnchor to
            // endAnchor — same shape as the initial capture.
            let c: Node | null = startAnchor.nextSibling
            while (c !== null && c !== endAnchor) {
              currentNodes.push(c)
              c = c.nextSibling
            }
          },
          { name: 'reactive child' },
        )
        sink.push(watchDispose)
        sink.push(() => disposeAll(subCleanups))
      }
      for (const child of list) hydrateInto(cleanups, child)
    }
    return () => disposeAll(cleanups)
  },
  mount(parent, anchor) {
    const cleanups: Disposer[] = []
    try {
      if (props.children !== undefined) {
        mountChildren(parent, props.children, anchor ?? null, cleanups)
      }
    } catch (e) {
      disposeAll(cleanups)
      const handler = ErrorBoundaryCap.tryUse()
      if (handler === null) throw e
      handler(e)
      return () => {}
    }
    return () => disposeAll(cleanups)
  },
})
