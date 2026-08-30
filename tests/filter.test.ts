import { describe, expect, test } from 'vitest'
import {
  ALPHA_CATCH_ALL,
  alphaBucket,
  alphaBucketLabel,
  applyFilters,
  applyPlaylistFilter,
  audioQuality,
  clampRange,
  colourChipOptions,
  EMPTY_FILTERS,
  migrateFilters,
  nextGenreSelection,
  NOT_IN_PLAYLIST,
  propertyExtents,
  wholeExtent,
  type LibraryFilters,
} from '../src/core/filter'
import type { MarksContext } from '../src/core/marks'
import { track } from './helpers'

const tracks = [
  track({
    key: '8A',
    id: 'a',
    bpm: 120,
    year: 2010,
    rating: 2,
    genre: 'Techno',
  }),
  track({
    key: '8A',
    id: 'b',
    bpm: 140,
    year: 2020,
    rating: 5,
    genre: 'Trance',
  }),
  track({
    key: '8A',
    id: 'c',
    bpm: 174,
    year: 2023,
    rating: 3,
    genre: 'Drum & Bass',
  }),
  track({
    key: '8A',
    id: 'd',
    bpm: null,
    year: null,
    rating: null,
    genre: null,
  }),
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

  test('the key-ring toggles keep the chosen Camelot rings; keyless always passes (v8 issue 10 / F5)', () => {
    expect(EMPTY_FILTERS.keyRings).toEqual({ minor: true, major: true })
    const mixed = [
      track({
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'minor',
        key: '8A',
      }),
      track({
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'major',
        key: '8B',
      }),
      track({
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'keyless',
        key: null,
      }),
    ]
    expect(
      applyFilters(mixed, filters({ keyRings: { minor: true, major: false } })).map((t) => t.id),
    ).toEqual(['minor', 'keyless'])
    expect(
      applyFilters(mixed, filters({ keyRings: { minor: false, major: true } })).map((t) => t.id),
    ).toEqual(['major', 'keyless'])
    expect(applyFilters(mixed, filters({ keyRings: { minor: true, major: true } }))).toHaveLength(3)
    // F5 both-off: only keyless survives (missing key always passes).
    expect(
      applyFilters(mixed, filters({ keyRings: { minor: false, major: false } })).map((t) => t.id),
    ).toEqual(['keyless'])
  })
})

describe('marks quick-filters (v18 #3/#8)', () => {
  const marked = [
    track({ id: 'a', key: '8A', bpm: 120, year: 2010, rating: 2, genre: 'Techno' }),
    track({ id: 'b', key: '8A', bpm: 120, year: 2010, rating: 2, genre: 'Techno' }),
    track({ id: 'c', key: '8A', bpm: 120, year: 2010, rating: 2, genre: 'Techno' }),
  ]
  // 'b' is deliberately in both sets, so the compose test can tell AND from OR.
  const marks: MarksContext = {
    starredIds: new Set(['a', 'b']),
    comboIds: new Set(['b', 'c']),
    constellationIds: new Set(['a', 'c']),
  }

  test('starredOnly keeps only starred ids, including a pinned one', () => {
    const out = applyFilters(
      marked,
      filters({ marks: { starredOnly: true, comboOnly: false, constellationOnly: false } }),
      [],
      marks,
    )
    expect(out.map((t) => t.id)).toEqual(['a', 'b'])
  })

  test('comboOnly keeps only the edge endpoints', () => {
    const out = applyFilters(
      marked,
      filters({ marks: { starredOnly: false, comboOnly: true, constellationOnly: false } }),
      [],
      marks,
    )
    expect(out.map((t) => t.id)).toEqual(['b', 'c'])
  })

  test('constellationOnly keeps only the tracklist ids', () => {
    const out = applyFilters(
      marked,
      filters({ marks: { starredOnly: false, comboOnly: false, constellationOnly: true } }),
      [],
      marks,
    )
    expect(out.map((t) => t.id)).toEqual(['a', 'c'])
  })

  test('all three flags compose with AND, not OR', () => {
    const out = applyFilters(
      marked,
      filters({ marks: { starredOnly: true, comboOnly: true, constellationOnly: true } }),
      [],
      marks,
    )
    expect(out.map((t) => t.id)).toEqual([])
  })

  test('flags on with no context filters nothing — safe for stray callers', () => {
    const out = applyFilters(
      marked,
      filters({ marks: { starredOnly: true, comboOnly: true, constellationOnly: true } }),
    )
    expect(out).toHaveLength(3)
  })

  test('all flags off is inert even when a context is supplied', () => {
    expect(applyFilters(marked, EMPTY_FILTERS, [], marks)).toHaveLength(3)
  })
})

describe('migrateFilters and marks (v18 #3/#8: session-only, always loads off)', () => {
  test('EMPTY_FILTERS.marks is all-off', () => {
    expect(EMPTY_FILTERS.marks).toEqual({
      starredOnly: false,
      comboOnly: false,
      constellationOnly: false,
    })
  })

  test('a saved active marks filter loads with all flags false', () => {
    const migrated = migrateFilters({
      marks: { starredOnly: true, comboOnly: true, constellationOnly: true },
    })
    expect(migrated.marks).toEqual({
      starredOnly: false,
      comboOnly: false,
      constellationOnly: false,
    })
  })
})

describe('alphaBucket / alphaBucketLabel (v14 WS2)', () => {
  test('first letter maps to 0–25, case-insensitive, ignoring leading space', () => {
    expect(alphaBucket('Kraftwerk')).toBe(10)
    expect(alphaBucket('aphex twin')).toBe(0)
    expect(alphaBucket('  ZZ Top')).toBe(25)
  })

  test('non-letters, empties and diacritics land in the # catch-all (26, after Z)', () => {
    expect(ALPHA_CATCH_ALL).toBe(26)
    expect(alphaBucket('808 State')).toBe(26)
    expect(alphaBucket('')).toBe(26)
    // Diacritics fall through to the catch-all — documented as intended.
    expect(alphaBucket('Éclair')).toBe(26)
  })

  test('labels run A…Z then #', () => {
    expect(alphaBucketLabel(0)).toBe('A')
    expect(alphaBucketLabel(10)).toBe('K')
    expect(alphaBucketLabel(25)).toBe('Z')
    expect(alphaBucketLabel(ALPHA_CATCH_ALL)).toBe('#')
  })
})

describe('alpha bucket ranges (v14 WS2)', () => {
  const artists = [
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'aphex',
      artist: 'aphex twin',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'kraftwerk',
      artist: 'Kraftwerk',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'zz',
      artist: 'ZZ Top',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: '808',
      artist: '808 State',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'none',
      artist: null,
    }),
  ]

  test('A–M keeps Kraftwerk, drops ZZ Top; null artist passes', () => {
    const out = applyFilters(artists, filters({ properties: { artist: [0, 12] } }))
    expect(out.map((t) => t.id)).toEqual(['aphex', 'kraftwerk', 'none'])
  })

  test('[25,26] keeps ZZ Top and the # bucket (808 State); null passes', () => {
    const out = applyFilters(artists, filters({ properties: { artist: [25, 26] } }))
    expect(out.map((t) => t.id)).toEqual(['zz', '808', 'none'])
  })
})

describe('contains filters (v14 WS2)', () => {
  const noted = [
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'live',
      comments: 'Recorded LIVE at Berghain',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'studio',
      comments: 'studio take',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'none',
      comments: null,
    }),
  ]

  test('case-insensitive substring on comments; null passes', () => {
    const out = applyFilters(noted, filters({ properties: { comments: { contains: 'live' } } }))
    expect(out.map((t) => t.id)).toEqual(['live', 'none'])
  })

  test('works on location, case-insensitively', () => {
    const paths = [
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'wav',
        location: '/Music/track.WAV',
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'mp3',
        location: '/Music/track.mp3',
      }),
    ]
    const out = applyFilters(paths, filters({ properties: { location: { contains: '.wav' } } }))
    expect(out.map((t) => t.id)).toEqual(['wav'])
  })
})

describe('colour allow-list (v14 WS2)', () => {
  const coloured = [
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'pink',
      colour: '0xFF007F',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'blue',
      colour: '0x0000FF',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'none',
      colour: null,
    }),
  ]

  test('keeps allowed colours case-insensitively; null-colour tracks pass (genre precedent)', () => {
    const out = applyFilters(
      coloured,
      filters({ properties: { colour: { colours: ['0xff007f'] } } }),
    )
    expect(out.map((t) => t.id)).toEqual(['pink', 'none'])
  })
})

describe('quality filter (v14 WS2)', () => {
  const files = [
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'wav',
      kind: 'WAV File',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'flac',
      kind: 'FLAC',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'mp3',
      kind: 'MP3 File',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'weird',
      kind: 'Some Format',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'none',
      kind: null,
    }),
  ]

  test('audioQuality classifies formats; unknowns → null', () => {
    expect(audioQuality('WAV File')).toBe('lossless')
    expect(audioQuality('flac')).toBe('lossless')
    expect(audioQuality('AIFF')).toBe('lossless')
    expect(audioQuality('MP3 File')).toBe('lossy')
    expect(audioQuality('AAC audio file')).toBe('lossy')
    expect(audioQuality('Some Format')).toBeNull()
  })

  test('lossless-only keeps lossless; unknown and null pass', () => {
    const out = applyFilters(files, filters({ properties: { kind: { qualities: ['lossless'] } } }))
    expect(out.map((t) => t.id)).toEqual(['wav', 'flac', 'weird', 'none'])
  })

  test('lossy-only keeps lossy; unknown and null pass', () => {
    const out = applyFilters(files, filters({ properties: { kind: { qualities: ['lossy'] } } }))
    expect(out.map((t) => t.id)).toEqual(['mp3', 'weird', 'none'])
  })

  test('F5 both-on (both in the allow-list) passes every file', () => {
    const out = applyFilters(
      files,
      filters({ properties: { kind: { qualities: ['lossy', 'lossless'] } } }),
    )
    expect(out).toHaveLength(5)
  })

  test('F5 both-off (empty allow-list) keeps only unknown/absent-format tracks', () => {
    const out = applyFilters(files, filters({ properties: { kind: { qualities: [] } } }))
    expect(out.map((t) => t.id)).toEqual(['weird', 'none'])
  })
})

describe('sanitizeRange migration through migrateFilters (v14 WS2)', () => {
  test('old v5 text tuples on the new kinds are dropped', () => {
    const migrated = migrateFilters({ properties: { artist: ['b', 'k'], comments: ['x', 'y'] } })
    expect(migrated.properties).toEqual({})
  })

  test('new object shapes round-trip; alpha clamps rounded ints into 0–26', () => {
    const migrated = migrateFilters({
      properties: {
        artist: [-3, 40.6],
        comments: { contains: 'live' },
        colour: { colours: ['0xFF0000'] },
        kind: { qualities: ['lossy'] },
      },
    })
    expect(migrated.properties).toEqual({
      artist: [0, 26],
      comments: { contains: 'live' },
      colour: { colours: ['0xFF0000'] },
      kind: { qualities: ['lossy'] },
    })
  })

  test('F5: an old v6 single-quality range migrates to the new qualities array', () => {
    const migrated = migrateFilters({ properties: { kind: { quality: 'lossless' } } })
    expect(migrated.properties).toEqual({ kind: { qualities: ['lossless'] } })
  })

  test('F5: a both-off empty qualities array is preserved (not dropped)', () => {
    const migrated = migrateFilters({ properties: { kind: { qualities: [] } } })
    expect(migrated.properties).toEqual({ kind: { qualities: [] } })
  })

  test('malformed object shapes drop (empty contains, empty colours, bad quality)', () => {
    const migrated = migrateFilters({
      properties: {
        comments: { contains: '' },
        colour: { colours: [] },
        kind: { quality: 'nonsense' },
      },
    })
    expect(migrated.properties).toEqual({})
  })
})

describe('key ordinal ranges (v11 issue 1: Camelot number, both rings)', () => {
  const keyed = [
    track({
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'low',
      key: '3A',
    }),
    track({
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'inA',
      key: '9A',
    }),
    track({
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'inB',
      key: '11B',
    }),
    track({
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'high',
      key: '12B',
    }),
    track({
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'none',
      key: null,
    }),
  ]

  test('8–12 hits both rings; missing keys pass', () => {
    const out = applyFilters(keyed, filters({ properties: { key: [8, 12] } }))
    expect(out.map((t) => t.id)).toEqual(['inA', 'inB', 'high', 'none'])
  })

  test('composes with the ring toggles', () => {
    const out = applyFilters(
      keyed,
      filters({ properties: { key: [8, 12] }, keyRings: { minor: true, major: false } }),
    )
    expect(out.map((t) => t.id)).toEqual(['inA', 'none'])
  })
})

describe('date-kind filters exclude undated tracks (generalizes v10 issue 4b)', () => {
  const dated = [
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'old',
      dateAdded: '2019-05-01',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'mid',
      dateAdded: '2022-06-15',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'new',
      dateAdded: '2024-01-20',
    }),
    track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'none',
      dateAdded: null,
    }),
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
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'p',
        lastPlayed: '2024-03-01',
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'never',
        lastPlayed: null,
      }),
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
    const keyed = [
      track({
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
        key: '3A',
      }),
      track({
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        key: '11B',
      }),
    ]
    expect(propertyExtents(keyed, ['key'])).toEqual({ key: [3, 11] })
  })

  test('a property with no values yields null; unrequested and non-range kinds are absent', () => {
    const unrated = [
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        id: 'x',
        rating: null,
      }),
    ]
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

describe('nextGenreSelection (v40, Codex bug 5: stale selections must not invert a click)', () => {
  test('unticking with a stale longer list keeps the remaining selection', () => {
    // Three genres survived from another playlist's scope; the old length
    // comparison saw 2 >= 2 and collapsed to null — showing EVERYTHING.
    expect(nextGenreSelection(['House', 'Techno', 'Trance'], ['House', 'Techno'], 'Techno', false)) //
      .toEqual(['House', 'Trance'])
  })

  test('ticking with a stale out-of-scope list adds, never collapses to all', () => {
    expect(nextGenreSelection(['Trance'], ['House', 'Techno'], 'House', true)) //
      .toEqual(['Trance', 'House'])
  })

  test('null selection means all: unticking one leaves the rest of the scope', () => {
    expect(nextGenreSelection(null, ['House', 'Techno'], 'House', false)).toEqual(['Techno'])
  })

  test('ticking the last missing scoped genre collapses to null (no filter)', () => {
    expect(nextGenreSelection(['House'], ['House', 'Techno'], 'Techno', true)).toBeNull()
  })

  test('ticking an already-included genre changes nothing', () => {
    expect(nextGenreSelection(['House'], ['House', 'Techno'], 'House', true)).toEqual(['House'])
  })
})

describe('colourChipOptions (v14.1 WS7: honest display of out-of-scope selections)', () => {
  test('an out-of-scope selected colour surfaces as inScope:false', () => {
    expect(colourChipOptions(['red'], ['red', 'blue'])).toEqual([
      { colour: 'red', inScope: true },
      { colour: 'blue', inScope: false },
    ])
  })

  test('a colour both scoped and selected is not duplicated', () => {
    expect(colourChipOptions(['red', 'blue'], ['blue'])).toEqual([
      { colour: 'red', inScope: true },
      { colour: 'blue', inScope: true },
    ])
  })

  test('empty scoped yields just the selected colours, all out of scope', () => {
    expect(colourChipOptions([], ['red', 'blue'])).toEqual([
      { colour: 'red', inScope: false },
      { colour: 'blue', inScope: false },
    ])
  })

  test('empty selected yields just the scoped colours', () => {
    expect(colourChipOptions(['red', 'blue'], [])).toEqual([
      { colour: 'red', inScope: true },
      { colour: 'blue', inScope: true },
    ])
  })

  test('both empty yields an empty list', () => {
    expect(colourChipOptions([], [])).toEqual([])
  })

  test('ordering is stable: scoped order preserved, out-of-scope appended in selected order', () => {
    expect(colourChipOptions(['green', 'red'], ['purple', 'red', 'yellow'])).toEqual([
      { colour: 'green', inScope: true },
      { colour: 'red', inScope: true },
      { colour: 'purple', inScope: false },
      { colour: 'yellow', inScope: false },
    ])
  })
})
