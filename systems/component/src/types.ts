// Public + internal types for @place/component. Extracted from index.ts
// (audit Phase 2.1, Cut 1c). Pure types — no runtime code, no module-
// level state. Importing this file has zero side effects.
//
// `Disposer` comes from @place/reactivity since cleanup semantics are
// defined there; we just consume the contract.

import type { Disposer } from '../../reactivity/src/index.ts'

// ===== Public types =====

export type View = {
  readonly mount: (parent: ParentNode, anchor?: Node | null) => Disposer
  /**
   * Optional: render this view to an HTML string without touching the
   * DOM. Element factories implement this so SSR can run in pure-Bun /
   * pure-Node environments without a happy-dom polyfill, and so
   * `renderToStream` and the hydration-marker pipeline have a single
   * source-of-truth string emitter.
   *
   * Views without `toHtml` (custom factories that only know how to
   * mount) fall back to the happy-dom mount path in `renderToString` —
   * so this is purely additive.
   */
  readonly toHtml?: () => string
  /**
   * Optional: adopt an existing DOM subtree rendered by `renderToString`
   * (the SSR companion of `mount`). Walks `slot`'s parent and consumes
   * the next element to match this View's expected element. Attaches
   * event listeners + reactive watches to the existing node — does NOT
   * recreate it. Children are cleared and re-mounted in V0 (smarter
   * children-adoption is a future cut).
   *
   * Returns a disposer that tears down watches + listeners but does
   * NOT remove the DOM (`hydrate` doesn't own the rendered page).
   */
  readonly hydrate?: (slot: HydrationSlot) => Disposer
}

/**
 * A cursor over the children of an element, walked element-by-element
 * during hydration. Each `el()` View pulls one element from the slot;
 * Fragment / component pass the slot through to delegated children.
 */
export interface HydrationSlot {
  /** Consume + return the next element child of the slot's parent, or null. */
  nextElement(): Element | null
  /** Return the next element child WITHOUT consuming the cursor, or null.
   *  Used by `component()` to detect whether the SSR'd DOM is the auto
   *  client-only placeholder (so it knows to route hydration through
   *  `ClientOnly` instead of running the body directly). */
  peekElement(): Element | null
  /** The parent `ParentNode` this slot walks over. Exposed so reactive
   *  children mounted DURING hydration (e.g. `<Show>` / `<Activity>`
   *  inside a Fragment) can insert sentinel anchors and replace their
   *  subtree on state changes without re-creating the slot. */
  parent(): ParentNode
}

export type Component<P = Record<string, unknown>> = (props: P) => View

/**
 * A renderable child in a `el()` / JSX call. Includes `Child[]` as a
 * self-reference so arrays-of-children compose naturally — `<Frag>{spread}{conditional}</Frag>`
 * works without manual `[...]` wrapping. The runtime already flattens
 * arrays via `childToHtml` + `mountChildren`'s `Array.isArray` branches;
 * the recursive type makes the static surface match the runtime
 * behavior.
 */
export type Child = View | string | number | boolean | null | undefined | (() => Child) | Child[]

/**
 * Children prop type. `Child` now subsumes `Child[]` so this is just an
 * alias retained for clarity and back-compat.
 */
export type Children = Child

// ===== Internal types (not exported from index.ts; support ElementProps) =====

// Props for an HTML element. Reactive values use the function form.
export type Reactive<T> = T | (() => T)

export type EventHandler<E extends Event = Event> = (event: E) => void

/**
 * Bivariant callback type for DOM refs. Using a method signature inside
 * an object literal type opts the parameter into bivariance under
 * `strictFunctionTypes`. This lets callers narrow the element type at
 * the assignment site:
 *
 * ```tsx
 * <input ref={(el: HTMLInputElement) => el.focus()} />
 * <div ref={(el: HTMLDivElement) => observe(el)} />
 * ```
 *
 * Without bivariance, TypeScript would reject the narrower callback as
 * unassignable to `(node: HTMLElement) => void`. The framework still
 * passes an `HTMLElement` at call time; the bivariance only loosens
 * type-checking at assignment, not at invocation.
 */
export type RefCallback<T = HTMLElement> = {
  bivarianceHack(node: T): void
}['bivarianceHack']

export interface BaseProps {
  children?: Children
  ref?: RefCallback
}

// Common attributes (extend per element as needed)
export interface CommonAttrs {
  class?: Reactive<string | undefined>
  className?: Reactive<string | undefined>
  id?: Reactive<string | undefined>
  style?: Reactive<string | Partial<CSSStyleDeclaration> | undefined>
  title?: Reactive<string | undefined>
  hidden?: Reactive<boolean | undefined>
  [key: `data-${string}`]: Reactive<string | number | boolean | undefined>
  [key: `aria-${string}`]: Reactive<string | number | boolean | undefined>
  // JSX directives. The `applyProp` dispatcher handles each prefix:
  //   class:foo={cond}  — add `foo` to classList when cond is truthy
  //   style:color={v}   — set node.style.color reactively
  //   bind:value={state} / bind:checked / bind:files — two-way binding
  //   use:action={...}  — invoke an action on mount; optional payload
  [key: `class:${string}`]: Reactive<unknown>
  [key: `style:${string}`]: Reactive<string | number | undefined>
  // biome-ignore lint/suspicious/noExplicitAny: bind: accepts any State<T>
  [key: `bind:${string}`]: any
  // biome-ignore lint/suspicious/noExplicitAny: use: accepts function or payload
  [key: `use:${string}`]: any
}

export interface CommonEvents {
  // `| undefined` is required by exactOptionalPropertyTypes so that callers
  // can forward `props.onClick` (which may be undefined) to JSX without
  // TypeScript complaining.
  onClick?: EventHandler<MouseEvent> | undefined
  onInput?: EventHandler<Event> | undefined
  onChange?: EventHandler<Event> | undefined
  onSubmit?: EventHandler<Event> | undefined
  onKeyDown?: EventHandler<KeyboardEvent> | undefined
  onKeyUp?: EventHandler<KeyboardEvent> | undefined
  onFocus?: EventHandler<FocusEvent> | undefined
  onBlur?: EventHandler<FocusEvent> | undefined
}

export type ElementProps = BaseProps &
  CommonAttrs &
  CommonEvents & {
    [key: string]: unknown
  }
