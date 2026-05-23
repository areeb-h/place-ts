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
const RESERVED_ISLAND_NAMES = ['__proto__', 'constructor', 'prototype'] as const

export function validateIslandName(name: string): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(
      `island: name must be a non-empty string (got ${typeof name}). ` +
        `The name is derived from the filename — e.g. './islands/theme-toggle.tsx' ` +
        `produces 'theme-toggle'. Did the source path end with an empty basename?`,
    )
  }
  if (name.length > 64) {
    throw new Error(
      `island: name '${name.slice(0, 32)}…' exceeds 64 chars (got ${name.length}). ` +
        `Rename the source file to something shorter — island names are derived ` +
        `from the filename and end up in HTML attributes, CSS selectors, and ` +
        `bundle URLs, where long names are noise.`,
    )
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    const offending = [...name].filter((c) => !/[a-zA-Z0-9_-]/.test(c))
    throw new Error(
      `island: name '${name}' contains invalid character(s) ` +
        `(${[...new Set(offending)].map((c) => `'${c}'`).join(', ')}). ` +
        `Use only letters, digits, '_', '-'. Example valid names: ` +
        `'theme-toggle', 'searchPalette', 'user_avatar'.`,
    )
  }
  if ((RESERVED_ISLAND_NAMES as readonly string[]).includes(name)) {
    throw new Error(
      `island: name '${name}' is reserved (cannot be one of: ` +
        `${RESERVED_ISLAND_NAMES.join(', ')}). These names collide with ` +
        `JavaScript object prototype lookups. Rename your source file.`,
    )
  }
}

/**
 * Validate the resolved source path. Reject relative segments that
 * escape the project root (`../../etc/passwd`-style paths) and
 * disallow non-absolute paths that could be re-rooted at the bundler.
 *
 * Two legitimate shapes get accepted:
 *
 *   1. **App-side** — the path starts with the project root `cwd`.
 *      This is the common case for islands the app authors itself.
 *
 *   2. **Framework / installed-dependency** — the path lives under a
 *      `node_modules/` segment, or resolves through a workspace symlink
 *      to a sibling package (e.g. `@place-ts/devtools/src/island.tsx`).
 *      We allow any absolute path that contains no `..` segments — Bun
 *      will fail to load the source if it doesn't actually exist, so
 *      the realistic attack surface is just `..` traversal, which the
 *      next-line check rejects.
 *
 * Called by the bundler ONLY (not the public API) — `cwd` is a
 * server-only concept. The function itself has no Node-only imports,
 * so importing it from server code is safe.
 */
export function validateIslandSrc(src: string, cwd: string): void {
  if (typeof src !== 'string' || src.length === 0) {
    throw new Error(`island: src must be a non-empty string (got ${typeof src})`)
  }
  // Reject path-traversal escapes regardless of where they originate.
  // A legitimate absolute path never needs `..` (it's already absolute).
  if (src.split('/').includes('..')) {
    throw new Error(
      `island: source path '${src}' contains a '..' segment. ` +
        `Pass an absolute path (e.g. \`import.meta.url\`).`,
    )
  }
  // Require absolute (`/`) or file-URL form. Relative paths could be
  // re-rooted at unexpected directories by the bundler.
  if (!src.startsWith('/') && !src.startsWith('file://')) {
    throw new Error(
      `island: source path '${src}' must be absolute. ` +
        `Use \`island(import.meta.url, fn)\` to capture the source automatically.`,
    )
  }
  // App-side islands (under the project tree) are the common case.
  // Framework / installed-dep islands live elsewhere — under
  // `node_modules/`, or via workspace symlinks resolving to sibling
  // package source. Both are accepted; the absolute-path + no-`..`
  // checks above already close the traversal attack.
  void cwd
}
