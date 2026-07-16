import { describe, expect, test } from 'vitest'
import { freshFirstSet, newSetId, nextSetName, ordinalSetName } from '../src/core/sets'

describe('ordinalSetName', () => {
  test('names the first twelve sets with ordinal words', () => {
    expect(ordinalSetName(0)).toBe('First Set')
    expect(ordinalSetName(1)).toBe('Second Set')
    expect(ordinalSetName(2)).toBe('Third Set')
    expect(ordinalSetName(11)).toBe('Twelfth Set')
  })

  test('falls back to numbers beyond the twelfth', () => {
    expect(ordinalSetName(12)).toBe('Set 13')
    expect(ordinalSetName(99)).toBe('Set 100')
  })
})

describe('nextSetName', () => {
  test('advances past the names already taken', () => {
    expect(nextSetName([])).toBe('First Set')
    expect(nextSetName(['First Set'])).toBe('Second Set')
    expect(nextSetName(['First Set', 'Second Set'])).toBe('Third Set')
  })

  test('skips arbitrary taken ordinals and ignores custom names', () => {
    expect(nextSetName(['Second Set', 'peak time bangers'])).toBe('First Set')
    expect(nextSetName(['First Set', 'Third Set'])).toBe('Second Set')
  })
})

describe('newSetId / freshFirstSet', () => {
  test('ids are unique', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newSetId()))
    expect(ids.size).toBe(100)
  })

  test('freshFirstSet builds an un-generated First Set around the given tracks', () => {
    const set = freshFirstSet(['a', 'b'])
    expect(set.name).toBe('First Set')
    expect(set.trackIds).toEqual(['a', 'b'])
    expect(set.generated).toBe(false)
    expect(set.id.length).toBeGreaterThan(0)
    expect(freshFirstSet().trackIds).toEqual([])
  })
})
