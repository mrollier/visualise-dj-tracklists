import { describe, expect, test } from 'vitest'
import { exportTracklistCsv } from '../src/core/exporters/csv'
import { ensureExtension } from '../src/core/exporters/filename'
import { exportM3u } from '../src/core/exporters/m3u'
import { importCsv } from '../src/core/importers/csv'
import type { Track } from '../src/core/model'

const tracks: Track[] = [
  {
    id: 'a',
    title: 'Midnight Drive',
    artist: 'Nova Pulse',
    key: '8A',
    bpm: 128,
    genre: 'Techno',
    year: 2019,
    rating: 4,
    durationSec: 372,
    album: 'Night Shift EP',
    dateAdded: '2020-03-14',
    location: 'file://localhost/Users/dj/Music/midnight%20drive.mp3',
  },
  {
    id: 'b',
    title: 'Glasswork',
    artist: null,
    key: null,
    bpm: null,
    genre: null,
    year: null,
    rating: null,
    durationSec: null,
    album: null,
    dateAdded: null,
    location: null,
  },
]

describe('exportM3u', () => {
  const m3u = exportM3u(tracks)

  test('starts with the extended header', () => {
    expect(m3u.startsWith('#EXTM3U\n')).toBe(true)
  })

  test('writes EXTINF with duration and artist - title, then a decoded path', () => {
    expect(m3u).toContain('#EXTINF:372,Nova Pulse - Midnight Drive')
    expect(m3u).toContain('/Users/dj/Music/midnight drive.mp3')
    expect(m3u).not.toContain('file://localhost')
  })

  test('tracks without a file location become comments instead of broken entries', () => {
    expect(m3u).toContain('# no file location: Glasswork')
    // The title must not appear as a bare playlist entry line
    const lines = m3u.split('\n')
    expect(lines).not.toContain('Glasswork')
  })
})

describe('exportTracklistCsv', () => {
  const csv = exportTracklistCsv(tracks)

  test('round-trips through the CSV importer', () => {
    const { tracks: back, report } = importCsv(csv)
    expect(report.errors).toEqual([])
    expect(back).toHaveLength(2)
    expect(back[0]).toMatchObject({
      title: 'Midnight Drive',
      artist: 'Nova Pulse',
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2019,
      rating: 4,
    })
    expect(back[1].key).toBeNull()
  })

  test('quotes fields containing commas', () => {
    const withComma = [{ ...tracks[0], title: 'One, Two' }]
    const out = exportTracklistCsv(withComma)
    expect(out).toContain('"One, Two"')
    const { tracks: back } = importCsv(out)
    expect(back[0].title).toBe('One, Two')
  })
})

describe('ensureExtension', () => {
  test('appends the extension when missing', () => {
    expect(ensureExtension('my set', '.m3u8')).toBe('my set.m3u8')
  })

  test('keeps an existing extension, case-insensitively', () => {
    expect(ensureExtension('set.m3u8', '.m3u8')).toBe('set.m3u8')
    expect(ensureExtension('SET.M3U8', '.m3u8')).toBe('SET.M3U8')
  })

  test('trims surrounding whitespace', () => {
    expect(ensureExtension('  project ', '.json')).toBe('project.json')
  })

  test('a different extension is treated as part of the name', () => {
    expect(ensureExtension('set.v2', '.csv')).toBe('set.v2.csv')
  })
})
