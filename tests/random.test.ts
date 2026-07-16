import { describe, expect, test } from 'vitest'
import { hashUnit, mulberry32 } from '../src/core/random'

describe('hashUnit', () => {
  test('is deterministic per (id, seed) and stays in [0, 1)', () => {
    for (const id of ['a', 'rb-42', 'track with spaces', '']) {
      const v = hashUnit(id, 7)
      expect(v).toBe(hashUnit(id, 7))
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  test('a new seed re-jitters: most ids land elsewhere', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `track-${i}`)
    const movedCount = ids.filter((id) => hashUnit(id, 1) !== hashUnit(id, 2)).length
    expect(movedCount).toBeGreaterThan(190)
  })

  test('spreads roughly uniformly (no bucket starves or hoards)', () => {
    const buckets = [0, 0, 0, 0]
    for (let i = 0; i < 1000; i++) {
      buckets[Math.floor(hashUnit(`id-${i}`, 3) * 4)]++
    }
    for (const count of buckets) {
      expect(count).toBeGreaterThan(150)
      expect(count).toBeLessThan(350)
    }
  })
})

describe('mulberry32', () => {
  test('yields a deterministic sequence for a given seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  test('different seeds diverge', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()])
  })

  test('stays in [0, 1)', () => {
    const rand = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const v = rand()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
