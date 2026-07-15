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

describe('genreSimilarity: embedding', () => {
  test('near neighbours in the pack score higher than distant genres', () => {
    const near = genreSimilarity('House', 'Deep House', 'embedding')
    const far = genreSimilarity('House', 'Gabber', 'embedding')
    expect(near).toBeGreaterThan(far)
  })

  test('same genre is 1 and unknown labels fall back to lexical', () => {
    expect(genreSimilarity('Techno', 'techno', 'embedding')).toBe(1)
    expect(genreSimilarity('Hard House', 'House', 'embedding')).toBeGreaterThan(0)
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
})
