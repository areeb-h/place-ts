// ===== cls — Tailwind-aware conditional class composition =====
//
// Combined clsx + tailwind-merge: collect class strings (with optional
// conditional object shorthand), then run them through `twMerge()` so
// later classes win per Tailwind's last-class-wins semantics.
//
//   <div class={cls('p-4', { 'bg-red-500': isError })}>
//   <button class={cls(button({ intent: 'primary' }), 'px-6')}>...</button>
//
// The Tailwind-aware merge means `cls('px-4', 'px-6')` returns `'px-6'`
// — no duplicated/conflicting classes shipped to the browser.

import { twMerge } from '../twmerge.ts'

export type ClassValue =
  | string
  | number
  | false
  | null
  | undefined
  | { [key: string]: boolean | undefined }
  | ClassValue[]

function flatten(args: ClassValue[], parts: string[]): void {
  for (const arg of args) {
    if (!arg && arg !== 0) continue
    if (typeof arg === 'string' || typeof arg === 'number') {
      parts.push(String(arg))
    } else if (Array.isArray(arg)) {
      flatten(arg, parts)
    } else if (typeof arg === 'object') {
      for (const [key, value] of Object.entries(arg)) {
        if (value) parts.push(key)
      }
    }
  }
}

export function cls(...args: ClassValue[]): string {
  const parts: string[] = []
  flatten(args, parts)
  return twMerge(parts.join(' '))
}
