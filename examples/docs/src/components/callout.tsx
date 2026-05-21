// Callout — emphasized note inside prose. Four variants tuned to the
// signal weight: tip (positive), note (neutral), warn (cautionary),
// danger (do-not-do). Each carries a small glyph and an accent color
// derived from the theme tokens so the box adapts to dark/light.
//
// Styling lives inline via Tailwind utility classes — component-
// specific CSS belongs WITH the component, not in a global stylesheet.
// `recipe()` factors the per-kind variants (border + tint + glyph
// background) into one declaration.

import type { Children } from '@place-ts/component'
import { recipe } from '@place-ts/component'

type CalloutKind = 'tip' | 'note' | 'warn' | 'danger'

interface CalloutProps {
  kind?: CalloutKind
  title?: string
  children?: Children
}

const GLYPH: Record<CalloutKind, string> = {
  tip: '✓',
  note: 'i',
  warn: '!',
  danger: '×',
}

// Per-kind treatment — border color, tinted background, glyph bubble.
// `color-mix(in oklab, …)` blends play with the theme tokens so every
// variant adapts automatically when the user toggles dark/light.
const wrapper = recipe({
  base: 'flex gap-3.5 py-3.5 px-4 rounded-[10px] border my-5 bg-card/60',
  variants: {
    kind: {
      tip: 'border-[color-mix(in_oklab,oklch(0.78_0.14_145)_40%,transparent)] bg-[color-mix(in_oklab,oklch(0.78_0.14_145)_8%,var(--color-card))]',
      note: 'border-border/80',
      warn: 'border-[color-mix(in_oklab,oklch(0.78_0.16_70)_50%,transparent)] bg-[color-mix(in_oklab,oklch(0.78_0.16_70)_8%,var(--color-card))]',
      danger:
        'border-[color-mix(in_oklab,var(--color-destructive)_50%,transparent)] bg-[color-mix(in_oklab,var(--color-destructive)_7%,var(--color-card))]',
    },
  },
})

const glyph = recipe({
  base: 'shrink-0 w-[22px] h-[22px] rounded-full flex items-center justify-center font-mono font-bold text-[12px] leading-none mt-px',
  variants: {
    kind: {
      tip: 'bg-[oklch(0.78_0.14_145)] text-bg',
      note: 'bg-muted text-bg',
      warn: 'bg-[oklch(0.78_0.16_70)] text-bg',
      danger: 'bg-destructive text-destructive-fg',
    },
  },
})

export const Callout = ({ kind = 'note', title, children }: CalloutProps) => (
  <div class={wrapper({ kind })} role="note">
    <div class={glyph({ kind })} aria-hidden="true">
      {GLYPH[kind]}
    </div>
    <div class="flex-1">
      {title ? <div class="font-semibold mb-1 text-fg">{title}</div> : null}
      <div class="text-[0.9rem] leading-relaxed [&>:first-child]:mt-0 [&>:last-child]:mb-0">
        {children}
      </div>
    </div>
  </div>
)
