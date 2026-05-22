// Preferences island. In-memory reactive state by default; the
// `persistence` feature pack swaps this for a `persistedState` that
// survives page reloads via localStorage.
//
// Demonstrates the `<select>` + reactive value-binding pattern: the
// `value` prop reads from state; `onChange` writes back. Same shape
// works for `<input>`, `<textarea>`, `<input type="checkbox">`.

interface Prefs {
  density: 'compact' | 'comfortable' | 'cozy'
  notifyOn: 'all' | 'mentions' | 'none'
}

const defaults: Prefs = { density: 'comfortable', notifyOn: 'mentions' }

export default island(() => {
  const prefs = state<Prefs>(defaults)

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]): void => {
    prefs.set({ ...prefs(), [k]: v })
  }

  return (
    <div class="space-y-4 rounded-lg border border-border bg-card p-4 max-w-md">
      <label class="grid grid-cols-[120px_1fr] items-center gap-3">
        <span class="text-sm text-muted">Density</span>
        <select
          value={() => prefs().density}
          onChange={(e) =>
            set('density', (e.currentTarget as HTMLSelectElement).value as Prefs['density'])
          }
          class="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg"
        >
          <option value="compact">compact</option>
          <option value="comfortable">comfortable</option>
          <option value="cozy">cozy</option>
        </select>
      </label>
      <label class="grid grid-cols-[120px_1fr] items-center gap-3">
        <span class="text-sm text-muted">Notify on</span>
        <select
          value={() => prefs().notifyOn}
          onChange={(e) =>
            set('notifyOn', (e.currentTarget as HTMLSelectElement).value as Prefs['notifyOn'])
          }
          class="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg"
        >
          <option value="all">all activity</option>
          <option value="mentions">mentions only</option>
          <option value="none">none</option>
        </select>
      </label>
      <p class="text-xs text-muted font-mono pt-2 border-t border-border">
        current: {() => JSON.stringify(prefs())}
      </p>
    </div>
  )
})
