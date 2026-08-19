import { describe, expect, test } from 'vitest'
import { WALK_CHEVRON_MIN_EDGE, walkChevronMid } from '../src/core/walkArrow'

describe('walkChevronMid (v21 #2)', () => {
  test('midpoint of a horizontal edge lands halfway between the endpoints', () => {
    const mid = walkChevronMid(0, 5, 40, 5)
    expect(mid).not.toBeNull()
    expect(mid!.x).toBeCloseTo(20, 6)
    expect(mid!.y).toBeCloseTo(5, 6)
  })

  test('midpoint of a vertical edge lands halfway between the endpoints', () => {
    const mid = walkChevronMid(7, 0, 7, 30)
    expect(mid).not.toBeNull()
    expect(mid!.x).toBeCloseTo(7, 6)
    expect(mid!.y).toBeCloseTo(15, 6)
  })

  test('midpoint of a diagonal edge lands halfway between the endpoints', () => {
    const mid = walkChevronMid(0, 0, 30, 40)
    expect(mid).not.toBeNull()
    expect(mid!.x).toBeCloseTo(15, 6)
    expect(mid!.y).toBeCloseTo(20, 6)
  })

  test('endpoint order does not change the result', () => {
    const forward = walkChevronMid(3, 4, 33, 44)
    const reversed = walkChevronMid(33, 44, 3, 4)
    expect(reversed!.x).toBeCloseTo(forward!.x, 6)
    expect(reversed!.y).toBeCloseTo(forward!.y, 6)
  })

  test('an edge exactly at the minimum length gets a chevron', () => {
    // Horizontal, length exactly WALK_CHEVRON_MIN_EDGE: the `<` comparison
    // must not exclude the boundary itself.
    const mid = walkChevronMid(0, 0, WALK_CHEVRON_MIN_EDGE, 0)
    expect(mid).not.toBeNull()
  })

  test('an edge just under the minimum length gets no chevron', () => {
    const mid = walkChevronMid(0, 0, WALK_CHEVRON_MIN_EDGE - 0.01, 0)
    expect(mid).toBeNull()
  })

  test('a zero-length edge returns null, orientation being undefined', () => {
    expect(walkChevronMid(10, 10, 10, 10)).toBeNull()
  })

  test('a custom minLen overrides the default threshold', () => {
    // Length 5 is far under the default minimum but comfortably over a
    // custom minLen of 2.
    expect(walkChevronMid(0, 0, 5, 0, 2)).not.toBeNull()
    // Length 5 is over the default minimum's near neighbour but under a
    // custom minLen of 10.
    expect(walkChevronMid(0, 0, 5, 0, 10)).toBeNull()
  })
})
