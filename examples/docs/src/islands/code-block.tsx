// Code-block island wrapper. The component lives in
// `../components/code-block.tsx` but its copy-to-clipboard interactivity
// (the `onClick` + reactive "copied" state) needs JS to fire, so it has
// to ship as an island. SSR still renders the syntax-highlighted output;
// the island bundle just attaches the click handler + reactive label
// swap.
//
// Keeping the markup + tokenizer in `components/` (and re-wrapping here)
// lets the same module be useful from places that don't need
// interactivity (e.g. server-only print views, future SSG snapshots) —
// the island is the consumer's choice, not the component's.

// `view` auto-imported via the @place-ts/component plugin.
import { CodeBlock as CodeBlockImpl, type CodeBlockProps } from '../components/code-block.tsx'

const CodeBlockIsland = view<CodeBlockProps & Record<string, unknown>>(CodeBlockImpl)

// Re-export with the original name so consumers only have to swap the
// IMPORT PATH (`components/` → `islands/`) without renaming bindings.
export { CodeBlockIsland as CodeBlock }
export default CodeBlockIsland
