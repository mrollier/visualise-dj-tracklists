import { describe, expect, test } from 'vitest'
import {
  applyFilters,
  EMPTY_FILTERS,
  libraryExtents,
  NOT_IN_PLAYLIST,
  type LibraryFilters,
} from '../src/core/filter'
import type { Track } from '../src/core/model'

function track(overrides: Partial<Track> & { id: string }): Track {
  return {
    title: overrides.id,
    artist: null,
    key: '8A',
    bpm: 128,
    genre: 'Techno',
    year: 2020,
    rating: 4,
    durationSec: null,
    location: null,
    ...overrides,
  }
}

const tracks = [
  track({ id: 'a', bpm: 120, year: 2010, rating: 2, genre: 'Techno' }),
  track({ id: 'b', bpm: 140, year: 2020, rating: 5, genre: 'Trance' }),
  track({ id: 'c', bpm: 174, year: 2023, rating: 3, genre: 'Drum & Bass' }),
  track({ id: 'd', bpm: null, year: null, rating: null, genre: null }),
]

function filters(overrides: Partial<LibraryFilters>): LibraryFilters {
  return { ...EMPTY_FILTERS, ...overrides }
}

describe('applyFilters', () => {
  test('no filters passes everything through', () => {
    expect(applyFilters(tracks, EMPTY_FILTERS)).toHaveLength(4)
  })

  test('bpm range keeps tracks inside [min, max]', () => {
    const out = applyFilters(tracks, filters({ bpm: [130, 180] }))
    expect(out.map((t) => t.id)).toEqual(['b', 'c', 'd']) // d has no bpm → passes
  })

  test('year and rating ranges combine (AND)', () => {
    const out = applyFilters(tracks, filters({ year: [2015, 2025], rating: [4, 5] }))
    expect(out.map((t) => t.id)).toEqual(['b', 'd'])
  })

  test('genre allow-list is case-insensitive; null genre always passes', () => {
    const out = applyFilters(tracks, filters({ genres: ['techno', 'Drum & Bass'] }))
    expect(out.map((t) => t.id)).toEqual(['a', 'c', 'd'])
  })

  test('empty genre allow-list means no genre filtering', () => {
    expect(applyFilters(tracks, filters({ genres: null }))).toHaveLength(4)
  })

  test('missing values never fail a range filter', () => {
    const out = applyFilters(tracks, filters({ bpm: [500, 600] }))
    expect(out.map((t) => t.id)).toEqual(['d'])
  })
})

describe('libraryExtents', () => {
  test('reports min/max per numeric field, ignoring missing values', () => {
    expect(libraryExtents(tracks)).toEqual({
      bpm: [120, 174],
      year: [2010, 2023],
      rating: [2, 5],
    })
  })

  test('a field with no values at all yields null', () => {
    const unrated = [track({ id: 'x', rating: null })]
    expect(libraryExtents(unrated).rating).toBeNull()
    expect(libraryExtents([])).toEqual({ bpm: null, year: null, rating: null })
  })
})

describe('playlist filtering', () => {
  const playlists = [
    { name: 'Openers', trackIds: ['a', 'b'] },
    { name: 'Peak', trackIds: ['b', 'c'] },
  ]

  test('null selection means the playlist filter is inactive', () => {
    expect(applyFilters(tracks, filters({ playlists: null }), playlists)).toHaveLength(4)
  })

  test('an empty selection hides everything (fresh collection import)', () => {
    expect(applyFilters(tracks, filters({ playlists: [] }), playlists)).toEqual([])
  })

  test('selected playlists union their members', () => {
    const visible = applyFilters(tracks, filters({ playlists: ['Openers'] }), playlists)
    expect(visible.map((t) => t.id)).toEqual(['a', 'b'])
    const both = applyFilters(tracks, filters({ playlists: ['Openers', 'Peak'] }), playlists)
    expect(both.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  test('the NOT_IN_PLAYLIST pseudo-playlist selects the leftovers', () => {
    const visible = applyFilters(tracks, filters({ playlists: [NOT_IN_PLAYLIST] }), playlists)
    expect(visible.map((t) => t.id)).toEqual(['d'])
  })

  test('playlist selection intersects with the other filters', () => {
    const visible = applyFilters(
      tracks,
      filters({ playlists: ['Openers', 'Peak'], bpm: [130, 180] }),
      playlists,
    )
    expect(visible.map((t) => t.id)).toEqual(['b', 'c'])
  })

  test('a selection with no imported playlists filters nothing', () => {
    expect(applyFilters(tracks, filters({ playlists: [] }), [])).toHaveLength(4)
  })
})
