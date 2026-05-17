# ADR 0047: Tier 17-A — Combobox flex-shell restructure

**Status:** accepted (2026-05-17)
**Date:** 2026-05-17
**Affects:** `systems/design/src/Combobox.tsx`, `systems/design/tests/unit/Combobox.test.ts`.

## Context

The v0.1 Combobox (ADR 0046) used an absolute-positioned-decoration
pattern: leftIcon, clear button, and chevron were `absolute`-
positioned over the input; the input itself got `pl-8!` to make room
for the leftIcon. Multiple polish passes failed to fix a recurring
visual bug — the icon kept "touching the edge" or overlapping text.

Root cause, found via CSS inspection of the rendered output:

1. **Tailwind v4 (4.2.4) JIT generates `.pl-8` from the source
   candidate `pl-8!` — but does NOT emit the `!important`** variant.
   The HTML keeps the literal `pl-8!` class, which matches no CSS
   rule. CSS class selectors require exact match: `.pl-8` matches
   `<el class="pl-8">` but NOT `<el class="pl-8!">`.
2. Our `twMerge()` correctly strips the recipe's `pl-3` when it sees
   the rightmost `pl-8!` in the same `pl` group.
3. Combined: the input ends up with ZERO `padding-left` (no `pl-3`,
   no `pl-8`, nothing matches). Icon at `left-2.5` (10px) lands on
   top of text at ~4px.

The structural mistake — flagged independently by the Tier 17
critic pass — is the absolutely-positioned-decoration pattern itself.
Every serious 2026 combobox (Ark, Headless v2, Base UI 1.0, Mantine
v8) uses a **flex shell** where the icon and input are *siblings*,
no `pl-N` override, no absolute math, no `pointer-events: none`
workaround. Fixing the pattern eliminates the bug class entirely.

Concurrent audit findings, also rolled into this cut:

- `aria-activedescendant=""` (empty string) is announced as "blank"
  by some screen readers; should be omitted when no option is active
  (ARIA spec).
- `onFocus` opening the popover automatically disrupts tab-flow
  through forms; WAI-ARIA Combobox v1.2 says open on user intent
  (click / ArrowDown), not on focus alone.
- Previous version reset `activeIndex` to `-1` on every open, losing
  user context when reopening with a value already selected.
- Mouse hover over options fights with arrow-key navigation when the
  cursor is drifting.

## Decision

Restructure Combobox to a flex shell + bundle the audit fixes:

### Flex shell

```tsx
<div class="flex items-stretch w-full rounded-md border ... focus-within:ring-2 ...">
  {leftIcon ? <span class="flex items-center pl-3">{leftIcon}</span> : null}
  <input class="flex-1 min-w-0 bg-transparent outline-none border-0 ..." />
  <span class="flex items-center gap-0.5 pr-2">
    {clearable && hasValue ? <ClearButton /> : null}
    {showChevron ? <Chevron /> : null}
  </span>
</div>
```

The OUTER `<div>` carries the border / background / focus ring (via
`focus-within:`). The bare `<input>` carries only typography +
`flex-1 min-w-0`. No `pl-N` override. No absolute-positioning math.
The `pl-8!` pattern is structurally extinct.

### Audit fixes

- **`aria-activedescendant` omitted** when no option is active
  (returned `undefined` from the reactive accessor; the framework
  drops the attribute).
- **`onFocus` no longer auto-opens.** Open on `click` / `ArrowDown` /
  `ArrowUp` / typing only. Tab-flow through forms is no longer
  disrupted.
- **Opens to selected.** If a value is selected, that row's index is
  the initial `activeIndex` on open. Previous `-1`-on-every-open
  lost user context.
- **Mouse-vs-keyboard arbitration.** A `keyboardActive` state cell
  tracks the last interaction kind. While true, `onMouseEnter`
  updates are ignored so a drifting mouse doesn't fight with arrow-
  key navigation. Reset on the next `mousemove`.

### Visual polish (T17-A follow-ups)

- LeftIcon container `pl-3` (12px breathing room from rounded
  border).
- Option hover changed from `hover:bg-card/70` (invisible — same
  color as popover bg) to `hover:bg-fg/5` (tonal lift visible in
  both themes).
- Selected state: `bg-accent/6 hover:bg-accent/12 font-medium`.
- Active state (keyboard nav): `bg-accent/12 text-fg` — stronger
  than hover, distinguishes from mere mouse-over.

## Consequences

- The `pl-8!` Tailwind quirk is no longer reachable through any
  Combobox API; the failure mode is structurally extinct.
- LeftIcon-with-text alignment is consistent across all sizes — the
  flex shell handles it, not arithmetic between absolute positions.
- `focus-within:` on the shell means the entire input + icon area
  shows the focus ring as one unit (was: focus ring on input only,
  icon was a stranded overlay).
- Right-side affordances (clear + chevron) no longer overlap typed
  text because they're siblings, not overlays.
- 25 Combobox tests pass (was 22; +3 for the audit fixes:
  `aria-activedescendant` omit, `class` prop on shell, flex
  structure).

## What's NOT in this cut

- **CSS Anchor Positioning** for the dropdown — that's T17-B
  (separately tracked in ADR 0048; landed in the same session).
- **`@source inline()` for runtime-composed classes** — open
  question; might need it if recipe-composed strings ever escape
  Tailwind's source scanner.

## References

- ADR 0046 — original Combobox + Sheet.
- ADR 0026 — "magic with clarity" gate.
- WAI-ARIA Combobox 1.2 — https://www.w3.org/TR/wai-aria-1.2/#combobox
