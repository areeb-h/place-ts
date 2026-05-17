import { cls, type View } from '@place/component'
import { state } from '@place/reactivity'
import { Button } from '../components/Button.tsx'
import { ExampleCard } from '../components/ExampleCard.tsx'

export function DynamicDepsExample(): View {
  const flag = state(true)
  const a = state(1)
  const b = state(100)

  return (
    <ExampleCard
      id="dynamic"
      phase={1}
      number="04"
      title="Dynamic dependencies"
      description="A watch that reads a or b depending on the flag. The un-tracked cell can change freely without firing the watch."
      note="Toggle the flag, then increment whichever cell is *not* currently being read. The display does not update — that path was untracked when the watch last ran. Invariant 1.8."
    >
      <div class="flex flex-wrap gap-2">
        <Button variant="accent" onClick={() => flag.update((f) => !f)}>
          toggle flag
        </Button>
        <Button onClick={() => a.update((v) => v + 1)}>a++</Button>
        <Button onClick={() => b.update((v) => v + 1)}>b++</Button>
      </div>

      <output class="block px-4 py-3 rounded-md bg-bg/80 border border-border/80 text-sm font-mono space-y-1">
        <div class="flex flex-wrap gap-x-6 gap-y-1">
          <span>
            <span class="text-muted">flag </span>={' '}
            <span
              class={() => cls('font-semibold', flag() ? 'text-emerald-400' : 'text-destructive')}
            >
              {() => String(flag())}
            </span>
          </span>
          <span>
            <span class="text-muted">reading </span>
            <span class="text-fg/90">{() => (flag() ? 'a' : 'b')}</span>
          </span>
          <span>
            <span class="text-muted">value </span>={' '}
            <span class="text-accent">{() => (flag() ? a() : b())}</span>
          </span>
        </div>
        <div class="text-muted/60 text-xs pt-1">
          a = <span class="text-muted">{() => a()}</span>
          <span class="mx-3 text-muted/40">·</span>b = <span class="text-muted">{() => b()}</span>
        </div>
      </output>
    </ExampleCard>
  )
}
