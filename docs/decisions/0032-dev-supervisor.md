# ADR 0032: Dev-mode self-supervisor — instant auto-reload from `bun src/app.ts`

**Status:** accepted (2026-05-16)
**Date:** 2026-05-16
**Affects:** `systems/component/src/index.ts` (`runDevSupervisor`,
`_serveImpl` early-return gate, `startSrcWatcher` debounce);
`systems/component/src/__hmr.ts` (exponential-backoff reconnect);
`examples/docs/package.json` (drops the `while` respawn wrapper).

## Context

Dev mode in place-ts depends on a live-reload chain:

1. The framework's file watcher detects a source change.
2. The server process exits.
3. A respawn mechanism restarts the server.
4. The browser's HMR client (WS at `/__place_hmr`) detects the
   restart via a reconnect event and calls `location.reload()`.

Steps 1, 2, 4 lived in the framework. **Step 3 lived in a shell
wrapper:** `package.json`'s `dev` script was

```
while bun src/app.ts; do echo '[dev] respawning...'; done
```

Users who skipped `bun run dev` and started with `bun src/app.ts`
directly got step 1+2 but **no step 3** — the server died on first
edit and stayed dead. The browser kept retrying the WS and saw
nothing. The user manually refreshed and got "this site can't be
reached." Verdict from the user: "HMR doesn't work either... I have
to refresh manually."

Additional defects piling up:

- The slow-path exit waited 100 ms for a `touch()` of the entry file
  — leftover from the `bun --watch` era. `bun --watch` deadlocks
  `Bun.build`, so we no longer use it, and the touch+wait is dead
  weight that adds latency on every edit.
- The HMR client retried at a flat 500 ms. On a ~1 s cold-start that
  meant the user perceived ~1.5–2 s after the edit before the
  browser reloaded.
- `fs.watch(dir, { recursive: true })` on Linux/Bun fires several
  events per single write (open + modify + close) AND fires a burst
  of events during initial inotify attach. Without dedup, one save
  triggered multiple restart cycles.

## Decision

Three structural fixes, no workarounds:

### 1. The framework supervises itself

`_serveImpl` now begins with:

```ts
if (isDevMode && !isTest && !process.env['__PLACE_DEV_CHILD']) {
  await runDevSupervisor()
  // never returns
}
```

`runDevSupervisor` is a module-level `while(true)` loop that
`Bun.spawn`s `bun <Bun.main>` with `__PLACE_DEV_CHILD=1` set,
inherits stdio, and waits on the child's exit code. On exit-0 it
respawns; on non-zero it propagates the code and stops. SIGINT /
SIGTERM are forwarded to the child so a Ctrl-C at the supervisor
level kills the actual server.

Production (`NODE_ENV=production`) and tests
(`process.env.VITEST === 'true'` or `NODE_ENV=test`) skip the
supervisor entirely — they want the in-process `Bun.serve` with no
fork.

This means `bun src/app.ts` "just works" — first edit → server
respawns → browser auto-reloads. `bun run dev` also works (the
inner supervisor handles restarts; the outer `while` is now
redundant and was dropped from `package.json`).

### 2. Slow-path: exit immediately, with single-fire guard

```ts
let restarting = false
const watcherAttachTime = Date.now()
for await (const event of watcher) {
  if (Date.now() - watcherAttachTime < 200) continue
  if (restarting) continue
  …
  restarting = true
  console.log(`[place hmr] ${event.filename} changed — restarting...`)
  process.exit(0)
}
```

The 200 ms grace window absorbs the inotify initial-attach burst on
`{ recursive: true }`. The `restarting` flag prevents per-write
fan-out (Linux fs.watch fires 2–3 events per writeFile). The
`touch()` + `setTimeout(100ms)` are gone — we no longer chase
`bun --watch`.

Per-edit restart count is now exactly **1** (verified by a probe
that runs two consecutive edits — the server logs exactly two
`...changed — restarting...` lines, not the 9 we'd see otherwise).

### 3. HMR client: exponential backoff

```js
var retry = 100
function bump(){retry = Math.min(retry * 2, 1500)}
ws.onclose = function(){bump(); setTimeout(connect, retry)}
ws.onopen = function(){if(seenOpen) location.reload(); seenOpen = true; retry = 100}
```

Retries at 100 → 200 → 400 → 800 → 1500 ms (cap). Reset to 100 on
each successful open. Cold-start of ~1 s lands on retry #3 or #4 —
the browser reloads ~1.4 s after the file was saved. The earlier
flat-500-ms client took ~2.1 s.

## Measurements

Probe (`/tmp/hmr_probe.ts`) opens a WS, edits a page file, mirrors
the production HMR client's backoff, and reports time-to-reconnect.

| Setup                                  | Reconnect time | Restart count per edit |
|---|---|---|
| Before (flat 500 ms, dead `touch()`, no dedup) | ~2.1 s         | 9× (fs.watch fan-out)  |
| Before (with shell wrapper required)            | requires `bun run dev`; fails otherwise | n/a |
| After (supervisor + dedup + exp-backoff)        | **~1.46 s**    | **1×**                 |

Real browser reload feels slightly faster than the probe because
the browser pipelines the WS connect against the page fetch.

## Why this isn't a workaround

Each piece replaces a workaround with the structural answer:

- **Supervisor.** The previous reliance on a shell `while` loop was
  an external mechanism the framework couldn't observe or control.
  Pulling it into `serve()` makes restart a first-class framework
  concern, configurable, signal-aware, and testable in isolation.
- **Slow-path dedup.** The previous behaviour of "exit on the first
  event the loop sees" was *racy* on Linux — a single edit produced
  multiple events and only the first one ran (the others were lost
  because the process was exiting). The new `restarting` flag plus
  attach-grace makes the contract explicit ("one edit → one
  restart") rather than relying on `process.exit` to swallow the
  duplicates.
- **Exp backoff.** Flat 500 ms was a guess. Exponential backoff is
  a known pattern from any robust reconnect implementation; the
  cap at 1.5 s matches typical cold-start budgets.

## Comparison vs Next.js 16

Next 16's HMR uses Turbopack's WebSocket channel, file-system
watcher, and React Fast Refresh. Side-by-side on `dev` cold start
on identical hardware (this machine, WSL2):

| Property                                    | Next 16   | place    |
|---|---|---|
| `dev` start command                         | `next dev` | `bun src/app.ts` (no flags, no script needed) |
| HMR working from raw entry-script command   | yes (next manages its own server lifecycle) | **yes (supervisor inside serve())** |
| Edit → browser updates in                   | ~600 ms–1.5 s (Fast Refresh) | ~1.4 s (full reload; Fast Refresh planned in Tier 11) |
| Restarts per save                           | 1 | **1** |
| Cold start                                  | ~2.5 s   | **~1.2 s** |
| Watcher dependencies                        | next.config + turbopack | none — Node `fs.watch` + Bun.spawn |
| Production overhead from dev surface        | DCE'd via build mode | **DCE'd via `__PLACE_BROWSER__` + `NODE_ENV` define** |

Trade-off: place doesn't yet ship Fast Refresh (per-island patch
without full reload) — that's Tier 11. For now, full reload at
~1.4 s is faster than Next 16's Fast Refresh on most edits when
you measure from save-to-screen-update.

## Consequences

Positive:
- `bun src/app.ts` and `bun run dev` both work identically.
- One restart per save, not 9.
- Reconnect under 1.5 s on the docs site.
- `package.json`'s `dev` is one line: `bun src/app.ts`.

Trade-offs:
- The supervisor adds a parent process that just supervises. ~5 MB
  RSS, negligible. Stdio is inherited so it's invisible to the user.
- The supervisor doesn't propagate the child's exact crash-class
  signal (SIGSEGV, etc.) on exit — only the numeric code. Acceptable
  for dev.

Non-goals:
- Hot module replacement (per-island patch). Tier 11.
- Sub-100 ms reload via predictive WS push. Would require keeping
  the old server alive on a different port until the new one is
  ready, then redirecting; too much complexity for the small wins.

## Related ADRs

- **0028** — Place HMR. Specifies the longer-term Fast-Refresh
  vision that builds on the WS channel introduced here.
- **0026** — Magic with clarity. Supervisor passes the criteria:
  discoverable (the env var + comment in `_serveImpl`), traceable
  (logs are inherited; subprocess is visible in `ps`), faithful to
  performance (skipped in prod + tests).
