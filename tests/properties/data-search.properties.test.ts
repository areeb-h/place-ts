// Property-based tests for @place-ts/data + @place-ts/search.
//
// Both systems are small and value-typed, so the property surface is
// modest — but the invariants that matter (collection CRUD round-trip,
// search returns subset, query tokenisation) benefit from random-input
// coverage anyway.

import * as fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { collection } from '../../systems/data/src/index.ts'
import { state } from '../../systems/reactivity/src/index.ts'
import { searchable } from '../../systems/search/src/index.ts'

interface Item {
  readonly id: string
  readonly title: string
  readonly tags: readonly string[]
}

// Safe id arbitrary — non-empty, unique-able via a Set.
const idArb = fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.length > 0)

const itemArb: fc.Arbitrary<Item> = fc.record({
  id: idArb,
  title: fc.string({ minLength: 0, maxLength: 24 }),
  tags: fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 0, maxLength: 4 }),
})

// Unique-by-id sequence of items so add() doesn't collide.
const uniqueItemsArb = fc
  .array(itemArb, { minLength: 1, maxLength: 8 })
  .map((items) => {
    const seen = new Set<string>()
    return items.filter((it) => {
      if (seen.has(it.id)) return false
      seen.add(it.id)
      return true
    })
  })
  .filter((items) => items.length > 0)

// ─── @place-ts/data ──────────────────────────────────────────────────────

describe('data — property: collection invariants', () => {
  test('add(item) then get(id) returns item; size grows by 1', () => {
    fc.assert(
      fc.property(uniqueItemsArb, (items) => {
        const s = state<Item[]>([])
        const c = collection<Item>(s)
        for (const it of items) c.add(it)
        for (const it of items) {
          expect(c.get(it.id)).toBe(it)
        }
        expect(c.all().length).toBe(items.length)
      }),
      { numRuns: 30 },
    )
  })

  test('remove(id) removes exactly one entry; get(id) returns null after', () => {
    fc.assert(
      fc.property(uniqueItemsArb, (items) => {
        const s = state<Item[]>([])
        const c = collection<Item>(s)
        for (const it of items) c.add(it)
        const toRemove = items[0] as Item
        c.remove(toRemove.id)
        expect(c.get(toRemove.id)).toBeNull()
        expect(c.all().length).toBe(items.length - 1)
        // Others are untouched.
        for (let i = 1; i < items.length; i++) {
          const other = items[i] as Item
          expect(c.get(other.id)).toBe(other)
        }
      }),
      { numRuns: 30 },
    )
  })

  test('update(id, partial) merges fields and keeps id stable', () => {
    fc.assert(
      fc.property(uniqueItemsArb, fc.string({ minLength: 0, maxLength: 20 }), (items, newTitle) => {
        const s = state<Item[]>([])
        const c = collection<Item>(s)
        for (const it of items) c.add(it)
        const target = items[0] as Item
        c.update(target.id, { title: newTitle })
        const after = c.get(target.id)
        expect(after).not.toBeNull()
        expect((after as Item).id).toBe(target.id) // id stable
        expect((after as Item).title).toBe(newTitle) // patched field updated
        expect((after as Item).tags).toEqual(target.tags) // unrelated fields unchanged
      }),
      { numRuns: 30 },
    )
  })

  test('add with duplicate id throws', () => {
    fc.assert(
      fc.property(itemArb, (it) => {
        const s = state<Item[]>([])
        const c = collection<Item>(s)
        c.add(it)
        expect(() => c.add(it)).toThrow()
      }),
      { numRuns: 20 },
    )
  })
})

// ─── @place-ts/search ────────────────────────────────────────────────────

describe('search — property: searchable invariants', () => {
  test('empty query returns the full list unchanged', () => {
    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 6 }), (items) => {
        const filter = searchable<Item>(() => items, { fields: (it) => [it.title, ...it.tags] })(
          () => '',
        )
        expect(filter()).toBe(items)
      }),
      { numRuns: 30 },
    )
  })

  test('search results are always a subset of the input', () => {
    fc.assert(
      fc.property(
        fc.array(itemArb, { minLength: 1, maxLength: 8 }),
        fc.string({ minLength: 0, maxLength: 12 }),
        (items, query) => {
          const filter = searchable<Item>(() => items, { fields: (it) => [it.title, ...it.tags] })(
            () => query,
          )
          const out = filter()
          // Every output item must be `===` to an input item (no fresh objects).
          for (const o of out) expect(items).toContain(o)
        },
      ),
      { numRuns: 40 },
    )
  })

  test('case-insensitive by default — uppercased query matches lowercased fields', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 3, maxLength: 8 }).filter((s) => /^[a-z]+$/.test(s)),
        (token) => {
          // Picking a marker disjoint from any English-letter token —
          // emoji + digits avoid substring collisions with `token`.
          const distractor = '999🦊999'
          const items: Item[] = [
            { id: '1', title: token, tags: [] },
            { id: '2', title: distractor, tags: [] },
          ]
          const filter = searchable<Item>(() => items, { fields: (it) => [it.title] })(() =>
            token.toUpperCase(),
          )
          const out = filter()
          expect(out.map((i) => i.id)).toContain('1')
          expect(out.map((i) => i.id)).not.toContain('2')
        },
      ),
      { numRuns: 30 },
    )
  })

  test('every token must match (AND semantics)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 2, maxLength: 6 }).filter((s) => /^[a-z]+$/.test(s)),
        fc.string({ minLength: 2, maxLength: 6 }).filter((s) => /^[a-z]+$/.test(s)),
        (a, b) => {
          // Skip cases where one token is a substring of the other —
          // the AND-semantics test relies on independent presence.
          if (a === b || a.includes(b) || b.includes(a)) return
          // Disjoint distractor for "matches neither" — emoji + digits
          // share no letters with the generated [a-z]+ tokens.
          const distractor = '999🦊999'
          const items: Item[] = [
            { id: 'both', title: `${a} ${b}`, tags: [] },
            { id: 'just-a', title: a, tags: [] },
            { id: 'just-b', title: b, tags: [] },
            { id: 'neither', title: distractor, tags: [] },
          ]
          const filter = searchable<Item>(() => items, { fields: (it) => [it.title] })(
            () => `${a} ${b}`,
          )
          const out = filter()
          expect(out.map((i) => i.id)).toEqual(['both'])
        },
      ),
      { numRuns: 30 },
    )
  })
})
