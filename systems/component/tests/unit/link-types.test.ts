// @vitest-environment node
//
// Type-only tests for `<Link to>` path-typing via `PlaceRoutes` module
// augmentation. These run under vitest's `runIfTypecheckEnabled` mode
// (`.test-d.ts` suffix) and assert TS-level constraints, not runtime.
//
// We don't augment `PlaceRoutes` in this file — the empty default
// interface means `RouteKey` falls back to `string`, so any string
// literal is accepted. Apps that augment will see narrowed types in
// their own files; verifying that path requires a separate fixture
// file with its own augmentation block (covered in commonplace's
// browser-verify step from the plan).

import { describe, expectTypeOf, test } from 'vitest'
import type { ExternalHref, LinkProps, RouteKey } from '../../src/index.ts'

describe('LinkProps types — without PlaceRoutes augmentation', () => {
  test('RouteKey falls back to string when PlaceRoutes is not augmented', () => {
    expectTypeOf<RouteKey>().toEqualTypeOf<string>()
  })

  test('LinkProps.to accepts arbitrary strings (no augmentation)', () => {
    // `to` is `RouteKey | ExternalHref` — when RouteKey is string, the
    // union is just string for practical purposes. This compiles.
    const props: LinkProps = { to: '/anything', children: 'x' }
    expectTypeOf(props.to).toEqualTypeOf<RouteKey | ExternalHref>()
    expectTypeOf<LinkProps['to']>().toBeString()
  })

  test('ExternalHref includes the standard external schemes', () => {
    expectTypeOf<'http://x.com/foo'>().toMatchTypeOf<ExternalHref>()
    expectTypeOf<'https://x.com/foo'>().toMatchTypeOf<ExternalHref>()
    expectTypeOf<'//cdn.x.com/foo'>().toMatchTypeOf<ExternalHref>()
    expectTypeOf<'mailto:hello@example.com'>().toMatchTypeOf<ExternalHref>()
    expectTypeOf<'tel:+1234'>().toMatchTypeOf<ExternalHref>()
    expectTypeOf<'sms:+1234'>().toMatchTypeOf<ExternalHref>()
    expectTypeOf<'#section'>().toMatchTypeOf<ExternalHref>()
  })
})
