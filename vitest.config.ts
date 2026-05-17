import { defineConfig } from 'vitest/config'

export default defineConfig({
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
