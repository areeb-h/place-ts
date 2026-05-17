// Interactive demo for `<Sheet>` + `<Combobox>` (Tier 16-D, ADR 0046).
// ISLAND.
//
// Two Combobox demos:
//   - One inside a Sheet (drawer pattern), default styling.
//   - One inline, with custom renderOption (an emoji-prefixed row)
//     showing the customization story.

import { island, state, type View } from '@place/component'
import { Button, Combobox, Sheet, type ComboboxItemState } from '@place/design'

interface Framework {
  readonly value: string
  readonly label: string
  readonly hint?: string
  readonly disabled?: boolean
  readonly emoji?: string
}

const FRAMEWORKS: readonly Framework[] = [
  { value: 'place', label: 'Place', hint: 'this one', emoji: '◇' },
  { value: 'next', label: 'Next.js', hint: '15+', emoji: '▲' },
  { value: 'remix', label: 'Remix', hint: '2.x', emoji: '💿' },
  { value: 'sveltekit', label: 'SvelteKit', hint: '2.x', emoji: '🟠' },
  { value: 'astro', label: 'Astro', hint: '6 beta', emoji: '🚀' },
  { value: 'qwik', label: 'Qwik', emoji: '⚡' },
  { value: 'solid-start', label: 'SolidStart', emoji: '🔷' },
  { value: 'tanstack-start', label: 'TanStack Start', emoji: '🦋' },
  { value: 'fresh', label: 'Fresh', hint: 'Deno', emoji: '🍋' },
  { value: 'nuxt', label: 'Nuxt', hint: '4', emoji: '💚' },
]

const SearchIcon = (): View => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="9" cy="9" r="6" />
    <path d="M14 14l3 3" />
  </svg>
)

const SheetComboboxDemoImpl = (): View => {
  const open = state(false)
  const pick1 = state<string | null>(null)
  const pick2 = state<string | null>('astro')

  const labelOf = (v: string | null): string => {
    if (v === null) return 'nothing selected'
    return FRAMEWORKS.find((f) => f.value === v)?.label ?? v
  }

  return (
    <div class="not-prose my-4 flex flex-col gap-6 p-4 rounded-lg border border-border bg-card/60">
      {/* Demo 1: in-Sheet combobox with default styling */}
      <div class="flex flex-col gap-3">
        <div class="text-xs uppercase tracking-wide text-muted">
          Default styling, in a Sheet
        </div>
        <div class="flex items-center gap-3">
          <Button intent="primary" onClick={() => open.set(true)}>
            Open sheet
          </Button>
          <span class="text-sm text-muted">
            Pick: <span class="font-mono text-fg">{() => labelOf(pick1())}</span>
          </span>
        </div>
      </div>

      {/* Demo 2: inline combobox showcasing customization.
          - `leftIcon` for a search-style affordance
          - `renderOption` for a custom row layout (emoji prefix)
          - We deliberately DON'T override the selected indicator —
            the default selected state (subtle bg tint + bold label)
            does the job. Custom render hooks should ADD visual
            information, not duplicate framework affordances. */}
      <div class="flex flex-col gap-2">
        <div class="text-xs uppercase tracking-wide text-muted">
          Custom renderOption + leftIcon
        </div>
        <div style="max-width: 24rem">
          <Combobox
            options={FRAMEWORKS}
            value={() => pick2()}
            onChange={(v) => pick2.set(v)}
            placeholder="Search frameworks…"
            leftIcon={<SearchIcon />}
            renderOption={(st: ComboboxItemState<string>) => {
              const f = st.option as Framework
              return (
                <>
                  <span class="shrink-0 text-base w-5 text-center">{f.emoji ?? '•'}</span>
                  <span class="flex-1 truncate">{f.label}</span>
                  {f.hint ? (
                    <span class="text-xs font-mono text-muted shrink-0">{f.hint}</span>
                  ) : null}
                </>
              )
            }}
            aria-label="Framework (custom render)"
          />
        </div>
        <div class="text-sm text-muted">
          Pick: <span class="font-mono text-fg">{() => labelOf(pick2())}</span>
        </div>
      </div>

      <Sheet
        open={() => open()}
        onClose={() => open.set(false)}
        side="right"
        size="md"
        aria-label="Framework picker"
      >
        <Sheet.Header>
          <h3 class="text-base font-semibold">Pick a framework</h3>
          <Button intent="ghost" size="sm" onClick={() => open.set(false)}>
            close
          </Button>
        </Sheet.Header>
        <Sheet.Body>
          <p class="text-sm text-muted mb-3">
            Type to filter. Arrow keys + Enter to select. Backspace clears.
          </p>
          <Combobox
            options={FRAMEWORKS}
            value={() => pick1()}
            onChange={(v) => pick1.set(v)}
            placeholder="Search frameworks…"
            emptyMessage="No matching framework"
            aria-label="Framework"
          />
          <p class="mt-3 text-sm">
            Selected:{' '}
            <span class="font-mono text-accent">{() => labelOf(pick1())}</span>
          </p>
        </Sheet.Body>
        <Sheet.Footer>
          <Button
            intent="ghost"
            onClick={() => {
              pick1.set(null)
            }}
          >
            Reset
          </Button>
          <Button intent="primary" onClick={() => open.set(false)}>
            Done
          </Button>
        </Sheet.Footer>
      </Sheet>
    </div>
  )
}

const SheetComboboxDemo = island(SheetComboboxDemoImpl)
export default SheetComboboxDemo
