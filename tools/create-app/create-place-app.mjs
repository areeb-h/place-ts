#!/usr/bin/env bun
// Shim entry. npm publish strips bin entries whose paths contain
// subdirectories or `.ts` extensions, so the executable shim sits at
// the package root with a `.mjs` extension; the actual implementation
// lives in `./src/cli.ts` and bun resolves the .ts import natively.
//
// We import { main } explicitly (not just the module side-effect) so
// the CLI runs regardless of whether `import.meta.main` is true on the
// .ts module — under the shim, the shim is the entry, not cli.ts.
import { main } from './src/cli.ts'

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`unexpected error: ${err?.stack ?? err}\n`)
    process.exit(1)
  },
)
