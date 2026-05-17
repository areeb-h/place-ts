# ADR 0045: Tier 16-C — `fromStandard()` schema interop + field-level error packaging

**Status:** accepted (2026-05-17)
**Date:** 2026-05-17
**Affects:** `systems/component/src/action.ts` (new `fromStandard`, `isValidationFailure`, `StandardSchemaV1` types, `ValidationFailure`), `systems/component/src/index.ts` (re-exports), `systems/component/tests/unit/from-standard.test.ts` (new).

## Context

T16-C in the Tier 16 plan calls for "schema-agnostic" form validation:
the framework should integrate cleanly with Zod, Valibot, ArkType, or
Effect Schema — without taking a dependency on any of them and without
inventing a bespoke validator interface that consumers have to
reimplement per library.

The existing `ActionSchema<T> = (raw: unknown) => T` already accepts
any function that throws on invalid input, so e.g. `input: zodSchema.parse`
works today. But the failure shape is unstructured: the server returns
`400 + text/plain message`, and the client gets an `ActionError` with
`status: 400` + `message: string` — no per-field detail. Apps that
want to drive `<Field error={...}>` per input field have to either:
(a) write their own per-form error-parsing code, OR (b) reach inside
the validator library's error API (e.g. `ZodError.flatten()`), which
re-couples the framework to that library.

Standard Schema (https://standardschema.dev) solves this. It's a
zero-runtime convention that validator libraries opt into by exposing
a `~standard` property with a stable `validate()` shape. Zod 3.24+,
Valibot 0.36+, ArkType, and Effect Schema all ship it. The framework
can read the structured `{ issues: [{ message, path }] }` failure
format without knowing or caring which library produced it.

## Decision

Ship two surfaces in `@place/component`:

### `fromStandard(schema)` — schema adapter

```ts
export function fromStandard<S extends StandardSchemaV1>(
  schema: S,
): ActionSchema<StandardSchemaV1.InferOutput<S>>
```

Wraps a Standard Schema validator in the existing `ActionSchema<T>`
shape. On success: returns the validated value. On failure: throws
`ActionError(400, 'Validation failed', { fields: { [path]: message } })`.
The `path` is a dotted string (`"email"`, `"profile.age"`,
`"items.0.name"`) built from the issue's `path` array; issues without
a path go under the `_root` key.

### `isValidationFailure(payload)` — type guard

```ts
export function isValidationFailure(payload: unknown): payload is ValidationFailure

export interface ValidationFailure {
  readonly fields: Readonly<Record<string, string>>
}
```

Narrows `ActionError.payload` so apps can route per-field messages to
`<Field error={...}>` state cells without `any` casts.

### `StandardSchemaV1` types

Inlined from the spec (zero dep). Includes `InferOutput` /
`InferInput` helpers for the rare app that wants to pre-compute the
typed output.

## Usage

```ts
// shared.action.ts
import { z } from 'zod'
import { action, fromStandard } from '@place/component'

export const signup = action({
  path: 'POST /api/signup',
  input: fromStandard(z.object({
    email: z.string().email('Enter a valid email'),
    age: z.number().int().min(18, 'Must be 18 or older'),
  })),
  fn: async ({ email, age }) => {
    // typed: email is string, age is number
    return { ok: true }
  },
})
```

```tsx
// signup-form.tsx
import { state } from '@place/reactivity'
import { Form, ActionError, isValidationFailure } from '@place/component'
import { Field, Input, Button } from '@place/design'
import { signup } from './shared.action'

const emailErr = state('')
const ageErr = state('')

<Form
  action={signup}
  onError={(e) => {
    if (e instanceof ActionError && isValidationFailure(e.payload)) {
      emailErr.set(e.payload.fields.email ?? '')
      ageErr.set(e.payload.fields.age ?? '')
    }
  }}
>
  <Field label="Email" error={() => emailErr()}>
    <Input name="email" type="email" />
  </Field>
  <Field label="Age" error={() => ageErr()}>
    <Input name="age" type="number" />
  </Field>
  <Button type="submit">Sign up</Button>
</Form>
```

## Why this passes "magic with clarity" (ADR 0026)

- **Discoverable in source.** Standard Schema is a public spec
  (https://standardschema.dev) with a public-tag (`~standard`). A
  reader can grep for `fromStandard(` and see exactly which schemas
  the app validates against; the per-field error structure is
  documented in `ValidationFailure`. No magic + no codegen.
- **Traceable in tooling.** `ActionError.payload` is a serializable
  object; devtools / network inspector show the exact `{ fields }`
  shape the client receives. No opaque error references.
- **Faithful to performance budgets.** `fromStandard` is ~30 lines
  of runtime code, no library bundled. `isValidationFailure` is a
  tiny shape check. The framework ships zero validation dependency;
  apps pull whichever Standard-Schema-compliant library they prefer.

## What's NOT in this cut

- **Auto-binding from `<Form onError>` to per-field state.** A
  `formErrors()` helper that returns a `Record<string, State<string>>`
  + an automatic `onError` wire would be a reasonable next cut. Today
  apps wire it manually (5 lines per form). Ship when a real consumer
  asks for it.
- **Async validators.** `fromStandard` rejects them with
  `ActionError(500)`. Async checks belong in the action's `fn` body
  (where they can hit a DB, talk to a service, etc.) — not at the
  request-boundary input gate that needs sync semantics.
- **Server-to-client schema sharing optimization.** Apps already share
  one schema definition across both runtimes by importing the same
  module on both sides; nothing more to do.
- **`<Form>` auto-resetting fields on success / preserving on error.**
  UX choice the app owns. Sugar for these patterns can layer on top.
- **Zod / Valibot / ArkType integration examples.** Should land as a
  recipe page in the docs site. Out of scope for this ADR (it's
  documentation, not platform code).

## Tier 16 status after this cut

| Cut | Status | ADR |
|---|---|---|
| T16-A (Table/DataGrid) | not started | — |
| T16-B (Image + sharp) | not started | — |
| T16-C (Form + schema) | ✓ | 0045 (this) |
| T16-D (Combobox + Sheet) | not started | — |
| T16-E (Can RBAC) | ✓ | 0044 |
| T16-F (Real-time sync-server) | not started | — |

## Verification

- **1317 tests pass** (14 skipped) across 80 files. Was 1303
  pre-this-cut; +14 from `from-standard.test.ts`.
- Tests cover: happy path return, `ActionError(400)` on failure,
  empty-path issues go under `_root`, object-field paths, PathSegment
  `{ key }` form, first-message-per-field dedup, async validator
  rejection with `ActionError(500)`, inferred output type flow.
  `isValidationFailure` tests: accepts string-valued fields, rejects
  non-objects, rejects non-string field values, rejects array
  `fields`, narrows the type.
- No regressions in existing 1303 tests.

## References

- Standard Schema spec — https://standardschema.dev
- ADR 0026 — "Magic with clarity" gate.
- ADR 0044 — `<Can>` (companion T16 cut).
- `systems/component/src/action.ts` — `ActionSchema<T>`, `ActionError`,
  the `action()` definition surface that `fromStandard` adapts to.
