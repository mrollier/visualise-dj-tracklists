import { describe, expect, test } from 'vitest'
import { DEFAULT_CRITERIA, type CriteriaConfig } from '../src/core/combos'
import { EMPTY_TRACK_FIELDS, type Track } from '../src/core/model'
import {
  nextAnchorId,
  nextExhausted,
  progressionFit,
  retryState,
  suggestNext,
  suggestWalk,
} from '../src/core/suggest'

function track(overrides: Partial<Track> & { id: string }): Track {
  return {
    ...EMPTY_TRACK_FIELDS,
    title: overrides.id,
    key: '8A',
    bpm: 128,
    genre: 'Techno',
    year: 2020,
    rating: 4,
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

describe('threshold 0: every track neighbours every other (v11 issue 2a)', () => {
  test('suggestWalk reaches the full length even across the isolated track', () => {
    const walk = suggestWalk(tracks, config({ threshold: 0 }), { seedId: 'a', length: 5 }).ids
    expect(walk).toHaveLength(5)
    expect([...walk].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  test('suggestNext extends an otherwise-exhausted anchor without force', () => {
    // 'e' is isolated under the default criteria — at threshold 0 it still
    // gets a successor.
    const next = suggestNext(tracks, config({ threshold: 0 }), ['e'])
    expect(next).not.toBeNull()
  })

  test('nextExhausted is never exhausted while the graph is complete', () => {
    const empty = new Map<string, Set<string>>()
    expect(nextExhausted(empty, ['a'], null, true)).toBe(false)
    expect(nextExhausted(empty, ['a'], null, false)).toBe(true)
  })

  test('retryState offers a matching retry while the graph is complete', () => {
    const empty = new Map<string, Set<string>>()
    const pick = { trackId: 'b', insertIndex: 1 }
    expect(retryState(empty, ['a', 'b'], pick, [], ['a', 'b', 'c'], true)).toBe('retry')
    expect(retryState(empty, ['a', 'b'], pick, [], ['a', 'b', 'c'], false)).toBe('force-retry')
  })
})

describe('suggestWalk', () => {
  test('starts from the given seed and walks the combo graph', () => {
    const walk = suggestWalk(tracks, config(), { seedId: 'a', length: 10 }).ids
    expect(walk[0]).toBe('a')
    expect(walk.length).toBeGreaterThanOrEqual(3)
  })

  test('never repeats a track', () => {
    const walk = suggestWalk(tracks, config(), { seedId: 'a', length: 10 }).ids
    expect(new Set(walk).size).toBe(walk.length)
  })

  test('every consecutive pair is a combo edge', async () => {
    const { evaluateCombo } = await import('../src/core/combos')
    const byId = new Map(tracks.map((t) => [t.id, t]))
    const walk = suggestWalk(tracks, config(), { seedId: 'a', length: 10 }).ids
    for (let i = 1; i < walk.length; i++) {
      const result = evaluateCombo(byId.get(walk[i - 1])!, byId.get(walk[i])!, config())
      expect(result.isCombo).toBe(true)
    }
  })

  test('respects the target length', () => {
    const walk = suggestWalk(tracks, config(), { seedId: 'a', length: 2 }).ids
    expect(walk).toHaveLength(2)
  })

  test('without a seed, the opening track varies with the seed (fully random start)', () => {
    const clique = Array.from({ length: 6 }, (_, i) => track({ id: `t${i}` }))
    const starts = new Set(
      Array.from(
        { length: 10 },
        (_, seed) => suggestWalk(clique, config(), { length: 3, seed }).ids[0],
      ),
    )
    expect(starts.size).toBeGreaterThan(1)
  })

  test('without a seed, never opens on an isolated track while connected ones exist', () => {
    for (let seed = 0; seed < 12; seed++) {
      const walk = suggestWalk(tracks, config(), { length: 5, seed }).ids
      expect(walk[0]).not.toBe('e')
    }
  })

  test('is deterministic', () => {
    const first = suggestWalk(tracks, config(), { seedId: 'a', length: 10 }).ids
    const second = suggestWalk(tracks, config(), { seedId: 'a', length: 10 }).ids
    expect(first).toEqual(second)
  })

  test('an isolated seed yields a one-track walk', () => {
    const walk = suggestWalk(tracks, config(), { seedId: 'e', length: 10 }).ids
    expect(walk).toEqual(['e'])
  })

  test('empty library yields an empty walk', () => {
    expect(suggestWalk([], config(), { length: 5 }).ids).toEqual([])
  })

  describe('force mode (v11 issue 16b)', () => {
    test('a walk that stops short reports zero forced steps without force', () => {
      const result = suggestWalk(tracks, config(), { seedId: 'a', length: 5 })
      expect(result.ids.length).toBeLessThan(5) // 'e' is unreachable
      expect(result.forced).toBe(0)
    })

    test('force fills the walk to the exact target length, counting the breaks', () => {
      const result = suggestWalk(tracks, config(), { seedId: 'a', length: 5, force: true })
      expect(result.ids).toHaveLength(5)
      expect(new Set(result.ids).size).toBe(5)
      expect(result.forced).toBeGreaterThan(0)
      expect(result.forced).toBeLessThan(5)
    })

    test('force never fires while combo candidates remain', () => {
      const result = suggestWalk(tracks, config(), { seedId: 'a', length: 3, force: true })
      // a—b—c walk fits entirely inside the connected chain.
      expect(result.ids).toHaveLength(3)
      expect(result.forced).toBe(0)
    })

    test('an isolated seed force-fills to length', () => {
      const result = suggestWalk(tracks, config(), { seedId: 'e', length: 4, force: true })
      expect(result.ids).toHaveLength(4)
      expect(result.ids[0]).toBe('e')
      expect(result.forced).toBeGreaterThan(0)
    })

    test('forced walks are deterministic per seed', () => {
      const opts = { seedId: 'a', length: 5, force: true, randomness: 1, seed: 7 }
      expect(suggestWalk(tracks, config(), opts)).toEqual(suggestWalk(tracks, config(), opts))
    })

    test('two-ended walks force through a broken middle', () => {
      // a and d connect to nothing shared: without force the arms stall.
      const gap = [
        track({ id: 'a', key: '8A', bpm: 128 }),
        track({ id: 'z', key: '3B', bpm: 90, genre: 'Ambient', year: 1980 }),
        track({ id: 'd', key: '8A', bpm: 129 }),
      ]
      const short = suggestWalk(gap, config({ threshold: 4 }), {
        seedId: 'a',
        endId: 'd',
        length: 3,
      })
      expect(short.ids.length).toBeLessThan(3)
      const forced = suggestWalk(gap, config({ threshold: 4 }), {
        seedId: 'a',
        endId: 'd',
        length: 3,
        force: true,
      })
      expect(forced.ids).toHaveLength(3)
      expect(forced.ids[0]).toBe('a')
      expect(forced.ids.at(-1)).toBe('d')
      expect(forced.forced).toBeGreaterThan(0)
    })
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
    const walk = suggestWalk(trio, cfg, { seedId: 'a', length: 2 }).ids
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
    const walk = suggestWalk(trio, cfg, { seedId: 'a', length: 2 }).ids
    expect(walk).toEqual(['a', 'x2'])
  })

  test('randomness 0 is deterministic regardless of seed', () => {
    const a = suggestWalk(tracks, config(), { seedId: 'a', length: 10, randomness: 0, seed: 1 }).ids
    const b = suggestWalk(tracks, config(), {
      seedId: 'a',
      length: 10,
      randomness: 0,
      seed: 99,
    }).ids
    expect(a).toEqual(b)
  })

  test('with randomness, the same seed reproduces the same walk', () => {
    const a = suggestWalk(tracks, config(), { seedId: 'a', length: 10, randomness: 1, seed: 3 }).ids
    const b = suggestWalk(tracks, config(), { seedId: 'a', length: 10, randomness: 1, seed: 3 }).ids
    expect(a).toEqual(b)
  })

  test('with randomness, different seeds can produce different walks', () => {
    // A clique of equivalent tracks: any order is a valid walk.
    const clique = Array.from({ length: 6 }, (_, i) => track({ id: `t${i}` }))
    const walks = new Set(
      Array.from({ length: 8 }, (_, seed) =>
        suggestWalk(clique, config(), { seedId: 't0', length: 6, randomness: 1, seed }).ids.join(
          ',',
        ),
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
      }).ids
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
      }).ids
      expect(walk[0]).toBe('t0')
      expect(walk.at(-1)).toBe('t5')
      expect(walk).toHaveLength(6)
      expect(new Set(walk).size).toBe(6)
    })

    test('a pinned end alone still closes the walk, with a random opener', () => {
      const walk = suggestWalk(chain, config({ threshold: 4 }), {
        endId: 'd',
        length: 2,
        seed: 1,
      }).ids
      expect(walk.at(-1)).toBe('d')
      expect(walk).toHaveLength(2)
    })

    test('the same seed reproduces the same pinned walk', () => {
      const opts = { seedId: 'a', endId: 'd', length: 4, randomness: 1, seed: 7 }
      expect(suggestWalk(chain, config({ threshold: 4 }), opts).ids).toEqual(
        suggestWalk(chain, config({ threshold: 4 }), opts).ids,
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

  test('an empty set starts with the selection when one is set', () => {
    expect(suggestNext(chain, chainCfg(), [], { selectedId: 'c' })).toEqual({
      trackId: 'c',
      insertIndex: 0,
    })
  })

  test('an empty set with no selection opens randomly, reproducibly per seed (issue 17)', () => {
    const openers = new Set(
      Array.from({ length: 20 }, (_, seed) => suggestNext(tracks, config(), [], { seed })?.trackId),
    )
    expect(openers.size).toBeGreaterThan(1) // pressing again explores
    expect(openers.has('e')).toBe(false) // connected tracks preferred
    expect(suggestNext(tracks, config(), [], { seed: 7 })).toEqual(
      suggestNext(tracks, config(), [], { seed: 7 }),
    )
  })

  test('excludeIds are never suggested, on any path', () => {
    // normal path: a's only neighbour is excluded
    expect(suggestNext(chain, chainCfg(), ['a'], { excludeIds: ['b'] })).toBeNull()
    // forced pool respects exclusions
    expect(suggestNext(chain, chainCfg(), ['b', 'a'], { force: true, excludeIds: ['c'] })).toEqual({
      trackId: 'd',
      insertIndex: 2,
    })
    // empty-set opener draws from what is left
    expect(suggestNext(chain, chainCfg(), [], { excludeIds: ['a', 'b', 'c'] })).toEqual({
      trackId: 'd',
      insertIndex: 0,
    })
    // an excluded selection is not returned either
    expect(
      suggestNext(chain, chainCfg(), [], { selectedId: 'a', excludeIds: ['a', 'b', 'c', 'd'] }),
    ).toBeNull()
  })

  test('returns null for an empty library', () => {
    expect(suggestNext([], chainCfg(), [], {})).toBeNull()
  })
})

describe('retryState (v8 issues 2+3)', () => {
  // a is the hub of a small star; z exists only as a visible non-neighbour.
  const neighbourMap = new Map<string, Set<string>>([
    ['a', new Set(['b', 'c'])],
    ['b', new Set(['a'])],
    ['c', new Set(['a'])],
  ])
  const visible = ['a', 'b', 'c', 'z']

  test('no pick, or a pick the set has since diverged from, is none', () => {
    expect(retryState(neighbourMap, ['a', 'b'], null, [], visible)).toBe('none')
    expect(
      retryState(neighbourMap, ['a', 'c'], { trackId: 'b', insertIndex: 1 }, [], visible),
    ).toBe('none')
  })

  test('retry while the anchor has an unused, untried matching neighbour', () => {
    expect(
      retryState(neighbourMap, ['a', 'b'], { trackId: 'b', insertIndex: 1 }, [], visible),
    ).toBe('retry')
    // …but c already tried: only the rule-breaking pool is left
    expect(
      retryState(neighbourMap, ['a', 'b'], { trackId: 'b', insertIndex: 1 }, ['c'], visible),
    ).toBe('force-retry')
  })

  test('force-retry when matching options are gone but untried visible tracks remain', () => {
    // a's other neighbour c is in the set; z is the only alternative left
    expect(
      retryState(neighbourMap, ['c', 'a', 'b'], { trackId: 'b', insertIndex: 2 }, [], visible),
    ).toBe('force-retry')
    // a forced pick in the slot with matching long gone stays force-retry
    expect(
      retryState(neighbourMap, ['a', 'b', 'z'], { trackId: 'z', insertIndex: 2 }, [], visible),
    ).toBe('force-retry')
  })

  test('reset-only when every alternative has been tried; none without a history', () => {
    // z sits in the slot, c was already tried: nothing left but the ⟲ reset
    expect(
      retryState(neighbourMap, ['a', 'b', 'z'], { trackId: 'z', insertIndex: 2 }, ['c'], visible),
    ).toBe('reset-only')
    // same exhaustion but nothing was ever tried: no ring at all
    expect(
      retryState(neighbourMap, ['a', 'c', 'b', 'z'], { trackId: 'z', insertIndex: 3 }, [], visible),
    ).toBe('none')
  })

  test('an empty-set opener cycles all visible tracks, then reset-only', () => {
    expect(retryState(neighbourMap, ['a'], { trackId: 'a', insertIndex: 0 }, [], visible)).toBe(
      'retry',
    )
    expect(
      retryState(neighbourMap, ['a'], { trackId: 'a', insertIndex: 0 }, ['b', 'c', 'z'], visible),
    ).toBe('reset-only')
    expect(retryState(neighbourMap, ['a'], { trackId: 'a', insertIndex: 0 }, [], ['a'])).toBe(
      'none',
    )
  })
})

describe('forced key preference (v8 issue 16)', () => {
  // The anchor is harmonically and stylistically stranded: every candidate
  // fails the edge gate, so force ranks the whole pool. The two candidates
  // are identical except for their key: 'z-plus2' sits a +2 move away
  // (10A vs 8A), 'a-far' three slots away (11A). Without the affinity term
  // the id tiebreak would pick 'a-far'.
  const stranded = [
    track({ id: 'anchor', key: '8A', bpm: 128, genre: 'Techno', year: 2020 }),
    track({ id: 'a-far', key: '11A', bpm: 200, genre: 'Jazz', year: 1990 }),
    track({ id: 'z-plus2', key: '10A', bpm: 200, genre: 'Jazz', year: 1990 }),
  ]

  test('a forced pick slightly prefers a ±2/±7-semitone key relation', () => {
    const next = suggestNext(stranded, config(), ['anchor'], { force: true })
    expect(next).toEqual({ trackId: 'z-plus2', insertIndex: 1 })
  })

  test('normal (edge-gated) ranking is unchanged by the affinity term', () => {
    // Both candidates match bpm+genre+year (3 of 4); key differs only in
    // distance. Equal scores must still fall to the id tiebreak.
    const matched = [
      track({ id: 'anchor', key: '8A', bpm: 128, genre: 'Techno', year: 2020 }),
      track({ id: 'a-far', key: '11A', bpm: 128, genre: 'Techno', year: 2020 }),
      track({ id: 'b-plus2', key: '10A', bpm: 128, genre: 'Techno', year: 2020 }),
    ]
    const next = suggestNext(matched, config(), ['anchor'], {})
    expect(next).toEqual({ trackId: 'a-far', insertIndex: 1 })
  })
})

describe('progressionFit', () => {
  test("missing BPM or 'any' is neutral", () => {
    expect(progressionFit(null, 130, 0, 'rising')).toBe(0.5)
    expect(progressionFit(128, null, 0, 'rising')).toBe(0.5)
    expect(progressionFit(128, 132, 0, 'any')).toBe(0.5)
  })

  test('steady peaks at a flat step and decays with distance', () => {
    expect(progressionFit(128, 128, 0, 'steady')).toBe(1)
    expect(progressionFit(128, 131, 0, 'steady')).toBeLessThan(1)
    expect(progressionFit(128, 131, 0, 'steady')).toBeGreaterThan(
      progressionFit(128, 140, 0, 'steady'),
    )
  })

  test('rising is monotone in the BPM step; falling mirrors it', () => {
    const up = progressionFit(128, 132, 0, 'rising')
    const flat = progressionFit(128, 128, 0, 'rising')
    const down = progressionFit(128, 124, 0, 'rising')
    expect(up).toBeGreaterThan(flat)
    expect(flat).toBeCloseTo(0.5)
    expect(flat).toBeGreaterThan(down)
    expect(progressionFit(128, 124, 0, 'falling')).toBeCloseTo(up)
  })

  test('sawtooth rises, with every fourth transition a breather', () => {
    expect(progressionFit(128, 132, 0, 'sawtooth')).toBeGreaterThan(
      progressionFit(128, 124, 0, 'sawtooth'),
    )
    // steps 3, 7, … drop back
    expect(progressionFit(128, 124, 3, 'sawtooth')).toBeGreaterThan(
      progressionFit(128, 132, 3, 'sawtooth'),
    )
    expect(progressionFit(128, 124, 7, 'sawtooth')).toBeGreaterThan(
      progressionFit(128, 132, 7, 'sawtooth'),
    )
  })
})

describe('suggestWalk with a BPM progression', () => {
  // One anchor with two equally matching neighbours that differ only in BPM.
  const fork = [
    track({ id: 'a', bpm: 126 }),
    track({ id: 'x1', bpm: 123 }),
    track({ id: 'x2', bpm: 129 }),
  ]

  test('rising picks the faster candidate, falling the slower', () => {
    expect(
      suggestWalk(fork, config(), { seedId: 'a', length: 2, progression: 'rising' }).ids,
    ).toEqual(['a', 'x2'])
    expect(
      suggestWalk(fork, config(), { seedId: 'a', length: 2, progression: 'falling' }).ids,
    ).toEqual(['a', 'x1'])
  })

  test("'any' reproduces the default walk exactly (regression pin)", () => {
    const plain = suggestWalk(tracks, config(), { seedId: 'a', length: 10 }).ids
    const anyProg = suggestWalk(tracks, config(), {
      seedId: 'a',
      length: 10,
      progression: 'any',
    }).ids
    expect(anyProg).toEqual(plain)
  })
})

describe('suggestWalk with must-include tracks', () => {
  test('a must-include neighbour beats an otherwise better-matching rival', () => {
    // x1 shares a's genre exactly; x2 is genre-distant — normally x1 wins.
    const trio = [
      track({ id: 'a', genre: 'Techno' }),
      track({ id: 'x1', genre: 'Techno' }),
      track({ id: 'x2', genre: 'Folk', year: 2021 }),
    ]
    const walk = suggestWalk(trio, config(), {
      seedId: 'a',
      length: 2,
      mustIncludeIds: ['x2'],
    }).ids
    expect(walk).toEqual(['a', 'x2'])
  })

  test('a must-include track appears exactly once', () => {
    const walk = suggestWalk(tracks, config(), {
      seedId: 'a',
      length: 10,
      mustIncludeIds: ['b'],
    }).ids
    expect(walk.filter((id) => id === 'b')).toHaveLength(1)
  })

  test('an unreachable must-include track is silently skipped', () => {
    const walk = suggestWalk(tracks, config(), {
      seedId: 'a',
      length: 10,
      mustIncludeIds: ['e'],
    }).ids
    expect(walk).not.toContain('e')
  })

  test('unknown ids and an empty list are no-ops', () => {
    const plain = suggestWalk(tracks, config(), { seedId: 'a', length: 10 }).ids
    expect(
      suggestWalk(tracks, config(), { seedId: 'a', length: 10, mustIncludeIds: [] }).ids,
    ).toEqual(plain)
    expect(
      suggestWalk(tracks, config(), { seedId: 'a', length: 10, mustIncludeIds: ['nope'] }).ids,
    ).toEqual(plain)
  })
})

describe('nextAnchorId / nextExhausted', () => {
  const neighbourMap = new Map<string, Set<string>>([
    ['a', new Set(['b'])],
    ['b', new Set(['a', 'c'])],
    ['c', new Set(['b'])],
  ])

  test('the anchor is the selected set track, else the last track, else null', () => {
    expect(nextAnchorId([], 'a')).toBeNull()
    expect(nextAnchorId(['a', 'b'], 'a')).toBe('a')
    expect(nextAnchorId(['a', 'b'], 'zzz')).toBe('b')
    expect(nextAnchorId(['a', 'b'], null)).toBe('b')
  })

  test('exhausted when every neighbour of the anchor is already in the set', () => {
    expect(nextExhausted(neighbourMap, ['b', 'a'], null)).toBe(true) // a's only neighbour used
    expect(nextExhausted(neighbourMap, ['a'], null)).toBe(false) // b still free
    expect(nextExhausted(neighbourMap, [], null)).toBe(false) // empty set always has an opener
    expect(nextExhausted(neighbourMap, ['x'], null)).toBe(true) // no neighbours at all
  })
})

describe('suggestNext forced mode', () => {
  const chain = [
    track({ id: 'a', year: 2000 }),
    track({ id: 'b', year: 2003 }),
    track({ id: 'c', year: 2006 }),
    track({ id: 'd', year: 2009 }),
  ]
  const chainCfg = () => config({ threshold: 4 })

  test('falls back to the best non-neighbour when the anchor is exhausted', () => {
    // a's only neighbour b is used; forced mode ranks c and d instead.
    const next = suggestNext(chain, chainCfg(), ['b', 'a'], { force: true })
    expect(next).toEqual({ trackId: 'c', insertIndex: 2 })
  })

  test('without force the same situation still yields null', () => {
    expect(suggestNext(chain, chainCfg(), ['b', 'a'], {})).toBeNull()
  })

  test('is deterministic under a fixed seed', () => {
    const first = suggestNext(chain, chainCfg(), ['b', 'a'], {
      force: true,
      randomness: 1,
      seed: 5,
    })
    const second = suggestNext(chain, chainCfg(), ['b', 'a'], {
      force: true,
      randomness: 1,
      seed: 5,
    })
    expect(first).toEqual(second)
  })

  test('returns null even when forced once every track is used', () => {
    expect(suggestNext(chain, chainCfg(), ['a', 'b', 'c', 'd'], { force: true })).toBeNull()
  })
})
