import { component, keyed, type View } from '@place/component'
import { state } from '@place/reactivity'
import { Button } from '../components/Button.tsx'
import { ExampleCard } from '../components/ExampleCard.tsx'

interface Item {
  id: number
  label: string
}

let nextId = 1

const Row = component(
  (props: { item: Item; remove: () => void; moveUp: () => void; moveDown: () => void }) => {
    // Per-row state: a click counter. If keyed reconciliation is correct,
    // this counter STAYS WITH THE ITEM across reorderings.
    const clicks = state(0)

    return (
      <li class="flex items-center gap-2 px-3 py-2 rounded-md bg-bg/60 border border-border/60 hover:border-border/80 transition-colors">
        <span class="text-muted text-xs font-mono w-6">#{props.item.id}</span>
        <span class="text-fg flex-1">{props.item.label}</span>
        <button
          type="button"
          onClick={() => clicks.update((c) => c + 1)}
          class="px-2 py-0.5 rounded text-xs border border-border bg-card hover:border-accent/60 text-muted hover:text-accent transition-colors"
        >
          clicks: <span class="text-accent">{() => clicks()}</span>
        </button>
        <button
          type="button"
          onClick={props.moveUp}
          class="px-1.5 text-muted hover:text-fg"
          title="move up"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={props.moveDown}
          class="px-1.5 text-muted hover:text-fg"
          title="move down"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={props.remove}
          class="px-1.5 text-muted hover:text-destructive"
          title="remove"
        >
          ×
        </button>
      </li>
    )
  },
)

const SAMPLE_LABELS = [
  'note about graph coloring',
  'why useEffect is wrong',
  'commonplace book idea',
  'temporal tuple sketch',
  'algebraic effects deep dive',
  'Solid 2.0 transitions',
]

export function KeyedListExample(): View {
  const items = state<Item[]>([
    { id: nextId++, label: 'first item' },
    { id: nextId++, label: 'second item' },
    { id: nextId++, label: 'third item' },
  ])

  const addItem = () => {
    const labels = SAMPLE_LABELS
    const label = labels[Math.floor(Math.random() * labels.length)] ?? 'new item'
    items.set([...items(), { id: nextId++, label }])
  }

  const removeById = (id: number) => {
    items.set(items().filter((it) => it.id !== id))
  }

  // We look up the current index by id at click time, so handlers stay
  // correct after reorderings. Otherwise a captured `index` at first-render
  // time would be stale after the row moves.
  const moveById = (id: number, delta: number) => {
    const arr = [...items()]
    const i = arr.findIndex((it) => it.id === id)
    if (i === -1) return
    const target = i + delta
    if (target < 0 || target >= arr.length) return
    const [removed] = arr.splice(i, 1)
    if (removed) arr.splice(target, 0, removed)
    items.set(arr)
  }

  const reverse = () => {
    items.set([...items()].reverse())
  }

  const shuffle = () => {
    const arr = [...items()]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const ai = arr[i]
      const aj = arr[j]
      if (ai && aj) {
        arr[i] = aj
        arr[j] = ai
      }
    }
    items.set(arr)
  }

  const clear = () => {
    items.set([])
    nextId = 1
  }

  return (
    <ExampleCard
      id="keyed"
      phase={2}
      number="07"
      title="Keyed list reconciliation"
      description="keyed(items, key, render) preserves view state across reorderings. Click an item to increment its counter, then reorder — counters travel with the items, not positions."
      note="This is the strict improvement over Solid's <For> primitive: same keyed reconciliation, but exposed as a plain function returning a View. No special-cased component the compiler treats specially."
    >
      <div class="flex flex-wrap gap-2">
        <Button variant="accent" onClick={addItem}>
          + add
        </Button>
        <Button onClick={reverse}>reverse</Button>
        <Button onClick={shuffle}>shuffle</Button>
        <Button variant="subtle" onClick={clear}>
          clear
        </Button>
        <span class="ml-auto text-xs text-muted self-center">
          {() => `${items().length} item${items().length === 1 ? '' : 's'}`}
        </span>
      </div>

      <ul class="space-y-1.5 list-none p-0 m-0">
        {keyed(
          () => items(),
          (item) => item.id,
          (item) => (
            <Row
              item={item}
              remove={() => removeById(item.id)}
              moveUp={() => moveById(item.id, -1)}
              moveDown={() => moveById(item.id, +1)}
            />
          ),
        )}
      </ul>
    </ExampleCard>
  )
}
