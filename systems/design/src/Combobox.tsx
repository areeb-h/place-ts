// `<Combobox>` — typeahead select (Tier 17-A; ADR 0046 + 0047).
//
// **Flex-shell architecture.** Earlier versions positioned the
// leftIcon, clear button, and chevron *absolutely* over the input,
// then bumped the input's `padding-left` via `pl-8!` to make room.
// That pattern was structurally wrong:
//
//   1. Tailwind v4 (4.2.4) JIT generates `.pl-8` (no `!important`)
//      from the source candidate `pl-8!`. The HTML kept the literal
//      `pl-8!` class, which matches no CSS rule, so the input ended
//      up with zero padding-left and the icon sat on top of the
//      text.
//   2. Even with that fixed, `pointer-events: none` workarounds, the
//      hit-area extending under the icon, and the right-side stack
//      colliding with the input's typed text were all design smells.
//
// The replacement: a flex shell. The OUTER `<div>` carries the
// border / background / focus ring (via `focus-within:`). The icon,
// the bare `<input>` (no border, no bg, no pl override), and the
// right-side affordance group (clear + chevron) are flex siblings.
// No absolute positioning. No pl-N override. No hit-area surprises.
// Identical visual outcome; fewer failure modes.
//
// **Popover dismissal.** `popover="manual"` because the input lives
// outside the popover element. With auto the popover would
// light-dismiss the instant the user clicked the input to type. The
// dismiss logic is owned here: outside-click on `mousedown` (before
// focus shifts; avoids flicker), Escape, Tab away, option selection.
//
// **Keyboard interaction** follows WAI-ARIA Combobox v1.2 — ArrowDown
// opens + navigates, Enter selects, Escape closes, Home/End jump
// to first/last. Focus on the input alone does NOT open (audit
// finding; the previous version disrupted tab-flow through forms).
//
// **Customization hooks** (the "highly customizable" answer):
//   - `classNames={{ root, input, leftIcon, rightAffordance, chevron,
//     clear, popover, option, optionLabel, optionHint }}` — typed
//     per-subpart additive classes. The recipe variants are the
//     appearance channel (NN#4); classNames is the *additive*
//     channel.
//   - `renderOption({ option, active, selected, disabled })` —
//     custom row content. Default renders label + optional hint
//     with a leading check icon when selected.
//   - `renderEmpty()` — custom empty-state node.
//   - `leftIcon` — node placed before the input. Pure decoration.
//   - `chevron` — custom node or `false` to hide.
//   - `clearable` — show `×` button when a value is selected.
//   - `filter` — replace the default substring match.

import type { Children, View } from '@place/component'
import { cls, onMount, recipe } from '@place/component'
import { state, watch } from '@place/reactivity'
import {
  anchorStyle,
  closePopover,
  nextAnchorName,
  openPopover,
  popoverStyle,
} from './_popover.ts'

let _comboboxIdCounter = 0
const nextComboboxId = (): string => `place-combobox-${++_comboboxIdCounter}`

// Outer-shell recipe. Carries the input chrome (border, bg, ring).
// The bare `<input>` inside is unstyled by the recipe; it only
// carries `flex-1 min-w-0 bg-transparent outline-none` + typography.
const shellRecipe = recipe({
  base:
    'flex items-stretch w-full rounded-md border border-border bg-bg text-fg ' +
    'transition-[border-color,box-shadow,background-color] duration-150 ' +
    'focus-within:ring-2 focus-within:ring-accent/60 focus-within:border-accent/50 ' +
    'has-[input:disabled]:opacity-60 has-[input:disabled]:cursor-not-allowed',
  variants: {
    size: {
      sm: 'text-xs',
      md: 'text-sm',
      lg: 'text-sm',
    },
  },
  defaults: { size: 'md' },
})

const inputBaseClass =
  'flex-1 min-w-0 bg-transparent outline-none border-0 ' +
  'placeholder:text-muted text-fg ' +
  'disabled:cursor-not-allowed'

// Size-driven typography + height. The flex shell handles the border;
// the input just handles its own internal padding + size.
const inputSizeClass = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm',
  lg: 'px-3.5 py-2 text-sm',
} as const

// ===== Per-option render state passed to renderOption / classNames =====

export interface ComboboxItemState<T> {
  /** The option being rendered. */
  readonly option: ComboboxOption<T>
  /** True when this option is the keyboard-active row (Arrow-nav or hover). */
  readonly active: boolean
  /** True when this option's value === the current Combobox value. */
  readonly selected: boolean
  /** True when this option is marked disabled. */
  readonly disabled: boolean
}

export type ComboboxSize = 'sm' | 'md' | 'lg'

export interface ComboboxOption<T> {
  /** The value emitted via `onChange` when this option is selected. */
  readonly value: T
  /** Display label. Also used as the default filter target. */
  readonly label: string
  /** Disabled options are rendered but not selectable. */
  readonly disabled?: boolean
  /** Optional secondary text (right-aligned in the default row). */
  readonly hint?: string
}

/**
 * Part names addressable via `classNames`. The full part anatomy.
 *
 * **Note: `root` is NOT a key here.** Use the standalone `class`
 * prop for additive root classes — one spelling per concept (Tier
 * 17-D / ADR 0050). This is a deliberate divergence from Mantine
 * (which has both `className` AND `classNames.root` and merges
 * them). Two spellings for the same thing creates the "which do I
 * use?" footgun we're trying to avoid.
 */
export type ComboboxPart =
  | 'input'
  | 'leftIcon'
  | 'rightAffordance'
  | 'chevron'
  | 'clear'
  | 'popover'
  | 'option'
  | 'optionLabel'
  | 'optionHint'

export interface ComboboxProps<T> {
  /** Options to choose from. Static array OR reactive function. */
  readonly options: readonly ComboboxOption<T>[] | (() => readonly ComboboxOption<T>[])
  /** Selected value. Pass a getter for reactive binding. `null` = no selection. */
  readonly value: T | null | (() => T | null)
  /** Called when the user selects an option (or clears). */
  readonly onChange: (value: T | null) => void
  /** Custom filter. Default: case-insensitive substring match on `label`. */
  readonly filter?: (query: string, option: ComboboxOption<T>) => boolean
  /** Placeholder text shown when no value is selected. */
  readonly placeholder?: string
  /** Auto-generated if omitted. */
  readonly id?: string
  /** Form field name — emitted on the underlying `<input>`. */
  readonly name?: string
  /** Disable the combobox. */
  readonly disabled?: boolean | (() => boolean)
  /** Visual size variant. Default: `'md'`. */
  readonly size?: ComboboxSize
  /** Shown inside the popover when filtered list is empty. */
  readonly emptyMessage?: string
  /** Full custom empty-state renderer. */
  readonly renderEmpty?: () => View
  /** Full custom option renderer. */
  readonly renderOption?: (state: ComboboxItemState<T>) => Children
  /** Additive classes on the root (the flex shell). */
  readonly class?: string
  /**
   * Typed per-subpart class overrides (Tier 17-D / ADR 0050). The
   * `option` key may be a function receiving per-row state for
   * conditional styling; the rest are static strings. **Note**:
   * there is no `root` key — use the standalone `class` prop above.
   */
  readonly classNames?: Partial<{
    [K in ComboboxPart]: K extends 'option' ? string | ((state: ComboboxItemState<T>) => string) : string
  }>
  /** Show a clear (×) button when a value is selected. Default: `true`. */
  readonly clearable?: boolean
  /** Node placed before the input. Pure decoration. */
  readonly leftIcon?: View
  /** Node for the dropdown indicator. Pass `false` to hide. */
  readonly chevron?: View | false
  /** Required for screen readers if no `<label>` wraps the field. */
  readonly 'aria-label'?: string
}

// ===== Default icons =====

const DefaultChevron = (): View => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M6 8l4 4 4-4" />
  </svg>
)

const CheckIcon = (): View => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M5 10l3.5 3.5L15 7" />
  </svg>
)

const ClearIcon = (): View => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <path d="M5 5l10 10M15 5L5 15" />
  </svg>
)

/**
 * @provisional — shipped in Tier 16 (ADR 0046), rewritten in Tier 17
 * (ADR 0047). Single-select shape stable.
 */
export function Combobox<T>(props: ComboboxProps<T>): View {
  const comboboxId = props.id ?? nextComboboxId()
  const listboxId = `${comboboxId}-listbox`
  const optionIdPrefix = `${comboboxId}-option-`
  // Unique CSS anchor name — bound to the shell wrapper, referenced
  // by the popover via `position-anchor: --<name>`. Browser handles
  // positioning, flip-on-overflow, and stays-pinned-on-scroll.
  const anchorName = nextAnchorName()

  const isOpen = state(false)
  const query = state('')
  const activeIndex = state(-1)
  // Track whether the last interaction was via keyboard. When true,
  // ignore `onMouseEnter` updates so a drifting mouse doesn't fight
  // with arrow-key navigation (audit finding).
  const keyboardActive = state(false)

  let popoverEl: HTMLElement | null = null
  let inputEl: HTMLInputElement | null = null

  const readOptions = (): readonly ComboboxOption<T>[] =>
    typeof props.options === 'function' ? props.options() : props.options
  const readValue = (): T | null =>
    typeof props.value === 'function' ? (props.value as () => T | null)() : props.value
  const isDisabled = (): boolean =>
    typeof props.disabled === 'function' ? props.disabled() : props.disabled === true

  const selectedOption = (): ComboboxOption<T> | undefined => {
    const v = readValue()
    if (v === null) return undefined
    return readOptions().find((o) => o.value === v)
  }

  const visibleText = (): string => {
    if (query() !== '') return query()
    return selectedOption()?.label ?? ''
  }

  const filtered = (): readonly ComboboxOption<T>[] => {
    const q = query().trim().toLowerCase()
    const opts = readOptions()
    if (q === '') return opts
    const fn = props.filter
    if (fn) return opts.filter((o) => fn(q, o))
    return opts.filter((o) => o.label.toLowerCase().includes(q))
  }

  /** Index of the currently-selected option in the *filtered* list. */
  const selectedIndexInFiltered = (): number => {
    const v = readValue()
    if (v === null) return -1
    const opts = filtered()
    for (let i = 0; i < opts.length; i++) {
      if (opts[i]?.value === v) return i
    }
    return -1
  }

  // CSS Anchor Positioning takes over from the previous
  // `getBoundingClientRect`-flip-clamp positioner. The browser pins
  // the popover under the shell's anchor name, flips above on
  // viewport-bottom overflow (via `position-try-fallbacks:
  // flip-block, flip-inline`), and stays pinned on scroll / resize
  // without any JS listener. See `_popover.ts` and ADR 0048.
  const openListbox = (): void => {
    if (isOpen() || isDisabled()) return
    openPopover(popoverEl)
  }

  const closeListbox = (): void => {
    if (!isOpen()) return
    closePopover(popoverEl)
  }

  const onToggle = (e: Event): void => {
    const evt = e as Event & { newState?: 'open' | 'closed' }
    const next = evt.newState === 'open'
    isOpen.set(next)
    if (next) {
      // No JS positioning — the popover style already declares
      // `position-anchor: --<name>` etc. The browser does the math.
      // **Open to selected.** If a value is selected, highlight that
      // row first; otherwise -1 (no highlight). Mouse-or-keyboard
      // intent determines the next move. Audit finding: previous
      // -1-on-every-open lost user context.
      const sel = selectedIndexInFiltered()
      activeIndex.set(sel)
    } else {
      query.set('')
      keyboardActive.set(false)
    }
  }

  watch(() => {
    const open = isOpen()
    if (!popoverEl) return
    const popoverOpen = (popoverEl as HTMLElement & { matches?: (s: string) => boolean }).matches?.(
      ':popover-open',
    )
    if (open && !popoverOpen) openListbox()
    else if (!open && popoverOpen) closeListbox()
  })

  const firstEnabledIndex = (): number => {
    const opts = filtered()
    for (let i = 0; i < opts.length; i++) {
      const o = opts[i]
      if (o && !o.disabled) return i
    }
    return -1
  }
  const lastEnabledIndex = (): number => {
    const opts = filtered()
    for (let i = opts.length - 1; i >= 0; i--) {
      const o = opts[i]
      if (o && !o.disabled) return i
    }
    return -1
  }
  const nextEnabled = (from: number, dir: 1 | -1): number => {
    const opts = filtered()
    const n = opts.length
    if (n === 0) return -1
    let i = from
    for (let step = 0; step < n; step++) {
      i = (i + dir + n) % n
      const o = opts[i]
      if (o && !o.disabled) return i
    }
    return -1
  }

  const selectIndex = (i: number): void => {
    const opts = filtered()
    const opt = opts[i]
    if (!opt || opt.disabled) return
    props.onChange(opt.value)
    query.set('')
    closeListbox()
    inputEl?.focus()
  }

  const clearSelection = (): void => {
    props.onChange(null)
    query.set('')
    inputEl?.focus()
  }

  const onKey = (e: KeyboardEvent): void => {
    if (isDisabled()) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        keyboardActive.set(true)
        if (!isOpen()) {
          openListbox()
          // open(): the selected index is highlighted by onToggle;
          // if nothing selected, fall through to first enabled.
          if (selectedIndexInFiltered() < 0) activeIndex.set(firstEnabledIndex())
          return
        }
        activeIndex.set(activeIndex() < 0 ? firstEnabledIndex() : nextEnabled(activeIndex(), 1))
        return
      case 'ArrowUp':
        e.preventDefault()
        keyboardActive.set(true)
        if (!isOpen()) {
          openListbox()
          if (selectedIndexInFiltered() < 0) activeIndex.set(lastEnabledIndex())
          return
        }
        activeIndex.set(activeIndex() < 0 ? lastEnabledIndex() : nextEnabled(activeIndex(), -1))
        return
      case 'Home':
        if (!isOpen()) return
        e.preventDefault()
        keyboardActive.set(true)
        activeIndex.set(firstEnabledIndex())
        return
      case 'End':
        if (!isOpen()) return
        e.preventDefault()
        keyboardActive.set(true)
        activeIndex.set(lastEnabledIndex())
        return
      case 'Enter': {
        if (!isOpen()) return
        const i = activeIndex()
        if (i >= 0) {
          e.preventDefault()
          selectIndex(i)
        }
        return
      }
      case 'Backspace':
        if (query() === '' && readValue() !== null) {
          e.preventDefault()
          clearSelection()
        }
        return
      case 'Escape':
        if (!isOpen()) return
        e.preventDefault()
        closeListbox()
        return
      case 'Tab':
        if (isOpen()) closeListbox()
        return
    }
  }

  const onInput = (e: Event): void => {
    if (isDisabled()) return
    const target = e.target as HTMLInputElement
    query.set(target.value)
    // Typing IS keyboard activity; suppress mouse hover override.
    keyboardActive.set(true)
    if (!isOpen()) openListbox()
    activeIndex.set(firstEnabledIndex())
  }

  // **Audit finding**: `onFocus` opening the popover automatically
  // disrupts tab flow through forms. WAI-ARIA Combobox v1.2 says
  // open on user intent (click, ArrowDown), not on focus alone.
  // The popover opens on:
  //   - Mouse click on the input or the right-side affordance
  //   - ArrowDown / ArrowUp keypress (handled in onKey)
  //   - Typing (handled in onInput)
  const onClick = (): void => {
    if (isDisabled()) return
    if (!isOpen()) openListbox()
  }

  onMount(() => {
    if (typeof window === 'undefined') return () => {}
    // **No scroll/resize listener.** CSS anchor positioning keeps
    // the popover pinned automatically on viewport change. This
    // alone deletes the per-page rAF cascade the old positioner
    // triggered on every scroll wheel tick.
    //
    // Outside-click dismissal stays — we use `popover="manual"`
    // because the input is OUTSIDE the popover (auto would
    // light-dismiss the moment the user clicks the input to type).
    const onDocMouseDown = (e: MouseEvent): void => {
      if (!isOpen()) return
      const target = e.target as Node | null
      if (!target) return
      if (rootEl?.contains(target)) return
      if (popoverEl?.contains(target)) return
      closeListbox()
    }
    // Reset keyboard-active flag when the user moves the mouse —
    // they're switching back to mouse-driven nav.
    const onDocMouseMove = (): void => {
      if (keyboardActive()) keyboardActive.set(false)
    }
    document.addEventListener('mousedown', onDocMouseDown, true)
    document.addEventListener('mousemove', onDocMouseMove, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown, true)
      document.removeEventListener('mousemove', onDocMouseMove)
    }
  })

  let rootEl: HTMLElement | null = null

  // Resolve typed classNames. Each value is either a static string
  // OR a function (only the `option` part receives state). The
  // root's additive class comes from `props.class`, not from
  // `classNames.root` (which doesn't exist by design).
  const cn = props.classNames ?? {}
  const resolveStatic = (key: Exclude<ComboboxPart, 'option'>): string => {
    const v = cn[key]
    return typeof v === 'string' ? v : ''
  }
  const resolveOptionClass = (st: ComboboxItemState<T>): string => {
    const v = cn.option
    if (typeof v === 'function') return v(st)
    return typeof v === 'string' ? v : ''
  }

  const shellBase = shellRecipe(
    props.size !== undefined ? { size: props.size } : {},
  )
  const shellClass = cls(shellBase, props.class ?? '')

  const size = props.size ?? 'md'
  const inputClass = cls(inputBaseClass, inputSizeClass[size], 'place-combobox-input', resolveStatic('input'))

  // Popover chrome only — positioning comes from the inline
  // `style` via `popoverStyle()`. No `fixed`, `m-0`, `top`, `left`
  // utility classes here; the CSS-anchor-positioning rules in the
  // inline style own those.
  const listboxClass = cls(
    'place-combobox-popover',
    'p-1 rounded-xl bg-card border border-border/60 shadow-lg shadow-bg/40',
    'max-h-[60vh] overflow-y-auto',
    '[&]:bg-card',
    resolveStatic('popover'),
  )

  const shellAnchorStyle = anchorStyle(anchorName)
  const popoverPositionStyle = popoverStyle({
    anchor: anchorName,
    placement: 'bottom-start',
    width: 'anchor-width',
    offset: 4,
  })

  const clearable = props.clearable !== false
  const showChevron = props.chevron !== false

  const defaultRenderOption = (st: ComboboxItemState<T>): Children => (
    <>
      {st.selected ? (
        <span class={cls('shrink-0 inline-flex items-center text-accent', resolveStatic('chevron') /* slot reused for check */)}>
          <CheckIcon />
        </span>
      ) : (
        <span class="shrink-0 w-[14px]" aria-hidden="true" />
      )}
      <span class={cls('flex-1 truncate', resolveStatic('optionLabel'))}>{st.option.label}</span>
      {st.option.hint ? (
        <span class={cls('text-xs font-mono text-muted shrink-0', resolveStatic('optionHint'))}>
          {st.option.hint}
        </span>
      ) : null}
    </>
  )

  const renderOption = props.renderOption ?? defaultRenderOption
  const renderEmpty =
    props.renderEmpty ??
    (() => (
      <div class="px-3 py-3 text-sm text-muted text-center">
        {props.emptyMessage ?? 'No matches'}
      </div>
    ))

  const baseOptionClass =
    'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm text-left ' +
    'transition-colors duration-100 cursor-pointer outline-none ' +
    'disabled:opacity-50 disabled:cursor-not-allowed text-fg'

  const computeOptionClass = (st: ComboboxItemState<T>): string => {
    // **Visible hover.** The popover's bg is `bg-card`, so
    // `hover:bg-card/*` is invisible (same color). Use `bg-fg/*` for
    // a tonal hover that reads against the popover, regardless of
    // theme. Active (keyboard nav) stays accent-tinted to
    // distinguish from mere hover.
    const stateClass = st.active
      ? 'bg-accent/12 text-fg'
      : st.selected
        ? 'bg-accent/6 hover:bg-accent/12'
        : 'hover:bg-fg/5'
    const selectedClass = st.selected ? 'font-medium' : ''
    return cls(baseOptionClass, stateClass, selectedClass, resolveOptionClass(st))
  }

  // ===== Render — flex shell =====

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: shell is a flex wrapper; the interactive role lives on the <input> child. Click is a tap-anywhere-focuses-input shortcut.
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users reach the <input> directly via Tab; no key equivalent needed for the shell click
    <div
      data-place-combobox=""
      class={shellClass}
      style={shellAnchorStyle}
      onClick={onClick}
      ref={(el: HTMLElement) => {
        rootEl = el
      }}
    >
      {props.leftIcon ? (
        // `pl-3` (12px) gives the icon visual breathing room from the
        // shell's rounded border. The input's own `px-3` then leaves
        // a clean ~12px gap between icon and text.
        <span
          class={cls(
            'flex items-center pl-3 text-muted shrink-0 [&_svg]:size-4',
            resolveStatic('leftIcon'),
          )}
          aria-hidden="true"
        >
          {props.leftIcon}
        </span>
      ) : null}
      <input
        id={comboboxId}
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck={false}
        class={inputClass}
        placeholder={props.placeholder}
        name={props.name}
        disabled={isDisabled() ? true : undefined}
        aria-label={props['aria-label']}
        aria-expanded={() => (isOpen() ? 'true' : 'false')}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={() => {
          const i = activeIndex()
          return i >= 0 ? `${optionIdPrefix}${i}` : undefined
        }}
        value={() => visibleText()}
        onInput={onInput}
        onKeyDown={onKey as unknown as (e: Event) => void}
        ref={(el: HTMLElement) => {
          inputEl = el as HTMLInputElement
        }}
      />
      <span
        class={cls(
          'flex items-center gap-0.5 pr-2 shrink-0',
          resolveStatic('rightAffordance'),
        )}
      >
        {clearable
          ? (() => {
              if (readValue() === null) return null
              return (
                <button
                  type="button"
                  tabindex={-1}
                  aria-label="Clear"
                  onClick={(e: Event) => {
                    e.preventDefault()
                    e.stopPropagation()
                    clearSelection()
                  }}
                  class={cls(
                    'inline-flex items-center justify-center w-5 h-5 rounded text-muted',
                    'hover:text-fg hover:bg-card/80 transition-colors',
                    resolveStatic('clear'),
                  )}
                >
                  <ClearIcon />
                </button>
              )
            })
          : null}
        {showChevron ? (
          <span
            class={cls(
              'inline-flex items-center text-muted transition-transform duration-150 [&_svg]:size-3.5',
              resolveStatic('chevron'),
            )}
            style={() => (isOpen() ? 'transform: rotate(180deg)' : '')}
            aria-hidden="true"
          >
            {props.chevron === undefined ? <DefaultChevron /> : (props.chevron as View)}
          </span>
        ) : null}
      </span>
      <div
        id={listboxId}
        role="listbox"
        popover="manual"
        class={listboxClass}
        style={popoverPositionStyle}
        onToggle={onToggle as unknown as (e: Event) => void}
        ref={(el: HTMLElement) => {
          popoverEl = el
        }}
      >
        {() => {
          const opts = filtered()
          if (opts.length === 0) return renderEmpty()
          return opts.map((opt, i) => {
            const stateOf = (): ComboboxItemState<T> => ({
              option: opt,
              active: activeIndex() === i,
              selected: readValue() === opt.value,
              disabled: opt.disabled === true,
            })
            return (
              <button
                type="button"
                role="option"
                id={`${optionIdPrefix}${i}`}
                disabled={opt.disabled === true || undefined}
                aria-selected={() => (stateOf().selected ? 'true' : 'false')}
                onMouseEnter={() => {
                  // Skip mouse hover updates while keyboard nav is
                  // in progress — otherwise drifting mouse fights
                  // with arrow-key navigation.
                  if (keyboardActive()) return
                  activeIndex.set(i)
                }}
                onClick={(e: Event) => {
                  e.stopPropagation() // don't trigger the shell onClick
                  selectIndex(i)
                }}
                class={() => computeOptionClass(stateOf())}
              >
                {() => renderOption(stateOf())}
              </button>
            )
          })
        }}
      </div>
    </div>
  )
}
