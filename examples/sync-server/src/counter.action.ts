// Demo action: increment a counter stored in bun:sqlite. Demonstrates
// the FULL security stack place-ts ships for action() out of the box:
//
//   1. **Same-origin enforcement** (default-on for POST). A cross-origin
//      POST to this endpoint with the user's cookies — the classic CSRF
//      attack — gets a 403 before fn() runs.
//   2. **Body size limit** (1 MB default; tightened to 256 here because
//      the input is tiny). DoS prevention.
//   3. **Prototype-pollution guard** (always on). A body with
//      `__proto__` keys → 400.
//   4. **Signed CSRF token** (opt-in via `csrf:`). Bound to the user's
//      session ID via the existing `csrfSigner` from server.tsx. A
//      replayed token from another session → 403.
//
// **Bundling note**: this file is imported by `actions.page.tsx`, which
// is imported by `client.tsx` (the browser bundle). The action() itself
// is safe to ship to the browser — it carries the path + input schema,
// which `action.call()` needs. But `bun:sqlite` and the secret are
// SERVER-ONLY. We lazy-import them inside `fn()` and the audience
// callback so Bun.build doesn't try to resolve them for the browser
// target. Static imports here would error at build time.
//
// Pattern: keep the `action()` definition statically importable; defer
// every server-only resource via `await import(...)` at call time.

import { action, shape } from '@place/component'

// Helpers for read/CSRF live in a server-only module the action lazy-
// imports. Browser bundles never reach this module's body.
const SERVER_HELPERS_PATH = './counter.server.ts'

export const incrementCounter = action({
  path: 'POST /api/counter/increment',
  // Tiny bound — the input is one number; reject anything larger as DoS.
  maxBodyBytes: 256,
  // Same-origin is on by default for POST. Stating it explicitly to
  // make the security posture readable at the call site.
  sameOrigin: true,
  // CSRF verify — opt-in. The audience is the user ID from the session
  // cookie (or 'anon' for unauthenticated visitors). Lazy-imported.
  csrf: {
    audience: async (req) => {
      const { audienceFromRequest } = await import(SERVER_HELPERS_PATH)
      return audienceFromRequest(req)
    },
    verify: async (token, audience) => {
      const { verifyCsrf } = await import(SERVER_HELPERS_PATH)
      return verifyCsrf(token, audience)
    },
  },
  input: shape({ by: 'number' }),
  fn: async ({ by }: { by: number }) => {
    if (by < 1 || by > 100 || !Number.isInteger(by)) {
      throw new Error('by must be an integer between 1 and 100')
    }
    const { incrementBy } = await import(SERVER_HELPERS_PATH)
    return incrementBy(by)
  },
})
