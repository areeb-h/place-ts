// Smoke test — verifies the app entry can be imported without
// throwing. Replace with real tests against your pages/islands.

import { describe, expect, it } from 'vitest'

describe('__APP_NAME__', () => {
  it('imports app.ts cleanly', async () => {
    // Dynamic import so the file is evaluated under test (catches
    // module-level errors like missing layouts / theme misconfigs).
    const mod = await import('../app.ts')
    expect(mod).toBeTruthy()
  })
})
