# 01 — Phase 4 typed effects

The runtime half of capabilities is shipping (`defineCapability` + `provide` / `install` / `use` / `tryUse`). Phase 4 is about the type half: how do TypeScript types track that a function uses capability X, so the compiler can warn before runtime?

This doc captures what we ship at Phase 4 v0.1 and — more importantly — what we *don't*, and why.

## The space

Three families of approach exist for typed effects in TypeScript:

1. **Phantom-type brands.** A function returns `Effect<IO, T>` instead of `T`. The brand is structural, not nominal — TS allows assignment as long as `IO` is present. You can't extract `T` without a `handle(...)`. **Pro:** zero runtime. **Con:** verbose; doesn't actually enforce scoping; assignment loopholes (brands are erased on cast).

2. **Algebraic effects via generators.** `function* fetch() { yield IO(...) }`. The generator is the effect; a handler iterates it. **Pro:** real semantics. **Con:** breaks `async/await` ergonomics; every effectful function becomes a generator; viral typing.

3. **Explicit capability passing.** Functions take a capability bundle as a parameter. `function fetch(io: IOCap, id: string)`. **Pro:** standard TS. **Con:** every call site has to thread caps; defeats the purpose of capability scoping.

What we already do at runtime — `defineCapability` + `cap.use()` — is a *fourth* approach: **scoped capability stacks with implicit lookup**. Type-level enforcement on top of this would need either:

- Effect inference (the compiler reads function bodies, sees which `cap.use()` calls happen, and propagates the requirement). TypeScript can't do this without a transform.
- Manual annotation (the developer declares "this function uses these caps"). TypeScript *can* do this with a tagged return type.

We pick manual annotation for v0.1.

## What ships at v0.1

A small primitive — `requires(...caps)(fn)` — that does two things:

1. **Type-level annotation.** The wrapped function's type carries a `Requires<C>` brand listing the required capabilities. Future tooling (or a future build step) can read this brand to enforce scoping.

2. **Runtime early-error.** When the wrapped function is called, all required caps are checked via `tryUse()`. If any are missing, throw a specific error before the body runs — instead of a deep-stack `Error: capability X not provided` from the first internal `.use()` call.

```ts
const fetchUser = requires(Logger, NetworkCap)((id: string) => {
  Logger.use().log('fetching')
  return NetworkCap.use().fetch(`/users/${id}`)
})

// fetchUser type: typeof inner & Requires<readonly [LoggerCap, NetworkCapCap]>
// fetchUser('42'): if Logger or NetworkCap isn't installed, throws with
// a clear "required by fetchUser, install via withCapability(...)" hint.
```

Plus type aliases for the planned effect kinds (`IO`, `Mutate`, `Async`, `Throws<E>`, `Read<scope>`) — placeholders that ship now so future work has a stable vocabulary.

That's it. ~30 LOC total.

## Why this is small on purpose

The temptation is to ship a fuller algebraic-effects DSL. Resisted because:

- **Without compiler help, type-level *enforcement* of scoping is impossible.** TS's structural type system doesn't know about lexical scopes. The brand documents the requirement; it cannot reject `fetchUser()` called outside a `withCapability(Logger, ...)` block.
- **Algebraic-effects ergonomics in TS are bad.** Generator-based effects break async/await. Phantom-type effects bloat every signature.
- **No concrete workload demands it yet.** The commonplace book has 2 capabilities, both installed at the app root. Forgetting to install isn't a real-world bug here.
- **The *runtime* check covers the practical pain.** A nice early-error before the function body runs catches misconfigured deployments, tests with missing fakes, etc. — and we can ship that today without committing to a type-system shape we'll regret.

## What's deferred (in priority order)

- **Compile-time scope enforcement** via a TypeScript transform / build step. Reads `Requires<C>` brands; tracks which caps are installed via `withCapability` / `install`; rejects calls where requirements aren't met. Lands when the build system has shape (Phase 6+).
- **Effect inference** — reading function bodies to derive requirements automatically, without manual annotation. Probably needs a custom TS transform; not Plan A.
- **Async-safe propagation** of capability scopes across `await` boundaries. Capabilities work synchronously now; an async boundary loses the stack. This is a reactivity Phase 5 concern (scopes carry state across async).
- **Effect kinds beyond capabilities** — `Throws<E>` for typed error channels, `IO` / `Mutate` / `Async` as analytic markers. The aliases ship now (placeholder); the semantics land when there's a workload that wants them.
- **Effect polymorphism** — generic effect parameters that compose. `<E extends Effect>(fn: (...) => E) => Effect<E | IO>`. Hard without higher-kinded types; defer.

## Naming

The user-facing API is `requires(...caps)(fn)`. Naming alternatives considered:

- `effectful(caps)(fn)` — too abstract; "effectful" doesn't say *what's* required.
- `needs(caps)(fn)` — competing; chose `requires` because it reads cleanly in the wrapped expression.
- `withCaps(caps)(fn)` — collides with `withCapability`.

The brand is `Requires<C>` (matches the function name). The effect kind aliases use the names from `docs/platform/02-naming-and-voice.md`: `IO`, `Mutate`, `Async`, `Throws<E>`, `Read<scope>`.

## Test surface

The unit tests cover:

- The wrapped function is callable and returns the inner function's value when caps are provided.
- The wrapped function throws a clear error when any required cap is missing.
- The error message names the missing cap and suggests `withCapability` / `install`.
- The brand type is preserved through the wrap.
- Composition: `requires(A)(requires(B)(fn))` — nested; both checks fire.

Type-level tests are kept inline as `expectType<...>` style assertions in the test file (no separate type-test runner needed for ~3 assertions).
