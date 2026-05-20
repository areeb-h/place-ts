// Presentational primitives — no behavior, just opinionated layout.
//
// Avatar / Badge / Card are pure recipe-driven elements. They have no
// reactive state, no event handlers beyond what the user passes
// through, no motion. Each is a single declaration: variants × a
// stable HTML element.
//
// Why they ship as design primitives rather than "just use a div":
// every app reinvents these and gets the details slightly wrong
// (border-radius scale drift, status-dot positioning, badge-on-icon
// nesting). Shipping them with the design library's recipe makes the
// details consistent across the platform.

import { cls, recipe } from '@place/component'
import type { Children, RefCallback, View } from '@place/component'

// ===== Avatar =====

const avatarRecipe = recipe({
  base:
    'inline-flex items-center justify-center shrink-0 overflow-hidden ' +
    'rounded-full bg-card border border-border/60 text-fg font-semibold ' +
    'select-none uppercase tracking-wider',
  variants: {
    size: {
      // `sm` uses `text-xs` (the smallest tokenized step). Prior
      // `text-[10px]` violated NN#6; the 0.625rem→0.75rem bump is
      // visually negligible for two-letter initials.
      sm: 'w-7 h-7 text-xs',
      md: 'w-9 h-9 text-xs',
      lg: 'w-12 h-12 text-sm',
      xl: 'w-16 h-16 text-base',
    },
  },
  defaults: { size: 'md' },
})

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'

export interface AvatarProps {
  /** Image source. If omitted (or fails), shows initials from `name`. */
  readonly src?: string
  /** User's display name. Initials derived as the first letter of each
   *  word (max 2). Used as `alt` for the image too. */
  readonly name: string
  /** Sizing. Default: `'md'`. */
  readonly size?: AvatarSize
  /** Additive classes. */
  readonly class?: string
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0] ?? '').join('')
}

export const Avatar = (props: AvatarProps): View => {
  const baseClasses = avatarRecipe(props.size !== undefined ? { size: props.size } : {})
  const finalClass = props.class ? cls(baseClasses, props.class) : baseClasses
  // **`onError` fallback to initials** (Tier 17-E). Promised in
  // JSDoc since v0.1; not implemented until now. If the `src` URL
  // 404s or the image fails to decode, swap the `<img>` for the
  // initial-letters text. Implementation is a one-shot DOM mutation
  // — when the browser fires `error` on the img, replace its
  // contents in the parent span. CSP-safe (no innerHTML; uses
  // textContent + replaceChild on the img element).
  const onImgError = (e: Event): void => {
    const img = e.target as HTMLImageElement | null
    if (!img?.parentElement) return
    img.parentElement.textContent = initials(props.name)
  }
  return (
    <span class={finalClass} role="img" aria-label={props.name}>
      {props.src ? (
        <img
          src={props.src}
          alt={props.name}
          class="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          onError={onImgError}
        />
      ) : (
        initials(props.name)
      )}
    </span>
  )
}

// ===== Badge =====

const badgeRecipe = recipe({
  base:
    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ' +
    'leading-none select-none',
  variants: {
    intent: {
      neutral: 'bg-card text-fg border border-border/80',
      accent: 'bg-accent/12 text-accent border border-accent/30',
      // `success` + `warn` are now first-class theme tokens (added
      // to `theme()`'s SIBLING_DEFAULTS in Tier 15-D). Apps get
      // `bg-success`, `text-success`, `border-success` utilities via
      // Tailwind v4's `--color-*` recognition; the OKLCH literal
      // values that lived inline here previously violated NN#6.
      success: 'bg-success/12 text-success border border-success/40',
      warn: 'bg-warn/12 text-warn border border-warn/40',
      destructive:
        'bg-destructive/12 text-destructive border border-destructive/40',
    },
    size: {
      sm: 'px-1.5 py-0 text-xs',
      md: 'px-2 py-0.5 text-xs',
    },
  },
  defaults: { intent: 'neutral', size: 'md' },
})

export type BadgeIntent = 'neutral' | 'accent' | 'success' | 'warn' | 'destructive'
export type BadgeSize = 'sm' | 'md'

export interface BadgeProps {
  readonly intent?: BadgeIntent
  readonly size?: BadgeSize
  readonly class?: string
  readonly children?: Children
}

export const Badge = (props: BadgeProps): View => {
  const baseClasses = badgeRecipe({
    ...(props.intent !== undefined ? { intent: props.intent } : {}),
    ...(props.size !== undefined ? { size: props.size } : {}),
  })
  const finalClass = props.class ? cls(baseClasses, props.class) : baseClasses
  return <span class={finalClass}>{props.children}</span>
}

// ===== Card =====

const cardRecipe = recipe({
  base: 'rounded-xl bg-card border border-border text-fg',
  variants: {
    intent: {
      flat: 'border-border/60',
      raised: 'border-border/60 shadow-lg shadow-bg/30',
      accent: 'border-accent/30 bg-accent/5',
    },
    padding: {
      none: '',
      sm: 'p-3',
      md: 'p-5',
      lg: 'p-6',
    },
    interactive: {
      true:
        'transition-[border-color,background-color,transform] duration-150 ' +
        'cursor-pointer hover:-translate-y-0.5 hover:border-accent/40',
      false: '',
    },
  },
  defaults: { intent: 'flat', padding: 'md', interactive: 'false' },
})

export type CardIntent = 'flat' | 'raised' | 'accent'
export type CardPadding = 'none' | 'sm' | 'md' | 'lg'

export interface CardProps {
  readonly intent?: CardIntent
  readonly padding?: CardPadding
  /** Hover lift + cursor pointer. Use with `onClick` for clickable cards. */
  readonly interactive?: boolean
  readonly onClick?: (e: MouseEvent) => void
  readonly class?: string
  readonly ref?: RefCallback<HTMLDivElement>
  readonly children?: Children
}

const CardImpl = (props: CardProps): View => {
  const baseClasses = cardRecipe({
    ...(props.intent !== undefined ? { intent: props.intent } : {}),
    ...(props.padding !== undefined ? { padding: props.padding } : {}),
    interactive: props.interactive ? 'true' : 'false',
  })
  const finalClass = props.class ? cls(baseClasses, props.class) : baseClasses
  return (
    <div
      class={finalClass}
      {...(props.onClick !== undefined ? { onClick: props.onClick } : {})}
      {...(props.ref !== undefined ? { ref: props.ref } : {})}
    >
      {props.children}
    </div>
  )
}

// ===== Card named-children slots =====
//
// Same pattern as Dialog/Sheet: pre-styled wrappers attached as
// static properties so consumers write `<Card.Header>` for
// discoverability. Each slot is a plain component — no parent ↔
// child coupling, no context. Consumers compose without padding
// (`<Card padding="none">`) so the slot internal spacing controls
// rhythm; or use them alongside `padding="md"` for nested layout.

interface CardSlotProps {
  readonly class?: string
  readonly children?: Children
}

const CardHeader = (props: CardSlotProps): View => (
  <header
    class={cls(
      'flex items-center justify-between gap-3 px-5 pt-5 pb-3 border-b border-border/60',
      props.class ?? '',
    )}
  >
    {props.children}
  </header>
)

const CardBody = (props: CardSlotProps): View => (
  <div class={cls('px-5 py-4', props.class ?? '')}>{props.children}</div>
)

const CardFooter = (props: CardSlotProps): View => (
  <footer
    class={cls(
      'flex items-center justify-end gap-2 px-5 py-3 border-t border-border/60 bg-bg/40',
      props.class ?? '',
    )}
  >
    {props.children}
  </footer>
)

/**
 * Card primitive with optional named slots (Tier 17-E v2).
 *
 * - **Bare**: `<Card>content</Card>` — the v0.1 single-element form.
 * - **Slotted**: `<Card padding="none"><Card.Header>...</Card.Header>...</Card>`
 *   — chrome / content / actions in distinct visual sections.
 *
 * `padding="none"` is recommended when using slots so the slot's own
 * spacing controls rhythm. With `padding="md"` (default) you get an
 * outer pad PLUS each slot's internal pad — fine for some layouts,
 * use `none` when slots are the whole content.
 */
export const Card = Object.assign(CardImpl, {
  Header: CardHeader,
  Body: CardBody,
  Footer: CardFooter,
})
