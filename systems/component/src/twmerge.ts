// ===== Tailwind-aware class merge =====
//
// Replaces the external `tailwind-merge` library with an in-framework
// parser of Tailwind's known utility groups. Late classes WIN per
// Tailwind's last-class-wins precedence. Same-group classes from
// earlier in the string are dropped; classes from different groups
// stack normally.
//
// Scope: covers the families that collide in real apps — spacing,
// sizing, colors, typography, borders, shadows, opacity, etc. Variant
// prefixes (`hover:`, `md:`, `dark:`, etc.) are preserved as part of
// the group key so `hover:bg-red-500` doesn't override `bg-blue-500`.
//
// LRU cache keyed by the input string. Bounded so memory is stable;
// real apps reuse the same recipe outputs heavily.

const MAX_CACHE = 1000
const cache = new Map<string, string>()

// Class groups: each class prefix maps to a group key. When two classes
// in the same group appear, the LATER one wins. Tailwind's actual
// algorithm is more nuanced (arbitrary values, JIT scanning) but for
// the common-case static recipe strings this captures the right shape.
//
// Group keys are short tags. Anything not in this map is treated as
// its own (singleton) group — never collides.
//
// GROUPS are matched in order; the FIRST matching pattern wins. Put
// specific keyword/numeric matches BEFORE the broad `^prefix-`
// catchall, otherwise everything collapses into one family.
//
// Why utilities like `shadow`, `border`, `text`, `bg` get split into
// sub-groups: these prefixes target multiple CSS properties /
// variables that COMPOSE rather than override. `shadow-lg` sets
// `--tw-shadow` (size ramp); `shadow-bg/30` sets `--tw-shadow-color`
// — both must survive. Same for `border` (width / color / style),
// `text` (size / color / alignment), `bg` (color / image / position
// / repeat / attachment / clip / origin / blend).

const GROUPS: ReadonlyArray<readonly [pattern: RegExp, group: string]> = [
  // Spacing — padding / margin / gap / space-{x,y}
  [/^p-/, 'p'],
  [/^px-/, 'px'],
  [/^py-/, 'py'],
  [/^pt-/, 'pt'],
  [/^pr-/, 'pr'],
  [/^pb-/, 'pb'],
  [/^pl-/, 'pl'],
  [/^m-/, 'm'],
  [/^mx-/, 'mx'],
  [/^my-/, 'my'],
  [/^mt-/, 'mt'],
  [/^mr-/, 'mr'],
  [/^mb-/, 'mb'],
  [/^ml-/, 'ml'],
  [/^gap-/, 'gap'],
  [/^gap-x-/, 'gap-x'],
  [/^gap-y-/, 'gap-y'],
  [/^space-x-/, 'space-x'],
  [/^space-y-/, 'space-y'],
  // Sizing
  [/^w-/, 'w'],
  [/^h-/, 'h'],
  [/^min-w-/, 'min-w'],
  [/^min-h-/, 'min-h'],
  [/^max-w-/, 'max-w'],
  [/^max-h-/, 'max-h'],
  [/^size-/, 'size'],
  // Backgrounds — sub-grouped by CSS property. The non-color
  // sub-groups (image / position / repeat / attachment / clip /
  // origin / blend) compose with bg-color, so they must be split out
  // before the bg-color catchall.
  [/^bg-gradient-/, 'bg-image'],
  [/^bg-none$/, 'bg-image'],
  [/^bg-(auto|cover|contain)$/, 'bg-size'],
  [
    /^bg-(top|bottom|left|right|center|top-left|top-right|bottom-left|bottom-right|left-top|left-bottom|right-top|right-bottom)$/,
    'bg-position',
  ],
  [/^bg-(repeat|no-repeat|repeat-x|repeat-y|repeat-round|repeat-space)$/, 'bg-repeat'],
  [/^bg-(fixed|local|scroll)$/, 'bg-attachment'],
  [/^bg-clip-/, 'bg-clip'],
  [/^bg-origin-/, 'bg-origin'],
  [/^bg-blend-/, 'bg-blend'],
  [/^bg-/, 'bg-color'],
  // Text + typography. text-size (`text-lg`, `text-[14px]`), text-align
  // (`text-left`), text-color (everything else) all target different
  // CSS properties — keep them separate.
  [/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl|\[)/, 'text-size'],
  [/^text-(left|center|right|justify|start|end)$/, 'text-align'],
  [/^text-/, 'text-color'],
  [/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)/, 'font-weight'],
  [/^font-/, 'font-family'],
  [/^leading-/, 'leading'],
  [/^tracking-/, 'tracking'],
  // Borders — width / color / style compose, so each needs its own
  // sub-group. Width is the bare `border` keyword or a numeric size
  // (`border-2`, `border-4`); style is one of the named keywords;
  // everything else (theme tokens, named colors, arbitrary values
  // like `border-[color-mix(...)]`) is color. Same split applies to
  // each individual side (x/y/t/r/b/l).
  [/^border-(solid|dashed|dotted|double|none|hidden)$/, 'border-style'],
  [/^border-(collapse|separate)$/, 'border-collapse'],
  [/^border-spacing-/, 'border-spacing'],
  [/^border$/, 'border-w'],
  [/^border-\d/, 'border-w'],
  [/^border-x$/, 'border-x-w'],
  [/^border-x-\d/, 'border-x-w'],
  [/^border-x-/, 'border-x-color'],
  [/^border-y$/, 'border-y-w'],
  [/^border-y-\d/, 'border-y-w'],
  [/^border-y-/, 'border-y-color'],
  [/^border-t$/, 'border-t-w'],
  [/^border-t-\d/, 'border-t-w'],
  [/^border-t-/, 'border-t-color'],
  [/^border-r$/, 'border-r-w'],
  [/^border-r-\d/, 'border-r-w'],
  [/^border-r-/, 'border-r-color'],
  [/^border-b$/, 'border-b-w'],
  [/^border-b-\d/, 'border-b-w'],
  [/^border-b-/, 'border-b-color'],
  [/^border-l$/, 'border-l-w'],
  [/^border-l-\d/, 'border-l-w'],
  [/^border-l-/, 'border-l-color'],
  [/^border-/, 'border-color'],
  [/^rounded-/, 'rounded'],
  [/^rounded$/, 'rounded'],
  // Shadows — size (`shadow-lg`) sets --tw-shadow, color
  // (`shadow-bg/30`) sets --tw-shadow-color. They compose.
  [/^shadow$/, 'shadow-size'],
  [/^shadow-(2xs|xs|sm|md|lg|xl|2xl|none|inner)$/, 'shadow-size'],
  [/^shadow-/, 'shadow-color'],
  [/^opacity-/, 'opacity'],
  // Layout
  [/^flex-/, 'flex-grow-shrink'],
  [/^grow/, 'grow'],
  [/^shrink/, 'shrink'],
  [/^items-/, 'items'],
  [/^justify-/, 'justify'],
  [/^content-/, 'content'],
  [/^self-/, 'self'],
  [/^place-/, 'place'],
  // Display
  [
    /^block$|^inline$|^inline-block$|^flex$|^inline-flex$|^grid$|^inline-grid$|^hidden$|^contents$/,
    'display',
  ],
  // Position
  [/^static$|^fixed$|^absolute$|^relative$|^sticky$/, 'position'],
  [/^top-/, 'top'],
  [/^right-/, 'right'],
  [/^bottom-/, 'bottom'],
  [/^left-/, 'left'],
  [/^inset-/, 'inset'],
  [/^z-/, 'z'],
  // Overflow
  [/^overflow-x-/, 'overflow-x'],
  [/^overflow-y-/, 'overflow-y'],
  [/^overflow-/, 'overflow'],
  // Cursor
  [/^cursor-/, 'cursor'],
  // Transition / animation
  [/^transition/, 'transition'],
  [/^duration-/, 'duration'],
  [/^ease-/, 'ease'],
  [/^animate-/, 'animate'],
]

function classGroup(cls: string): string | null {
  // Strip variant prefixes (e.g. `hover:`, `md:`, `dark:`). Preserve
  // them in the group key so `hover:bg-x` and `bg-x` don't collide.
  let prefix = ''
  let rest = cls
  while (true) {
    const colon = rest.indexOf(':')
    if (colon < 0) break
    // Only treat as variant if the part before colon doesn't contain
    // a slash, bracket, etc. — those mean it's an arbitrary value.
    const candidate = rest.slice(0, colon)
    if (!/^[a-zA-Z0-9_-]+$/.test(candidate)) break
    prefix += `${candidate}:`
    rest = rest.slice(colon + 1)
  }
  for (const [pattern, group] of GROUPS) {
    if (pattern.test(rest)) return `${prefix}${group}`
  }
  return null
}

/**
 * Merge class strings with Tailwind precedence: later classes in the
 * same utility group override earlier ones. Different groups stack.
 *
 *   twMerge('px-4 py-2 px-6')       → 'py-2 px-6'
 *   twMerge('bg-red-500 bg-blue-500') → 'bg-blue-500'
 *   twMerge('px-4 hover:px-6')       → 'px-4 hover:px-6'  (different group)
 */
export function twMerge(input: string): string {
  if (!input?.includes(' ')) return input.trim()
  const cached = cache.get(input)
  if (cached !== undefined) return cached
  const tokens = input.split(/\s+/).filter(Boolean)
  // Walk right-to-left, keeping the first occurrence (which is rightmost
  // in the input) per group. Singleton classes (no group) are always kept.
  const seenGroups = new Set<string>()
  const kept: string[] = []
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i] as string
    const group = classGroup(tok)
    if (group !== null) {
      if (seenGroups.has(group)) continue
      seenGroups.add(group)
    }
    kept.push(tok)
  }
  const result = kept.reverse().join(' ')
  if (cache.size >= MAX_CACHE) {
    // Simple eviction: drop the oldest entry (Map iteration order).
    const firstKey = cache.keys().next().value
    if (firstKey !== undefined) cache.delete(firstKey)
  }
  cache.set(input, result)
  return result
}
