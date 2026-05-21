// @vitest-environment happy-dom

import { mount } from '@place-ts/component'
import { state } from '@place-ts/reactivity'
import { describe, expect, test, vi } from 'vitest'
import { Combobox } from '../../src/Combobox.tsx'

// happy-dom popover polyfill — same pattern as Menu/Tooltip tests.
function patchPopover(): void {
  const proto = HTMLElement.prototype as HTMLElement & {
    showPopover?: () => void
    hidePopover?: () => void
    matches: (s: string) => boolean
  }
  const gt = globalThis as unknown as { __cbOpenSet?: WeakSet<HTMLElement> }
  if (!gt.__cbOpenSet) {
    gt.__cbOpenSet = new WeakSet()
  }
  const openSet = gt.__cbOpenSet
  if (typeof proto.showPopover !== 'function') {
    proto.showPopover = function (): void {
      openSet.add(this)
      this.setAttribute('data-popover-open', '')
      this.dispatchEvent(
        Object.assign(new Event('toggle'), { newState: 'open' }) as unknown as Event,
      )
    }
  }
  if (typeof proto.hidePopover !== 'function') {
    proto.hidePopover = function (): void {
      openSet.delete(this)
      this.removeAttribute('data-popover-open')
      this.dispatchEvent(
        Object.assign(new Event('toggle'), { newState: 'closed' }) as unknown as Event,
      )
    }
  }
  const originalMatches = proto.matches
  proto.matches = function (this: HTMLElement, selector: string): boolean {
    if (selector === ':popover-open') return openSet.has(this)
    return originalMatches.call(this, selector)
  } as unknown as typeof proto.matches
}

const SAMPLE_OPTIONS = [
  { value: 'a', label: 'Apple' },
  { value: 'b', label: 'Banana' },
  { value: 'c', label: 'Cherry', disabled: true },
  { value: 'd', label: 'Date' },
]

describe('Combobox — render + accessibility', () => {
  test('renders an <input role="combobox"> + <div role="listbox">', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        'aria-label': 'Pick fruit',
      }),
      root,
    )
    const input = root.querySelector('[role="combobox"]') as HTMLInputElement
    const listbox = root.querySelector('[role="listbox"]') as HTMLElement
    expect(input).not.toBeNull()
    expect(listbox).not.toBeNull()
    expect(input.tagName).toBe('INPUT')
    // `popover="manual"` because the input lives outside the popover —
    // auto would light-dismiss the instant the user clicks the input.
    expect(listbox.getAttribute('popover')).toBe('manual')
  })

  test('flex-shell wrapper has data-place-combobox', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        'aria-label': 'x',
      }),
      root,
    )
    const shell = root.querySelector('[data-place-combobox]') as HTMLElement
    expect(shell).not.toBeNull()
    // Flex shell, not absolute-positioned overlay.
    expect(shell.className).toContain('flex')
    expect(shell.className).toContain('items-stretch')
  })

  test('wires aria-controls to the listbox id', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        'aria-label': 'x',
      }),
      root,
    )
    const input = root.querySelector('[role="combobox"]') as HTMLInputElement
    const listbox = root.querySelector('[role="listbox"]') as HTMLElement
    expect(input.getAttribute('aria-controls')).toBe(listbox.id)
  })

  test('aria-activedescendant is OMITTED (not empty) when no option active', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        'aria-label': 'x',
      }),
      root,
    )
    const input = root.querySelector('[role="combobox"]') as HTMLInputElement
    // ARIA spec: empty string is announced as "blank" by some screen
    // readers; omit the attribute when no option is active.
    expect(input.hasAttribute('aria-activedescendant')).toBe(false)
  })

  test('renders one role="option" per option', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        'aria-label': 'x',
      }),
      root,
    )
    expect(root.querySelectorAll('[role="option"]').length).toBe(SAMPLE_OPTIONS.length)
  })

  test('disabled options render with the disabled attribute', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        'aria-label': 'x',
      }),
      root,
    )
    const options = Array.from(root.querySelectorAll('[role="option"]')) as HTMLButtonElement[]
    expect(options[2]?.disabled).toBe(true) // Cherry
    expect(options[0]?.disabled).toBe(false)
  })
})

describe('Combobox — selection + onChange', () => {
  test('clicking an option calls onChange with its value', () => {
    patchPopover()
    const root = document.createElement('div')
    const onChange = vi.fn()
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: null,
        onChange,
        'aria-label': 'x',
      }),
      root,
    )
    const options = Array.from(root.querySelectorAll('[role="option"]')) as HTMLButtonElement[]
    options[1]?.click() // Banana
    expect(onChange).toHaveBeenCalledWith('b')
  })

  test('clicking a disabled option does NOT fire onChange', () => {
    patchPopover()
    const root = document.createElement('div')
    const onChange = vi.fn()
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: null,
        onChange,
        'aria-label': 'x',
      }),
      root,
    )
    const options = Array.from(root.querySelectorAll('[role="option"]')) as HTMLButtonElement[]
    options[2]?.click() // Cherry (disabled)
    expect(onChange).not.toHaveBeenCalled()
  })

  test('selected option gets aria-selected="true"', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>('b')
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        'aria-label': 'x',
      }),
      root,
    )
    const options = Array.from(root.querySelectorAll('[role="option"]')) as HTMLButtonElement[]
    expect(options[1]?.getAttribute('aria-selected')).toBe('true')
    expect(options[0]?.getAttribute('aria-selected')).toBe('false')
  })
})

describe('Combobox — filter', () => {
  test('typing filters options by case-insensitive substring on label', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        'aria-label': 'x',
      }),
      root,
    )
    const input = root.querySelector('[role="combobox"]') as HTMLInputElement
    input.value = 'an'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const options = Array.from(root.querySelectorAll('[role="option"]')) as HTMLButtonElement[]
    const labels = options.map((o) => o.textContent?.trim() ?? '').filter(Boolean)
    expect(labels).toEqual(['Banana'])
  })

  test('empty filter result shows the emptyMessage', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        emptyMessage: 'Nothing here',
        'aria-label': 'x',
      }),
      root,
    )
    const input = root.querySelector('[role="combobox"]') as HTMLInputElement
    input.value = 'zzz'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(root.textContent).toContain('Nothing here')
    expect(root.querySelectorAll('[role="option"]').length).toBe(0)
  })

  test('custom filter overrides the default substring match', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        filter: (q, opt) => !opt.label.toLowerCase().includes(q),
        'aria-label': 'x',
      }),
      root,
    )
    const input = root.querySelector('[role="combobox"]') as HTMLInputElement
    input.value = 'a'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const labels = Array.from(root.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent?.trim() ?? '',
    )
    expect(labels).toEqual(['Cherry'])
  })
})

describe('Combobox — visible text', () => {
  test('shows the selected option label when nothing typed', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>('b')
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        'aria-label': 'x',
      }),
      root,
    )
    const input = root.querySelector('[role="combobox"]') as HTMLInputElement
    expect(input.value).toBe('Banana')
  })

  test('shows nothing when no value selected', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        'aria-label': 'x',
      }),
      root,
    )
    const input = root.querySelector('[role="combobox"]') as HTMLInputElement
    expect(input.value).toBe('')
  })
})

describe('Combobox — customization hooks (typed per-subpart classNames)', () => {
  test('renderOption replaces the default row layout', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        renderOption: (st) => `[custom] ${st.option.label}`,
        'aria-label': 'x',
      }),
      root,
    )
    const options = Array.from(root.querySelectorAll('[role="option"]'))
    expect(options[0]?.textContent).toContain('[custom] Apple')
    expect(options[1]?.textContent).toContain('[custom] Banana')
  })

  test('renderOption receives per-option state', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>('b')
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        renderOption: (st) => {
          const tags: string[] = []
          if (st.selected) tags.push('selected')
          if (st.disabled) tags.push('disabled')
          return `${st.option.label}[${tags.join(',')}]`
        },
        'aria-label': 'x',
      }),
      root,
    )
    const options = Array.from(root.querySelectorAll('[role="option"]'))
    expect(options[1]?.textContent).toContain('Banana[selected]')
    expect(options[2]?.textContent).toContain('Cherry[disabled]')
    expect(options[0]?.textContent).toContain('Apple[]')
  })

  test('renderEmpty overrides emptyMessage', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        emptyMessage: 'ignored',
        renderEmpty: () => 'CUSTOM EMPTY' as unknown as ReturnType<typeof Combobox>,
        'aria-label': 'x',
      }),
      root,
    )
    const input = root.querySelector('[role="combobox"]') as HTMLInputElement
    input.value = 'zzz'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(root.textContent).toContain('CUSTOM EMPTY')
    expect(root.textContent).not.toContain('ignored')
  })

  test('`class` prop adds onto the shell wrapper (root)', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        class: 'my-shell-class',
        'aria-label': 'x',
      }),
      root,
    )
    const shell = root.querySelector('[data-place-combobox]') as HTMLElement
    expect(shell.className).toContain('my-shell-class')
    expect(shell.className).toContain('flex') // recipe base still present
  })

  test('classNames.popover adds onto the listbox', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        classNames: { popover: 'my-pop-class' },
        'aria-label': 'x',
      }),
      root,
    )
    const listbox = root.querySelector('[role="listbox"]') as HTMLElement
    expect(listbox.className).toContain('my-pop-class')
    expect(listbox.className).toContain('place-combobox-popover')
  })

  test('classNames.option (string) adds onto every option', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        classNames: { option: 'my-opt' },
        'aria-label': 'x',
      }),
      root,
    )
    const options = Array.from(root.querySelectorAll('[role="option"]')) as HTMLElement[]
    for (const opt of options) expect(opt.className).toContain('my-opt')
  })

  test('classNames.option (function) receives per-option state', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>('b')
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        classNames: { option: (st) => (st.selected ? 'is-sel' : 'unsel') },
        'aria-label': 'x',
      }),
      root,
    )
    const options = Array.from(root.querySelectorAll('[role="option"]')) as HTMLElement[]
    expect(options[1]?.className).toContain('is-sel')
    expect(options[0]?.className).toContain('unsel')
  })

  test('clearable + value selected → × button visible; clears on click', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>('b')
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        'aria-label': 'x',
      }),
      root,
    )
    const clearBtn = root.querySelector('button[aria-label="Clear"]') as HTMLButtonElement | null
    expect(clearBtn).not.toBeNull()
    clearBtn?.click()
    expect(value()).toBe(null)
  })

  test('clearable={false} hides the × button', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>('b')
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        clearable: false,
        'aria-label': 'x',
      }),
      root,
    )
    expect(root.querySelector('button[aria-label="Clear"]')).toBeNull()
  })

  test('chevron={false} hides the dropdown indicator', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    mount(
      Combobox({
        options: SAMPLE_OPTIONS,
        value: () => value(),
        onChange: (v) => value.set(v),
        chevron: false,
        'aria-label': 'x',
      }),
      root,
    )
    // No value selected → no clear button, no check-icon SVG on
    // unselected options (default render emits a placeholder span,
    // not an SVG, for unselected rows). chevron={false} → no chevron
    // SVG either. Net: zero SVGs in the document.
    const svgs = Array.from(root.querySelectorAll('svg'))
    expect(svgs.length).toBe(0)
  })
})

describe('Combobox — reactive options', () => {
  test('options passed as a function re-evaluate on signal change', () => {
    patchPopover()
    const root = document.createElement('div')
    const value = state<string | null>(null)
    const opts = state(SAMPLE_OPTIONS as readonly { value: string; label: string }[])
    mount(
      Combobox({
        options: () => opts(),
        value: () => value(),
        onChange: (v) => value.set(v),
        'aria-label': 'x',
      }),
      root,
    )
    expect(root.querySelectorAll('[role="option"]').length).toBe(4)
    opts.set([{ value: 'x', label: 'Xenon' }])
    expect(root.querySelectorAll('[role="option"]').length).toBe(1)
    expect(root.textContent).toContain('Xenon')
  })
})
