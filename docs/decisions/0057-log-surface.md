# ADR 0057 — Server-side log surface

## Status

Accepted. Effective `@place-ts/component` 0.10.0.

## Context

Pre-0.10, the framework emitted dev-mode terminal output through scattered
`console.log` / `console.warn` / `console.error` calls and raw
`process.stdout.write()` calls across `serve.ts`, `app.ts`, the font/
tailwind/isr subsystems, and the HMR + crash-recovery paths. Real
problems this caused:

1. **No log levels.** Every diagnostic was emitted at default visibility
   regardless of severity. No way to silence routine ops (`PORT busy`
   notes, ISR background revalidation) or surface verbose detail
   (per-route table, static-asset request log lines) on demand.
2. **Raw exception dumps.** `console.error('[place hmr] island rebuild
   failed:', e)` printed `[object Object]` for caught `Error` instances
   in some runtimes. The dev had to leave the terminal and check the
   browser overlay to see the actual error.
3. **Inconsistent prefixes.** Some lines used `[place]`, some `[place
   hmr]`, some no prefix. Couldn't grep for one subsystem.
4. **Banner interleaving.** The port-walk fallback warning fired AFTER
   serve binds (after the startup banner), so it landed below the
   banner in scrollback — exactly when scanning attention is on the
   banner itself.

## Decision

Single source of truth in `systems/component/src/logging.ts`:

```ts
import { log } from '@place-ts/component/internal'

log.info('hello')
log.warn('be careful')
log.error('boom', errorObject)         // formats Error via parseStackFrames
log.debug('silent unless PLACE_LOG_LEVEL=debug')

const hmr = log.scope('hmr')           // → '[hmr] ...'
hmr.info('rebuilt in 156ms')
hmr.error('rebuild failed', err)       // shared error renderer

log.systemMessage('port 5174 in use — using 5175')   // buffered above banner
```

### Level resolution

`process.env.PLACE_LOG_LEVEL` (one of `error`, `warn`, `info`, `debug`,
`trace`); defaults to `info`. Resolved once at module evaluation and
cached.

`error` + `warn` go to stderr; `info` / `debug` / `trace` to stdout.

### Scope convention

Each subsystem creates a scoped child logger:
- `log.scope('hmr')` — HMR rebuild + reload messages.
- `log.scope('isr')` — ISR background revalidation warnings.
- `log.scope('tailwind')` / `log.scope('font')` — subsystem diagnostics.

Nested scopes chain with `:` (e.g. `log.scope('isr').scope('background')`
→ `[isr:background]`).

### Pre-banner system messages

`log.systemMessage(msg)` buffers diagnostics that should appear ABOVE
the startup banner — port walk fallbacks, optional-peer-dep missing
notices, security defaults applied. The buffer flushes when the
banner formatter runs, producing one coherent block:

```
  i  port 5174 in use — using 5175 instead
  i  sharp not installed — image transforms disabled

  ◆  my-app — ready in 243ms
     ...
```

After the banner has rendered, subsequent `log.systemMessage()` calls
fall through to `log.info()` (no buffering — the moment has passed).

### Request log line refresh

`formatRequestLogLine` now:
- Takes an object input (`{ method, path, status, ms, redirectTo? }`)
  with a back-compat positional overload through 0.10.x.
- Suppresses static-asset paths (`/islands/*`, `/_place/*`, `*.js`,
  `*.css`, etc.) at the default `info` level. Surfaced at `debug`. Cuts
  typical dev session noise ~70%.
- Renders `→ <Location>` for 3xx with a Location header.
- Highlights the ms column red when > 1000ms.

### Startup banner refresh

Three sections (header, URLs, summary) — drops the unbounded per-route
table (still available at `debug`). Adds optional network URL slot.
Drops per-build timing rows (rolled into the header `ready in Xms`).

### Build banner

New `formatBuildBanner` for `PLACE_BUILD=dist` static export. Compact
4-line summary of what was emitted.

### Terminal error renderer

`formatTerminalError(err)` shares `parseStackFrames` (already exported
from `error-overlay.ts`) and renders a 1-4 line block: name + message,
top user frame, up to 2 more frames. Used by `log.error(msg, err)` and
the HMR rebuild-failure path.

## Stability contract

These are stable public surfaces from 0.10.0:

1. The `PLACE_LOG_LEVEL` env var (set of allowed values + meaning).
2. The scope-prefix format `[scope] msg`.
3. The startup banner's three-section shape (header / URLs / summary).
4. The request log line's column order (method, path, status, ms, tag).

The internal `log` namespace and the formatter shapes are NOT public —
callers should route through `process.stdout` or capture the existing
output streams if they need structured access. We'll consider a public
logger API when there's a concrete consumer.

## Out of scope

- JSON log output mode.
- Per-request correlation IDs.
- Log-to-file (`bun dev | tee log.txt` covers this).
- Configurable colour palettes / theme support for terminal output.

Each is a follow-up if real demand surfaces.

## Migration notes

For pre-0.10 callers that used:
- `formatRequestLogLine(method, path, status, ms)` — still works via
  the positional back-compat overload, but prefer the new object shape.
- The startup banner — its rendered shape is observably different.
  Consumers parsing terminal output (CI assertions, etc.) should switch
  to grep-based checks or pin a pre-0.10 version.
