// Cmd+K / Ctrl+K fuzzy-search palette. ISLAND.
//
// Builds an in-memory index from FLAT_NAV at island-mount; the modal
// opens on hotkey or via the shared `open` signal toggled by the
// SearchTrigger island. Navigation uses `RouterCap.use()`; the cap
// is auto-installed by the framework's `_auto-init.ts` generated
// from `app({ router })` config — no per-island side-effect imports.
//
// `open` is exported as a named export; SearchTrigger imports it
// directly (T6-E — collapsed the previous `_search-state.ts` helper
// file into the consuming island). Bun's `splitting: true` puts the
// signal in a shared chunk so the two islands see the same instance
// without dragging this palette impl into the trigger's bundle.

import { Activity, globalKey, state, view } from '@place/component'
import { RouterCap } from '@place/routing'
import { FLAT_NAV, type FlatNavEntry } from '../nav-index.ts'

/** Shared open-state for the search pair. Imported by the trigger island. */
export const open = state(false)

interface Scored {
  readonly entry: FlatNavEntry
  readonly score: number
}

const score = (entry: FlatNavEntry, q: string): number => {
  if (!q) return 1
  const lo = q.toLowerCase()
  const label = entry.label.toLowerCase()
  const tail = entry.to.toLowerCase()
  const kw = (entry.keywords ?? []).map((k) => k.toLowerCase())

  if (label.startsWith(lo)) return 100 - lo.length
  if (label.includes(lo)) return 80 - label.indexOf(lo)
  if (tail.includes(lo)) return 60
  for (const k of kw) {
    if (k.startsWith(lo)) return 50
    if (k.includes(lo)) return 40
  }
  if (entry.section.toLowerCase().includes(lo)) return 20
  return 0
}

const SearchPaletteImpl = () => {
  const query = state('')
  const cursor = state(0)
  const router = RouterCap.use()
  let inputEl: HTMLInputElement | null = null

  globalKey(
    'mod+k',
    () => {
      const next = !open()
      open.set(next)
      query.set('')
      cursor.set(0)
      if (next) queueMicrotask(() => inputEl?.focus())
    },
    { preventDefault: true },
  )

  globalKey('Escape', () => {
    if (open()) open.set(false)
  })

  const filtered = (): readonly Scored[] => {
    const q = query()
    return FLAT_NAV.map((entry) => ({ entry, score: score(entry, q) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
  }

  const choose = (entry: FlatNavEntry): void => {
    router.navigate(entry.to)
    open.set(false)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    const list = filtered()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      cursor.set(Math.min(cursor() + 1, list.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      cursor.set(Math.max(cursor() - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = list[cursor()]
      if (hit) choose(hit.entry)
    }
  }

  return (
    <div class="search-palette" class:open={open}>
      <Activity when={open}>
        <button
          type="button"
          class="search-backdrop"
          aria-label="Close search"
          onClick={() => open.set(false)}
        />
        <div class="search-modal" role="dialog" aria-label="Search">
          <div class="search-input-row">
            <span class="search-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              type="search"
              class="search-input"
              placeholder="Search docs…"
              ref={(el: HTMLInputElement) => {
                inputEl = el
              }}
              bind:value={query}
              onInput={() => cursor.set(0)}
              onKeyDown={onKeyDown}
            />
            <kbd class="search-hint">esc</kbd>
          </div>
          <div class="search-results">
            {() => {
              const list = filtered()
              if (list.length === 0) {
                return <div class="search-empty">No matches.</div>
              }
              return list.map((s, i) => (
                <button
                  type="button"
                  class="search-row"
                  class:active={() => cursor() === i}
                  onMouseEnter={() => cursor.set(i)}
                  onClick={() => choose(s.entry)}
                >
                  <span class="search-row-label">{s.entry.label}</span>
                  <span class="search-row-section">{s.entry.section}</span>
                </button>
              ))
            }}
          </div>
          <div class="search-footer">
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> to navigate
            </span>
            <span>
              <kbd>↵</kbd> to select
            </span>
            <span>
              <kbd>⌘K</kbd> to toggle
            </span>
          </div>
        </div>
      </Activity>
    </div>
  )
}

export default view(SearchPaletteImpl)
