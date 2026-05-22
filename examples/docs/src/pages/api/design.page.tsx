// /api/design — @place-ts/design overview. The curated component library.

import { Link, page } from '@place-ts/component'
import { Button, Card, CodeBlock } from '@place-ts/design'
import { Callout } from '../../components/callout.tsx'
import SheetComboboxDemo from '../../islands/sheet-combobox-demo.tsx'

const INSTALL = `// Already wired in workspace apps via workspace:* dep.
// In external apps:
//   bun add @place-ts/design
//
// import { Button, Card, Field, Dialog, ... } from '@place-ts/design'`

const BUTTON_EX = `import { Button } from '@place-ts/design'

<Button intent="primary" size="md">Save</Button>
<Button intent="ghost" size="sm">Cancel</Button>
<Button intent="destructive" loading={isDeleting()}>
  Delete account
</Button>`

const FIELD_EX = `import { Field, Input } from '@place-ts/design'

<Field label="Email" hint="We'll never share it." error={emailError()}>
  <Input
    type="email"
    name="email"
    required
    value={email()}
    onInput={(v) => email.set(v)}
  />
</Field>

// :user-invalid styling kicks in only AFTER the user interacts —
// no red borders on every empty field as the page loads.`

const DIALOG_EX = `import { Dialog, Button } from '@place-ts/design'
import { state } from '@place-ts/reactivity'

const open = state(false)

<Button onClick={() => open.set(true)}>Open dialog</Button>

<Dialog open={open} onClose={() => open.set(false)}>
  <Dialog.Header>Are you sure?</Dialog.Header>
  <Dialog.Body>This action can't be undone.</Dialog.Body>
  <Dialog.Footer>
    <Button intent="ghost" onClick={() => open.set(false)}>Cancel</Button>
    <Button intent="destructive" onClick={confirm}>Delete</Button>
  </Dialog.Footer>
</Dialog>

// Uses native <dialog> + showModal() — gets focus trap, Esc-to-close,
// inert background, and :modal styling for free.`

const TOAST_EX = `// Mount <Toaster /> ONCE at the app root, anywhere in the tree:
import { Toaster, toast } from '@place-ts/design'

<Toaster anchor="bottom-right" />

// Anywhere in your app:
toast('Saved!')
toast.success('Account created')
toast.error('Network error', { duration: 0 })  // sticky
toast.warn('Heads up')

// Returns a dismiss handle:
const dismiss = toast('Working…', { duration: 0 })
// …later
dismiss()`

const TOOLTIP_EX = `import { Tooltip } from '@place-ts/design'

<Tooltip content="Saves to draft" placement="bottom">
  <Button intent="ghost" size="sm">⌄</Button>
</Tooltip>

// popover="manual" puts the bubble in the browser's top layer —
// escapes overflow:hidden / transform / z-index parents.`

const SHEET_EX = `import { Sheet, Button } from '@place-ts/design'
import { state } from '@place-ts/reactivity'

const open = state(false)

<Button onClick={() => open.set(true)}>Filters</Button>

<Sheet open={() => open()} onClose={() => open.set(false)}
       side="right" size="md" aria-label="Filters">
  <Sheet.Header>
    <h3>Filters</h3>
    <Button intent="ghost" size="sm" onClick={() => open.set(false)}>×</Button>
  </Sheet.Header>
  <Sheet.Body>
    {/* ...your filter UI... */}
  </Sheet.Body>
  <Sheet.Footer>
    <Button intent="ghost" onClick={reset}>Reset</Button>
    <Button intent="primary" onClick={() => open.set(false)}>Apply</Button>
  </Sheet.Footer>
</Sheet>

// Edge-anchored drawer. Same native foundation as <Dialog>
// (<dialog> + showModal) — top-layer rendering, focus trap, Esc-to-
// close, ::backdrop overlay. side: 'right' | 'left' | 'top' | 'bottom'.
// Size variants compound with side (max-w for vertical, max-h for
// horizontal). Slide-in via @starting-style. ADR 0046.`

const COMBOBOX_EX = `import { Combobox } from '@place-ts/design'
import { state } from '@place-ts/reactivity'

const pick = state<string | null>(null)

const OPTIONS = [
  { value: 'place', label: 'Place', hint: 'this one' },
  { value: 'next', label: 'Next.js', hint: '15+' },
  { value: 'astro', label: 'Astro', disabled: true },
  // ...
]

<Combobox
  options={OPTIONS}
  value={() => pick()}
  onChange={(v) => pick.set(v)}
  placeholder="Pick one…"
  aria-label="Framework"
/>

// Generic over the option value type. Default case-insensitive label
// filter (override with filter={(q, opt) => ...}). WAI-ARIA Combobox
// v1.2 keyboard nav — Arrow/Home/End/Enter/Escape/Backspace-clears.
// Reactive \`options\` and \`value\` props. Anchored popover positioning.`

const COMBOBOX_CUSTOM = `// Two channels: \`class\` (root) + \`classNames\` (sub-parts).
// Render slots for full structural replacement. (Tier 17-D / ADR 0050)

<Combobox
  options={users}
  value={() => userId()}
  onChange={(id) => userId.set(id)}

  // Decorations: pass any View as left icon or chevron.
  leftIcon={<SearchIcon />}
  chevron={<MyChevron />}     // or chevron={false} to hide

  // Clear button is on by default when a value is selected.
  clearable={false}           // pass false to hide

  // Additive on the root (the flex shell).
  class="border-accent"

  // Typed per-subpart classNames. Each key is a known part; unknown
  // keys are compile errors. No \`root\` key — use \`class\` above.
  classNames={{
    popover: 'shadow-2xl',
    option:  (st) => st.selected ? 'font-bold' : '',
    clear:   'hover:text-destructive',
    leftIcon: 'text-accent',
  }}

  // Custom row renderer — full control over the per-option JSX.
  renderOption={(st) => (
    <>
      <Avatar src={st.option.avatarUrl} size="sm" />
      <span class="flex-1">{st.option.label}</span>
      <Badge>{st.option.role}</Badge>
    </>
  )}

  // Custom empty-state node.
  renderEmpty={() => <NoResults />}

  // Custom filter (fuzzy, scored, multi-field, ...).
  filter={(q, opt) => fuzzyScore(q, opt.label + opt.email) > 0.4}
/>`

const DISCLOSURE_EX = `import { Disclosure } from '@place-ts/design'

// Single section — browser owns open/close state via <details>.
<Disclosure summary="What is place-ts?">
  <p>An HTML-first framework that…</p>
</Disclosure>

// Exclusive accordion — native [name] attribute (Chrome 120+ /
// Safari 17.4+ / Firefox 130+). Sibling <details name="faq">
// auto-close each other on open. Zero JS coordinator.
<Disclosure.Group>
  <Disclosure name="faq" summary="Q1">A1</Disclosure>
  <Disclosure name="faq" summary="Q2">A2</Disclosure>
  <Disclosure name="faq" summary="Q3">A3</Disclosure>
</Disclosure.Group>

// Controlled — wire to a signal for programmatic open/close:
const open = state(false)
<Disclosure open={open} onToggle={open.set} summary="Settings">
  …
</Disclosure>

// Animated height via interpolate-size + ::details-content pseudo
// (Chrome 129+, Safari 18.2+, Firefox 131+). Older browsers get
// instant open/close — graceful degradation, no polyfill.`

const THEME_TOGGLE_EX = `import { ThemeToggle } from '@place-ts/design'

// Defaults: segmented control with System · Light · Dark
<ThemeToggle />

// Cycle: single button advancing system → light → dark → system
<ThemeToggle variant="cycle" />`

const THEME_TOGGLE_PROPS = `<ThemeToggle
  variant="segmented"                       // 'segmented' (default) | 'cycle'
  size="md"                                 // 'sm' | 'md' (default) | 'lg'
  includeSystem={true}                      // (default) include 'system' option
  modes={['light', 'dark']}                 // restrict to specific modes (default: from window.__placeTheme)
  labels={{
    system: 'Auto',
    light:  'Day',
    dark:   'Night',
  }}                                        // override per-mode aria-label / cycle text
  icons={{
    system: <DesktopIcon />,                // any JSX View
    light:  <SunIcon />,
    dark:   <MoonIcon />,
  }}
  class="ml-auto"                           // additive Tailwind via cls()
  aria-label="Theme"                        // group label (default: 'Theme')
/>`

const MENU_EX = `import { Menu, Button } from '@place-ts/design'

const MENU_ID = 'post-actions'

<Button popovertarget={MENU_ID}>Actions</Button>
<Menu id={MENU_ID} items={[
  { kind: 'group', label: 'Edit' },         // section header
  { label: 'Open',      onSelect: open, hint: '⌘O' },
  { label: 'Duplicate', onSelect: dup,  hint: '⌘D' },
  { kind: 'separator' },                     // horizontal divider
  { kind: 'group', label: 'Danger zone' },
  { label: 'Delete', onSelect: del, destructive: true },
]} />

// Item kinds (Tier 17-E v2):
//   - 'item' (default)  selectable menuitem button
//   - 'separator'       horizontal divider (skipped in keyboard nav)
//   - 'group'           non-interactive section header
//
// popover="auto" gives native light-dismiss; CSS anchor positioning
// pins the menu to the trigger button (no JS positioner).`

const PRESENTATIONAL = `import { Avatar, Badge, Card } from '@place-ts/design'

<Avatar name="Ada Lovelace" src={user.avatarUrl} size="md" />
<Badge intent="success">New</Badge>
<Card intent="raised" padding="md">
  Card body
</Card>`

const CODEBLOCK_EX = `import { CodeBlock } from '@place-ts/design'

// Minimal — just a code string. ts is the default language.
<CodeBlock code={src} />

// Sweet spot for docs: filename + lang label + copy button.
<CodeBlock code={src} lang="tsx" filename="src/app.tsx" />

// Line numbers + line highlights — a tiny "spotlight" pattern.
<CodeBlock
  code={src}
  lineNumbers
  highlightLines={[3, [5, 7]]}
/>

// Diff mode — first char of each line is +/-/space.
<CodeBlock code={diff} diff lang="ts" />

// Density / radius / theme variants.
<CodeBlock code={src} density="compact" radius="sm" theme="dim" />

// Wrap instead of horizontal scroll.
<CodeBlock code={src} wrap="wrap" maxHeight={400} />`

const CODEBLOCK_CUSTOM = `// Override token colors per-instance via CSS variables.
<CodeBlock
  code={src}
  style={{
    '--cb-tok-keyword': '#ff79c6',
    '--cb-tok-string': '#a0e7a0',
    '--cb-hl-bg': 'rgba(255, 121, 198, 0.12)',
  }}
/>

// Custom tokenizer per instance (one-off languages).
import type { Tokenizer } from '@place-ts/design'

const tokenizeJson: Tokenizer = (src) => {
  // ... return Tok[] ...
}

<CodeBlock code={src} tokenize={tokenizeJson} />

// Global registration — every <CodeBlock lang="rust"> picks it up.
import { registerLanguage } from '@place-ts/design'

registerLanguage('rust', tokenizeRust)`

const CODEBLOCK_SLOT = `// Replace the entire header with your own slot. The framework's
// default copy button disappears; consumers own the chrome.
<CodeBlock
  code={src}
  headerSlot={
    <div class="flex w-full items-center gap-2">
      <Badge intent="warning">Experimental</Badge>
      <span class="ml-auto text-muted">{lineCount} lines</span>
    </div>
  }
  showCopy={false}  // explicit, since headerSlot opts out by default
/>

// Or keep the default header but append actions:
<CodeBlock
  code={src}
  actionsSlot={
    <button type="button" onClick={openInPlayground}>
      open in playground →
    </button>
  }
/>`

const STYLES_WIRING = `// Wire the design library's Tailwind input (Dialog @starting-style
// transitions, etc.) into your app's styles. \`styles\` takes a string
// array — each entry is a layer, concatenated in order.

import { styles as designStyles } from '@place-ts/design'
import { styles as appStyles } from './styles.ts'

app({
  pages: [...],
  styles: [designStyles, appStyles],
}).start()`

export default page('/design', {
  // String shorthand — h1 says `@place-ts/design` but title reads better as
  // 'Design library'; layout wraps with ' · place docs'.
  meta: 'Design library',
  view: () => (
    <article class="prose max-w-3xl">
      <h1>
        <code>@place-ts/design</code>
      </h1>
      <p>
        A curated component library shipped <em>with</em> the platform — Button, Field / Input /
        Textarea, Dialog, Toast, Tooltip, Menu, Avatar, Badge, Card. Native-first composition is a
        charter principle: every primitive sits on a real browser primitive (
        <code>&lt;dialog&gt;</code>, the Popover API, <code>:user-invalid</code>,{' '}
        <code>@starting-style</code>) so the framework adds behavior, not infrastructure.
      </p>

      <Callout kind="note" title="A package, not a 10th system">
        <code>@place-ts/design</code> is a curated package built on top of the existing systems —{' '}
        <code>recipe()</code>, <code>themeTokens()</code>, the component runtime. The platform map
        keeps nine systems; the design library is one of the curated packages on top. See{' '}
        <a href="https://github.com/anthropics/place-ts/blob/main/docs/decisions/0016-design-library-as-package.md">
          ADR 0016
        </a>{' '}
        for what we deliberately avoid (shadcn copy-paste, Radix <code>asChild</code>, runtime
        CSS-in-JS, <code>tailwind-merge</code> as runtime patch).
      </Callout>

      <h2 id="customization">Customization</h2>
      <p>Every component is highly customizable on four axes — without forking the source:</p>
      <ol>
        <li>
          <strong>Theme tokens.</strong> Components reference theme tokens (<code>bg-card</code>,{' '}
          <code>text-fg</code>, <code>bg-accent</code>, …) which resolve to your theme's CSS
          variables. Swap the theme and every component re-skins atomically. See{' '}
          <Link to="/recipes/theming">Theming</Link>.
        </li>
        <li>
          <strong>Typed recipe variants.</strong> Each component's public surface IS its variant
          ladder — <code>intent</code>, <code>size</code>, <code>side</code>, etc. The variants ARE
          the override channel; charter non-negotiable #4 (no <code>className</code>-as-override).
        </li>
        <li>
          <strong>Two-channel additive contract.</strong> Every component accepts <code>class</code>{' '}
          (additive on the root). Multi-part components additionally accept{' '}
          <code>classNames=&#123;&#123; ...parts &#125;&#125;</code> — a typed map for targeted
          sub-part overrides. Combobox's{' '}
          <code>classNames=&#123;&#123; popover, option, leftIcon, ... &#125;&#125;</code>, Dialog's{' '}
          <code>classNames=&#123;&#123; backdrop &#125;&#125;</code>, CodeBlock's{' '}
          <code>classNames=&#123;&#123; header, pre, line &#125;&#125;</code>. The part keys are
          typed — unknown keys are compile errors, no silent ignores. <code>root</code> is not a
          valid key — use <code>class</code> for the root (one spelling per concept).
        </li>
        <li>
          <strong>Render slots.</strong> Components with structural variability (Combobox,
          CodeBlock, Toast) expose render-function props (<code>renderOption</code>,{' '}
          <code>renderEmpty</code>, <code>headerSlot</code>) so consumers replace per-item content
          without rebuilding the surrounding behavior (keyboard nav, popover wiring, a11y
          attributes).
        </li>
      </ol>
      <p>
        What we deliberately don't have: Radix-style <code>asChild</code> polymorphism (NN#2 — typed
        slot props instead) and the copy-paste-shadcn model (NN#1 — components are imported, not
        pasted). See{' '}
        <a href="https://github.com/anthropics/place-ts/blob/main/docs/decisions/0016-design-library-as-package.md">
          ADR 0016
        </a>{' '}
        for the rationale.
      </p>

      <h2>Install</h2>
      <CodeBlock code={INSTALL} lang="bash" />

      <h2>Wire the library's styles</h2>
      <p>
        The library ships a small Tailwind input file for things utility classes can't express
        (currently the Dialog's <code>@starting-style</code> transitions). Pass it to{' '}
        <code>app()</code>'s <code>styles</code> option — a string array, one entry per layer:
      </p>
      <CodeBlock code={STYLES_WIRING} />

      <h2>
        <code>Button</code>
      </h2>
      <CodeBlock code={BUTTON_EX} />
      <div class="flex items-center gap-3 my-4">
        {Button({ intent: 'primary', children: 'Save' })}
        {Button({ intent: 'secondary', children: 'Cancel' })}
        {Button({ intent: 'ghost', children: 'Skip' })}
        {Button({ intent: 'destructive', children: 'Delete' })}
      </div>

      <h2>
        <code>Field</code> / <code>Input</code> / <code>Textarea</code>
      </h2>
      <CodeBlock code={FIELD_EX} />

      <h2>
        <code>Dialog</code>
      </h2>
      <CodeBlock code={DIALOG_EX} />

      <h2>
        <code>Sheet</code>
      </h2>
      <p>
        Edge-anchored drawer for filter sidebars, mobile-nav drawers, quick-edit panels,
        notification streams. Same native foundation as <code>Dialog</code> (
        <code>&lt;dialog&gt;</code> + <code>showModal()</code>) — top-layer rendering, focus trap,{' '}
        <code>Esc</code>-to-close, <code>::backdrop</code> overlay. The variant ladder (
        <code>side</code> + <code>size</code>) is the only difference at the API level.
      </p>
      <CodeBlock code={SHEET_EX} />

      <h2>
        <code>Combobox</code>
      </h2>
      <p>
        Typeahead select with filter + WAI-ARIA Combobox v1.2 keyboard nav. Generic over the option
        value type — selection returns the original <code>T</code>, not a stringified ID.{' '}
        <code>options</code> and <code>value</code> are both reactive-or-static; the default
        case-insensitive label filter is overrideable via <code>filter</code>. Ships with a chevron
        indicator, a clear (×) button, and a checkmark on the selected row.
      </p>
      <CodeBlock code={COMBOBOX_EX} />

      <p>
        Customization hooks — every visual surface (input class, popover class, option class, left
        icon, chevron, clear button), every render slot (<code>renderOption</code>,{' '}
        <code>renderEmpty</code>), the filter, and the size variant are all exposed. No need to fork
        the source.
      </p>
      <CodeBlock code={COMBOBOX_CUSTOM} />

      <p>
        Both primitives, live. The first Combobox (inside the Sheet) uses the defaults; the second
        uses <code>leftIcon</code> + <code>renderOption</code> to show emoji-prefixed rows:
      </p>
      <SheetComboboxDemo />

      <h2>
        <code>Toast</code> + <code>toast()</code>
      </h2>
      <CodeBlock code={TOAST_EX} />

      <h2>
        <code>Tooltip</code>
      </h2>
      <CodeBlock code={TOOLTIP_EX} />

      <h2>
        <code>Menu</code>
      </h2>
      <CodeBlock code={MENU_EX} />

      <h2>
        <code>Disclosure</code>
      </h2>
      <p>
        Collapsible content built on native <code>&lt;details&gt;</code> +{' '}
        <code>&lt;summary&gt;</code>. Browser owns the open / close state and keyboard activation;
        exclusive accordions work via the native <code>name</code> attribute (no JS coordinator).
        Height animates to / from <code>auto</code> via <code>interpolate-size</code> +{' '}
        <code>::details-content</code> on modern browsers; older browsers get instant open / close.
      </p>
      <CodeBlock code={DISCLOSURE_EX} />

      <h2>
        <code>ThemeToggle</code>
      </h2>
      <p>
        Drop-in segmented or cycle control for the framework's theme system. A thin wrapper over
        <code>useTheme()</code> from <code>@place-ts/component</code> — reads the
        <code>place-theme</code> cookie via the framework's early-paint stash, dispatches
        cross-island sync events, and accepts a small but complete prop surface for presentation
        tweaks. Drop one tier (use <code>useTheme()</code> directly) for full BYO-UI.
      </p>
      <CodeBlock code={THEME_TOGGLE_EX} />

      <p>Prop surface — everything below is optional:</p>
      <CodeBlock code={THEME_TOGGLE_PROPS} />

      <p>
        Live (the toggle in the header of this docs site uses this component). The 'segmented'
        variant renders three buttons (System · Light · Dark); 'cycle' renders one button advancing
        through the modes. Customization beyond the prop surface drops one tier to{' '}
        <code>useTheme()</code> — see the <Link to="/recipes/theming">Theming &amp; dark mode</Link>{' '}
        recipe for the four-tier customization ladder.
      </p>

      <h2>
        <code>CodeBlock</code>
      </h2>
      <p>
        Syntax-highlighted code with a pluggable tokenizer, line numbers, line highlights, diff
        mode, and every visual axis controlled by typed variants. Pure SSR — no island bundle. The
        copy button uses a single inline runtime emitted once per page (~250 B raw, dedupes at gzip
        across multiple blocks).
      </p>
      <CodeBlock code={CODEBLOCK_EX} />

      <p>
        Customization for the long tail: token colors via CSS variables, per-instance tokenizers, or
        globally registered languages.
      </p>
      <CodeBlock code={CODEBLOCK_CUSTOM} />

      <p>Slot composition for cases where the default header isn't the right shape.</p>
      <CodeBlock code={CODEBLOCK_SLOT} />

      <p>Live example with line numbers + highlights + a custom slot:</p>
      <CodeBlock
        code={`function fib(n: number): number {
  if (n < 2) return n
  return fib(n - 1) + fib(n - 2)
}

console.log(fib(10))  // 55`}
        lang="ts"
        filename="fib.ts"
        lineNumbers
        highlightLines={[[2, 3]]}
      />

      <h2>
        Presentational: <code>Avatar</code>, <code>Badge</code>, <code>Card</code>
      </h2>
      <CodeBlock code={PRESENTATIONAL} />

      <div class="grid grid-cols-3 gap-4 my-4">
        {Card({ intent: 'flat', padding: 'md', children: 'Flat card' })}
        {Card({ intent: 'raised', padding: 'md', children: 'Raised card' })}
        {Card({ intent: 'accent', padding: 'md', children: 'Accent card' })}
      </div>

      <p>Card supports named slots — same pattern as Dialog / Sheet:</p>
      <div class="my-4">
        {Card({
          intent: 'raised',
          padding: 'none',
          children: [
            Card.Header({ children: <strong>Card with slots</strong> }),
            Card.Body({
              children:
                'Header / Body / Footer carry their own padding + borders. Use `padding="none"` on the Card itself so the slots own the rhythm.',
            }),
            Card.Footer({ children: <span class="text-xs text-muted">Tier 17-E v2</span> }),
          ],
        })}
      </div>

      <h2>Native primitives in use</h2>
      <ul>
        <li>
          <strong>Dialog</strong> — <code>&lt;dialog&gt; + .showModal()</code> + the{' '}
          <code>:modal</code> pseudo-class
        </li>
        <li>
          <strong>Toast / Tooltip / Menu</strong> — <code>popover="manual"</code> /{' '}
          <code>popover="auto"</code> top-layer rendering
        </li>
        <li>
          <strong>Field</strong> — <code>:user-invalid</code> / <code>:user-valid</code> (validates
          only after interaction)
        </li>
        <li>
          <strong>Dialog transitions</strong> — <code>@starting-style</code> +{' '}
          <code>transition-behavior: allow-discrete</code>
        </li>
        <li>
          <strong>Button spinner</strong> — <code>animate()</code> from{' '}
          <Link to="/api/motion">
            <code>@place-ts/reactivity/motion</code>
          </Link>
        </li>
      </ul>

      <h2>Related</h2>
      <ul>
        <li>
          <Link to="/api/motion">
            <code>motion</code> — composes with design components for interactive feel
          </Link>
        </li>
      </ul>
    </article>
  ),
})
