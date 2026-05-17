// Demo-only persistence-backend switcher. Reloads the page with
// `?backend=` so the store is reconstructed cleanly on the new
// adapter (mid-session swaps would leave consumers subscribed to the
// previous state).
//
// Rendered as a low-priority footer chip — it's a platform feature
// (memory / localStorage / IndexedDB / crossTab / sync-server impl
// swap with zero consumer code change), not something an end user
// would interact with daily, so it stays out of the primary nav.

import { cls, component, type View } from '@place/component'
import { state } from '@place/reactivity'
import { activeBackend, type Backend } from '../store.ts'

const BACKENDS: { value: Backend; label: string; hint: string }[] = [
  { value: 'memory', label: 'memory', hint: 'lost on reload' },
  { value: 'localStorage', label: 'localStorage', hint: 'survives reload, single tab' },
  {
    value: 'crossTab',
    label: 'crossTab',
    hint: 'survives reload + tab broadcast (default)',
  },
  { value: 'indexedDB', label: 'indexedDB', hint: 'async, larger values' },
  {
    value: 'server',
    label: 'server',
    hint: 'Bun sync server at :5180 — run `bun run sync-server` first',
  },
]

const switchTo = (b: Backend): void => {
  if (typeof globalThis.location === 'undefined') return
  const url = new URL(globalThis.location.href)
  url.searchParams.set('backend', b)
  globalThis.location.href = url.toString()
}

export const BackendSwitcher = component(() => {
  const open = state(false)
  const current = (): Backend => activeBackend()
  return (
    <div class="relative inline-block">
      {() =>
        open() ? (
          <Expanded current={current} close={() => open.set(false)} />
        ) : (
          <Chip current={current} onOpen={() => open.set(true)} />
        )
      }
    </div>
  )
})

const Chip = component((p: { current: () => Backend; onOpen: () => void }) => (
  <button
    type="button"
    onClick={p.onOpen}
    title="persistence backend (demo swap)"
    class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-card/40 border border-border/60 text-[10px] font-mono text-muted hover:text-fg hover:border-border transition-colors"
  >
    <span class="opacity-60">backend</span>
    <span class="text-accent">{p.current()}</span>
  </button>
))

const Expanded = component(
  (p: { current: () => Backend; close: () => void }): View => (
    <div class="absolute bottom-full mb-2 right-0 rounded-lg bg-card border border-border shadow-2xl overflow-hidden w-72 z-50">
      <div class="px-3 py-2 text-[10px] text-muted font-mono border-b border-border flex items-center justify-between gap-2">
        <span class="uppercase tracking-wider">persistence backend</span>
        <button
          type="button"
          onClick={p.close}
          class="text-muted hover:text-fg w-5 h-5 inline-flex items-center justify-center rounded"
        >
          ×
        </button>
      </div>
      <ul class="list-none p-0 m-0">
        {BACKENDS.map((b) => (
          <li>
            <button
              type="button"
              onClick={() => switchTo(b.value)}
              title={b.hint}
              class={() =>
                cls(
                  'w-full text-left px-3 py-2 text-xs font-mono transition-colors block',
                  p.current() === b.value ? 'bg-accent/15 text-accent' : 'text-fg hover:bg-card/60',
                )
              }
            >
              <div class="flex items-baseline justify-between gap-3">
                <span>{b.label}</span>
                {() =>
                  p.current() === b.value ? (
                    <span class="text-[9px] text-accent">● active</span>
                  ) : (
                    ''
                  )
                }
              </div>
              <div class="text-[10px] text-muted mt-0.5">{b.hint}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  ),
)
