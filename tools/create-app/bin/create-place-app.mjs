#!/usr/bin/env bun
// Shim entry. npm strips bin paths with .ts extensions during publish,
// so the actual implementation lives in ../src/cli.ts and we route to
// it from this .mjs file. Bun resolves the .ts import natively.
//
// We import { main } explicitly (not just the module side-effect) so
// the CLI runs regardless of whether `import.meta.main` is true on the
// .ts module — under the shim, the shim is the entry, not cli.ts.
import { main } from '../src/cli.ts'

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`unexpected error: ${err?.stack ?? err}\n`)
    process.exit(1)
  },
)
