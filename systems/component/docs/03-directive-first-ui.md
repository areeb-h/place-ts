# Control-flow directives — narrow scope

> Status: design. Supersedes the earlier maximalist directive proposal.
> Companion: [`04-directive-first-research.md`](./04-directive-first-research.md)
> for the prior-art evidence that produced this scope.

## Why

Today's framework dresses several behaviors as JSX components: `<Show>`,
`<Activity>`, `<ClientOnly>`, `<Deferred>`. None of them render meaningful
DOM of their own (Activity is a `<span>`, Show is a Fragment). They're hooks
for framework behavior, not composition. Every file that needs one writes
an `import` line for it, and the auto-import plugin reads the registry to
inject those imports at load time.

The narrower fix this doc proposes: replace those four control-flow
behaviors with **attribute directives** on the elements they already wrap.
`<div :if="open">…</div>`, `<button :show="!loading">…</button>`,
`<section :for="(item) of items">…</section>`. No wrapper components, no
imports, no auto-import plugin handling these names.

This document deliberately rejects three larger swings researched in [04]:

- **No `:state:name`.** Implicit reactive bindings introduced by ancestor
  attributes — the Svelte 4 pattern Svelte 5 walked back. State stays as
  `const x = state(0)` JSX-scoped.
- **No `:on:click="active.set('x')"` string expressions.** Events stay as
  `onClick={fn}` JSX-shaped. TypeScript's closure inference is most
  load-bearing on event handlers; degrading it would be the worst trade.
- **No Vue modifier chains (`.prevent` / `.stop` / `.once` / `.capture`).**
  Each modifier is a precedence-table entry the framework pays for
  forever. The same effect is one line of JS in the handler body.

The split: control flow becomes attribute-shaped because it composes
identically with every element. State and events stay JSX-shaped because
they reward closure typing.

## What stays as a JSX component

- **`<Tabs>`** — composition, not a single behavior. ARIA tablist +
  per-panel `<Activity>` wrapping + cookie persistence. Internals can use
  directives; the surface stays a component.
- **`<Suspense>`** — the boundary semantics (collect deferred resources,
  render fallback until all settle, stream the swap) don't fit a single
  attribute on a single element. Composition with named slots is the right
  shape.
- **`<Form>`** — typed-schema-driven composition, same story.
- **App-defined widgets** (Card with named slots, etc.) — JSX is what
  composition is good at. Directives are sugar for behaviors.

## Vocabulary

The full surface. Six directives. Each compiles to existing primitives
the runtime already understands.

### `:if="expr"` / `:else-if="expr"` / `:else`

Conditional mount/unmount of the element and its subtree. Replaces
`<Show when={…}>{() => …}</Show>`. The right-hand side is a **function or
signal reference** — the same shape as today's `class:foo={cond}`. String
expressions are not accepted.

```tsx
<div :if={() => loaded()}>content shown when loaded</div>
<div :else-if={() => error()}>error state</div>
<div :else>fallback content</div>
```

Desugars to the existing reactive-children path the Fragment fix landed:
paired sentinel anchors mark the branch's region; SSR emits the truthy
branch (or nothing); hydrate adopts what's there; a watch on the predicate
replaces the range when it changes. `:else-if` / `:else` are siblings of
the originating `:if` and share the same anchor pair.

### `:show={expr}`

Always-in-DOM visibility toggle. Replaces `<Activity when={…}>`. Element
ships in SSR HTML; `hidden` attribute reactively flips. State preserved
across show/hide cycles.

```tsx
<section :show={() => modalOpen()}>...modal content...</section>
```

Desugars to: `hidden={() => !expr()}` on the element. No new runtime code
path — the framework's reactive boolean-attribute handling does the rest.

### `:for={(item, index) of expr}` (with optional `:key={expr}`)

Keyed list rendering. Replaces `{items().map((item, i) => …)}` in the
common case. The RHS is a `for…of`-shaped destructure where the
iteratee is a function or signal returning an iterable.

```tsx
<li :for={(item, i) of () => todos()} :key={() => item.id}>
  {item.title}
</li>
```

Desugars to a keyed-children primitive (TBD: lean on Solid's `mapArray`
shape; the existing `virtualList()` machinery covers windowed lists, but
keyed-but-not-windowed needs its own helper). Hydration walks the SSR-
emitted children in order, pairs each with its key, and the next mutation
keyed-diffs against the live keys.

The `:for` directive is the most complex piece of this proposal. It is
the part that earns its own design pass before implementation — see
"Open questions" below.

### `:client`

Element body suppressed on SSR, mounted on the client after the hydrate
flag flips. Replaces `<ClientOnly>{() => …}</ClientOnly>`.

```tsx
<div :client>
  <RealtimeClock />
</div>
```

Desugars to: SSR emits an empty placeholder `<span data-place-auto>`; on
hydrate, that span swaps to the real children via the existing
`ClientOnly` machinery. The directive is shorthand; the runtime path is
unchanged.

### `:defer={fallback}`

SSR renders `fallback`; client swaps to children after hydrate. Replaces
`<Deferred fallback={…}>{() => …}</Deferred>`.

```tsx
<div :defer={<Skeleton />}>
  <ExpensiveWidget />
</div>
```

Desugars to the existing `Deferred` swap.

## Why typed function/signal RHS, not strings

Every directive's RHS is either:
- A reactive function: `:show={() => open()}`
- A signal reference: `:show={open}`
- A literal expression that TypeScript already checks: `:if={loaded}`

It is **never** a string. This is the load-bearing decision against the
earlier proposal:

- **TypeScript checks the closure in-editor.** No virtual-`.ts` mirror
  files, no language-server plugin, no Volar-equivalent project.
  `:show={() => open() && !loading()}` red-squiggles immediately if
  `open` was renamed.
- **No compile pass for expression strings.** The transform is purely
  attribute-rewriting (rename `:show` → `hidden`, rewrite `:if` to a
  primitive). No scope analysis, no IIFE injection, no source-map
  shenanigans.
- **Find-references and rename-symbol work.** LSP sees real JS
  identifiers in real JS positions.
- **No precedence ambiguity.** The previous proposal stacked `:if` and
  `:for` on the same element (Vue's `v-if`/`v-for` precedence bug). Here,
  `:if` and `:for` aren't both allowed on the same element — the
  transform errors on conflict. Same answer Vue 3 eventually documented.

The cost: slightly more keystrokes than `:show="open"`. Pay the keystrokes,
keep the typing.

## Compile-time transform

The same Bun plugin that handles auto-imports also handles the directive
rewrite. The transform is a per-attribute pass:

| Directive | Rewrite |
|---|---|
| `:show={expr}` | `hidden={() => !expr()}` (or `!expr` if expr is a signal reference) |
| `:if={expr}` | Wrapped child rendered through a new `If(expr, child)` primitive that bounds the range with anchors. |
| `:else-if={expr}` / `:else` | Sibling-after-`:if`. Chained into the same anchor pair via the runtime primitive. |
| `:for={(item, i) of expr} :key={k}` | Rewritten to a `For({ each: expr, key: k }, (item, i) => child)` call. |
| `:client` | Wraps the child in `ClientOnly({ children: () => child })`. |
| `:defer={fallback}` | Wraps the child in `Deferred({ fallback, children: () => child })`. |

The transform is **mechanical 1:1**. No name resolution, no scope
analysis. The RHS is JS that TypeScript already checks.

Edge cases the transform must handle (and error clearly on):
- `:if` + `:for` on the same element — error: "use a wrapping element."
- `:else-if` / `:else` without a preceding `:if` sibling — error.
- `:key` without `:for` — error.
- Unknown `:directive` — passes through unchanged (apps can define their
  own with `defineDirective`, see open questions).

## Migration path

1. **Ship the directives + the transform.** Existing `<Show>`, `<Activity>`,
   `<ClientOnly>`, `<Deferred>` keep working. New code can use either shape.
2. **Migrate the docs site.** why.page.tsx and the search palette are the
   highest-leverage targets — each currently uses several `<Show>` /
   `<Activity>` wrappers. Page-by-page migration; each PR shows a real
   diff a future user can read.
3. **Deprecate the redundant components in v0.5.** `<Show>`, `<Activity>`,
   `<ClientOnly>`, `<Deferred>` start emitting a deprecation warning. They
   stay in the package one major version, then leave. `<Tabs>` stays.
4. **Auto-import plugin updates.** Stop auto-importing the deprecated four;
   keep auto-importing `state`, `watch`, `onMount`, `cookieState`, `Tabs`.

## Test plan

The transform is a pure source-to-source rewrite over JSX AST positions.
Test strategy mirrors the existing `auto-import-plugin.test.ts`:

1. **Per-directive unit tests on the transform.** Input JSX with the
   directive, output JSX with the desugared primitive. Covers each
   directive plus the error cases (`:if` + `:for` clash, orphan `:else`,
   etc.).
2. **Hydration property tests on the desugared output.** Same
   `hydrate.test.ts` shape — SSR the desugared tree, hydrate, flip state,
   assert DOM. Each directive gets at least one closed→open→closed cycle.
3. **`:for` gets its own test file.** Keyed insert / remove / reorder
   under hydration. This is the riskiest piece and earns extra coverage.
4. **Integration: migrate one page.** why.page.tsx end-to-end. Visual +
   functional parity confirmed via the existing dev-server tests.

## Open questions

These are sized for a follow-up design pass before implementation, not
afterthoughts:

- **`:for` hydration semantics under reorder.** When the SSR-emitted list
  order differs from the first client-side `for-of` evaluation (rare
  with `cookieState` / `urlState`, but possible), what happens? Solid's
  `mapArray` rebuilds the range; we want minimal DOM churn. Worth
  benchmarking against the proposed sentinel-anchor design before
  committing.
- **Custom directives (`defineDirective`).** Should apps register their
  own (`:tooltip={text}`, `:focus-trap`)? Probably yes, but the API
  needs a separate doc. Today's `use:action={fn}` is the existing
  escape-hatch.
- **`:show` vs. CSS `[hidden]` rules.** Some apps reset `[hidden]` in
  their CSS reset. `:show` relying on the UA stylesheet means it can
  silently stop working. Document, or also set inline `display: none`
  as a belt + suspenders? (Inline style runs into the CSP-strict issue
  we hit earlier with Activity.)
- **`:if` + `<Suspense>` interaction.** A `:if` branch whose subtree
  contains a deferred resource — does the suspense boundary correctly
  scope to the active branch, or do the streaming swap markers get
  orphaned when `:if` flips false mid-stream?

These don't block phase 1 (everything except `:for` is straightforward).
They do block phase 2 / 3.

## Out of scope for this doc

- `:state:*`, `:cookie:*`, `:url:*` — state declarations. State stays
  imperative (`const x = state(0)`), JSX-scoped, type-checked. Research
  said don't go here.
- `:on:click`, `:on:*`, modifier chains. Events stay `onClick={fn}`.
- Compound directive expressions (`:if="a && b"` as a string). RHS is
  always real JS.
- A separate template-file format. JSX stays the only authoring shape.
- Compiler magic that hides reactivity (Svelte's `let x` implicitly
  reactive). All state remains explicit.
