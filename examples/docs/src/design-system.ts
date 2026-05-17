// Docs-local recipes — visual tokens that only the docs site uses.
//
// For widely-reusable primitives (Button, Card, Badge, Field, Dialog,
// Toast, Tooltip, Menu, Avatar) import from `@place/design` instead.
// The migration history: this file used to also hold `featureCard`
// (→ `Card`), `pill` (→ `Badge`), and `navLink` (unused; removed).
//
// What stays here are recipes the design library doesn't (and won't)
// ship: link-shaped-as-button, inline code chips, section labels.
// They're docs-house style, not platform-house style.
//
// Discipline: every token uses semantic theme variables (bg-accent,
// text-fg, border-border, bg-card) — never literal colors. Theme
// switching is invisible to consumers.

import { recipe } from '@place/component'

// ===== Recipes with variants — functions =====

/**
 * Link-styled-as-button. The design library's `<Button>` renders a
 * real `<button>` element; this recipe yields a *class string* that
 * can be applied to a `<Link>` (anchor) for the same visual.
 * Anchor-vs-button is a semantic distinction we honor — no `asChild`
 * forwarding here.
 */
export const button = recipe({
  base: 'inline-flex items-center gap-2 rounded-md font-medium no-underline transition-[transform,box-shadow,background-color,border-color,color,opacity] duration-150',
  variants: {
    intent: {
      primary:
        'bg-accent text-accent-fg shadow-md shadow-accent/25 hover:shadow-lg hover:shadow-accent/35 hover:-translate-y-px active:translate-y-0',
      secondary:
        'bg-card border border-border text-fg hover:border-accent hover:bg-card/80',
      ghost: 'text-muted hover:text-fg',
    },
    size: {
      sm: 'px-2.5 py-1 text-xs',
      md: 'px-4 py-2 text-sm',
      lg: 'px-5 py-2.5 text-sm',
    },
  },
  defaults: { intent: 'primary', size: 'md' },
})

// ===== Static class strings — no variants =====
//
// Plain constants. Use as `class={inlineCode}` — no parens needed. The
// JSX runtime treats a static string the same as a literal class attr.

export const inlineCode = 'px-1 py-0.5 rounded bg-card border border-border text-[12px] font-mono'

export const sectionLabel = 'text-xs uppercase tracking-wider text-muted font-semibold'
