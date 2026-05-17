// Re-export from the generic location. The runtime lives at the
// design library's top level now (`__copy-runtime.ts`) because it
// powers both `<Copy>` and `<CodeBlock>`. This file is kept as an
// import alias so the existing `CodeBlock.tsx` import path keeps
// working without churn — small bridge file, removable once the
// next CodeBlock cleanup pass renames the import.

export { placeCodeBlockCopy, placeCopyRuntime } from '../__copy-runtime.ts'
