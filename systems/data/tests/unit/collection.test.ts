import { describe, expect, test } from 'vitest'
import { state, watch } from '../../../reactivity/src/index.ts'
import { collection } from '../../src/index.ts'

interface Item {
  id: string
  name: string
  count: number
}

describe('collection — keyed CRUD over a State<T[]>', () => {
  test('add appends and get retrieves by id', () => {
    const s = state<Item[]>([])
    const c = collection<Item>(s)
    c.add({ id: 'a', name: 'first', count: 1 })
    c.add({ id: 'b', name: 'second', count: 2 })
    expect(c.get('a')).toEqual({ id: 'a', name: 'first', count: 1 })
    expect(c.get('b')?.name).toBe('second')
    expect(c.get('missing')).toBeNull()
  })

  test('update merges patch into the matched item', () => {
    const s = state<Item[]>([{ id: 'a', name: 'first', count: 1 }])
    const c = collection<Item>(s)
    c.update('a', { count: 99 })
    expect(c.get('a')).toEqual({ id: 'a', name: 'first', count: 99 })
  })

  test('update no-ops when the key is absent', () => {
    const s = state<Item[]>([{ id: 'a', name: 'first', count: 1 }])
    const c = collection<Item>(s)
    c.update('missing', { count: 99 })
    expect(c.all()).toEqual([{ id: 'a', name: 'first', count: 1 }])
  })

  test('remove drops the item and is idempotent', () => {
    const s = state<Item[]>([
      { id: 'a', name: 'first', count: 1 },
      { id: 'b', name: 'second', count: 2 },
    ])
    const c = collection<Item>(s)
    c.remove('a')
    expect(c.get('a')).toBeNull()
    expect(c.all()).toHaveLength(1)
    c.remove('a') // already gone — no throw
    expect(c.all()).toHaveLength(1)
  })

  test('all returns insertion order without sortBy', () => {
    const s = state<Item[]>([])
    const c = collection<Item>(s)
    c.add({ id: 'a', name: 'first', count: 1 })
    c.add({ id: 'b', name: 'second', count: 2 })
    c.add({ id: 'c', name: 'third', count: 3 })
    expect(c.all().map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  test('all returns sorted order when sortBy is provided', () => {
    const s = state<Item[]>([])
    const c = collection<Item>(s, { sortBy: (a, b) => b.count - a.count })
    c.add({ id: 'a', name: 'first', count: 1 })
    c.add({ id: 'b', name: 'second', count: 5 })
    c.add({ id: 'c', name: 'third', count: 3 })
    expect(c.all().map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  test('all returns a fresh array — caller mutation does not leak', () => {
    const s = state<Item[]>([{ id: 'a', name: 'first', count: 1 }])
    const c = collection<Item>(s, { sortBy: (a, b) => a.id.localeCompare(b.id) })
    const list = c.all() as Item[]
    list.push({ id: 'sneaky', name: 'mutation', count: 0 })
    // Underlying state untouched.
    expect(c.all()).toHaveLength(1)
    expect(c.get('sneaky')).toBeNull()
  })

  test('reactive: all() re-fires on add/update/remove', () => {
    const s = state<Item[]>([])
    const c = collection<Item>(s)
    let observed: number = -1
    const stop = watch(() => {
      observed = c.all().length
    })
    expect(observed).toBe(0)
    c.add({ id: 'a', name: 'first', count: 1 })
    expect(observed).toBe(1)
    c.update('a', { count: 2 })
    expect(observed).toBe(1) // length unchanged but watch re-fires
    c.remove('a')
    expect(observed).toBe(0)
    stop()
  })

  test('reactive: get() re-fires when the matched item changes', () => {
    const s = state<Item[]>([{ id: 'a', name: 'first', count: 1 }])
    const c = collection<Item>(s)
    let observed: Item | null = null
    const stop = watch(() => {
      observed = c.get('a')
    })
    expect(observed).toEqual({ id: 'a', name: 'first', count: 1 })
    c.update('a', { count: 99 })
    expect(observed).toEqual({ id: 'a', name: 'first', count: 99 })
    c.remove('a')
    expect(observed).toBeNull()
    stop()
  })

  test('custom id extractor for non-id keyed entities', () => {
    interface User {
      uuid: string
      email: string
    }
    const s = state<User[]>([])
    const c = collection<User>(s, { id: (u) => u.uuid })
    c.add({ uuid: 'x-1', email: 'a@b.com' })
    expect(c.get('x-1')?.email).toBe('a@b.com')
    c.update('x-1', { email: 'updated@b.com' })
    expect(c.get('x-1')?.email).toBe('updated@b.com')
  })

  test('add throws on duplicate key', () => {
    const s = state<Item[]>([{ id: 'a', name: 'first', count: 1 }])
    const c = collection<Item>(s)
    expect(() => c.add({ id: 'a', name: 'duplicate', count: 99 })).toThrow(/duplicate key/i)
    // The original item is preserved.
    expect(c.all()).toHaveLength(1)
    expect(c.get('a')?.name).toBe('first')
  })

  test('update throws if the patch would change the key', () => {
    const s = state<Item[]>([{ id: 'a', name: 'first', count: 1 }])
    const c = collection<Item>(s)
    // Renaming via update is forbidden — would silently break get / remove
    // contracts on either key. Use remove+add for renames.
    expect(() => c.update('a', { id: 'b' } as Partial<Item>)).toThrow(/key/i)
    // Item unchanged.
    expect(c.get('a')?.name).toBe('first')
    expect(c.get('b')).toBeNull()
  })

  test('update with patch that does not touch the key is fine', () => {
    const s = state<Item[]>([{ id: 'a', name: 'first', count: 1 }])
    const c = collection<Item>(s)
    c.update('a', { name: 'updated', count: 99 })
    expect(c.get('a')).toEqual({ id: 'a', name: 'updated', count: 99 })
  })

  test('update key-rename guard works with custom id extractors', () => {
    interface User {
      uuid: string
      email: string
    }
    const s = state<User[]>([{ uuid: 'x-1', email: 'a@b.com' }])
    const c = collection<User>(s, { id: (u) => u.uuid })
    expect(() => c.update('x-1', { uuid: 'x-2' })).toThrow(/key/i)
    expect(c.get('x-1')?.email).toBe('a@b.com')
  })

  test('composite keys via custom id extractor', () => {
    interface OrgItem {
      org: string
      slug: string
      title: string
    }
    const s = state<OrgItem[]>([])
    const c = collection<OrgItem>(s, { id: (i) => `${i.org}:${i.slug}` })
    c.add({ org: 'acme', slug: 'one', title: 'A' })
    c.add({ org: 'acme', slug: 'two', title: 'B' })
    expect(c.get('acme:one')?.title).toBe('A')
    expect(c.get('acme:two')?.title).toBe('B')
    expect(c.get('acme:three')).toBeNull()
  })
})
