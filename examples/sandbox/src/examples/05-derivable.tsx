import type { View } from '@place/component'
import { state } from '@place/reactivity'
import { Button } from '../components/Button.tsx'
import { ExampleCard } from '../components/ExampleCard.tsx'

export function DerivableExample(): View {
  const upstream = state(10)
  const editable = state(() => upstream() * 2)

  return (
    <ExampleCard
      id="derivable"
      phase={2}
      number="05"
      title="Derivable state — revert policy"
      description="state(() => upstream * 2) is derived AND writable. Local writes win until upstream changes; then the upstream value reverts the override."
      note='Click "write 99" — editable becomes 99 (override wins). Then click "upstream++" — the override is discarded; editable reverts to upstream × 2. This is the pattern that eliminates the universal `useEffect`-to-sync-state antipattern.'
    >
      <div class="flex flex-wrap gap-2">
        <Button variant="accent" onClick={() => upstream.update((v) => v + 1)}>
          upstream++
        </Button>
        <Button onClick={() => editable.set(99)}>editable.set(99)</Button>
        <Button onClick={() => editable.update((prev) => prev + 100)}>
          editable.set(prev =&gt; prev + 100)
        </Button>
      </div>

      <output class="block px-4 py-3 rounded-md bg-bg/80 border border-border/80 text-sm font-mono space-y-1">
        <div>
          <span class="text-muted">upstream </span>={' '}
          <span class="text-accent">{() => upstream()}</span>
        </div>
        <div>
          <span class="text-muted">editable </span>={' '}
          <span class="text-accent">{() => editable()}</span>
          <span class="text-muted/60 text-xs ml-3">
            (derivation: upstream × 2 = {() => upstream() * 2})
          </span>
        </div>
      </output>
    </ExampleCard>
  )
}
