import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Mirror the `paths` entries in `tsconfig.json` so root-level test files
// (`tests/conformance/**`) can use the same `@place/<name>` specifiers
// the rest of the codebase uses. Workspace packages (`systems/*`,
// `examples/*`, `tools/*`) resolve through their own `node_modules`
// symlinks; the root has no `node_modules/@place` link, so we wire it
// here explicitly. Keep this list in sync with `tsconfig.json#paths`.
const r = (p: string): string => resolve(import.meta.dirname, p)
const alias: Record<string, string> = {
  '@place/reactivity/motion': r('./systems/reactivity/src/motion/index.ts'),
  '@place/reactivity/effects': r('./systems/reactivity/src/effects.ts'),
  '@place/reactivity': r('./systems/reactivity/src/index.ts'),
  '@place/capability': r('./systems/capability/src/index.ts'),
  '@place/routing': r('./systems/routing/src/index.ts'),
  '@place/component/auto-import-plugin': r('./systems/component/src/auto-import-plugin.ts'),
  '@place/component/jsx-runtime': r('./systems/component/src/jsx-runtime.ts'),
  '@place/component/jsx-dev-runtime': r('./systems/component/src/jsx-runtime.ts'),
  '@place/component/client': r('./systems/component/src/client.ts'),
  '@place/component/server': r('./systems/component/src/server.ts'),
  '@place/component/islands': r('./systems/component/src/islands.ts'),
  '@place/component/build': r('./systems/component/src/build.ts'),
  '@place/component/internal': r('./systems/component/src/internal.ts'),
  '@place/component/tailwind': r('./systems/component/src/tailwind.ts'),
  '@place/component': r('./systems/component/src/index.ts'),
  '@place/data': r('./systems/data/src/index.ts'),
  '@place/persistence': r('./systems/persistence/src/index.ts'),
  '@place/search': r('./systems/search/src/index.ts'),
  '@place/security': r('./systems/security/src/index.ts'),
  '@place/design': r('./systems/design/src/index.ts'),
  '@place/devtools': r('./systems/devtools/src/index.ts'),
}

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['systems/**/tests/**/*.test.ts', 'tests/**/*.test.ts', 'tools/**/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/benchmark/**'],
    typecheck: {
      enabled: false,
    },
    coverage: {
      provider: 'v8',
      include: ['systems/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/dist/**'],
      reporter: ['text', 'html'],
    },
  },
})
