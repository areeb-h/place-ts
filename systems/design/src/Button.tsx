// `<Button>` — the first primitive of @place/design.
//
// Proves the structural pattern every other primitive will follow:
//
//   1. `recipe()` for visual variants (intent, size).
//   2. `aria-*` attributes via Tailwind attribute selectors for state
//      (`aria-disabled:`, `aria-busy:`).
//   3. Motion-aware loading state via `@place/reactivity/motion` —
//      a debounced spinner that fades in only if `loading` stays
//      truthy past a threshold (avoids jank for sub-100ms work).
//   4. Composition via children + typed slot props (icon position),
//      not via `asChild` polymorphism.
//
// SSR-safe: renders identically server + client. Disabled state can
// be clicked-prevented natively (the `disabled` HTML attribute);
// loading state debounces via the motion primitive's clock — which
// on the server is frozen at 0, so SSR ships the rest visual without
// the spinner showing.
//
// No `className` override channel at the consumer level (per ADR
// 0016). Apps that need to customize change the recipe variant. The
// `class` prop is reserved for opt-in additive classes (e.g. a layout
// utility on the call site); the recipe runs through `cls()` which is
// Tailwind-aware merging.

import type { Children, View } from '@place/component'
import { cls, recipe } from '@place/component'
import { state } from '@place/reactivity'
import { animate } from '@place/reactivity/motion'

// ===== Recipe — variant taxonomy =====

const buttonRecipe = recipe({
  base:
    'inline-flex items-center justify-center gap-2 rounded-md font-medium no-underline cursor-pointer ' +
    'select-none whitespace-nowrap ' +
    'transition-[transform,box-shadow,background-color,border-color,color,opacity] duration-150 ' +
    // Focus ring base; the ring COLOR shifts per intent so
    // destructive buttons get a destructive-coloured ring instead
    // of accent (Tier 17-E). Without this, a destructive action's
    // focus indicator reads as "primary" — wrong signal.
    'focus-visible:outline-none focus-visible:ring-2 ' +
    'aria-disabled:cursor-not-allowed aria-disabled:opacity-60 ' +
    'aria-busy:cursor-progress',
  variants: {
    intent: {
      primary:
        'bg-accent text-accent-fg shadow-md shadow-accent/25 ' +
        'focus-visible:ring-accent/60 ' +
        'hover:shadow-lg hover:shadow-accent/35 hover:-translate-y-px active:translate-y-0 ' +
        'aria-disabled:shadow-none aria-disabled:translate-y-0',
      secondary:
        'bg-card border border-border text-fg ' +
        'focus-visible:ring-accent/60 ' +
        'hover:border-accent hover:bg-card/80',
      ghost: 'text-muted focus-visible:ring-accent/60 hover:text-fg hover:bg-card/60',
      destructive:
        'bg-destructive text-destructive-fg shadow-md shadow-destructive/25 ' +
        'focus-visible:ring-destructive/60 ' +
        'hover:shadow-lg hover:shadow-destructive/35 hover:-translate-y-px active:translate-y-0',
    },
    size: {
      sm: 'px-2.5 py-1 text-xs',
      md: 'px-4 py-2 text-sm',
      lg: 'px-5 py-2.5 text-base',
    },
  },
  defaults: { intent: 'primary', size: 'md' },
})

// ===== Spinner — motion-aware fade-in =====
//
// The spinner only shows once `loading` has been true for ≥ a small
// threshold. The fade-in uses `animate()` reading a "should show"
// boolean coerced to 0/1. Sub-100ms work doesn't flash a spinner;
// real work shows feedback smoothly.

const SPINNER_DEBOUNCE_MS = 120

interface SpinnerProps {
  readonly loading: () => boolean
}

const Spinner = (props: SpinnerProps): View => {
  // Track when `loading` became true. Latest start-time; reset to
  // null when loading goes back to false.
  const startedAt = state<number | null>(null)
  // Mirror the prop into a state, then derive a boolean: "show if
  // loading has been true for ≥ SPINNER_DEBOUNCE_MS." The motion
  // primitive animates the opacity smoothly via spring.
  // (We don't use a watch here so the spinner has no side effects on
  // the surrounding component tree.)
  const opacity = animate(
    () => {
      const isLoading = props.loading()
      if (!isLoading) {
        if (startedAt() !== null) startedAt.set(null)
        return 0
      }
      const t = startedAt()
      if (t === null) {
        startedAt.set(Date.now())
        return 0
      }
      return Date.now() - t >= SPINNER_DEBOUNCE_MS ? 1 : 0
    },
    { spring: 'snap' },
  )
  return (
    <span
      class="inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-r-transparent animate-spin"
      style:opacity={() => String(opacity())}
      aria-hidden="true"
    />
  )
}

// ===== Public API =====

export type ButtonIntent = 'primary' | 'secondary' | 'ghost' | 'destructive'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps {
  /** Visual treatment. Default: `'primary'`. */
  readonly intent?: ButtonIntent
  /** Sizing. Default: `'md'`. */
  readonly size?: ButtonSize
  /** Click handler. Standard onClick contract. */
  readonly onClick?: (e: MouseEvent) => void
  /** Native disabled. Static or reactive. */
  readonly disabled?: boolean | (() => boolean)
  /**
   * Loading state. When truthy, the button shows a spinner after a
   * short debounce and goes `aria-busy="true"`. Click handlers don't
   * fire while loading (the button is disabled-equivalent).
   */
  readonly loading?: boolean | (() => boolean)
  /**
   * Native HTML button type. Use `'submit'` inside a `<Form>` to
   * trigger native form submission; `'button'` (default) is inert by
   * default.
   */
  readonly type?: 'button' | 'submit' | 'reset'
  /** Additive classes — appended via `cls()` (Tailwind-aware merge). */
  readonly class?: string
  /** Icon slot rendered before the children. Typed View only. */
  readonly icon?: View
  /** ARIA label override (for icon-only buttons). */
  readonly 'aria-label'?: string
  readonly children?: Children
}

export const Button = (props: ButtonProps): View => {
  const isDisabled = (): boolean =>
    typeof props.disabled === 'function' ? props.disabled() : props.disabled === true
  const isLoading = (): boolean =>
    typeof props.loading === 'function' ? props.loading() : props.loading === true
  const isBlocked = (): boolean => isDisabled() || isLoading()

  const handleClick = (e: MouseEvent): void => {
    if (isBlocked()) {
      e.preventDefault()
      return
    }
    props.onClick?.(e)
  }

  const baseClasses = buttonRecipe({
    ...(props.intent !== undefined ? { intent: props.intent } : {}),
    ...(props.size !== undefined ? { size: props.size } : {}),
  })
  const finalClass = props.class ? cls(baseClasses, props.class) : baseClasses

  return (
    <button
      type={props.type ?? 'button'}
      class={finalClass}
      disabled={isBlocked}
      aria-disabled={() => (isDisabled() ? 'true' : undefined)}
      aria-busy={() => (isLoading() ? 'true' : undefined)}
      aria-label={props['aria-label']}
      onClick={handleClick}
    >
      {() => (isLoading() ? <Spinner loading={isLoading} /> : (props.icon ?? null))}
      {props.children}
    </button>
  )
}
