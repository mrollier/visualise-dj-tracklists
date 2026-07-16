import { describe, expect, test } from 'vitest'
import {
  computeEdges,
  DEFAULT_CRITERIA,
  evaluateCombo,
  makeGenreMatcher,
  matchedGenrePairs,
} from '../src/core/combos'
import type { CriteriaConfig } from '../src/core/combos'
import type { Track } from '../src/core/model'

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

describe('individual criteria', () => {
  const base = track({ id: 'a' })

  test('bpm matches within the configured percentage of the slower track', () => {
    const cfg = config({ threshold: 5 })
    // ±8% by default: the pitch-bend range of a classic Technics 1210 fader
    expect(DEFAULT_CRITERIA.bpm.maxPercent).toBe(8)
    expect(evaluateCombo(base, track({ id: 'b', bpm: 130 }), cfg).matched).toContain('bpm')
    // 120 vs 129 → 7.5% of 120: inside 8%
    expect(
      evaluateCombo(track({ id: 'c', bpm: 120 }), track({ id: 'd', bpm: 129 }), cfg).matched,
    ).toContain('bpm')
    // 120 vs 130 → 8.3% of 120: just outside the default
    expect(
      evaluateCombo(track({ id: 'c', bpm: 120 }), track({ id: 'd', bpm: 130 }), cfg).matched,
    ).not.toContain('bpm')
    // …but inside a widened tolerance
    const wide = config({ threshold: 5, bpm: { ...DEFAULT_CRITERIA.bpm, maxPercent: 10 } })
    expect(
      evaluateCombo(track({ id: 'c', bpm: 120 }), track({ id: 'd', bpm: 130 }), wide).matched,
    ).toContain('bpm')
    // 128 vs 148 → 15.6%: outside
    expect(evaluateCombo(base, track({ id: 'e', bpm: 148 }), cfg).matched).not.toContain('bpm')
  })

  test('a 0% tolerance means an exact BPM match (issue 8)', () => {
    const cfg = config({ threshold: 5, bpm: { ...DEFAULT_CRITERIA.bpm, maxPercent: 0 } })
    expect(evaluateCombo(base, track({ id: 'b', bpm: 128 }), cfg).matched).toContain('bpm')
    expect(evaluateCombo(base, track({ id: 'c', bpm: 128.5 }), cfg).matched).not.toContain('bpm')
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
    expect(evaluateCombo(base, track({ id: 'b', bpm: 192 }), cfg).matched).toContain('bpm')
    expect(
      evaluateCombo(track({ id: 'c', bpm: 192 }), track({ id: 'd', bpm: 128 }), cfg).matched,
    ).toContain('bpm')
    // …not without it…
    expect(evaluateCombo(base, track({ id: 'e', bpm: 192 }), config()).matched).not.toContain('bpm')
    // …and the percent tolerance still applies around the ratio:
    // 190 × 2/3 = 126.67, 1.05% off 128 — inside 2%, outside at 185 (3.8%)
    cfg.bpm.maxPercent = 2
    expect(evaluateCombo(base, track({ id: 'f', bpm: 190 }), cfg).matched).toContain('bpm')
    expect(evaluateCombo(base, track({ id: 'g', bpm: 185 }), cfg).matched).not.toContain('bpm')
  })

  test('unit time can be disabled to isolate the ratio matches', () => {
    const cfg = config({ threshold: 5 })
    cfg.bpm = { ...cfg.bpm, unitTime: false, halfDouble: true }
    expect(evaluateCombo(base, track({ id: 'b', bpm: 128 }), cfg).matched).not.toContain('bpm')
    expect(evaluateCombo(base, track({ id: 'c', bpm: 64 }), cfg).matched).toContain('bpm')
    // all ratios off: bpm stays evaluable but can never match
    const none = config({ threshold: 5 })
    none.bpm = { ...none.bpm, unitTime: false }
    const result = evaluateCombo(base, track({ id: 'd', bpm: 128 }), none)
    expect(result.evaluable).toContain('bpm')
    expect(result.matched).not.toContain('bpm')
  })

  test('vinyl mode needs no pitch shift on an exact 3/2 ratio (same platter speed)', () => {
    const cfg = config({ threshold: 5 })
    cfg.key = { ...cfg.key, vinylMode: true }
    cfg.bpm = { ...cfg.bpm, twoThirds: true }
    // 192 = 128 × 3/2 exactly: the platter speed is unchanged, so same-key
    // tracks still key-match (the residual-semitone formula covers ratios)
    const a = track({ id: 'a', bpm: 128, key: '8A' })
    expect(evaluateCombo(a, track({ id: 'b', bpm: 192, key: '8A' }), cfg).matched).toContain('key')
  })

  test('genre defaults to the hybrid method (design-v6 §F), case-insensitively', () => {
    const cfg = config()
    expect(DEFAULT_CRITERIA.genre.method).toBe('hybrid')
    expect(evaluateCombo(base, track({ id: 'b', genre: 'techno' }), cfg).matched).toContain('genre')
    // hybrid knows relatedness beyond shared words: Tech House ~ Techno
    expect(evaluateCombo(base, track({ id: 'c', genre: 'Tech House' }), cfg).matched).toContain(
      'genre',
    )
    // unrelated genres still do not match
    expect(evaluateCombo(base, track({ id: 'f', genre: 'Country' }), cfg).matched).not.toContain(
      'genre',
    )
  })

  test('genre criterion can use a similarity method with a threshold', () => {
    const cfg = config()
    cfg.genre = { ...cfg.genre, method: 'graph', mode: 'threshold', threshold: 0.3 }
    // techno ↔ tech house are two steps apart in the curated graph (0.36 ≥ 0.3)
    expect(evaluateCombo(base, track({ id: 'b', genre: 'Tech House' }), cfg).matched).toContain(
      'genre',
    )
    // raising the threshold excludes them again
    cfg.genre.threshold = 0.5
    expect(evaluateCombo(base, track({ id: 'c', genre: 'Tech House' }), cfg).matched).not.toContain(
      'genre',
    )
  })

  test('alias spellings count as the same genre even in exact mode', () => {
    const cfg = config()
    const a = track({ id: 'a2', genre: 'DnB' })
    const b = track({ id: 'b2', genre: 'Drum & Bass' })
    expect(evaluateCombo(a, b, cfg).matched).toContain('genre')
  })

  describe('mutual top-k genre matching', () => {
    const topkConfig = (genre: Partial<CriteriaConfig['genre']> = {}): CriteriaConfig => {
      const cfg = config()
      cfg.genre = { ...cfg.genre, mode: 'topk', k: 1, threshold: 0.1, ...genre }
      return cfg
    }

    test('accepts pairs that are mutually each other’s nearest genres', () => {
      const cfg = topkConfig({ method: 'lexical' })
      const matcher = makeGenreMatcher(['Deep House', 'Tech House', 'Jazz'], cfg)
      expect(matcher('Deep House', 'Tech House')).toBe(true)
      expect(matcher('Deep House', 'Jazz')).toBe(false)
    })

    test('identical genres always match', () => {
      const cfg = topkConfig({ method: 'embedding' })
      const matcher = makeGenreMatcher(['Electronic', 'Techno'], cfg)
      expect(matcher('Electronic', 'Electronic')).toBe(true)
    })

    test('umbrella labels never rank as neighbours', () => {
      const cfg = topkConfig({ method: 'embedding', k: 3 })
      const matcher = makeGenreMatcher(['Electronic', 'Techno', 'Tech House'], cfg)
      expect(matcher('Techno', 'Tech House')).toBe(true)
      expect(matcher('Electronic', 'Techno')).toBe(false)
    })

    test('the threshold acts as a secondary score floor', () => {
      const strict = makeGenreMatcher(
        ['Deep House', 'Tech House'],
        topkConfig({ method: 'lexical', threshold: 0.9 }),
      )
      expect(strict('Deep House', 'Tech House')).toBe(false) // sim ⅓ < 0.9
      const loose = makeGenreMatcher(
        ['Deep House', 'Tech House'],
        topkConfig({ method: 'lexical', threshold: 0.3 }),
      )
      expect(loose('Deep House', 'Tech House')).toBe(true)
    })

    test('k widens the neighbourhood', () => {
      // With graph decay: house–deep house 0.6, house–techno 0.6,
      // deep house–techno 0.36 (two steps).
      const genres = ['House', 'Deep House', 'Techno']
      const k1 = makeGenreMatcher(genres, topkConfig({ method: 'graph', k: 1 }))
      // deep house's single nearest is house, techno's single nearest is house
      // (alphabetical tie-break) — deep house ↔ techno only appears at k=2.
      expect(k1('Deep House', 'Techno')).toBe(false)
      const k2 = makeGenreMatcher(genres, topkConfig({ method: 'graph', k: 2 }))
      expect(k2('Deep House', 'Techno')).toBe(true)
    })

    test('multi-genre fields match through any component', () => {
      const cfg = topkConfig({ method: 'lexical' })
      const matcher = makeGenreMatcher(['House / Techno', 'Minimal Techno', 'Jazz'], cfg)
      expect(matcher('House / Techno', 'Minimal Techno')).toBe(true)
      expect(matcher('Jazz', 'Minimal Techno')).toBe(false)
    })

    test('matchedGenrePairs counts distinct matching label pairs, k-sensitive', () => {
      // Graph decay: house–deep house 0.6, house–techno 0.6, deep
      // house–techno 0.36. k=1 leaves only the mutual nearest pair; k=2
      // opens all three — the live count must reflect the sliders (issue 12).
      const genres = ['House', 'Deep House', 'Techno']
      expect(matchedGenrePairs(genres, topkConfig({ method: 'graph', k: 1 }))).toEqual([
        ['deep house', 'house'],
      ])
      expect(matchedGenrePairs(genres, topkConfig({ method: 'graph', k: 2 }))).toEqual([
        ['deep house', 'house'],
        ['deep house', 'techno'],
        ['house', 'techno'],
      ])
    })

    test('matchedGenrePairs respects threshold mode and never pairs a label with itself', () => {
      const cfg = config()
      cfg.genre = { ...cfg.genre, method: 'lexical', mode: 'threshold', threshold: 0.3 }
      expect(matchedGenrePairs(['Deep House', 'Tech House', 'Jazz', 'Jazz'], cfg)).toEqual([
        ['deep house', 'tech house'],
      ])
      cfg.genre = { ...cfg.genre, threshold: 0.9 }
      expect(matchedGenrePairs(['Deep House', 'Tech House', 'Jazz'], cfg)).toEqual([])
    })

    test('matchedGenrePairs keeps umbrella labels out of top-k pairs', () => {
      const cfg = topkConfig({ method: 'embedding', k: 3 })
      const pairs = matchedGenrePairs(['Electronic', 'Techno', 'Tech House'], cfg)
      expect(pairs).toEqual([['tech house', 'techno']])
    })

    test('computeEdges links mutual top-k genres and nothing else', () => {
      const cfg = topkConfig({ method: 'lexical' })
      cfg.key.enabled = false
      cfg.bpm.enabled = false
      cfg.year.enabled = false
      cfg.threshold = 1
      const tracks = [
        track({ id: 'a', genre: 'Deep House' }),
        track({ id: 'b', genre: 'Tech House' }),
        track({ id: 'c', genre: 'Jazz' }),
      ]
      const edges = computeEdges(tracks, cfg)
      expect(edges).toHaveLength(1)
      expect([edges[0].sourceId, edges[0].targetId].sort()).toEqual(['a', 'b'])
    })
  })

  test('half/double-time BPM only matches when enabled', () => {
    const dnb = track({ id: 'x', bpm: 174 })
    const halftime = track({ id: 'y', bpm: 87 })
    expect(evaluateCombo(dnb, halftime, config()).matched).not.toContain('bpm')
    const cfg = config()
    cfg.bpm.halfDouble = true
    expect(evaluateCombo(dnb, halftime, cfg).matched).toContain('bpm')
    // still respects the tolerance after doubling: 174 vs 2×78 = 156 → 11.5%
    expect(evaluateCombo(dnb, track({ id: 'z', bpm: 78 }), cfg).matched).not.toContain('bpm')
  })

  test('vinyl mode: beatmatching pitch shift transposes the key before matching', () => {
    // b pitched up from 122.7 to 130 BPM (+1 semitone) turns 1A into 8A.
    const a = track({ id: 'a2', key: '8A', bpm: 130 })
    const b = track({ id: 'b2', key: '1A', bpm: 122.7 })
    expect(evaluateCombo(a, b, config()).matched).not.toContain('key')
    const cfg = config()
    cfg.key.vinylMode = true
    expect(evaluateCombo(a, b, cfg).matched).toContain('key')
    expect(evaluateCombo(b, a, cfg).matched).toContain('key') // symmetric
  })

  test('vinyl mode ignores tempo gaps that land between semitones', () => {
    // 130/126.3 ≈ +0.5 semitone: not a clean transposition, no key match.
    const a = track({ id: 'a3', key: '8A', bpm: 130 })
    const b = track({ id: 'b3', key: '1A', bpm: 126.3 })
    const cfg = config()
    cfg.key.vinylMode = true
    expect(evaluateCombo(a, b, cfg).matched).not.toContain('key')
  })

  test('vinyl mode is strict: same-key tracks a semitone apart in tempo lose their key match', () => {
    // Beatmatching b (122.7 → 130) shifts its 8A up a semitone to 3A ≠ 8A.
    const a = track({ id: 'a5', key: '8A', bpm: 130 })
    const b = track({ id: 'b5', key: '8A', bpm: 122.7 })
    expect(evaluateCombo(a, b, config()).matched).toContain('key')
    const cfg = config()
    cfg.key.vinylMode = true
    expect(evaluateCombo(a, b, cfg).matched).not.toContain('key')
    expect(evaluateCombo(b, a, cfg).matched).not.toContain('key') // symmetric
  })

  test('vinyl mode is strict: same-key tracks detuned by a half semitone lose their key match', () => {
    // 130/126.3 ≈ +0.5 semitone: after beatmatching the keys sit between slots.
    const a = track({ id: 'a6', key: '8A', bpm: 130 })
    const b = track({ id: 'b6', key: '8A', bpm: 126.3 })
    expect(evaluateCombo(a, b, config()).matched).toContain('key')
    const cfg = config()
    cfg.key.vinylMode = true
    expect(evaluateCombo(a, b, cfg).matched).not.toContain('key')
  })

  test('vinyl mode is strict: unbeatmatchable tempo gaps have no key relation', () => {
    // 130 vs 100 is beyond the pitch-fader range (bpm.maxPercent): on vinyl
    // these two can never play together, so same key or not, no key match.
    const a = track({ id: 'a7', key: '8A', bpm: 130 })
    const b = track({ id: 'b7', key: '8A', bpm: 100 })
    expect(evaluateCombo(a, b, config()).matched).toContain('key')
    const cfg = config()
    cfg.key.vinylMode = true
    expect(evaluateCombo(a, b, cfg).matched).not.toContain('key')
  })

  test('vinyl mode: near-equal tempos and missing BPMs fall back to the plain comparison', () => {
    const cfg = config()
    cfg.key.vinylMode = true
    // ~0 semitone shift: plain same-key match survives
    const a = track({ id: 'a8', key: '8A', bpm: 128 })
    expect(evaluateCombo(a, track({ id: 'b8', key: '8A', bpm: 128.5 }), cfg).matched).toContain(
      'key',
    )
    // no tempo data on one side: cannot model the shift, compare keys as-is
    expect(evaluateCombo(a, track({ id: 'c8', key: '8A', bpm: null }), cfg).matched).toContain(
      'key',
    )
  })

  test('vinyl mode works across a half/double-time bridge', () => {
    // b played double-time at 164.2 then pitched to 174 is +1 semitone: 1A → 8A.
    const a = track({ id: 'a4', key: '8A', bpm: 174 })
    const b = track({ id: 'b4', key: '1A', bpm: 82.1 })
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
    expect(evaluateCombo(base, track({ id: 'b', year: 2024 }), cfg).matched).toContain('year')
    expect(evaluateCombo(base, track({ id: 'c', year: 2026 }), cfg).matched).not.toContain('year')
  })

  test('rating is a library filter, not a combo criterion', () => {
    // Wildly different ratings must not affect the combo evaluation at all.
    const cfg = config({ threshold: 4 })
    const other = track({ id: 'b', rating: 0 })
    const result = evaluateCombo(base, other, cfg)
    expect(result.evaluable).toEqual(['key', 'bpm', 'genre', 'year'])
    expect(result.isCombo).toBe(true)
  })

  test('key uses Camelot adjacency', () => {
    const cfg = config()
    expect(evaluateCombo(base, track({ id: 'b', key: '9A' }), cfg).matched).toContain('key')
    expect(evaluateCombo(base, track({ id: 'c', key: '3A' }), cfg).matched).not.toContain('key')
  })

  test('disabled criteria are neither evaluated nor counted', () => {
    const cfg = config()
    cfg.genre.enabled = false
    const result = evaluateCombo(base, track({ id: 'b', genre: 'Ambient' }), cfg)
    expect(result.evaluable).not.toContain('genre')
    expect(result.matched).not.toContain('genre')
  })
})

describe('threshold logic', () => {
  const base = track({ id: 'a' })

  test('edge exists iff at least `threshold` criteria match', () => {
    // matches on key, bpm, genre; fails year
    const other = track({ id: 'b', key: '8B', bpm: 126, year: 2000 })
    expect(evaluateCombo(base, other, config({ threshold: 3 })).isCombo).toBe(true)
    expect(evaluateCombo(base, other, config({ threshold: 4 })).isCombo).toBe(false)
  })

  test('missing values shrink the denominator instead of failing', () => {
    // Only key and bpm are evaluable; both match → combo even at threshold 4
    const sparse = track({ id: 'b', genre: null, year: null })
    const result = evaluateCombo(base, sparse, config({ threshold: 4 }))
    expect(result.evaluable).toEqual(['key', 'bpm'])
    expect(result.isCombo).toBe(true)
  })

  test('a missing value on either side makes the criterion non-evaluable', () => {
    const noKey = track({ id: 'b', key: null })
    expect(evaluateCombo(base, noKey, config()).evaluable).not.toContain('key')
  })

  test('no evaluable criteria means no combo', () => {
    const empty = track({ id: 'b', key: null, bpm: null, genre: null, year: null, rating: null })
    expect(evaluateCombo(base, empty, config({ threshold: 1 })).isCombo).toBe(false)
  })

  test('evaluation is symmetric in its arguments', () => {
    const other = track({ id: 'b', key: '9A', bpm: 120, genre: null, year: 2015 })
    const ab = evaluateCombo(base, other, config())
    const ba = evaluateCombo(other, base, config())
    expect(ab.matched.sort()).toEqual(ba.matched.sort())
    expect(ab.isCombo).toBe(ba.isCombo)
  })

  test('raising the threshold never creates new edges (monotonicity)', () => {
    const tracks = [
      base,
      track({ id: 'b', key: '9A', bpm: 132 }),
      track({ id: 'c', key: '3B', bpm: 174, genre: 'DnB', year: 1998 }),
      track({ id: 'd', genre: null, year: null }),
    ]
    let previous = Infinity
    for (let threshold = 1; threshold <= 4; threshold++) {
      const count = computeEdges(tracks, config({ threshold })).length
      expect(count).toBeLessThanOrEqual(previous)
      previous = count
    }
  })
})

describe('computeEdges', () => {
  test('returns each undirected combo once, without self-edges', () => {
    const tracks = [track({ id: 'a' }), track({ id: 'b', bpm: 126 }), track({ id: 'c', bpm: 127 })]
    const edges = computeEdges(tracks, config({ threshold: 1 }))
    const pairs = edges.map((e) => `${e.sourceId}-${e.targetId}`)
    expect(new Set(pairs).size).toBe(pairs.length)
    expect(pairs).toHaveLength(3) // a-b, a-c, b-c
    for (const e of edges) expect(e.sourceId).not.toBe(e.targetId)
  })

  test('edges carry the matched criteria for UI display', () => {
    const tracks = [track({ id: 'a' }), track({ id: 'b', bpm: 126 })]
    const [edge] = computeEdges(tracks, config({ threshold: 4 }))
    expect(edge.matched).toEqual(expect.arrayContaining(['key', 'bpm', 'genre', 'year']))
  })
})
