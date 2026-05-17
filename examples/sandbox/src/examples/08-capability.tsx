import { defineCapability } from '@place/capability'
import { component, keyed, type View, wire, withCapability } from '@place/component'
import { state } from '@place/reactivity'
import { Button } from '../components/Button.tsx'
import { ExampleCard } from '../components/ExampleCard.tsx'

// A capability is a typed slot. Define once at the module level; provide
// implementations at boundaries; consume via .use() inside components.
//
// This is the runtime foundation for Phase 4 typed effects — the same
// shape that capability-tracked function types will eventually verify at
// the type level. For now, the runtime enforcement is "throw if not
// provided"; the type level remains opt-in via explicit declarations.

interface Logger {
  log(level: 'info' | 'warn' | 'error', message: string): void
}

const Log = defineCapability<Logger>('Log')

// A child component that USES the Log capability without knowing where
// it came from. Test substitution: swap the impl, this code keeps working.
const Actions = component(() => {
  const log = Log.use()
  return (
    <div class="flex flex-wrap gap-2">
      <Button onClick={() => log.log('info', 'user pinged')}>info</Button>
      <Button onClick={() => log.log('warn', 'something looks off')}>warn</Button>
      <Button onClick={() => log.log('error', 'something exploded')}>error</Button>
    </div>
  )
})

interface LogEntry {
  id: number
  level: 'info' | 'warn' | 'error'
  message: string
  ts: number
}

let nextId = 1

const LEVEL_STYLES: Record<LogEntry['level'], string> = {
  info: 'text-emerald-400',
  warn: 'text-accent',
  error: 'text-destructive',
}

const LogList = component((props: { entries: () => LogEntry[] }) => {
  return (
    <ul class="list-none p-0 m-0 space-y-1 max-h-48 overflow-y-auto">
      {keyed(
        props.entries,
        (e) => e.id,
        (entry) => (
          <li class="flex items-baseline gap-3 px-3 py-1.5 rounded-md bg-bg/60 border border-border/40 text-xs">
            <span class={`font-mono uppercase tracking-wider ${LEVEL_STYLES[entry.level]}`}>
              {entry.level}
            </span>
            <span class="text-fg/90 flex-1">{entry.message}</span>
            <span class="text-muted/60 font-mono">
              {new Date(entry.ts).toISOString().slice(11, 19)}
            </span>
          </li>
        ),
      )}
    </ul>
  )
})

export function CapabilityExample(): View {
  const entries = state<LogEntry[]>([])
  const verbose = state(true)

  // The impl object can read and write reactive state. Consumers (Actions)
  // see the effect through the capability without knowing about the state.
  const impl: Logger = {
    log(level, message) {
      if (!verbose() && level === 'info') return
      entries.update((prev) =>
        [...prev, { id: nextId++, level, message, ts: Date.now() }].slice(-12),
      )
    },
  }

  return (
    <ExampleCard
      id="capability"
      phase={3}
      number="08"
      title="Capability handlers"
      description="defineCapability creates a typed slot. Children use Log.use() inside their bodies; the parent installs the impl via withCapability(...). Replace React-style implicit context globals with explicit, lexically-scoped providers."
      note="The Actions component has no idea where the Logger comes from — swap the impl, point it at the console, point it at a remote server, replace it with a no-op for tests. The consumer doesn't change."
    >
      <label class="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" {...wire(verbose)} class="accent-accent" />
        verbose mode (suppress info when off)
      </label>

      {withCapability(Log, impl, <Actions />)}

      <div class="text-xs text-muted flex items-center gap-3">
        <span>{() => `${entries().length} log entries`}</span>
        <button
          type="button"
          onClick={() => entries.set([])}
          class="text-muted hover:text-fg/90 underline underline-offset-2 decoration-dotted"
        >
          clear
        </button>
      </div>

      <LogList entries={() => entries()} />
    </ExampleCard>
  )
}
