import { cls, type View } from '@place/component'

type Phase = 1 | 2 | 3 | 4 | 5 | 6

const STYLES: Record<Phase, string> = {
  1: 'bg-emerald-950/60 text-emerald-400 border-emerald-900/80',
  2: 'bg-sky-950/60 text-sky-400 border-sky-900/80',
  3: 'bg-violet-950/60 text-violet-400 border-violet-900/80',
  4: 'bg-destructive/20 text-destructive border-destructive/60',
  5: 'bg-accent/20 text-accent border-accent/60',
  6: 'bg-card/60 text-muted border-border',
}

const LABELS: Record<Phase, string> = {
  1: 'Sync core',
  2: 'Derivable',
  3: 'Scheduler',
  4: 'Effects',
  5: 'Time',
  6: 'Graph',
}

export function PhaseTag(props: { phase: Phase }): View {
  return (
    <span
      class={cls(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase tracking-wider',
        STYLES[props.phase],
      )}
    >
      <span class="opacity-60">Phase {props.phase}</span>
      <span>·</span>
      <span>{LABELS[props.phase]}</span>
    </span>
  )
}
