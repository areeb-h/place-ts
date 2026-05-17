// Pure-SSR horizontal bar chart. SVG only — no JS, no canvas, no
// chart lib. Each bar is positioned by a percentage of the max value;
// the primary bar (index 0) carries the accent color so the framework's
// own row reads first.

interface Bar {
  readonly label: string
  readonly value: number
  /** Optional unit shown after the number; e.g. "req/s", "ms", "KB". */
  readonly unit?: string
}

interface BenchmarkChartProps {
  readonly title?: string
  readonly bars: readonly Bar[]
  /**
   * When 'higher' (default), bigger bars are "better" and color-graded
   * downward as values shrink. When 'lower', the smallest bar is best.
   */
  readonly betterIs?: 'higher' | 'lower'
}

export const BenchmarkChart = ({ title, bars, betterIs = 'higher' }: BenchmarkChartProps) => {
  const max = Math.max(...bars.map((b) => b.value), 1)
  const sorted = bars
    .slice()
    .sort((a, b) => (betterIs === 'higher' ? b.value - a.value : a.value - b.value))
  const best = sorted[0]?.value ?? 1
  return (
    <div class="bench-chart">
      {title ? <div class="bench-title">{title}</div> : null}
      <div class="bench-bars">
        {bars.map((bar) => {
          const pct = (bar.value / max) * 100
          const isBest = bar.value === best
          return (
            <div class={isBest ? 'bench-row best' : 'bench-row'}>
              <div class="bench-label">{bar.label}</div>
              <div class="bench-track">
                <div class="bench-fill" style={`width: ${pct}%`} />
              </div>
              <div class="bench-value">
                {bar.value.toLocaleString()}
                {bar.unit ? <span class="bench-unit"> {bar.unit}</span> : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
