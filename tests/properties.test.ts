import { describe, expect, test } from 'vitest'
import { EMPTY_TRACK_FIELDS, type Track } from '../src/core/model'
import { PROPERTY_BY_KEY, TRACK_PROPERTIES, formatPropertyValue } from '../src/core/properties'

function track(overrides: Partial<Track> & { id: string }): Track {
  return { ...EMPTY_TRACK_FIELDS, title: overrides.id, ...overrides }
}

describe('TRACK_PROPERTIES (v11 issue 1: the one registry)', () => {
  test('covers exactly every Track field except id and isVinyl, no duplicates', () => {
    const keys = TRACK_PROPERTIES.map((p) => p.key)
    // isVinyl is a boolean flag (v12 WS13): the registry's kinds are all
    // range-shaped, so it stays a card-level flag until a 'flag' kind exists
    // (the same deliberate gap as v11's colour-checklist non-goal).
    const expected = ['title', ...Object.keys(EMPTY_TRACK_FIELDS)]
      .filter((k) => k !== 'isVinyl')
      .sort()
    expect([...keys].sort()).toEqual(expected)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toHaveLength(28)
  })

  test('keeps the classic seven first and location last', () => {
    expect(TRACK_PROPERTIES.slice(0, 7).map((p) => p.key)).toEqual([
      'artist',
      'title',
      'key',
      'bpm',
      'genre',
      'year',
      'rating',
    ])
    expect(TRACK_PROPERTIES.at(-1)?.key).toBe('location')
  })

  test('kinds match the value shapes', () => {
    expect(PROPERTY_BY_KEY.get('durationSec')?.kind).toBe('number')
    expect(PROPERTY_BY_KEY.get('playCount')?.kind).toBe('number')
    expect(PROPERTY_BY_KEY.get('lastPlayed')?.kind).toBe('date')
    expect(PROPERTY_BY_KEY.get('dateAdded')?.kind).toBe('date')
    expect(PROPERTY_BY_KEY.get('key')?.kind).toBe('key')
    expect(PROPERTY_BY_KEY.get('colour')?.kind).toBe('text')
    expect(PROPERTY_BY_KEY.get('genre')?.kind).toBe('text')
    expect(PROPERTY_BY_KEY.get('location')?.kind).toBe('text')
  })

  test('every property is filterable (genre included, per the v11 decision)', () => {
    expect(TRACK_PROPERTIES.every((p) => p.filterable)).toBe(true)
  })

  test('every property carries a non-empty label', () => {
    expect(TRACK_PROPERTIES.every((p) => p.label.length > 0)).toBe(true)
    expect(PROPERTY_BY_KEY.get('durationSec')?.label).toBe('Length')
    expect(PROPERTY_BY_KEY.get('location')?.label).toBe('Location')
  })
})

describe('formatPropertyValue (cell text, lifted out of TracksView)', () => {
  test('missing renders as an em dash', () => {
    expect(formatPropertyValue(track({ id: 'a', bpm: null }), 'bpm')).toBe('—')
    expect(formatPropertyValue(track({ id: 'a' }), 'artist')).toBe('—')
  })

  test('duration renders m:ss with zero-padded seconds', () => {
    expect(formatPropertyValue(track({ id: 'a', durationSec: 245 }), 'durationSec')).toBe('4:05')
    expect(formatPropertyValue(track({ id: 'a', durationSec: 60 }), 'durationSec')).toBe('1:00')
  })

  test('size renders in MB with one decimal', () => {
    expect(formatPropertyValue(track({ id: 'a', size: 5 * 1024 * 1024 }), 'size')).toBe('5.0 MB')
  })

  test('plain values pass through as strings', () => {
    expect(formatPropertyValue(track({ id: 'a', artist: 'Rone' }), 'artist')).toBe('Rone')
    expect(formatPropertyValue(track({ id: 'a', year: 2021 }), 'year')).toBe('2021')
  })
})
