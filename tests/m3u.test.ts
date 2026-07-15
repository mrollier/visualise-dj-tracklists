import { describe, expect, test } from 'vitest'
import { exportM3u } from '../src/core/exporters/m3u'
import { importM3u, rematchAfterImport } from '../src/core/importers/m3u'
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

const library = [
  track({
    id: 'a',
    title: 'Midnight Drive',
    artist: 'Nova Pulse',
    location: 'file://localhost/Users/dj/Music/midnight%20drive.mp3',
    durationSec: 372,
  }),
  track({ id: 'b', title: 'Glasswork', artist: 'Aurora Fields' }),
  track({ id: 'c', title: 'Seven Bridges', artist: 'Kasteel' }),
]

describe('importM3u', () => {
  test('matches entries to library tracks by file basename', () => {
    const m3u = ['#EXTM3U', '#EXTINF:372,whatever', '/somewhere/else/midnight drive.mp3'].join('\n')
    const result = importM3u(m3u, library)
    expect(result.tracklist).toEqual(['a'])
    expect(result.newTracks).toEqual([])
  })

  test('falls back to matching by "artist - title"', () => {
    const m3u = ['#EXTM3U', '#EXTINF:-1,Aurora Fields - Glasswork', 'missing/path.mp3'].join('\n')
    const result = importM3u(m3u, library)
    expect(result.tracklist).toEqual(['b'])
  })

  test('unmatched entries become minimal new tracks, in playlist order', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:301,Kasteel - Seven Bridges',
      '/music/seven-bridges.aiff',
      '#EXTINF:245,Unknown Artist - Never Heard Of It',
      '/music/never-heard.mp3',
    ].join('\n')
    const result = importM3u(m3u, library)
    expect(result.tracklist).toHaveLength(2)
    expect(result.tracklist[0]).toBe('c')
    expect(result.newTracks).toHaveLength(1)
    expect(result.newTracks[0]).toMatchObject({
      title: 'Never Heard Of It',
      artist: 'Unknown Artist',
      durationSec: 245,
      location: '/music/never-heard.mp3',
    })
    expect(result.tracklist[1]).toBe(result.newTracks[0].id)
  })

  test('paths without EXTINF still import using the file name as title', () => {
    const m3u = ['/music/found-tape.wav'].join('\n')
    const result = importM3u(m3u, [])
    expect(result.newTracks[0].title).toBe('found-tape')
  })

  test('round-trips our own exporter output against the same library', () => {
    const m3u = exportM3u([library[0]])
    const result = importM3u(m3u, library)
    expect(result.tracklist).toEqual(['a'])
  })

  test('empty input reports an error', () => {
    const result = importM3u('', [])
    expect(result.tracklist).toEqual([])
    expect(result.report.errors.length).toBeGreaterThan(0)
  })
})

describe('rematchAfterImport', () => {
  const bare = (id: string, overrides: Partial<Track>): Track => ({
    id,
    title: id,
    artist: null,
    key: null,
    bpm: null,
    genre: null,
    year: null,
    rating: null,
    durationSec: null,
    location: null,
    ...overrides,
  })

  test('re-points a bare m3u track matched by location basename', () => {
    const bareTrack = bare('m3u-0-midnight drive.mp3', {
      title: 'midnight drive',
      location: '/old/laptop/midnight drive.mp3',
    })
    const result = rematchAfterImport([bareTrack], ['m3u-0-midnight drive.mp3'], [library[0]])
    expect(result.tracklist).toEqual(['a'])
    expect(result.library).toEqual([library[0]])
    expect(result.matched).toBe(1)
  })

  test('re-points a bare m3u track matched by artist and title', () => {
    const bareTrack = bare('m3u-0-x.mp3', {
      title: 'Glasswork',
      artist: 'aurora fields',
      location: '/elsewhere/x.mp3',
    })
    const result = rematchAfterImport([bareTrack], ['m3u-0-x.mp3'], library)
    expect(result.tracklist).toEqual(['b'])
    expect(result.matched).toBe(1)
  })

  test('unmatched bare tracks survive in both library and tracklist', () => {
    const bareTrack = bare('m3u-0-obscure.mp3', {
      title: 'Obscure Dub',
      location: '/music/obscure.mp3',
    })
    const result = rematchAfterImport([bareTrack], ['m3u-0-obscure.mp3'], library)
    expect(result.tracklist).toEqual(['m3u-0-obscure.mp3'])
    expect(result.library).toContainEqual(bareTrack)
    expect(result.matched).toBe(0)
  })

  test('drops tracklist ids from the replaced library that are not bare m3u tracks', () => {
    const sampleTrack = track({ id: 'sample-1', title: 'Old Thing' })
    const bareTrack = bare('m3u-0-midnight drive.mp3', {
      location: '/x/midnight drive.mp3',
    })
    const result = rematchAfterImport(
      [sampleTrack, bareTrack],
      ['sample-1', 'm3u-0-midnight drive.mp3'],
      [library[0]],
    )
    expect(result.tracklist).toEqual(['a'])
    expect(result.library).toEqual([library[0]])
  })

  test('round trip: m3u import without a library, then collection import, yields a fully matched set', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:334,Kasteel - Seven Bridges',
      '/Users/dj/Music/seven-bridges.aiff',
      '#EXTINF:372,Nova Pulse - Midnight Drive',
      '/Users/dj/Music/midnight drive.mp3',
    ].join('\n')
    const first = importM3u(m3u, [])
    expect(first.newTracks).toHaveLength(2)

    const result = rematchAfterImport(first.newTracks, first.tracklist, library)
    expect(result.tracklist).toEqual(['c', 'a'])
    expect(result.library).toEqual(library)
    expect(result.matched).toBe(2)
  })
})
