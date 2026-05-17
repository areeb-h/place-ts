import { cls, type View } from '@place/component'

interface ButtonProps {
  onClick?: () => void
  variant?: 'default' | 'accent' | 'subtle'
  children?: View | View[] | string | number | (string | number | View)[]
}

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  default: 'border-border bg-card hover:border-accent/70 hover:bg-card active:bg-card',
  accent: 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent/60',
  subtle: 'border-transparent bg-transparent hover:bg-card text-muted hover:text-fg',
}

export function Button(props: ButtonProps): View {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={cls(
        'px-3 py-1.5 rounded-md border text-sm font-medium transition-colors duration-150 select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
        VARIANTS[props.variant ?? 'default'],
      )}
    >
      {props.children}
    </button>
  )
}
