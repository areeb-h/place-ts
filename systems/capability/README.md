# Capability System

Effect handler installation, scoped tracking contexts, permission enforcement at boundaries. The system that gives Direction E ("capability-passed scopes") a home.

**Status:** **v0.1 + Phase 4 v0.1 shipping.** Runtime: `defineCapability` / `provide` / `install` / `use` / `tryUse` plus the `withCapability` bridge in `@place-ts/component`. Phase 4 v0.1 adds `requires(...caps)(fn)` for typed-effect annotation + runtime early-error, plus placeholder type aliases (`Effect`, `IO`, `Mutate`, `Async`, `Throws<E>`, `Read<S>`). Reactive-scope integration (Phase 5) and compile-time scope enforcement (Phase 6+ build step) deferred. **20 tests.**

- [docs/00-charter.md](docs/00-charter.md) — scope and dependencies
- [docs/01-phase4-typed-effects.md](docs/01-phase4-typed-effects.md) — design doc for Phase 4 v0.1, including what's deferred and why
- [src/index.ts](src/index.ts) — runtime

## Shipping API

```ts
import { defineCapability } from '@place-ts/capability'
import { withCapability } from '@place-ts/component'

interface Logger { log(msg: string): void }
const Log = defineCapability<Logger>('Log')

// Consumer:
const Action = component(() => {
  const log = Log.use()                          // throws if not provided
  return button({ onClick: () => log.log('!') }, 'click')
})

// Provider:
mount(
  withCapability(Log, { log: console.log }, <Action />),
  document.body,
)
```

`Capability.provide(impl, body)` is the synchronous primitive for non-component code. `withCapability(cap, impl, view)` is the bridge that keeps the impl in scope for the entire mounted view's lifetime — necessary because component HOC bodies run at mount time, after `provide` would have already unwound.

## Phase 4 v0.1 — typed effects (manual annotation)

Wrap a function with `requires(...caps)` to (1) brand it at the type level with `Requires<C>` and (2) check at call time that every cap is installed, throwing a clear early-error before the body runs.

```ts
import { defineCapability, requires } from '@place-ts/capability'

const Logger = defineCapability<{ log(msg: string): void }>('Logger')
const Network = defineCapability<{ fetch(url: string): Promise<string> }>('Network')

const fetchUser = requires(Logger, Network)((id: string) => {
  Logger.use().log(`fetching ${id}`)
  return Network.use().fetch(`/users/${id}`)
})
// fetchUser type: typeof inner & Requires<readonly [LoggerCap, NetworkCap]>
// fetchUser('42'): if either cap is missing, throws with a hint to use
//   withCapability(...) or .install(impl).
```

**This does not enforce capability scoping at the type level.** TypeScript's structural type system can't verify "this call site is inside a `withCapability(Logger, ...)` block" without compiler help. The brand documents the requirement; the runtime check catches forgotten installs at the earliest possible point. Compile-time enforcement is deferred to a future build-system phase.

The effect kind aliases (`IO`, `Mutate`, `Async`, `Throws<E>`, `Read<S>`) ship as placeholders — vocabulary is locked, semantics arrive as workloads demand them.

See [docs/01-phase4-typed-effects.md](docs/01-phase4-typed-effects.md) for the design rationale and the considered alternatives.

## What's deferred

- **Compile-time scope enforcement.** A build step that reads `Requires<C>` brands and checks the call-site is inside the right `withCapability` lexical scope. Land when the build system has shape.
- **Effect inference** (deriving requirements from function bodies without manual annotation). Probably a custom TS transform.
- **Async-safe propagation** across `await` boundaries. Capabilities work synchronously now; an async boundary loses the stack. This is Phase 5 (reactive scopes).
- **Effect polymorphism** (`<E extends Effect>(fn) => Effect<E | IO>`). Hard without higher-kinded types.
- **Reactive integration** with `@place-ts/reactivity` scopes (Phase 5).
