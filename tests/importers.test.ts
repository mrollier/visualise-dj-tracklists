import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { importRekordboxXml } from '../src/core/importers/rekordbox'
import { importCsv } from '../src/core/importers/csv'

const rekordboxXml = readFileSync(join(__dirname, 'fixtures', 'rekordbox.xml'), 'utf-8')

describe('importRekordboxXml', () => {
  const { tracks, report } = importRekordboxXml(rekordboxXml)

  test('imports every TRACK in the collection', () => {
    expect(tracks).toHaveLength(4)
    expect(report.total).toBe(4)
    expect(report.errors).toEqual([])
  })

  test('maps core fields onto the Track model', () => {
    const t = tracks[0]
    expect(t.title).toBe('Midnight Drive')
    expect(t.artist).toBe('Nova Pulse')
    expect(t.genre).toBe('Techno')
    expect(t.year).toBe(2019)
    expect(t.bpm).toBe(128)
    expect(t.durationSec).toBe(372)
    expect(t.location).toBe('file://localhost/Users/dj/Music/midnight-drive.mp3')
  })

  test('normalizes Tonality regardless of notation', () => {
    expect(tracks[0].key).toBe('8A') // already Camelot
    expect(tracks[1].key).toBe('8A') // classical "Am"
    expect(tracks[3].key).toBe('11A') // classical "F#m"
  })

  test('converts Rekordbox 0–255 rating to 0–5 stars', () => {
    expect(tracks[0].rating).toBe(4) // 204
    expect(tracks[1].rating).toBe(5) // 255
    expect(tracks[3].rating).toBe(3) // 153
  })

  test('treats empty and zero placeholder values as missing', () => {
    const t = tracks[2] // "Untitled Dub"
    expect(t.artist).toBeNull()
    expect(t.key).toBeNull()
    expect(t.bpm).toBeNull() // AverageBpm="0.00" is a placeholder, not a tempo
    expect(t.year).toBeNull() // Year="0" likewise
    expect(t.genre).toBeNull()
    expect(t.rating).toBe(0) // rating 0 is a valid "unrated" value, kept as 0
  })

  test('reports per-field missing counts', () => {
    expect(report.missing.key).toBe(1)
    expect(report.missing.bpm).toBe(1)
    expect(report.missing.genre).toBe(1)
    expect(report.missing.year).toBe(1)
  })

  test('assigns stable unique ids', () => {
    const ids = tracks.map((t) => t.id)
    expect(new Set(ids).size).toBe(4)
    expect(ids[0]).toBe('rb-101')
  })

  test('rejects XML that is not a Rekordbox collection', () => {
    const { tracks: none, report: bad } = importRekordboxXml('<foo><bar/></foo>')
    expect(none).toEqual([])
    expect(bad.errors.length).toBeGreaterThan(0)
  })
})

describe('importCsv', () => {
  test('imports rows with canonical headers', () => {
    const csv = [
      'title,artist,key,bpm,genre,year,rating',
      'Midnight Drive,Nova Pulse,8A,128,Techno,2019,4',
      'Glasswork,Aurora Fields,Am,122.5,Melodic House,2021,5',
    ].join('\n')
    const { tracks, report } = importCsv(csv)
    expect(report.total).toBe(2)
    expect(tracks[0]).toMatchObject({
      title: 'Midnight Drive',
      artist: 'Nova Pulse',
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2019,
      rating: 4,
    })
    expect(tracks[1].key).toBe('8A') // classical notation normalized
  })

  test('auto-maps common header synonyms case-insensitively', () => {
    const csv = ['Track Name;ARTIST;Tonality;Tempo', 'Seven Bridges;Kasteel;F#m;174'].join('\n')
    const { tracks } = importCsv(csv)
    expect(tracks[0].title).toBe('Seven Bridges')
    expect(tracks[0].artist).toBe('Kasteel')
    expect(tracks[0].key).toBe('11A')
    expect(tracks[0].bpm).toBe(174)
  })

  test('missing columns and empty cells become null and are reported', () => {
    const csv = ['title,bpm', 'No Key Track,140', 'No BPM Track,'].join('\n')
    const { tracks, report } = importCsv(csv)
    expect(tracks[0].key).toBeNull()
    expect(tracks[1].bpm).toBeNull()
    expect(report.missing.key).toBe(2)
    expect(report.missing.bpm).toBe(1)
  })

  test('rows without a title are skipped with an error', () => {
    const csv = ['title,artist', 'Good Track,Someone', ',Nameless'].join('\n')
    const { tracks, report } = importCsv(csv)
    expect(tracks).toHaveLength(1)
    expect(report.errors).toHaveLength(1)
  })

  test('empty input yields an empty result with an error', () => {
    const { tracks, report } = importCsv('')
    expect(tracks).toEqual([])
    expect(report.errors.length).toBeGreaterThan(0)
  })
})
