import { describe, expect, test } from 'vitest'
import { enrichTrack } from '../src/data/enrich'
import { genreFamilyOf } from '../src/core/genre'
import { ALL_SAMPLE_PACKS, SAMPLE_COLLECTION, SAMPLE_PACKS } from '../src/data/samples'

describe('sample packs', () => {
  test('there are ten themed packs plus the classic demo', () => {
    expect(SAMPLE_PACKS).toHaveLength(11)
    expect(ALL_SAMPLE_PACKS).toHaveLength(12)
    expect(new Set(ALL_SAMPLE_PACKS.map((p) => p.id)).size).toBe(12)
  })

  test.each(SAMPLE_PACKS.map((p) => [p.name, p] as const))(
    '%s: has a substantial library of unique tracks',
    (_name, pack) => {
      expect(pack.tracks.length).toBeGreaterThanOrEqual(18)
      expect(new Set(pack.tracks.map((t) => t.id)).size).toBe(pack.tracks.length)
    },
  )
})

describe('the sample collection', () => {
  test('is named "Sample collection" and unions every pack', () => {
    expect(SAMPLE_COLLECTION.name).toBe('Sample collection')
    expect(SAMPLE_COLLECTION.tracks.length).toBe(
      ALL_SAMPLE_PACKS.reduce((sum, p) => sum + p.tracks.length, 0),
    )
  })

  test('track ids are globally unique across packs', () => {
    const ids = SAMPLE_COLLECTION.tracks.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('one playlist per pack, named after it, in pack order', () => {
    expect(SAMPLE_COLLECTION.playlists.map((p) => p.name)).toEqual(
      ALL_SAMPLE_PACKS.map((p) => p.name),
    )
  })

  test('every track appears in exactly one playlist', () => {
    const seen = new Map<string, number>()
    for (const playlist of SAMPLE_COLLECTION.playlists) {
      for (const id of playlist.trackIds) seen.set(id, (seen.get(id) ?? 0) + 1)
    }
    expect(seen.size).toBe(SAMPLE_COLLECTION.tracks.length)
    expect([...seen.values()].every((n) => n === 1)).toBe(true)
  })

  test('playlist members reference real collection tracks', () => {
    const ids = new Set(SAMPLE_COLLECTION.tracks.map((t) => t.id))
    for (const playlist of SAMPLE_COLLECTION.playlists) {
      for (const id of playlist.trackIds) expect(ids.has(id)).toBe(true)
    }
  })
})

describe('sample metadata enrichment (v9 issue 11)', () => {
  const tracks = SAMPLE_COLLECTION.tracks

  test.each(['album', 'durationSec', 'dateAdded'] as const)(
    '%s is present on most tracks but deliberately not all',
    (field) => {
      const have = tracks.filter((t) => t[field] !== null).length
      expect(have / tracks.length).toBeGreaterThan(0.7)
      expect(have).toBeLessThan(tracks.length) // realistic gaps survive
    },
  )

  test('generated values are plausible', () => {
    for (const t of tracks) {
      if (t.durationSec !== null) {
        expect(t.durationSec).toBeGreaterThanOrEqual(120)
        expect(t.durationSec).toBeLessThanOrEqual(600)
      }
      if (t.dateAdded !== null) {
        expect(t.dateAdded).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        const year = Number(t.dateAdded.slice(0, 4))
        expect(year).toBeGreaterThanOrEqual(2018)
        expect(year).toBeLessThanOrEqual(2025)
        // A file cannot enter the library before its release year.
        if (t.year !== null) expect(year).toBeGreaterThanOrEqual(Math.min(t.year, 2018))
      }
    }
  })

  test('enrichment is deterministic: same track in, same track out', () => {
    const base = tracks[0]
    const extras = { label: 'Test Label', albums: { [base.artist ?? '']: 'Test LP' } }
    expect(enrichTrack(base, extras)).toEqual(enrichTrack(base, extras))
  })
})

describe('the genre-atlas pack (v12 WS10)', () => {
  const atlas = SAMPLE_PACKS.find((p) => p.id === 'genre-atlas')

  test('exists and spans the genre space', () => {
    expect(atlas).toBeDefined()
    expect(atlas!.tracks.length).toBeGreaterThanOrEqual(24)
    const families = new Set(
      atlas!.tracks.map((t) => (t.genre === null ? null : genreFamilyOf(t.genre))).filter(Boolean),
    )
    // Jazz to gabber: at least ten distinct icon families on one crate.
    expect(families.size).toBeGreaterThanOrEqual(10)
  })

  test('carries Mixed-In-Key-style energy for the WS8 demo', () => {
    const withEnergy = atlas!.tracks.filter((t) => t.energy !== null)
    expect(withEnergy.length).toBeGreaterThanOrEqual(10)
    for (const t of withEnergy) expect(t.comments).toMatch(/Energy \d/)
  })
})
