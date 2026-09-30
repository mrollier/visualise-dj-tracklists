import { afterEach, describe, expect, test } from 'vitest'
import {
  buildComboGraph,
  computeEdges,
  countComboPairs,
  DEFAULT_CRITERIA,
  demandedCount,
  focusEdgesFor,
  evaluateCombo,
  makeGenreMatcher,
  matchedGenrePairs,
  toggleCriterion,
  toggleDemanded,
} from '../src/core/combos'
import type { ComboEdge, CriteriaConfig } from '../src/core/combos'
import { setGenreBridge } from '../src/core/genre'
import { randomLibrary, track } from './helpers'

function config(overrides: Partial<CriteriaConfig> = {}): CriteriaConfig {
  return { ...structuredClone(DEFAULT_CRITERIA), ...overrides }
}

describe('individual criteria', () => {
  const base = track({
    key: '8A',
    bpm: 128,
    genre: 'Techno',
    year: 2020,
    rating: 4,
    id: 'a',
  })

  test('bpm matches within the configured percentage of the slower track', () => {
    const cfg = config({ threshold: 5 })
    // ±8% by default: the pitch-bend range of a classic Technics 1210 fader
    expect(DEFAULT_CRITERIA.bpm.maxPercent).toBe(8)
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'b',
          bpm: 130,
        }),
        cfg,
      ).matched,
    ).toContain('bpm')
    // 120 vs 129 → 7.5% of 120: inside 8%
    expect(
      evaluateCombo(
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'c',
          bpm: 120,
        }),
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'd',
          bpm: 129,
        }),
        cfg,
      ).matched,
    ).toContain('bpm')
    // 120 vs 130 → 8.3% of 120: just outside the default
    expect(
      evaluateCombo(
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'c',
          bpm: 120,
        }),
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'd',
          bpm: 130,
        }),
        cfg,
      ).matched,
    ).not.toContain('bpm')
    // …but inside a widened tolerance
    const wide = config({ threshold: 5, bpm: { ...DEFAULT_CRITERIA.bpm, maxPercent: 10 } })
    expect(
      evaluateCombo(
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'c',
          bpm: 120,
        }),
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'd',
          bpm: 130,
        }),
        wide,
      ).matched,
    ).toContain('bpm')
    // 128 vs 148 → 15.6%: outside
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'e',
          bpm: 148,
        }),
        cfg,
      ).matched,
    ).not.toContain('bpm')
  })

  test('a 0% tolerance means an exact BPM match (issue 8)', () => {
    const cfg = config({ threshold: 5, bpm: { ...DEFAULT_CRITERIA.bpm, maxPercent: 0 } })
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'b',
          bpm: 128,
        }),
        cfg,
      ).matched,
    ).toContain('bpm')
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'c',
          bpm: 128.5,
        }),
        cfg,
      ).matched,
    ).not.toContain('bpm')
  })

  test('BPM ratios: unit time on, the others off by default (v8 issue 6)', () => {
    expect(DEFAULT_CRITERIA.bpm.unitTime).toBe(true)
    expect(DEFAULT_CRITERIA.bpm.halfDouble).toBe(false)
    expect(DEFAULT_CRITERIA.bpm.twoThirds).toBe(false)
  })

  test('2/3 time links triplet and four-on-the-floor tempos, both directions', () => {
    const cfg = config({ threshold: 5 })
    cfg.bpm = { ...cfg.bpm, twoThirds: true }
    // 128 × 3/2 = 192: matched with the ratio enabled…
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'b',
          bpm: 192,
        }),
        cfg,
      ).matched,
    ).toContain('bpm')
    expect(
      evaluateCombo(
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'c',
          bpm: 192,
        }),
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'd',
          bpm: 128,
        }),
        cfg,
      ).matched,
    ).toContain('bpm')
    // …not without it…
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'e',
          bpm: 192,
        }),
        config(),
      ).matched,
    ).not.toContain('bpm')
    // …and the percent tolerance still applies around the ratio:
    // 190 × 2/3 = 126.67, 1.05% off 128 — inside 2%, outside at 185 (3.8%)
    cfg.bpm.maxPercent = 2
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'f',
          bpm: 190,
        }),
        cfg,
      ).matched,
    ).toContain('bpm')
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'g',
          bpm: 185,
        }),
        cfg,
      ).matched,
    ).not.toContain('bpm')
  })

  test('unit time can be disabled to isolate the ratio matches', () => {
    const cfg = config({ threshold: 5 })
    cfg.bpm = { ...cfg.bpm, unitTime: false, halfDouble: true }
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'b',
          bpm: 128,
        }),
        cfg,
      ).matched,
    ).not.toContain('bpm')
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'c',
          bpm: 64,
        }),
        cfg,
      ).matched,
    ).toContain('bpm')
    // all ratios off: bpm stays evaluable but can never match
    const none = config({ threshold: 5 })
    none.bpm = { ...none.bpm, unitTime: false }
    const result = evaluateCombo(
      base,
      track({
        key: '8A',
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'd',
        bpm: 128,
      }),
      none,
    )
    expect(result.evaluable).toContain('bpm')
    expect(result.matched).not.toContain('bpm')
  })

  test('vinyl mode needs no pitch shift on an exact 3/2 ratio (same platter speed)', () => {
    const cfg = config({ threshold: 5 })
    cfg.key = { ...cfg.key, vinylMode: true }
    cfg.bpm = { ...cfg.bpm, twoThirds: true }
    // 192 = 128 × 3/2 exactly: the platter speed is unchanged, so same-key
    // tracks still key-match (the residual-semitone formula covers ratios)
    const a = track({
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'a',
      bpm: 128,
      key: '8A',
    })
    expect(
      evaluateCombo(
        a,
        track({
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'b',
          bpm: 192,
          key: '8A',
        }),
        cfg,
      ).matched,
    ).toContain('key')
  })

  test('genre matching has one knob: k mutual nearest genres, default 5', () => {
    expect(DEFAULT_CRITERIA.genre).toEqual({ enabled: true, k: 5, demanded: false })
  })

  test('genre matches through the hybrid pack, case-insensitively', () => {
    const cfg = config()
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          bpm: 128,
          year: 2020,
          rating: 4,
          id: 'b',
          genre: 'techno',
        }),
        cfg,
      ).matched,
    ).toContain('genre')
    // hybrid knows relatedness beyond shared words: Tech House ~ Techno
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          bpm: 128,
          year: 2020,
          rating: 4,
          id: 'c',
          genre: 'Tech House',
        }),
        cfg,
      ).matched,
    ).toContain('genre')
    // unrelated genres still do not match
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          bpm: 128,
          year: 2020,
          rating: 4,
          id: 'f',
          genre: 'Country',
        }),
        cfg,
      ).matched,
    ).not.toContain('genre')
  })

  test('alias spellings count as the same genre', () => {
    const cfg = config()
    const a = track({
      key: '8A',
      bpm: 128,
      year: 2020,
      rating: 4,
      id: 'a2',
      genre: 'DnB',
    })
    const b = track({
      key: '8A',
      bpm: 128,
      year: 2020,
      rating: 4,
      id: 'b2',
      genre: 'Drum & Bass',
    })
    expect(evaluateCombo(a, b, cfg).matched).toContain('genre')
  })

  describe('mutual top-k genre matching', () => {
    const topkConfig = (k = 1): CriteriaConfig => {
      const cfg = config()
      cfg.genre = { ...cfg.genre, k }
      return cfg
    }
    // Hybrid scores used below: techno–tech house 0.95, house–tech house
    // 0.84, house–techno 0.81, deep house–techno 0 (not neighbours at all).
    const trio = ['House', 'Techno', 'Tech House']

    test('accepts pairs that are mutually each other’s nearest genres', () => {
      const matcher = makeGenreMatcher(trio, 1)
      expect(matcher('Techno', 'Tech House')).toBe(true)
      expect(matcher('House', 'Techno')).toBe(false)
    })

    test('identical genres always match', () => {
      const matcher = makeGenreMatcher(['Electronic', 'Techno'], 1)
      expect(matcher('Electronic', 'Electronic')).toBe(true)
    })

    test('umbrella labels never rank as neighbours', () => {
      const matcher = makeGenreMatcher(['Electronic', 'Techno', 'Tech House'], 3)
      expect(matcher('Techno', 'Tech House')).toBe(true)
      expect(matcher('Electronic', 'Techno')).toBe(false)
    })

    test('genres the pack calls unrelated never link, however wide k is', () => {
      const matcher = makeGenreMatcher(['Deep House', 'Techno'], 8)
      expect(matcher('Deep House', 'Techno')).toBe(false)
    })

    test('k widens the neighbourhood', () => {
      expect(makeGenreMatcher(trio, 1)('House', 'Techno')).toBe(false)
      expect(makeGenreMatcher(trio, 2)('House', 'Techno')).toBe(true)
    })

    test('multi-genre fields match through any component', () => {
      const matcher = makeGenreMatcher(['House / Jazz', 'Deep House', 'Trance'], 1)
      expect(matcher('House / Jazz', 'Deep House')).toBe(true)
      expect(matcher('Trance', 'Deep House')).toBe(false)
    })

    test('matchedGenrePairs lists distinct matching label pairs from a matcher, k-sensitive', () => {
      expect(matchedGenrePairs(trio, makeGenreMatcher(trio, 1))).toEqual([['tech house', 'techno']])
      expect(matchedGenrePairs(trio, makeGenreMatcher(trio, 2))).toEqual([
        ['house', 'tech house'],
        ['house', 'techno'],
        ['tech house', 'techno'],
      ])
    })

    test('matchedGenrePairs never pairs a label with itself and keeps umbrellas out', () => {
      const labels = ['Electronic', 'Techno', 'Tech House', 'Techno']
      expect(matchedGenrePairs(labels, makeGenreMatcher(labels, 3))).toEqual([
        ['tech house', 'techno'],
      ])
    })

    test('computeEdges links mutual top-k genres and nothing else', () => {
      const cfg = topkConfig(1)
      cfg.key.enabled = false
      cfg.bpm.enabled = false
      cfg.year.enabled = false
      cfg.threshold = 1
      const tracks = [
        track({
          key: '8A',
          bpm: 128,
          year: 2020,
          rating: 4,
          id: 'a',
          genre: 'Deep House',
        }),
        track({
          key: '8A',
          bpm: 128,
          year: 2020,
          rating: 4,
          id: 'b',
          genre: 'Tech House',
        }),
        track({
          key: '8A',
          bpm: 128,
          year: 2020,
          rating: 4,
          id: 'c',
          genre: 'Jazz',
        }),
      ]
      const edges = computeEdges(tracks, cfg)
      expect(edges).toHaveLength(1)
      expect([edges[0].sourceId, edges[0].targetId].sort()).toEqual(['a', 'b'])
    })
  })

  test('half/double-time BPM only matches when enabled', () => {
    const dnb = track({
      key: '8A',
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'x',
      bpm: 174,
    })
    const halftime = track({
      key: '8A',
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'y',
      bpm: 87,
    })
    expect(evaluateCombo(dnb, halftime, config()).matched).not.toContain('bpm')
    const cfg = config()
    cfg.bpm.halfDouble = true
    expect(evaluateCombo(dnb, halftime, cfg).matched).toContain('bpm')
    // still respects the tolerance after doubling: 174 vs 2×78 = 156 → 11.5%
    expect(
      evaluateCombo(
        dnb,
        track({
          key: '8A',
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'z',
          bpm: 78,
        }),
        cfg,
      ).matched,
    ).not.toContain('bpm')
  })

  test('vinyl mode: beatmatching pitch shift transposes the key before matching', () => {
    // b pitched up from 122.7 to 130 BPM (+1 semitone) turns 1A into 8A.
    const a = track({
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'a2',
      key: '8A',
      bpm: 130,
    })
    const b = track({
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'b2',
      key: '1A',
      bpm: 122.7,
    })
    expect(evaluateCombo(a, b, config()).matched).not.toContain('key')
    const cfg = config()
    cfg.key.vinylMode = true
    expect(evaluateCombo(a, b, cfg).matched).toContain('key')
    expect(evaluateCombo(b, a, cfg).matched).toContain('key') // symmetric
  })

  test('vinyl mode ignores tempo gaps that land between semitones', () => {
    // 130/126.3 ≈ +0.5 semitone: not a clean transposition, no key match.
    const a = track({
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'a3',
      key: '8A',
      bpm: 130,
    })
    const b = track({
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'b3',
      key: '1A',
      bpm: 126.3,
    })
    const cfg = config()
    cfg.key.vinylMode = true
    expect(evaluateCombo(a, b, cfg).matched).not.toContain('key')
  })

  test('vinyl mode is strict: same-key tracks a semitone apart in tempo lose their key match', () => {
    // Beatmatching b (122.7 → 130) shifts its 8A up a semitone to 3A ≠ 8A.
    const a = track({
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'a5',
      key: '8A',
      bpm: 130,
    })
    const b = track({
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'b5',
      key: '8A',
      bpm: 122.7,
    })
    expect(evaluateCombo(a, b, config()).matched).toContain('key')
    const cfg = config()
    cfg.key.vinylMode = true
    expect(evaluateCombo(a, b, cfg).matched).not.toContain('key')
    expect(evaluateCombo(b, a, cfg).matched).not.toContain('key') // symmetric
  })

  test('vinyl mode is strict: same-key tracks detuned by a half semitone lose their key match', () => {
    // 130/126.3 ≈ +0.5 semitone: after beatmatching the keys sit between slots.
    const a = track({
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'a6',
      key: '8A',
      bpm: 130,
    })
    const b = track({
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'b6',
      key: '8A',
      bpm: 126.3,
    })
    expect(evaluateCombo(a, b, config()).matched).toContain('key')
    const cfg = config()
    cfg.key.vinylMode = true
    expect(evaluateCombo(a, b, cfg).matched).not.toContain('key')
  })

  test('vinyl mode is strict: unbeatmatchable tempo gaps have no key relation', () => {
    // 130 vs 100 is beyond the pitch-fader range (bpm.maxPercent): on vinyl
    // these two can never play together, so same key or not, no key match.
    const a = track({
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'a7',
      key: '8A',
      bpm: 130,
    })
    const b = track({
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'b7',
      key: '8A',
      bpm: 100,
    })
    expect(evaluateCombo(a, b, config()).matched).toContain('key')
    const cfg = config()
    cfg.key.vinylMode = true
    expect(evaluateCombo(a, b, cfg).matched).not.toContain('key')
  })

  test('vinyl mode: near-equal tempos and missing BPMs fall back to the plain comparison', () => {
    const cfg = config()
    cfg.key.vinylMode = true
    // ~0 semitone shift: plain same-key match survives
    const a = track({
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'a8',
      key: '8A',
      bpm: 128,
    })
    expect(
      evaluateCombo(
        a,
        track({
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'b8',
          key: '8A',
          bpm: 128.5,
        }),
        cfg,
      ).matched,
    ).toContain('key')
    // no tempo data on one side: cannot model the shift, compare keys as-is
    expect(
      evaluateCombo(
        a,
        track({
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'c8',
          key: '8A',
          bpm: null,
        }),
        cfg,
      ).matched,
    ).toContain('key')
  })

  test('vinyl mode works across a half/double-time bridge', () => {
    // b played double-time at 164.2 then pitched to 174 is +1 semitone: 1A → 8A.
    const a = track({
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'a4',
      key: '8A',
      bpm: 174,
    })
    const b = track({
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'b4',
      key: '1A',
      bpm: 82.1,
    })
    const cfg = config()
    cfg.key.vinylMode = true
    cfg.bpm.halfDouble = true
    expect(evaluateCombo(a, b, cfg).matched).toContain('key')
    // without halfDouble the tempos are un-beatmatchable → no vinyl shift
    cfg.bpm.halfDouble = false
    expect(evaluateCombo(a, b, cfg).matched).not.toContain('key')
  })

  test('year matches within its configured window', () => {
    const cfg = config()
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          bpm: 128,
          genre: 'Techno',
          rating: 4,
          id: 'b',
          year: 2024,
        }),
        cfg,
      ).matched,
    ).toContain('year')
    expect(
      evaluateCombo(
        base,
        track({
          key: '8A',
          bpm: 128,
          genre: 'Techno',
          rating: 4,
          id: 'c',
          year: 2026,
        }),
        cfg,
      ).matched,
    ).not.toContain('year')
  })

  test('energy matches within its configured tolerance', () => {
    const cfg = config()
    const a = track({ id: 'a', key: '8A', bpm: 128, genre: 'Techno', year: 2020, energy: 5 })
    // default tolerance is 2: 5 → 7 matches, 5 → 8 doesn't.
    expect(
      evaluateCombo(
        a,
        track({ id: 'b', key: '8A', bpm: 128, genre: 'Techno', year: 2020, energy: 7 }),
        cfg,
      ).matched,
    ).toContain('energy')
    expect(
      evaluateCombo(
        a,
        track({ id: 'c', key: '8A', bpm: 128, genre: 'Techno', year: 2020, energy: 8 }),
        cfg,
      ).matched,
    ).not.toContain('energy')
  })

  test('rating is a library filter, not a combo criterion', () => {
    // Wildly different ratings must not affect the combo evaluation at all.
    const cfg = config({ threshold: 4 })
    const other = track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      id: 'b',
      rating: 0,
    })
    const result = evaluateCombo(base, other, cfg)
    expect(result.evaluable).toEqual(['key', 'bpm', 'genre', 'year'])
    expect(result.isCombo).toBe(true)
  })

  test('key uses Camelot adjacency', () => {
    const cfg = config()
    expect(
      evaluateCombo(
        base,
        track({
          bpm: 128,
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'b',
          key: '9A',
        }),
        cfg,
      ).matched,
    ).toContain('key')
    expect(
      evaluateCombo(
        base,
        track({
          bpm: 128,
          genre: 'Techno',
          year: 2020,
          rating: 4,
          id: 'c',
          key: '3A',
        }),
        cfg,
      ).matched,
    ).not.toContain('key')
  })

  test('disabled criteria are neither evaluated nor counted', () => {
    const cfg = config()
    cfg.genre.enabled = false
    const result = evaluateCombo(
      base,
      track({
        key: '8A',
        bpm: 128,
        year: 2020,
        rating: 4,
        id: 'b',
        genre: 'Ambient',
      }),
      cfg,
    )
    expect(result.evaluable).not.toContain('genre')
    expect(result.matched).not.toContain('genre')
  })
})

describe('the learned vocabulary bridge in matching', () => {
  // The threshold shows the predicted style on some tracks and the
  // collection's own label on others. "Tribe" (his word) and "Tribal" (the
  // model's) describe the same music but share no pack similarity, so
  // until the bridge is installed the pair silently stops matching.
  const genreOnly = (): CriteriaConfig => {
    const cfg = config({ threshold: 1 })
    for (const field of ['key', 'bpm', 'energy', 'year'] as const) cfg[field].enabled = false
    return cfg
  }
  const a = track({ id: 'a', genre: 'Tribe' })
  const b = track({ id: 'b', genre: 'Tribal' })

  afterEach(() => setGenreBridge())

  test('one dialect each: no edge', () => {
    expect(computeEdges([a, b], genreOnly())).toHaveLength(0)
  })

  test('with the alias installed the pair matches again', () => {
    setGenreBridge([{ own: 'tribe', style: 'tribal', weight: 0.64 }])
    const edges = computeEdges([a, b], genreOnly())
    expect(edges).toHaveLength(1)
    expect(edges[0].matched).toEqual(['genre'])
  })

  test('an alias below the score floor still cannot link', () => {
    setGenreBridge([{ own: 'tribe', style: 'tribal', weight: 0.1 }])
    expect(computeEdges([a, b], genreOnly())).toHaveLength(0)
  })
})

describe('threshold logic', () => {
  const base = track({
    key: '8A',
    bpm: 128,
    genre: 'Techno',
    year: 2020,
    rating: 4,
    id: 'a',
  })

  test('edge exists iff at least `threshold` criteria match', () => {
    // matches on key, bpm, genre; fails year
    const other = track({
      genre: 'Techno',
      rating: 4,
      id: 'b',
      key: '8B',
      bpm: 126,
      year: 2000,
    })
    expect(evaluateCombo(base, other, config({ threshold: 3 })).isCombo).toBe(true)
    expect(evaluateCombo(base, other, config({ threshold: 4 })).isCombo).toBe(false)
  })

  test('missing values shrink the denominator instead of failing', () => {
    // Only key and bpm are evaluable; both match → combo even at threshold 4
    const sparse = track({
      key: '8A',
      bpm: 128,
      rating: 4,
      id: 'b',
      genre: null,
      year: null,
    })
    const result = evaluateCombo(base, sparse, config({ threshold: 4 }))
    expect(result.evaluable).toEqual(['key', 'bpm'])
    expect(result.isCombo).toBe(true)
  })

  test('a missing value on either side makes the criterion non-evaluable', () => {
    const noKey = track({
      bpm: 128,
      genre: 'Techno',
      year: 2020,
      rating: 4,
      id: 'b',
      key: null,
    })
    expect(evaluateCombo(base, noKey, config()).evaluable).not.toContain('key')
  })

  test('no evaluable criteria means no combo', () => {
    const empty = track({ id: 'b', key: null, bpm: null, genre: null, year: null, rating: null })
    expect(evaluateCombo(base, empty, config({ threshold: 1 })).isCombo).toBe(false)
  })

  test('evaluation is symmetric in its arguments', () => {
    const other = track({
      rating: 4,
      id: 'b',
      key: '9A',
      bpm: 120,
      genre: null,
      year: 2015,
    })
    const ab = evaluateCombo(base, other, config())
    const ba = evaluateCombo(other, base, config())
    expect(ab.matched.sort()).toEqual(ba.matched.sort())
    expect(ab.isCombo).toBe(ba.isCombo)
  })

  test('raising the threshold never creates new edges (monotonicity)', () => {
    const tracks = [
      base,
      track({
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        key: '9A',
        bpm: 132,
      }),
      track({
        rating: 4,
        id: 'c',
        key: '3B',
        bpm: 174,
        genre: 'DnB',
        year: 1998,
      }),
      track({
        key: '8A',
        bpm: 128,
        rating: 4,
        id: 'd',
        genre: null,
        year: null,
      }),
    ]
    let previous = Infinity
    for (let threshold = 1; threshold <= 4; threshold++) {
      const count = computeEdges(tracks, config({ threshold })).length
      expect(count).toBeLessThanOrEqual(previous)
      previous = count
    }
  })
})

describe('toggleCriterion (v14 C1: enabling ALWAYS requires the new criterion)', () => {
  test('enabling a criterion bumps a require-all threshold', () => {
    // key + bpm enabled, require 2 of 2 → enabling year reads 3 of 3.
    const cfg = config({
      genre: { ...DEFAULT_CRITERIA.genre, enabled: false },
      year: { ...DEFAULT_CRITERIA.year, enabled: false },
      threshold: 2,
    })
    const next = toggleCriterion(cfg, 'year', true)
    expect(next.year.enabled).toBe(true)
    expect(next.threshold).toBe(3)
  })

  test('enabling always requires the new criterion: a partial bumps by one (C1)', () => {
    // 3 enabled, require 2 → enabling the 4th now reads require 3, not 2.
    const cfg = config({ year: { ...DEFAULT_CRITERIA.year, enabled: false }, threshold: 2 })
    expect(toggleCriterion(cfg, 'year', true).threshold).toBe(3)
  })

  test('C1 round-trip: 2-of-4 → disable genre → re-enable reads 3-of-4', () => {
    const cfg = config({ threshold: 2 }) // all four enabled, require 2
    const dropped = toggleCriterion(cfg, 'genre', false) // 2 of 3
    expect(dropped.threshold).toBe(2)
    const restored = toggleCriterion(dropped, 'genre', true) // requires the new one
    expect(restored.threshold).toBe(3)
  })

  test('enabling up from a deliberate zero now requires the new criterion (C1)', () => {
    const cfg = config({ year: { ...DEFAULT_CRITERIA.year, enabled: false }, threshold: 0 })
    expect(toggleCriterion(cfg, 'year', true).threshold).toBe(1)
  })

  test('require-all survives a disable/re-enable round-trip unchanged (C1)', () => {
    // 3-of-3 → disable → 2-of-2 → re-enable → 3-of-3.
    const cfg = config({
      energy: { ...DEFAULT_CRITERIA.energy, enabled: false },
      year: { ...DEFAULT_CRITERIA.year, enabled: false },
      threshold: 3,
    })
    const dropped = toggleCriterion(cfg, 'genre', false) // 2 of 2
    expect(dropped.threshold).toBe(2)
    const restored = toggleCriterion(dropped, 'genre', true) // 3 of 3
    expect(restored.threshold).toBe(3)
  })

  test('the bumped threshold is capped at the enabled count (C1)', () => {
    // Already require-all 3-of-3 → enabling the 4th caps at 4, never 5.
    const cfg = config({ year: { ...DEFAULT_CRITERIA.year, enabled: false }, threshold: 3 })
    expect(toggleCriterion(cfg, 'year', true).threshold).toBe(4)
  })

  test('disabling clamps the threshold to the remaining count', () => {
    // all four [original] enabled — energy sits this one out.
    const cfg = config({ energy: { ...DEFAULT_CRITERIA.energy, enabled: false }, threshold: 4 })
    const next = toggleCriterion(cfg, 'genre', false)
    expect(next.genre.enabled).toBe(false)
    expect(next.threshold).toBe(3)
  })

  test('enabling the first criterion clamps a stale threshold down to 1', () => {
    const cfg = config({
      key: { ...DEFAULT_CRITERIA.key, enabled: false },
      bpm: { ...DEFAULT_CRITERIA.bpm, enabled: false },
      energy: { ...DEFAULT_CRITERIA.energy, enabled: false },
      genre: { ...DEFAULT_CRITERIA.genre, enabled: false },
      year: { ...DEFAULT_CRITERIA.year, enabled: false },
      threshold: 3,
    })
    expect(toggleCriterion(cfg, 'key', true).threshold).toBe(1)
  })

  test('does not mutate its input', () => {
    const cfg = config({ threshold: 4 })
    toggleCriterion(cfg, 'genre', false)
    expect(cfg.genre.enabled).toBe(true)
    expect(cfg.threshold).toBe(4)
  })
})

describe('demanded criteria (v14 C2: a locked criterion is mandatory)', () => {
  const base = track({
    key: '8A',
    bpm: 128,
    genre: 'Techno',
    year: 2020,
    rating: 4,
    id: 'a',
  })

  test('DEFAULT_CRITERIA demands nothing', () => {
    expect(demandedCount(DEFAULT_CRITERIA)).toBe(0)
    expect(DEFAULT_CRITERIA.key.demanded).toBe(false)
    expect(DEFAULT_CRITERIA.bpm.demanded).toBe(false)
    expect(DEFAULT_CRITERIA.genre.demanded).toBe(false)
    expect(DEFAULT_CRITERIA.year.demanded).toBe(false)
  })

  test('demandedCount counts only enabled AND demanded criteria', () => {
    const cfg = config({
      key: { ...DEFAULT_CRITERIA.key, demanded: true },
      bpm: { ...DEFAULT_CRITERIA.bpm, enabled: false, demanded: true },
      genre: { ...DEFAULT_CRITERIA.genre, demanded: true },
    })
    expect(demandedCount(cfg)).toBe(2) // key + genre; disabled bpm does not count
  })

  test('a demanded criterion that fails blocks the edge even above threshold', () => {
    // key + bpm + genre match, year fails; threshold 1 would normally pass.
    const other = track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      rating: 4,
      id: 'b',
      year: 1990,
    })
    const relaxed = config({ threshold: 1 })
    expect(evaluateCombo(base, other, relaxed).isCombo).toBe(true)
    // Now demand year: the failing demanded criterion vetoes the edge.
    const strict = config({ threshold: 1, year: { ...DEFAULT_CRITERIA.year, demanded: true } })
    expect(evaluateCombo(base, other, strict).isCombo).toBe(false)
  })

  test('a demanded criterion missing on either side blocks the edge (decision 3)', () => {
    const noYear = track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      rating: 4,
      id: 'b',
      year: null,
    })
    const strict = config({ threshold: 1, year: { ...DEFAULT_CRITERIA.year, demanded: true } })
    expect(evaluateCombo(base, noYear, strict).isCombo).toBe(false)
    // …and symmetrically, missing on the base side.
    const baseNoYear = track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      rating: 4,
      id: 'a2',
      year: null,
    })
    expect(evaluateCombo(baseNoYear, base, strict).isCombo).toBe(false)
  })

  test('a demanded criterion that matches still lets a satisfied edge form', () => {
    const other = track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      rating: 4,
      id: 'b',
      year: 2022,
    })
    const strict = config({ threshold: 1, year: { ...DEFAULT_CRITERIA.year, demanded: true } })
    expect(evaluateCombo(base, other, strict).isCombo).toBe(true)
  })

  test('demanded-fail keeps `matched` fully populated for scoring (no early return)', () => {
    // year fails (demanded) but key/bpm/genre still match — matched must list them.
    const other = track({
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      rating: 4,
      id: 'b',
      year: 1990,
    })
    const strict = config({ threshold: 1, year: { ...DEFAULT_CRITERIA.year, demanded: true } })
    const result = evaluateCombo(base, other, strict)
    expect(result.isCombo).toBe(false)
    expect(result.matched).toEqual(expect.arrayContaining(['key', 'bpm', 'genre']))
    expect(result.matched).not.toContain('year')
  })

  test('desired (non-demanded) criteria keep shrink-the-denominator semantics', () => {
    // Only key + bpm evaluable, both match, neither demanded → combo at threshold 4.
    const sparse = track({
      key: '8A',
      bpm: 128,
      rating: 4,
      id: 'b',
      genre: null,
      year: null,
    })
    expect(evaluateCombo(base, sparse, config({ threshold: 4 })).isCombo).toBe(true)
  })
})

describe('toggleDemanded (v14 C2)', () => {
  test('locking a criterion floors the threshold to the demanded count', () => {
    const cfg = config({ threshold: 1 }) // all four enabled, require 1
    const next = toggleDemanded(cfg, 'key', true)
    expect(next.key.demanded).toBe(true)
    expect(next.threshold).toBe(1) // one demanded, floor is 1
    const two = toggleDemanded(next, 'bpm', true)
    expect(two.threshold).toBe(2) // two demanded → floor raised
  })

  test('unlocking a criterion drops the floor but never below the others', () => {
    const cfg = toggleDemanded(toggleDemanded(config({ threshold: 1 }), 'key', true), 'bpm', true) // require 2, both demanded
    expect(cfg.threshold).toBe(2)
    const next = toggleDemanded(cfg, 'bpm', false)
    expect(next.bpm.demanded).toBe(false)
    // still one demanded (key); threshold may relax down to the floor of 1.
    expect(demandedCount(next)).toBe(1)
  })

  test('does not mutate its input', () => {
    const cfg = config({ threshold: 1 })
    toggleDemanded(cfg, 'key', true)
    expect(cfg.key.demanded).toBe(false)
    expect(cfg.threshold).toBe(1)
  })
})

describe('toggleCriterion maintains the demanded floor (v14 C2)', () => {
  test('threshold never drops below the demanded count after a flip', () => {
    // key + genre demanded, all four enabled, require 2.
    const cfg = config({
      key: { ...DEFAULT_CRITERIA.key, demanded: true },
      genre: { ...DEFAULT_CRITERIA.genre, demanded: true },
      threshold: 2,
    })
    // Disabling year leaves 3 enabled; the two demanded still floor it at 2.
    const next = toggleCriterion(cfg, 'year', false)
    expect(next.threshold).toBe(2)
  })

  test('disabling a demanded criterion drops its floor AND clears the flag', () => {
    const cfg = config({
      key: { ...DEFAULT_CRITERIA.key, demanded: true },
      genre: { ...DEFAULT_CRITERIA.genre, demanded: true },
      threshold: 2,
    })
    const dropped = toggleCriterion(cfg, 'genre', false)
    expect(dropped.genre.enabled).toBe(false)
    expect(dropped.genre.demanded).toBe(false) // must-match doesn't survive a disable
    expect(demandedCount(dropped)).toBe(1) // only key counts while genre disabled
    // Re-enabling comes back unlocked — must-match is a deliberate re-press,
    // not something a re-enable should restore on its own.
    const restored = toggleCriterion(dropped, 'genre', true)
    expect(restored.genre.demanded).toBe(false)
    expect(demandedCount(restored)).toBe(1)
    expect(restored.threshold).toBeGreaterThanOrEqual(1)
  })
})

describe('computeEdges', () => {
  test('returns each undirected combo once, without self-edges', () => {
    const tracks = [
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
      }),
      track({
        key: '8A',
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        bpm: 126,
      }),
      track({
        key: '8A',
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'c',
        bpm: 127,
      }),
    ]
    const edges = computeEdges(tracks, config({ threshold: 1 }))
    const pairs = edges.map((e) => `${e.sourceId}-${e.targetId}`)
    expect(new Set(pairs).size).toBe(pairs.length)
    expect(pairs).toHaveLength(3) // a-b, a-c, b-c
    for (const e of edges) expect(e.sourceId).not.toBe(e.targetId)
  })

  test('edges carry the matched criteria for UI display', () => {
    const tracks = [
      track({
        key: '8A',
        bpm: 128,
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'a',
      }),
      track({
        key: '8A',
        genre: 'Techno',
        year: 2020,
        rating: 4,
        id: 'b',
        bpm: 126,
      }),
    ]
    const [edge] = computeEdges(tracks, config({ threshold: 4 }))
    expect(edge.matched).toEqual(expect.arrayContaining(['key', 'bpm', 'genre', 'year']))
  })
})

/**
 * The focus rule over a full edge list — the reference `focusEdgesFor` must
 * reproduce without ever building that list.
 */
function focusEdges(edges: ComboEdge[], selectedId: string | null, includeCluster: boolean) {
  if (selectedId === null) return []
  const partners = new Set<string>()
  for (const e of edges) {
    if (e.sourceId === selectedId) partners.add(e.targetId)
    else if (e.targetId === selectedId) partners.add(e.sourceId)
  }
  return edges.filter(
    (e) =>
      e.sourceId === selectedId ||
      e.targetId === selectedId ||
      (includeCluster && partners.has(e.sourceId) && partners.has(e.targetId)),
  )
}

describe('focusEdgesFor', () => {
  // a's partners are b and c (same key); b–c interlink; d links only to c.
  const tracks = [
    track({ id: 'a', key: '8A' }),
    track({ id: 'b', key: '8A' }),
    track({ id: 'c', key: '8A', bpm: 120 }),
    track({ id: 'd', key: '1B', bpm: 120 }),
  ]
  const cfg = config({
    threshold: 1,
    bpm: { ...DEFAULT_CRITERIA.bpm, enabled: true },
    genre: { ...DEFAULT_CRITERIA.genre, enabled: false },
    energy: { ...DEFAULT_CRITERIA.energy, enabled: false },
    year: { ...DEFAULT_CRITERIA.year, enabled: false },
  })
  const ids = (edges: ComboEdge[]) => edges.map((e) => `${e.sourceId}-${e.targetId}`)

  test('no selection means no edges at all', () => {
    expect(focusEdgesFor(buildComboGraph(tracks, cfg), null, true)).toEqual([])
  })

  test('the star: edges incident to the selection, earlier track as source', () => {
    expect(ids(focusEdgesFor(buildComboGraph(tracks, cfg), 'c', false))).toEqual([
      'a-c',
      'b-c',
      'c-d',
    ])
  })

  test('the cluster adds partner interlinks but never edges leaving it', () => {
    expect(ids(focusEdgesFor(buildComboGraph(tracks, cfg), 'a', true))).toEqual([
      'a-b',
      'a-c',
      'b-c',
    ])
  })
})

describe('BPM tolerance default (v12 WS14, ISSUES.md stub)', () => {
  test('defaults to 8% — the pitch-bend range of a classic Technics', () => {
    expect(DEFAULT_CRITERIA.bpm.maxPercent).toBe(8)
  })
})

describe('the lazy combo graph', () => {
  const tracks = randomLibrary(160, 7)
  const configs: [string, CriteriaConfig][] = [
    ['the defaults', config()],
    ['require 1', config({ threshold: 1 })],
    ['require 3', config({ threshold: 3 })],
    ['a demanded key', config({ key: { ...DEFAULT_CRITERIA.key, demanded: true } })],
    [
      'require 0 with a demanded year',
      config({ threshold: 0, year: { ...DEFAULT_CRITERIA.year, demanded: true } }),
    ],
  ]
  /** Today's reference: the adjacency the full edge list implies, in library order. */
  const adjacency = (edges: ComboEdge[]) => {
    const map = new Map(tracks.map((t) => [t.id, new Set<string>()]))
    for (const e of edges) {
      map.get(e.sourceId)!.add(e.targetId)
      map.get(e.targetId)!.add(e.sourceId)
    }
    const order = new Map(tracks.map((t, i) => [t.id, i]))
    return (id: string) => [...map.get(id)!].sort((a, b) => order.get(a)! - order.get(b)!)
  }

  test.each(configs)('partners match the full edge list, in library order (%s)', (_, cfg) => {
    const genreMatch = makeGenreMatcher(
      tracks.map((t) => t.genre),
      cfg.genre.k,
    )
    const expected = adjacency(computeEdges(tracks, cfg, genreMatch))
    const graph = buildComboGraph(tracks, cfg, genreMatch)
    expect(graph.complete).toBe(false)
    for (const t of tracks) {
      expect(graph.partners(t.id)).toEqual(expected(t.id))
      expect(graph.hasPartner(t.id)).toBe(expected(t.id).length > 0)
    }
  })

  test('require 0 with nothing demanded is the complete graph', () => {
    const graph = buildComboGraph(tracks, config({ threshold: 0 }))
    expect(graph.complete).toBe(true)
    expect(graph.partners('t3')).toEqual(tracks.map((t) => t.id).filter((id) => id !== 't3'))
    expect(graph.hasPartner('t3')).toBe(true)
  })

  test('an unknown id has no partners', () => {
    const graph = buildComboGraph(tracks, config())
    expect(graph.partners('nope')).toEqual([])
    expect(graph.hasPartner('nope')).toBe(false)
  })

  test.each(configs)('focus edges equal the full edge list filtered (%s)', (_, cfg) => {
    const genreMatch = makeGenreMatcher(
      tracks.map((t) => t.genre),
      cfg.genre.k,
    )
    const edges = computeEdges(tracks, cfg, genreMatch)
    const graph = buildComboGraph(tracks, cfg, genreMatch)
    for (const selected of [null, 't0', 't1', 't42', 't159']) {
      for (const cluster of [false, true]) {
        expect(focusEdgesFor(graph, selected, cluster)).toEqual(
          focusEdges(edges, selected, cluster),
        )
      }
    }
  })

  test('the pair count is exact while the library is small enough', () => {
    const cfg = config()
    const genreMatch = makeGenreMatcher(
      tracks.map((t) => t.genre),
      cfg.genre.k,
    )
    expect(countComboPairs(buildComboGraph(tracks, cfg, genreMatch))).toEqual({
      count: computeEdges(tracks, cfg, genreMatch).length,
      approximate: false,
    })
  })

  test('a complete graph counts every pair exactly', () => {
    expect(countComboPairs(buildComboGraph(tracks, config({ threshold: 0 })))).toEqual({
      count: (160 * 159) / 2,
      approximate: false,
    })
  })

  test('past the exact limit the count is a close, repeatable estimate', () => {
    const big = randomLibrary(700, 3)
    const cfg = config()
    const genreMatch = makeGenreMatcher(
      big.map((t) => t.genre),
      cfg.genre.k,
    )
    const exact = computeEdges(big, cfg, genreMatch).length
    const graph = buildComboGraph(big, cfg, genreMatch)
    const estimate = countComboPairs(graph, { exactLimit: 1000, samples: 50_000 })
    expect(estimate.approximate).toBe(true)
    expect(Math.abs(estimate.count - exact) / exact).toBeLessThan(0.05)
    expect(countComboPairs(graph, { exactLimit: 1000, samples: 50_000 })).toEqual(estimate)
  })
})
