import { describe, expect, test } from 'vitest'
import { trackFromTags } from '../src/core/importers/id3'

describe('trackFromTags', () => {
  test('maps common tags onto the Track model, normalizing the key', () => {
    const track = trackFromTags('id3-0', 'seven-bridges.mp3', {
      title: 'Seven Bridges',
      artist: 'Kasteel',
      bpm: 174,
      key: 'F#m',
      genre: ['Drum & Bass'],
      year: 2023,
      durationSec: 334.2,
    })
    expect(track).toMatchObject({
      id: 'id3-0',
      title: 'Seven Bridges',
      artist: 'Kasteel',
      key: '11A',
      bpm: 174,
      genre: 'Drum & Bass',
      year: 2023,
      rating: null,
      durationSec: 334,
      location: 'seven-bridges.mp3',
    })
  })

  test('falls back to the file name when there is no title tag', () => {
    const track = trackFromTags('id3-1', 'Untitled Dub.wav', {})
    expect(track.title).toBe('Untitled Dub')
    expect(track.artist).toBeNull()
    expect(track.key).toBeNull()
    expect(track.bpm).toBeNull()
  })

  test('rounds fractional BPM tags', () => {
    expect(trackFromTags('x', 'a.mp3', { bpm: 122.5 }).bpm).toBe(122.5)
    expect(trackFromTags('x', 'a.mp3', { bpm: 0 }).bpm).toBeNull()
  })
})
