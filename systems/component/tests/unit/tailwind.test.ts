// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { tailwind } from '../../src/tailwind.ts'

// tailwind() is a thin wrapper around @tailwindcss/node + @tailwindcss/oxide.
// We don't re-test Tailwind itself; we verify the contract:
//   - returns { inline: string }
//   - the inline CSS is non-empty (Tailwind produced something)
//   - classes from `content` files appear as utilities in the output
// Scratch dir lives INSIDE the workspace (so `tailwindcss` resolves
// from the workspace's node_modules) — temp dirs outside the project
// can't resolve the package.

const ROOT = join(__dirname, '../../../..')

let dir: string

beforeAll(async () => {
  // Place the scratch dir inside the repo so node module resolution
  // walks up to the workspace root's node_modules.
  dir = await mkdtemp(join(ROOT, 'node_modules/.place-tw-'))
  await writeFile(
    join(dir, 'page.tsx'),
    `export const x = (
      <div class="flex items-center gap-4 p-4 text-red-500">hi</div>
    )`,
  )
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('tailwind() — Tailwind v4 integration', () => {
  test('returns { inline: <css> } for the default base', async () => {
    const result = await tailwind({ content: [`${dir}/**/*.tsx`] })
    expect(typeof result.inline).toBe('string')
    expect(result.inline.length).toBeGreaterThan(0)
  })

  test('emits utility rules for classes found in the scanned content', async () => {
    const { inline } = await tailwind({ content: [`${dir}/**/*.tsx`] })
    // Tailwind v4 emits `.flex { display: flex }` and similar — the
    // exact rule shape is its concern, but the selector must appear.
    expect(inline).toMatch(/\.flex\s*{/)
    expect(inline).toMatch(/\.items-center\s*{/)
    expect(inline).toMatch(/\.p-4\s*{/)
    expect(inline).toMatch(/\.text-red-500\s*{/)
  })

  test('custom base CSS is honored (raw rules pass through)', async () => {
    const { inline } = await tailwind({
      content: [`${dir}/**/*.tsx`],
      // A literal CSS rule in the base must appear verbatim — proves the
      // custom base is the entry, not silently dropped.
      base: '@import "tailwindcss";\n.my-custom-rule { color: rebeccapurple; }',
    })
    expect(inline).toContain('.my-custom-rule')
    expect(inline).toContain('rebeccapurple')
  })
})
