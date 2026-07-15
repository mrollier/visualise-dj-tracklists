import { describe, expect, test } from 'vitest'
// Build-time math for the genre embedding pack (plain JS, node-only;
// declarations in scripts/genre-pack-lib.d.mts).
import {
  embedRows,
  cosineMatrix,
  mutualProximity,
  ppmiMatrix,
  blendScores,
  retrofit,
  topNeighbours,
  tripletAccuracy,
} from '../scripts/genre-pack-lib.mjs'

describe('embedRows (PPMI → truncated SVD, Levy & Goldberg W = U·Σ^0.5)', () => {
  test('exactly recovers a low-rank symmetric PSD matrix at its true rank', () => {
    // M = W0·W0ᵀ for a known 3×2 factor: rank 2, PSD.
    const w0 = [
      [1, 0],
      [0.5, 1],
      [-1, 0.5],
    ]
    const m = w0.map((a) => w0.map((b) => a[0] * b[0] + a[1] * b[1]))
    const w = embedRows(m, 2, { normalize: false })
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const dot = w[i].reduce((s, v, d) => s + v * w[j][d], 0)
        expect(dot).toBeCloseTo(m[i][j], 6)
      }
    }
  })

  test('keeps the dominant component first when truncating', () => {
    const m = [
      [4, 0],
      [0, 1],
    ]
    const w = embedRows(m, 1, { normalize: false })
    // Top eigenpair is (4, e1): row 0 ≈ ±2, row 1 ≈ 0.
    expect(Math.abs(w[0][0])).toBeCloseTo(2, 6)
    expect(Math.abs(w[1][0])).toBeCloseTo(0, 6)
  })

  test('ignores negative eigenvalues (PPMI matrices are not PSD)', () => {
    // [[0,1],[1,0]] has eigenvalues +1 and −1; only the +1 part is usable.
    const m = [
      [0, 1],
      [1, 0],
    ]
    const w = embedRows(m, 2, { normalize: false })
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const dot = w[i].reduce((s, v, d) => s + v * w[j][d], 0)
        expect(dot).toBeCloseTo(0.5, 6)
      }
    }
  })

  test('normalizes rows to unit length by default', () => {
    const m = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ]
    const w = embedRows(m, 2)
    for (const row of w) {
      const norm = Math.sqrt(row.reduce((s, v) => s + v * v, 0))
      expect(norm).toBeCloseTo(1, 6)
    }
  })
})

describe('ppmiMatrix', () => {
  // 6 recordings: a on 4, b on 2, c on 2; a+b co-tagged twice, b+c once.
  const labels = ['a', 'b', 'c']
  const counts = new Map([
    ['a', 4],
    ['b', 2],
    ['c', 2],
  ])
  const cooc = new Map([
    ['a\tb', 2],
    ['b\tc', 1],
  ])

  test('computes symmetric positive PMI from counts', () => {
    const m = ppmiMatrix(labels, counts, cooc, 6)
    // PMI(a,b) = log( (2/6) / ((4/6)·(2/6)) ) = log 1.5
    expect(m[0][1]).toBeCloseTo(Math.log(1.5), 9)
    expect(m[1][0]).toBeCloseTo(m[0][1], 12)
    // PMI(b,c) = log( (1/6) / ((2/6)·(2/6)) ) = log 1.5
    expect(m[1][2]).toBeCloseTo(Math.log(1.5), 9)
    // No co-occurrence → 0; diagonal 0.
    expect(m[0][2]).toBe(0)
    expect(m[0][0]).toBe(0)
  })

  test('drops pairs below the minimum co-occurrence count (rare-label noise)', () => {
    const m = ppmiMatrix(labels, counts, cooc, 6, { minCount: 2 })
    expect(m[0][1]).toBeGreaterThan(0) // count 2 survives
    expect(m[1][2]).toBe(0) // count 1 is noise-floored
  })
})

describe('blendScores', () => {
  test('multiplies mutual proximity with clamped cosine, keeping unit diagonal', () => {
    const mp = [
      [1, 0.99],
      [0.99, 1],
    ]
    const cos = [
      [1, 0.8],
      [0.8, 1],
    ]
    const blended = blendScores(mp, cos)
    expect(blended[0][1]).toBeCloseTo(0.99 * 0.8, 9)
    expect(blended[0][0]).toBe(1)
  })

  test('negative cosine floors at 0 even when mutual proximity is nonzero', () => {
    const blended = blendScores(
      [
        [1, 0.4],
        [0.4, 1],
      ],
      [
        [1, -0.2],
        [-0.2, 1],
      ],
    )
    expect(blended[0][1]).toBe(0)
  })
})

describe('cosineMatrix', () => {
  test('is symmetric with unit diagonal', () => {
    const w = [
      [1, 0],
      [0.6, 0.8],
      [0, 1],
    ]
    const sim = cosineMatrix(w)
    for (let i = 0; i < 3; i++) expect(sim[i][i]).toBeCloseTo(1, 9)
    expect(sim[0][1]).toBeCloseTo(sim[1][0], 9)
    expect(sim[0][1]).toBeCloseTo(0.6, 9)
    expect(sim[0][2]).toBeCloseTo(0, 9)
  })
})

describe('mutualProximity (Schnitzer et al. 2012, gaussian approximation)', () => {
  // Four genres in two tight pairs plus one hub that is everyone's raw
  // nearest neighbour (the "Electronic" umbrella pathology).
  const labels = ['a', 'b', 'c', 'd', 'hub']
  const sim = [
    [1, 0.7, 0.1, 0.1, 0.8],
    [0.7, 1, 0.1, 0.1, 0.78],
    [0.1, 0.1, 1, 0.7, 0.79],
    [0.1, 0.1, 0.7, 1, 0.81],
    [0.8, 0.78, 0.79, 0.81, 1],
  ]

  test('returns a symmetric matrix within [0, 1] with unit diagonal', () => {
    const mp = mutualProximity(sim)
    for (let i = 0; i < 5; i++) {
      expect(mp[i][i]).toBe(1)
      for (let j = 0; j < 5; j++) {
        expect(mp[i][j]).toBeGreaterThanOrEqual(0)
        expect(mp[i][j]).toBeLessThanOrEqual(1)
        expect(mp[i][j]).toBeCloseTo(mp[j][i], 9)
      }
    }
  })

  test('demotes the hub below genuine pair partners', () => {
    // Raw similarity ranks the hub as a's closest neighbour…
    expect(sim[0][4]).toBeGreaterThan(sim[0][1])
    const mp = mutualProximity(sim)
    // …mutual proximity restores the tight pair.
    expect(mp[0][1]).toBeGreaterThan(mp[0][4])
    void labels
  })
})

describe('topNeighbours', () => {
  const labels = ['house', 'deep house', 'electronic', 'jazz']
  const sim = [
    [1, 0.9, 0.8, 0.2],
    [0.9, 1, 0.7, 0.1],
    [0.8, 0.7, 1, 0.6],
    [0.2, 0.1, 0.6, 1],
  ]

  test('lists each label’s k best neighbours, sorted, without itself', () => {
    const lists = topNeighbours(labels, sim, 2, [])
    expect(lists['house'].map((e) => e[0])).toEqual(['deep house', 'electronic'])
    expect(lists['house'][0][1]).toBeCloseTo(0.9, 6)
    for (const label of labels) {
      expect(lists[label].length).toBeLessThanOrEqual(2)
      expect(lists[label].some((e) => e[0] === label)).toBe(false)
    }
  })

  test('damps scores of pairs involving an umbrella label', () => {
    const lists = topNeighbours(labels, sim, 3, ['electronic'])
    const houseToElectronic = lists['house'].find((e) => e[0] === 'electronic')
    expect(houseToElectronic?.[1]).toBeCloseTo(0.4, 6) // 0.8 × 0.5
    // Damping applies before ranking: deep house (0.9) stays first.
    expect(lists['house'][0][0]).toBe('deep house')
    // Symmetric: the umbrella's own list is damped too.
    expect(lists['electronic'][0][1]).toBeCloseTo(0.4, 6)
  })
})

describe('retrofit (Epure et al. 2020-style graph fusion)', () => {
  const cosine = (a: number[], b: number[]) => {
    const dot = a.reduce((s, v, i) => s + v * b[i], 0)
    const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0))
    const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0))
    return na === 0 || nb === 0 ? 0 : dot / (na * nb)
  }

  test('gives zero-vector nodes (labels unseen in the data) their tree-neighbour direction', () => {
    // Node 2 has no data vector but sits between nodes 0 and 1 in the tree.
    const rows = [
      [1, 0],
      [0.8, 0.6],
      [0, 0],
    ]
    const fused = retrofit(rows, [
      [2, 0],
      [2, 1],
    ])
    expect(cosine(fused[2], [0.9, 0.3])).toBeGreaterThan(0.95)
  })

  test('pulls tree neighbours together while anchoring nodes with data', () => {
    const rows = [
      [1, 0],
      [0, 1],
      [-1, 0],
    ]
    const fused = retrofit(rows, [[0, 1]])
    // The connected pair converges…
    expect(cosine(fused[0], fused[1])).toBeGreaterThan(cosine(rows[0], rows[1]))
    // …but anchoring keeps each node recognisably itself.
    expect(cosine(fused[0], rows[0])).toBeGreaterThan(0.7)
    // Unconnected nodes stay exactly put.
    expect(fused[2]).toEqual(rows[2])
  })
})

describe('tripletAccuracy', () => {
  test('scores the fraction of (anchor, near, far) triplets ordered correctly', () => {
    const simFn = (a: string, b: string) => (a === 'x' && b === 'y' ? 0.9 : 0.1)
    const triplets = [
      ['x', 'y', 'z'], // correct: sim(x,y)=0.9 > sim(x,z)=0.1
      ['x', 'z', 'y'], // wrong:   sim(x,z)=0.1 < sim(x,y)=0.9
    ]
    expect(tripletAccuracy(simFn, triplets)).toBeCloseTo(0.5, 9)
  })
})
