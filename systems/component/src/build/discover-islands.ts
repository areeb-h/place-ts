// Filesystem-based island discovery (T5-D phase 2 DX).
//
// Scans a directory for `.tsx` / `.ts` / `.jsx` / `.js` files whose
// default export is an `island()`-wrapped component, and assembles a
// registry the framework's `serve()` can pass to the bundler.
//
// Removes the per-island `import` + `islands: [counter, ...]`
// boilerplate from `app.ts`. The user writes one config line:
//
//   app({ islandsDir: './src/islands' })
//
// Then any `.tsx` file added to `src/islands/` is auto-registered.
//
// Files prefixed with `_` are skipped — convention for private
// modules (cross-island shared state, helpers, the `_init.ts` cap
// installer, etc.). This matches the existing docs site's convention
// (`_mobile-nav-state.ts`, `_search-state.ts`, `_init.ts`).
//
// Dynamic-imported by `_serveImpl` so the `node:fs` dep stays out of
// any module that might transitively reach a client bundle.

import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
  IslandRegistration,
  IslandSsrPropsResolver,
} from '../index.ts'

const ISLAND_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'] as const

interface IslandLike {
  readonly __islandName?: unknown
  readonly __islandSrc?: unknown
  readonly __islandSsrProps?: unknown
}

export async function discoverIslands(
  dir: string,
): Promise<Readonly<Record<string, IslandRegistration>>> {
  const absDir = resolve(process.cwd(), dir)
  let entries: string[]
  try {
    entries = await readdir(absDir)
  } catch (e) {
    throw new Error(
      `discoverIslands: failed to read directory '${absDir}': ${
        e instanceof Error ? e.message : String(e)
      }. Pass an existing path via app({ islandsDir: '...' }).`,
    )
  }
  const out: Record<string, IslandRegistration> = {}
  for (const file of entries) {
    if (file.startsWith('_')) continue // private convention
    if (!ISLAND_EXTENSIONS.some((ext) => file.endsWith(ext))) continue
    const absPath = resolve(absDir, file)
    const mod = (await import(absPath)) as { default?: unknown }
    const def = mod.default
    if (typeof def !== 'function') {
      throw new Error(
        `discoverIslands: '${file}' has no default-exported function. ` +
          `Each island file must default-export an \`island(import.meta.url, fn)\` value.`,
      )
    }
    const island = def as IslandLike & ((...args: never[]) => unknown)
    if (
      typeof island.__islandName !== 'string' ||
      typeof island.__islandSrc !== 'string'
    ) {
      throw new Error(
        `discoverIslands: '${file}' default export is not an island. ` +
          `Wrap with \`island(import.meta.url, fn)\` so the framework knows the bundle source.`,
      )
    }
    const ssrProps = island.__islandSsrProps
    const base: IslandRegistration = {
      component: island as never,
      src: island.__islandSrc as string,
    }
    out[island.__islandName] =
      typeof ssrProps === 'function'
        ? {
            ...base,
            ssrProps: ssrProps as IslandSsrPropsResolver<Record<string, unknown>>,
          }
        : base
  }
  return out
}
