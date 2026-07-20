import { describe, expect, test } from 'vitest'
import { sortTracks } from '../src/core/trackSort'
import { track } from './helpers'

describe('sortTracks (the Tracks table view)', () => {
  test('string fields compare case-insensitively, per locale', () => {
    const rows = [
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
        artist: 'zebra',
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        artist: 'Émile',
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'c',
        artist: 'Alpha',
      }),
    ]
    expect(sortTracks(rows, { field: 'artist', dir: 'asc' }).map((t) => t.id)).toEqual([
      'c',
      'b',
      'a',
    ])
  })

  test('numeric fields compare numerically; desc flips', () => {
    const rows = [
      track({
        key: '8A',
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
        bpm: 174,
      }),
      track({
        key: '8A',
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        bpm: 87,
      }),
      track({
        key: '8A',
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'c',
        bpm: 128,
      }),
    ]
    expect(sortTracks(rows, { field: 'bpm', dir: 'asc' }).map((t) => t.id)).toEqual(['b', 'c', 'a'])
    expect(sortTracks(rows, { field: 'bpm', dir: 'desc' }).map((t) => t.id)).toEqual([
      'a',
      'c',
      'b',
    ])
  })

  test('keys sort in Camelot order, not lexicographically', () => {
    const rows = [
      track({
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
        key: '10A',
      }),
      track({
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        key: '2A',
      }),
    ]
    // "10A" < "2A" as strings — Camelot order says 2A comes first
    expect(sortTracks(rows, { field: 'key', dir: 'asc' }).map((t) => t.id)).toEqual(['b', 'a'])
    // the A wheel precedes the B wheel
    const wheels = [
      track({
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
        key: '1B',
      }),
      track({
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        key: '12A',
      }),
    ]
    expect(sortTracks(wheels, { field: 'key', dir: 'asc' }).map((t) => t.id)).toEqual(['b', 'a'])
  })

  test('missing values sink to the bottom in BOTH directions', () => {
    const rows = [
      track({
        key: '8A',
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
        bpm: null,
      }),
      track({
        key: '8A',
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        bpm: 128,
      }),
      track({
        key: '8A',
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'c',
        bpm: 140,
      }),
    ]
    expect(sortTracks(rows, { field: 'bpm', dir: 'asc' }).at(-1)?.id).toBe('a')
    expect(sortTracks(rows, { field: 'bpm', dir: 'desc' }).at(-1)?.id).toBe('a')
  })

  test('stable id tie-break; the input array is not mutated', () => {
    const rows = [
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'z',
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
      }),
    ]
    const sorted = sortTracks(rows, { field: 'bpm', dir: 'asc' })
    expect(sorted.map((t) => t.id)).toEqual(['a', 'z'])
    expect(rows.map((t) => t.id)).toEqual(['z', 'a'])
  })

  test('the v9 metadata columns sort too: label, playCount, lastPlayed (issue 10)', () => {
    const labels = [
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
        label: 'Warp',
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        label: 'Anjuna',
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'c',
        label: null,
      }),
    ]
    expect(sortTracks(labels, { field: 'label', dir: 'asc' }).map((t) => t.id)).toEqual([
      'b',
      'a',
      'c',
    ])
    const plays = [
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
        playCount: 41,
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        playCount: 0,
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'c',
        playCount: null,
      }),
    ]
    expect(sortTracks(plays, { field: 'playCount', dir: 'desc' }).map((t) => t.id)).toEqual([
      'a',
      'b',
      'c', // missing sinks even below a real zero
    ])
    const played = [
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
        lastPlayed: '2024-02-11',
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        lastPlayed: '2023-12-31',
      }),
    ]
    expect(sortTracks(played, { field: 'lastPlayed', dir: 'asc' }).map((t) => t.id)).toEqual([
      'b',
      'a',
    ])
  })

  test('location sorts as a path string; missing sinks (v11 issue 1)', () => {
    const rows = [
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
        location: '/music/zz-top/track.mp3',
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        location: '/music/aphex/track.mp3',
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'c',
        location: null,
      }),
    ]
    expect(sortTracks(rows, { field: 'location', dir: 'asc' }).map((t) => t.id)).toEqual([
      'b',
      'a',
      'c',
    ])
  })

  test('the new columns sort too: album (locale), dateAdded (ISO), duration (v8 issue 15)', () => {
    const albums = [
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
        album: 'Zenith',
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        album: 'Émission',
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'c',
        album: null,
      }),
    ]
    expect(sortTracks(albums, { field: 'album', dir: 'asc' }).map((t) => t.id)).toEqual([
      'b',
      'a',
      'c',
    ])
    const dates = [
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
        dateAdded: '2023-11-20',
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        dateAdded: '2020-03-14',
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'c',
        dateAdded: null,
      }),
    ]
    expect(sortTracks(dates, { field: 'dateAdded', dir: 'desc' }).map((t) => t.id)).toEqual([
      'a',
      'b',
      'c',
    ])
    const durations = [
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
        durationSec: 401,
      }),
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        durationSec: 298,
      }),
    ]
    expect(sortTracks(durations, { field: 'durationSec', dir: 'asc' }).map((t) => t.id)).toEqual([
      'b',
      'a',
    ])
  })
})
