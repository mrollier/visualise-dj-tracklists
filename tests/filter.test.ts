import { describe, expect, test } from 'vitest'
import {
  applyFilters,
  applyPlaylistFilter,
  clampRange,
  EMPTY_FILTERS,
  NOT_IN_PLAYLIST,
  propertyExtents,
  wholeExtent,
  type LibraryFilters,
} from '../src/core/filter'
import { EMPTY_TRACK_FIELDS, type Track } from '../src/core/model'

function track(overrides: Partial<Track> & { id: string }): Track {
  return {
    ...EMPTY_TRACK_FIELDS,
    title: overrides.id,
    key: '8A',
    bpm: 128,
    genre: 'Techno',
    year: 2020,
    rating: 4,
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

describe('applyFilters (v11 issue 1: per-property ranges)', () => {
  test('no filters passes everything through', () => {
    expect(EMPTY_FILTERS.properties).toEqual({})
    expect(applyFilters(tracks, EMPTY_FILTERS)).toHaveLength(4)
  })

  test('bpm range keeps tracks inside [min, max]', () => {
    const out = applyFilters(tracks, filters({ properties: { bpm: [130, 180] } }))
    expect(out.map((t) => t.id)).toEqual(['b', 'c', 'd']) // d has no bpm → passes
  })

  test('year and rating ranges combine (AND)', () => {
    const out = applyFilters(
      tracks,
      filters({ properties: { year: [2015, 2025], rating: [4, 5] } }),
    )
    expect(out.map((t) => t.id)).toEqual(['b', 'd'])
  })

  test('genre allow-list is case-insensitive; null genre always passes', () => {
    const out = applyFilters(tracks, filters({ genres: ['techno', 'Drum & Bass'] }))
    expect(out.map((t) => t.id)).toEqual(['a', 'c', 'd'])
  })

  test('missing values never fail a number-range filter', () => {
    const out = applyFilters(tracks, filters({ properties: { bpm: [500, 600] } }))
    expect(out.map((t) => t.id)).toEqual(['d'])
  })

  test('the key-ring filter keeps one Camelot ring; keyless tracks always pass (v8 issue 10)', () => {
    expect(EMPTY_FILTERS.keyRing).toBe('both')
    const mixed = [
      track({ id: 'minor', key: '8A' }),
      track({ id: 'major', key: '8B' }),
      track({ id: 'keyless', key: null }),
    ]
    expect(applyFilters(mixed, filters({ keyRing: 'minor' })).map((t) => t.id)).toEqual([
      'minor',
      'keyless',
    ])
    expect(applyFilters(mixed, filters({ keyRing: 'major' })).map((t) => t.id)).toEqual([
      'major',
      'keyless',
    ])
    expect(applyFilters(mixed, filters({ keyRing: 'both' }))).toHaveLength(3)
  })
})

describe('text prefix-ranges (v11 issue 1)', () => {
  const artists = [
    track({ id: 'a', artist: 'Aphex Twin' }),
    track({ id: 'b', artist: 'Bicep' }),
    track({ id: 'k', artist: 'Kraftwerk' }),
    track({ id: 'l', artist: 'Laurent Garnier' }),
    track({ id: 'none', artist: null }),
  ]

  test('keeps names starting between the bounds, upper bound prefix-inclusive', () => {
    const out = applyFilters(artists, filters({ properties: { artist: ['b', 'k'] } }))
    // "kraftwerk" starts with "k" → in; "laurent…" > "k…" → out
    expect(out.map((t) => t.id)).toEqual(['b', 'k', 'none'])
  })

  test('compares case-insensitively', () => {
    const out = applyFilters(artists, filters({ properties: { artist: ['B', 'K'] } }))
    expect(out.map((t) => t.id)).toEqual(['b', 'k', 'none'])
  })

  test('an empty side is open', () => {
    expect(
      applyFilters(artists, filters({ properties: { artist: ['', 'b'] } })).map((t) => t.id),
    ).toEqual(['a', 'b', 'none'])
    expect(
      applyFilters(artists, filters({ properties: { artist: ['k', ''] } })).map((t) => t.id),
    ).toEqual(['k', 'l', 'none'])
  })

  test('missing text passes; genre text-range ANDs with the genre checklist', () => {
    const out = applyFilters(
      tracks,
      filters({ properties: { genre: ['t', 't'] }, genres: ['Techno', 'Trance', 'Drum & Bass'] }),
    )
    expect(out.map((t) => t.id)).toEqual(['a', 'b', 'd'])
  })
})

describe('key ordinal ranges (v11 issue 1: Camelot number, both rings)', () => {
  const keyed = [
    track({ id: 'low', key: '3A' }),
    track({ id: 'inA', key: '9A' }),
    track({ id: 'inB', key: '11B' }),
    track({ id: 'high', key: '12B' }),
    track({ id: 'none', key: null }),
  ]

  test('8–12 hits both rings; missing keys pass', () => {
    const out = applyFilters(keyed, filters({ properties: { key: [8, 12] } }))
    expect(out.map((t) => t.id)).toEqual(['inA', 'inB', 'high', 'none'])
  })

  test('composes with the ring switch', () => {
    const out = applyFilters(keyed, filters({ properties: { key: [8, 12] }, keyRing: 'minor' }))
    expect(out.map((t) => t.id)).toEqual(['inA', 'none'])
  })
})

describe('date-kind filters exclude undated tracks (generalizes v10 issue 4b)', () => {
  const dated = [
    track({ id: 'old', dateAdded: '2019-05-01' }),
    track({ id: 'mid', dateAdded: '2022-06-15' }),
    track({ id: 'new', dateAdded: '2024-01-20' }),
    track({ id: 'none', dateAdded: null }),
  ]

  test('filters lexically by YYYY-MM-DD, bounds inclusive', () => {
    const out = applyFilters(
      dated,
      filters({ properties: { dateAdded: ['2022-06-15', '2024-01-20'] } }),
    )
    expect(out.map((t) => t.id)).toEqual(['mid', 'new'])
  })

  test('undated tracks are excluded while a date filter is active', () => {
    const out = applyFilters(
      dated,
      filters({ properties: { dateAdded: ['2000-01-01', '2030-01-01'] } }),
    )
    expect(out.map((t) => t.id)).toEqual(['old', 'mid', 'new'])
  })

  test('the rule covers every date-kind property (lastPlayed too)', () => {
    const played = [
      track({ id: 'p', lastPlayed: '2024-03-01' }),
      track({ id: 'never', lastPlayed: null }),
    ]
    const out = applyFilters(
      played,
      filters({ properties: { lastPlayed: ['2024-01-01', '2024-12-31'] } }),
    )
    expect(out.map((t) => t.id)).toEqual(['p'])
  })
})

describe('propertyExtents (v11: computed only for requested keys)', () => {
  test('reports min/max for number properties, ignoring missing values', () => {
    expect(propertyExtents(tracks, ['bpm', 'year', 'rating'])).toEqual({
      bpm: [120, 174],
      year: [2010, 2023],
      rating: [2, 5],
    })
  })

  test('key extents run over Camelot numbers across both rings', () => {
    const keyed = [track({ id: 'a', key: '3A' }), track({ id: 'b', key: '11B' })]
    expect(propertyExtents(keyed, ['key'])).toEqual({ key: [3, 11] })
  })

  test('a property with no values yields null; unrequested and non-range kinds are absent', () => {
    const unrated = [track({ id: 'x', rating: null })]
    expect(propertyExtents(unrated, ['rating'])).toEqual({ rating: null })
    expect(propertyExtents(tracks, ['bpm', 'artist'])).toEqual({ bpm: [120, 174] })
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
      filters({ playlists: ['Openers', 'Peak'], properties: { bpm: [130, 180] } }),
      playlists,
    )
    expect(visible.map((t) => t.id)).toEqual(['b', 'c'])
  })

  test('a selection with no imported playlists filters nothing', () => {
    expect(applyFilters(tracks, filters({ playlists: [] }), [])).toHaveLength(4)
  })
})

describe('applyPlaylistFilter', () => {
  const playlists = [
    { name: 'Openers', trackIds: ['a', 'b'] },
    { name: 'Peak', trackIds: ['b', 'c'] },
  ]

  test('null selection passes everything through', () => {
    expect(applyPlaylistFilter(tracks, null, playlists)).toHaveLength(4)
  })

  test('selects the union of the chosen playlists, ignoring range filters entirely', () => {
    const out = applyPlaylistFilter(tracks, ['Peak'], playlists)
    expect(out.map((t) => t.id)).toEqual(['b', 'c'])
  })

  test('NOT_IN_PLAYLIST selects the leftovers; empty selection hides everything', () => {
    expect(applyPlaylistFilter(tracks, [NOT_IN_PLAYLIST], playlists).map((t) => t.id)).toEqual([
      'd',
    ])
    expect(applyPlaylistFilter(tracks, [], playlists)).toEqual([])
  })

  test('with no imported playlists any selection is inert', () => {
    expect(applyPlaylistFilter(tracks, [], [])).toHaveLength(4)
  })

  test('agrees with applyFilters when only the playlist filter is active', () => {
    const selected = ['Openers', NOT_IN_PLAYLIST]
    expect(applyPlaylistFilter(tracks, selected, playlists)).toEqual(
      applyFilters(tracks, filters({ playlists: selected }), playlists),
    )
  })
})

describe('wholeExtent', () => {
  test('rounds outward to the surrounding whole numbers', () => {
    expect(wholeExtent([120.3, 129.1])).toEqual([120, 130])
  })

  test('integer extents are kept as-is', () => {
    expect(wholeExtent([120, 174])).toEqual([120, 174])
  })

  test('negative values round outward too', () => {
    expect(wholeExtent([-3.5, -1.2])).toEqual([-4, -1])
  })
})

describe('clampRange (generic over numbers and strings since v11)', () => {
  test('an edited min above the max is pulled down to the max', () => {
    expect(clampRange([130, 124], 'min')).toEqual([124, 124])
  })

  test('an edited max below the min is pulled up to the min', () => {
    expect(clampRange([130, 124], 'max')).toEqual([130, 130])
  })

  test('valid ranges pass through untouched', () => {
    expect(clampRange([120, 130], 'min')).toEqual([120, 130])
    expect(clampRange([120, 130], 'max')).toEqual([120, 130])
  })

  test('equal bounds are allowed', () => {
    expect(clampRange([128, 128], 'min')).toEqual([128, 128])
  })

  test('string bounds clamp lexically', () => {
    expect(clampRange(['k', 'b'], 'min')).toEqual(['b', 'b'])
    expect(clampRange(['k', 'b'], 'max')).toEqual(['k', 'k'])
    expect(clampRange(['b', 'k'], 'min')).toEqual(['b', 'k'])
  })
})
