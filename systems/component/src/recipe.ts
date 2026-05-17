// ===== recipe() — first-class Tailwind variant DSL =====
//
// Replaces the clsx + tailwind-merge + CVA + tv ecosystem with one
// in-framework primitive. Define visual variants once; reference them
// by name from JSX. Apps stop carrying walls of Tailwind classes in
// every component body.
//
//   const button = recipe({
//     base: 'inline-flex items-center gap-2 rounded-md font-medium',
//     variants: {
//       intent: {
//         primary: 'bg-accent text-accent-fg hover:opacity-90',
//         secondary: 'bg-card border border-border text-fg',
//       },
//       size: {
//         sm: 'px-2.5 py-1 text-xs',
//         md: 'px-4 py-2 text-sm',
//         lg: 'px-5 py-2.5 text-base',
//       },
//     },
//     compound: [{ intent: 'primary', size: 'lg', class: 'shadow-lg' }],
//     defaults: { intent: 'primary', size: 'md' },
//   })
//
//   <button class={button({ intent: 'primary', size: 'lg' })}>Click</button>
//
// Recipe results pass through `cls()` so callers can compose further:
//
//   <button class={cls(button({ intent: 'primary' }), 'shadow-xl')}>...</button>
//
// The `cls()` form uses Tailwind-aware merging — later classes WIN per
// Tailwind's last-class-wins semantics (see twMerge() below).

import { twMerge } from './twmerge.ts'

type VariantMap = Record<string, Record<string, string>>

type Choices<V extends VariantMap> = {
  [K in keyof V]?: keyof V[K]
}

type CompoundRules<V extends VariantMap> = ReadonlyArray<
  { readonly class: string } & {
    [K in keyof V]?: keyof V[K]
  }
>

export interface RecipeConfig<V extends VariantMap> {
  /** Always-applied base classes. */
  base?: string
  /** Named variant groups. Each maps option-key → class string. */
  variants?: V
  /** Multi-variant compound rules. Applied when all listed pins match. */
  compound?: CompoundRules<V>
  /** Default variant choices used when a caller omits them. */
  defaults?: Choices<V>
}

export type Recipe<V extends VariantMap> = (choices?: Choices<V>) => string

/**
 * Define a class-string variant recipe. Returns a function that, given
 * variant choices, returns the merged Tailwind class string.
 */
export function recipe<V extends VariantMap>(config: RecipeConfig<V>): Recipe<V> {
  const base = config.base ?? ''
  const variants = config.variants ?? ({} as V)
  const compound = config.compound ?? []
  const defaults = config.defaults ?? ({} as Choices<V>)
  return (choices?: Choices<V>): string => {
    const active: Choices<V> = { ...defaults, ...(choices ?? {}) }
    const parts: string[] = []
    if (base) parts.push(base)
    for (const variantName in variants) {
      const chosen = active[variantName]
      if (chosen === undefined) continue
      const variantClass = variants[variantName]?.[chosen as string]
      if (variantClass) parts.push(variantClass)
    }
    for (const rule of compound) {
      let matches = true
      for (const variantName in variants) {
        const pinned = (rule as Record<string, unknown>)[variantName]
        if (pinned !== undefined && pinned !== active[variantName]) {
          matches = false
          break
        }
      }
      if (matches && rule.class) parts.push(rule.class)
    }
    return twMerge(parts.join(' '))
  }
}
