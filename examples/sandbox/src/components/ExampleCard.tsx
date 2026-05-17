import type { View } from '@place/component'
import { PhaseTag } from './PhaseTag.tsx'

interface ExampleCardProps {
  id: string
  phase: 1 | 2 | 3 | 4 | 5 | 6
  number: string
  title: string
  description: string
  note?: string
  children?: View | View[]
}

export function ExampleCard(props: ExampleCardProps): View {
  return (
    <section
      id={props.id}
      class="group relative rounded-xl border border-border/80 bg-card/40 p-6 transition-colors hover:border-border"
    >
      <header class="mb-5 space-y-2">
        <div class="flex items-center justify-between gap-3">
          <PhaseTag phase={props.phase} />
          <span class="text-xs text-muted/60 font-mono">{props.number}</span>
        </div>
        <h2 class="text-lg font-semibold text-fg">{props.title}</h2>
        <p class="text-sm text-muted leading-relaxed">{props.description}</p>
      </header>

      <div class="space-y-3">{props.children}</div>

      {props.note && (
        <p class="mt-5 pt-4 border-t border-dashed border-border text-xs text-muted leading-relaxed">
          {props.note}
        </p>
      )}
    </section>
  )
}
