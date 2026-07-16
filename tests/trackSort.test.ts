import { describe, expect, test } from 'vitest'
import type { Track } from '../src/core/model'
import { sortTracks } from '../src/core/trackSort'

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

describe('sortTracks (the Tracks table view)', () => {
  test('string fields compare case-insensitively, per locale', () => {
    const rows = [
      track({ id: 'a', artist: 'zebra' }),
      track({ id: 'b', artist: 'Émile' }),
      track({ id: 'c', artist: 'Alpha' }),
    ]
    expect(sortTracks(rows, { field: 'artist', dir: 'asc' }).map((t) => t.id)).toEqual([
      'c',
      'b',
      'a',
    ])
  })

  test('numeric fields compare numerically; desc flips', () => {
    const rows = [
      track({ id: 'a', bpm: 174 }),
      track({ id: 'b', bpm: 87 }),
      track({ id: 'c', bpm: 128 }),
    ]
    expect(sortTracks(rows, { field: 'bpm', dir: 'asc' }).map((t) => t.id)).toEqual(['b', 'c', 'a'])
    expect(sortTracks(rows, { field: 'bpm', dir: 'desc' }).map((t) => t.id)).toEqual([
      'a',
      'c',
      'b',
    ])
  })

  test('keys sort in Camelot order, not lexicographically', () => {
    const rows = [track({ id: 'a', key: '10A' }), track({ id: 'b', key: '2A' })]
    // "10A" < "2A" as strings — Camelot order says 2A comes first
    expect(sortTracks(rows, { field: 'key', dir: 'asc' }).map((t) => t.id)).toEqual(['b', 'a'])
    // the A wheel precedes the B wheel
    const wheels = [track({ id: 'a', key: '1B' }), track({ id: 'b', key: '12A' })]
    expect(sortTracks(wheels, { field: 'key', dir: 'asc' }).map((t) => t.id)).toEqual(['b', 'a'])
  })

  test('missing values sink to the bottom in BOTH directions', () => {
    const rows = [
      track({ id: 'a', bpm: null }),
      track({ id: 'b', bpm: 128 }),
      track({ id: 'c', bpm: 140 }),
    ]
    expect(sortTracks(rows, { field: 'bpm', dir: 'asc' }).at(-1)?.id).toBe('a')
    expect(sortTracks(rows, { field: 'bpm', dir: 'desc' }).at(-1)?.id).toBe('a')
  })

  test('stable id tie-break; the input array is not mutated', () => {
    const rows = [track({ id: 'z' }), track({ id: 'a' })]
    const sorted = sortTracks(rows, { field: 'bpm', dir: 'asc' })
    expect(sorted.map((t) => t.id)).toEqual(['a', 'z'])
    expect(rows.map((t) => t.id)).toEqual(['z', 'a'])
  })

  test('the new columns sort too: album (locale), dateAdded (ISO), duration (v8 issue 15)', () => {
    const albums = [
      track({ id: 'a', album: 'Zenith' }),
      track({ id: 'b', album: 'Émission' }),
      track({ id: 'c', album: null }),
    ]
    expect(sortTracks(albums, { field: 'album', dir: 'asc' }).map((t) => t.id)).toEqual([
      'b',
      'a',
      'c',
    ])
    const dates = [
      track({ id: 'a', dateAdded: '2023-11-20' }),
      track({ id: 'b', dateAdded: '2020-03-14' }),
      track({ id: 'c', dateAdded: null }),
    ]
    expect(sortTracks(dates, { field: 'dateAdded', dir: 'desc' }).map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
    ])
    const durations = [track({ id: 'a', durationSec: 401 }), track({ id: 'b', durationSec: 298 })]
    expect(sortTracks(durations, { field: 'durationSec', dir: 'asc' }).map((t) => t.id)).toEqual([
      'b',
      'a',
    ])
  })
})
