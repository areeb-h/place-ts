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

  // ===== 0.8.0 — soft delete (trash / restore) =====

  test('trash hides the item from all() and get() by default', () => {
    const s = state<Item[]>([
      { id: 'a', name: 'first', count: 1 },
      { id: 'b', name: 'second', count: 2 },
    ])
    const c = collection<Item>(s)
    c.trash('a')
    expect(c.get('a')).toBeNull()
    expect(c.all()).toHaveLength(1)
    expect(c.all()[0]?.id).toBe('b')
    // Pass-through option re-includes the trashed item.
    expect(c.get('a', { includeTrash: true })?.name).toBe('first')
    expect(c.all({ includeTrash: true })).toHaveLength(2)
  })

  test('restore brings the item back', () => {
    const s = state<Item[]>([{ id: 'a', name: 'first', count: 1 }])
    const c = collection<Item>(s)
    c.trash('a')
    expect(c.get('a')).toBeNull()
    c.restore('a')
    expect(c.get('a')?.name).toBe('first')
    expect(c.trashedKeys()).toEqual([])
  })

  test('trash + restore are idempotent', () => {
    const s = state<Item[]>([{ id: 'a', name: 'first', count: 1 }])
    const c = collection<Item>(s)
    c.trash('a')
    c.trash('a') // no-op
    expect(c.trashedKeys()).toEqual(['a'])
    c.restore('a')
    c.restore('a') // no-op
    expect(c.trashedKeys()).toEqual([])
  })

  test('remove() cleans up the trash entry too', () => {
    const s = state<Item[]>([{ id: 'a', name: 'first', count: 1 }])
    const c = collection<Item>(s)
    c.trash('a')
    expect(c.trashedKeys()).toEqual(['a'])
    c.remove('a')
    // Item gone, trash bookkeeping also gone.
    expect(c.trashedKeys()).toEqual([])
  })

  test('trash() is reactive — watch fires on trash/restore', () => {
    const s = state<Item[]>([{ id: 'a', name: 'first', count: 1 }])
    const c = collection<Item>(s)
    let renders = 0
    const dispose = watch(() => {
      void c.all() // subscribe
      renders++
    })
    expect(renders).toBe(1)
    c.trash('a')
    expect(renders).toBe(2)
    c.restore('a')
    expect(renders).toBe(3)
    dispose()
  })

  // ===== 0.8.0 — cursor pagination =====

  test('cursor returns up to `limit` items from the start', () => {
    const s = state<Item[]>([])
    const c = collection<Item>(s)
    for (let i = 0; i < 10; i++) {
      c.add({ id: `id${i}`, name: `n${i}`, count: i })
    }
    const page = c.cursor({ limit: 3 })
    expect(page.items.map((it) => it.id)).toEqual(['id0', 'id1', 'id2'])
    expect(page.next).toBe('id2')
  })

  test('cursor advances via the `after` key', () => {
    const s = state<Item[]>([])
    const c = collection<Item>(s)
    for (let i = 0; i < 5; i++) {
      c.add({ id: `id${i}`, name: `n${i}`, count: i })
    }
    const p1 = c.cursor({ limit: 2 })
    expect(p1.items.map((it) => it.id)).toEqual(['id0', 'id1'])
    expect(p1.next).toBe('id1')
    const p2 = c.cursor({ after: p1.next ?? undefined, limit: 2 })
    expect(p2.items.map((it) => it.id)).toEqual(['id2', 'id3'])
    expect(p2.next).toBe('id3')
    const p3 = c.cursor({ after: p2.next ?? undefined, limit: 2 })
    expect(p3.items.map((it) => it.id)).toEqual(['id4'])
    expect(p3.next).toBeNull() // last page
  })

  test('cursor with stale `after` returns empty page', () => {
    const s = state<Item[]>([{ id: 'a', name: 'A', count: 1 }])
    const c = collection<Item>(s)
    const page = c.cursor({ after: 'never-existed', limit: 5 })
    expect(page.items).toEqual([])
    expect(page.next).toBeNull()
  })

  test('cursor respects sortBy ordering', () => {
    const s = state<Item[]>([])
    const c = collection<Item>(s, { sortBy: (a, b) => a.count - b.count })
    c.add({ id: 'big', name: 'B', count: 100 })
    c.add({ id: 'small', name: 'S', count: 1 })
    c.add({ id: 'med', name: 'M', count: 50 })
    const page = c.cursor({ limit: 2 })
    expect(page.items.map((it) => it.id)).toEqual(['small', 'med'])
  })

  test('cursor skips trashed items', () => {
    const s = state<Item[]>([])
    const c = collection<Item>(s)
    for (let i = 0; i < 5; i++) {
      c.add({ id: `id${i}`, name: `n${i}`, count: i })
    }
    c.trash('id1')
    c.trash('id3')
    const page = c.cursor({ limit: 10 })
    expect(page.items.map((it) => it.id)).toEqual(['id0', 'id2', 'id4'])
  })

  test('cursor throws on invalid limit', () => {
    const s = state<Item[]>([])
    const c = collection<Item>(s)
    expect(() => c.cursor({ limit: 0 })).toThrow(/limit must be >= 1/)
    expect(() => c.cursor({ limit: -3 })).toThrow(/limit must be >= 1/)
  })
})
