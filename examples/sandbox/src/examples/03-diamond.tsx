import type { View } from '@place/component'
import { state } from '@place/reactivity'
import { Button } from '../components/Button.tsx'
import { ExampleCard } from '../components/ExampleCard.tsx'

export function DiamondExample(): View {
  const x = state(0)
  const a = state(() => x() + 1)
  const b = state(() => x() * 2)
  const c = state(() => a() + b())

  return (
    <ExampleCard
      id="diamond"
      phase={1}
      number="03"
      title="Diamond convergence"
      description="a → x, b → x, c → {a, b}. All three derived values update in one consistent step. The 'c re-evaluates exactly once per x change' claim lives in the property tests."
      note="Glitch-freedom (invariant 1.1) means there's no intermediate frame where c is consistent with the old x. Click rapidly — values stay coherent."
    >
      <div class="flex flex-wrap gap-2">
        <Button onClick={() => x.update((v) => v + 1)}>x++</Button>
        <Button onClick={() => x.update((v) => v - 1)}>x−−</Button>
        <Button variant="subtle" onClick={() => x.set(0)}>
          reset
        </Button>
      </div>

      <output class="block px-4 py-3 rounded-md bg-bg/80 border border-border/80 text-sm font-mono space-y-1">
        <div>
          <span class="text-muted">x </span>= <span class="text-accent">{() => x()}</span>
        </div>
        <div>
          <span class="text-muted">a = x + 1 </span>= <span class="text-accent">{() => a()}</span>
        </div>
        <div>
          <span class="text-muted">b = x × 2 </span>= <span class="text-accent">{() => b()}</span>
        </div>
        <div>
          <span class="text-muted">c = a + b </span>= <span class="text-accent">{() => c()}</span>
        </div>
      </output>
    </ExampleCard>
  )
}
