import { cls, component, onKey, type View, wire } from '@place/component'
import { resource, state } from '@place/reactivity'
import { Button } from '../components/Button.tsx'
import { ExampleCard } from '../components/ExampleCard.tsx'

// A fake remote — resolves after a configurable delay so the loading
// state is actually visible. Throws when `failNext` is true to drive
// the error branch.
function fakeFetch(
  id: string,
  opts: { delayMs: number; failNext: boolean },
): Promise<{ id: string; body: string; at: number }> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (opts.failNext) reject(new Error(`fetch failed for ${id}`))
      else
        resolve({ id, body: `# ${id.toUpperCase()}\n\nPayload at ${Date.now()}`, at: Date.now() })
    }, opts.delayMs)
  })
}

const StatusPill = component((p: { kind: 'loading' | 'error' | 'ready'; label: string }) => {
  const palette = {
    loading: 'bg-accent/15 text-accent border-accent/40',
    error: 'bg-destructive/15 text-destructive border-destructive/40',
    ready: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  }[p.kind]
  return (
    <span
      class={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-mono ${palette}`}
    >
      <span class="w-1.5 h-1.5 rounded-full bg-current" />
      {p.label}
    </span>
  )
})

export function ResourceExample(): View {
  const id = state('a')
  const delayMs = state(700)
  const failNext = state(false)

  // The synchronous reads inside this loader (id.read, delayMs.read,
  // failNext.read) become tracked deps. Whenever any of them changes,
  // the resource re-fetches automatically. In-flight stale fetches are
  // dropped via an internal token, so the UI never flickers backwards.
  const data = resource(() =>
    fakeFetch(id(), {
      delayMs: delayMs(),
      failNext: failNext(),
    }),
  )

  return (
    <ExampleCard
      id="resource"
      phase={5}
      number="09"
      title="resource — async-as-pending"
      description="Wraps a () => Promise<T> as reactive state with three statuses: loading | error | ready. The loader's synchronous reads become tracked deps — change any of them, the fetch re-runs. Stale resolutions are dropped."
      note="No Suspense, no compiler. Async lives inside the same two-color graph as everything else, exposed as a discriminated union your component switches on. The same primitive will back the IndexedDB persistence adapter and any future remote-sync layer."
    >
      <div class="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
        <span class="text-muted font-mono text-xs">user id</span>
        <div class="flex gap-1.5">
          {(['a', 'b', 'c'] as const).map((opt) => (
            <button
              type="button"
              onClick={() => id.set(opt)}
              class={() =>
                cls(
                  'px-3 py-1.5 rounded-md border text-sm font-medium transition-colors',
                  id() === opt
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border bg-card hover:bg-card',
                )
              }
            >
              {opt}
            </button>
          ))}
        </div>

        <span class="text-muted font-mono text-xs">delay (ms)</span>
        <input
          type="number"
          min="0"
          step="100"
          {...wire(delayMs)}
          onKeyDown={onKey('Enter', () => data.refresh())}
          class="w-24 px-2 py-1 rounded-md bg-bg border border-border text-sm font-mono focus:border-accent/60 focus:outline-none"
        />

        <span class="text-muted font-mono text-xs">fail next</span>
        <label class="inline-flex items-center gap-2 text-sm text-fg/90">
          <input type="checkbox" {...wire(failNext)} class="accent-accent" />
          force the loader to reject
        </label>
      </div>

      <div class="flex items-center gap-3 pt-2">
        <Button onClick={() => void data.refresh()}>refresh</Button>
        {() => {
          const s = data.status()
          if (s.state === 'loading') return <StatusPill kind="loading" label="loading…" />
          if (s.state === 'error') return <StatusPill kind="error" label="error" />
          return <StatusPill kind="ready" label="ready" />
        }}
      </div>

      <pre class="text-xs font-mono bg-bg/70 border border-border rounded-md p-3 text-fg/90 whitespace-pre-wrap min-h-24">
        {() => {
          const s = data.status()
          if (s.state === 'loading') return '…'
          if (s.state === 'error') return `× ${String(s.error)}`
          return `${s.value.body}\n\n— fetched ${new Date(s.value.at).toISOString().slice(11, 19)}`
        }}
      </pre>
    </ExampleCard>
  )
}
