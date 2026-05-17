import { cls, Fragment, type View } from '@place/component'
import { batch, flush, state, watch } from '@place/reactivity'
import { Button } from '../components/Button.tsx'
import { ExampleCard } from '../components/ExampleCard.tsx'

export function BatchingExample(): View {
  const a = state(0)
  const b = state(0)
  const c = state(0)
  const sum = state(() => a() + b() + c())

  const syncRuns = state(0)
  const deferredRuns = state(0)
  const log = state<string[]>([])

  watch(() => {
    sum()
    syncRuns.update((v) => v + 1)
  })
  watch(
    () => {
      sum()
      deferredRuns.update((v) => v + 1)
    },
    { defer: true },
  )

  // Reset run counters after the initial mount so the demo is clean.
  syncRuns.set(0)
  deferredRuns.set(0)

  const append = (line: string) => {
    log.update((prev) => [...prev, line].slice(-6))
  }
  const reset = () => {
    a.set(0)
    b.set(0)
    c.set(0)
    syncRuns.set(0)
    deferredRuns.set(0)
    log.set([])
  }

  // Three writes outside a batch — sync watch fires 3x, deferred coalesces.
  const writeNoBatch = () => {
    log.set([])
    const beforeSync = syncRuns()
    const beforeDeferred = deferredRuns()
    append(`before: sync=${beforeSync}  deferred=${beforeDeferred}`)
    a.update((v) => v + 1)
    b.update((v) => v + 1)
    c.update((v) => v + 1)
    append(
      `after 3 writes: sync=${syncRuns()} (+${syncRuns() - beforeSync})  deferred=${deferredRuns()} (still pending — microtask hasn't fired)`,
    )
  }

  // Same writes inside a batch — sync watch fires once.
  const writeBatched = () => {
    log.set([])
    const beforeSync = syncRuns()
    const beforeDeferred = deferredRuns()
    append(`before: sync=${beforeSync}  deferred=${beforeDeferred}`)
    batch(() => {
      a.update((v) => v + 1)
      b.update((v) => v + 1)
      c.update((v) => v + 1)
      append('inside batch: writes pending; no watches fired yet')
    })
    append(
      `after batch: sync=${syncRuns()} (+${syncRuns() - beforeSync})  deferred=${deferredRuns()} (deferred drained at batch end)`,
    )
  }

  // Three writes followed by an immediate flush() — deferred drains synchronously.
  const writeThenFlush = () => {
    log.set([])
    const beforeDeferred = deferredRuns()
    a.update((v) => v + 1)
    b.update((v) => v + 1)
    c.update((v) => v + 1)
    append(
      `after writes: deferred=${deferredRuns()} (= ${beforeDeferred} — pending, microtask not yet fired)`,
    )
    flush()
    append(`after flush(): deferred=${deferredRuns()} (drained synchronously, no waiting)`)
  }

  return (
    <ExampleCard
      id="batching"
      phase={3}
      number="06"
      title="Batch · flush · defer"
      description="batch() groups writes so the sync watch sees the final state. defer: true coalesces re-runs into a microtask. flush() forces the deferred queue to drain synchronously, before the microtask fires."
      note="Each button writes a, b, c by 1 and logs what the watches saw. flush() is most useful in test code — between user interactions, microtasks have already drained, so a free-standing flush button is a no-op. Inside a single click handler it forces an immediate, observable drain."
    >
      <div class="flex flex-wrap gap-2">
        <Button onClick={writeNoBatch}>3 writes (no batch)</Button>
        <Button variant="accent" onClick={writeBatched}>
          batch(3 writes)
        </Button>
        <Button onClick={writeThenFlush}>3 writes + flush()</Button>
        <Button variant="subtle" onClick={reset}>
          reset
        </Button>
      </div>

      <output class="block px-4 py-3 rounded-md bg-bg/80 border border-border/80 text-sm font-mono space-y-1">
        <div class="flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <span class="text-muted">a </span>=<span class="text-accent ml-1">{() => a()}</span>
          </span>
          <span>
            <span class="text-muted">b </span>=<span class="text-accent ml-1">{() => b()}</span>
          </span>
          <span>
            <span class="text-muted">c </span>=<span class="text-accent ml-1">{() => c()}</span>
          </span>
          <span>
            <span class="text-muted">sum </span>=<span class="text-accent ml-1">{() => sum()}</span>
          </span>
        </div>
        <div class="text-muted/60 text-xs pt-1 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            sync watch ran <span class="text-emerald-400 font-semibold">{() => syncRuns()}</span>{' '}
            times
          </span>
          <span class="text-muted/40">·</span>
          <span>
            deferred watch ran{' '}
            <span class="text-violet-400 font-semibold">{() => deferredRuns()}</span> times
          </span>
        </div>
      </output>

      <div
        class={() =>
          cls(
            'block px-4 py-3 rounded-md bg-card/40 border border-border/40 text-xs font-mono space-y-1 transition-opacity',
            log().length === 0 && 'opacity-40',
          )
        }
      >
        {() => {
          const lines = log()
          if (lines.length === 0) {
            return <span class="text-muted/60 italic">click a button to see what watches saw</span>
          }
          return (
            <Fragment>
              {lines.map((line, i) => (
                <div class={cls(i === lines.length - 1 ? 'text-fg/90' : 'text-muted')}>
                  <span class="text-muted/40">{i + 1}.</span> {line}
                </div>
              ))}
            </Fragment>
          )
        }}
      </div>
    </ExampleCard>
  )
}
