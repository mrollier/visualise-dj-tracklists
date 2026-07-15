import { describe, expect, test } from 'vitest'
import { computeEdges, DEFAULT_CRITERIA, evaluateCombo } from '../src/core/combos'
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
    expect(evaluateCombo(base, track({ id: 'b', bpm: 130 }), cfg).matched).toContain('bpm')
    // 120 vs 130 → 8.3% of 120: inside 10%
    expect(
      evaluateCombo(track({ id: 'c', bpm: 120 }), track({ id: 'd', bpm: 130 }), cfg).matched,
    ).toContain('bpm')
    // 128 vs 148 → 15.6%: outside
    expect(evaluateCombo(base, track({ id: 'e', bpm: 148 }), cfg).matched).not.toContain('bpm')
  })

  test('genre matches case-insensitively and exactly by default', () => {
    const cfg = config()
    expect(evaluateCombo(base, track({ id: 'b', genre: 'techno' }), cfg).matched).toContain('genre')
    expect(evaluateCombo(base, track({ id: 'c', genre: 'Tech House' }), cfg).matched).not.toContain(
      'genre',
    )
  })

  test('genre criterion can use a similarity method with a threshold', () => {
    const cfg = config()
    cfg.genre = { enabled: true, method: 'graph', threshold: 0.3 }
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
