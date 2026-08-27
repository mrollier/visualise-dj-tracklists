import { describe, expect, test } from 'vitest'
import { mergeAnalysis } from '../src/core/analysis'
import { DESCRIPTOR_KEYS } from '../src/core/properties'
import { buildSampleSidecar } from '../src/data/sample-analysis'
import { SAMPLE_ANALYSIS, SAMPLE_COLLECTION } from '../src/data/samples'

const merged = mergeAnalysis(SAMPLE_COLLECTION.tracks, SAMPLE_ANALYSIS)

function valuesOf(key: (typeof DESCRIPTOR_KEYS)[number]): number[] {
  return merged.tracks.map((t) => t[key]).filter((v): v is number => typeof v === 'number')
}

describe('the sample collection ships a generated analysis sidecar (v35.1)', () => {
  test('joins onto nearly every sample track, and only misses the ones with no location', () => {
    const located = SAMPLE_COLLECTION.tracks.filter((t) => t.location !== null)
    // The sidecar is keyed by the same location strings, so a shortfall here
    // means the path matcher refused an ambiguous tie — two generated
    // locations that collided — not that the data is missing.
    expect(merged.stats.descriptorsFilled).toBe(located.length)
    expect(merged.stats.ambiguous).toBe(0)
    expect(located.length).toBeLessThan(SAMPLE_COLLECTION.tracks.length)
  })

  test('every descriptor lands as a whole percentage inside 0-100', () => {
    for (const key of DESCRIPTOR_KEYS) {
      const values = valuesOf(key)
      expect(values.length, key).toBeGreaterThan(100)
      for (const v of values) {
        expect(Number.isInteger(v), `${key} ${v}`).toBe(true)
        expect(v, key).toBeGreaterThanOrEqual(0)
        expect(v, key).toBeLessThanOrEqual(100)
      }
    }
  })

  test('matches the real collection’s measured mean and spread on every axis', () => {
    // The reference: the v34 run of the real 2040-track collection, the same
    // four models. The demo is generated from per-genre means measured on it,
    // so drifting away from these means the table stopped being data.
    const REAL: Record<string, readonly [number, number]> = {
      arousal: [58.6, 8.8],
      valence: [54.8, 7.2],
      danceability: [92.1, 13.8],
      happiness: [31.5, 28.3],
    }
    for (const key of DESCRIPTOR_KEYS) {
      const v = valuesOf(key)
      const mean = v.reduce((a, b) => a + b, 0) / v.length
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length)
      const [realMean, realSd] = REAL[key]
      // 244 tracks against 2040, so a few points of sampling slack; wide
      // enough not to be brittle, tight enough that guessed numbers fail.
      expect(mean, `${key} mean`).toBeGreaterThan(realMean - 5)
      expect(mean, `${key} mean`).toBeLessThan(realMean + 5)
      expect(sd, `${key} sd`).toBeGreaterThan(realSd - 4)
      expect(sd, `${key} sd`).toBeLessThan(realSd + 4)
    }
  })

  test('keeps the two counter-intuitive facts about these models', () => {
    const meanFor = (genre: RegExp, key: (typeof DESCRIPTOR_KEYS)[number]): number => {
      const v = merged.tracks
        .filter((t) => t.genre !== null && genre.test(t.genre) && typeof t[key] === 'number')
        .map((t) => t[key] as number)
      expect(v.length, `${genre.source} ${key}`).toBeGreaterThan(4)
      return v.reduce((a, b) => a + b, 0) / v.length
    }
    // 1. happiness is an organic/electronic detector, not valence: disco and
    //    house sit within a few points of each other on valence and 40+ apart
    //    on happiness (real: valence 64 vs 60, happiness 69 vs 26).
    expect(Math.abs(meanFor(/disco/i, 'valence') - meanFor(/house/i, 'valence'))).toBeLessThan(10)
    expect(meanFor(/disco/i, 'happiness') - meanFor(/house/i, 'happiness')).toBeGreaterThan(25)
    // 2. danceability saturates — club genres all pin near the top, so the
    //    axis separates band music from club music and little else.
    for (const g of [/techno/i, /house/i, /trance/i])
      expect(meanFor(g, 'danceability')).toBeGreaterThan(88)
  })

  test('the four descriptors do not all rank the tracks the same way', () => {
    // A single hidden "intensity" axis would make all four filters select the
    // same tracks, which would make the demo actively misleading. The real
    // collection's overall correlations run +0.25 to +0.49 on these pairs and
    // -0.24 on danceability/happiness — related, never interchangeable.
    const top = (key: (typeof DESCRIPTOR_KEYS)[number]): Set<string> =>
      new Set(
        [...merged.tracks]
          .filter((t) => typeof t[key] === 'number')
          .sort((a, b) => (b[key] as number) - (a[key] as number))
          .slice(0, 40)
          .map((t) => t.id),
      )
    const arousal = top('arousal')
    const overlapWith = (key: (typeof DESCRIPTOR_KEYS)[number]): number =>
      [...top(key)].filter((id) => arousal.has(id)).length
    expect(overlapWith('valence')).toBeLessThan(30)
    expect(overlapWith('danceability')).toBeLessThan(30)
    expect(overlapWith('happiness')).toBeLessThan(30)
  })

  test('marks every filled value as analysed, so the demo shows real provenance', () => {
    const withDescriptors = merged.tracks.filter((t) => t.arousal !== null)
    for (const t of withDescriptors.slice(0, 20)) {
      expect(merged.analysedFields.get(t.id)?.has('arousal'), t.id).toBe(true)
    }
    // And none of it leaks into the raw library.
    expect(SAMPLE_COLLECTION.tracks.every((t) => t.arousal === null)).toBe(true)
  })

  test('is deterministic — same tracks in, same sidecar out', () => {
    expect(buildSampleSidecar(SAMPLE_COLLECTION.tracks)).toEqual(SAMPLE_ANALYSIS)
  })

  test('never invents an energy for the tracks whose comment has no token (v36)', () => {
    // Energy's only source is the "Energy N" comment; the deliberate sample
    // gap stays an honest null instead of an arousal-derived guess.
    const gapless = SAMPLE_COLLECTION.tracks.filter((t) => t.energy === null)
    expect(gapless.length).toBeGreaterThan(0)
    const byId = new Map(merged.tracks.map((t) => [t.id, t]))
    for (const t of gapless) expect(byId.get(t.id)?.energy, t.id).toBeNull()
  })
})
