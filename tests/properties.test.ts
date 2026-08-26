import { describe, expect, test } from 'vitest'
import { EMPTY_TRACK_FIELDS } from '../src/core/model'
import { PROPERTY_BY_KEY, TRACK_PROPERTIES, formatPropertyValue } from '../src/core/properties'
import { track } from './helpers'

describe('TRACK_PROPERTIES (v11 issue 1: the one registry)', () => {
  test('covers exactly every Track field except id, no duplicates', () => {
    const keys = TRACK_PROPERTIES.map((p) => p.key)
    const expected = ['title', ...Object.keys(EMPTY_TRACK_FIELDS)].sort()
    expect([...keys].sort()).toEqual(expected)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toHaveLength(32)
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

  test('the four descriptors are analysis-only percent properties (v35)', () => {
    for (const key of ['arousal', 'valence', 'danceability', 'happiness'] as const) {
      const p = PROPERTY_BY_KEY.get(key)
      expect(p?.kind, key).toBe('number')
      expect(p?.filterable, key).toBe(true)
      expect(p?.analysisOnly, key).toBe(true)
      expect(p?.max, key).toBe(100)
      expect(p?.hint, key).toBeTruthy()
    }
  })

  test('energy explains itself but is not analysis-only — a MIK comment also fills it', () => {
    const p = PROPERTY_BY_KEY.get('energy')
    expect(p?.hint).toBeTruthy()
    expect(p?.analysisOnly).toBeUndefined()
  })

  test("rating's filter ceiling comes from the registry, not a hardcoded key check", () => {
    expect(PROPERTY_BY_KEY.get('rating')?.max).toBe(5)
    expect(PROPERTY_BY_KEY.get('bpm')?.max).toBeUndefined()
  })

  test('a descriptor renders as a whole percentage, and a gap as an em dash', () => {
    expect(formatPropertyValue(track({ id: 'a', danceability: 97 }), 'danceability')).toBe('97%')
    expect(formatPropertyValue(track({ id: 'a', arousal: 0 }), 'arousal')).toBe('0%')
    expect(formatPropertyValue(track({ id: 'a' }), 'happiness')).toBe('—')
  })

  test('kinds match the value shapes', () => {
    expect(PROPERTY_BY_KEY.get('durationSec')?.kind).toBe('number')
    expect(PROPERTY_BY_KEY.get('playCount')?.kind).toBe('number')
    expect(PROPERTY_BY_KEY.get('lastPlayed')?.kind).toBe('date')
    expect(PROPERTY_BY_KEY.get('dateAdded')?.kind).toBe('date')
    expect(PROPERTY_BY_KEY.get('key')?.kind).toBe('key')
    expect(PROPERTY_BY_KEY.get('colour')?.kind).toBe('colour')
    expect(PROPERTY_BY_KEY.get('genre')?.kind).toBe('alpha')
    expect(PROPERTY_BY_KEY.get('location')?.kind).toBe('contains')
    expect(PROPERTY_BY_KEY.get('comments')?.kind).toBe('contains')
    expect(PROPERTY_BY_KEY.get('kind')?.kind).toBe('quality')
    expect(PROPERTY_BY_KEY.get('artist')?.kind).toBe('alpha')
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
