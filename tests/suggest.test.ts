import { describe, expect, test } from 'vitest'
import { DEFAULT_CRITERIA, type CriteriaConfig } from '../src/core/combos'
import type { Track } from '../src/core/model'
import { suggestWalk } from '../src/core/suggest'

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

function config(overrides: Partial<CriteriaConfig> = {}): CriteriaConfig {
  return { ...structuredClone(DEFAULT_CRITERIA), ...overrides }
}

// A small chain: a—b—c are strongly connected, d hangs off c, e is isolated.
const tracks = [
  track({ id: 'a', key: '8A', bpm: 128 }),
  track({ id: 'b', key: '8A', bpm: 130 }),
  track({ id: 'c', key: '9A', bpm: 132 }),
  track({ id: 'd', key: '10A', bpm: 134, genre: 'Trance', year: 1999 }),
  track({ id: 'e', key: '3B', bpm: 90, genre: 'Ambient', year: 1980 }),
]

describe('suggestWalk', () => {
  test('starts from the given seed and walks the combo graph', () => {
    const walk = suggestWalk(tracks, config(), { seedId: 'a', length: 10 })
    expect(walk[0]).toBe('a')
    expect(walk.length).toBeGreaterThanOrEqual(3)
  })

  test('never repeats a track', () => {
    const walk = suggestWalk(tracks, config(), { seedId: 'a', length: 10 })
    expect(new Set(walk).size).toBe(walk.length)
  })

  test('every consecutive pair is a combo edge', async () => {
    const { evaluateCombo } = await import('../src/core/combos')
    const byId = new Map(tracks.map((t) => [t.id, t]))
    const walk = suggestWalk(tracks, config(), { seedId: 'a', length: 10 })
    for (let i = 1; i < walk.length; i++) {
      const result = evaluateCombo(byId.get(walk[i - 1])!, byId.get(walk[i])!, config())
      expect(result.isCombo).toBe(true)
    }
  })

  test('respects the target length', () => {
    const walk = suggestWalk(tracks, config(), { seedId: 'a', length: 2 })
    expect(walk).toHaveLength(2)
  })

  test('without a seed, starts from the best-connected track', () => {
    // Year chain at threshold 4: a(2000)–b(2003)–c(2006)–d(2009); only
    // adjacent pairs match all four criteria, so b and c have degree 2 and
    // the id tie-break picks b.
    const chain = [
      track({ id: 'a', year: 2000 }),
      track({ id: 'b', year: 2003 }),
      track({ id: 'c', year: 2006 }),
      track({ id: 'd', year: 2009 }),
    ]
    const walk = suggestWalk(chain, config({ threshold: 4 }), { length: 10 })
    expect(walk[0]).toBe('b')
  })

  test('is deterministic', () => {
    const first = suggestWalk(tracks, config(), { seedId: 'a', length: 10 })
    const second = suggestWalk(tracks, config(), { seedId: 'a', length: 10 })
    expect(first).toEqual(second)
  })

  test('an isolated seed yields a one-track walk', () => {
    const walk = suggestWalk(tracks, config(), { seedId: 'e', length: 10 })
    expect(walk).toEqual(['e'])
  })

  test('empty library yields an empty walk', () => {
    expect(suggestWalk([], config(), { length: 5 })).toEqual([])
  })
})
