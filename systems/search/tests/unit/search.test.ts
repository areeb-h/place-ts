import { describe, expect, test } from 'vitest'
import { state, watch } from '../../../reactivity/src/index.ts'
import { searchable } from '../../src/index.ts'

interface Doc {
  title: string
  body: string
  tags: readonly string[]
}

const docs: Doc[] = [
  { title: 'Reactivity primer', body: 'Two-color graph coloring.', tags: ['reactivity', 'docs'] },
  { title: 'Capability handlers', body: 'No more useContext globals.', tags: ['platform'] },
  { title: 'useEffect criticism', body: 'Universal escape hatch.', tags: ['react', 'criticism'] },
]
const fields = (d: Doc): readonly string[] => [d.title, d.body, ...d.tags]

describe('searchable', () => {
  test('empty query returns the full collection', () => {
    const items = () => docs
    const find = searchable(items, { fields })
    expect(find(() => '')()).toHaveLength(3)
  })

  test('whitespace-only query treated as empty', () => {
    const items = () => docs
    const find = searchable(items, { fields })
    expect(find(() => '   \t  ')()).toHaveLength(3)
  })

  test('single-token substring match across fields', () => {
    const items = () => docs
    const find = searchable(items, { fields })
    expect(find(() => 'reactivity')()).toHaveLength(1)
    expect(find(() => 'globals')()).toHaveLength(1)
    expect(find(() => 'criticism')()).toHaveLength(1)
  })

  test('multi-token query requires ALL tokens to match (AND)', () => {
    const items = () => docs
    const find = searchable(items, { fields })
    // 'react criticism' → matches the useEffect doc only
    expect(find(() => 'react criticism')()).toHaveLength(1)
    // 'reactivity criticism' → no doc has both
    expect(find(() => 'reactivity criticism')()).toHaveLength(0)
  })

  test('case-insensitive by default', () => {
    const items = () => docs
    const find = searchable(items, { fields })
    expect(find(() => 'REACTIVITY')()).toHaveLength(1)
    expect(find(() => 'Reactivity')()).toHaveLength(1)
  })

  test('case-sensitive when opted in', () => {
    const items = () => docs
    const find = searchable(items, { fields, caseSensitive: true })
    expect(find(() => 'Reactivity')()).toHaveLength(1)
    expect(find(() => 'reactivity')()).toHaveLength(1)
    expect(find(() => 'REACTIVITY')()).toHaveLength(0)
  })

  test('searches inside tags (variadic field expansion)', () => {
    const items = () => docs
    const find = searchable(items, { fields })
    expect(find(() => 'platform')()).toHaveLength(1)
    expect(find(() => 'docs')()).toHaveLength(1)
  })

  test('reactive on the items collection', () => {
    const list = state<Doc[]>(docs.slice(0, 1))
    const find = searchable(() => list(), { fields })
    const filter = find(() => '')
    expect(filter()).toHaveLength(1)
    list.set(docs)
    expect(filter()).toHaveLength(3)
  })

  test('reactive on the query', () => {
    const q = state('reactivity')
    const find = searchable(() => docs, { fields })
    const filter = find(() => q())

    let observed = 0
    const stop = watch(() => {
      observed = filter().length
    })
    expect(observed).toBe(1)
    q.set('platform')
    expect(observed).toBe(1)
    q.set('')
    expect(observed).toBe(3)
    stop()
  })

  test('no match returns empty array', () => {
    const find = searchable(() => docs, { fields })
    expect(find(() => 'xyzzy')()).toEqual([])
  })

  test('preserves input order (no ranking in v0.1)', () => {
    const find = searchable(() => docs, { fields })
    const r = find(() => 'a')() // matches all three on the letter 'a'
    expect(r.map((d) => d.title)).toEqual([
      'Reactivity primer',
      'Capability handlers',
      'useEffect criticism',
    ])
  })
})
