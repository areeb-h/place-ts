// biome-ignore-all assist/source/organizeImports: documented re-export groupings (lib stylesheet, primitives, library exports) must stay in source order
// @place-ts/design — opinionated component library.
//
// Re-exports the framework's design primitives (recipe, cls,
// themeTokens) so apps that already use the design library don't need
// to import from two places. The library is the design system; the
// framework primitives are its building blocks.

export { cls, recipe, themeTokens } from '@place-ts/component'

// ===== Library stylesheet =====
//
// Tiny CSS string (Tailwind v4 input) for things utility classes can't
// express — currently the Dialog's @starting-style transitions. Wire
// it via `app({ styles: designStyles + … })` in your app entry.
export { styles } from './styles.ts'

// ===== Components =====

export { Button, type ButtonProps, type ButtonIntent, type ButtonSize } from './Button.tsx'
export {
  Field,
  type FieldPart,
  type FieldProps,
  Input,
  type InputProps,
  type InputSize,
  Textarea,
  type TextareaProps,
} from './Field.tsx'
export { Dialog, type DialogPart, type DialogProps, type DialogSize } from './Dialog.tsx'
export {
  Sheet,
  type SheetPart,
  type SheetProps,
  type SheetSide,
  type SheetSize,
} from './Sheet.tsx'
export {
  Combobox,
  type ComboboxItemState,
  type ComboboxOption,
  type ComboboxProps,
  type ComboboxSize,
} from './Combobox.tsx'
export {
  Toaster,
  type ToasterPart,
  type ToasterProps,
  toast,
  type ToastKind,
  type ToastOptions,
  _clearToastsForTest,
} from './Toast.tsx'
export { Tooltip, type TooltipProps, type TooltipPlacement } from './Tooltip.tsx'
export {
  Menu,
  type MenuPart,
  type MenuProps,
  type MenuItem,
  type MenuPlacement,
} from './Menu.tsx'
export {
  Avatar,
  type AvatarProps,
  type AvatarSize,
  Badge,
  type BadgeProps,
  type BadgeIntent,
  type BadgeSize,
  Card,
  type CardProps,
  type CardIntent,
  type CardPadding,
} from './presentational.tsx'
export { Copy, type CopyProps } from './Copy.tsx'
export { Prose, type ProseProps } from './Prose.tsx'
export {
  Disclosure,
  type DisclosureIntent,
  type DisclosurePart,
  type DisclosureProps,
  type DisclosureSize,
} from './Disclosure.tsx'
export {
  CodeBlock,
  type CodeBlockPart,
  type CodeBlockProps,
  type CodeBlockDensity,
  type CodeBlockRadius,
  type CodeBlockTheme,
  type CodeBlockChrome,
  type CodeBlockWrap,
  type LineRange,
  registerLanguage,
  knownLanguages,
  getTokenizer,
  tokenizeTs,
  tokenizeShell,
  tokenizeJson,
  tokenizeCss,
  tokenizeHtml,
  tokenizePython,
  tokenizePlain,
  type Tok,
  type TokKind,
  type Tokenizer,
} from './CodeBlock.tsx'
