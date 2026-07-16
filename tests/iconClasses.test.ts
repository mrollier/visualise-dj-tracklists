import { describe, expect, test } from 'vitest'
import { genreFamilyOf } from '../src/core/genre'
import { classIndexOfTrack, genreFamilyClasses, playlistClasses } from '../src/core/iconClasses'
import type { Playlist, Track } from '../src/core/model'

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
    album: null,
    dateAdded: null,
    location: null,
    ...overrides,
  }
}

describe('genreFamilyOf (v8 issues 4+5)', () => {
  test('walks the primary lineage up to the family level', () => {
    expect(genreFamilyOf('Melodic Techno')).toBe('techno')
    expect(genreFamilyOf('Tech-House')).toBe('house') // first parent wins
    expect(genreFamilyOf('Psytrance')).toBe('trance')
    expect(genreFamilyOf('deep house')).toBe('house')
  })

  test('a family label is its own family; aliases normalize first', () => {
    expect(genreFamilyOf('Jazz')).toBe('jazz')
    expect(genreFamilyOf('house')).toBe('house')
    expect(genreFamilyOf('DnB')).toBe(genreFamilyOf('Drum & Bass'))
  })

  test('umbrellas above the family level and unknown labels have none', () => {
    expect(genreFamilyOf('Electronic')).toBeNull()
    expect(genreFamilyOf('Zydeco Polka Fusion')).toBeNull()
  })
})

describe('genreFamilyClasses', () => {
  const genres = [
    'Deep House',
    'deep house',
    'Melodic Techno',
    'Psytrance',
    'Jazz',
    null,
    'Unknown Genre X',
  ]

  test('classes are families, largest first, labels keyed by primary genre', () => {
    const result = genreFamilyClasses(genres, 4)
    expect(result).not.toBeNull()
    expect(result!.keyedBy).toBe('genre')
    expect(result!.classes.map((c) => c.label)).toEqual(['house', 'jazz', 'techno', 'trance'])
    expect(result!.classes[0].size).toBe(2)
    expect(result!.classOf.get('deep house')).toBe(0)
    expect(result!.classOf.get('melodic techno')).toBe(2)
    expect(result!.classOf.get('unknown genre x')).toBeUndefined()
  })

  test('beyond maxClasses, only the largest families keep a symbol', () => {
    const result = genreFamilyClasses(genres, 2)
    expect(result!.classes).toHaveLength(2)
    expect(result!.classes.map((c) => c.label)).toEqual(['house', 'jazz'])
    expect(result!.classOf.get('psytrance')).toBeUndefined()
  })

  test('fewer than two families means nothing to distinguish', () => {
    expect(genreFamilyClasses(['Deep House', 'Tech House'], 4)).toBeNull()
    expect(genreFamilyClasses([], 4)).toBeNull()
  })
})

describe('playlistClasses', () => {
  const tracks = ['t1', 't2', 't3', 't4', 't5'].map((id) => track({ id }))
  const playlistA: Playlist = { name: 'Warm-up', trackIds: ['t1', 't2', 't3'] }
  const playlistB: Playlist = { name: 'Peak', trackIds: ['t3', 't4', 'ghost'] }

  test('first selected playlist wins; classes ordered by member count', () => {
    const result = playlistClasses(tracks, [playlistA, playlistB], 6)
    expect(result).not.toBeNull()
    expect(result!.keyedBy).toBe('track')
    expect(result!.classes.map((c) => c.label)).toEqual(['Warm-up', 'Peak'])
    expect(result!.classes.map((c) => c.size)).toEqual([3, 1]) // t3 counted once, for A
    expect(result!.classOf.get('t3')).toBe(0)
    expect(result!.classOf.get('t4')).toBe(1)
    expect(result!.classOf.get('t5')).toBeUndefined()
  })

  test('beyond maxClasses, the largest keep a symbol; panel order breaks ties', () => {
    const c: Playlist = { name: 'Extra', trackIds: ['t5'] }
    const result = playlistClasses(tracks, [c, playlistA, playlistB], 2)
    // Extra and Peak both hold one track; Extra sits higher in the panel
    expect(result!.classes.map((c2) => c2.label)).toEqual(['Warm-up', 'Extra'])
    expect(result!.classOf.get('t4')).toBeUndefined()
  })

  test('fewer than two selected playlists means nothing to distinguish', () => {
    expect(playlistClasses(tracks, [playlistA], 6)).toBeNull()
    expect(playlistClasses(tracks, [], 6)).toBeNull()
  })
})

describe('classIndexOfTrack', () => {
  test('resolves through the genre key or the track key, null-safe', () => {
    const byGenre = genreFamilyClasses(['Deep House', 'Jazz'], 4)
    expect(classIndexOfTrack(byGenre, track({ id: 'x', genre: 'Deep House / Techno' }))).toBe(
      byGenre!.classOf.get('deep house'),
    )
    expect(classIndexOfTrack(byGenre, track({ id: 'x', genre: null }))).toBeNull()
    const byTrack = playlistClasses(
      [track({ id: 'p1' }), track({ id: 'p2' })],
      [
        { name: 'A', trackIds: ['p1'] },
        { name: 'B', trackIds: ['p2'] },
      ],
      6,
    )
    expect(classIndexOfTrack(byTrack, track({ id: 'p2' }))).toBe(1)
    expect(classIndexOfTrack(null, track({ id: 'x' }))).toBeNull()
  })
})
