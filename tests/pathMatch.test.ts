import { describe, expect, test } from 'vitest'
import {
  buildFileIndex,
  commonSuffixDepth,
  matchLocation,
  type FileIndex,
} from '../src/core/audio/pathMatch'

/** A granted folder's contents, as folder-relative paths. */
function index(...paths: string[]): FileIndex<string> {
  return buildFileIndex(paths.map((p) => ({ path: p.split('/'), handle: p })))
}

describe('commonSuffixDepth', () => {
  test('counts matching segments from the end', () => {
    expect(commonSuffixDepth(['a', 'b', 'c'], ['x', 'b', 'c'])).toBe(2)
  })

  test('is zero when the last segments differ', () => {
    expect(commonSuffixDepth(['a', 'b'], ['a', 'c'])).toBe(0)
  })

  test('stops at the shorter of the two', () => {
    expect(commonSuffixDepth(['c'], ['a', 'b', 'c'])).toBe(1)
  })
})

describe('matchLocation', () => {
  const moved = 'file://localhost/Users/old/Music/House/2019/Track.mp3'

  test('hits on a unique basename however different the prefix', () => {
    const result = matchLocation(index('Techno/Track.mp3'), moved)
    expect(result.kind).toBe('hit')
    if (result.kind === 'hit') {
      expect(result.entry.handle).toBe('Techno/Track.mp3')
      expect(result.depth).toBe(1)
    }
  })

  test('hits when the granted folder is a different volume entirely', () => {
    const result = matchLocation(index('House/2019/Track.mp3'), moved)
    expect(result.kind).toBe('hit')
    if (result.kind === 'hit') expect(result.entry.handle).toBe('House/2019/Track.mp3')
  })

  test('breaks a basename collision on the deepest shared parent', () => {
    const result = matchLocation(index('Disco/Track.mp3', 'House/2019/Track.mp3'), moved)
    expect(result.kind).toBe('hit')
    if (result.kind === 'hit') {
      expect(result.entry.handle).toBe('House/2019/Track.mp3')
      expect(result.depth).toBe(3)
    }
  })

  test('refuses to guess when two candidates tie on depth', () => {
    const result = matchLocation(index('A/2019/Track.mp3', 'B/2019/Track.mp3'), moved)
    expect(result).toEqual({ kind: 'ambiguous', count: 2 })
  })

  test('matches across NFD and NFC spellings', () => {
    const nfc = `file://localhost/Users/dj/Music/${'Jóga'.normalize('NFC')}.mp3`
    const result = matchLocation(index(`Björk/${'Jóga'.normalize('NFD')}.mp3`), nfc)
    expect(result.kind).toBe('hit')
  })

  test('matches across case differences', () => {
    expect(matchLocation(index('music/TRACK.MP3'), moved).kind).toBe('hit')
  })

  test('percent-decodes the library location before comparing', () => {
    const encoded = 'file://localhost/Users/dj/Some%20Track%20%232.mp3'
    expect(matchLocation(index('Some Track #2.mp3'), encoded).kind).toBe('hit')
  })

  test('misses when no file carries that name', () => {
    expect(matchLocation(index('Other.mp3'), moved)).toEqual({ kind: 'miss' })
  })

  test('misses against an empty index', () => {
    expect(matchLocation(index(), moved)).toEqual({ kind: 'miss' })
  })
})

describe('buildFileIndex', () => {
  test('reports how many files it holds', () => {
    expect(index('a.mp3', 'b/c.mp3').size).toBe(2)
  })

  test('buckets same-named files together', () => {
    const built = index('a/Track.mp3', 'b/Track.mp3')
    expect(built.byName.get('track.mp3')).toHaveLength(2)
  })
})
