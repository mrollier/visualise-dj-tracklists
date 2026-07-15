import { describe, expect, test } from 'vitest'
import { genreSimilarity, normalizeGenre } from '../src/core/genre'

describe('normalizeGenre', () => {
  test('lowercases, trims, and unifies separators', () => {
    expect(normalizeGenre('  Tech-House ')).toBe('tech house')
    expect(normalizeGenre('2-Step')).toBe('2 step')
  })

  test('resolves common aliases (Schreiber-style normalization)', () => {
    expect(normalizeGenre('DnB')).toBe('drum & bass')
    expect(normalizeGenre("Drum'n'Bass")).toBe('drum & bass')
    expect(normalizeGenre('Drum and Bass')).toBe('drum & bass')
    expect(normalizeGenre('D&B')).toBe('drum & bass')
    expect(normalizeGenre('RnB')).toBe('r&b')
    expect(normalizeGenre('Hip-Hop')).toBe('hip hop')
    expect(normalizeGenre('Psy Trance')).toBe('psytrance')
  })
})

describe('genreSimilarity: exact', () => {
  test('1 for equal after normalization, 0 otherwise', () => {
    expect(genreSimilarity('Techno', 'techno', 'exact')).toBe(1)
    expect(genreSimilarity('DnB', 'Drum & Bass', 'exact')).toBe(1)
    expect(genreSimilarity('Techno', 'Tech House', 'exact')).toBe(0)
  })
})

describe('genreSimilarity: lexical', () => {
  test('token overlap gives partial similarity', () => {
    const s = genreSimilarity('Tech House', 'Deep House', 'lexical')
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })

  test('identical labels score 1, disjoint labels 0', () => {
    expect(genreSimilarity('Deep House', 'deep-house', 'lexical')).toBe(1)
    expect(genreSimilarity('Techno', 'Jazz', 'lexical')).toBe(0)
  })

  test('is symmetric', () => {
    expect(genreSimilarity('Tech House', 'House', 'lexical')).toBe(
      genreSimilarity('House', 'Tech House', 'lexical'),
    )
  })
})

describe('genreSimilarity: graph', () => {
  test('direct neighbours beat two-step relations, which beat far genres', () => {
    const parent = genreSimilarity('House', 'Deep House', 'graph')
    const sibling = genreSimilarity('Techno', 'Tech House', 'graph')
    const far = genreSimilarity('Techno', 'Jazz', 'graph')
    expect(parent).toBeGreaterThan(sibling)
    expect(sibling).toBeGreaterThan(far)
  })

  test('same genre is 1; aliases resolve before lookup', () => {
    expect(genreSimilarity('Drum and Bass', 'DnB', 'graph')).toBe(1)
  })

  test('labels not in the graph fall back to lexical similarity', () => {
    // "Hard House" is not a graph node but shares a token with "House".
    expect(genreSimilarity('Hard House', 'House', 'graph')).toBeGreaterThan(0)
    expect(genreSimilarity('Zydeco', 'Techno', 'graph')).toBe(0)
  })

  test('is symmetric', () => {
    expect(genreSimilarity('Dub', 'Dubstep', 'graph')).toBe(
      genreSimilarity('Dubstep', 'Dub', 'graph'),
    )
  })
})

describe('genreSimilarity: taxonomy (Lin over the rooted genre tree)', () => {
  test('parent–child beats cousins, which beat unrelated families', () => {
    const parentChild = genreSimilarity('House', 'Deep House', 'taxonomy')
    const cousins = genreSimilarity('Deep House', 'Tech House', 'taxonomy')
    const far = genreSimilarity('Techno', 'Jazz', 'taxonomy')
    expect(parentChild).toBeGreaterThan(cousins)
    expect(cousins).toBeGreaterThan(far)
    expect(far).toBe(0)
  })

  test('deep specific ancestors count more than shallow generic ones', () => {
    // Siblings under drum & bass (deep LCA) vs pairs relating only through
    // the electronic umbrella (shallow LCA).
    const deepLca = genreSimilarity('Liquid Drum & Bass', 'Neurofunk', 'taxonomy')
    const shallowLca = genreSimilarity('Deep House', 'Gabber', 'taxonomy')
    expect(deepLca).toBeGreaterThan(shallowLca)
  })

  test('umbrella ancestors score low against their descendants (low IC)', () => {
    const viaUmbrella = genreSimilarity('Electronic', 'Techno', 'taxonomy')
    const withinFamily = genreSimilarity('Techno', 'Minimal Techno', 'taxonomy')
    expect(withinFamily).toBeGreaterThan(viaUmbrella)
  })

  test('multi-parent genres sit close to every parent (DAG, not strict tree)', () => {
    // Tech house derives from both house and techno: each parent must score
    // clearly above an unrelated electronic family (trance).
    const toTrance = genreSimilarity('Tech House', 'Trance', 'taxonomy')
    expect(genreSimilarity('Tech House', 'Techno', 'taxonomy')).toBeGreaterThan(toTrance + 0.2)
    expect(genreSimilarity('Tech House', 'House', 'taxonomy')).toBeGreaterThan(toTrance + 0.2)
  })

  test('is symmetric and 1 for identical labels', () => {
    expect(genreSimilarity('Jungle', 'jungle', 'taxonomy')).toBe(1)
    expect(genreSimilarity('Dub', 'Dubstep', 'taxonomy')).toBe(
      genreSimilarity('Dubstep', 'Dub', 'taxonomy'),
    )
  })

  test('labels outside the tree fall back to lexical similarity', () => {
    expect(genreSimilarity('Warehouse House', 'House', 'taxonomy')).toBeGreaterThan(0)
    expect(genreSimilarity('Zydeco', 'Techno', 'taxonomy')).toBe(0)
  })
})

describe('genreSimilarity: embedding', () => {
  test('near neighbours in the pack score higher than distant genres', () => {
    const near = genreSimilarity('House', 'Deep House', 'embedding')
    const far = genreSimilarity('House', 'Gabber', 'embedding')
    expect(near).toBeGreaterThan(far)
  })

  test('same genre is 1 and unknown labels fall back to lexical', () => {
    expect(genreSimilarity('Techno', 'techno', 'embedding')).toBe(1)
    // "warehouse house" is no real pack label; token overlap carries it.
    expect(genreSimilarity('Warehouse House', 'House', 'embedding')).toBeGreaterThan(0)
  })

  test('known labels that are not neighbours score 0, not lexical', () => {
    // Both are pack labels sharing the token "hard", but unrelated music:
    // the pack must answer 0 instead of falling back to word overlap.
    expect(genreSimilarity('Hard Rock', 'Hard Trance', 'embedding')).toBe(0)
  })

  test('umbrella labels are damped and cannot act as hubs', () => {
    const umbrella = genreSimilarity('House', 'Electronic', 'embedding')
    expect(umbrella).toBeLessThanOrEqual(0.5)
    expect(genreSimilarity('House', 'Deep House', 'embedding')).toBeGreaterThan(umbrella)
  })

  test('stays within [0, 1]', () => {
    for (const pair of [
      ['Techno', 'Minimal Techno'],
      ['Trance', 'Jazz'],
      ['Dubstep', 'Riddim'],
    ] as const) {
      const s = genreSimilarity(pair[0], pair[1], 'embedding')
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(1)
    }
  })

  test('the real AcousticBrainz pack orders relatedness sensibly', () => {
    const techHouse = genreSimilarity('Techno', 'Tech House', 'embedding')
    const house = genreSimilarity('Techno', 'House', 'embedding')
    const folk = genreSimilarity('Techno', 'Folk', 'embedding')
    expect(techHouse).toBeGreaterThan(house)
    expect(house).toBeGreaterThan(folk)
    expect(genreSimilarity('Trance', 'Progressive Trance', 'embedding')).toBeGreaterThan(0.5)
    expect(genreSimilarity('Disco', 'Funk', 'embedding')).toBeGreaterThan(
      genreSimilarity('Disco', 'Death Metal', 'embedding'),
    )
  })

  test('space-collapsed pack labels are found from spaced app labels', () => {
    // The dataset spells some labels without spaces ("eurodance"); a spaced
    // user label must still hit the same vector, not the lexical fallback.
    expect(genreSimilarity('Euro Dance', 'Eurodance', 'embedding')).toBe(1)
  })
})
