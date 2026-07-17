import { describe, expect, test } from 'vitest'
import {
  ALL_TRACK_COLUMNS,
  COLUMN_LABELS,
  DEFAULT_HIDDEN_COLUMNS,
  migrateColumns,
  visibleColumns,
} from '../src/core/columns'
import { TRACK_PROPERTIES } from '../src/core/properties'

const CLASSIC_SEVEN = ['artist', 'title', 'key', 'bpm', 'genre', 'year', 'rating'] as const

describe('the canonical column set (issues 10 + 12)', () => {
  test('covers every sortable field exactly once, classic seven first', () => {
    expect(new Set(ALL_TRACK_COLUMNS).size).toBe(ALL_TRACK_COLUMNS.length)
    expect(ALL_TRACK_COLUMNS.slice(0, 7)).toEqual([...CLASSIC_SEVEN])
    expect(ALL_TRACK_COLUMNS.length).toBe(27)
    expect(ALL_TRACK_COLUMNS.at(-1)).toBe('location')
  })

  test('derives from the property registry (v11 issue 1: one source of truth)', () => {
    expect(ALL_TRACK_COLUMNS).toEqual(TRACK_PROPERTIES.map((p) => p.key))
    for (const p of TRACK_PROPERTIES) {
      expect(COLUMN_LABELS[p.key]).toBe(p.label)
    }
  })

  test('every column has a label; hidden-by-default = everything beyond the seven', () => {
    for (const field of ALL_TRACK_COLUMNS) {
      expect(COLUMN_LABELS[field]).toBeTruthy()
    }
    expect(DEFAULT_HIDDEN_COLUMNS).toEqual(ALL_TRACK_COLUMNS.slice(7))
  })
})

describe('visibleColumns', () => {
  test('respects order and drops hidden members', () => {
    expect(visibleColumns(['bpm', 'artist', 'title'], ['artist'])).toEqual(['bpm', 'title'])
  })
})

describe('migrateColumns (issue 12)', () => {
  test('a v8 save with the default seven keeps them visible, gains the rest hidden', () => {
    const { trackColumns, hiddenColumns } = migrateColumns([...CLASSIC_SEVEN], undefined)
    expect(trackColumns).toEqual([...ALL_TRACK_COLUMNS])
    expect(hiddenColumns).toEqual(ALL_TRACK_COLUMNS.slice(7))
    expect(visibleColumns(trackColumns, hiddenColumns)).toEqual([...CLASSIC_SEVEN])
  })

  test('a reordered partial save keeps its custom order; appendix in canonical order', () => {
    const { trackColumns, hiddenColumns } = migrateColumns(['bpm', 'artist', 'title'], undefined)
    expect(trackColumns.slice(0, 3)).toEqual(['bpm', 'artist', 'title'])
    expect(trackColumns).toEqual([
      'bpm',
      'artist',
      'title',
      ...ALL_TRACK_COLUMNS.filter((f) => !['bpm', 'artist', 'title'].includes(f)),
    ])
    expect(visibleColumns(trackColumns, hiddenColumns)).toEqual(['bpm', 'artist', 'title'])
  })

  test('garbage entries and duplicates are filtered; non-array input yields the defaults', () => {
    const { trackColumns } = migrateColumns(['bpm', 'nonsense', 'bpm', 42], undefined)
    expect(trackColumns[0]).toBe('bpm')
    expect(trackColumns).toEqual(['bpm', ...ALL_TRACK_COLUMNS.filter((f) => f !== 'bpm')])
    const fallback = migrateColumns(undefined, undefined)
    expect(fallback.trackColumns).toEqual([...ALL_TRACK_COLUMNS])
    expect(fallback.hiddenColumns).toEqual([...DEFAULT_HIDDEN_COLUMNS])
  })

  test('a new-shape save round-trips unchanged', () => {
    const order = [...ALL_TRACK_COLUMNS].reverse()
    const hidden = ['artist', 'kind']
    const out = migrateColumns(order, hidden)
    expect(out.trackColumns).toEqual(order)
    expect(out.hiddenColumns).toEqual(hidden)
  })

  test('a save predating a canonical column hides the newcomer even when hiddenColumns exists (v11: location)', () => {
    // A v10 save has a full order WITHOUT location and its own hidden array.
    const oldOrder = ALL_TRACK_COLUMNS.filter((f) => f !== 'location')
    const out = migrateColumns([...oldOrder], ['album'])
    expect(out.trackColumns).toEqual([...oldOrder, 'location'])
    expect(out.hiddenColumns).toContain('album')
    expect(out.hiddenColumns).toContain('location')
    expect(visibleColumns(out.trackColumns, out.hiddenColumns)).not.toContain('location')
  })

  test('an all-hidden save gets title forced back visible', () => {
    const out = migrateColumns([...ALL_TRACK_COLUMNS], [...ALL_TRACK_COLUMNS])
    expect(out.hiddenColumns).not.toContain('title')
    expect(visibleColumns(out.trackColumns, out.hiddenColumns)).toEqual(['title'])
  })
})
