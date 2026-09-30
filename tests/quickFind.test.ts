import { describe, expect, test } from 'vitest'
import { quickFind } from '../src/core/quickFind'
import { randomLibrary, track } from './helpers'

const tracks = [
  track({ id: 'a', artist: 'Daft Punk', title: 'One More Time' }),
  track({ id: 'b', artist: 'Adele', title: 'Someone Like You' }),
  track({ id: 'c', artist: 'Metallica', title: 'One' }),
  track({ id: 'd', artist: 'Röyksopp', title: 'Eple' }),
  track({ id: 'e', artist: 'Queen', title: 'Another One Bites the Dust' }),
  track({ id: 'f', artist: null, title: 'Untitled Dub' }),
]
const titles = (query: string) => quickFind(tracks, query).matches.map((t) => t.title)

describe('quickFind', () => {
  test('an empty query finds nothing', () => {
    expect(quickFind(tracks, '   ')).toEqual({ matches: [], total: 0 })
  })

  test('matches title or artist, case- and accent-insensitively', () => {
    expect(titles('ROYKSOPP')).toEqual(['Eple'])
    expect(titles('dub')).toEqual(['Untitled Dub'])
  })

  test('every word must appear, in any order, across artist and title', () => {
    expect(titles('one daft')).toEqual(['One More Time'])
    expect(titles('daft zzz')).toEqual([])
  })

  test('a title or artist that starts with the query ranks first, then word starts, then the rest', () => {
    // "One" and "One More Time" start with it; "Another One" has it at a word
    // start; "Someone" only contains it.
    expect(titles('one')).toEqual([
      'One',
      'One More Time',
      'Another One Bites the Dust',
      'Someone Like You',
    ])
  })

  test('returns at most `limit` matches but counts them all', () => {
    const found = quickFind(tracks, 'one', 2)
    expect(found.matches.map((t) => t.id)).toEqual(['c', 'a'])
    expect(found.total).toBe(4)
  })

  test('a 10k library answers a keystroke quickly', () => {
    const big = randomLibrary(10_000, 4)
    quickFind(big, 'warm-up') // first call normalises the library once
    const start = performance.now()
    for (const q of ['a', 'artist 1', 'artist 12', 't9']) quickFind(big, q)
    expect((performance.now() - start) / 4).toBeLessThan(30)
  })
})
