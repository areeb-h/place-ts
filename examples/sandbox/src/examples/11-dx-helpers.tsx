import { cls, globalKey, onKey, type View, wire } from '@place/component'
import { state } from '@place/reactivity'
import { Button } from '../components/Button.tsx'
import { ExampleCard } from '../components/ExampleCard.tsx'

// Three helpers, three real before/after pairs. Each "before" is the
// raw form the helper collapsed; each "after" is what user code looks
// like in the commonplace book today.

export function DxHelpersExample(): View {
  // ----- wire ----- two-way string binding
  const search = state('')
  const title = state('first draft')

  // ----- onKey ----- single-key handler factory
  const submitted = state<string[]>([])
  const draft = state('')
  const submit = () => {
    const v = draft().trim()
    if (!v) return
    submitted.set([...submitted(), v])
    draft.set('')
  }

  // ----- globalKey ----- document-level shortcuts
  const flashes = state<string[]>([])
  const flash = (msg: string) => {
    submitted // touch closure — keeps tsc quiet on unused above when narrowed
    flashes.set([msg, ...flashes()].slice(0, 4))
  }
  globalKey('mod+/', () => flash('⌘/ — focus this card'), { preventDefault: true })
  globalKey('mod+e', () => flash("⌘E — invented action: you'd wire your own"), {
    preventDefault: true,
  })
  globalKey('Escape', () => flash('Esc — fired (skipInInput is on)'), { skipInInput: true })

  return (
    <ExampleCard
      id="dx-helpers"
      phase={2}
      number="11"
      title="DX helpers — wire, onKey, globalKey"
      description="Three small primitives in @place/component that collapsed repeated boilerplate in real user code. Each appears 2+ times in the commonplace book; each saves ~3-8 lines per call site without runtime cost."
      note="Helpers ship when there's a concrete trigger — not preemptively. Each was added only after the same shape kept reappearing in user code. wire and onKey both have overloads / options that map to actual app patterns; globalKey carries auto-cleanup via onCleanup so it ties to component lifetime."
    >
      {/* ---------- wire ---------- */}
      <Section
        title="wire(state) — two-way binding for text inputs"
        codeBefore={`<input
  value={() => query()}
  onInput={(e) => query.set((e.target as HTMLInputElement).value)}
/>`}
        codeAfter={`<input {...wire(query)} />`}
      >
        <input
          type="search"
          placeholder="search…"
          {...wire(search)}
          class="w-full px-3 py-1.5 rounded-md bg-bg border border-border text-sm focus:border-accent/60 focus:outline-none"
        />
        <p class="text-xs text-muted font-mono">
          read: <span class="text-accent">{() => JSON.stringify(search())}</span>
        </p>
      </Section>

      <Section
        title="wire(get, set) — bind to a derived field with a custom mutator"
        codeBefore={`<input
  value={() => live().title}
  onInput={(e) => store.update(id, { title: (e.target as HTMLInputElement).value })}
/>`}
        codeAfter={`<input {...wire(() => live().title, setTitle)} />`}
      >
        <input
          type="text"
          {...wire(
            () => title().toUpperCase(),
            (v) => title.set(v.toLowerCase()),
          )}
          class="w-full px-3 py-1.5 rounded-md bg-bg border border-border text-sm focus:border-accent/60 focus:outline-none"
        />
        <p class="text-xs text-muted font-mono">
          inner state (lowercase): <span class="text-accent">{() => JSON.stringify(title())}</span>
        </p>
      </Section>

      {/* ---------- onKey ---------- */}
      <Section
        title="onKey(key, fn, opts?) — one-key event-handler factory"
        codeBefore={`onKeyDown={(e) => {
  if ((e as KeyboardEvent).key === 'Enter') {
    e.preventDefault()
    submit()
  }
}}`}
        codeAfter={`onKeyDown={onKey('Enter', submit, { preventDefault: true })}`}
      >
        <div class="flex gap-2">
          <input
            type="text"
            placeholder="type then press Enter…"
            {...wire(draft)}
            onKeyDown={onKey('Enter', submit, { preventDefault: true })}
            class="flex-1 px-3 py-1.5 rounded-md bg-bg border border-border text-sm focus:border-accent/60 focus:outline-none"
          />
          <Button onClick={submit}>add</Button>
        </div>
        <ul class="list-none p-0 m-0 space-y-1 max-h-32 overflow-y-auto">
          {() => {
            const items = submitted()
            if (items.length === 0) {
              return <li class="text-xs text-muted/60 font-mono">— nothing yet — </li>
            }
            return (
              <span class="contents">
                {items.map((line, i) => (
                  <li class="px-3 py-1 text-sm rounded-md bg-bg/60 border border-border/40 font-mono text-fg/90 flex items-baseline gap-3">
                    <span class="text-xs text-muted/60">{String(i + 1).padStart(2, '0')}</span>
                    <span class="flex-1">{line}</span>
                  </li>
                ))}
              </span>
            )
          }}
        </ul>
      </Section>

      {/* ---------- globalKey ---------- */}
      <Section
        title="globalKey(chord, fn, opts?) — document-level shortcut, auto-disposed"
        codeBefore={`useEffect(() => {
  const h = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === '/') { e.preventDefault(); doThing() }
  }
  document.addEventListener('keydown', h)
  return () => document.removeEventListener('keydown', h)
}, [])`}
        codeAfter={`globalKey('mod+/', doThing, { preventDefault: true })`}
      >
        <div class="text-xs text-muted leading-relaxed font-mono">
          Try in this tab: <span class="text-accent">⌘/</span>, <span class="text-accent">⌘E</span>,
          or <span class="text-accent">Esc</span> (when no input is focused — skipInInput is on).
        </div>
        <ul class="list-none p-0 m-0 space-y-1">
          {() => {
            const items = flashes()
            if (items.length === 0) {
              return <li class="text-xs text-muted/60 font-mono">— press a shortcut above — </li>
            }
            return (
              <span class="contents">
                {items.map((msg) => (
                  <li class="px-3 py-1 text-xs rounded-md bg-accent/10 border border-accent/30 text-accent font-mono">
                    {msg}
                  </li>
                ))}
              </span>
            )
          }}
        </ul>
      </Section>
    </ExampleCard>
  )
}

// Small section component — title + before/after diff + live demo body.
function Section(props: {
  title: string
  codeBefore: string
  codeAfter: string
  children?: View | View[]
}): View {
  const open = state(false)
  return (
    <div class="rounded-lg border border-border/60 bg-bg/30 p-4 space-y-3">
      <div class="flex items-baseline justify-between gap-3">
        <h3 class="text-sm font-medium text-fg">{props.title}</h3>
        <button
          type="button"
          onClick={() => open.set(!open())}
          class={() =>
            cls(
              'text-[10px] px-2 py-0.5 rounded font-mono transition-colors',
              open() ? 'bg-accent/15 text-accent' : 'bg-card text-muted hover:text-fg/90',
            )
          }
        >
          {() => (open() ? 'hide diff' : 'show diff')}
        </button>
      </div>
      <div class={() => cls('space-y-2', !open() && 'hidden')}>
        <pre class="text-[11px] font-mono p-2 rounded bg-destructive/5 border border-destructive/20 text-destructive/90 whitespace-pre-wrap">
          {props.codeBefore}
        </pre>
        <pre class="text-[11px] font-mono p-2 rounded bg-emerald-500/5 border border-emerald-500/20 text-emerald-300/90 whitespace-pre-wrap">
          {props.codeAfter}
        </pre>
      </div>
      <div class="space-y-2">{props.children}</div>
    </div>
  )
}
