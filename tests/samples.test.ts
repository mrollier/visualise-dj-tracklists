import { describe, expect, test } from 'vitest'
import { ALL_SAMPLE_PACKS, SAMPLE_COLLECTION, SAMPLE_PACKS } from '../src/data/samples'

describe('sample packs', () => {
  test('there are ten themed packs plus the classic demo', () => {
    expect(SAMPLE_PACKS).toHaveLength(10)
    expect(ALL_SAMPLE_PACKS).toHaveLength(11)
    expect(new Set(ALL_SAMPLE_PACKS.map((p) => p.id)).size).toBe(11)
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
