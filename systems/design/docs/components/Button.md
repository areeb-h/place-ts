# Button

`<Button>` is the first primitive in `@place/design`. It proves the
structural pattern every other primitive will follow.

## Trigger

Every app needs a button. Every framework's design library has one
(or three). Building it first locks down the recipe + motion + ARIA
+ slot-composition patterns the rest of the library will mirror.

## Non-goals

- **No `asChild` polymorphism.** A button renders a `<button>`. If
  you want an anchor, write `<a class="...">` and pull the recipe via
  `import { recipe } from '@place/design'` directly.
- **No icon library.** The `icon` prop accepts any `View` — bring your
  own.
- **No "as" prop with type forwarding.** Same reasoning as `asChild`.
  Polymorphic components are structurally untypeable and break under
  RSC. Apps that need a link-styled-as-button use the recipe directly.

## Failure modes watched for

- **Loading-state flicker on fast async work.** The spinner uses a
  120ms debounce — work that completes faster doesn't flash a spinner.
  Implemented via `animate()` reading a "loading-stayed-true-this-long"
  derivation. SSR-frozen clock means server-rendered HTML never shows
  the spinner.
- **Click-while-loading double-submit.** `disabled` AND `loading` both
  short-circuit the click handler. The native `disabled` attribute
  also prevents clicks pre-hydration.
- **CSP-blocked inline style writes.** The spinner's opacity is
  written via `style:opacity` (CSP-safe `setProperty` path per ADR
  0014), NOT via `style="opacity: …"`.
- **Hydration-time visual flicker.** The recipe's class string is
  deterministic and identical on server + client. No `useEffect`-style
  post-mount class injection.

## Anti-patterns this primitive avoids

| Mistake | Source | How this Button avoids it |
|---|---|---|
| Copy-paste model | shadcn | Importable; not a CLI scaffolder |
| `asChild` polymorphism | Radix Slot | One element; recipe is exportable for custom hosts |
| Runtime CSS-in-JS | MUI/Chakra | Tailwind utility classes only |
| `className` override + tailwind-merge runtime | shadcn | `class` prop is opt-in additive; `cls()` is Tailwind-aware merge |
| Arbitrary Tailwind values | Tailwind v4 | Recipe uses only token-bound utilities (`bg-accent`, `text-fg`, `rounded-md`) |
| Imperative loading controls | Framer Motion's `useAnimationControls` | `loading` is a signal; spinner is a derivation |

## Surface

```ts
interface ButtonProps {
  intent?: 'primary' | 'secondary' | 'ghost' | 'destructive'  // default 'primary'
  size?: 'sm' | 'md' | 'lg'                                    // default 'md'
  onClick?: (e: MouseEvent) => void
  disabled?: boolean | (() => boolean)
  loading?: boolean | (() => boolean)
  type?: 'button' | 'submit' | 'reset'                         // default 'button'
  class?: string                                                // additive only
  icon?: View                                                   // before children
  'aria-label'?: string
  children?: Children
}
```

## Examples

```tsx
import { Button } from '@place/design'
import { state } from '@place/reactivity'

// Static
<Button intent="primary">Save</Button>

// Reactive loading state
const saving = state(false)
const onSave = async () => {
  saving.set(true)
  try { await save() } finally { saving.set(false) }
}
<Button loading={saving} onClick={onSave}>Save</Button>

// Inside a Form
<Form action={createPost}>
  <Input name="title" />
  <Button type="submit" intent="primary">Create</Button>
</Form>

// Icon + label
<Button icon={<TrashIcon />} intent="destructive">Delete</Button>

// Icon-only — aria-label required
<Button icon={<TrashIcon />} aria-label="Delete" intent="ghost" />
```

## Tests

Unit + behavior covered in `systems/design/tests/unit/Button.test.ts`:

- Renders identical HTML server + client.
- `disabled` and `loading` both prevent click handler from firing.
- Native `disabled` attribute is on the element when either is true.
- `aria-disabled` and `aria-busy` reflect the right states.
- Spinner only mounts when `loading` is truthy (motion shows it after
  debounce; SSR shows it at rest opacity = 0).
- `class` prop appends to the recipe's class string via `cls()`.
- Recipe variants produce stable class strings (snapshot covered).
