import { describe, expect, test } from 'vitest'
import { CLASS_SYMBOLS, createShapePathCache } from '../src/lib/shapeSymbols'

describe('createShapePathCache', () => {
  test('returns a non-empty path string', () => {
    const shapePath = createShapePathCache()
    const path = shapePath(0, 5)
    expect(typeof path).toBe('string')
    expect(path.length).toBeGreaterThan(0)
  })

  test('same (index, r) returns the cached identical string', () => {
    const shapePath = createShapePathCache()
    const first = shapePath(2, 6)
    const second = shapePath(2, 6)
    // Cached: the exact same string instance comes back.
    expect(second).toBe(first)
  })

  test('class index wraps via modulo over the symbol list', () => {
    const shapePath = createShapePathCache()
    const len = CLASS_SYMBOLS.length
    // index len wraps to 0, len + 1 wraps to 1 — identical shapes, identical paths.
    expect(shapePath(len, 5)).toBe(shapePath(0, 5))
    expect(shapePath(len + 1, 5)).toBe(shapePath(1, 5))
  })

  test('null index draws the circle (same path as class 0)', () => {
    const shapePath = createShapePathCache()
    // CLASS_SYMBOLS[0] is the circle, so null and 0 produce the same path at a
    // given radius (distinct cache keys, equal value).
    expect(shapePath(null, 5)).toBe(shapePath(0, 5))
  })

  test('different radii produce different paths', () => {
    const shapePath = createShapePathCache()
    expect(shapePath(0, 5)).not.toBe(shapePath(0, 9))
  })

  test('an explicit symbol list overrides the default', () => {
    const single = createShapePathCache([CLASS_SYMBOLS[0]])
    // length 1 → every index collapses to the one symbol.
    expect(single(3, 5)).toBe(single(0, 5))
  })
})
