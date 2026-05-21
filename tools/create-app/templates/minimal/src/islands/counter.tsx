// Counter island. Default-exporting `island(view)` (or just `view(fn)`)
// marks this file as a client island — the framework auto-discovers it
// because `app({ islandsDir: './src/islands' })` is set in `app.ts`.
//
// Auto-imported via the @place-ts/component preload plugin (bunfig.toml):
//   `island`, `view`, `state` — no manual imports needed.
//
// `island(...)` wraps the component so the framework can:
//   1. emit a marker in SSR HTML
//   2. ship the component as its own client bundle
//   3. hydrate it after first paint with the props that were SSR'd
//
// `state(0)` is the framework's reactive primitive: `count()` reads,
// `count.set(n)` writes, and any JSX expression that calls `count()`
// re-renders automatically when the state changes.

export default island(() => {
  const count = state(0)

  return (
    <div class="inline-flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2">
      <span class="text-sm text-muted">count</span>
      <span class="font-mono text-lg tabular-nums">{() => count()}</span>
      <button
        type="button"
        class="ml-1 rounded-md bg-accent text-accent-fg px-3 py-1 text-sm font-medium hover:opacity-90 transition-opacity"
        onClick={() => count.set(count() + 1)}
      >
        +1
      </button>
      <button
        type="button"
        class="rounded-md border border-border bg-bg text-fg px-3 py-1 text-sm hover:bg-card transition-colors"
        onClick={() => count.set(0)}
      >
        reset
      </button>
    </div>
  )
})
