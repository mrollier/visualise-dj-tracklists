import { describe, expect, test } from 'vitest'
import { coverageLine, resolveTrack, summarize } from '../src/core/audio/coverage'
import { buildFileIndex } from '../src/core/audio/pathMatch'
import { track } from './helpers'

const playsEverything = () => true
const playsNothing = () => false

function index(...paths: string[]) {
  return buildFileIndex(paths.map((p) => ({ path: p.split('/'), handle: p })))
}

describe('resolveTrack', () => {
  test('resolves a matched, supported track to its handle', () => {
    const t = track({ id: 'a', location: 'file://localhost/Users/dj/Music/Track.mp3' })
    const result = resolveTrack(t, index('House/Track.mp3'), playsEverything)
    expect(result).toEqual({ kind: 'playable', handle: 'House/Track.mp3', verdict: 'supported' })
  })

  test('reports no-location for a sample track that has no file path', () => {
    const result = resolveTrack(track({ id: 'a' }), index('Track.mp3'), playsEverything)
    expect(result).toEqual({ kind: 'unplayable', reason: 'no-location' })
  })

  test('reports not-found when the folder has no such file', () => {
    const t = track({ id: 'a', location: 'file://localhost/Users/dj/Gone.mp3' })
    expect(resolveTrack(t, index('Track.mp3'), playsEverything)).toEqual({
      kind: 'unplayable',
      reason: 'not-found',
    })
  })

  test('reports ambiguous with the count when candidates tie', () => {
    const t = track({ id: 'a', location: 'file://localhost/Users/dj/Music/Track.mp3' })
    const result = resolveTrack(t, index('A/Track.mp3', 'B/Track.mp3'), playsEverything)
    expect(result).toEqual({ kind: 'unplayable', reason: 'ambiguous', ambiguousCount: 2 })
  })

  test('reports unsupported with the extension when the browser cannot play it', () => {
    const t = track({ id: 'a', location: 'file://localhost/Users/dj/Track.aiff' })
    const result = resolveTrack(t, index('Track.aiff'), playsNothing)
    expect(result).toEqual({ kind: 'unplayable', reason: 'unsupported', extension: 'aiff' })
  })

  test('still counts an ambiguous-codec container as playable', () => {
    const t = track({ id: 'a', location: 'file://localhost/Users/dj/Track.m4a' })
    const aacOnly = (mime: string) => mime === 'audio/mp4; codecs="mp4a.40.2"'
    const result = resolveTrack(t, index('Track.m4a'), aacOnly)
    expect(result).toEqual({ kind: 'playable', handle: 'Track.m4a', verdict: 'unknown' })
  })
})

describe('coverageLine', () => {
  test('leads with the playable count out of the total', () => {
    const report = summarize([
      { kind: 'playable', handle: 'x', verdict: 'supported' },
      { kind: 'playable', handle: 'y', verdict: 'unknown' },
    ])
    expect(coverageLine(report)).toBe('2 of 2 playable')
  })

  test('appends a clause per non-zero failure bucket', () => {
    const report = summarize([
      { kind: 'playable', handle: 'x', verdict: 'supported' },
      { kind: 'unplayable', reason: 'unsupported', extension: 'aiff' },
      { kind: 'unplayable', reason: 'not-found' },
      { kind: 'unplayable', reason: 'not-found' },
    ])
    expect(coverageLine(report)).toBe('1 of 4 playable · 1 unsupported format · 2 not found')
  })

  test('names the ambiguous and no-path buckets separately', () => {
    const report = summarize([
      { kind: 'unplayable', reason: 'ambiguous', ambiguousCount: 3 },
      { kind: 'unplayable', reason: 'no-location' },
    ])
    expect(coverageLine(report)).toBe('0 of 2 playable · 1 ambiguous · 1 without a file path')
  })

  test('says so plainly when the library is empty', () => {
    expect(coverageLine(summarize([]))).toBe('No tracks')
  })
})
