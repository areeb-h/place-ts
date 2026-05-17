import type { View } from '@place/component'
import { state } from '@place/reactivity'
import { Button } from '../components/Button.tsx'
import { ExampleCard } from '../components/ExampleCard.tsx'

export function CounterExample(): View {
  const count = state(0)
  const doubled = state(() => count() * 2)
  const sign = state(() => {
    const v = count()
    return v > 0 ? 'positive' : v < 0 ? 'negative' : 'zero'
  })

  return (
    <ExampleCard
      id="counter"
      phase={1}
      number="01"
      title="Counter"
      description="A single state plus two derived values. The simplest possible reactive flow."
    >
      <div class="flex flex-wrap gap-2">
        <Button onClick={() => count.update((c) => c + 1)}>+1</Button>
        <Button onClick={() => count.update((c) => c - 1)}>−1</Button>
        <Button variant="subtle" onClick={() => count.set(0)}>
          reset
        </Button>
      </div>

      <output class="block px-4 py-3 rounded-md bg-bg/80 border border-border/80 text-sm font-mono">
        <div class="flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <span class="text-muted">count</span> = <span class="text-accent">{() => count()}</span>
          </span>
          <span>
            <span class="text-muted">doubled</span> ={' '}
            <span class="text-accent">{() => doubled()}</span>
          </span>
          <span>
            <span class="text-muted">sign</span>: <span class="text-fg/90">{() => sign()}</span>
          </span>
        </div>
      </output>
    </ExampleCard>
  )
}
