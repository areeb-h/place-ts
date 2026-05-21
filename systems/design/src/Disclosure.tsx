// `<Disclosure>` — collapsible content section built on native
// `<details>` + `<summary>`. The browser owns the open/close state,
// keyboard activation (Enter / Space on the summary), focus model,
// and accessibility tree (gets `role="group"` automatically, summary
// gets `role="button"` with `aria-expanded` reflecting `[open]`).
//
// Why native over a JS-driven `<button aria-expanded>` + content:
//   - **Zero JS for open/close**. The browser flips `[open]` on the
//     `<details>` element; CSS animates via `[open]` selectors.
//   - **Find-in-Page works**. Chrome 120+ auto-opens hidden
//     `<details>` when the user searches for text inside (the
//     `hidden=until-found` model). React/Radix Accordions trap text
//     inside a manually-collapsed `<div hidden>` — invisible to
//     find-in-page.
//   - **Exclusive accordion via `name=` attribute** (Chrome 120+,
//     Safari 17.4+, Firefox 130+). Multiple `<details name="group">`
//     auto-close siblings on open — no JS coordinator.
//   - **`interpolate-size: allow-keywords` + `transition-behavior:
//     allow-discrete`** (Chrome 129+, Safari 18.2+, Firefox in
//     progress) lets us animate the open/close to/from `auto` height
//     natively — no ResizeObserver, no JS measurement.
//
// What we add on top:
//   - Recipe variants (size, padding, intent border).
//   - Typed per-subpart `classNames` for `summary`, `chevron`, `content`.
//   - Optional `name` prop wires the exclusive-accordion behavior.
//   - Reactive `open` prop syncs the `[open]` attribute (consumers can
//     control it from outside, OR omit and let the browser own state).
//   - `onToggle` callback receives the new open state after each flip.
//   - Default chevron icon (rotates 90° via `[open] .place-chevron`).
//
// Composes into a "group" via a passthrough wrapper:
//
//   <Disclosure.Group>
//     <Disclosure name="faq" summary="…">…</Disclosure>
//     <Disclosure name="faq" summary="…">…</Disclosure>
//   </Disclosure.Group>

import type { Children, View } from '@place-ts/component'
import { cls, recipe } from '@place-ts/component'
import { watch } from '@place-ts/reactivity'

// ===== Recipe =====

const disclosureRecipe = recipe({
  base:
    'place-disclosure ' + // semantic class for global @starting-style + interpolate-size
    'block w-full overflow-hidden ' +
    'rounded-lg border border-border bg-card text-fg ' +
    'transition-colors',
  variants: {
    intent: {
      neutral: '',
      accent: 'border-accent/50',
      warn: 'border-warn/60',
    },
  },
  defaults: { intent: 'neutral' },
})

const summaryRecipe = recipe({
  base:
    'place-disclosure-summary ' +
    // Drop the default disclosure triangle so our chevron is the
    // single visual indicator. ::-webkit-details-marker covers older
    // WebKit / Safari pre-17.
    '[&::-webkit-details-marker]:hidden [&::marker]:hidden ' +
    'flex items-center justify-between gap-3 cursor-pointer select-none ' +
    'text-sm font-medium text-fg/90 ' +
    'transition-colors hover:bg-fg/5 focus-visible:outline-none ' +
    'focus-visible:bg-fg/5 focus-visible:ring-2 focus-visible:ring-accent/60 ' +
    'focus-visible:ring-inset',
  variants: {
    size: {
      sm: 'px-3 py-2 text-xs',
      md: 'px-4 py-3 text-sm',
      lg: 'px-5 py-4 text-base',
    },
  },
  defaults: { size: 'md' },
})

const contentRecipe = recipe({
  base: 'place-disclosure-content ' + 'text-sm text-fg/90 leading-relaxed',
  variants: {
    size: {
      sm: 'px-3 pb-2',
      md: 'px-4 pb-3',
      lg: 'px-5 pb-4',
    },
  },
  defaults: { size: 'md' },
})

// ===== Types =====

export type DisclosureSize = 'sm' | 'md' | 'lg'
export type DisclosureIntent = 'neutral' | 'accent' | 'warn'

/**
 * Part anatomy for `<Disclosure>` (ADR 0050).
 *
 * Root uses the standalone `class` prop. Sub-parts:
 *   - `summary` — the clickable header (the `<summary>` element)
 *   - `chevron` — the default rotating arrow icon span
 *   - `content` — the collapsible body wrapper
 */
export type DisclosurePart = 'summary' | 'chevron' | 'content'

export interface DisclosureProps {
  /** Header label. String OR arbitrary children for icon+text layouts. */
  readonly summary: View | string
  /**
   * Accordion group key. Sibling `<details name="…">` elements with
   * the same name auto-close each other on open (native, Chrome 120+ /
   * Safari 17.4+ / Firefox 130+).
   */
  readonly name?: string
  /**
   * Controlled-open mode. When provided, the framework syncs the
   * `[open]` attribute to this signal's value on every change. Omit
   * to let the browser own open/close state.
   */
  readonly open?: () => boolean
  /**
   * Initial open state in uncontrolled mode. Ignored when `open` is
   * provided. Default: `false`.
   */
  readonly defaultOpen?: boolean
  /**
   * Fires AFTER the browser toggles the open state — both manual user
   * clicks AND programmatic flips via the `open` signal.
   */
  readonly onToggle?: (open: boolean) => void
  /** Visual size variant. Default `'md'`. */
  readonly size?: DisclosureSize
  /** Visual intent (border accent). Default `'neutral'`. */
  readonly intent?: DisclosureIntent
  /** Show the default rotating chevron icon. Default `true`. */
  readonly chevron?: boolean
  /** Additive classes on the root `<details>` element. */
  readonly class?: string
  /** Typed per-subpart class overrides (ADR 0050). */
  readonly classNames?: Partial<Record<DisclosurePart, string>>
  readonly children?: Children
}

// Default rotating chevron. CSS `[open] .place-disclosure-chevron`
// rotates it 90° on open.
const DefaultChevron = (extra?: string): View => (
  <span
    aria-hidden="true"
    class={cls(
      'place-disclosure-chevron inline-flex items-center justify-center text-muted',
      'transition-transform duration-150 ease-out',
      extra ?? '',
    )}
  >
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="6 4 10 8 6 12" />
    </svg>
  </span>
)

// ===== Implementation =====

const DisclosureImpl = (props: DisclosureProps): View => {
  const size: DisclosureSize = props.size ?? 'md'
  const showChevron = props.chevron !== false
  const initialOpen = props.open !== undefined ? props.open() : (props.defaultOpen ?? false)

  // Sync `[open]` to a controlled signal if provided. The browser's
  // own click/keyboard toggling continues to work — when the user
  // clicks, the browser flips `[open]`, our `onToggle` fires, and the
  // consumer's signal updates (their watcher then re-syncs us — but
  // by then we're already in the right state, so the re-sync is a no-op).
  let detailsRef: HTMLDetailsElement | null = null
  if (props.open) {
    const openSig = props.open
    watch(() => {
      const want = openSig()
      const el = detailsRef
      if (!el) return
      if (want && !el.open) el.open = true
      else if (!want && el.open) el.open = false
    })
  }

  const onNativeToggle = (e: Event): void => {
    const el = e.currentTarget as HTMLDetailsElement
    props.onToggle?.(el.open)
  }

  const rootClass = cls(
    disclosureRecipe(props.intent !== undefined ? { intent: props.intent } : {}),
    props.class ?? '',
  )
  const summaryClass = cls(summaryRecipe({ size }), props.classNames?.summary ?? '')
  const contentClass = cls(contentRecipe({ size }), props.classNames?.content ?? '')

  return (
    <details
      class={rootClass}
      open={initialOpen}
      {...(props.name !== undefined ? { name: props.name } : {})}
      onToggle={onNativeToggle}
      ref={(el: HTMLElement) => {
        detailsRef = el as HTMLDetailsElement
      }}
    >
      <summary class={summaryClass}>
        <span class="flex-1 min-w-0">{props.summary}</span>
        {showChevron ? DefaultChevron(props.classNames?.chevron) : null}
      </summary>
      <div class={contentClass}>{props.children}</div>
    </details>
  )
}

// ===== Group (passthrough) =====

interface DisclosureGroupProps {
  readonly class?: string
  readonly children?: Children
}

const DisclosureGroup = (props: DisclosureGroupProps): View => (
  <div class={cls('flex flex-col gap-2', props.class ?? '')}>{props.children}</div>
)

/**
 * Collapsible section built on native `<details>` + `<summary>`.
 *
 * @example
 * ```tsx
 * <Disclosure summary="What is place-ts?">
 *   <p>An HTML-first framework that…</p>
 * </Disclosure>
 *
 * // Exclusive accordion (native — sibling [name="faq"] auto-close):
 * <Disclosure.Group>
 *   <Disclosure name="faq" summary="Q1">A1</Disclosure>
 *   <Disclosure name="faq" summary="Q2">A2</Disclosure>
 * </Disclosure.Group>
 *
 * // Controlled:
 * const open = state(false)
 * <Disclosure open={open} onToggle={open.set} summary="Toggle me">
 *   …
 * </Disclosure>
 * ```
 */
export const Disclosure = Object.assign(DisclosureImpl, {
  Group: DisclosureGroup,
})
