// `<ThemeToggle>` — the styled convenience layer for the framework's
// theme system. Drop one tag and get a working System / Light / Dark
// picker with sensible defaults, or tune presentation via props.
//
// Customization tiers (from most-default to most-bespoke):
//
//   Tier 1 — defaults:
//     <ThemeToggle />
//
//   Tier 2 — tweak presentation:
//     <ThemeToggle variant="cycle" labels={{ system: 'Auto' }} />
//
//   Tier 3 — BYO UI (drop this component, use the headless hook):
//     const theme = useTheme()
//     <MyCustomToggle value={theme.current} onChange={theme.set} />
//
//   Tier 4 — escape hatch:
//     <button onClick={() => setTheme('dark')}>Dark</button>
//
// **NOT an `island()` itself.** Per design-system convention (every
// other component is a regular function — Button, Combobox, Dialog,
// etc.), the click handlers hydrate via the PARENT island's bundle.
// For the canonical "drop in a layout" usage, the scaffolder ships a
// 2-line local island wrapper that imports this component, and the
// framework's `islandsDir` auto-discovery does the rest.

import type { View } from '@place-ts/component'
import { cls, recipe, useTheme } from '@place-ts/component'

// ===== Recipe — variant taxonomy =====

const wrapperRecipe = recipe({
  base: 'inline-flex items-center gap-0.5',
  variants: {
    variant: {
      segmented: 'rounded-md border border-border bg-card/60 p-0.5',
      cycle: '',
    },
    size: {
      sm: 'text-xs',
      md: 'text-sm',
      lg: 'text-base',
    },
  },
  defaults: { variant: 'segmented', size: 'md' },
})

const buttonRecipe = recipe({
  base:
    'rounded px-2 py-1 cursor-pointer ' +
    'transition-[background-color,color,opacity] duration-150 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
  variants: {
    variant: {
      segmented: '',
      cycle: 'border border-border bg-card hover:bg-bg',
    },
    pressed: {
      true: '',
      false: 'text-muted hover:text-fg',
    },
    size: {
      sm: 'px-2 py-0.5 text-xs',
      md: 'px-2 py-1 text-sm',
      lg: 'px-3 py-1.5 text-base',
    },
  },
  // `bg-bg text-fg` on pressed segment — placed in the compound matcher
  // below so it only applies inside the segmented control.
  compound: [
    {
      variant: 'segmented',
      pressed: 'true',
      class: 'bg-bg text-fg font-medium shadow-sm',
    },
  ],
  defaults: { variant: 'segmented', pressed: 'false', size: 'md' },
})

// ===== Public types =====

export type ThemeToggleVariant = 'segmented' | 'cycle'
export type ThemeToggleSize = 'sm' | 'md' | 'lg'

export interface ThemeToggleProps {
  /** Visual shape. `'segmented'` (default) — three buttons; `'cycle'` —
   *  single button cycling through the modes. */
  readonly variant?: ThemeToggleVariant
  /** Sizing. Default: `'md'`. */
  readonly size?: ThemeToggleSize
  /** Modes to expose. Default: every configured mode from
   *  `window.__placeTheme.names`. Pass to restrict, e.g. `['light',
   *  'dark']` to hide custom modes. */
  readonly modes?: readonly string[]
  /** Include the `'system'` option in the segmented control / cycle.
   *  Default: `true`. */
  readonly includeSystem?: boolean
  /** Override per-mode display labels (used for aria-label + cycle
   *  button text). Keys are mode names or `'system'`. */
  readonly labels?: Readonly<Record<string, string>>
  /** Override per-mode icons (used as the visible glyph). Keys are
   *  mode names or `'system'`. Default: built-in unicode symbols. */
  readonly icons?: Readonly<Record<string, View>>
  /** Additive Tailwind classes appended via `cls()`. Wraps the outer
   *  fieldset. */
  readonly class?: string
  /** Aria label for the group. Default: `'Theme'`. */
  readonly 'aria-label'?: string
}

// ===== Defaults =====

const DEFAULT_LABELS: Readonly<Record<string, string>> = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
}

const DEFAULT_SYMBOLS: Readonly<Record<string, string>> = {
  system: '◑',
  light: '☀',
  dark: '☾',
}

// ===== Component =====

export const ThemeToggle = (props: ThemeToggleProps): View => {
  const theme = useTheme()
  const variant = props.variant ?? 'segmented'
  const size = props.size ?? 'md'

  // Resolve the full mode list once. The order — `[system?, ...modes]`
  // — is stable for the segmented control's left-to-right rendering.
  const includeSystem = props.includeSystem !== false
  const baseModes = props.modes ?? theme.modes
  const allOptions: readonly string[] = includeSystem ? ['system', ...baseModes] : baseModes

  const labelFor = (mode: string): string => props.labels?.[mode] ?? DEFAULT_LABELS[mode] ?? mode
  // Icon can be a View (user-provided JSX) or a plain string (default
  // unicode glyph). JSX renders both as children, so the union is fine.
  const iconFor = (mode: string): View | string => {
    const override = props.icons?.[mode]
    if (override !== undefined) return override
    return DEFAULT_SYMBOLS[mode] ?? mode
  }

  const wrapperClass = props.class
    ? cls(wrapperRecipe({ variant, size }), props.class)
    : wrapperRecipe({ variant, size })

  if (variant === 'cycle') {
    // Single button — clicking advances current → next in `allOptions`.
    const next = (): string => {
      const i = allOptions.indexOf(theme.current())
      return allOptions[(i + 1) % allOptions.length] ?? allOptions[0] ?? 'system'
    }
    return (
      <fieldset class={wrapperClass}>
        <legend class="sr-only">{props['aria-label'] ?? 'Theme'}</legend>
        <button
          type="button"
          aria-label={() => `${labelFor(theme.current())} (click to switch)`}
          onClick={() => theme.set(next())}
          class={buttonRecipe({ variant: 'cycle', pressed: 'false', size })}
        >
          <span aria-hidden="true">{() => iconFor(theme.current())}</span>
        </button>
      </fieldset>
    )
  }

  // Segmented control — one button per option, with reactive
  // aria-pressed + recipe-driven highlight on the active one.
  return (
    <fieldset class={wrapperClass}>
      <legend class="sr-only">{props['aria-label'] ?? 'Theme'}</legend>
      {allOptions.map((mode) => (
        <button
          type="button"
          aria-label={labelFor(mode)}
          aria-pressed={() => (theme.current() === mode ? 'true' : 'false')}
          onClick={() => theme.set(mode)}
          class={() =>
            buttonRecipe({
              variant: 'segmented',
              pressed: theme.current() === mode ? 'true' : 'false',
              size,
            })
          }
        >
          <span aria-hidden="true">{iconFor(mode)}</span>
        </button>
      ))}
    </fieldset>
  )
}
