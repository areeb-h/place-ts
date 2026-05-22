// Counter island. `island(view)` marks the file as a client island —
// the framework auto-discovers it because `app({ islandsDir })` is
// set in `app.ts`.
//
// Auto-imported (no manual imports needed): `island`, `state`.
//
// `state(0)` is the framework's reactive primitive: `count()` reads,
// `count.set(n)` writes, and any JSX expression that calls `count()`
// re-renders automatically.

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
