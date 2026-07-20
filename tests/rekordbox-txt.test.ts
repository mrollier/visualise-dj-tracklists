import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { importRekordboxTxt, isRekordboxTxt } from '../src/core/importers/rekordboxTxt'

function fixtureBuffer(): ArrayBuffer {
  const buf = readFileSync('tests/fixtures/playlist-utf16.txt')
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

function toBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer
}

describe('Rekordbox TXT playlist import', () => {
  test('detects a Rekordbox export by UTF-16 BOM or tab-separated header', () => {
    expect(isRekordboxTxt(fixtureBuffer())).toBe(true)
    expect(isRekordboxTxt(toBuffer('#\tArtist\tTrack Title\n1\tX\tY\n'))).toBe(true)
    expect(isRekordboxTxt(toBuffer('title,artist,bpm\nFoo,Bar,128\n'))).toBe(false)
  })

  test('decodes UTF-16 and imports the rows in playlist order', () => {
    const { tracks } = importRekordboxTxt(fixtureBuffer())
    expect(tracks.map((t) => t.title)).toEqual([
      'Tension Coil',
      "I'm a Dreamer",
      'Sud',
      'No Key Here',
      'Closer',
    ])
    expect(tracks[0].id).toBe('txt-0')
    expect(tracks[0].artist).toBe('Voltkraft')
    expect(tracks[0].genre).toBe('Techno')
  })

  test('parses BPM decimals, Camelot keys and MM:SS times', () => {
    const { tracks } = importRekordboxTxt(fixtureBuffer())
    expect(tracks[0].bpm).toBe(157)
    expect(tracks[0].key).toBe('5B')
    expect(tracks[0].durationSec).toBe(6 * 60 + 45)
    expect(tracks[4].durationSec).toBe(3600 + 2 * 60 + 3) // H:MM:SS
    expect(tracks[4].bpm).toBeNull() // 0.00 = unknown
    expect(tracks[3].key).toBeNull() // empty key cell
  })

  test('converts asterisk ratings to stars, empty to null', () => {
    const { tracks } = importRekordboxTxt(fixtureBuffer())
    expect(tracks[0].rating).toBe(5)
    expect(tracks[1].rating).toBe(3)
    expect(tracks[2].rating).toBeNull()
  })

  test('release year is unknown (Date Added is not a release date)', () => {
    const { tracks } = importRekordboxTxt(fixtureBuffer())
    expect(tracks.every((t) => t.year === null)).toBe(true)
  })

  test('skips rows without a title, reporting them', () => {
    const { tracks, report } = importRekordboxTxt(fixtureBuffer())
    expect(tracks).toHaveLength(5)
    expect(report.total).toBe(5)
    expect(report.errors.some((e) => /no title/i.test(e))).toBe(true)
  })

  test('plain UTF-8 tab-separated exports work too', () => {
    const text = '#\tArtist\tTrack Title\tBPM\tKey\n1\tA\tOne\t128.00\t8A\n'
    const { tracks } = importRekordboxTxt(toBuffer(text))
    expect(tracks).toHaveLength(1)
    expect(tracks[0].title).toBe('One')
    expect(tracks[0].bpm).toBe(128)
    expect(tracks[0].key).toBe('8A')
  })
})
