import { describe, expect, test } from 'vitest'
import { DEFAULT_CRITERIA, type CriteriaConfig } from '../src/core/combos'
import type { Track } from '../src/core/model'
import { suggestNext, suggestWalk } from '../src/core/suggest'

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

  test('without a seed, the opening track varies with the seed (fully random start)', () => {
    const clique = Array.from({ length: 6 }, (_, i) => track({ id: `t${i}` }))
    const starts = new Set(
      Array.from(
        { length: 10 },
        (_, seed) => suggestWalk(clique, config(), { length: 3, seed })[0],
      ),
    )
    expect(starts.size).toBeGreaterThan(1)
  })

  test('without a seed, never opens on an isolated track while connected ones exist', () => {
    for (let seed = 0; seed < 12; seed++) {
      const walk = suggestWalk(tracks, config(), { length: 5, seed })
      expect(walk[0]).not.toBe('e')
    }
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

  test('prefers the candidate whose genre is more similar, all else equal', () => {
    // Both candidates match a on key/bpm/year; genre matches neither at the
    // 0.5 graph threshold — but tech house (0.36) beats folk (~0), so the
    // continuous similarity should break the tie despite the id order.
    const cfg = config()
    cfg.genre = { enabled: true, method: 'graph', mode: 'threshold', k: 5, threshold: 0.5 }
    const trio = [
      track({ id: 'a', genre: 'Techno' }),
      track({ id: 'x1', genre: 'Folk' }),
      track({ id: 'x2', genre: 'Tech House' }),
    ]
    const walk = suggestWalk(trio, cfg, { seedId: 'a', length: 2 })
    expect(walk).toEqual(['a', 'x2'])
  })

  test('with half/double enabled, an exact double-time candidate beats a drifted same-time one', () => {
    const cfg = config()
    cfg.bpm.halfDouble = true
    const trio = [
      track({ id: 'a', bpm: 87 }),
      track({ id: 'x1', bpm: 92 }), // same-time but 5 BPM off
      track({ id: 'x2', bpm: 174 }), // exact double
    ]
    const walk = suggestWalk(trio, cfg, { seedId: 'a', length: 2 })
    expect(walk).toEqual(['a', 'x2'])
  })

  test('randomness 0 is deterministic regardless of seed', () => {
    const a = suggestWalk(tracks, config(), { seedId: 'a', length: 10, randomness: 0, seed: 1 })
    const b = suggestWalk(tracks, config(), { seedId: 'a', length: 10, randomness: 0, seed: 99 })
    expect(a).toEqual(b)
  })

  test('with randomness, the same seed reproduces the same walk', () => {
    const a = suggestWalk(tracks, config(), { seedId: 'a', length: 10, randomness: 1, seed: 3 })
    const b = suggestWalk(tracks, config(), { seedId: 'a', length: 10, randomness: 1, seed: 3 })
    expect(a).toEqual(b)
  })

  test('with randomness, different seeds can produce different walks', () => {
    // A clique of equivalent tracks: any order is a valid walk.
    const clique = Array.from({ length: 6 }, (_, i) => track({ id: `t${i}` }))
    const walks = new Set(
      Array.from({ length: 8 }, (_, seed) =>
        suggestWalk(clique, config(), { seedId: 't0', length: 6, randomness: 1, seed }).join(','),
      ),
    )
    expect(walks.size).toBeGreaterThan(1)
  })

  describe('pinned endpoints', () => {
    // Year chain at threshold 4: only adjacent pairs are combo edges.
    const chain = [
      track({ id: 'a', year: 2000 }),
      track({ id: 'b', year: 2003 }),
      track({ id: 'c', year: 2006 }),
      track({ id: 'd', year: 2009 }),
    ]

    test('a pinned end makes the walk finish there', () => {
      const walk = suggestWalk(chain, config({ threshold: 4 }), {
        seedId: 'a',
        endId: 'd',
        length: 3,
      })
      expect(walk[0]).toBe('a')
      expect(walk.at(-1)).toBe('d')
      expect(walk).toHaveLength(3)
      expect(new Set(walk).size).toBe(3)
    })

    test('pinned first and last, full length: all tracks distinct', () => {
      const clique = Array.from({ length: 6 }, (_, i) => track({ id: `t${i}` }))
      const walk = suggestWalk(clique, config(), {
        seedId: 't0',
        endId: 't5',
        length: 6,
        randomness: 1,
        seed: 2,
      })
      expect(walk[0]).toBe('t0')
      expect(walk.at(-1)).toBe('t5')
      expect(walk).toHaveLength(6)
      expect(new Set(walk).size).toBe(6)
    })

    test('a pinned end alone still closes the walk, with a random opener', () => {
      const walk = suggestWalk(chain, config({ threshold: 4 }), { endId: 'd', length: 2, seed: 1 })
      expect(walk.at(-1)).toBe('d')
      expect(walk).toHaveLength(2)
    })

    test('the same seed reproduces the same pinned walk', () => {
      const opts = { seedId: 'a', endId: 'd', length: 4, randomness: 1, seed: 7 }
      expect(suggestWalk(chain, config({ threshold: 4 }), opts)).toEqual(
        suggestWalk(chain, config({ threshold: 4 }), opts),
      )
    })
  })
})

describe('suggestNext', () => {
  // a—b—c chain (year steps at threshold 4), plus d only reachable from c.
  const chain = [
    track({ id: 'a', year: 2000 }),
    track({ id: 'b', year: 2003 }),
    track({ id: 'c', year: 2006 }),
    track({ id: 'd', year: 2009 }),
  ]
  const chainCfg = () => config({ threshold: 4 })

  test('appends the best neighbour of the last track', () => {
    const next = suggestNext(chain, chainCfg(), ['a'], {})
    expect(next).toEqual({ trackId: 'b', insertIndex: 1 })
  })

  test('inserts between the selected track and its successor', () => {
    // Set is a → c with a gap; selecting a should slot b in between.
    const next = suggestNext(chain, chainCfg(), ['a', 'c'], { selectedId: 'a' })
    expect(next).toEqual({ trackId: 'b', insertIndex: 1 })
  })

  test('a selected last track appends after itself', () => {
    const next = suggestNext(chain, chainCfg(), ['a', 'b'], { selectedId: 'b' })
    expect(next).toEqual({ trackId: 'c', insertIndex: 2 })
  })

  test('never suggests a track already in the set', () => {
    const next = suggestNext(chain, chainCfg(), ['b', 'a'], {})
    // a's only neighbour is b, which is already used
    expect(next).toBeNull()
  })

  test('an empty set starts with the selection, or the best-connected track', () => {
    expect(suggestNext(chain, chainCfg(), [], { selectedId: 'c' })).toEqual({
      trackId: 'c',
      insertIndex: 0,
    })
    expect(suggestNext(chain, chainCfg(), [], {})).toEqual({ trackId: 'b', insertIndex: 0 })
  })

  test('returns null for an empty library', () => {
    expect(suggestNext([], chainCfg(), [], {})).toBeNull()
  })
})
