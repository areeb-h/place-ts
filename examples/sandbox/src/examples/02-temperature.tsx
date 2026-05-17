import { type View, wire } from '@place/component'
import { state } from '@place/reactivity'
import { ExampleCard } from '../components/ExampleCard.tsx'

export function TemperatureExample(): View {
  const celsius = state(20)
  const fahrenheit = state(() => (celsius() * 9) / 5 + 32)
  const kelvin = state(() => celsius() + 273.15)
  const description = state(() => {
    const c = celsius()
    if (c < 0) return 'freezing'
    if (c < 15) return 'cold'
    if (c < 25) return 'comfortable'
    if (c < 35) return 'warm'
    return 'hot'
  })

  return (
    <ExampleCard
      id="temperature"
      phase={1}
      number="02"
      title="Derived chain"
      description="One source feeds three derived values plus a categorical description. Drag the slider."
    >
      <div class="flex items-center gap-4">
        <input
          type="range"
          min="-40"
          max="50"
          step="1"
          class="flex-1 accent-accent min-w-0"
          {...wire(celsius)}
        />
        <span class="text-accent font-mono text-sm w-12 text-right">{() => `${celsius()}°C`}</span>
      </div>

      <output class="block px-4 py-3 rounded-md bg-bg/80 border border-border/80 text-sm font-mono">
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1">
          <div>
            <span class="text-muted">°C </span>
            <span class="text-accent">{() => celsius()}</span>
          </div>
          <div>
            <span class="text-muted">°F </span>
            <span class="text-accent">{() => fahrenheit().toFixed(1)}</span>
          </div>
          <div>
            <span class="text-muted">K </span>
            <span class="text-accent">{() => kelvin().toFixed(2)}</span>
          </div>
          <div>
            <span class="text-muted">vibe </span>
            <span class="text-fg/90">{() => description()}</span>
          </div>
        </div>
      </output>
    </ExampleCard>
  )
}
