// Island input validation — shared by the public `island()` factory,
// the `<Island>` SSR primitive, AND the server-only island-bundler.
//
// Lives in a tiny standalone module (not in `build/`) so the public API
// can import the validators WITHOUT transitively pulling in any server-
// only code (e.g. `node:path` from the bundler). This was a T5-E
// finding: ~5 KB raw of build/runtime code was leaking into per-island
// client bundles because the public `island()` factory imported from
// `build/island-bundler.ts`. Splitting the validators out closes the
// leak — `__PLACE_BROWSER__` DCE keeps the bundler entirely server-side.

/**
 * Island names appear in:
 *   - HTML attribute values (escaped before insertion)
 *   - CSS attribute selectors (used at query time)
 *   - Bundle URLs (passed through to the file-system)
 *   - JS string literals (in the auto-mount template)
 *
 * Restrict to ASCII alphanumerics + `_` + `-` so no escape pass can be
 * fooled by edge cases. Also reject prototype-pollution sentinel names.
 * Validation runs at:
 *   1. `island()` factory time (strict — fails if filename has unsafe chars)
 *   2. `<Island>` render time (defense-in-depth)
 *   3. Island-bundler build time (defense-in-depth)
 */
export function validateIslandName(name: string): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`island: name must be a non-empty string (got ${typeof name})`)
  }
  if (name.length > 64) {
    throw new Error(`island: name exceeds 64 chars (got ${name.length})`)
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `island: name '${name}' contains invalid characters. Use only ` +
        `letters, digits, '_', '-'.`,
    )
  }
  if (name === '__proto__' || name === 'constructor' || name === 'prototype') {
    throw new Error(`island: name '${name}' is reserved.`)
  }
}

/**
 * Validate the resolved source path. Reject relative segments that
 * escape the project root (`../../etc/passwd`-style paths).
 *
 * Called by the bundler ONLY (not the public API) — `cwd` is a
 * server-only concept. The function itself has no Node-only imports,
 * so importing it from server code is safe.
 */
export function validateIslandSrc(src: string, cwd: string): void {
  if (typeof src !== 'string' || src.length === 0) {
    throw new Error(`island: src must be a non-empty string (got ${typeof src})`)
  }
  if (!src.startsWith(cwd)) {
    throw new Error(
      `island: source path '${src}' escapes project root ('${cwd}'). ` +
        `Island modules must live under the project tree.`,
    )
  }
}
